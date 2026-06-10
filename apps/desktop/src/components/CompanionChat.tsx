import { Avatar, Button, ScrollShadow } from "@heroui/react";
import { useEffect, useRef } from "react";

import {
  assistantProgressPrimaryText,
  assistantProgressStatusLabel,
  assistantReasoningDisplayText,
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
  const statusLabel = assistantProgressStatusLabel(assistantProgress?.phase ?? "queued");
  const primaryProgressText = assistantProgressPrimaryText(assistantProgress);
  const reasoningDisplayText = assistantReasoningDisplayText(assistantProgress);

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
  }, [sessionKey, streamSignature, isSending, primaryProgressText, reasoningDisplayText]);

  return (
    <section className="chat-layout" aria-label={`${preview.character.name}陪伴对话`}>
      <img
        alt=""
        aria-hidden="true"
        className="chat-background"
        src={preview.assets.background}
      />
      <div className="chat-background-wash" />

      {isCharacterOpen ? (
        <aside className="character-inspector" aria-label="角色详情">
          <Button
            aria-label="关闭角色详情"
            className="inspector-close"
            onPress={onCharacterClose}
            type="button"
          >
            ×
          </Button>
          <img alt={`${preview.character.name} 立绘`} src={preview.assets.portrait} />
          <div className="inspector-copy">
          <h1>{preview.character.name}</h1>
          <div className="inspector-stickers" aria-label="角色表情">
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
        <div className="chat-date-pill">今天</div>
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
              {reasoningDisplayText ? (
                <section className="chat-progress-section" aria-label="模型思考状态">
                  <span>{reasoningDisplayText}</span>
                </section>
              ) : null}
            </div>
          </article>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
