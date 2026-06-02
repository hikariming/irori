import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  composeDayScriptPrompt,
  defaultDaySkeleton,
  parseDayScript,
  toDateStr,
  type DayScript
} from "./character-schedule";
import type { CharacterState } from "./character-state";
import { desktopBackend } from "./desktop-backend";

function createLifeRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `life-${globalThis.crypto.randomUUID()}`;
  }
  return `life-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 角色的虚拟生活：负责「今天的作息脚本」从无到有的生成（LLM；失败/未接模型用骨架兜底）。
// 推进（执行条目、状态效果、离线回放）放在 useCharacterState.advanceCharacterLife 里，由 App 串起来。
export function useCharacterLife() {
  const [generatingIds, setGeneratingIds] = useState<string[]>([]);
  // 正在生成作息的角色 id，避免并发重复生成。
  const inFlightRef = useRef<Set<string>>(new Set());

  // 确保该角色有「今天」的作息脚本：已有当天的就原样返回；否则生成一份。
  // 返回 DayScript（绝不为 null——兜底骨架保证总有一天可过）。state 已是当天则返回 null 表示「无需更新」。
  const ensureDayScript = useCallback(
    async (card: CharacterCard, state: CharacterState, modelReady: boolean): Promise<DayScript | null> => {
      const today = toDateStr(new Date());
      // 已有今天的脚本就不重生成——除非它只是兜底骨架、而现在模型已就绪，则升级成贴人设的版本。
      if (state.schedule && state.schedule.date === today && !(state.schedule.source === "skeleton" && modelReady)) {
        return null;
      }
      if (inFlightRef.current.has(card.id)) {
        return null;
      }

      inFlightRef.current.add(card.id);
      setGeneratingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
      try {
        const now = Date.now();
        if (!modelReady) {
          return defaultDaySkeleton(card.id, today, now);
        }
        try {
          // 非活跃 runId：不会渲染进聊天。
          const response = await desktopBackend.sendPiPrompt({
            characterId: card.id,
            prompt: "（规划今天的作息）",
            runId: createLifeRunId(),
            sessionPrompt: composeDayScriptPrompt(card, today)
          });
          return parseDayScript(response.text ?? "", card.id, today, now);
        } catch {
          // 生成失败就用骨架，保证虚拟生活不断线。
          return defaultDaySkeleton(card.id, today, now);
        }
      } finally {
        inFlightRef.current.delete(card.id);
        setGeneratingIds((current) => current.filter((id) => id !== card.id));
      }
    },
    []
  );

  return { generatingIds, ensureDayScript } as const;
}
