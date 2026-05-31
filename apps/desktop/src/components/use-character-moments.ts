import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import { composeMomentPrompt, parseMomentText, shouldPostMoment, type CharacterMoment } from "./character-moments";
import type { CharacterState } from "./character-state";
import { desktopBackend } from "./desktop-backend";

function createMomentRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `moment-${globalThis.crypto.randomUUID()}`;
  }
  return `moment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 朋友圈/动态流：加载某个角色的历史动态，并在合适时机让它自己发一条新的。
export function useCharacterMoments() {
  const [moments, setMoments] = useState<CharacterMoment[]>([]);
  const [postingIds, setPostingIds] = useState<string[]>([]);
  const momentsRef = useRef(moments);
  momentsRef.current = moments;
  // 正在生成动态的角色 id，避免同一角色并发触发刷屏。
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadMoments = useCallback(async (characterId: string) => {
    const loaded = await desktopBackend.listCharacterMoments(characterId).catch(() => [] as CharacterMoment[]);
    momentsRef.current = loaded;
    setMoments(loaded);
    return loaded;
  }, []);

  // 距上次够久、精力没见底时，让角色用一次性 prompt 写一条动态并落库、前插。
  const maybePostMoment = useCallback(async (card: CharacterCard, state: CharacterState) => {
    if (inFlightRef.current.has(card.id)) {
      return;
    }

    const now = Date.now();
    const lastMomentAt = momentsRef.current.find((moment) => moment.characterId === card.id)?.createdAt ?? null;
    if (!shouldPostMoment(state, lastMomentAt, now)) {
      return;
    }

    inFlightRef.current.add(card.id);
    setPostingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
    try {
      // runId 不设为活跃 run：App 的进度/确认监听会按 activePromptRunId 过滤，故不会渲染进聊天。
      const response = await desktopBackend.sendPiPrompt({
        characterId: card.id,
        prompt: "（写一条此刻的动态）",
        runId: createMomentRunId(),
        sessionPrompt: composeMomentPrompt(card, state, now)
      });

      const text = parseMomentText(response.text ?? "");
      if (!text) {
        return;
      }

      const moment = await desktopBackend.addCharacterMoment({
        characterId: card.id,
        text,
        mood: state.mood
      });
      const next = [moment, ...momentsRef.current];
      momentsRef.current = next;
      setMoments(next);
    } catch {
      // 动态是锦上添花，失败就安静跳过，不打扰用户。
    } finally {
      inFlightRef.current.delete(card.id);
      setPostingIds((current) => current.filter((id) => id !== card.id));
    }
  }, []);

  return { moments, postingIds, loadMoments, maybePostMoment } as const;
}
