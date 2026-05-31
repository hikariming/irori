import { useState } from "react";

import { Avatar, ScrollShadow } from "@heroui/react";

import { formatLetterTime, isDelivered, type CharacterLetter } from "./character-letters";
import type { CharacterChatPreview } from "./chat-model";

type CompanionLettersProps = {
  character: CharacterChatPreview;
  letters: CharacterLetter[];
  writing?: boolean;
  now?: number;
  onRead: (letterId: string) => void;
};

export function CompanionLetters({
  character: preview,
  letters,
  writing = false,
  now = Date.now(),
  onRead
}: CompanionLettersProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const name = preview.character.name;

  const delivered = letters.filter((letter) => isDelivered(letter, now));
  const inTransitCount = letters.length - delivered.length;
  const isEmpty = delivered.length === 0 && !writing && inTransitCount === 0;

  function openLetter(letter: CharacterLetter) {
    setOpenId((current) => (current === letter.id ? null : letter.id));
    if (letter.readAt === null) {
      onRead(letter.id);
    }
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
          <strong>{name}写来的信</strong>
          <span>{writing ? `${name}正在提笔…` : inTransitCount > 0 ? `有 ${inTransitCount} 封信还在路上` : "她偶尔会写信给你"}</span>
        </div>
      </header>

      <ScrollShadow className="letters-stream" hideScrollBar orientation="vertical">
        {delivered.map((letter) => {
          const isOpen = openId === letter.id;
          const isUnread = letter.readAt === null;
          return (
            <article
              className={`letter-card ${isOpen ? "is-open" : ""} ${isUnread ? "is-unread" : ""}`}
              key={letter.id}
            >
              <button type="button" className="letter-summary" onClick={() => openLetter(letter)} aria-expanded={isOpen}>
                {isUnread ? <span className="letter-unread-dot" aria-label="未读" /> : null}
                <span className="letter-subject">{letter.subject}</span>
                <time className="letter-time">{formatLetterTime(letter.deliverAt, now)}</time>
              </button>
              {isOpen ? (
                <div className="letter-body">
                  <p>{letter.body}</p>
                  <footer>—— {name}</footer>
                </div>
              ) : null}
            </article>
          );
        })}

        {isEmpty ? (
          <div className="letters-empty" role="status">
            {name}还没有写过信。等你们更熟一些，她也许会提笔给你写点什么。
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
