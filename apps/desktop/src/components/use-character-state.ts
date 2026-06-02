import { useCallback, useEffect, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  applyScheduleEffects,
  applyTurn,
  beginEncounter,
  describeStateAsDiary,
  getCharacterState,
  loadCharacterStates as loadLegacyCharacterStates,
  mergeImpressions,
  selectImpressionsForPrompt,
  type CharacterState,
  type CharacterStates,
  type ParsedImpression,
  type TurnInput
} from "./character-state";
import {
  markExecutedUpTo,
  minutesOfDay,
  toDateStr,
  type DayScript,
  type ScheduleItem
} from "./character-schedule";
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
  // 返回更新后的角色状态，便于调用方（如后台写信触发）基于最新好感度判断。
  const recordCharacterTurn = useCallback(
    (characterId: string, turn: TurnInput & { impressions?: ParsedImpression[] }): CharacterState => {
      const current = getCharacterState(statesRef.current, characterId);
      const now = Date.now();
      const afterTurn = applyTurn(current, turn);
      const next = mergeImpressions(afterTurn, turn.impressions ?? [], now);
      commit({ ...statesRef.current, [characterId]: next });
      return next;
    },
    [commit]
  );

  // 落库当天的作息脚本（生成 / 重生成后调用）。返回更新后的状态。
  const setCharacterSchedule = useCallback(
    (characterId: string, schedule: DayScript | null): CharacterState => {
      const current = getCharacterState(statesRef.current, characterId);
      const next = { ...current, schedule };
      commit({ ...statesRef.current, [characterId]: next });
      return next;
    },
    [commit]
  );

  // 推进虚拟生活到 now：把已到点的作息条目标记 executed、把它们的精力/心情效果落到状态上、
  // 记录本次推进时间。返回更新后的状态与「这次新执行的条目」（供离线回放补动态）。
  const advanceCharacterLife = useCallback(
    (characterId: string, now: number): { state: CharacterState; newlyExecuted: ScheduleItem[] } => {
      const current = getCharacterState(statesRef.current, characterId);
      if (!current.schedule || current.schedule.date !== toDateStr(new Date(now))) {
        return { state: current, newlyExecuted: [] };
      }
      const { script, newlyExecuted } = markExecutedUpTo(current.schedule, minutesOfDay(new Date(now)));
      const next = applyScheduleEffects({ ...current, schedule: script, lastLifeTickAt: now }, newlyExecuted);
      commit({ ...statesRef.current, [characterId]: next });
      return { state: next, newlyExecuted };
    },
    [commit]
  );

  return {
    states,
    beginCharacterTurn,
    recordCharacterTurn,
    setCharacterSchedule,
    advanceCharacterLife
  } as const;
}
