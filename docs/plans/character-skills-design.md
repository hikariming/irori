# 设计：角色化 Skill —— 标准 pi skill + 角色访问控制层

> 目标：让用户能像管理"技能库"一样增删改 skill（pi 标准 `SKILL.md` 形态），
> 并配置「哪个角色会哪个技能」（多对多）。每次会话只把当前角色会的 skill 喂给
> pi，由 pi 原生的渐进式披露机制完成发现与调用。不自造 skill 引擎、不写 prompt 注入。

---

## 0. 设计原则

1. **复用 pi 原生 skill**：pi（`@earendil-works/pi-coding-agent@0.74.0`）已实现
   skill 的加载、系统提示注入（`formatSkillsForPrompt`）、渐进式披露、`/skill:name`
   显式调用全套。我们**只做配置层，不碰引擎**。
2. **访问控制 = 会话级白名单过滤**：唯一的访问控制点是 `DefaultResourceLoader`
   的 `skillsOverride` 过滤器——每次会话只保留当前角色会的 skill。模型发现与
   `/skill:name` 调用都走过滤后的集合，没有漏网。
3. **单一真相源不漂移**：skill 本体（`SKILL.md` 文件夹）只存文件系统（pi 直接
   消费），DB 只存「角色↔技能」映射。两者不重复存 skill 内容。
4. **沿用既有范式**：DB CRUD 抄 `character_moment`，前后端通信抄 `desktop-backend`
   + Tauri command，侧边栏/面板抄 `onLifeOpen` + `CharacterCardSettings`。

---

## 1. 现状（grounded）

### 1a. pi 的 skill 机制（已查证）
- 文件格式：目录含 `SKILL.md`（YAML frontmatter + Markdown 正文）。
  frontmatter 字段（`dist/core/skills.d.ts:3-8` + 校验）：
  - `name`（必填，≤64 字，`[a-z0-9-]`，无首尾/连续连字符，**必须等于父目录名**）
  - `description`（必填，≤1024 字，模型据此决定何时加载）
  - `disable-model-invocation`（可选，`true` 时不进系统提示，只能 `/skill:name`）
  - 另支持 `license` / `compatibility` / `metadata` / `allowed-tools`（实验性）
- 加载入口：`DefaultResourceLoader`（`dist/core/resource-loader.d.ts:56-108`）
  - `additionalSkillPaths: string[]` —— 额外加载哪些目录
  - `skillsOverride: (base) => base` —— 加载后对 skill 列表任意过滤（★访问控制钩子）
- 触发：启动时扫描 → 抽 `name`/`description` 注入系统提示（XML）→ 模型用 `read`
  工具按需加载完整 `SKILL.md`；用户也可 `/skill:name` 显式触发。

### 1b. 当前会话链路（skill 入口未接）
```
send_pi_prompt (src-tauri/src/lib.rs:435)          // Rust，能访问 SQLite
  └─ 把请求 JSON 经 stdin 交给 sidecar
runCockapooPiPrompt (sidecar/src/prompt-runner.mjs:172)
  └─ createCockapooPiSession (pi-session-adapter.mjs:203)
        └─ buildPiResourceLoaderOptions (:188)
              // 当前只传 additionalExtensionPaths / extensionFactories
              // 没有 additionalSkillPaths，没有 skillsOverride
        └─ new DefaultResourceLoader(...)
        └─ createAgentSession(...)
```
角色身份目前以 `[character:<id>]` 文本前缀注入，且 `chatHistoryMemory.characterId`
已结构化存在于 sidecar（`prompt-runner.mjs:235`）。但**没有任何"角色会哪些能力"
的字段**——所有角色共用全局工具策略。这就是要补的一环。

---

## 2. 存储层

### 2a. Skill 文件库（文件系统）
路径：`<appDataDir>/cockapoo/skills/<skill-name>/SKILL.md`（可选 `scripts/`、
`references/`）。App 首启时与 SQLite 同期确保目录存在。

`SKILL.md` 示例：
```markdown
---
name: tarot-reading
description: 当用户想算塔罗 / 求指引时使用，抽牌并按牌阵解读
disable-model-invocation: false
---

# 塔罗解读
（方法论：怎么抽牌、牌阵、解读口吻……）
```
> name 合法性（全小写、`[a-z0-9-]`、== 目录名、无 `--`、无首尾连字符）由 pi 校验，
> 不合法会进 diagnostics；UI 建 skill 时需前置校验避免静默失败。

### 2b. 映射表（SQLite，`src-tauri/src/lib.rs`，抄 `character_moment` ~1921 起）
```sql
CREATE TABLE character_skill (
  character_id TEXT NOT NULL,
  skill_name   TEXT NOT NULL,      -- == SKILL.md 的 name / 目录名
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (character_id, skill_name)
);
```
- 一个技能多个角色会 = 多行；一个角色多个技能 = 多行 → 满足多对多。

### 2c. 新增 Rust Tauri 命令（模式同 `insert_character_moment_*`）
| 命令 | 作用 |
|------|------|
| `list_skills() -> Vec<SkillMeta>` | 扫 skills 目录、解析每个 `SKILL.md` frontmatter，返回 `{name, description, disableModelInvocation, path}` |
| `create_skill(name, description, body)` | 校验 name → 建目录 + 写 `SKILL.md` |
| `update_skill(name, description, body)` | 重写 `SKILL.md` |
| `delete_skill(name)` | 删目录 + 清 `character_skill` 孤儿行 |
| `list_character_skills(character_id) -> Vec<String>` | 该角色 enabled 的 skill_name |
| `set_character_skill(character_id, skill_name, enabled)` | upsert 映射 |
| `list_skill_assignments(skill_name) -> Vec<{character_id, enabled}>` | "哪些角色会这个技能"勾选 UI 用 |

---

## 3. Sidecar 运行时接线（核心改动，3 处）

目标：把"当前角色会的 skill 名单"一路送到 `DefaultResourceLoader`。

### 3a. Rust 侧解析名单并塞进请求（`lib.rs:435` `send_pi_prompt`）
发请求前查 `character_skill` 得到该 `character_id` 的 enabled 名单，连同 skills 根
目录，加进 stdin 请求 JSON（与现有 `modelSettings`/`toolPolicySettings` 同级）：
```jsonc
{ ...现有字段,
  "skillsRootPath": "<appData>/cockapoo/skills",
  "allowedSkillNames": ["tarot-reading", "weather-lookup"] }
```
> Rust 查 DB、传扁平数据；sidecar 保持无 DB 依赖。

### 3b. `runCockapooPiPrompt` 透传（`prompt-runner.mjs:172`）
新增入参 `skillsRootPath`、`allowedSkillNames`，原样传给 `createSession({...})`（`:313`）。
（同时 `bin/pi-prompt.mjs` 解析 stdin 时把这两个字段读出并传入。）

### 3c. `buildPiResourceLoaderOptions` + `createCockapooPiSession`（`pi-session-adapter.mjs:188,203`）
```js
export function buildPiResourceLoaderOptions({
  cwd, agentDir, extensionFactories,
  webAccessPackageRoot = resolvePiWebAccessPackageRoot(),
  additionalPackageRoots = [],
  skillsRootPath,                 // 新增
  allowedSkillNames               // 新增
}) {
  return {
    cwd, agentDir,
    additionalExtensionPaths: [webAccessPackageRoot, ...additionalPackageRoots].filter(Boolean),
    additionalSkillPaths: skillsRootPath ? [skillsRootPath] : [],
    // ★ 访问控制就在这一行：白名单过滤
    skillsOverride: (base) => ({
      ...base,
      skills: base.skills.filter((s) => (allowedSkillNames ?? []).includes(s.name))
    }),
    extensionFactories
  };
}
```
`createCockapooPiSession` 把 `options.skillsRootPath` / `options.allowedSkillNames`
透传进 `buildPiResourceLoaderOptions`（已在 `:260` 调用）。

> 即便 pi 默认目录（`~/.pi/agent/skills` 等）混入别的 skill，白名单过滤也会一并
> 剔除——访问控制点唯一且收敛。过滤后 `formatSkillsForPrompt` 与 `/skill:name`
> 全部只见该角色的 skill，**不需要任何自写 prompt 注入**。

---

## 4. 前端

### 4a. 后端绑定（`desktop-backend.ts`）
加类型 + `invoke` 封装：`listSkills`、`createSkill`、`updateSkill`、`deleteSkill`、
`listSkillAssignments`、`setCharacterSkill`、`listCharacterSkills`。

### 4b. 侧边栏入口（`CompanionSidebar.tsx:199` footer + `App.tsx`）
抄 `onLifeOpen`/`onSettingsOpen`：
- `CompanionSidebarProps` 加 `onSkillsOpen?`
- footer 加 ⚡ 按钮
- `App.tsx` 加 `isSkillsOpen` state + 打开时互斥关闭其它 panel（同 `:1138`）

### 4c. `SkillsPanel.tsx`（新文件，双栏，复用 `character-card-layout` 样式）
- **左栏**：skill 库列表（`listSkills`）+ 底部"＋ 新建技能"
- **右栏（选中某 skill）**：
  - 编辑：name（建时校验/重名提示）、description、正文 body（= `SKILL.md` 内容）、
    `disable-model-invocation` 开关、保存 / 删除
  - **"哪些角色会这个技能"**：列出所有角色（`useCharacterCards`），每个一个
    checkbox → `setCharacterSkill(charId, skillName, on)` —— 即用户自配映射
- 外壳复用 `system-settings-panel` + `settings-page-inner`

### 4d.（可选）角色卡侧反向入口
`CharacterCardSettings.tsx` 角色详情加"技能"区块，勾选该角色会哪些 skill——与 4c
是同一张映射表的两个视角。v1 可不做。

---

## 5. 测试
- `pi-session-adapter.test.mjs`：`skillsOverride` 按 `allowedSkillNames` 正确过滤
  （空名单→0 skill；含名单→只留对应项；不在库里的名字→忽略）
- `prompt-runner.test.mjs`：`skillsRootPath`/`allowedSkillNames` 正确透传到 `createSession`
- Rust：`character_skill` upsert/查询往返；`list_skills` 解析 frontmatter；非法 name 被拒；
  `delete_skill` 清孤儿映射

---

## 6. 分期
- **P1（最小闭环）**：DB 表 + Rust 命令 + sidecar 三处接线 + SkillsPanel 基础 CRUD +
  角色勾选。手动放一个 `tarot-reading` 验证"角色 A 会、角色 B 不会"端到端生效。
- **P2（体验）**：name 校验/重名、frontmatter 结构化编辑、skill 模板预设、空态引导、
  角色卡侧反向入口（4d）。
- **P3（进阶）**：skill 的 `allowed-tools` 与现有工具围栏打通——某 skill 需要
  `web.search`/`browser.view` 时按需放开对应工具（见 §7.1）。

---

## 7. 边界与注意

1. **Skill 想用工具 → 工具策略也得放开**：skill 正文可让模型 `web.search`，但能否
   真用仍受 `toolPolicySettings` + 审核围栏管控。v1 语义="skill 只能用全局已启用的
   工具"；P3 再做"按 skill 的 `allowed-tools` 自动放开"。UI 要对用户讲清，避免
   "技能配了却用不了"的困惑。
2. **characterId 通道**：`chatHistoryMemory.characterId` 已在 sidecar，但 skill 名单
   仍建议由 Rust 查好直接传 `allowedSkillNames`，避免 sidecar 反查 DB。
3. **目录初始化**：skills 根目录在 App 首启时（同 SQLite 初始化）确保存在。
4. **删除一致性**：`delete_skill` 顺带清 `character_skill` 孤儿行；或 `list_character_skills`
   与 skills 目录 join 过滤已删项，双保险。
5. **校验失败可观测**：pi 对非法 skill 产出 diagnostics——P2 可把这些诊断回显到
   SkillsPanel，方便用户排错。
