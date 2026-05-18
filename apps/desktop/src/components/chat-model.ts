export type ChatSpeaker = "user" | "character" | "system";

export const requiredStickerIds = [
  "neutral",
  "happy",
  "thinking",
  "comfort",
  "shy",
  "focused",
  "surprised",
  "worried",
  "proud"
] as const;

export type StickerId = (typeof requiredStickerIds)[number];

export type ChatSticker = {
  id: StickerId;
  src: string;
  emotion: StickerId;
  intent: "react" | "comfort" | "celebrate" | "nudge" | "tease";
  label: string;
};

export type ChatMessage = {
  id: string;
  speaker: ChatSpeaker;
  author: string;
  text: string;
  time: string;
  sticker?: ChatSticker;
  mode?: "companion" | "task" | "agent";
};

export type CharacterChatPreview = {
  character: {
    id: string;
    name: string;
    tagline: string;
    relationship: string;
  };
  assets: {
    avatar: string;
    portrait: string;
    background: string;
  };
  stickers: ChatSticker[];
  messages: ChatMessage[];
  mood: {
    label: string;
    description: string;
  };
};

const shiliBasePath = "/characters/shili.card";

function shiliAsset(path: string) {
  return `${shiliBasePath}/${path}`;
}

const shiliStickers: ChatSticker[] = [
  { id: "neutral", emotion: "neutral", intent: "react", label: "中性", src: shiliAsset("assets/stickers/neutral.png") },
  { id: "happy", emotion: "happy", intent: "celebrate", label: "开心", src: shiliAsset("assets/stickers/happy.png") },
  { id: "thinking", emotion: "thinking", intent: "react", label: "思考", src: shiliAsset("assets/stickers/thinking.png") },
  { id: "comfort", emotion: "comfort", intent: "comfort", label: "安慰", src: shiliAsset("assets/stickers/comfort.png") },
  { id: "shy", emotion: "shy", intent: "tease", label: "害羞", src: shiliAsset("assets/stickers/shy.png") },
  { id: "focused", emotion: "focused", intent: "nudge", label: "专注", src: shiliAsset("assets/stickers/focused.png") },
  { id: "surprised", emotion: "surprised", intent: "react", label: "惊讶", src: shiliAsset("assets/stickers/surprised.png") },
  { id: "worried", emotion: "worried", intent: "comfort", label: "担心", src: shiliAsset("assets/stickers/worried.png") },
  { id: "proud", emotion: "proud", intent: "celebrate", label: "认可", src: shiliAsset("assets/stickers/proud.png") }
];

export function buildCharacterChatPreview(): CharacterChatPreview {
  return {
    character: {
      id: "shili",
      name: "示璃",
      tagline: "安静但可靠的本地陪伴",
      relationship: "可信赖的陪伴型协作者"
    },
    assets: {
      avatar: shiliAsset("assets/avatar/avatar-circle.png"),
      portrait: shiliAsset("assets/portraits/neutral.png"),
      background: shiliAsset("assets/backgrounds/default.png")
    },
    mood: {
      label: "稳定",
      description: "先接住情绪，再给出一个可执行的小步骤。"
    },
    stickers: shiliStickers,
    messages: []
  };
}
