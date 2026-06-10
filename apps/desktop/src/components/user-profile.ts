// 「我」——用户自己的档案：名字/称呼、性别、偏好习惯、以及给所有角色看的自我介绍。
// 纯本地 localStorage（无向量、无后端依赖），聊天时注入 prompt，让角色知道在和谁说话。

export type UserGender = "unspecified" | "female" | "male" | "nonbinary";

export type UserProfile = {
  name: string; // 我希望被怎么称呼
  gender: UserGender;
  city: string; // 居住的城市
  preferences: string; // 偏好与习惯（喜欢/不喜欢/作息/称呼偏好…）
  selfIntroduction: string; // 对其他角色的展示内容 / 自我介绍
};

export const STORAGE_KEY = "irori-user-profile";

export const emptyUserProfile: UserProfile = {
  name: "",
  gender: "unspecified",
  city: "",
  preferences: "",
  selfIntroduction: ""
};

export const genderLabels: Record<UserGender, string> = {
  unspecified: "不愿透露",
  female: "女",
  male: "男",
  nonbinary: "非二元 / 其他"
};

export const genderOptions = Object.keys(genderLabels) as UserGender[];

const MAX_NAME = 40;
const MAX_CITY = 40;
const MAX_TEXT = 600;

function asText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function sanitizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object") {
    return { ...emptyUserProfile };
  }
  const entry = value as Record<string, unknown>;
  return {
    name: asText(entry.name, MAX_NAME),
    gender: genderOptions.includes(entry.gender as UserGender) ? (entry.gender as UserGender) : "unspecified",
    city: asText(entry.city, MAX_CITY),
    preferences: asText(entry.preferences, MAX_TEXT),
    selfIntroduction: asText(entry.selfIntroduction, MAX_TEXT)
  };
}

// 档案是否还完全是空的（用于首次引导判断）。
export function isUserProfileEmpty(profile: UserProfile): boolean {
  return (
    !profile.name.trim() &&
    !profile.city.trim() &&
    !profile.preferences.trim() &&
    !profile.selfIntroduction.trim() &&
    profile.gender === "unspecified"
  );
}

export function loadUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeUserProfile(JSON.parse(raw)) : { ...emptyUserProfile };
  } catch {
    return { ...emptyUserProfile };
  }
}

export function saveUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}

// 把档案整理成可注入聊天 prompt 的一段文字；完全为空时返回 null（不注入）。
export function describeUserProfileForPrompt(profile: UserProfile): string | null {
  const lines: string[] = [];
  if (profile.name) {
    lines.push(`ta 希望你称呼 ta 为「${profile.name}」。`);
  }
  if (profile.gender !== "unspecified") {
    lines.push(`性别：${genderLabels[profile.gender]}。`);
  }
  if (profile.city) {
    lines.push(`居住城市：${profile.city}。`);
  }
  if (profile.preferences) {
    lines.push(`偏好与习惯：${profile.preferences}`);
  }
  if (profile.selfIntroduction) {
    lines.push(`ta 的自我介绍：${profile.selfIntroduction}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

// 首次见面时，自动替用户「打」在屏幕上的第一人称自我介绍。空档案返回 ""。
export function buildFirstContactSelfIntro(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.name) {
    parts.push(`你可以叫我${profile.name}。`);
  }
  if (profile.gender !== "unspecified") {
    parts.push(`我是${genderLabels[profile.gender]}生。`);
  }
  if (profile.city) {
    parts.push(`我在${profile.city}。`);
  }
  if (profile.selfIntroduction) {
    parts.push(profile.selfIntroduction);
  }
  if (profile.preferences) {
    parts.push(`另外，${profile.preferences}`);
  }
  return parts.join("");
}

// 首次见面要直接种进角色长期记忆的「事实」条目（保证记住这个人是谁）。
export function buildFirstContactFacts(profile: UserProfile): Array<{ kind: "fact"; text: string }> {
  const facts: Array<{ kind: "fact"; text: string }> = [];
  if (profile.name) {
    facts.push({ kind: "fact", text: `用户希望被称呼为「${profile.name}」` });
  }
  if (profile.gender !== "unspecified") {
    facts.push({ kind: "fact", text: `用户性别：${genderLabels[profile.gender]}` });
  }
  if (profile.city) {
    facts.push({ kind: "fact", text: `用户居住在${profile.city}` });
  }
  if (profile.selfIntroduction) {
    facts.push({ kind: "fact", text: `用户的自我介绍：${profile.selfIntroduction}` });
  }
  return facts;
}
