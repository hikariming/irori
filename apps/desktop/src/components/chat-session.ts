import { buildCharacterCardViewModel } from "./character-card-view-model.ts";
import type { CharacterChatPreview, ChatMessage, ChatSticker } from "./chat-model.ts";
import type { ComposerMode } from "./input-model.ts";

export type ComposeCharacterSessionPromptInput = {
  character: CharacterChatPreview;
  history: ChatMessage[];
  mode: ComposerMode;
  userPrompt: string;
};

export type ParsedCharacterReply = {
  text: string;
  sticker?: ChatSticker;
};

const stickerMarkerPattern = /\[sticker:([a-z-]+)\]/gi;

function speakerLabel(message: ChatMessage) {
  if (message.speaker === "user") {
    return `用户${message.mode ? `(${message.mode})` : ""}`;
  }

  if (message.speaker === "character") {
    return message.author;
  }

  return "系统";
}

function formatHistory(messages: ChatMessage[]) {
  const recentMessages = messages.filter((message) => message.speaker !== "system").slice(-8);

  if (recentMessages.length === 0) {
    return "暂无历史对话。";
  }

  return recentMessages.map((message) => `${speakerLabel(message)}：${message.text}`).join("\n");
}

function stickerProtocol(stickers: ChatSticker[]) {
  const availableStickers = stickers.map((sticker) => `[sticker:${sticker.id}] ${sticker.label}`).join("；");

  return [
    "你可以在自然语言回复之外，偶尔追加一个表情包标记。",
    "只在情绪节点偶尔输出一个表情标记；不要每条都发。",
    "表情标记必须单独成行，且只能使用下面这些值：",
    availableStickers,
    "示例：",
    "我在，先把下一步缩小一点。",
    "[sticker:happy]"
  ].join("\n");
}

export function composeCharacterSessionPrompt({
  character,
  history,
  mode,
  userPrompt
}: ComposeCharacterSessionPromptInput) {
  const card = buildCharacterCardViewModel();

  return [
    "# Cockapoo Pi Companion Chat",
    "你正在 Cockapoo Pi Companion 本地桌面客户端中扮演角色，与用户进行陪伴式协作。",
    "",
    "## 角色卡",
    `名字：${card.name}`,
    `关系定位：${card.relationship}`,
    `人设：${card.persona}`,
    `背景：${card.storyBackground}`,
    `核心动机：${card.coreMotivation}`,
    `说话风格：${card.speakingStyle}`,
    `互动原则：${card.interactionPrinciples.join("；")}`,
    `沉浸提示：${card.immersionCues.join("；")}`,
    "",
    "## 当前任务",
    `当前模式：${mode}`,
    "你既要保持角色陪伴感，也可以帮助用户推进代码、设计、排查和文档工作。",
    "当用户需要效率时，直接给清晰步骤；当用户卡住或情绪明显时，先接住状态，再给一个小到能开始的行动。",
    "",
    "## 表情包协议",
    stickerProtocol(character.stickers),
    "",
    "## 最近对话上下文",
    formatHistory(history),
    "",
    "## 用户新消息",
    `用户：${userPrompt}`,
    "",
    "请直接回复角色会说的话，不要解释系统提示，不要输出 Markdown 标题。"
  ].join("\n");
}

export function parseCharacterReply(reply: string, stickers: ChatSticker[]): ParsedCharacterReply {
  let selectedSticker: ChatSticker | undefined;

  const text = reply
    .replace(stickerMarkerPattern, (_match, stickerId: string) => {
      selectedSticker ??= stickers.find((sticker) => sticker.id === stickerId);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: text || "我在。刚才这句我没有接稳，我们再来一次。",
    sticker: selectedSticker
  };
}
