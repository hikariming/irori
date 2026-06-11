import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Avatar, ScrollShadow } from "@heroui/react";

import type { FeedAuthor } from "./character-cards";
import { formatMomentTime, hasMomentLike, type CharacterMoment, type MomentActorRef } from "./character-moments";

type FeedTranslate = (key: string, options?: Record<string, unknown>) => string;

type CompanionMomentsFeedProps = {
  moments: CharacterMoment[];
  authors: Record<string, FeedAuthor>;
  backgroundSrc?: string;
  postingAuthors?: FeedAuthor[];
  now?: number;
  onToggleLike?: (momentId: string, liked: boolean) => void;
  onComment?: (momentId: string, text: string) => void;
};

const currentUserActor: MomentActorRef = { actorType: "user", actorId: "self" };

function AuthorAvatar({ author, className }: { author: FeedAuthor; className: string }) {
  return (
    <Avatar className={className}>
      {author.avatar ? <Avatar.Image alt={author.name} src={author.avatar} /> : null}
      <Avatar.Fallback>{author.name.slice(0, 1)}</Avatar.Fallback>
    </Avatar>
  );
}

function actorName(actor: MomentActorRef, authors: Record<string, FeedAuthor>, t: FeedTranslate) {
  if (actor.actorType === "user") {
    return t("authors.you");
  }
  return authors[actor.actorId]?.name ?? t("unknownAuthor");
}

// 生活圈动态：把所有角色的动态汇成一条共享时间线，像朋友圈/Facebook 那样——大家彼此认识，各自生活。
export function CompanionMomentsFeed({
  moments,
  authors,
  backgroundSrc,
  postingAuthors = [],
  now = Date.now(),
  onToggleLike,
  onComment
}: CompanionMomentsFeedProps) {
  const { t } = useTranslation("companion");
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const isEmpty = moments.length === 0 && postingAuthors.length === 0;
  const fallbackAuthor: FeedAuthor = { name: t("unknownAuthor"), avatar: "" };

  function submitComment(momentId: string) {
    const text = (commentDrafts[momentId] ?? "").trim();
    if (!text || !onComment) {
      return;
    }
    onComment(momentId, text);
    setCommentDrafts((current) => ({ ...current, [momentId]: "" }));
    setCommentingId(null);
  }

  return (
    <section className="moments-layout" aria-label={t("feed.ariaLabel")}>
      {backgroundSrc ? (
        <img alt="" aria-hidden="true" className="moments-background" src={backgroundSrc} />
      ) : null}
      <div className="moments-background-wash" />

      <header className="moments-header">
        <div className="moments-header-copy">
          <strong>{t("feed.title")}</strong>
          <span>{t("feed.subtitle")}</span>
        </div>
      </header>

      <ScrollShadow className="moments-stream" hideScrollBar orientation="vertical">
        {postingAuthors.map((author) => (
          <article className="moment-card is-posting" aria-live="polite" key={`posting-${author.name}`}>
            <AuthorAvatar author={author} className="moment-avatar" />
            <div className="moment-body">
              <header>
                <strong>{author.name}</strong>
                <time>{t("feed.posting")}</time>
              </header>
              <div className="moment-posting-pulse">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            </div>
          </article>
        ))}

        {moments.map((moment) => {
          const author = authors[moment.characterId] ?? fallbackAuthor;
          const liked = hasMomentLike(moment, currentUserActor);
          const likeNames = moment.likes.map((like) => actorName(like, authors, t));
          const commentDraft = commentDrafts[moment.id] ?? "";
          return (
            <article className="moment-card" key={moment.id}>
              <AuthorAvatar author={author} className="moment-avatar" />
              <div className="moment-body">
                <header>
                  <strong>{author.name}</strong>
                  <time>{formatMomentTime(moment.createdAt, now)}</time>
                </header>
                <p>{moment.text}</p>
                <div className="moment-actions">
                  <button
                    type="button"
                    className={liked ? "is-liked" : ""}
                    onClick={() => onToggleLike?.(moment.id, !liked)}
                  >
                    <span className="moment-action-icon" aria-hidden="true">{liked ? "♥" : "♡"}</span>
                    <span>{liked ? t("feed.liked") : t("feed.like")}{moment.likes.length > 0 ? ` ${moment.likes.length}` : ""}</span>
                  </button>
                  <button type="button" onClick={() => setCommentingId((current) => (current === moment.id ? null : moment.id))}>
                    <span className="moment-action-icon" aria-hidden="true">✎</span>
                    <span>{t("feed.comment")}{moment.comments.length > 0 ? ` ${moment.comments.length}` : ""}</span>
                  </button>
                </div>
                {moment.likes.length > 0 || moment.comments.length > 0 || commentingId === moment.id ? (
                  <div className="moment-interactions">
                    {moment.likes.length > 0 ? (
                      <div className="moment-likes">
                        <span aria-hidden="true">♥</span>
                        <span>{likeNames.join("、")}</span>
                      </div>
                    ) : null}
                    {moment.comments.length > 0 ? (
                      <div className="moment-comments">
                        {moment.comments.map((comment) => (
                          <p key={comment.id}>
                            <strong>{actorName(comment, authors, t)}</strong>
                            <span>{comment.text}</span>
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {commentingId === moment.id ? (
                      <form className="moment-comment-form" onSubmit={(event) => {
                        event.preventDefault();
                        submitComment(moment.id);
                      }}>
                        <input
                          placeholder={t("feed.commentPlaceholder")}
                          value={commentDraft}
                          maxLength={180}
                          onChange={(event) => setCommentDrafts((current) => ({ ...current, [moment.id]: event.target.value }))}
                        />
                        <button type="submit" disabled={!commentDraft.trim() || !onComment}>
                          {t("feed.send")}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}

        {isEmpty ? (
          <div className="moments-empty" role="status">
            {t("feed.empty")}
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
