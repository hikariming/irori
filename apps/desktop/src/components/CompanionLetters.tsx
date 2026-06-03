import { useState } from "react";

import { Avatar, Button, ScrollShadow } from "@heroui/react";

import type { FeedAuthor } from "./character-cards";
import {
  canSubmitLetterDraft,
  createInitialLetterDraft,
  formatLetterTime,
  isDelivered,
  toggleLetterDraftRecipient,
  type CharacterLetter,
  type CharacterLetterDraft
} from "./character-letters";

type ComposeTarget = FeedAuthor & { id: string };

type CompanionLettersProps = {
  letters: CharacterLetter[];
  authors: Record<string, FeedAuthor>;
  composeTarget: ComposeTarget | null;
  composeTargets?: ComposeTarget[];
  writingNames?: string[];
  sendingNames?: string[];
  backgroundSrc?: string;
  now?: number;
  onRead: (letterId: string) => void;
  onSend: (draft: CharacterLetterDraft) => void;
};

const unknownAuthor: FeedAuthor = { name: "神秘角色", avatar: "" };

function AuthorAvatar({ author, className }: { author: FeedAuthor; className: string }) {
  return (
    <Avatar className={className}>
      {author.avatar ? <Avatar.Image alt={author.name} src={author.avatar} /> : null}
      <Avatar.Fallback>{author.name.slice(0, 1)}</Avatar.Fallback>
    </Avatar>
  );
}

// 生活圈信箱：把所有角色写来 / 你寄出的信汇成一个信箱，按发件人头像区分，像一个统一收件箱。
export function CompanionLetters({
  letters,
  authors,
  composeTarget,
  composeTargets,
  writingNames = [],
  sendingNames = [],
  backgroundSrc,
  now = Date.now(),
  onRead,
  onSend
}: CompanionLettersProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CharacterLetterDraft | null>(null);
  const effectiveNow = Math.max(now, Date.now());

  const delivered = letters.filter((letter) => isDelivered(letter, effectiveNow));
  const inTransitCount = letters.length - delivered.length;
  const isEmpty = delivered.length === 0 && writingNames.length === 0 && inTransitCount === 0;
  const recipientOptions =
    composeTargets && composeTargets.length > 0
      ? composeTargets
      : Object.entries(authors).map(([id, author]) => ({ id, ...author }));
  const draftRecipients = draft
    ? draft.recipientIds.map((id) => ({ id, ...(authors[id] ?? unknownAuthor) }))
    : [];
  const draftRecipientNames = draftRecipients.map((recipient) => recipient.name);
  const draftRecipientLabel =
    draftRecipientNames.length > 0 ? draftRecipientNames.join("、") : "先选择收信人";

  function openLetter(letter: CharacterLetter) {
    setOpenId((current) => (current === letter.id ? null : letter.id));
    if (letter.sender === "character" && letter.readAt === null) {
      onRead(letter.id);
    }
  }

  function startCompose(characterId: string | null, replyTo: string | null, subjectSeed = "") {
    setDraft(createInitialLetterDraft(characterId, { replyTo, subject: subjectSeed }));
  }

  function submitDraft() {
    if (!draft || !canSubmitLetterDraft(draft) || sendingNames.length > 0) {
      return;
    }
    onSend(draft);
    setDraft(null);
  }

  const headerHint =
    sendingNames.length > 0
      ? `${sendingNames.join("、")}正在读你的信…`
      : writingNames.length > 0
        ? `${writingNames.join("、")}正在提笔…`
        : inTransitCount > 0
          ? `有 ${inTransitCount} 封信还在路上`
          : "写封信给谁，过些时候 ta 会回你";

  return (
    <section className="letters-layout" aria-label="生活圈信箱">
      {backgroundSrc ? (
        <img alt="" aria-hidden="true" className="letters-background" src={backgroundSrc} />
      ) : null}
      <div className="letters-background-wash" />

      <header className="letters-header">
        <div className="letters-header-copy">
          <strong>信箱</strong>
          <span>{headerHint}</span>
        </div>
        {composeTarget ? (
          <Button
            className="letters-compose-btn"
            size="sm"
            variant="primary"
            onPress={() => startCompose(composeTarget.id, null)}
            isDisabled={draft !== null || recipientOptions.length === 0}
          >
            写信
          </Button>
        ) : null}
      </header>

      <ScrollShadow className="letters-stream" hideScrollBar orientation="vertical">
        {draft ? (
          <article className="letter-composer">
            <div className="letter-recipient-picker" aria-label="选择收信人">
              <span>收信人</span>
              <div className="letter-recipient-options">
                {recipientOptions.map((target) => {
                  const selected = draft.recipientIds.includes(target.id);
                  return (
                    <button
                      type="button"
                      className={`letter-recipient-chip ${selected ? "is-selected" : ""}`}
                      key={target.id}
                      onClick={() => setDraft(toggleLetterDraftRecipient(draft, target.id))}
                      aria-pressed={selected}
                      disabled={Boolean(draft.replyTo)}
                    >
                      <AuthorAvatar author={target} className="letter-recipient-avatar" />
                      <span>{target.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              className="letter-composer-subject"
              placeholder="主题（可留空）"
              value={draft.subject}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            />
            <textarea
              className="letter-composer-body"
              placeholder={`写点什么给${draftRecipientLabel}…`}
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
                isDisabled={!canSubmitLetterDraft(draft) || sendingNames.length > 0}
              >
                {draft.replyTo ? "回信" : draft.recipientIds.length > 1 ? `寄给 ${draft.recipientIds.length} 人` : "寄出"}
              </Button>
            </div>
          </article>
        ) : null}

        {delivered.map((letter) => {
          const author = authors[letter.characterId] ?? unknownAuthor;
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
                <AuthorAvatar author={author} className="letter-author-avatar" />
                <span className="letter-sender-tag">{fromUser ? `你寄给${author.name}` : `${author.name}写来`}</span>
                <span className="letter-subject">{letter.subject}</span>
                <time className="letter-time">{formatLetterTime(letter.deliverAt, effectiveNow)}</time>
              </button>
              {isOpen ? (
                <div className="letter-body">
                  <p>{letter.body}</p>
                  <footer>—— {fromUser ? "你" : author.name}</footer>
                  {!fromUser ? (
                    <Button
                      className="letter-reply-btn"
                      size="sm"
                      variant="secondary"
                      onPress={() => startCompose(letter.characterId, letter.id, `回复：${letter.subject}`)}
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
            还没有信件往来。给大家写第一封信，过些时候 ta 会回你。
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
