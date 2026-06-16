import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Locale = "zh" | "en" | "ja" | "ko";

type Copy = {
  nav: string[];
  langLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: string;
  secondaryCta: string;
  githubBadge: string;
  screenshotKicker: string;
  screenshotTitle: string;
  screenshotBody: string;
  badges: string[];
  featuresTitle: string;
  featuresLead: string;
  features: Array<{ title: string; body: string }>;
  overviewTitle: string;
  overviewLead: string;
  overview: Array<{ value: string; label: string }>;
  charactersTitle: string;
  charactersLead: string;
  characterCards: Array<{ name: string; role: string }>;
  ctaTitle: string;
  ctaBody: string;
  footer: string;
};

const copy: Record<Locale, Copy> = {
  zh: {
    nav: ["功能", "角色", "开源", "下载"],
    langLabel: "语言",
    eyebrow: "本地优先的角色陪伴桌面应用",
    title: "Irori",
    subtitle: "让角色卡、记忆、模型配置和工具安全门，变成真正陪你思考、写作、写代码和规划的本地搭档。",
    primaryCta: "下载 Irori",
    secondaryCta: "查看 GitHub",
    githubBadge: "Apache-2.0 开源",
    screenshotKicker: "真实系统截图",
    screenshotTitle: "不是聊天皮肤，而是一个角色驱动的工作台。",
    screenshotBody:
      "Irori 把 Tauri 桌面端、Pi agent runtime、角色卡、本地记忆和工具确认流程放在同一个空间里。每个角色都有独立语气、状态和协作方式。",
    badges: ["角色卡", "本地记忆", "模型预设", "工具安全"],
    featuresTitle: "为长期陪伴和认真协作而做",
    featuresLead: "Irori 的重点不是让模型换个头像，而是让角色、上下文和工作流都能稳定沉淀在你的本地设备上。",
    features: [
      {
        title: "角色卡系统",
        body: "内置角色可以直接使用，也可以替换、编辑或创作自己的角色卡，定义人设、语气、头像、提示词片段和协作方式。"
      },
      {
        title: "本地优先记忆",
        body: "偏好、项目重点、协作习惯等上下文保存在本地，减少重复说明，也让长期沟通更像真正熟悉你的搭档。"
      },
      {
        title: "工作流协作",
        body: "角色可以拆解需求、跟进进度、整理结论，适合写作、编码、计划、复盘和日常任务推进。"
      },
      {
        title: "模型与工具安全",
        body: "支持 OpenAI 兼容模型配置、供应商预设和工具确认策略，在可控边界内让 agent 使用本地能力。"
      }
    ],
    overviewTitle: "桌面优先，开源可改",
    overviewLead: "从角色资源到运行时适配层，Irori 保持清晰的工程边界，方便开发者扩展自己的陪伴体验。",
    overview: [
      { value: "Tauri + React", label: "原生桌面外壳与现代前端体验" },
      { value: "Pi SDK", label: "基于 coding-agent runtime 的会话能力" },
      { value: "Cards", label: "可替换、可创作、可分发的角色包" },
      { value: "Local", label: "记忆、设置与工作区都以本地为中心" }
    ],
    charactersTitle: "每个角色都有自己的工作方式",
    charactersLead: "温柔拆解、冷静推导、稳定陪伴、行动规划，都可以通过角色卡成为不同的协作入口。",
    characterCards: [
      { name: "示璃", role: "稳定、细致的同龄学伴" },
      { name: "唐愿", role: "温柔但坚定的本地 AI 协作者" },
      { name: "岑霁", role: "结构感极强的算法工程师" }
    ],
    ctaTitle: "把你的角色搭档带到本地。",
    ctaBody: "下载桌面端，或从源码开始改造角色卡、记忆后端和工作流。",
    footer: "Irori is open-source under the Apache-2.0 license."
  },
  en: {
    nav: ["Features", "Characters", "Open Source", "Download"],
    langLabel: "Language",
    eyebrow: "Local-first desktop companions",
    title: "Irori",
    subtitle:
      "Character cards, memory, model settings, and tool safety gates become local companions for thinking, writing, coding, and planning.",
    primaryCta: "Download Irori",
    secondaryCta: "View on GitHub",
    githubBadge: "Apache-2.0 open source",
    screenshotKicker: "Real app screenshot",
    screenshotTitle: "Not a chat skin. A character-driven workspace.",
    screenshotBody:
      "Irori brings a Tauri desktop shell, Pi agent runtime, character cards, local memory, and confirmation flows into one companion workspace.",
    badges: ["Character Cards", "Local Memory", "Model Presets", "Tool Safety"],
    featuresTitle: "Built for long-term companionship and serious work",
    featuresLead:
      "Irori is not just an avatar on top of a model. It lets characters, context, and workflow live locally and keep continuity.",
    features: [
      {
        title: "Character cards",
        body: "Use bundled companions or create your own cards with identity, voice, artwork, prompt fragments, and working style."
      },
      {
        title: "Local-first memory",
        body: "Preferences, project context, and collaboration habits stay on your device so repeated conversations need less setup."
      },
      {
        title: "Workflow support",
        body: "Companions can break down requirements, track progress, organize conclusions, and help with writing, code, planning, and reviews."
      },
      {
        title: "Model and tool safety",
        body: "OpenAI-compatible provider settings, model presets, review modes, and confirmation gates keep agent work under your control."
      }
    ],
    overviewTitle: "Desktop-first and open to change",
    overviewLead:
      "From character assets to runtime adapters, Irori keeps clear engineering boundaries for developers who want to extend it.",
    overview: [
      { value: "Tauri + React", label: "Native desktop shell with a modern frontend" },
      { value: "Pi SDK", label: "Sessions powered by a coding-agent runtime" },
      { value: "Cards", label: "Replaceable and shareable character packages" },
      { value: "Local", label: "Memory, settings, and workspaces centered on your device" }
    ],
    charactersTitle: "Every character works differently",
    charactersLead:
      "Gentle task breakdown, cool logical review, steady companionship, and action planning can all become separate collaboration modes.",
    characterCards: [
      { name: "Shili", role: "Calm, careful study partner" },
      { name: "Tangyuan", role: "Warm, decisive local AI collaborator" },
      { name: "Cenji", role: "Highly structured algorithm engineer" }
    ],
    ctaTitle: "Bring your companion workspace local.",
    ctaBody: "Download the desktop app, or start from source and customize cards, memory, and workflows.",
    footer: "Irori is open-source under the Apache-2.0 license."
  },
  ja: {
    nav: ["機能", "キャラクター", "オープンソース", "ダウンロード"],
    langLabel: "言語",
    eyebrow: "ローカルファーストのデスクトップ companion",
    title: "Irori",
    subtitle:
      "キャラクターカード、記憶、モデル設定、ツール確認を、考える・書く・コードを書く・計画するためのローカルな相棒に。",
    primaryCta: "Irori をダウンロード",
    secondaryCta: "GitHub を見る",
    githubBadge: "Apache-2.0 オープンソース",
    screenshotKicker: "実際のアプリ画面",
    screenshotTitle: "ただのチャット外観ではなく、キャラクター中心の作業空間。",
    screenshotBody:
      "Irori は Tauri デスクトップ、Pi agent runtime、キャラクターカード、ローカル記憶、確認フローを一つの空間にまとめます。",
    badges: ["キャラクターカード", "ローカル記憶", "モデルプリセット", "ツール安全性"],
    featuresTitle: "長く寄り添い、真面目に協作するために",
    featuresLead:
      "Irori はモデルにアバターを載せるだけではありません。キャラクター、文脈、ワークフローをローカルに蓄積します。",
    features: [
      {
        title: "キャラクターカード",
        body: "内蔵キャラクターを使うことも、自分の人物像、声、画像、プロンプト、作業スタイルを持つカードを作ることもできます。"
      },
      {
        title: "ローカルファースト記憶",
        body: "好み、プロジェクト文脈、協作習慣をデバイス上に保ち、毎回説明し直す負担を減らします。"
      },
      {
        title: "ワークフロー支援",
        body: "要件分解、進捗確認、結論整理、文章・コード・計画・振り返りをキャラクターが支援します。"
      },
      {
        title: "モデルとツール安全性",
        body: "OpenAI 互換設定、モデルプリセット、レビュー方式、確認ゲートで agent の作業を制御できます。"
      }
    ],
    overviewTitle: "デスクトップ中心、自由に改造可能",
    overviewLead:
      "キャラクター素材から runtime adapter まで境界を明確にし、開発者が独自の体験を拡張しやすくしています。",
    overview: [
      { value: "Tauri + React", label: "ネイティブ shell とモダン frontend" },
      { value: "Pi SDK", label: "coding-agent runtime によるセッション" },
      { value: "Cards", label: "差し替え・作成・配布できる character package" },
      { value: "Local", label: "記憶、設定、ワークスペースは端末中心" }
    ],
    charactersTitle: "キャラクターごとに違う働き方",
    charactersLead: "やさしい分解、冷静な推論、安定した同伴、行動計画を、それぞれ別の協作入口にできます。",
    characterCards: [
      { name: "示璃", role: "落ち着いた、丁寧な学びの相棒" },
      { name: "唐愿", role: "やさしくも芯のある AI 協作者" },
      { name: "岑霁", role: "構造化に強いアルゴリズムエンジニア" }
    ],
    ctaTitle: "相棒の作業空間をローカルへ。",
    ctaBody: "デスクトップ版を使うか、ソースからカード、記憶、ワークフローを改造できます。",
    footer: "Irori is open-source under the Apache-2.0 license."
  },
  ko: {
    nav: ["기능", "캐릭터", "오픈소스", "다운로드"],
    langLabel: "언어",
    eyebrow: "로컬 우선 데스크톱 캐릭터 companion",
    title: "Irori",
    subtitle:
      "캐릭터 카드, 기억, 모델 설정, 도구 확인 흐름을 생각하기, 글쓰기, 코딩, 계획을 돕는 로컬 동료로 만듭니다.",
    primaryCta: "Irori 다운로드",
    secondaryCta: "GitHub 보기",
    githubBadge: "Apache-2.0 오픈소스",
    screenshotKicker: "실제 앱 스크린샷",
    screenshotTitle: "채팅 스킨이 아니라 캐릭터가 이끄는 작업 공간입니다.",
    screenshotBody:
      "Irori는 Tauri 데스크톱, Pi agent runtime, 캐릭터 카드, 로컬 기억, 도구 확인 흐름을 하나의 companion workspace로 묶습니다.",
    badges: ["캐릭터 카드", "로컬 기억", "모델 프리셋", "도구 안전"],
    featuresTitle: "오래 함께하고 진지하게 협업하기 위해",
    featuresLead:
      "Irori는 모델 위에 아바타만 얹지 않습니다. 캐릭터, 맥락, 워크플로가 로컬에서 이어지도록 설계되었습니다.",
    features: [
      {
        title: "캐릭터 카드",
        body: "내장 캐릭터를 바로 쓰거나, 정체성, 말투, 이미지, 프롬프트, 작업 방식을 담은 카드를 직접 만들 수 있습니다."
      },
      {
        title: "로컬 우선 기억",
        body: "선호, 프로젝트 맥락, 협업 습관을 기기에 저장해 반복 설명을 줄이고 대화의 연속성을 높입니다."
      },
      {
        title: "워크플로 지원",
        body: "요구사항 분해, 진행 추적, 결론 정리, 글쓰기, 코딩, 계획, 회고를 캐릭터가 함께 처리합니다."
      },
      {
        title: "모델과 도구 안전",
        body: "OpenAI 호환 제공자 설정, 모델 프리셋, 리뷰 모드, 확인 게이트로 agent 작업을 제어합니다."
      }
    ],
    overviewTitle: "데스크톱 우선, 자유롭게 확장",
    overviewLead:
      "캐릭터 리소스부터 런타임 어댑터까지 경계가 명확해 개발자가 자신만의 companion 경험을 만들기 쉽습니다.",
    overview: [
      { value: "Tauri + React", label: "네이티브 shell과 현대적인 frontend" },
      { value: "Pi SDK", label: "coding-agent runtime 기반 세션" },
      { value: "Cards", label: "교체, 제작, 배포 가능한 캐릭터 패키지" },
      { value: "Local", label: "기억, 설정, 작업 공간은 기기 중심" }
    ],
    charactersTitle: "캐릭터마다 다른 협업 방식",
    charactersLead: "부드러운 분해, 차분한 추론, 안정적인 동행, 실행 계획을 각기 다른 협업 입구로 만들 수 있습니다.",
    characterCards: [
      { name: "示璃", role: "차분하고 세심한 학습 파트너" },
      { name: "唐愿", role: "따뜻하지만 단단한 로컬 AI 협업자" },
      { name: "岑霁", role: "구조화에 강한 알고리즘 엔지니어" }
    ],
    ctaTitle: "당신의 companion workspace를 로컬로.",
    ctaBody: "데스크톱 앱을 내려받거나, 소스에서 카드, 기억, 워크플로를 직접 바꿔보세요.",
    footer: "Irori is open-source under the Apache-2.0 license."
  }
};

const locales: Array<{ id: Locale; label: string }> = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" }
];

const githubUrl = "https://github.com/hikariming/irori";

function initialLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "zh";
  }
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("en")) return "en";
  return "zh";
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => initialLocale());
  const t = copy[locale];
  const documentLang = useMemo(() => {
    return locale === "zh" ? "zh-CN" : locale;
  }, [locale]);

  if (typeof document !== "undefined") {
    document.documentElement.lang = documentLang;
  }

  return (
    <div className="site-shell">
      <header className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Irori home">
          <img src="/assets/irori-logo.png" alt="" />
          <span>Irori</span>
        </a>
        <nav className="nav-links">
          <a href="#features">{t.nav[0]}</a>
          <a href="#characters">{t.nav[1]}</a>
          <a href={githubUrl} target="_blank" rel="noreferrer">
            {t.nav[2]}
          </a>
          <a href="#download">{t.nav[3]}</a>
        </nav>
        <div className="language-switcher" aria-label={t.langLabel}>
          {locales.map((item) => (
            <button
              key={item.id}
              className={item.id === locale ? "active" : ""}
              type="button"
              onClick={() => setLocale(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-bg" />
          <div className="hero-content">
            <div className="hero-copy">
              <p className="eyebrow">{t.eyebrow}</p>
              <h1>{t.title}</h1>
              <p className="subtitle">{t.subtitle}</p>
              <div className="hero-actions">
                <a className="button primary" href="#download">
                  {t.primaryCta}
                </a>
                <a className="button secondary" href={githubUrl} target="_blank" rel="noreferrer">
                  {t.secondaryCta}
                </a>
              </div>
              <p className="open-source-badge">{t.githubBadge}</p>
            </div>
            <div className="product-stage" aria-label={t.screenshotKicker}>
              <div className="window-bar">
                <span />
                <span />
                <span />
                <strong>Irori Desktop</strong>
              </div>
              <img
                className="system-shot"
                src="/assets/irori-system-screenshot.png"
                alt={t.screenshotKicker}
              />
            </div>
          </div>
          <div className="fold-peek">
            {t.badges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
        </section>

        <section className="screenshot-story">
          <div>
            <p className="section-kicker">{t.screenshotKicker}</p>
            <h2>{t.screenshotTitle}</h2>
          </div>
          <p>{t.screenshotBody}</p>
        </section>

        <section className="features" id="features">
          <div className="section-heading">
            <p className="section-kicker">{t.nav[0]}</p>
            <h2>{t.featuresTitle}</h2>
            <p>{t.featuresLead}</p>
          </div>
          <div className="feature-grid">
            {t.features.map((feature, index) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-index">{String(index + 1).padStart(2, "0")}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="overview">
          <div className="section-heading compact">
            <p className="section-kicker">{t.nav[2]}</p>
            <h2>{t.overviewTitle}</h2>
            <p>{t.overviewLead}</p>
          </div>
          <div className="overview-grid">
            {t.overview.map((item) => (
              <article key={item.value}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="characters" id="characters">
          <div className="character-art">
            <img src="/assets/irori-character-hero.png" alt="" />
          </div>
          <div className="character-copy">
            <p className="section-kicker">{t.nav[1]}</p>
            <h2>{t.charactersTitle}</h2>
            <p>{t.charactersLead}</p>
            <div className="character-list">
              {t.characterCards.map((character) => (
                <article key={character.name}>
                  <strong>{character.name}</strong>
                  <span>{character.role}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="download" id="download">
          <img src="/assets/irori-logo.png" alt="" />
          <h2>{t.ctaTitle}</h2>
          <p>{t.ctaBody}</p>
          <div className="hero-actions">
            <a className="button primary" href={githubUrl} target="_blank" rel="noreferrer">
              {t.secondaryCta}
            </a>
            <a className="button secondary" href="#top">
              {t.primaryCta}
            </a>
          </div>
        </section>
      </main>

      <footer>
        <span>{t.footer}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
