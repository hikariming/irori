import { useEffect, useState } from "react";

import { CompanionChat } from "./components/CompanionChat";
import { CompanionInput } from "./components/CompanionInput";
import { CompanionSidebar } from "./components/CompanionSidebar";
import { SystemSettingsPanel } from "./components/SystemSettingsPanel";
import { desktopBackend } from "./components/desktop-backend";
import { formatUnknownError } from "./components/error-message";
import { buildCharacterChatPreview, type ChatMessage } from "./components/chat-model";
import { createSessionTitle, groupChatSessions, type ChatSessionSummary } from "./components/chat-history-model";
import { buildCharacterCardViewModel } from "./components/character-card-view-model";
import { composeCharacterSessionPrompt, parseCharacterReply } from "./components/chat-session";
import type { ComposerMode } from "./components/input-model";
import { buildInitialModelSettings, isModelConfigured, type ModelSettingsState } from "./components/model-settings-controller";
import { characters } from "./components/sidebar-model";

function messageTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

function initialMessages(): ChatMessage[] {
  const preview = buildCharacterChatPreview();
  const card = buildCharacterCardViewModel();
  const neutralSticker = preview.stickers.find((sticker) => sticker.id === "neutral");

  return [
    {
      id: "shili-welcome",
      speaker: "character",
      author: card.name,
      text: card.firstMessage,
      time: messageTime(),
      sticker: neutralSticker
    }
  ];
}

export function App() {
  const [isCharacterOpen, setIsCharacterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isSending, setIsSending] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const modelReady = isModelConfigured(modelSettings);
  const groupedSessions = groupChatSessions(chatSessions, { activeSessionId });

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
          setMessages(initialMessages());
          return;
        }

        const detail = await desktopBackend.getChatSession(sessions[0].id);

        if (isMounted) {
          setActiveSessionId(detail.session.id);
          setMessages(detail.messages.length === 0 ? initialMessages() : detail.messages);
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
      setMessages(detail.messages.length === 0 ? initialMessages() : detail.messages);
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

  async function sendPrompt(draft: string, mode: ComposerMode) {
    const prompt = draft.trim();

    if (!prompt || isSending || !modelReady) {
      if (prompt && !modelReady) {
        setMessages((current) => [
          ...current,
          {
            id: `model-missing-${Date.now()}`,
            speaker: "system",
            author: "模型供应商",
            text: "还没有可用模型。请先点左下角设置，填写 OpenAI 兼容接口的 Base URL、Token 和模型名。",
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
      time: messageTime(),
      mode
    };
    const preview = buildCharacterChatPreview();

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
        text: userMessage.text,
        mode: userMessage.mode
      });
      const promptHistory = activeSessionId ? messages : [];
      const sessionPrompt = composeCharacterSessionPrompt({
        character: preview,
        history: promptHistory,
        mode,
        userPrompt: prompt
      });

      setActiveSessionId(sessionId);
      setMessages((current) =>
        current.map((message) => message.id === userMessage.id ? persistedUserMessage : message)
      );

      const response = await desktopBackend.sendPiPrompt({
        characterId: "shili",
        mode,
        prompt,
        sessionId,
        sessionPrompt
      });
      if (!response.text.trim()) {
        throw new Error("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。");
      }
      const parsedReply = parseCharacterReply(response.text, preview.stickers);
      const assistantMessage = await desktopBackend.appendChatMessage({
        sessionId,
        speaker: "character",
        author: "示璃",
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

  return (
    <main className="app-frame">
      <CompanionSidebar
        characters={characters}
        onCharacterInspect={() => {
          setIsSettingsOpen(false);
          setIsCharacterOpen(true);
        }}
        onSettingsOpen={() => {
          setIsCharacterOpen(false);
          setIsSettingsOpen(true);
        }}
        onSessionSelect={loadChatSession}
        sessions={groupedSessions}
      />
      <section className="conversation-stage" aria-label="陪伴对话">
        <CompanionChat
          isSending={isSending}
          isCharacterOpen={isCharacterOpen}
          messages={messages}
          onCharacterClose={() => setIsCharacterOpen(false)}
        />
        <CompanionInput
          disabled={isSending || !modelReady}
          isSending={isSending}
          onSend={sendPrompt}
          statusHint={
            modelReady
              ? undefined
              : "未配置模型供应商：请先填写 Base URL / Token / 模型名"
          }
        />
        <SystemSettingsPanel
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onModelSettingsChange={setModelSettings}
        />
      </section>
    </main>
  );
}
