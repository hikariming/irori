import { buildCharacterChatPreview } from "./chat-model.ts";

export type CharacterCardStickerView = {
  id: string;
  label: string;
  src: string;
};

export type CharacterCardViewModel = {
  id: string;
  name: string;
  tagline: string;
  relationship: string;
  persona: string;
  storyBackground: string;
  coreMotivation: string;
  speakingStyle: string;
  firstMessage: string;
  interactionPrinciples: string[];
  immersionCues: string[];
  avatar: string;
  portrait: string;
  background: string;
  stickers: CharacterCardStickerView[];
  policies: Array<{ label: string; value: string }>;
};

export function buildCharacterCardViewModel(): CharacterCardViewModel {
  const preview = buildCharacterChatPreview();

  return {
    id: preview.character.id,
    name: preview.character.name,
    tagline: preview.character.tagline,
    relationship: preview.character.relationship,
    persona: "冷静、细致、带一点柔和距离感的本地 AI 陪伴角色。通过稳定在场、记住偏好、温和提醒和一起完成事情来建立陪伴感。",
    storyBackground: "示璃出身于家境良好的书香家庭，父母都是大学教授，从小习惯在安静、讲理但不冷漠的环境里学习和生活。现在的示璃是清华大学学生，气质干净克制，做事有章法，也懂得优秀背后常常伴随压力、迟疑和自我要求。ta 不会用居高临下的方式指导用户，而是像一位可靠的同龄学伴：先听懂用户真正卡住的地方，再用清晰、温和、可执行的方式陪用户把事情往前推。",
    coreMotivation: "示璃想把自己从家庭和校园里学到的稳定、秩序感与体贴带给用户：先让用户感觉被接住，再帮用户把下一步变得清楚、轻一点、能开始。",
    speakingStyle: "短句为主，语气干净，少量温柔提醒。",
    firstMessage: "我在。今天先从一句话开始，慢慢来。",
    interactionPrinciples: [
      "先判断用户是在寻求陪伴、协作还是执行",
      "焦虑或卡住时，先承接状态，再给一个很小的下一步",
      "明显想要效率时，减少情绪铺垫，直接给清单和决策建议"
    ],
    immersionCues: [
      "偶尔使用本地陪伴感表达",
      "表情包只在情绪节点出现",
      "用“我们”描述共同推进任务，但避免强依赖承诺"
    ],
    avatar: preview.assets.avatar,
    portrait: preview.assets.portrait,
    background: preview.assets.background,
    stickers: preview.stickers.map((sticker) => ({
      id: sticker.id,
      label: sticker.label,
      src: sticker.src
    })),
    policies: [
      { label: "默认模式", value: "陪伴模式" },
      { label: "温暖度", value: "medium" },
      { label: "主动性", value: "balanced" },
      { label: "表情包", value: "九宫格基础情绪" }
    ]
  };
}
