import { Avatar, Chip } from "@heroui/react";

import { buildCharacterCardViewModel } from "./character-card-view-model";

export function CharacterCardSettings() {
  const card = buildCharacterCardViewModel();

  return (
    <section className="character-card-settings" aria-label="角色卡设置">
      <header className="character-card-summary">
        <Avatar className="settings-character-avatar">
          <Avatar.Image alt={card.name} src={card.avatar} />
          <Avatar.Fallback>{card.name.slice(0, 1)}</Avatar.Fallback>
        </Avatar>
        <div>
          <span>{card.relationship}</span>
          <h3>{card.name}</h3>
          <p>{card.tagline}</p>
        </div>
      </header>

      <div className="character-card-grid">
        <article className="character-card-copy">
          <h4>人设</h4>
          <p>{card.persona}</p>
          <h4>背景</h4>
          <p>{card.storyBackground}</p>
          <h4>核心动机</h4>
          <p>{card.coreMotivation}</p>
          <h4>说话风格</h4>
          <p>{card.speakingStyle}</p>
          <h4>互动原则</h4>
          <ul className="character-card-list">
            {card.interactionPrinciples.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>沉浸提示</h4>
          <ul className="character-card-list">
            {card.immersionCues.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>初始问候</h4>
          <blockquote>{card.firstMessage}</blockquote>

          <div className="character-policy-list">
            {card.policies.map((policy) => (
              <div key={policy.label}>
                <span>{policy.label}</span>
                <strong>{policy.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="character-visual-preview">
          <img alt="" className="settings-card-bg" src={card.background} />
          <img alt={`${card.name} 立绘`} className="settings-card-portrait" src={card.portrait} />
        </article>
      </div>

      <section className="settings-sticker-section" aria-label="九宫格表情">
        <div>
          <h4>九宫格表情</h4>
          <p>对话时由 emotion、intent 和冷却时间决定是否偶尔发送。</p>
        </div>
        <div className="settings-sticker-grid">
          {card.stickers.map((sticker) => (
            <figure key={sticker.id}>
              <img alt={sticker.label} src={sticker.src} />
              <figcaption>{sticker.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className="character-card-actions">
        <Chip className="provider-status" size="sm" variant="soft">
          card.json 已校验
        </Chip>
        <Chip className="provider-status" size="sm" variant="soft">
          9 个表情已就绪
        </Chip>
      </footer>
    </section>
  );
}
