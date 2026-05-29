import { useEffect, useRef, useState } from "react";

import { CompanionChat } from "./components/CompanionChat";
import { CompanionInput } from "./components/CompanionInput";
import { CompanionSidebar } from "./components/CompanionSidebar";
import { SystemSettingsPanel } from "./components/SystemSettingsPanel";
import { desktopBackend } from "./components/desktop-backend";
import { formatUnknownError } from "./components/error-message";
import { buildCharacterChatPreview, isCharacterId, type ChatMessage } from "./components/chat-model";
import {
  createAssistantProgress,
  nextTypewriterText,
  removeAssistantStreamMessage,
  reduceAssistantProgress,
  replaceAssistantStreamMessage,
  upsertAssistantStreamMessage,
  type AssistantProgress
} from "./components/assistant-progress-model";
import {
  canStartNewDraftSession,
  createSessionTitle,
  findLatestCharacterSession,
  groupChatSessions,
  shouldGenerateOpeningMessage,
  type ChatSessionSummary
} from "./components/chat-history-model";
import { buildCharacterCardViewModel } from "./components/character-card-view-model";
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
import { activateCharacter, characters } from "./components/sidebar-model";
import { useTheme } from "./components/use-theme";

function messageTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function welcomeMessageId(characterId: string) {
  return `${characterId}-welcome`;
}

function createPromptRunId() {
  if (globalThis.crypto?.randomUUID) {
    return `prompt-${globalThis.crypto.randomUUID()}`;
  }

  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildOpeningMessagePrompt(characterId: string) {
  const card = buildCharacterCardViewModel(characterId);

  return [
    `你是 ${card.name}，${card.relationship}。`,
    `角色气质：${card.persona}`,
    `说话风格：${card.speakingStyle}`,
    "请结合可用记忆，生成一句自然的重新见面开场白。",
    "要求：1 到 2 句；不要像任务审问；不要说“根据记忆”；不要编造未提供的事实；不要替用户决定今天必须做什么；只输出开场白本身。"
  ].join("\n");
}

function initialMessages(characterId = "shili"): ChatMessage[] {
  const preview = buildCharacterChatPreview(characterId);
  const card = buildCharacterCardViewModel(characterId);
  const neutralSticker = preview.stickers.find((sticker) => sticker.id === "neutral");

  return [
    {
      id: welcomeMessageId(preview.character.id),
      speaker: "character",
      author: card.name,
      text: card.firstMessage,
      time: messageTime(),
      sticker: neutralSticker
    }
  ];
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [activeCharacterId, setActiveCharacterId] = useState(() => characters.find((character) => character.active)?.id ?? "shili");
  const [isCharacterOpen, setIsCharacterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages(activeCharacterId));
  const [openingGenerationKey, setOpeningGenerationKey] = useState(0);
  const [isOpeningGenerationRequested, setIsOpeningGenerationRequested] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [assistantProgress, setAssistantProgress] = useState<AssistantProgress | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const [memoryDebugEvents, setMemoryDebugEvents] = useState<MemoryDebugEvent[]>([]);
  const [latestMemoryRun, setLatestMemoryRun] = useState<MemoryRunSnapshot | null>(null);
  const [isNewDraftSessionPending, setIsNewDraftSessionPending] = useState(false);
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
  const modelReady = isModelConfigured(modelSettings);
  const activeModelProfile = getActiveModelProfile(modelSettings);
  const groupedSessions = groupChatSessions(chatSessions, { activeSessionId });
  const canStartNewSession = canStartNewDraftSession({
    activeSessionId,
    isDraftPending: isNewDraftSessionPending,
    isSending
  });
  const activeCharacter = buildCharacterChatPreview(activeCharacterId);
  const sidebarCharacters = activateCharacter(characters, activeCharacterId);

  function showInitialMessages(characterId: string, options: { generateOpening?: boolean } = {}) {
    setMessages(initialMessages(characterId));
    setIsOpeningGenerationRequested(options.generateOpening === true);
    if (options.generateOpening) {
      setOpeningGenerationKey((current) => current + 1);
    }
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

    async function loadInitialSession() {
      try {
        const sessions = await desktopBackend.listChatSessions();

        if (!isMounted) {
          return;
        }

        setChatSessions(sessions);

        if (sessions.length === 0) {
          setActiveSessionId(null);
          showInitialMessages(activeCharacterId, { generateOpening: true });
          return;
        }

        const detail = await desktopBackend.getChatSession(sessions[0].id);

        if (isMounted) {
          setActiveSessionId(detail.session.id);
          if (isCharacterId(detail.session.characterId)) {
            setActiveCharacterId(detail.session.characterId);
          }
          if (detail.messages.length === 0) {
            showInitialMessages(detail.session.characterId, { generateOpening: true });
          } else {
            setMessages(detail.messages);
          }
        }
      } catch (error) {
        if (isMounted) {
          setActiveSessionId(null);
          setMessages([
            ...initialMessages(),
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
  }, []);

  useEffect(() => {
    if (!shouldGenerateOpeningMessage({
      activeSessionId,
      modelReady,
      requested: isOpeningGenerationRequested
    })) {
      return;
    }

    let isCancelled = false;
    const characterId = activeCharacterId;
    const fallbackId = welcomeMessageId(characterId);

    desktopBackend.generateOpeningMessage({
      characterId,
      prompt: buildOpeningMessagePrompt(characterId)
    })
      .then((response) => {
        const text = response.text.trim();

        if (isCancelled || !text) {
          return;
        }

        setIsOpeningGenerationRequested(false);

        setMessages((current) => {
          if (current.length !== 1 || current[0]?.id !== fallbackId) {
            return current;
          }

          return [{ ...current[0], text }];
        });

        const memoryRun = {
          memoryBackendSource: response.memoryBackendSource,
          recalledMemories: response.recalledMemories
        };
        setLatestMemoryRun(memoryRun);
        setMemoryDebugEvents((current) =>
          appendMemoryDebugEvent(current, createMemoryDebugEventFromRun({ run: memoryRun }))
        );
      })
      .catch(() => {
        setIsOpeningGenerationRequested(false);
        // Static first messages stay in place when opening generation is unavailable.
      });

    return () => {
      isCancelled = true;
    };
  }, [activeCharacterId, activeSessionId, isOpeningGenerationRequested, modelReady, openingGenerationKey]);

  useEffect(() => {
    if (activeSessionId !== null) {
      newDraftSessionLockRef.current = false;
      setIsNewDraftSessionPending(false);
    }
  }, [activeSessionId]);

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
      if (isCharacterId(detail.session.characterId)) {
        setActiveCharacterId(detail.session.characterId);
      }
      if (detail.messages.length === 0) {
        showInitialMessages(detail.session.characterId);
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

    if (!prompt || isSending || !modelReady) {
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
    const preview = activeCharacter;
    const runId = createPromptRunId();

    setMessages((current) => [...current, userMessage]);
    clearAssistantTypewriterTimer();
    activeAnswerTextRef.current = "";
    activeReasoningTextRef.current = "";
    activeDisplayedAnswerTextRef.current = "";
    activeAssistantStreamMessageIdRef.current = `assistant-stream-${runId}`;
    activeAssistantStreamTimeRef.current = messageTime();
    activePromptCharacterNameRef.current = preview.character.name;
    activeTypewriterResolveRef.current = null;
    activePromptRunIdRef.current = runId;
    setAssistantProgress(createAssistantProgress(runId));
    setIsSending(true);

    let sessionIdForRun = activeSessionId;

    try {
      const sessionId = activeSessionId ?? (await desktopBackend.createChatSession({
        characterId: preview.character.id,
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
      const sessionPrompt = composeCharacterSessionPrompt({
        character: preview,
        history: promptHistory,
        userPrompt: prompt
      });

      setActiveSessionId(sessionId);
      setMessages((current) =>
        current.map((message) => message.id === userMessage.id ? persistedUserMessage : message)
      );

      const response = await desktopBackend.sendPiPrompt({
        characterId: preview.character.id,
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
      const parsedReply = parseCharacterReply(response.text, preview.stickers);
      const replyText = parsedReply.text || `已通过 ${response.modelRoute} 完成这次 Pi session。`;
      await revealAssistantText(replyText);
      const assistantMessage = await desktopBackend.appendChatMessage({
        sessionId,
        speaker: "character",
        author: preview.character.name,
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
      }
      setIsSending(false);
    }
  }

  async function switchCharacter(characterId: string) {
    if (isSending) {
      return;
    }

    setActiveCharacterId(characterId);
    setIsSettingsOpen(false);
    setIsCharacterOpen(false);

    const latestSession = findLatestCharacterSession(chatSessions, characterId);

    if (latestSession) {
      await loadChatSession(latestSession.id);
      return;
    }

    setActiveSessionId(null);
    showInitialMessages(characterId, { generateOpening: true });
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
    showInitialMessages(activeCharacterId);
  }

  return (
    <main className="app-frame">
      <CompanionSidebar
        characters={sidebarCharacters}
        isNewSessionDisabled={!canStartNewSession}
        onCharacterInspect={(character) => switchCharacter(character.id)}
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
        <CompanionChat
          assistantProgress={assistantProgress}
          character={activeCharacter}
          isSending={isSending}
          isCharacterOpen={isCharacterOpen}
          messages={messages}
          onCharacterClose={() => setIsCharacterOpen(false)}
        />
        <CompanionInput
          disabled={isSending || !modelReady}
          isSending={isSending}
          onSend={sendPrompt}
        />
        <SystemSettingsPanel
          activeCharacterId={activeCharacterId}
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
