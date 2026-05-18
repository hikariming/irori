import { useEffect, useState } from "react";

import { CompanionChat } from "./components/CompanionChat";
import { CompanionInput } from "./components/CompanionInput";
import { CompanionSidebar } from "./components/CompanionSidebar";
import { SystemSettingsPanel } from "./components/SystemSettingsPanel";
import { desktopBackend } from "./components/desktop-backend";
import { formatUnknownError } from "./components/error-message";
import { buildCharacterChatPreview, type ChatMessage } from "./components/chat-model";
import { buildCharacterCardViewModel } from "./components/character-card-view-model";
import { composeCharacterSessionPrompt, parseCharacterReply } from "./components/chat-session";
import type { ComposerMode } from "./components/input-model";
import { buildInitialModelSettings, isModelConfigured, type ModelSettingsState } from "./components/model-settings-controller";
import { characters, sessionGroups } from "./components/sidebar-model";

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
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isSending, setIsSending] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const modelReady = isModelConfigured(modelSettings);

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
    const sessionPrompt = composeCharacterSessionPrompt({
      character: preview,
      history: messages,
      mode,
      userPrompt: prompt
    });

    setMessages((current) => [...current, userMessage]);
    setIsSending(true);

    try {
      const response = await desktopBackend.sendPiPrompt({
        characterId: "shili",
        mode,
        prompt,
        sessionPrompt
      });
      if (!response.text.trim()) {
        throw new Error("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。");
      }
      const parsedReply = parseCharacterReply(response.text, preview.stickers);

      setMessages((current) => [
        ...current,
        {
          id: `pi-${Date.now()}`,
          speaker: "character",
          author: "示璃",
          text: parsedReply.text || `已通过 ${response.modelRoute} 完成这次 Pi session。`,
          time: messageTime(),
          sticker: parsedReply.sticker
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `pi-error-${Date.now()}`,
          speaker: "system",
          author: "本地 agent",
          text: formatUnknownError(error, "Pi session prompt 发送失败。"),
          time: messageTime()
        }
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
        sessions={sessionGroups}
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
