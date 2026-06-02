import { useEffect, useMemo, useRef, useState } from "react";

import { CompanionChat } from "./components/CompanionChat";
import { CompanionInput } from "./components/CompanionInput";
import { CompanionLetters } from "./components/CompanionLetters";
import { CompanionMomentsFeed } from "./components/CompanionMomentsFeed";
import { CompanionSidebar } from "./components/CompanionSidebar";
import {
  isDelivered,
  shouldTryLetterAfterChat,
  summarizeRecentDialogue,
  type DialogueTurn
} from "./components/character-letters";
import { SystemSettingsPanel } from "./components/SystemSettingsPanel";
import { desktopBackend } from "./components/desktop-backend";
import { formatUnknownError } from "./components/error-message";
import { type ChatMessage } from "./components/chat-model";
import {
  buildCharacterAuthors,
  buildCharacterChatPreview,
  findCharacterCard,
  loadCharacterCards,
  type CharacterCard
} from "./components/character-cards";
import {
  createAssistantProgress,
  nextTypewriterText,
  removeAssistantStreamMessage,
  reduceAssistantProgress,
  replaceAssistantStreamMessage,
  upsertAssistantStreamMessage,
  type AssistantProgress,
  type PiToolConfirmRequest
} from "./components/assistant-progress-model";
import {
  canStartNewDraftSession,
  createSessionTitle,
  findLatestCharacterSession,
  groupChatSessions,
  type ChatSessionSummary
} from "./components/chat-history-model";
import { composeCharacterSessionPrompt, parseCharacterReply } from "./components/chat-session";
import {
  buildInitialModelSettings,
  getActiveModelProfile,
  isModelConfigured,
  type ModelSettingsState
} from "./components/model-settings-controller";
import {
  appendMemoryDebugEvent,
  createMemoryDebugEventFromRun,
  type MemoryDebugEvent,
  type MemoryRunSnapshot
} from "./components/memory-status-model";
import { buildSidebarCharacters } from "./components/sidebar-model";
import {
  buildCharacterStateView,
  currentActivityPhrase,
  getCharacterState,
  type CharacterState
} from "./components/character-state";
import { scheduleItemPhrase, type ScheduleItem } from "./components/character-schedule";
import { useCharacterLetters } from "./components/use-character-letters";
import { useCharacterLife } from "./components/use-character-life";
import { useCharacterMoments } from "./components/use-character-moments";
import { useCharacterPreferences } from "./components/use-character-preferences";
import { useCharacterState } from "./components/use-character-state";
import { useTheme } from "./components/use-theme";

function messageTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}


function createPromptRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `prompt-${globalThis.crypto.randomUUID()}`;
  }

  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 离线回放阈值：距上次推进作息超过这么久，才把这期间「做过的事」补一条动态。
const LIFE_CATCHUP_GAP_MS = 90 * 60 * 1000;
// 这些类别（睡觉/休息）就算执行了也不值得补动态。
const CATCHUP_SKIP_CATEGORIES = new Set(["sleep", "rest"]);

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { preferences: characterPreferences, updatePreference: updateCharacterPreference } = useCharacterPreferences();
  const { states: characterStates, beginCharacterTurn, recordCharacterTurn, setCharacterSchedule, advanceCharacterLife } =
    useCharacterState();
  const { ensureDayScript } = useCharacterLife();
  const { moments, postingIds, loadAllMoments, maybePostMoment, postCatchupMoment } = useCharacterMoments();
  const { letters, writingIds, sendingIds, loadAllLetters, maybeWriteLetter, sendUserLetter, markRead } =
    useCharacterLetters();
  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState("shili");
  const [viewMode, setViewMode] = useState<"chat" | "feed" | "letters">("chat");
  const [isCharacterOpen, setIsCharacterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [assistantProgress, setAssistantProgress] = useState<AssistantProgress | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PiToolConfirmRequest | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const [memoryDebugEvents, setMemoryDebugEvents] = useState<MemoryDebugEvent[]>([]);
  const [latestMemoryRun, setLatestMemoryRun] = useState<MemoryRunSnapshot | null>(null);
  const [isNewDraftSessionPending, setIsNewDraftSessionPending] = useState(false);
  // 每分钟走一格，让「在路上」的信到点后自动翻成已送达、点亮侧边栏红点。
  const [letterClock, setLetterClock] = useState(() => Date.now());
  const activeAnswerTextRef = useRef("");
  const activeReasoningTextRef = useRef("");
  const activeDisplayedAnswerTextRef = useRef("");
  const activeAssistantStreamMessageIdRef = useRef<string | null>(null);
  const activeAssistantStreamTimeRef = useRef("");
  const activePromptRunIdRef = useRef<string | null>(null);
  const activePromptCharacterNameRef = useRef("");
  const activeTypewriterResolveRef = useRef<(() => void) | null>(null);
  const activeTypewriterTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const newDraftSessionLockRef = useRef(false);
  const initialSessionLoadedRef = useRef(false);
  // 每个角色「距上次写信聊了几回合 + 最近几回合对话」，用于聊够后在后台偷偷写信。
  const letterChatTrackerRef = useRef<Map<string, { turnsSinceLetter: number; recent: DialogueTurn[] }>>(new Map());
  // 正在跑生活推进的角色 id，避免并发重复生成 / 推进。
  const lifeCycleInFlightRef = useRef<Set<string>>(new Set());
  const modelReady = isModelConfigured(modelSettings);
  const activeModelProfile = getActiveModelProfile(modelSettings);
  const groupedSessions = groupChatSessions(chatSessions, { activeSessionId });
  const canStartNewSession = canStartNewDraftSession({
    activeSessionId,
    isDraftPending: isNewDraftSessionPending,
    isSending
  });
  const activeCard = findCharacterCard(cards, activeCharacterId) ?? cards[0] ?? null;
  const activeCharacter = activeCard ? buildCharacterChatPreview(activeCard) : null;
  // 每个角色「已送达但未读」的来信数（用户自己寄出的不算），驱动侧边栏红点。
  const unreadLettersByCharacter = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const letter of letters) {
      if (letter.sender === "character" && letter.readAt === null && isDelivered(letter, letterClock)) {
        counts[letter.characterId] = (counts[letter.characterId] ?? 0) + 1;
      }
    }
    return counts;
  }, [letters, letterClock]);
  const activityByCharacter = useMemo(() => {
    const activities: Record<string, string> = {};
    for (const card of cards) {
      const activity = currentActivityPhrase(getCharacterState(characterStates, card.id), letterClock);
      if (activity) {
        activities[card.id] = activity;
      }
    }
    return activities;
  }, [cards, characterStates, letterClock]);
  const stateSummaryByCharacter = useMemo(() => {
    const summaries: Record<string, ReturnType<typeof buildCharacterStateView>> = {};
    for (const card of cards) {
      summaries[card.id] = buildCharacterStateView(getCharacterState(characterStates, card.id));
    }
    return summaries;
  }, [cards, characterStates]);
  const sidebarCharacters = buildSidebarCharacters(
    cards,
    activeCard?.id ?? activeCharacterId,
    characterPreferences,
    unreadLettersByCharacter,
    activityByCharacter,
    stateSummaryByCharacter
  );
  // 「动态」和「信件」合成一个「生活圈」页面，靠上方 tab 切换；聊天区只保留聊天本身。
  const isLifeView = viewMode === "feed" || viewMode === "letters";
  // 角色 id → 头像/名字，给聚合的生活圈按发件人区分（大家住在一起）。
  const characterAuthors = useMemo(() => buildCharacterAuthors(cards), [cards]);
  // 所有角色未读来信总数，给侧边栏「生活圈」入口点红点。
  const totalUnreadLetters = useMemo(
    () => Object.values(unreadLettersByCharacter).reduce((sum, count) => sum + count, 0),
    [unreadLettersByCharacter]
  );

  // 进入「生活圈」：默认落在「动态」tab（已在生活圈则保持当前子 tab）。
  function openLifeCircle() {
    setIsSettingsOpen(false);
    setIsCharacterOpen(false);
    setViewMode((current) => (current === "letters" ? "letters" : "feed"));
  }

  // 推进某个角色的「虚拟生活」：确保有今天的作息脚本 → 推进到此刻（执行条目、落状态效果）
  // →（可选）离线回放：你不在时她做过的事补一条动态。catchupSkipCategories 里的（睡觉/休息）不补。
  async function runLifeCycle(card: CharacterCard, options?: { allowCatchupMoment?: boolean }) {
    if (lifeCycleInFlightRef.current.has(card.id)) {
      return;
    }
    lifeCycleInFlightRef.current.add(card.id);
    try {
      const before = getCharacterState(characterStates, card.id);
      const lastTick = before.lastLifeTickAt;

      const schedule = await ensureDayScript(card, before, modelReady);
      if (schedule) {
        setCharacterSchedule(card.id, schedule);
      }

      const { state, newlyExecuted } = advanceCharacterLife(card.id, Date.now());

      if (
        options?.allowCatchupMoment &&
        modelReady &&
        lastTick > 0 &&
        Date.now() - lastTick >= LIFE_CATCHUP_GAP_MS
      ) {
        const interesting = newlyExecuted.filter((item: ScheduleItem) => !CATCHUP_SKIP_CATEGORIES.has(item.category));
        const pick = interesting[interesting.length - 1];
        if (pick) {
          // 她在你不在时做过的事 → 补一条动态（限当次一条）。
          void postCatchupMoment(card, state, scheduleItemPhrase(pick));
        }
      }
    } finally {
      lifeCycleInFlightRef.current.delete(card.id);
    }
  }

  function showInitialMessages() {
    setMessages([]);
  }

  // 一回合聊完后调用：累计对话、攒够轮数就在后台「偷偷」让角色写封信（延迟送达制造惊喜）。
  // 不 await、不进聊天流；真正的关系/精力/节流门槛仍由 maybeWriteLetter 内部把关。
  function trackChatTurnForLetter(card: CharacterCard, state: CharacterState, userText: string, replyText: string) {
    const tracker = letterChatTrackerRef.current;
    const entry = tracker.get(card.id) ?? { turnsSinceLetter: 0, recent: [] as DialogueTurn[] };
    entry.turnsSinceLetter += 1;
    entry.recent.push({ user: userText, reply: replyText });
    if (entry.recent.length > 8) {
      entry.recent.shift();
    }
    tracker.set(card.id, entry);

    if (!modelReady || !shouldTryLetterAfterChat(entry.turnsSinceLetter)) {
      return;
    }

    const recentDialogue = summarizeRecentDialogue(entry.recent);
    const activity = currentActivityPhrase(state, Date.now()) ?? undefined;
    void maybeWriteLetter(card, state, recentDialogue, activity).then((wrote) => {
      if (wrote) {
        // 写成功才重置计数，下一封要重新聊够轮数；失败则保留，留待后续回合再试。
        entry.turnsSinceLetter = 0;
      }
    });
  }

  function clearAssistantTypewriterTimer() {
    if (activeTypewriterTimerRef.current !== null) {
      window.clearTimeout(activeTypewriterTimerRef.current);
      activeTypewriterTimerRef.current = null;
    }
  }

  function resolveAssistantTypewriterIfSettled() {
    if (activeDisplayedAnswerTextRef.current !== activeAnswerTextRef.current) {
      return;
    }

    activeTypewriterResolveRef.current?.();
    activeTypewriterResolveRef.current = null;
  }

  function renderAssistantStreamText(text: string) {
    const streamMessageId = activeAssistantStreamMessageIdRef.current;

    if (!streamMessageId || !text.trim()) {
      return;
    }

    setMessages((current) =>
      upsertAssistantStreamMessage(current, {
        id: streamMessageId,
        author: activePromptCharacterNameRef.current || "本地 agent",
        text,
        time: activeAssistantStreamTimeRef.current || messageTime()
      })
    );
  }

  function runAssistantTypewriterTick() {
    activeTypewriterTimerRef.current = null;

    const target = activeAnswerTextRef.current;
    const nextText = nextTypewriterText(activeDisplayedAnswerTextRef.current, target);
    activeDisplayedAnswerTextRef.current = nextText;
    renderAssistantStreamText(nextText);

    if (nextText !== target) {
      scheduleAssistantTypewriter();
      return;
    }

    resolveAssistantTypewriterIfSettled();
  }

  function scheduleAssistantTypewriter() {
    if (activeTypewriterTimerRef.current !== null) {
      return;
    }

    activeTypewriterTimerRef.current = window.setTimeout(runAssistantTypewriterTick, 18);
  }

  function setAssistantTypewriterTarget(text: string) {
    activeAnswerTextRef.current = text;
    scheduleAssistantTypewriter();
  }

  function revealAssistantText(text: string) {
    setAssistantTypewriterTarget(text);

    if (activeDisplayedAnswerTextRef.current === activeAnswerTextRef.current) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      activeTypewriterResolveRef.current = resolve;
    });
  }

  useEffect(() => () => {
    clearAssistantTypewriterTimer();
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadCharacterCards()
      .then((loaded) => {
        if (isMounted) {
          setCards(loaded);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCards([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    desktopBackend.loadModelSettings()
      .then((settings) => {
        if (isMounted) {
          setModelSettings(settings);
        }
      })
      .catch(() => {
        if (isMounted) {
          setModelSettings(buildInitialModelSettings());
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    desktopBackend.onPiPromptProgress((event) => {
      if (event.runId !== activePromptRunIdRef.current) {
        return;
      }

      if (event.phase === "thinking") {
        activeReasoningTextRef.current = event.text ?? `${activeReasoningTextRef.current}${event.delta ?? ""}`;
      }

      if (event.phase === "answering" && (event.delta || event.text !== undefined)) {
        const nextTarget = event.text ?? `${activeAnswerTextRef.current}${event.delta ?? ""}`;
        activeAssistantStreamMessageIdRef.current = activeAssistantStreamMessageIdRef.current ?? `assistant-stream-${event.runId}`;
        setAssistantTypewriterTarget(nextTarget);
      }

      setAssistantProgress((current) => current ? reduceAssistantProgress(current, event) : current);
    })
      .then((nextUnlisten) => {
        if (isMounted) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch(() => {
        // Progress is best-effort; the final response still arrives through the command result.
      });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    desktopBackend.onPiToolConfirm((request) => {
      if (request.runId !== activePromptRunIdRef.current) {
        // The run that asked has already ended; let it fall back to a block.
        return;
      }

      setPendingConfirm(request);
    })
      .then((nextUnlisten) => {
        if (isMounted) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch(() => {
        // Confirm prompts are best-effort; without them the run blocks safely.
      });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (cards.length === 0 || initialSessionLoadedRef.current) {
      return;
    }

    initialSessionLoadedRef.current = true;
    let isMounted = true;

    async function loadInitialSession() {
      try {
        const sessions = await desktopBackend.listChatSessions();

        if (!isMounted) {
          return;
        }

        setChatSessions(sessions);

        if (sessions.length === 0) {
          setActiveSessionId(null);
          showInitialMessages();
          return;
        }

        const detail = await desktopBackend.getChatSession(sessions[0].id);

        if (isMounted) {
          setActiveSessionId(detail.session.id);
          if (findCharacterCard(cards, detail.session.characterId)) {
            setActiveCharacterId(detail.session.characterId);
          }
          if (detail.messages.length === 0) {
            showInitialMessages();
          } else {
            setMessages(detail.messages);
          }
        }
      } catch (error) {
        if (isMounted) {
          setActiveSessionId(null);
          setMessages([
            {
              id: `history-load-error-${Date.now()}`,
              speaker: "system",
              author: "本地历史",
              text: formatUnknownError(error, "聊天历史加载失败，本次会话会先作为临时对话显示。"),
              time: messageTime()
            }
          ]);
        }
      }
    }

    loadInitialSession();

    return () => {
      isMounted = false;
    };
  }, [cards]);

  useEffect(() => {
    if (activeSessionId !== null) {
      newDraftSessionLockRef.current = false;
      setIsNewDraftSessionPending(false);
    }
  }, [activeSessionId]);

  // 打开生活圈动态时，加载所有角色的动态汇成共享时间线；并让当前角色在合适时机发一条新的。
  useEffect(() => {
    if (viewMode !== "feed" || !activeCard) {
      return;
    }

    const card = activeCard;
    let cancelled = false;

    (async () => {
      await loadAllMoments();
      if (cancelled || !modelReady) {
        return;
      }
      // 先推进虚拟生活（确保今天有作息、推进到此刻），动态就围绕「她此刻在做的事」来发。
      await runLifeCycle(card);
      if (cancelled) {
        return;
      }
      const state = getCharacterState(characterStates, card.id);
      await maybePostMoment(card, state, currentActivityPhrase(state, Date.now()) ?? undefined);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeCard?.id, modelReady]);

  // 启动后加载所有角色的历史信件，统计未读、在侧边栏点亮红点。
  useEffect(() => {
    void loadAllLetters();
  }, [loadAllLetters]);

  // 每分钟推进一次时钟，让到点的「在路上」信件自动变为已送达并点亮红点；
  // 顺便推进当前角色的虚拟生活（纯本地、不调模型），让「此刻在干嘛」与精力/心情随作息走。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLetterClock(Date.now());
      if (activeCard) {
        advanceCharacterLife(activeCard.id, Date.now());
      }
    }, 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id, advanceCharacterLife]);

  // 切到某个角色 / 模型就绪时，推进 ta 的虚拟生活：生成今天的作息、推进到此刻，
  // 若你离开了一阵子（lastLifeTickAt 很久前），就把这期间 ta 做过的事补一条动态。
  useEffect(() => {
    if (!activeCard) {
      return;
    }
    void runLifeCycle(activeCard, { allowCatchupMoment: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id, modelReady]);

  // 打开生活圈信箱时，加载所有角色的信汇成一个统一收件箱。写信不在这里触发——而是聊够轮数后
  // 在后台偷偷写，这样信是「聊出来的惊喜」，而不是「点开信箱凭空多一封」。
  useEffect(() => {
    if (viewMode !== "letters") {
      return;
    }
    void loadAllLetters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  async function refreshChatSessions(nextActiveSessionId: string | null = activeSessionId) {
    const sessions = await desktopBackend.listChatSessions();
    setChatSessions(sessions);

    if (nextActiveSessionId !== activeSessionId) {
      setActiveSessionId(nextActiveSessionId);
    }
  }

  async function loadChatSession(sessionId: string) {
    if (sessionId === activeSessionId || isSending) {
      return;
    }

    try {
      const detail = await desktopBackend.getChatSession(sessionId);
      setActiveSessionId(detail.session.id);
      if (findCharacterCard(cards, detail.session.characterId)) {
        setActiveCharacterId(detail.session.characterId);
      }
      if (detail.messages.length === 0) {
        showInitialMessages();
      } else {
        setMessages(detail.messages);
      }
      setIsCharacterOpen(false);
      setIsSettingsOpen(false);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `history-switch-error-${Date.now()}`,
          speaker: "system",
          author: "本地历史",
          text: formatUnknownError(error, "对话历史加载失败。"),
          time: messageTime()
        }
      ]);
    }
  }

  async function sendPrompt(draft: string) {
    const prompt = draft.trim();

    if (!prompt || isSending || !modelReady || !activeCard) {
      if (prompt && !modelReady) {
        setMessages((current) => [
          ...current,
          {
            id: `model-missing-${Date.now()}`,
            speaker: "system",
            author: "模型接入",
            text: activeModelProfile
              ? `当前模型「${activeModelProfile.name}」还不可用。请先点左下角设置，填写 Base URL、Token 和模型名。`
              : "还没有可用模型。请先点左下角设置，添加一个模型配置档案。",
            time: messageTime()
          }
        ]);
        setIsSettingsOpen(true);
      }
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      speaker: "user",
      author: "你",
      text: prompt,
      time: messageTime()
    };
    const card = activeCard;
    const runId = createPromptRunId();

    setMessages((current) => [...current, userMessage]);
    clearAssistantTypewriterTimer();
    activeAnswerTextRef.current = "";
    activeReasoningTextRef.current = "";
    activeDisplayedAnswerTextRef.current = "";
    activeAssistantStreamMessageIdRef.current = `assistant-stream-${runId}`;
    activeAssistantStreamTimeRef.current = messageTime();
    activePromptCharacterNameRef.current = card.name;
    activeTypewriterResolveRef.current = null;
    activePromptRunIdRef.current = runId;
    setAssistantProgress(createAssistantProgress(runId));
    setPendingConfirm(null);
    setIsSending(true);

    let sessionIdForRun = activeSessionId;

    try {
      const sessionId = activeSessionId ?? (await desktopBackend.createChatSession({
        characterId: card.id,
        title: createSessionTitle(prompt)
      })).id;
      sessionIdForRun = sessionId;
      const persistedUserMessage = await desktopBackend.appendChatMessage({
        sessionId,
        speaker: userMessage.speaker,
        author: userMessage.author,
        text: userMessage.text
      });
      const promptHistory = activeSessionId ? messages : [];
      const { selfState, memories } = beginCharacterTurn(card);
      const sessionPrompt = composeCharacterSessionPrompt({
        card,
        history: promptHistory,
        userPrompt: prompt,
        selfState,
        memories
      });

      setActiveSessionId(sessionId);
      setMessages((current) =>
        current.map((message) => message.id === userMessage.id ? persistedUserMessage : message)
      );

      const response = await desktopBackend.sendPiPrompt({
        characterId: card.id,
        prompt,
        runId,
        sessionId,
        sessionPrompt
      });
      const memoryRun = {
        memoryBackendSource: response.memoryBackendSource,
        recalledMemories: response.recalledMemories
      };
      setLatestMemoryRun(memoryRun);
      setMemoryDebugEvents((current) =>
        appendMemoryDebugEvent(current, createMemoryDebugEventFromRun({ run: memoryRun }))
      );
      if (!response.text.trim()) {
        throw new Error("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。");
      }
      const parsedReply = parseCharacterReply(response.text, card.stickers);
      const replyText = parsedReply.text || `已通过 ${response.modelRoute} 完成这次 Pi session。`;
      const stateAfterTurn = recordCharacterTurn(card.id, { userText: prompt, replyText, impressions: parsedReply.impressions });
      // 聊够轮数后在后台偷偷写信（延迟 1~24h 送达）；失败静默，不影响这次聊天。
      trackChatTurnForLetter(card, stateAfterTurn, prompt, replyText);
      await revealAssistantText(replyText);
      const assistantMessage = await desktopBackend.appendChatMessage({
        sessionId,
        speaker: "character",
        author: card.name,
        text: replyText,
        stickerId: parsedReply.sticker?.id,
        modelRoute: response.modelRoute,
        providerId: response.providerId
      });

      const reasoningText = activeReasoningTextRef.current.trim();
      const assistantMessageWithReasoning = reasoningText
        ? { ...assistantMessage, reasoning: reasoningText }
        : assistantMessage;
      const streamMessageId = activeAssistantStreamMessageIdRef.current;
      setMessages((current) => replaceAssistantStreamMessage(current, streamMessageId, assistantMessageWithReasoning));
      await refreshChatSessions(sessionId);
    } catch (error) {
      const streamMessageId = activeAssistantStreamMessageIdRef.current;
      setMessages((current) => removeAssistantStreamMessage(current, streamMessageId));

      const systemMessage: ChatMessage = {
        id: `pi-error-${Date.now()}`,
        speaker: "system",
        author: "本地 agent",
        text: formatUnknownError(error, "Pi session prompt 发送失败。"),
        time: messageTime()
      };

      if (sessionIdForRun) {
        try {
          await desktopBackend.appendChatMessage({
            sessionId: sessionIdForRun,
            speaker: systemMessage.speaker,
            author: systemMessage.author,
            text: systemMessage.text
          });
          await refreshChatSessions(sessionIdForRun);
        } catch {
          // Keep the visible error even if local persistence fails.
        }
      }

      setMessages((current) => [
        ...current,
        systemMessage
      ]);
    } finally {
      if (activePromptRunIdRef.current === runId) {
        clearAssistantTypewriterTimer();
        activePromptRunIdRef.current = null;
        activeAnswerTextRef.current = "";
        activeReasoningTextRef.current = "";
        activeDisplayedAnswerTextRef.current = "";
        activeAssistantStreamMessageIdRef.current = null;
        activeAssistantStreamTimeRef.current = "";
        activePromptCharacterNameRef.current = "";
        activeTypewriterResolveRef.current = null;
        setAssistantProgress(null);
        setPendingConfirm(null);
      }
      setIsSending(false);
    }
  }

  async function respondToConfirm(approved: boolean) {
    const request = pendingConfirm;
    if (!request) {
      return;
    }

    setPendingConfirm(null);

    try {
      await desktopBackend.respondPiToolConfirm({
        runId: request.runId,
        confirmId: request.confirmId,
        approved
      });
    } catch {
      // The run likely ended before we answered; it falls back to a block.
    }
  }

  async function switchCharacter(characterId: string) {
    if (isSending) {
      return;
    }

    setActiveCharacterId(characterId);
    setIsSettingsOpen(false);
    setIsCharacterOpen(false);
    // 点角色即回到聊天（从生活圈点人头自然是想聊天，不是继续看动态）。
    setViewMode("chat");

    const latestSession = findLatestCharacterSession(chatSessions, characterId);

    if (latestSession) {
      await loadChatSession(latestSession.id);
      return;
    }

    setActiveSessionId(null);
    showInitialMessages();
  }

  function startNewSession() {
    if (!canStartNewDraftSession({
      activeSessionId,
      isDraftPending: newDraftSessionLockRef.current,
      isSending
    })) {
      return;
    }

    newDraftSessionLockRef.current = true;
    setIsNewDraftSessionPending(true);
    setActiveSessionId(null);
    setIsSettingsOpen(false);
    setIsCharacterOpen(false);
    showInitialMessages();
  }

  return (
    <main className="app-frame">
      <CompanionSidebar
        characters={sidebarCharacters}
        isNewSessionDisabled={!canStartNewSession}
        isLifeActive={isLifeView}
        lifeUnreadCount={totalUnreadLetters}
        onCharacterInspect={(character) => switchCharacter(character.id)}
        onLifeOpen={openLifeCircle}
        onSettingsOpen={() => {
          setIsCharacterOpen(false);
          setIsSettingsOpen(true);
        }}
        onNewSession={startNewSession}
        onSessionSelect={loadChatSession}
        onThemeToggle={toggleTheme}
        sessions={groupedSessions}
        theme={theme}
      />
      <section className="conversation-stage" aria-label="陪伴对话">
        {activeCharacter && isLifeView ? (
          <div className="stage-view-toggle" role="tablist" aria-label="生活圈：动态与信件">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "feed"}
              className={viewMode === "feed" ? "is-active" : ""}
              onClick={() => setViewMode("feed")}
            >
              动态
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "letters"}
              className={viewMode === "letters" ? "is-active" : ""}
              onClick={() => setViewMode("letters")}
            >
              信件
            </button>
          </div>
        ) : null}
        {activeCharacter ? (
          viewMode === "feed" ? (
            <CompanionMomentsFeed
              moments={moments}
              authors={characterAuthors}
              backgroundSrc={activeCharacter.assets.background}
              postingAuthors={postingIds.map((id) => characterAuthors[id]).filter(Boolean)}
              now={letterClock}
            />
          ) : viewMode === "letters" ? (
            <CompanionLetters
              letters={letters}
              authors={characterAuthors}
              composeTarget={
                activeCard
                  ? { id: activeCard.id, ...(characterAuthors[activeCard.id] ?? { name: activeCard.name, avatar: "" }) }
                  : null
              }
              writingNames={writingIds.map((id) => characterAuthors[id]?.name).filter((name): name is string => Boolean(name))}
              sendingNames={sendingIds.map((id) => characterAuthors[id]?.name).filter((name): name is string => Boolean(name))}
              backgroundSrc={activeCharacter.assets.background}
              now={letterClock}
              onRead={markRead}
              onSend={(draft) => {
                const card = findCharacterCard(cards, draft.characterId);
                if (!card) {
                  return;
                }
                void sendUserLetter({
                  card,
                  state: getCharacterState(characterStates, card.id),
                  subject: draft.subject,
                  body: draft.body,
                  replyTo: draft.replyTo,
                  generateReply: modelReady,
                  onExchange: ({ userText, replyText, impressions }) =>
                    recordCharacterTurn(card.id, { userText, replyText, impressions })
                });
              }}
            />
          ) : (
            <CompanionChat
              assistantProgress={assistantProgress}
              character={activeCharacter}
              isSending={isSending}
              isCharacterOpen={isCharacterOpen}
              messages={messages}
              onCharacterClose={() => setIsCharacterOpen(false)}
            />
          )
        ) : (
          <div className="conversation-loading" role="status">
            正在加载角色卡…
          </div>
        )}
        {pendingConfirm ? (
          <div className="tool-confirm" role="alertdialog" aria-label="工具操作确认">
            <div className="tool-confirm__body">
              <p className="tool-confirm__title">
                {activeCharacter?.character.name ?? "角色"} 想执行 {pendingConfirm.tool.name}
                {pendingConfirm.tool.target ? `：${pendingConfirm.tool.target}` : ""}
              </p>
              {pendingConfirm.tool.reason ? (
                <p className="tool-confirm__reason">{pendingConfirm.tool.reason}</p>
              ) : null}
            </div>
            <div className="tool-confirm__actions">
              <button type="button" className="tool-confirm__reject" onClick={() => respondToConfirm(false)}>
                取消
              </button>
              <button type="button" className="tool-confirm__approve" onClick={() => respondToConfirm(true)}>
                允许
              </button>
            </div>
          </div>
        ) : null}
        {viewMode === "chat" ? (
          <CompanionInput
            disabled={isSending || !modelReady || !activeCharacter}
            isSending={isSending}
            onSend={sendPrompt}
          />
        ) : null}
        <SystemSettingsPanel
          activeCharacterId={activeCharacterId}
          cards={cards}
          characterPreferences={characterPreferences}
          characterStates={characterStates}
          onCharacterPreferenceChange={updateCharacterPreference}
          isOpen={isSettingsOpen}
          memoryDebugEvents={memoryDebugEvents}
          latestMemoryRun={latestMemoryRun}
          onClose={() => setIsSettingsOpen(false)}
          onModelSettingsChange={setModelSettings}
        />
      </section>
    </main>
  );
}
