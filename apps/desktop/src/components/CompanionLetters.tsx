import { useState } from "react";

import { Avatar, Button, ScrollShadow } from "@heroui/react";

import { formatLetterTime, isDelivered, type CharacterLetter } from "./character-letters";
import type { CharacterChatPreview } from "./chat-model";

type LetterDraft = { subject: string; body: string; replyTo: string | null };

type CompanionLettersProps = {
  character: CharacterChatPreview;
  letters: CharacterLetter[];
  writing?: boolean;
  sending?: boolean;
  now?: number;
  onRead: (letterId: string) => void;
  onSend: (draft: LetterDraft) => void;
};

export function CompanionLetters({
  character: preview,
  letters,
  writing = false,
  sending = false,
  now = Date.now(),
  onRead,
  onSend
}: CompanionLettersProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LetterDraft | null>(null);
  const name = preview.character.name;

  const delivered = letters.filter((letter) => isDelivered(letter, now));
  const inTransitCount = letters.length - delivered.length;
  const isEmpty = delivered.length === 0 && !writing && inTransitCount === 0;

  function openLetter(letter: CharacterLetter) {
    setOpenId((current) => (current === letter.id ? null : letter.id));
    if (letter.sender === "character" && letter.readAt === null) {
      onRead(letter.id);
    }
  }

  function startCompose(replyTo: string | null, subjectSeed = "") {
    setDraft({ subject: subjectSeed, body: "", replyTo });
  }

  function submitDraft() {
    if (!draft || !draft.body.trim() || sending) {
      return;
    }
    onSend(draft);
    setDraft(null);
  }

  return (
    <section className="letters-layout" aria-label={`${name}的信`}>
      <img
        alt=""
        aria-hidden="true"
        className="letters-background"
        src={preview.assets.background}
      />
      <div className="letters-background-wash" />

      <header className="letters-header">
        <Avatar className="letters-header-avatar">
          <Avatar.Image alt={name} src={preview.assets.avatar} />
          <Avatar.Fallback>{name.slice(0, 1)}</Avatar.Fallback>
        </Avatar>
        <div className="letters-header-copy">
          <strong>你和{name}的通信</strong>
          <span>
            {sending
              ? `${name}正在读你的信…`
              : writing
                ? `${name}正在提笔…`
                : inTransitCount > 0
                  ? `有 ${inTransitCount} 封信还在路上`
                  : "写封信给 ta，过些时候 ta 会回你"}
          </span>
        </div>
        <Button
          className="letters-compose-btn"
          size="sm"
          variant="primary"
          onPress={() => startCompose(null)}
          isDisabled={draft !== null}
        >
          写信
        </Button>
      </header>

      <ScrollShadow className="letters-stream" hideScrollBar orientation="vertical">
        {draft ? (
          <article className="letter-composer">
            <input
              className="letter-composer-subject"
              placeholder="主题（可留空）"
              value={draft.subject}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            />
            <textarea
              className="letter-composer-body"
              placeholder={`写点什么给${name}…`}
              value={draft.body}
              maxLength={600}
              rows={5}
              autoFocus
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
            <div className="letter-composer-actions">
              <Button size="sm" variant="ghost" onPress={() => setDraft(null)}>
                取消
              </Button>
              <Button
                size="sm"
                variant="primary"
                onPress={submitDraft}
                isDisabled={!draft.body.trim() || sending}
              >
                {draft.replyTo ? "回信" : "寄出"}
              </Button>
            </div>
          </article>
        ) : null}

        {delivered.map((letter) => {
          const isOpen = openId === letter.id;
          const fromUser = letter.sender === "user";
          const isUnread = letter.sender === "character" && letter.readAt === null;
          return (
            <article
              className={`letter-card ${fromUser ? "is-from-user" : ""} ${isOpen ? "is-open" : ""} ${isUnread ? "is-unread" : ""}`}
              key={letter.id}
            >
              <button type="button" className="letter-summary" onClick={() => openLetter(letter)} aria-expanded={isOpen}>
                {isUnread ? <span className="letter-unread-dot" aria-label="未读" /> : null}
                <span className="letter-sender-tag">{fromUser ? "你寄出" : `${name}写来`}</span>
                <span className="letter-subject">{letter.subject}</span>
                <time className="letter-time">{formatLetterTime(letter.deliverAt, now)}</time>
              </button>
              {isOpen ? (
                <div className="letter-body">
                  <p>{letter.body}</p>
                  <footer>—— {fromUser ? "你" : name}</footer>
                  {!fromUser ? (
                    <Button
                      className="letter-reply-btn"
                      size="sm"
                      variant="secondary"
                      onPress={() => startCompose(letter.id, `回复：${letter.subject}`)}
                      isDisabled={draft !== null}
                    >
                      回信
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}

        {isEmpty && !draft ? (
          <div className="letters-empty" role="status">
            还没有信件往来。给{name}写第一封信，过些时候 ta 会回你。
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
