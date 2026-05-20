import { Avatar, Button, Chip, ScrollShadow } from "@heroui/react";

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

  return (
    <article className={`chat-message ${isUser ? "user" : "character"}`}>
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

type CompanionChatProps = {
  character: CharacterChatPreview;
  isSending?: boolean;
  isCharacterOpen: boolean;
  messages: ChatMessage[];
  onCharacterClose: () => void;
};

export function CompanionChat({ character: preview, isSending = false, isCharacterOpen, messages, onCharacterClose }: CompanionChatProps) {
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
          <Chip className="presence-chip" size="sm" variant="soft">
            {preview.mood.label}
          </Chip>
          <h1>{preview.character.name}</h1>
          <p>{preview.character.tagline}</p>
          <div className="inspector-stickers" aria-label="角色表情">
            {preview.stickers.map((sticker) => (
              <img alt={sticker.label} key={sticker.id} src={sticker.src} />
            ))}
          </div>
          </div>
        </aside>
      ) : null}

      <ScrollShadow className="chat-stream" hideScrollBar orientation="vertical">
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
                <time>思考中</time>
              </header>
              <p>正在把角色卡、上下文和你的新消息交给 Pi...</p>
            </div>
          </article>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
