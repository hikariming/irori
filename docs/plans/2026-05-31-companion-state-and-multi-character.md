# 陪伴沉浸感方案：好感度 / 心情 / 精力 + 多角色生活与互动

> 日期：2026-05-31
> 目标：让 irori 的少量角色（lulin / cenji / sakuramio / shenyanzhou / shili / tangyuan）
> 拥有「自己的状态与生活」，能记住用户、能彼此互动，从而和用户之间形成持续的陪伴沉浸感。
> 硬约束：记忆与召回保持 **FTS-only（不接 embedding）**，状态用结构化字段，不引入向量检索。

---

## 0. 设计哲学：状态即日记（state-as-diary）

参考 refproj（Alice）最关键的一条经验：**不要把状态写成一堆参数喂给模型，而是把状态翻译成「角色此刻的内心日记」注入 system prompt。**

- 模型不擅长「affinity=42 所以语气要冷 12%」这种数值推理。
- 模型很擅长「我们才认识不久，我还在观察 ta」这种自然语言自我描述。

所以本方案的核心循环是：

```
结构化状态(数值/枚举)  ──翻译──▶  一段第一人称心声  ──注入──▶  composeCharacterSessionPrompt
        ▲                                                              │
        └──────────────  回合结束后由 Gatekeeper 抽取增量更新  ◀────────┘
```

数值负责「可计算、可持久化、可跨会话」，自然语言负责「让模型自然地演出来」。

---

## 1. 单角色状态模型

每个角色对每个用户维护一份状态（当前是单机单用户，但结构上按 `characterId` 维度存，便于将来扩展）。

### 1.1 数据结构（结构化、可序列化、无向量）

```ts
// 拟新增：apps/desktop/src/components/character-state.ts
export type Mood =
  | "calm"      // 平静（默认）
  | "warm"      // 温暖/亲近
  | "playful"   // 俏皮
  | "tired"     // 低落/疲惫
  | "guarded";  // 戒备/有情绪

export type CharacterState = {
  characterId: string;
  affinity: number;        // 好感度 0-100
  mood: Mood;              // 当前心情（枚举，便于翻译成心声）
  energy: number;          // 精力 0-100
  lastSeenAt: number;      // 上次见面时间戳（驱动「久未见面」逻辑）
  meetCount: number;       // 见过几次（驱动「见面即记住」）
  // 印象：少量结构化条目，FTS 可检索，不做向量
  impressions: Impression[];
};

export type Impression = {
  id: string;
  kind: "like" | "dislike" | "fact" | "grudge"; // 喜好 / 反感 / 事实 / 记仇
  text: string;            // "用户喜欢深夜写代码"
  weight: number;          // 1-5，影响注入优先级与召回排序
  createdAt: number;
};
```

### 1.2 三个系统的语义

| 系统 | 范围 | 变化驱动 | 作用 |
|---|---|---|---|
| 好感度 affinity | 0-100，缓慢 | 长期积累：正向互动 +、被冷落/冲突 - | 决定「坦诚层级」（见 §3） |
| 心情 mood | 5 枚举，快速 | 单次/近几回合的对话情绪 | 决定当下语气色彩 |
| 精力 energy | 0-100，按时间+使用衰减/恢复 | 时间线（§5）、高强度长对话消耗 | 低精力时角色更简短、会「想早点休息」 |

好感度**慢**、心情**快**、精力**随时间**——三条不同时间尺度的曲线，叠加出「像活着」的感觉。

### 1.3 持久化

沿用项目既有两种模式，本方案建议：

- **MVP**：localStorage（参考 `use-theme.ts` / 已落地的 `character-preferences.ts`），key 如 `irori-character-state`。零 Rust 改动，先把循环跑通。
- **后续**：迁到 Rust 后端（参考 model-settings / tool-policy 的持久化），并入 TencentDB，`impressions` 走现有 **FTS 召回**（与 [[feedback-memory-no-embedding]] 一致，**不接 embedding**）。

---

## 2. 注入点：把状态翻译成心声

唯一注入点是 `apps/desktop/src/components/chat-session.ts` 的 `composeCharacterSessionPrompt`。
在「## 角色卡」之后、「## 当前任务」之前，插入一段 **## 此刻的我**（角色私密日记口吻）。

翻译函数（纯函数，易测）：

```ts
// character-state.ts
export function describeStateAsDiary(card: CharacterCard, state: CharacterState): string {
  // 例（lulin，affinity=20, mood=guarded, 第2次见面）：
  // "我们才见过两次，我还在慢慢认识 ta。今天我有点提不起劲，
  //  说话会比平时短一些。我记得 ta 喜欢深夜写代码。"
}
```

要点：
- **只描述、不下指令**。不要写「请用冷淡语气」，而写「我们还不算熟」。
- 印象按 `weight` 取 top-N（如 3 条）注入，避免 prompt 膨胀。
- 「记仇」类 `grudge` 印象在 mood=guarded 时优先注入，呼应「我会记仇」。

注入后 prompt 结构变为：
`角色卡 → 此刻的我(新) → 当前任务 → 思考方式 → 表情包协议 → 对话示例 → 最近上下文 → 用户新消息`

---

## 3. 好感度门控的坦诚层级（candor tiers）

好感度不改「能力」，只改「亲密度/坦诚度」，避免出现「好感低就不好好干活」的反效果。

| 区间 | 称呼/语气 | 自我暴露 | 主动性 |
|---|---|---|---|
| 0-20 陌生 | 礼貌、留有距离 | 几乎不谈自己 | 被动回应 |
| 21-50 熟悉 | 自然、偶尔玩笑 | 偶尔提自己的事 | 偶尔主动关心 |
| 51-80 亲近 | 放松、有专属梗 | 会聊自己的「生活」(§5) | 主动延续话题、记得旧事 |
| 81-100 信任 | 亲昵、敢调侃也敢直言 | 坦白脆弱/在意 | 会主动发起、会「想你」 |

层级同样通过 §2 的心声体现，不暴露数字给用户。

---

## 4. 记忆：见面即记住 / 记仇

- **见面即记住**：每次会话开始 `meetCount++`、刷新 `lastSeenAt`。心声里据此区分「初次见面 / 又见到你了 / 好久不见」。
- **记喜好 & 记仇**：回合结束后由 **Gatekeeper（抽取器）** 从对话里抽 `Impression`：
  - 正向 → `like`/`fact`（+affinity）
  - 负向/冲突 → `dislike`/`grudge`（-affinity，mood 转 guarded）
- Gatekeeper 实现：复用 local-agent 的一次轻量 LLM 调用，输出**严格 JSON**（参考现有 prompt-runner 调用模式），失败则跳过（不阻塞主回复）。
- 召回：`impressions` 用 **FTS** 按关键词+weight 排序取 top-N，**不做向量**。

---

## 5. 多角色层：各自的生活 + 角色间互动（难点）

这是用户明确指出「还挺难」的部分。拆成三块，按难度递增。

### 5.1 各自的生活：DayScript-lite（轻量时间线）

借鉴 Alice 的 DayScript，但**大幅简化**：每个角色一份按时段的「日程倾向」，不是硬脚本。

```ts
// 角色卡可选扩展字段，或单独 character-life.ts
type LifeBeat = { from: string; to: string; activity: string; energyDelta: number };
// 例 lulin: [{from:"23:00",to:"02:00",activity:"看论文",energyDelta:-10}, ...]
```

- 作用：进会话时根据当前真实时间，算出角色「正在做什么 / 精力状态」，喂进 §2 心声（「我刚泡完咖啡」「这个点我一般在看论文」）。
- 纯本地计算，无需后台进程，**零额外成本**地制造「ta 有自己的生活」。

### 5.2 角色间互动（异步、共享世界事件）

不要做实时多角色群聊（成本高、易失控）。改为**事件总线 + 异步引用**：

- 维护一个轻量 `WorldEventBus`：当角色 A 在与用户对话中产生一个值得共享的事件（如「lulin 今天熬夜赶 ddl」），写入共享事件表（FTS 可检索）。
- 角色 B 下次与用户对话时，§2 的心声**可能**引用它：「听 cenji 说你最近在忙那个项目？」
- 引用受 **cooldown + 概率**控制（参考 Alice 的 moments-blocking 冷却），避免每句都提别人、避免刷屏。
- 角色间关系可在卡里声明（`relations: {cenji: "同门", ...}`），决定语气。

> 这样「角色间互动」对用户表现为：**角色们好像在背后彼此知道对方的事**，而无需真正的多 agent 实时编排。这是性价比最高的沉浸感来源。

### 5.3（可选/远期）真·自代理互动

两个角色在后台跑一段彼此对话生成「共同记忆」，再各自引用。成本与可控性风险高，**列为远期**，MVP 不做。

---

## 6. 闭环时序（每回合）

```
进入会话
  └─ 载入 CharacterState + 计算 LifeBeat/energy 衰减 → 刷新 meetCount/lastSeenAt
回合开始
  └─ describeStateAsDiary() → 注入「## 此刻的我」 → composeCharacterSessionPrompt
模型回复（沿用现有 parseCharacterReply / sticker 协议）
回合结束（异步，不阻塞 UI）
  └─ Gatekeeper 抽取 Impression + 情绪 → 更新 affinity/mood/energy
  └─ 值得共享的事件 → WorldEventBus
持久化 CharacterState
```

---

## 7. 分阶段落地

**Phase A — MVP（单角色状态闭环，纯前端）**
1. `character-state.ts`（结构 + `describeStateAsDiary` + 纯函数 reducer，全部带单测）
2. `use-character-state.ts`（localStorage 持久化，仿 `use-character-preferences.ts`）
3. 在 `composeCharacterSessionPrompt` 注入「## 此刻的我」
4. 回合结束做**规则版**状态更新（先不上 LLM Gatekeeper）：正向关键词/对话长度 → 微调 affinity/mood/energy
   - 验收：跨会话能感到「越聊越熟」「记得上次」「久未见面会提」。

**Phase B — 记忆抽取 + 精力时间线**
5. LLM Gatekeeper（local-agent，严格 JSON，失败降级）→ `impressions`（含记仇）
6. DayScript-lite 接入 energy/心声
7. impressions 迁 Rust + TencentDB **FTS** 召回（保持无 embedding）

**Phase C — 多角色互动**
8. `WorldEventBus`（共享事件 + FTS 召回）
9. 角色 `relations` + cooldown/概率引用 → 心声里偶尔提及别的角色
10. 设置页（已重做的左侧角色 List）增加：好感度只读展示、关系开关等

**远期**：5.3 真·自代理互动。

---

## 8. 明确的难点与取舍

1. **多角色实时互动很贵也易失控** → 用「异步事件总线 + 概率引用」替代实时群聊（§5.2）。这是本方案最关键的取舍。
2. **数值驱动语气模型做不好** → 一律走「状态翻译成心声」，数值只做计算与持久化（§0）。
3. **Gatekeeper 抽取不稳定** → 严格 JSON + 失败降级到规则版，绝不阻塞主回复（§4）。
4. **好感度负向体验风险** → 好感度只调亲密/坦诚，不调能力，避免「不讨好就摆烂」（§3）。
5. **prompt 膨胀** → 印象 top-N、事件 cooldown、心声控制在几句话内（§2/§5.2）。
6. **坚持 FTS-only** → impressions/events 全部结构化 + FTS，不引入向量（[[feedback-memory-no-embedding]]）。
7. **沉浸 vs 效率** → 沿用现有「需要效率时直接给步骤」的基调，状态层只增色不喧宾夺主。

---

## 9. 新增/改动文件一览（预估）

| 文件 | 动作 | 阶段 |
|---|---|---|
| `apps/desktop/src/components/character-state.ts` | 新增（模型+心声+reducer） | A |
| `apps/desktop/src/components/character-state.test.ts` | 新增 | A |
| `apps/desktop/src/components/use-character-state.ts` | 新增 | A |
| `apps/desktop/src/components/chat-session.ts` | 改（注入「此刻的我」） | A |
| `apps/local-agent/src/...`（Gatekeeper 调用） | 改/新增 | B |
| `apps/desktop/src/components/character-life.ts` | 新增（DayScript-lite） | B |
| Rust `lib.rs` + TencentDB（impressions/events FTS） | 改 | B/C |
| `apps/desktop/src/components/world-event-bus.ts` | 新增 | C |
| 角色 `card.json`（relations / lifeBeats 可选字段） | 改 | B/C |
