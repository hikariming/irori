import { useEffect, useRef, useState } from "react";

import { CompanionChat } from "./components/CompanionChat";
import { CompanionInput } from "./components/CompanionInput";
import { CompanionLetters } from "./components/CompanionLetters";
import { CompanionMomentsFeed } from "./components/CompanionMomentsFeed";
import { CompanionSidebar } from "./components/CompanionSidebar";
import { SystemSettingsPanel } from "./components/SystemSettingsPanel";
import { desktopBackend } from "./components/desktop-backend";
import { formatUnknownError } from "./components/error-message";
import { type ChatMessage } from "./components/chat-model";
import {
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
import { getCharacterState } from "./components/character-state";
import { useCharacterLetters } from "./components/use-character-letters";
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

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { preferences: characterPreferences, updatePreference: updateCharacterPreference } = useCharacterPreferences();
  const { states: characterStates, beginCharacterTurn, recordCharacterTurn } = useCharacterState();
  const { moments, postingIds, loadMoments, maybePostMoment } = useCharacterMoments();
  const { letters, writingIds, sendingIds, loadLetters, maybeWriteLetter, sendUserLetter, markRead } =
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
  const sidebarCharacters = buildSidebarCharacters(cards, activeCard?.id ?? activeCharacterId, characterPreferences);

  function showInitialMessages() {
    setMessages([]);
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

  // 打开动态流时加载该角色的历史动态，并在合适时机让它自己发一条新的。
  useEffect(() => {
    if (viewMode !== "feed" || !activeCard) {
      return;
    }

    const card = activeCard;
    let cancelled = false;

    (async () => {
      await loadMoments(card.id);
      if (cancelled || !modelReady) {
        return;
      }
      await maybePostMoment(card, getCharacterState(characterStates, card.id));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeCard?.id, modelReady]);

  // 打开信件收件箱时加载历史信件，并在合适时机让角色写一封新的（延迟送达）。
  useEffect(() => {
    if (viewMode !== "letters" || !activeCard) {
      return;
    }

    const card = activeCard;
    let cancelled = false;

    (async () => {
      await loadLetters(card.id);
      if (cancelled || !modelReady) {
        return;
      }
      await maybeWriteLetter(card, getCharacterState(characterStates, card.id));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeCard?.id, modelReady]);

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
      recordCharacterTurn(card.id, { userText: prompt, replyText, impressions: parsedReply.impressions });
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
        {activeCharacter ? (
          <div className="stage-view-toggle" role="tablist" aria-label="切换聊天与动态">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "chat"}
              className={viewMode === "chat" ? "is-active" : ""}
              onClick={() => setViewMode("chat")}
            >
              聊天
            </button>
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
              character={activeCharacter}
              moments={moments.filter((moment) => moment.characterId === activeCharacter.character.id)}
              isPosting={postingIds.includes(activeCharacter.character.id)}
            />
          ) : viewMode === "letters" ? (
            <CompanionLetters
              character={activeCharacter}
              letters={letters.filter((letter) => letter.characterId === activeCharacter.character.id)}
              writing={writingIds.includes(activeCharacter.character.id)}
              sending={sendingIds.includes(activeCharacter.character.id)}
              onRead={markRead}
              onSend={(draft) => {
                const card = activeCard;
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
