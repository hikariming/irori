import { useCallback, useEffect, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  applyTurn,
  beginEncounter,
  describeStateAsDiary,
  getCharacterState,
  loadCharacterStates as loadLegacyCharacterStates,
  mergeImpressions,
  selectImpressionsForPrompt,
  type CharacterStates,
  type ParsedImpression,
  type TurnInput
} from "./character-state";
import { desktopBackend } from "./desktop-backend";

export function useCharacterState() {
  const [states, setStates] = useState<CharacterStates>({});
  const statesRef = useRef(states);
  statesRef.current = states;

  // 从后端（本地 SQLite）加载；首次运行时把遗留的 localStorage 数据迁移过去。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded = await desktopBackend.loadCharacterStates().catch(() => ({} as CharacterStates));
      if (Object.keys(loaded).length === 0) {
        const legacy = loadLegacyCharacterStates();
        if (Object.keys(legacy).length > 0) {
          loaded = legacy;
          desktopBackend.saveCharacterStates(legacy).catch(() => {});
        }
      }
      if (!cancelled) {
        statesRef.current = loaded;
        setStates(loaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback((next: CharacterStates) => {
    statesRef.current = next;
    setStates(next);
    desktopBackend.saveCharacterStates(next).catch(() => {});
  }, []);

  // 在发送 prompt 前调用：推进「见面/精力」状态，返回要注入的内心心声和记得的事。
  const beginCharacterTurn = useCallback(
    (card: CharacterCard): { selfState: string; memories: string[] } => {
      const current = getCharacterState(statesRef.current, card.id);
      const { state, context } = beginEncounter(current, Date.now());
      commit({ ...statesRef.current, [card.id]: state });
      return {
        selfState: describeStateAsDiary(card, state, context),
        memories: selectImpressionsForPrompt(state)
      };
    },
    [commit]
  );

  // 在收到回复后调用：更新好感度/心情/精力，并并入这回合抽取到的印象。
  const recordCharacterTurn = useCallback(
    (characterId: string, turn: TurnInput & { impressions?: ParsedImpression[] }) => {
      const current = getCharacterState(statesRef.current, characterId);
      const now = Date.now();
      const afterTurn = applyTurn(current, turn);
      const next = mergeImpressions(afterTurn, turn.impressions ?? [], now);
      commit({ ...statesRef.current, [characterId]: next });
    },
    [commit]
  );

  return { states, beginCharacterTurn, recordCharacterTurn } as const;
}
