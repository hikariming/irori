import { Avatar, Button, ScrollShadow } from "@heroui/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  assistantProgressPrimaryText,
  assistantProgressStatusLabel,
  assistantReasoningActive,
  type AssistantProgress
} from "./assistant-progress-model";
import type { CharacterChatPreview, ChatMessage } from "./chat-model";

function MessageBubble({ message, avatar }: { message: ChatMessage; avatar: string }) {
  if (message.speaker === "system") {
    return (
      <article className="chat-system-card">
        <span>{message.author}</span>
        <p>{message.text}</p>
      </article>
    );
  }

  const isUser = message.speaker === "user";
  const isStreaming = !isUser && message.id.startsWith("assistant-stream-");

  return (
    <article className={`chat-message ${isUser ? "user" : "character"} ${isStreaming ? "is-streaming" : ""}`}>
      {!isUser ? (
        <Avatar className="chat-avatar">
          <Avatar.Image alt={message.author} src={avatar} />
          <Avatar.Fallback>{message.author.slice(0, 1)}</Avatar.Fallback>
        </Avatar>
      ) : null}

      <div className="chat-message-body">
        <header>
          <strong>{message.author}</strong>
          <time>{message.time}</time>
        </header>
        <p>{message.text}</p>
        {message.sticker ? (
          <figure className="chat-sticker">
            <img alt={message.sticker.label} src={message.sticker.src} />
          </figure>
        ) : null}
      </div>
    </article>
  );
}

// 距底部小于这个像素数就视为「贴着底部」，新消息进来时跟随滚动。
const STREAM_FOLLOW_THRESHOLD = 80;

type CompanionChatProps = {
  assistantProgress?: AssistantProgress | null;
  character: CharacterChatPreview;
  isSending?: boolean;
  isCharacterOpen: boolean;
  messages: ChatMessage[];
  onCharacterClose: () => void;
  sessionKey: string;
};

export function CompanionChat({
  assistantProgress,
  character: preview,
  isSending = false,
  isCharacterOpen,
  messages,
  onCharacterClose,
  sessionKey
}: CompanionChatProps) {
  const { t } = useTranslation("companion");
  const statusLabelDescriptor = assistantProgressStatusLabel(assistantProgress?.phase ?? "queued");
  const primaryProgressDescriptor = assistantProgressPrimaryText(assistantProgress);
  const statusLabel = t(statusLabelDescriptor.key, statusLabelDescriptor.params);
  const primaryProgressText = t(primaryProgressDescriptor.key, primaryProgressDescriptor.params);
  const isReasoningActive = assistantReasoningActive(assistantProgress);

  const streamRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottomRef = useRef(true);
  const lastSessionKeyRef = useRef<string | null>(null);

  // 最后一条消息的 id 和文本长度一起进签名：流式输出只改 message.text，签名也会变。
  const lastMessage = messages.at(-1);
  const streamSignature = `${messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}`;

  function handleStreamScroll() {
    const element = streamRef.current;
    if (!element) {
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom < STREAM_FOLLOW_THRESHOLD;
  }

  useEffect(() => {
    const element = streamRef.current;
    if (!element) {
      return;
    }

    const isSessionSwitch = lastSessionKeyRef.current !== sessionKey;
    lastSessionKeyRef.current = sessionKey;

    if (isSessionSwitch) {
      // 切换会话直接瞬时跳底，并恢复跟随。
      isPinnedToBottomRef.current = true;
      element.scrollTop = element.scrollHeight;
      return;
    }

    if (isPinnedToBottomRef.current) {
      // 同一会话内只有贴着底部时才跟随；用户往上翻历史就不强行拽回。
      element.scrollTop = element.scrollHeight;
    }
  }, [sessionKey, streamSignature, isSending, primaryProgressText, isReasoningActive]);

  return (
    <section className="chat-layout" aria-label={t("chat.companionAria", { name: preview.character.name })}>
      <img
        alt=""
        aria-hidden="true"
        className="chat-background"
        src={preview.assets.background}
      />
      <div className="chat-background-wash" />

      {isCharacterOpen ? (
        <aside className="character-inspector" aria-label={t("chat.inspectorAria")}>
          <Button
            aria-label={t("chat.closeInspector")}
            className="inspector-close"
            onPress={onCharacterClose}
            type="button"
          >
            ×
          </Button>
          <img alt={t("chat.portraitAlt", { name: preview.character.name })} src={preview.assets.portrait} />
          <div className="inspector-copy">
          <h1>{preview.character.name}</h1>
          <div className="inspector-stickers" aria-label={t("chat.stickersAria")}>
            {preview.stickers.map((sticker) => (
              <img alt={sticker.label} key={sticker.id} src={sticker.src} />
            ))}
          </div>
          </div>
        </aside>
      ) : null}

      <ScrollShadow
        className="chat-stream"
        hideScrollBar
        onScroll={handleStreamScroll}
        orientation="vertical"
        ref={streamRef}
      >
        <div className="chat-date-pill">{t("chat.today")}</div>
        {messages.map((message) => (
          <MessageBubble
            avatar={preview.assets.avatar}
            key={message.id}
            message={message}
          />
        ))}
        {isSending ? (
          <article className="chat-message character is-typing" aria-live="polite">
            <Avatar className="chat-avatar">
              <Avatar.Image alt={preview.character.name} src={preview.assets.avatar} />
              <Avatar.Fallback>{preview.character.name.slice(0, 1)}</Avatar.Fallback>
            </Avatar>
            <div className="chat-message-body">
              <header>
                <strong>{preview.character.name}</strong>
                <time>{statusLabel}</time>
              </header>
              <div className="chat-progress-status">
                <span className="chat-progress-pulse" aria-hidden="true" />
                <p>{primaryProgressText}</p>
              </div>
              {isReasoningActive ? (
                <section className="chat-progress-section" aria-label={t("chat.progressAria")}>
                  <span>{t("chat.progress.reasoning")}</span>
                </section>
              ) : null}
            </div>
          </article>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
