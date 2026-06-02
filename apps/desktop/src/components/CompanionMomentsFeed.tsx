import { Avatar, ScrollShadow } from "@heroui/react";

import type { FeedAuthor } from "./character-cards";
import { formatMomentTime, moodLabel, type CharacterMoment } from "./character-moments";

type CompanionMomentsFeedProps = {
  moments: CharacterMoment[];
  authors: Record<string, FeedAuthor>;
  backgroundSrc?: string;
  postingAuthors?: FeedAuthor[];
  now?: number;
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

// 生活圈动态：把所有角色的动态汇成一条共享时间线，像朋友圈/Facebook 那样大家住在一起。
export function CompanionMomentsFeed({
  moments,
  authors,
  backgroundSrc,
  postingAuthors = [],
  now = Date.now()
}: CompanionMomentsFeedProps) {
  const isEmpty = moments.length === 0 && postingAuthors.length === 0;

  return (
    <section className="moments-layout" aria-label="生活圈动态">
      {backgroundSrc ? (
        <img alt="" aria-hidden="true" className="moments-background" src={backgroundSrc} />
      ) : null}
      <div className="moments-background-wash" />

      <header className="moments-header">
        <div className="moments-header-copy">
          <strong>生活圈</strong>
          <span>大家住在一起，随手记下的生活片段</span>
        </div>
      </header>

      <ScrollShadow className="moments-stream" hideScrollBar orientation="vertical">
        {postingAuthors.map((author) => (
          <article className="moment-card is-posting" aria-live="polite" key={`posting-${author.name}`}>
            <AuthorAvatar author={author} className="moment-avatar" />
            <div className="moment-body">
              <header>
                <strong>{author.name}</strong>
                <time>正在记录…</time>
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
          const author = authors[moment.characterId] ?? unknownAuthor;
          const mood = moodLabel(moment.mood);
          return (
            <article className="moment-card" key={moment.id}>
              <AuthorAvatar author={author} className="moment-avatar" />
              <div className="moment-body">
                <header>
                  <strong>{author.name}</strong>
                  <time>{formatMomentTime(moment.createdAt, now)}</time>
                </header>
                <p>{moment.text}</p>
                {mood ? <span className="moment-mood">{mood}</span> : null}
              </div>
            </article>
          );
        })}

        {isEmpty ? (
          <div className="moments-empty" role="status">
            大家还没有发过动态。等谁有了心情，会在这里留下生活片段。
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
