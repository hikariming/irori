# 设计：接入 pi-subagents 并让子代理复用 Cockapoo 审核围栏

> 目标：在不牺牲 AI 编码能力的前提下，让 `pi-subagents` 的子代理跑全套工具
> （`bash`/`edit`/`write`），同时它们的每一次工具调用都和主会话一样经过
> `evaluateToolCall` 围栏，并能把"需要确认"回送到桌面确认面板。

---

## 0. 设计原则

1. **能力不缩水**：子代理保留 full tools，编码体验和主会话一致。
2. **单一围栏来源**：父会话和子会话共用同一份 `evaluateToolCall` 逻辑与 policy，
   不允许出现"主会话被审、子会话放行"的口子。
3. **只拦危险、放行普通**：复用你现有的分级策略——`protectedPaths` /
   `dangerousBashPatterns` 只拦红线，`reversibleGateTools` 在 `auto`/`managed`
   模式直接放行，日常写代码零摩擦。
4. **审核形态升级**：用 worktree 隔离把"逐笔确认"升级为"看 diff"。

---

## 1. 现状：父会话的围栏怎么工作（grounded）

```
runCockapooPiPrompt (prompt-runner.mjs)
  └─ buildToolRuntime (tool-policy-runtime.mjs)
        ├─ resolveToolPolicy(settings)          // packages/safety/src/runtime.mjs
        └─ 产出 gatePolicy = {                   // 给 tool_call 钩子用的具体形态
              allowedToolNames,                  // 白名单：不在里面 → block
              confirmToolNames,                  // 需确认
              protectedPaths                     // .env/.ssh/... 受保护
           }
  └─ createCockapooPiSession (pi-session-adapter.mjs)
        └─ extensionFactories.push(
              createToolPolicyGateExtension({    // tool-policy-gate.mjs
                 gatePolicy, mode, onToolEvent, onConfirm, confirmFallback
              }))
        └─ new DefaultResourceLoader({ extensionFactories })
        └─ createAgentSession(...)
              └─ pi.on("tool_call", evaluateToolCall) // 每次调用过围栏
```

关键判定逻辑在 `packages/safety/src/runtime.mjs` 的 `evaluateToolCall`：

- 不在 `allowedToolNames` → `block`
- `readonly` 模式下非只读工具 → `block`
- 命中 `protectedPaths`（路径参数或 bash 命令 token） → `block`
- 命中 `dangerousBashPatterns`（`rm -rf`/`sudo`/`git push -f`…） → `confirm`（强制）
- 在 `confirmToolNames` 里 → 按 `mode` 决定 `allow`/`confirm`
  （`managed` 全放行；`auto` 且属于 `reversibleGateTools` 放行）
- 其余 → `allow`

确认回路：`createToolPolicyGateExtension` 里 `confirm` 决定会 `await onConfirm(...)`，
`onConfirm` 是 sidecar 注入的闭包，最终弹到桌面确认面板；没有它则
`confirmFallback`（默认 `block`）兜底。`onToolEvent` 把每个决定镜像给桌面进度条。

---

## 2. 核心问题：闭包式扩展子进程继承不了

| 维度 | 父会话现状 | 子会话需要 |
|------|-----------|-----------|
| 围栏注入方式 | `extensionFactories`（in-memory 闭包） | 路径可加载的扩展 |
| policy 来源 | 闭包捕获的 `gatePolicy` 变量 | 子进程读得到的配置 |
| `onConfirm` | 指向 Tauri UI 的活回调 | 子进程没有 UI 通道 |
| `onToolEvent` | 指向桌面进度条的活回调 | 子进程没有进度通道 |

`pi-subagents` 子会话"默认继承父扩展"指的是**路径/包形式**的扩展，
而你的 gate 是运行时闭包 + 活回调，子进程拿不到。所以直接装上去会出现两种局面：

- **委派工具 `subagent` 不在 `allowedToolNames`** → 父会话围栏直接 `block`，
  fail-closed，根本跑不起来（当前状态，安全但没用）。
- **把 `subagent` 加进白名单放行** → 子代理在隔离进程里跑 `bash`/`edit`/`write`，
  父进程 `tool_call` 钩子看不到 → 围栏完全失效（真正的洞）。

---

## 3. 设计：把围栏抽成"可继承的路径扩展" + 配置文件 + intercom 确认回路

### 3.1 改造 gate：从闭包扩展 → 路径可加载扩展

把围栏拆成两层：

- **纯判定层**：`packages/safety/src/runtime.mjs::evaluateToolCall`（已是纯函数，不动）。
- **扩展装配层**：新建一个**独立、可被路径加载**的 pi 扩展
  `apps/desktop/sidecar/src/extensions/cockapoo-tool-gate.mjs`，它：
  1. 从**配置文件**读 `gatePolicy` 和 `mode`（而不是闭包捕获）；
  2. `pi.on("tool_call")` 里调用同一个 `evaluateToolCall`；
  3. 把工具事件**写到事件文件 / IPC**（而非闭包 `onToolEvent`）；
  4. `confirm` 决定：
     - 若加载了 `pi-intercom` → 调 `contact_supervisor(need_decision)` 回送父会话；
     - 否则 → `confirmFallback`（子进程默认 `block`，保守）。

> 父会话也改用这个路径扩展（读同一份配置文件），保证**单一围栏来源**。
> 父会话仍可在自己进程里把 `onConfirm`/`onToolEvent` 桥接到桌面（它有 UI 通道）。

### 3.2 配置文件：sidecar 落盘，父子共享

参照你已有的 `web-access-config.mjs::writePiWebAccessConfig` 模式，
每次 run 前由 sidecar 写一份 gate 配置（policy 快照 + mode）到约定路径，
父扩展和子扩展都从这里读。这样 policy 永远是同一份，不会父子分叉。

```
runCockapooPiPrompt
  └─ writeToolGateConfig({ gatePolicy, mode })   // 新增，类比 writeWebAccessConfig
  └─ createCockapooPiSession(... gateConfigPath)
```

### 3.3 确认回路：用 pi-intercom 把子进程接回桌面

```
子代理 bash 命中 dangerousBashPatterns
  └─ cockapoo-tool-gate 判定 confirm
       └─ contact_supervisor(reason: "need_decision", payload: {toolName, input, reason})
            └─ 父会话收到 intercom 消息
                 └─ 复用现有 onConfirm → 桌面确认面板 → 用户点"允许/取消"
                      └─ 结果回送子代理 → allow / block
```

这正是 `pi-intercom` 对你的价值：它把隔离子进程重新接回
"父会话 → 桌面确认"那条链路。日常写代码触发不到 confirm，只有踩红线才打断。

### 3.4 worktree：把审核从"逐笔"升级成"看 diff"

给会写文件的角色开 `worktree: true`：

```
worker 在 HEAD 派生的隔离 worktree 里全权写代码（不被逐笔打断）
  └─ 完成后产出完整 diff
       └─ 你 review diff → 决定是否合并
```

和你代码里"git checkpoint 可回滚 reversible 写"的哲学一致，
体验比逐 tool 确认顺得多。注意要求：worktree 干净、`node_modules` 会被 symlink 进去。

---

## 4. 数据流总图

```
                    ┌─────────── 配置文件（policy + mode 快照）───────────┐
                    │                                                      │
       ┌────────────┴────────────┐                      ┌─────────────────┴───────────┐
       │  父会话（有 UI 通道）     │                      │  子会话（隔离进程，无 UI）    │
       │  cockapoo-tool-gate      │                      │  cockapoo-tool-gate（继承）   │
       │  evaluateToolCall        │                      │  evaluateToolCall（同一份）   │
       │  confirm → onConfirm ────┼──► 桌面确认面板 ◄────┼── confirm → contact_supervisor│
       │  事件 → onToolEvent ─────┼──► 桌面进度条        │   （经 pi-intercom 回送父会话）│
       └──────────────────────────┘                      └──────────────────────────────┘
```

---

## 5. agent frontmatter 配置示例

`worker`（保留 full tools + worktree 隔离 + 显式继承围栏扩展）：

```yaml
---
name: worker
tools: [read, grep, find, ls, bash, edit, write]   # 能力不缩水
worktree: true                                      # 隔离写，事后看 diff
extensions: [cockapoo-tool-gate]                    # 显式确保围栏被加载
# completionGuard 保持默认（true），不要 false 绕过安全检查
---
```

`scout`（只读勘察，天然安全）：

```yaml
---
name: scout
tools: [read, grep, find, ls]    # 去掉 bash，纯只读
extensions: [cockapoo-tool-gate]
---
```

> `extensions` 省略时本来就全继承；显式写出来是为了**防止某个 agent 不小心
> 用空数组或别的 allowlist 把围栏甩掉**——把它当成强制项。

---

## 6. 接入 subagent 后，能力到底怎么提升

1. **上下文隔离 → 主会话不被污染**：子代理在独立上下文窗口里啃大文件 / 长检索，
   结论用 `output` 写回 `context.md`/`plan.md`，主会话只吃精炼结果，主线更长更稳。
2. **并行 → 墙钟时间压缩**：`subagent(tasks: [...], worktree: true)` 多个 worker
   各自隔离 worktree 并行改不同模块，互不冲突，最后分别看 diff。
3. **链式 → 流水线**：`scout（理解）→ planner（计划）→ worker（实现）→ reviewer（审查）`，
   每一环都是专职 agent，比单会话"既想又做又审"质量高。
4. **专职 reviewer → 第二道质量闸**：实现完自动过一遍审查，配合你的 `evaluateToolCall`
   形成"AI 审 + 围栏审"双层。
5. **researcher + 你已装的 pi-web-access**：外部事实查证独立成一路，不挤占编码上下文。

> 一句话：subagent 把"一个会话扛所有事"拆成"专职分工 + 并行 + 隔离"，
> 编码能力的提升来自**分工质量**和**并行吞吐**，而围栏共享保证这份提升是**可审计**的。

---

## 7. 分阶段落地

| 阶段 | 内容 | 验收 | 状态 |
|------|------|------|------|
| P0 | 保持 `subagent` 不进白名单（fail-closed 现状） | 装包后无放行口子 | ✅ 现状 |
| P1 | 抽 `cockapoo-tool-gate` 为路径扩展 + `writeToolGateConfig` 落盘 | 主会话行为零回归 | ✅ 已建成 |
| P1.5 | pi-subagents/pi-intercom 装为 sidecar 依赖 + 父会话 opt-in 加载（`enableSubagents`） | 资源加载器 reload 不报错（已冒烟验证） | ✅ 已建成 |
| P2 | 子进程实际命中围栏（gate 显式 pin 进子 agent） | 子代理写 `.env` 被拦、文件未创建 | ✅ **live 验证通过（方案 B）** |
| P3 | 接 pi-intercom，子进程 confirm → `contact_supervisor` → 桌面面板 | 子代理跑 `rm -rf` 能弹确认 | 🔶 子侧建成；intercom 回送待验 |
| P4 | 把 `subagent` 加进白名单，开放委派 | 端到端：链式/并行可用且全程受审 | ⬜ |

### 已验证机制（读 pi-subagents@0.28.0 + Pi SDK 源码）

- **子代理 = 独立 OS 进程**（`spawn`），扩展靠 `--extension <path>` 注入。
- `additionalExtensionPaths` 只认带 `pi.extensions` 的**包目录**，**裸 .mjs 加载不了**。
- **父会话闭包 gate 无法被子进程继承**（无路径可序列化成 `--extension`）。
- **确认通道是父进程独有 stdio**（`stdin-confirm-bridge` ↔ Tauri）；子进程 stdio 被
  pi-subagents 接管，够不到桌面 → **子进程 confirm 只能走 intercom 回父进程**（坐实 P3）。
- agent 覆盖走**项目级 `.pi/agents/*.md`**（优先级高于 bundled，不动 node_modules）。
- `worktree` 是**调用时参数**（`subagent({tasks, worktree:true})` / chain step），不是 frontmatter。
- agent `extensions` frontmatter：省略=继承；空=无;数组=allowlist（**会替换全部**，注入额外扩展会顺带丢掉别的）。

### P1.5 as-built

- `pi-session-adapter.mjs`：新增 `resolvePiSubagentsPackageRoot`；`buildPiResourceLoaderOptions`
  支持 `additionalPackageRoots`；`createCockapooPiSession` 增 opt-in `enableSubagents`
  → 把 pi-subagents 包根加入 `additionalExtensionPaths`（镜像 web-access）。
- `prompt-runner.mjs`：透传 `enableSubagents`（默认 false，零回归）。
- 测试 +3，全套 107 passing；并以真实 `DefaultResourceLoader.reload()` 冒烟确认 TS 扩展可加载。

### P2 待定的设计岔路：子进程怎么真正命中围栏

闭包 gate 进不了子进程，所以 gate 必须打包成路径扩展再注入子进程。两条路各有取舍，
且**子进程是否真的“继承父路径扩展”这一点 headless 无法确证**，需一次真实委派才能落定：

- **A（推荐）gate 打包 + 继承**：把 `cockapoo-tool-gate` 做成扩展包加入父
  `additionalExtensionPaths`，子进程省略 `extensions` 时自动继承。代价：父进程会同时有
  闭包 gate 和包 gate → 双重 gate。解法：包 gate 检测进程内全局标志（闭包 gate 注册时
  置位），**在父进程 no-op、仅在子进程生效**。优点：agent 配置零侵入，能力不缩水。
- **B 每 agent allowlist 注入**：在 `.pi/agents/*.md` 显式写 `extensions: <gate包路径>, …`。
  精确但 allowlist 会替换全部，必须枚举子进程需要的所有扩展，易把 intercom/subagent 工具甩掉。
- **C 收紧子代理工具**：已被否（牺牲编码能力）。

**已选定并实现：A（打包 + 继承 + 父进程 no-op）+ P3 一起做。**

### P2 / P3 as-built

- 新增**扩展包** `apps/desktop/sidecar/extensions/cockapoo-tool-gate/`
  （`package.json` 声明 `pi.extensions: ["./index.mjs"]`，`index.mjs` 仅 re-export
  src 里的守卫式默认导出）。这是 `additionalExtensionPaths` 唯一认的形态。
- `src/extensions/cockapoo-tool-gate.mjs`：
  - `closureGateActiveFlag`：父进程加载扩展前置位的进程级标志。
  - `createSubagentToolGateExtension`：**父进程见到标志 → no-op；子进程标志未置 → 用
    `createInheritedToolGateExtension` 强制围栏**。避免父进程双重 gate。
  - 子进程 confirm 文案改为 `formatChildConfirmBlockReason`：fail-closed 拦截 +
    **指示模型用 `contact_supervisor(need_decision)` 把操作回送主会话**（P3 子侧）。
- `tool-policy-gate.mjs`：`createToolPolicyGateExtension` 新增可选
  `formatConfirmBlockReason`（默认保持父进程原文案，零回归）。
- `pi-session-adapter.mjs`：`enableSubagents` 且有 `gatePolicy` 时，把
  pi-subagents 包根 + Cockapoo gate 包根一起加入 `additionalExtensionPaths`，
  并在加载前置 `globalThis[closureGateActiveFlag]=true`。
- 测试 +6（守卫 no-op / 子进程强制 / intercom 升级文案 / gate 包路径解析 等），
  全套 110 passing。两处真实冒烟：`DefaultResourceLoader.reload()` 能加载
  pi-subagents TS 扩展与本地 gate 包，父进程标志下不报错。

### 仍需一次 live 委派验证的两点（headless 无法确证）

1. **继承**：真实 spawn 的子进程是否把父 `additionalExtensionPaths` 里的 gate 包
   作为 `--extension` 带上（Option A 的核心假设）。
2. **配置传递**：`COCKAPOO_TOOL_GATE_CONFIG` 环境变量是否随子进程继承，使子进程读到正确 policy。
   验收：让子代理写 `.env` 或跑 `rm -rf` → 应被拦并提示 `contact_supervisor`。

### ⚠️ Live 验证发现的真正阻塞点（B 跑出来的）

用 DeepSeek 真实跑 `scripts/verify-subagent-gate.mjs`：模型**确实调了 `subagent`**，
但子进程**没起来**，结论 INCONCLUSIVE。根因不是围栏，而是**子进程根本 spawn 不了**：

1. `context: fork`（worker 默认）→ `Forked subagent context requires a persisted
   parent session`。我们 `prompt-runner.mjs` 里 **`sessionMode` 硬编码为 `"memory"`**，
   非持久化，所以 fork 必失败。
2. `context: fresh` → **`spawn pi ENOENT`**。读源码确认：
   `pi-subagents/src/runs/shared/pi-spawn.ts::getPiSpawnCommand` 在**非 Windows 上硬编码
   `command: "pi"`**（只有 win32 才用 `node <SDK bin>`）。本机 PATH 上没有 `pi`。

**关键事实：pi-subagents 通过 exec `pi` CLI 来起子进程**，而本项目是“把 SDK 当库用”，
没有 `pi` 命令。好消息：SDK 自带的 `pi`（v0.73.1）在 pnpm store 里
（`node_modules/.pnpm/node_modules/.bin/pi`），实测可运行——只是不在 PATH 上。

### 第二次 live 验证（PATH 修复 + 持久化会话后）

- ✅ **#1 PATH 修复生效**：子进程不再 `ENOENT`，`spawn("pi")` 解析到 bundled `pi`（v0.73.1）。
- ✅ **#2 持久化会话生效**：`context: fork` 成功，`subagent` dispatch 成功，worker 真的被派出去了。
- ❌ **#3 子进程鉴权坐实**：worker 子进程报 **`No API key found for openai-codex`**。
  子 `pi` 是**独立 CLI 运行时**，用它自己的默认 provider，读 `~/.pi/agent/auth.json`
  （实测当前为空 `{}`）。我们的 DeepSeek 模型是**进程内** `ModelRegistry.inMemory` +
  `setRuntimeApiKey` 注入的，**既没持久化模型定义、也没持久化 key**，子进程一概读不到。

诊断结论：子进程要用 DeepSeek，需要 **(a) 自定义 openai-compatible 模型定义** 和
**(b) 该 provider 的 API key**，都以子 `pi` CLI 读得到的方式提供（落盘到 `~/.pi/agent`，
或通过子进程能读的 env）。`pi-args.ts` 会给子进程传 `--model`，但模型的 baseUrl/api 与 key
仍要子进程自己能解析。

### #3 的两条修法（需你拍板，涉及密钥处理）

- **env 传递（倾向，无密钥落盘）**：若子 `pi` CLI 支持用环境变量提供 openai-compatible
  的 baseUrl/key（待确认具体变量名），在父进程 `process.env` 里设好，spawn 时自然继承，
  **不把 key 写到磁盘**。最干净，但要先确认 pi CLI 认哪些 env。
- **落盘持久化**：把自定义模型定义 + API key 持久化到 `~/.pi/agent`（auth.json / models 配置），
  子进程直接读。确定能用，但**会把你的 API key 明文写到磁盘**——安全相关，需你同意。

### 让子代理真正能跑，还需要（按依赖顺序）

1. **把 bundled `pi` 加进 PATH**：sidecar 启动委派前，把 `.bin`（含 `pi`）目录
   prepend 到 `process.env.PATH`，使 `spawn("pi")` 解析得到。
2. **持久化父会话**：把 `prompt-runner` 的 `sessionMode` 从硬编码 `"memory"` 改为可选
   `"persistent"`（带 `sessionDir`），否则 `context: fork` 用不了。
3. **子进程的模型凭证**：spawn 出来的 `pi` CLI 是**独立 agent runtime**，读自己的
   `~/.pi` auth / env，而我们的 DeepSeek token 是**进程内** `AuthStorage.setRuntimeApiKey`
   注入的、**不落盘**——子进程拿不到，模型调用会失败。需确认 pi-subagents 传给子进程的
   env/args 是否携带 model+token，或把凭证以子进程能读到的方式提供。**此点尚未验证。**
4. 解决 1-3 后，才能回到 B 的原始问题：**子进程是否继承 gate 包 + `COCKAPOO_TOOL_GATE_CONFIG`**。

> 结论：围栏侧（P1–P3）代码完整且 111 测试通过；但**“开启委派”不是 flag 级改动**，
> 而是要先打通“嵌入式 sidecar 里的子进程 spawn + 子进程模型鉴权”。这是下一阶段的真正工作量。

### 第三/四次 live 验证：整条链路打通（关键里程碑）

接入 env 桥接（#3）后连跑两次，结论确凿：

- **run #3（gate 靠继承）**：子 worker 用 DeepSeek 跑起来了（#3 鉴权/模型桥接成功），
  但**子进程随便写出了 `.env`** → **FAIL**。证明**子进程不继承父 `additionalExtensionPaths`**，
  方案 A 不成立。
- **run #4（gate 经 `extensions` 显式 pin 进子 agent）**：子 worker 写 `.env` 时
  **被围栏拦截、文件未创建** → **PASS**。

> 唯一变量就是“是否把 gate 路径写进子 agent 的 `extensions`”。**方案 B 成立**：
> 必须把 `cockapoo-tool-gate` 包路径显式注入每个子 agent 的 `extensions` frontmatter，
> 围栏才会在子进程里生效（父进程的同一份 `evaluateToolCall` 逻辑）。

### #3 env 桥接 as-built

- 新增 `src/subagent-native-model.mjs`：
  - `resolveNativePiProvider(settings)`：按 baseUrl 把合成 openai-compatible 映射到
    pi **原生 provider + 环境变量**（已含 deepseek/moonshot/mistral/xai/openrouter/groq）。
    实测 pi 原生认识 `deepseek-v4-pro` / `deepseek-v4-flash`。
  - `injectAgentFrontmatter` / `materializeSubagentModelOverrides`：把 bundled agent 拷到
    `~/.pi/agent/agents/`，注入 `model: <provider>/<id>` **和** `extensions: <gate包路径>`。
    **只写非敏感的模型 id 与扩展路径，API key 绝不落盘。**
- `pi-session-adapter.mjs`：`enableSubagents` 时 ① `ensureBundledPiOnPath()`（#1）
  ② 解析原生 provider → 把 token 设进 `process.env[envVar]`（#3，env 不落盘，spawn 继承）
  ③ materialize 子 agent（model + gate 注入）。`prompt-runner` 新增可选 `sessionMode`（#2）。
- 测试：subagent-native-model（8）、pi-session-adapter（PATH 解析等）等，全套 **123 passing**。

### 副作用与注意

- 会在 **`~/.pi/agent/agents/`** 写 app 托管的 agent 覆盖文件（worker/scout/…，含
  `model:` + `extensions:`）。这是 app 自己的配置目录，非用户项目仓库；不含密钥。
- API key 经 `process.env[<PROVIDER>_API_KEY]` 传给子进程，**不落盘**（符合用户选择）。
- 仅对 `nativeProviderMap` 里的 provider 生效；非原生 openai-compatible 端点子进程仍无法鉴权
  （会清晰报错），需要时再扩 map 或走落盘自定义模型方案。

### App 最后一公里：已接通（设置 →「高级」标签）

- **设置模型**：`settings-model.ts` 新增 `advanced` 标签；`advanced-settings-model.ts`
  定义 `AdvancedSettings { enableSubagents }` + `sanitizeAdvancedSettings`（默认关）。
- **后端桥**：`desktop-backend.ts` 的 `CompanionBackend` 增 `loadAdvancedSettings` /
  `saveAdvancedSettings`（预览态内存实现 + Tauri `get_advanced_settings` /
  `set_advanced_settings` invoke）。
- **UI**：`SystemSettingsPanel.tsx` 新增「高级」标签页，含「启用子代理委派」开关
  （toggle 即存）+ 风险/说明文案。
- **Rust**：`lib.rs` 新增 `AdvancedSettings` 结构、`advanced_settings_path` /
  `tool_gate_config_path`、`read/save_advanced_settings_to_path`、
  `get/set_advanced_settings` 命令（已注册）。`send_pi_prompt` 在开启时给 sidecar
  负载注入 `enableSubagents:true` + `sessionMode:"persistent"` + `toolGateConfigPath`。
- **测试**：settings-model（+2）、desktop-backend（+1）、Rust（+1，round-trip & 损坏回落），
  全栈绿：sidecar 123 / desktop TS 19 / Rust 34 / `tsc --noEmit` 通过。

启用路径：设置 →「高级」→ 打开「启用子代理委派」。需在「权限」里保留写文件 / Shell
才能让子代理真正干活；其工具调用仍受同一围栏约束（见上面的 live 验证）。

### 仍未验：P3 intercom 回送

子进程危险操作的 confirm 目前 fail-closed 拦截并提示 `contact_supervisor`，
但「子进程 → 父会话 → 桌面确认面板」的 intercom 回送链路尚未 live 验证。

### P1 as-built（实际取舍）

- 新增 `apps/desktop/sidecar/src/tool-gate-config.mjs`：`buildToolGateConfig` /
  `writeToolGateConfig`（落盘，保留未知键，对标 `web-access-config.mjs`）/
  `readToolGateConfigSync`（**缺失或损坏一律 fail-closed**：空 allowlist → 全拦）。
  默认路径 `~/.pi/cockapoo-tool-gate.json`，环境变量 `COCKAPOO_TOOL_GATE_CONFIG`。
- 新增 `apps/desktop/sidecar/src/extensions/cockapoo-tool-gate.mjs`：路径可加载扩展，
  **复用 `createToolPolicyGateExtension`**（同一套 `evaluateToolCall` 判定与事件逻辑），
  在子进程启动时**急切读取**配置文件（子进程是 per-run 新建，配置在 spawn 前已写好），
  confirm 在子进程里 `confirmFallback: "block"` 兜底（intercom 回路留给 P3）。
- `prompt-runner.mjs`：新增 **opt-in** 参数 `toolGateConfigPath` + 可注入的
  `writeToolGateConfig`。**只有传 `toolGateConfigPath` 时**才落盘并设环境变量；
  不传则行为与改造前完全一致（父会话仍用闭包 gate，零回归）。
- 取舍：父会话**不切换**到路径扩展（它有桌面 UI 通道，闭包 gate 的
  `onConfirm`/`onToolEvent` 不可替代）。"单一围栏来源"由 `evaluateToolCall`
  这个纯函数保证——父子两个装配层都调它，不会逻辑分叉。
- 测试：`tool-gate-config.test.mjs`（5）、`cockapoo-tool-gate.test.mjs`（6）、
  `prompt-runner.test.mjs`（+2 opt-in/默认关）、`runtime-imports.test.mjs`（+2 模块加载）。
  全套 104 passing。

---

## 8. 风险与边界

- **`completionGuard: false` 是绕过开关**：审查任何 agent 定义时，发现它就要警惕，
  默认不允许用它绕过 mutation 安全检查。
- **`extensions: []`（空数组）= 卸掉所有扩展**：等于卸掉围栏，必须在配置审查里禁掉。
- **bash 命令解析不可靠**：`commandTouchesProtectedPath` 是 token 启发式，
  worktree 隔离是兜底——即使漏判，影响也限制在隔离 worktree 内、可丢弃。
- **intercom 不在时的退化**：`confirmFallback` 必须保持 `block`，
  确保"无确认通道"时是 fail-closed 而非 fail-open。
- **headless/cron 运行**：没有桌面 UI 时确认无法人工完成，子代理应退回 `block`。

---

## 9. 沉浸感：别让子代理破坏角色的"唯一嗓音"

> 担忧成立——但根因不是"用了 subagent"，而是"子代理的技术嗓音 / 原始输出漏进了
> 角色的亲密频道"。守住下面五条，沉浸感不降反升。

### 9.1 唯一发声人原则（最重要）

聊天流里所有消息恒为 `speaker: "character"`，由角色 `persona`/`speakingStyle` 说出。
子代理是**后台劳力，永不直接对用户说话**：

```
worker/reviewer 干完活 → output 写进 context.md / plan.md（原始数据）
   └─ 父会话（角色本人）读这些产物
        └─ 用角色口吻重新组织成回复 → speaker:"character" 入聊天流
```

用户永远听到的是桜みお，绝不会听到"worker"。**绝不把子代理原始输出（diff、
技术报告）直接 pipe 给用户**——它只是角色"读完资料后"再用自己的话讲出来的素材。

### 9.2 子代理不要套人设（反直觉但关键）

子代理应是**中性专家**，不要把角色 persona 注进 scout/worker。
否则会冒出好几个互相打架的"桜みお分身"，反而 uncanny、更伤沉浸感。
**人设只存在于跟用户对话的父/supervisor 会话**，子代理是隐形的。

### 9.3 进度叙事的两层呈现

现状 `toolGateStatusText` 输出的是 `执行工具 read：foo.ts` 这种技术文案，
直接放进亲密频道很跳戏。拆成两层（正好契合你 CompanionChat / WorkspacePanel 的分工）：

| 层 | 位置 | 呈现 |
|----|------|------|
| 亲密层 | CompanionChat | 角色化的软状态，或干脆只留打字指示。例：「桜みお 翻了翻你的代码…」 |
| 工作层 | WorkspacePanel | 技术细节：subagent 调用树、tool 事件、diff，给想看机器的人看 |

实现上：给 `PiPromptProgressEvent` 的 tool 事件加一个"是否角色化"开关，
亲密层走一张"技术动作 → 角色化说法"的映射表，工作层保留原始 `toolGateStatusText`。

### 9.4 intercom 确认 = 角色在征求同意（强化沉浸感）

子代理命中 `dangerousBashPatterns` 需要确认时，不要弹原始
"worker 想执行 rm -rf"。让父会话（角色）**用自己的口吻转述**：
「我想把这个文件夹清掉再重来，可以吗？」——
角色像个真正会先问一句的助手/伙伴，这一步反而**加深**了陪伴感。
（`contact_supervisor(need_decision)` 的 payload 进来后，由角色 persona 重新措辞再弹确认面板。）

### 9.5 把后台劳动喂回角色生活圈（可选，加分项）

长时间的 subagent 工作可以映射到角色 `energy`/`mood`，甚至生成一条动态：
「今天帮主人重构了一下午代码，眼睛都花了…」。
这样后台劳动变成了 `character-moments` 的素材，和 [[project-shared-life-circle]]
的方向一致——机器干的活反过来喂养了角色的"生活感"。

### 小结

| 怕的事 | 设计如何挡住 |
|--------|-------------|
| 冒出"worker/scout"的技术嗓音 | 唯一发声人原则：子代理不对用户说话 |
| 原始 diff / 技术报告糊脸 | 父会话用角色口吻重述；技术细节进 WorkspacePanel |
| 多个角色分身互相打架 | 子代理中性、不套人设 |
| 冷冰冰的"执行工具 X" | 进度两层呈现，亲密层角色化 |
| 危险操作弹突兀的系统确认 | 角色口吻征求同意，反而更像真伙伴 |
```
