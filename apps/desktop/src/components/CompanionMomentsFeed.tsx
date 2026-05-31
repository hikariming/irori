import { Avatar, ScrollShadow } from "@heroui/react";

import { formatMomentTime, moodLabel, type CharacterMoment } from "./character-moments";
import type { CharacterChatPreview } from "./chat-model";

type CompanionMomentsFeedProps = {
  character: CharacterChatPreview;
  moments: CharacterMoment[];
  isPosting?: boolean;
  now?: number;
};

export function CompanionMomentsFeed({
  character: preview,
  moments,
  isPosting = false,
  now = Date.now()
}: CompanionMomentsFeedProps) {
  const name = preview.character.name;
  const isEmpty = moments.length === 0 && !isPosting;

  return (
    <section className="moments-layout" aria-label={`${name}的动态`}>
      <img
        alt=""
        aria-hidden="true"
        className="moments-background"
        src={preview.assets.background}
      />
      <div className="moments-background-wash" />

      <header className="moments-header">
        <Avatar className="moments-header-avatar">
          <Avatar.Image alt={name} src={preview.assets.avatar} />
          <Avatar.Fallback>{name.slice(0, 1)}</Avatar.Fallback>
        </Avatar>
        <div className="moments-header-copy">
          <strong>{name}的动态</strong>
          <span>她在自己的生活里随手记下的片段</span>
        </div>
      </header>

      <ScrollShadow className="moments-stream" hideScrollBar orientation="vertical">
        {isPosting ? (
          <article className="moment-card is-posting" aria-live="polite">
            <Avatar className="moment-avatar">
              <Avatar.Image alt={name} src={preview.assets.avatar} />
              <Avatar.Fallback>{name.slice(0, 1)}</Avatar.Fallback>
            </Avatar>
            <div className="moment-body">
              <header>
                <strong>{name}</strong>
                <time>正在记录…</time>
              </header>
              <div className="moment-posting-pulse">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            </div>
          </article>
        ) : null}

        {moments.map((moment) => {
          const mood = moodLabel(moment.mood);
          return (
            <article className="moment-card" key={moment.id}>
              <Avatar className="moment-avatar">
                <Avatar.Image alt={name} src={preview.assets.avatar} />
                <Avatar.Fallback>{name.slice(0, 1)}</Avatar.Fallback>
              </Avatar>
              <div className="moment-body">
                <header>
                  <strong>{name}</strong>
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
            {name}还没有发过动态。等她有了心情，会在这里留下生活片段。
          </div>
        ) : null}
      </ScrollShadow>
    </section>
  );
}
