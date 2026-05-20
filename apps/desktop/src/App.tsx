import { useEffect, useState } from "react";

import { CompanionChat } from "./components/CompanionChat";
import { CompanionInput } from "./components/CompanionInput";
import { CompanionSidebar } from "./components/CompanionSidebar";
import { SystemSettingsPanel } from "./components/SystemSettingsPanel";
import { desktopBackend } from "./components/desktop-backend";
import { formatUnknownError } from "./components/error-message";
import { buildCharacterChatPreview, isCharacterId, type ChatMessage } from "./components/chat-model";
import { createSessionTitle, findLatestCharacterSession, groupChatSessions, type ChatSessionSummary } from "./components/chat-history-model";
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

function messageTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function welcomeMessageId(characterId: string) {
  return `${characterId}-welcome`;
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
  const [activeCharacterId, setActiveCharacterId] = useState(() => characters.find((character) => character.active)?.id ?? "shili");
  const [isCharacterOpen, setIsCharacterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages(activeCharacterId));
  const [openingGenerationKey, setOpeningGenerationKey] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const [memoryDebugEvents, setMemoryDebugEvents] = useState<MemoryDebugEvent[]>([]);
  const [latestMemoryRun, setLatestMemoryRun] = useState<MemoryRunSnapshot | null>(null);
  const modelReady = isModelConfigured(modelSettings);
  const activeModelProfile = getActiveModelProfile(modelSettings);
  const groupedSessions = groupChatSessions(chatSessions, { activeSessionId });
  const activeCharacter = buildCharacterChatPreview(activeCharacterId);
  const sidebarCharacters = activateCharacter(characters, activeCharacterId);

  function showInitialMessages(characterId: string) {
    setMessages(initialMessages(characterId));
    setOpeningGenerationKey((current) => current + 1);
  }

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

    async function loadInitialSession() {
      try {
        const sessions = await desktopBackend.listChatSessions();

        if (!isMounted) {
          return;
        }

        setChatSessions(sessions);

        if (sessions.length === 0) {
          setActiveSessionId(null);
          showInitialMessages(activeCharacterId);
          return;
        }

        const detail = await desktopBackend.getChatSession(sessions[0].id);

        if (isMounted) {
          setActiveSessionId(detail.session.id);
          if (isCharacterId(detail.session.characterId)) {
            setActiveCharacterId(detail.session.characterId);
          }
          if (detail.messages.length === 0) {
            showInitialMessages(detail.session.characterId);
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
    if (!modelReady || activeSessionId !== null) {
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
        // Static first messages stay in place when opening generation is unavailable.
      });

    return () => {
      isCancelled = true;
    };
  }, [activeCharacterId, activeSessionId, modelReady, openingGenerationKey]);

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

    setMessages((current) => [...current, userMessage]);
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
      const assistantMessage = await desktopBackend.appendChatMessage({
        sessionId,
        speaker: "character",
        author: preview.character.name,
        text: parsedReply.text || `已通过 ${response.modelRoute} 完成这次 Pi session。`,
        stickerId: parsedReply.sticker?.id,
        modelRoute: response.modelRoute,
        providerId: response.providerId
      });

      setMessages((current) => [
        ...current,
        assistantMessage
      ]);
      await refreshChatSessions(sessionId);
    } catch (error) {
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
    showInitialMessages(characterId);
  }

  function startNewSession() {
    if (isSending) {
      return;
    }

    setActiveSessionId(null);
    setIsSettingsOpen(false);
    setIsCharacterOpen(false);
    showInitialMessages(activeCharacterId);
  }

  return (
    <main className="app-frame">
      <CompanionSidebar
        characters={sidebarCharacters}
        onCharacterInspect={(character) => switchCharacter(character.id)}
        onSettingsOpen={() => {
          setIsCharacterOpen(false);
          setIsSettingsOpen(true);
        }}
        onNewSession={startNewSession}
        onSessionSelect={loadChatSession}
        sessions={groupedSessions}
      />
      <section className="conversation-stage" aria-label="陪伴对话">
        <CompanionChat
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
