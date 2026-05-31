import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  composeLetterPrompt,
  parseLetterReply,
  pickDeliverAt,
  shouldWriteLetter,
  type CharacterLetter
} from "./character-letters";
import type { CharacterState } from "./character-state";
import { desktopBackend } from "./desktop-backend";

function createLetterRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `letter-${globalThis.crypto.randomUUID()}`;
  }
  return `letter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 信件收件箱：加载某个角色写来的信，并在合适时机让它自己写一封（延迟送达）。
export function useCharacterLetters() {
  const [letters, setLetters] = useState<CharacterLetter[]>([]);
  const [writingIds, setWritingIds] = useState<string[]>([]);
  const lettersRef = useRef(letters);
  lettersRef.current = letters;
  // 正在写信的角色 id，避免并发重复写。
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadLetters = useCallback(async (characterId: string) => {
    const loaded = await desktopBackend.listCharacterLetters(characterId).catch(() => [] as CharacterLetter[]);
    lettersRef.current = loaded;
    setLetters(loaded);
    return loaded;
  }, []);

  // 关系够熟、距上次够久、精力够时，让角色写一封信，随机 1~24h 后送达。
  const maybeWriteLetter = useCallback(async (card: CharacterCard, state: CharacterState) => {
    if (inFlightRef.current.has(card.id)) {
      return;
    }

    const now = Date.now();
    // 用「写信时间」做节流，包含还在路上的信，避免连写好几封。
    const lastLetterAt = lettersRef.current
      .filter((letter) => letter.characterId === card.id)
      .reduce<number | null>((latest, letter) => (latest === null ? letter.createdAt : Math.max(latest, letter.createdAt)), null);
    if (!shouldWriteLetter(state, lastLetterAt, now)) {
      return;
    }

    inFlightRef.current.add(card.id);
    setWritingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
    try {
      // runId 不设为活跃 run：App 的进度/确认监听按 activePromptRunId 过滤，故不会渲染进聊天。
      const response = await desktopBackend.sendPiPrompt({
        characterId: card.id,
        prompt: "（给 ta 写一封信）",
        runId: createLetterRunId(),
        sessionPrompt: composeLetterPrompt(card, state, now)
      });

      const { subject, body } = parseLetterReply(response.text ?? "");
      if (!body) {
        return;
      }

      const letter = await desktopBackend.addCharacterLetter({
        characterId: card.id,
        subject,
        body,
        mood: state.mood,
        deliverAt: new Date(pickDeliverAt(now)).toISOString()
      });
      const next = [letter, ...lettersRef.current];
      lettersRef.current = next;
      setLetters(next);
    } catch {
      // 写信是锦上添花，失败就安静跳过。
    } finally {
      inFlightRef.current.delete(card.id);
      setWritingIds((current) => current.filter((id) => id !== card.id));
    }
  }, []);

  const markRead = useCallback(async (letterId: string) => {
    const updated = await desktopBackend.markCharacterLetterRead(letterId).catch(() => null);
    if (!updated) {
      return;
    }
    const next = lettersRef.current.map((letter) => (letter.id === updated.id ? updated : letter));
    lettersRef.current = next;
    setLetters(next);
  }, []);

  return { letters, writingIds, loadLetters, maybeWriteLetter, markRead } as const;
}
