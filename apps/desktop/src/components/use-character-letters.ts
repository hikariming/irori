import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  composeLetterPrompt,
  composeLetterReplyPrompt,
  parseLetterReply,
  pickDeliverAt,
  shouldWriteLetter,
  type CharacterLetter
} from "./character-letters";
import type { CharacterState, ParsedImpression } from "./character-state";
import { parseCharacterReply } from "./chat-session";
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
  // 用户正在寄信/等角色回信的角色 id（用于禁用按钮、显示「投递中」）。
  const [sendingIds, setSendingIds] = useState<string[]>([]);
  const lettersRef = useRef(letters);
  lettersRef.current = letters;
  // 正在写信的角色 id，避免并发重复写。
  const inFlightRef = useRef<Set<string>>(new Set());

  function prependLetter(letter: CharacterLetter) {
    const next = [letter, ...lettersRef.current];
    lettersRef.current = next;
    setLetters(next);
  }

  // 加载所有角色的信件（启动时调用），用于跨角色统计未读、在侧边栏标红点。
  const loadAllLetters = useCallback(async () => {
    const loaded = await desktopBackend.listCharacterLetters().catch(() => [] as CharacterLetter[]);
    lettersRef.current = loaded;
    setLetters(loaded);
    return loaded;
  }, []);

  // 加载某个角色的信件并合并进现有列表（替换该角色的旧条目，保留其他角色的），
  // 这样切换角色刷新收件箱时不会丢掉别人未读信的红点状态。
  const loadLetters = useCallback(async (characterId: string) => {
    const loaded = await desktopBackend.listCharacterLetters(characterId).catch(() => [] as CharacterLetter[]);
    const others = lettersRef.current.filter((letter) => letter.characterId !== characterId);
    const next = [...loaded, ...others];
    lettersRef.current = next;
    setLetters(next);
    return loaded;
  }, []);

  // 关系够熟、距上次够久、精力够时，让角色写一封信，随机 1~24h 后送达。
  // 传入 recentDialogue 让信接得上你们最近聊的事。返回是否真的写出了一封（供调用方重置节流计数）。
  const maybeWriteLetter = useCallback(
    async (
      card: CharacterCard,
      state: CharacterState,
      recentDialogue?: string,
      currentActivity?: string
    ): Promise<boolean> => {
      if (inFlightRef.current.has(card.id)) {
        return false;
      }

      const now = Date.now();
      // 用「写信时间」做节流，包含还在路上的信，避免连写好几封。
      const lastLetterAt = lettersRef.current
        .filter((letter) => letter.characterId === card.id)
        .reduce<number | null>((latest, letter) => (latest === null ? letter.createdAt : Math.max(latest, letter.createdAt)), null);
      if (!shouldWriteLetter(state, lastLetterAt, now)) {
        return false;
      }

      inFlightRef.current.add(card.id);
      setWritingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
      try {
        // runId 不设为活跃 run：App 的进度/确认监听按 activePromptRunId 过滤，故不会渲染进聊天。
        const response = await desktopBackend.sendPiPrompt({
          characterId: card.id,
          prompt: "（给 ta 写一封信）",
          runId: createLetterRunId(),
          sessionPrompt: composeLetterPrompt(card, state, now, recentDialogue, currentActivity)
        });

        const { subject, body } = parseLetterReply(response.text ?? "");
        if (!body) {
          return false;
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
        return true;
      } catch {
        // 写信是锦上添花，失败就安静跳过。
        return false;
      } finally {
        inFlightRef.current.delete(card.id);
        setWritingIds((current) => current.filter((id) => id !== card.id));
      }
    },
    []
  );

  // 用户主动写信或回信：先即时投递用户这封，再让角色生成一封延迟送达的回信，
  // 并把回信里沉淀的印象交给 onExchange 提升好感度、迭代记忆。
  const sendUserLetter = useCallback(
    async (params: {
      card: CharacterCard;
      state: CharacterState;
      subject: string;
      body: string;
      replyTo?: string | null;
      generateReply?: boolean;
      onExchange?: (input: { userText: string; replyText: string; impressions: ParsedImpression[] }) => void;
    }) => {
      const { card, state, subject, body, replyTo = null, generateReply = false, onExchange } = params;
      const trimmedBody = body.trim();
      if (!trimmedBody) {
        return;
      }
      const trimmedSubject = subject.trim() || "给你的信";
      const now = Date.now();

      // 用户的信即时送达（deliverAt = now），立刻出现在收件箱。
      const userLetter = await desktopBackend.addCharacterLetter({
        characterId: card.id,
        subject: trimmedSubject,
        body: trimmedBody,
        mood: null,
        deliverAt: new Date(now).toISOString(),
        sender: "user",
        replyTo
      });
      prependLetter(userLetter);

      if (!generateReply) {
        return;
      }

      setSendingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
      try {
        const response = await desktopBackend.sendPiPrompt({
          characterId: card.id,
          prompt: "（读用户的信并回信）",
          runId: createLetterRunId(),
          sessionPrompt: composeLetterReplyPrompt(card, state, { subject: trimmedSubject, body: trimmedBody }, now)
        });

        const rawText = response.text ?? "";
        const { impressions } = parseCharacterReply(rawText, []);
        const { subject: replySubject, body: replyBody } = parseLetterReply(rawText);
        if (replyBody) {
          const reply = await desktopBackend.addCharacterLetter({
            characterId: card.id,
            subject: replySubject,
            body: replyBody,
            mood: state.mood,
            deliverAt: new Date(pickDeliverAt(now)).toISOString(),
            sender: "character",
            replyTo: userLetter.id
          });
          prependLetter(reply);
          onExchange?.({ userText: trimmedBody, replyText: replyBody, impressions });
        }
      } finally {
        setSendingIds((current) => current.filter((id) => id !== card.id));
      }
    },
    []
  );

  const markRead = useCallback(async (letterId: string) => {
    const updated = await desktopBackend.markCharacterLetterRead(letterId).catch(() => null);
    if (!updated) {
      return;
    }
    const next = lettersRef.current.map((letter) => (letter.id === updated.id ? updated : letter));
    lettersRef.current = next;
    setLetters(next);
  }, []);

  return {
    letters,
    writingIds,
    sendingIds,
    loadAllLetters,
    loadLetters,
    maybeWriteLetter,
    sendUserLetter,
    markRead
  } as const;
}
