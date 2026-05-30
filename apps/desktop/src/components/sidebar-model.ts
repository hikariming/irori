import type { CharacterCard } from "./character-cards.ts";

export type CharacterStatus = "online" | "idle";

export type CompanionCharacter = {
  id: string;
  name: string;
  status: CharacterStatus;
  tone: string;
  active: boolean;
  avatarSrc?: string;
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
  activeCharacterId: string
): CompanionCharacter[] {
  return cards.map((card) => ({
    id: card.id,
    name: card.name,
    status: "online",
    tone: card.tagline,
    active: card.id === activeCharacterId,
    avatarSrc: card.assets.avatar
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
