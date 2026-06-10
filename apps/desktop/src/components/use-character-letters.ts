import { useCallback, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  chooseKeepsakeKind,
  composeGiftPrompt,
  composeNotePrompt,
  composePostcardPrompt,
  composeReactionReplyPrompt,
  MIN_KEEPSAKE_GAP_MS,
  parseKeepsake,
  pickKeepsakeDeliverAt,
  type CharacterLetter,
  type KeepsakeKind,
  type KeepsakeReaction
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

// 不同信物各自的「角色正在准备」提示文案（仅作 prompt 标签，不进聊天流）。
const keepsakePromptLabel: Record<KeepsakeKind, string> = {
  postcard: "（给 ta 寄一张明信片）",
  note: "（给 ta 留一张便利贴）",
  gift: "（给 ta 寄一件小礼物）"
};

function composeKeepsakePrompt(
  kind: KeepsakeKind,
  card: CharacterCard,
  state: CharacterState,
  now: number,
  recentDialogue?: string,
  currentActivity?: string
): string {
  if (kind === "note") {
    return composeNotePrompt(card, state, now, recentDialogue);
  }
  if (kind === "gift") {
    return composeGiftPrompt(card, state, now, recentDialogue, currentActivity);
  }
  return composePostcardPrompt(card, state, now, recentDialogue, currentActivity);
}

// 信物匣：加载某个角色送来的信物，并在合适时机让它主动送来一件（延迟送达）。
export function useCharacterLetters() {
  const [letters, setLetters] = useState<CharacterLetter[]>([]);
  const [writingIds, setWritingIds] = useState<string[]>([]);
  // 正在让角色回应（生成致意便利贴）的角色 id，用于禁用按钮、显示「正在回应」。
  const [reactingIds, setReactingIds] = useState<string[]>([]);
  const lettersRef = useRef(letters);
  lettersRef.current = letters;
  // 正在生成信物的角色 id，避免并发重复送。
  const inFlightRef = useRef<Set<string>>(new Set());

  function prependLetter(letter: CharacterLetter) {
    const next = [letter, ...lettersRef.current];
    lettersRef.current = next;
    setLetters(next);
  }

  function replaceLetter(letter: CharacterLetter) {
    const next = lettersRef.current.map((entry) => (entry.id === letter.id ? letter : entry));
    lettersRef.current = next;
    setLetters(next);
  }

  // 加载所有角色的信物（启动时调用），用于跨角色统计未读、在侧边栏标红点。
  const loadAllLetters = useCallback(async () => {
    const loaded = await desktopBackend.listCharacterLetters().catch(() => [] as CharacterLetter[]);
    lettersRef.current = loaded;
    setLetters(loaded);
    return loaded;
  }, []);

  // 加载某个角色的信物并合并进现有列表（替换该角色的旧条目，保留其他角色的），
  // 这样切换角色刷新信物匣时不会丢掉别人未读信物的红点状态。
  const loadLetters = useCallback(async (characterId: string) => {
    const loaded = await desktopBackend.listCharacterLetters(characterId).catch(() => [] as CharacterLetter[]);
    const others = lettersRef.current.filter((letter) => letter.characterId !== characterId);
    const next = [...loaded, ...others];
    lettersRef.current = next;
    setLetters(next);
    return loaded;
  }, []);

  // 关系够熟、距上次够久、精力够时，让角色主动送来一件信物（按 kind 随机延迟送达）。
  // 传入 recentDialogue 让信物接得上你们最近聊的事。返回是否真的送出（供调用方重置节流计数）。
  const maybeSendKeepsake = useCallback(
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
      const mine = lettersRef.current.filter(
        (letter) => letter.characterId === card.id && letter.sender === "character"
      );
      // 全局节流：用「生成时间」统计（含还在路上的），避免一次聊天连发好几件。
      const lastAnyAt = mine.reduce<number | null>(
        (latest, letter) => (latest === null ? letter.createdAt : Math.max(latest, letter.createdAt)),
        null
      );
      if (lastAnyAt !== null && now - lastAnyAt < MIN_KEEPSAKE_GAP_MS) {
        return false;
      }
      // 每种信物各自最近一次的生成时间，用于 per-kind 冷却。
      const lastByKind: Partial<Record<KeepsakeKind, number>> = {};
      for (const letter of mine) {
        const prev = lastByKind[letter.kind];
        if (prev === undefined || letter.createdAt > prev) {
          lastByKind[letter.kind] = letter.createdAt;
        }
      }

      const kind = chooseKeepsakeKind(state, lastByKind, now);
      if (!kind) {
        return false;
      }

      inFlightRef.current.add(card.id);
      setWritingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
      try {
        // runId 不设为活跃 run：App 的进度/确认监听按 activePromptRunId 过滤，故不会渲染进聊天。
        const response = await desktopBackend.sendPiPrompt({
          characterId: card.id,
          prompt: keepsakePromptLabel[kind],
          runId: createLetterRunId(),
          sessionPrompt: composeKeepsakePrompt(kind, card, state, now, recentDialogue, currentActivity)
        });

        const { subject, body, meta } = parseKeepsake(kind, response.text ?? "");
        if (!body) {
          return false;
        }

        const letter = await desktopBackend.addCharacterLetter({
          characterId: card.id,
          subject,
          body,
          mood: state.mood,
          deliverAt: new Date(pickKeepsakeDeliverAt(kind, now)).toISOString(),
          kind,
          meta
        });
        prependLetter(letter);
        return true;
      } catch {
        // 送信物是锦上添花，失败就安静跳过。
        return false;
      } finally {
        inFlightRef.current.delete(card.id);
        setWritingIds((current) => current.filter((id) => id !== card.id));
      }
    },
    []
  );

  // 用户对一件信物点表情 / 回一句：写入回应（后端同时标记已读），把这次互动交给
  // onExchange 提好感度、迭代记忆；并有一定概率让角色延迟回一张致意便利贴。
  const reactToKeepsake = useCallback(
    async (params: {
      card: CharacterCard;
      state: CharacterState;
      letter: CharacterLetter;
      reaction: KeepsakeReaction;
      generateReply?: boolean;
      onExchange?: (input: { userText: string; replyText: string; impressions: ParsedImpression[] }) => void;
      random?: () => number;
    }) => {
      const { card, state, letter, reaction, generateReply = true, onExchange, random = Math.random } = params;

      const updated = await desktopBackend.setCharacterLetterReaction(letter.id, reaction).catch(() => null);
      if (updated) {
        replaceLetter(updated);
      }

      // 喂给好感/记忆管线的「用户侧文本」：优先用户写的话，纯表情则兜底成一句参与描述。
      const userText = reaction.text?.trim() || `（给你的${kindLabel(letter.kind)}点了 ${reaction.emoji ?? "♡"}）`;

      // 写了字更可能换来一句回应；纯表情概率低一些。模型没就绪时只记好感、不生成回应。
      const replyChance = reaction.text?.trim() ? 0.7 : 0.3;
      if (!generateReply || random() >= replyChance) {
        onExchange?.({ userText, replyText: "", impressions: [] });
        return;
      }

      setReactingIds((current) => (current.includes(card.id) ? current : [...current, card.id]));
      try {
        const deliverAt = pickKeepsakeDeliverAt("note", Date.now());
        const response = await desktopBackend.sendPiPrompt({
          characterId: card.id,
          prompt: "（回应 ta 的心意）",
          runId: createLetterRunId(),
          sessionPrompt: composeReactionReplyPrompt(
            card,
            state,
            { kind: letter.kind, subject: letter.subject, body: letter.body },
            reaction
          )
        });

        const rawText = response.text ?? "";
        const { impressions } = parseCharacterReply(rawText, []);
        const { body } = parseKeepsake("note", rawText);
        if (body) {
          const replyNote = await desktopBackend.addCharacterLetter({
            characterId: card.id,
            subject: "便利贴",
            body,
            mood: state.mood,
            deliverAt: new Date(deliverAt).toISOString(),
            sender: "character",
            replyTo: letter.id,
            kind: "note"
          });
          prependLetter(replyNote);
          onExchange?.({ userText, replyText: body, impressions });
        } else {
          onExchange?.({ userText, replyText: "", impressions });
        }
      } catch {
        // 生成致意失败（模型出错等）不影响回应本身：好感仍记一笔。
        onExchange?.({ userText, replyText: "", impressions: [] });
      } finally {
        setReactingIds((current) => current.filter((id) => id !== card.id));
      }
    },
    []
  );

  const markRead = useCallback(async (letterId: string) => {
    const updated = await desktopBackend.markCharacterLetterRead(letterId).catch(() => null);
    if (!updated) {
      return;
    }
    replaceLetter(updated);
  }, []);

  return {
    letters,
    writingIds,
    reactingIds,
    loadAllLetters,
    loadLetters,
    maybeSendKeepsake,
    reactToKeepsake,
    markRead
  } as const;
}

function kindLabel(kind: KeepsakeKind): string {
  return kind === "postcard" ? "明信片" : kind === "gift" ? "小礼物" : "便利贴";
}
