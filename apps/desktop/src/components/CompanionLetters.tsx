import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Avatar, Button, ScrollShadow } from "@heroui/react";

import type { FeedAuthor } from "./character-cards";

type LettersTranslate = (key: string, options?: Record<string, unknown>) => string;
import {
  formatKeepsakeEta,
  formatLetterTime,
  isDelivered,
  type CharacterLetter,
  type KeepsakeKind,
  type KeepsakeReaction
} from "./character-letters";

type CompanionLettersProps = {
  letters: CharacterLetter[];
  authors: Record<string, FeedAuthor>;
  writingNames?: string[];
  reactingNames?: string[];
  backgroundSrc?: string;
  now?: number;
  onRead: (letterId: string) => void;
  // 首次拆开一件小礼物时回调（用于 +好感）。
  onOpenGift?: (letter: CharacterLetter) => void;
  onReact: (letter: CharacterLetter, reaction: KeepsakeReaction) => void;
};

const KIND_ICON: Record<KeepsakeKind, string> = { postcard: "📮", note: "🟨", gift: "🎁" };
const REACTION_EMOJIS = ["❤️", "🥰", "😊", "🤗", "✨"];

function AuthorAvatar({ author, className }: { author: FeedAuthor; className: string }) {
  return (
    <Avatar className={className}>
      {author.avatar ? <Avatar.Image alt={author.name} src={author.avatar} /> : null}
      <Avatar.Fallback>{author.name.slice(0, 1)}</Avatar.Fallback>
    </Avatar>
  );
}

// 折叠态摘要里显示的一行标题，按 kind 取不同字段（礼物拆开前先卖个关子）。
function summaryTitle(letter: CharacterLetter, isOpen: boolean, t: LettersTranslate): string {
  if (letter.kind === "postcard") {
    return letter.meta?.place ? t("letters.fromPlace", { place: letter.meta.place }) : letter.subject;
  }
  if (letter.kind === "gift") {
    return isOpen ? letter.meta?.item || letter.subject : t("letters.giftUnopened");
  }
  // note：没有正式主题，用正文开头做预览。
  const preview = letter.body.replace(/\s+/g, " ").trim();
  return preview.length > 18 ? `${preview.slice(0, 18)}…` : preview;
}

// 展开后的信物正文，按 kind 渲染不同的版式。
function KeepsakeBody({ letter, authorName }: { letter: CharacterLetter; authorName: string }) {
  if (letter.kind === "gift") {
    return (
      <div className="keepsake-content keepsake-gift">
        {letter.meta?.item ? <div className="keepsake-gift-item">🎁 {letter.meta.item}</div> : null}
        <p>{letter.body}</p>
        <footer>—— {authorName}</footer>
      </div>
    );
  }
  if (letter.kind === "note") {
    return (
      <div className="keepsake-content keepsake-note">
        <p>{letter.body}</p>
        <footer>—— {authorName}</footer>
      </div>
    );
  }
  return (
    <div className="keepsake-content keepsake-postcard">
      {letter.meta?.place ? <span className="keepsake-place-chip">{letter.meta.place}</span> : null}
      <p>{letter.body}</p>
      <footer>—— {authorName}</footer>
    </div>
  );
}

// 信物匣：把所有角色送来的明信片 / 便利贴 / 小礼物汇成一个匣子，可对每件点表情、回一句。
export function CompanionLetters({
  letters,
  authors,
  writingNames = [],
  reactingNames = [],
  backgroundSrc,
  now = Date.now(),
  onRead,
  onOpenGift,
  onReact
}: CompanionLettersProps) {
  const { t } = useTranslation("companion");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reactText, setReactText] = useState("");
  const effectiveNow = Math.max(now, Date.now());
  const fallbackAuthor: FeedAuthor = { name: t("unknownAuthor"), avatar: "" };

  const delivered = letters.filter((letter) => isDelivered(letter, effectiveNow));
  // 还在路上的：按最快到达排前面，做成「物流在途」卡片，内容封着、只露类型与 ETA。
  const inTransit = letters
    .filter((letter) => !isDelivered(letter, effectiveNow))
    .sort((a, b) => a.deliverAt - b.deliverAt);
  const isEmpty = delivered.length === 0 && inTransit.length === 0 && writingNames.length === 0;

  function openKeepsake(letter: CharacterLetter) {
    const willOpen = openId !== letter.id;
    setOpenId(willOpen ? letter.id : null);
    setReactText("");
    if (willOpen && letter.readAt === null) {
      onRead(letter.id);
      if (letter.kind === "gift") {
        onOpenGift?.(letter);
      }
    }
  }

  function sendReaction(letter: CharacterLetter, emoji?: string) {
    const text = reactText.trim();
    if (!emoji && !text) {
      return;
    }
    onReact(letter, { emoji, text: text || undefined, at: Date.now() });
    setReactText("");
  }

  const headerHint =
    reactingNames.length > 0
      ? t("letters.hintReacting", { names: reactingNames.join("、") })
      : writingNames.length > 0
        ? t("letters.hintWriting", { names: writingNames.join("、") })
        : t("letters.hintIdle");

  return (
    <section className="letters-layout" aria-label={t("letters.ariaLabel")}>
      {backgroundSrc ? (
        <img alt="" aria-hidden="true" className="letters-background" src={backgroundSrc} />
      ) : null}
      <div className="letters-background-wash" />

      <header className="letters-header">
        <div className="letters-header-copy">
          <strong>{t("letters.title")}</strong>
          <span>{headerHint}</span>
        </div>
      </header>

      <ScrollShadow className="letters-stream" hideScrollBar orientation="vertical">
        {inTransit.length > 0 ? (
          <div className="keepsake-transit-group" aria-label={t("letters.inTransitAria")}>
            {inTransit.map((letter) => {
              const author = authors[letter.characterId] ?? fallbackAuthor;
              return (
                <div className={`keepsake-transit kind-${letter.kind}`} key={letter.id}>
                  <AuthorAvatar author={author} className="letter-author-avatar" />
                  <span className="keepsake-kind-icon" aria-hidden="true">
                    {KIND_ICON[letter.kind]}
                  </span>
                  <span className="keepsake-transit-text">
                    {t(`letters.transitVerb.${letter.kind}`, { name: author.name })}
                  </span>
                  <span className="keepsake-transit-eta">{formatKeepsakeEta(letter.deliverAt, effectiveNow)}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {delivered.map((letter) => {
          const author = authors[letter.characterId] ?? fallbackAuthor;
          const isOpen = openId === letter.id;
          const isUnread = letter.readAt === null;
          const reacted = letter.reaction;
          const isReacting = reactingNames.includes(author.name);
          return (
            <article
              className={`letter-card kind-${letter.kind} ${isOpen ? "is-open" : ""} ${isUnread ? "is-unread" : ""}`}
              key={letter.id}
            >
              <button
                type="button"
                className="letter-summary"
                onClick={() => openKeepsake(letter)}
                aria-expanded={isOpen}
              >
                {isUnread ? <span className="letter-unread-dot" aria-label={t("letters.unread")} /> : null}
                <AuthorAvatar author={author} className="letter-author-avatar" />
                <span className="keepsake-kind-icon" aria-hidden="true">
                  {KIND_ICON[letter.kind]}
                </span>
                <span className="letter-sender-tag">
                  {t("letters.senderTag", { name: author.name, kind: t(`letters.kind.${letter.kind}`) })}
                </span>
                <span className="letter-subject">{summaryTitle(letter, isOpen, t)}</span>
                <time className="letter-time">{formatLetterTime(letter.deliverAt, effectiveNow)}</time>
              </button>

              {isOpen ? (
                <div className="letter-body">
                  <KeepsakeBody letter={letter} authorName={author.name} />

                  {reacted ? (
                    <div className="keepsake-reaction-done" aria-label={t("letters.reactionDoneAria")}>
                      <span>{t("letters.youReacted")}</span>
                      {reacted.emoji ? <span className="keepsake-reaction-emoji">{reacted.emoji}</span> : null}
                      {reacted.text ? <span className="keepsake-reaction-text">{reacted.text}</span> : null}
                    </div>
                  ) : (
                    <div className="keepsake-reaction-bar">
                      <div className="keepsake-reaction-emojis">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            type="button"
                            key={emoji}
                            className="keepsake-reaction-pick"
                            onClick={() => sendReaction(letter, emoji)}
                            disabled={isReacting}
                            aria-label={t("letters.reactWith", { emoji })}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      <div className="keepsake-reaction-input">
                        <input
                          className="keepsake-reaction-field"
                          placeholder={t("letters.reactPlaceholder")}
                          value={reactText}
                          maxLength={120}
                          onChange={(event) => setReactText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && reactText.trim()) {
                              sendReaction(letter);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onPress={() => sendReaction(letter)}
                          isDisabled={isReacting || reactText.trim().length === 0}
                        >
                          {t("letters.react")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}

        {isEmpty ? (
          <div className="letters-empty" role="status">
            {t("letters.empty")}
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
