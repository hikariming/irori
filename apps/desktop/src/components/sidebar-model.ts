import type { CharacterCard } from "./character-cards.ts";
import { isCharacterVisibleInSidebar, type CharacterPreferences } from "./character-preferences.ts";

export type CharacterStatus = "online" | "idle";

export type CompanionCharacterStateSummary = {
  affinity: number;
  affinityTierLabel: string;
  moodLabel: string;
  energy: number;
  energyLabel: string;
  meetLabel: string;
};

export type CompanionCharacter = {
  id: string;
  name: string;
  status: CharacterStatus;
  active: boolean;
  activityStatus?: string;
  avatarSrc?: string;
  stateSummary?: CompanionCharacterStateSummary;
  themeColor?: string;
  unreadCount?: number; // 已送达但未读的角色来信数，用于侧边栏红点
};

export type SessionItem = {
  id: string;
  title: string;
  time: string;
  active: boolean;
};

export type SessionGroup = {
  group: string;
  items: SessionItem[];
};

export function buildSidebarCharacters(
  cards: CharacterCard[],
  activeCharacterId: string,
  preferences: CharacterPreferences = {},
  unreadByCharacter: Record<string, number> = {},
  activityByCharacter: Record<string, string> = {},
  stateSummaryByCharacter: Record<string, CompanionCharacterStateSummary> = {}
): CompanionCharacter[] {
  return cards
    .filter((card) => isCharacterVisibleInSidebar(preferences, card.id))
    .map((card) => ({
      id: card.id,
      name: card.name,
      status: "online",
      active: card.id === activeCharacterId,
      activityStatus: activityByCharacter[card.id],
      avatarSrc: card.assets.avatar,
      stateSummary: stateSummaryByCharacter[card.id],
      themeColor: card.themeColor,
      unreadCount: unreadByCharacter[card.id] ?? 0
    }));
}

export const sessionGroups: SessionGroup[] = [
  {
    group: "今天",
    items: [
      { id: "fixture-character-card", title: "角色卡聊天区设计", time: "10:42", active: true },
      { id: "fixture-design-review", title: "设计评审要点", time: "09:18", active: false }
    ]
  },
  {
    group: "昨天",
    items: [{ id: "fixture-api-pagination", title: "API 分页问题", time: "Mon", active: false }]
  },
  {
    group: "更早",
    items: [{ id: "fixture-project-start", title: "项目启动", time: "5/12", active: false }]
  }
];

export function getActiveCharacter(items: CompanionCharacter[]) {
  return items.find((item) => item.active) ?? null;
}

export function activateCharacter(items: CompanionCharacter[], characterId: string) {
  const hasCharacter = items.some((item) => item.id === characterId);

  if (!hasCharacter) {
    return items;
  }

  return items.map((item) => ({
    ...item,
    active: item.id === characterId
  }));
}
