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

export type StickerIntent = "react" | "comfort" | "celebrate" | "nudge" | "tease";

export type ChatSticker = {
  id: StickerId;
  src: string;
  emotion: StickerId;
  intent: StickerIntent;
  label: string;
  textFallback?: string;
};

export type ChatMessage = {
  id: string;
  speaker: ChatSpeaker;
  author: string;
  text: string;
  time: string;
  sticker?: ChatSticker;
  reasoning?: string;
};

export type CharacterChatPreview = {
  character: {
    id: string;
    name: string;
  };
  assets: {
    avatar: string;
    portrait: string;
    background: string;
  };
  stickers: ChatSticker[];
  messages: ChatMessage[];
};

export const stickerMeta: Record<StickerId, { label: string; intent: StickerIntent }> = {
  neutral: { label: "中性", intent: "react" },
  happy: { label: "开心", intent: "celebrate" },
  thinking: { label: "思考", intent: "react" },
  comfort: { label: "安慰", intent: "comfort" },
  shy: { label: "害羞", intent: "tease" },
  focused: { label: "专注", intent: "nudge" },
  surprised: { label: "惊讶", intent: "react" },
  worried: { label: "担心", intent: "comfort" },
  proud: { label: "认可", intent: "celebrate" }
};
