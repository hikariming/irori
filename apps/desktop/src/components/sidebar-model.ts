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
  title: string;
  time: string;
  active: boolean;
};

export type SessionGroup = {
  group: string;
  items: SessionItem[];
};

export const characters: CompanionCharacter[] = [
  {
    id: "shili",
    name: "示璃",
    status: "online",
    tone: "安静陪伴",
    active: true,
    avatarSrc: "/characters/shili.card/assets/avatar/avatar-circle.png"
  },
  {
    id: "yanche",
    name: "言澈",
    status: "idle",
    tone: "理性搭档",
    active: false
  },
  {
    id: "xingye",
    name: "星野",
    status: "online",
    tone: "轻快提醒",
    active: false
  }
];

export const sessionGroups: SessionGroup[] = [
  {
    group: "今天",
    items: [
      { title: "角色卡聊天区设计", time: "10:42", active: true },
      { title: "设计评审要点", time: "09:18", active: false }
    ]
  },
  {
    group: "昨天",
    items: [{ title: "API 分页问题", time: "Mon", active: false }]
  },
  {
    group: "更早",
    items: [{ title: "项目启动", time: "5/12", active: false }]
  }
];

export function getActiveCharacter(items: CompanionCharacter[]) {
  return items.find((item) => item.active) ?? null;
}
