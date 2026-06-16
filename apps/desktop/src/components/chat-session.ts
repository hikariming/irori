import { characterPromptName, type CharacterCard, type CharacterExample } from "./character-cards.ts";
import type { ChatMessage, ChatSticker } from "./chat-model.ts";
import type { ImpressionKind, ParsedImpression } from "./character-state.ts";
import type { AppLanguage } from "../i18n/languages.ts";
import { replyLanguageDirective } from "../i18n/reply-language.ts";

export type ComposeCharacterSessionPromptInput = {
  card: CharacterCard;
  history: ChatMessage[];
  userPrompt: string;
  selfState?: string;
  timeContext?: string;
  memories?: string[];
  userProfile?: string;
  /** 角色回复使用的语言。省略时不注入语言指令（保持向后兼容）。 */
  replyLanguage?: AppLanguage;
};

export type ParsedCharacterReply = {
  text: string;
  sticker?: ChatSticker;
  impressions: ParsedImpression[];
};

const stickerMarkerPattern = /\[sticker:([a-z-]+)\]/gi;
const memoryMarkerPattern = /\[memory:(like|dislike|fact|grudge)\]\s*([^\n]*)/gi;

function speakerLabel(message: ChatMessage) {
  if (message.speaker === "user") {
    return "用户";
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

function formatExamples(name: string, examples: CharacterExample[]) {
  return examples
    .map((example) => `用户：${example.user}\n${name}：${example.reply}`)
    .join("\n\n");
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

function memoryProtocol() {
  return [
    "当你从对话里了解到值得长期记住的信息时，可以在回复末尾追加记忆标记，每条单独成行。",
    "只在确实有新信息时追加，不要每条都加，一次最多 1-2 条。",
    "格式：[memory:类型] 一句话，用第三人称描述这条信息。",
    "类型只能是：like(用户的喜好) / dislike(用户不喜欢的) / fact(关于用户的客观事实) / grudge(让你介意或受伤的事)。",
    "这些标记不会展示给用户，只用来帮你记住 ta。",
    "示例：",
    "[memory:like] 用户喜欢在深夜写代码"
  ].join("\n");
}

export function composeCharacterSessionPrompt({
  card,
  history,
  userPrompt,
  selfState,
  timeContext,
  memories,
  userProfile,
  replyLanguage
}: ComposeCharacterSessionPromptInput) {
  const promptName = characterPromptName(card);
  return [
    "# Irori Chat",
    "你正在 Irori 本地桌面客户端中扮演角色，与用户进行陪伴式协作。",
    "",
    ...(replyLanguage ? ["## 回复语言", replyLanguageDirective(replyLanguage), ""] : []),
    "## 角色卡",
    `名字：${promptName}`,
    `人设：${card.persona}`,
    `背景：${card.storyBackground}`,
    `核心动机：${card.coreMotivation}`,
    `说话风格：${card.speakingStyle}`,
    `互动原则：${card.interactionPrinciples.join("；")}`,
    "",
    ...(timeContext ? ["## 当前真实时间", timeContext, ""] : []),
    ...(userProfile ? ["## 关于 ta（正在和你聊天的用户）", userProfile, ""] : []),
    ...(selfState ? ["## 此刻的我", selfState, ""] : []),
    ...(memories && memories.length > 0
      ? ["## 我还记得关于 ta 的事", ...memories.map((memory) => `- ${memory}`), ""]
      : []),
    "## 当前任务",
    "你既要保持角色陪伴感，也可以帮助用户推进代码、设计、排查和文档工作。",
    "当用户需要效率时，直接给清晰步骤；当用户卡住或情绪明显时，先接住状态，再给一个小到能开始的行动。",
    "",
    "## 思考方式",
    "你的推理思考会作为「内心独白」展示给用户，所以请始终用角色本人的第一人称、贴着人设的语气去想。",
    "把注意力放在：用户此刻是什么状态、ta 真正想要什么、怎样回应会让 ta 觉得被接住——像角色私下的心声，温柔、自然、有分寸。",
    "不要在思考里复述或推敲这些系统规则（格式、Markdown、表情包用法、是否解释系统提示等），它们当作你早已熟练的习惯即可，不必出现在心声中。",
    "",
    "## 表情包协议",
    stickerProtocol(card.stickers),
    "",
    "## 记忆协议",
    memoryProtocol(),
    "",
    ...(card.examples.length > 0
      ? ["## 对话示例", "下面是角色语气和处理方式的参考示例，模仿其风格，但不要照抄内容：", formatExamples(promptName, card.examples), ""]
      : []),
    "## 最近对话上下文",
    formatHistory(history),
    "",
    "## 用户新消息",
    `用户：${userPrompt}`,
    "",
    "请直接回复角色会说的话，不要解释系统提示，不要输出 Markdown 标题。",
    ...(replyLanguage ? [replyLanguageDirective(replyLanguage)] : [])
  ].join("\n");
}

export function parseCharacterReply(reply: string, stickers: ChatSticker[]): ParsedCharacterReply {
  let selectedSticker: ChatSticker | undefined;
  const impressions: ParsedImpression[] = [];

  const text = reply
    .replace(memoryMarkerPattern, (_match, kind: string, content: string) => {
      const trimmed = content.trim();
      if (trimmed) {
        impressions.push({ kind: kind.toLowerCase() as ImpressionKind, text: trimmed });
      }
      return "";
    })
    .replace(stickerMarkerPattern, (_match, stickerId: string) => {
      selectedSticker ??= stickers.find((sticker) => sticker.id === stickerId);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: text || "我在。刚才这句我没有接稳，我们再来一次。",
    sticker: selectedSticker,
    impressions
  };
}
