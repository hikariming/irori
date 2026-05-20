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
  };
};

type CharacterProfile = {
  id: string;
  name: string;
  tagline: string;
  relationship: string;
  basePath: string;
  mood: {
    label: string;
  };
};

const characterProfiles = {
  shili: {
    id: "shili",
    name: "示璃",
    tagline: "安静但可靠的本地陪伴",
    relationship: "可信赖的陪伴型协作者",
    basePath: "/characters/shili.card",
    mood: {
      label: "稳定"
    }
  },
  lulin: {
    id: "lulin",
    name: "陆临",
    tagline: "深夜护短型本地搭档",
    relationship: "深夜护短型协作者",
    basePath: "/characters/lulin.card",
    mood: {
      label: "护短"
    }
  },
  shenyanzhou: {
    id: "shenyanzhou",
    name: "沈砚洲",
    tagline: "犀利反问型商业顾问",
    relationship: "犀利反问型商业顾问",
    basePath: "/characters/shenyanzhou.card",
    mood: {
      label: "锋利"
    }
  }
} satisfies Record<string, CharacterProfile>;

export type CharacterId = keyof typeof characterProfiles;

export function isCharacterId(value: string): value is CharacterId {
  return value in characterProfiles;
}

function getCharacterProfile(characterId: string = "shili") {
  return isCharacterId(characterId) ? characterProfiles[characterId] : characterProfiles.shili;
}

function characterAsset(profile: CharacterProfile, path: string) {
  return `${profile.basePath}/${path}`;
}

function buildCharacterStickers(profile: CharacterProfile): ChatSticker[] {
  return [
    { id: "neutral", emotion: "neutral", intent: "react", label: "中性", src: characterAsset(profile, "assets/stickers/neutral.png") },
    { id: "happy", emotion: "happy", intent: "celebrate", label: "开心", src: characterAsset(profile, "assets/stickers/happy.png") },
    { id: "thinking", emotion: "thinking", intent: "react", label: "思考", src: characterAsset(profile, "assets/stickers/thinking.png") },
    { id: "comfort", emotion: "comfort", intent: "comfort", label: "安慰", src: characterAsset(profile, "assets/stickers/comfort.png") },
    { id: "shy", emotion: "shy", intent: "tease", label: "害羞", src: characterAsset(profile, "assets/stickers/shy.png") },
    { id: "focused", emotion: "focused", intent: "nudge", label: "专注", src: characterAsset(profile, "assets/stickers/focused.png") },
    { id: "surprised", emotion: "surprised", intent: "react", label: "惊讶", src: characterAsset(profile, "assets/stickers/surprised.png") },
    { id: "worried", emotion: "worried", intent: "comfort", label: "担心", src: characterAsset(profile, "assets/stickers/worried.png") },
    { id: "proud", emotion: "proud", intent: "celebrate", label: "认可", src: characterAsset(profile, "assets/stickers/proud.png") }
  ];
}

export function buildCharacterChatPreview(characterId: string = "shili"): CharacterChatPreview {
  const profile = getCharacterProfile(characterId);

  return {
    character: {
      id: profile.id,
      name: profile.name,
      tagline: profile.tagline,
      relationship: profile.relationship
    },
    assets: {
      avatar: characterAsset(profile, "assets/avatar/avatar-circle.png"),
      portrait: characterAsset(profile, "assets/portraits/neutral.png"),
      background: characterAsset(profile, "assets/backgrounds/default.png")
    },
    mood: profile.mood,
    stickers: buildCharacterStickers(profile),
    messages: []
  };
}
