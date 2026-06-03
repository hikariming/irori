import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import { composeMomentPrompt, parseMomentText, shouldPostMoment, type CharacterMoment, type MomentActorRef } from "./character-moments";
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

  function replaceMoment(updated: CharacterMoment) {
    const next = momentsRef.current.map((moment) => (moment.id === updated.id ? updated : moment));
    momentsRef.current = next;
    setMoments(next);
  }

  const loadMoments = useCallback(async (characterId: string) => {
    const loaded = await desktopBackend.listCharacterMoments(characterId).catch(() => [] as CharacterMoment[]);
    momentsRef.current = loaded;
    setMoments(loaded);
    return loaded;
  }, []);

  // 加载所有角色的动态，按时间倒序汇成一条「大家住在一起」的共享时间线。
  const loadAllMoments = useCallback(async () => {
    const loaded = await desktopBackend.listCharacterMoments().catch(() => [] as CharacterMoment[]);
    momentsRef.current = loaded;
    setMoments(loaded);
    return loaded;
  }, []);

  // 内部：生成并落库一条动态（around 当前活动 activity 写），前插到流里。返回是否成功。
  const composeAndPost = useCallback(async (card: CharacterCard, state: CharacterState, activity?: string) => {
    if (inFlightRef.current.has(card.id)) {
      return false;
    }
    inFlightRef.current.add(card.id);
    setPostingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
    try {
      const now = Date.now();
      // runId 不设为活跃 run：App 的进度/确认监听会按 activePromptRunId 过滤，故不会渲染进聊天。
      const response = await desktopBackend.sendPiPrompt({
        characterId: card.id,
        prompt: "（写一条此刻的动态）",
        runId: createMomentRunId(),
        sessionPrompt: composeMomentPrompt(card, state, now, activity)
      });

      const text = parseMomentText(response.text ?? "");
      if (!text) {
        return false;
      }

      const moment = await desktopBackend.addCharacterMoment({
        characterId: card.id,
        text
      });
      const next = [moment, ...momentsRef.current];
      momentsRef.current = next;
      setMoments(next);
      return true;
    } catch {
      // 动态是锦上添花，失败就安静跳过，不打扰用户。
      return false;
    } finally {
      inFlightRef.current.delete(card.id);
      setPostingIds((current) => current.filter((id) => id !== card.id));
    }
  }, []);

  // 距上次够久、精力没见底时，让角色围绕「此刻在做的事」(activity，来自作息脚本) 发一条动态。
  const maybePostMoment = useCallback(
    async (card: CharacterCard, state: CharacterState, activity?: string) => {
      const now = Date.now();
      const lastMomentAt = momentsRef.current.find((moment) => moment.characterId === card.id)?.createdAt ?? null;
      if (!shouldPostMoment(state, lastMomentAt, now)) {
        return;
      }
      await composeAndPost(card, state, activity);
    },
    [composeAndPost]
  );

  // 离线回放：你不在时角色「做过」的某件事，补发一条动态（绕过频率闸，由 App 控制次数）。
  const postCatchupMoment = useCallback(
    async (card: CharacterCard, state: CharacterState, activity: string) => composeAndPost(card, state, activity),
    [composeAndPost]
  );

  const toggleMomentLike = useCallback(async (momentId: string, actor: MomentActorRef, liked: boolean) => {
    const updated = await desktopBackend.toggleCharacterMomentLike({
      momentId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      liked
    });
    replaceMoment(updated);
    return updated;
  }, []);

  const addMomentComment = useCallback(async (momentId: string, actor: MomentActorRef, text: string) => {
    const updated = await desktopBackend.addCharacterMomentComment({
      momentId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      text
    });
    replaceMoment(updated);
    return updated;
  }, []);

  return { moments, postingIds, loadMoments, loadAllMoments, maybePostMoment, postCatchupMoment, toggleMomentLike, addMomentComment } as const;
}
