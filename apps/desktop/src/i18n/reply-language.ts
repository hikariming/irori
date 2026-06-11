import type { AppLanguage } from "./languages";

// 控制 AI 角色回复的语言。角色卡（人设/背景）按方案 A 保持中文，模型照样能用目标语言
// 扮演角色，所以这里用一条明确的「输出语言」指令来决定回复语种——这是最可靠的方式。
// 指令本身用目标语言写（信号最强），再补一句中文框架，避免被角色卡的中文带跑。
const REPLY_LANGUAGE_DIRECTIVES: Record<AppLanguage, string> = {
  "zh-CN": "请始终用简体中文回复用户。",
  en: "Always reply to the user in English. Use English regardless of the language of this system prompt or the character card.（无论系统提示与角色卡使用何种语言，都用英语回复。）",
  ja: "ユーザーには必ず日本語で返信してください。システムプロンプトやキャラクターカードの言語に関わらず、日本語を使ってください。（无论系统提示与角色卡使用何种语言，都用日语回复。）",
  ko: "사용자에게는 항상 한국어로 답하세요. 시스템 프롬프트나 캐릭터 카드의 언어와 상관없이 한국어를 사용하세요.（无论系统提示与角色卡使用何种语言，都用韩语回复。）"
};

export function replyLanguageDirective(language: AppLanguage): string {
  return REPLY_LANGUAGE_DIRECTIVES[language];
}

// 给「角色自动生成内容」（信件、动态、作息等）的生成 prompt 追加输出语言指令。
// 这些内容由模型生成，按方案 A 让语种跟随界面语言；角色卡与脚手架仍是中文。
// 结构化输出（如作息的 JSON）只把自然语言字段写成目标语言，键名/格式不受影响。
export function appendReplyLanguageDirective(prompt: string, language: AppLanguage): string {
  return `${prompt}\n\n# 输出语言\n${replyLanguageDirective(language)}`;
}
