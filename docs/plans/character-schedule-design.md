# 设计：角色定时任务 —— 进程内调度器 + 角色自助 schedule 工具 + 系统通知推送

> 目标：用户能让角色"每晚 8 点帮我做 xxx"，到点角色自动跑一遍 prompt，结果以
> **系统通知 + 侧边栏红点** 推送；同时 sidebar 提供「定时任务」入口做手动 CRUD。
> 两条创建路径并存：**角色在聊天里识别意图后调用 `schedule` 工具自建**，以及**用户
> 在面板里手动增删改查**。
>
> 决策基线（已与用户确认）：
> - 推送去向 = **系统通知 + 红点**（不写聊天 / 不发生活圈）。运行历史仍落库供面板查看。
> - 创建方式 = **角色自动创建 + 手动 CRUD 两者都要**。
> - 触发范围 = **仅应用运行时**（Rust 进程内后台线程）；**启动时补跑错过的任务**。

---

## 0. 设计原则

1. **复用既有 sidecar 链路，不另起执行引擎**：到点执行 = 直接调现成的
   `run_sidecar_prompt`（`src-tauri/src/lib.rs:806`），它已能在后台线程
   （`spawn_blocking`）里带完整角色上下文跑 prompt 并流式回传。调度器只负责
   "什么时候、用哪个角色、跑哪段 prompt"，执行体零新增。
2. **调度在 Rust，不在前端**：后台线程进程内常驻，前端开不开聊天窗口都不影响触发。
   触发范围限"应用运行时"——app 进程活着就准点跑，关掉则不跑，下次启动补跑错过的。
3. **单一真相源在 SQLite**：任务定义、角色归属、运行历史全进 DB（抄 `character_moment`
   ~1921 / `character_skill` 范式）。sidecar 保持无 DB 依赖——Rust 查好、传扁平数据。
4. **角色自建 = 一个 pi 自定义工具 + 一条新 stream 消息回写**：角色调 `schedule_create`
   工具，sidecar 不碰 DB，而是像 `ConfirmRequest`→`pi_tool_confirm`（`lib.rs:997`）
   那样发一条结构化 stream 消息，由 Rust 落库。两条创建路径最终写同一张表。
5. **沿用既有范式**：前后端通信抄 `desktop-backend` + Tauri command；侧边栏/面板抄
   `onSkillsOpen` + `SkillsPanel`（`CompanionSidebar.tsx:223` / `App.tsx`）；红点抄
   `letter-badge`（`CompanionSidebar.tsx:262`）。

---

## 1. 现状（grounded）

### 1a. 执行链路（已查证，可直接复用）
```
send_pi_prompt (lib.rs:464, #[tauri::command], async)
  └─ spawn_blocking → run_sidecar_prompt(app, prompt, Some(request), None)  (:806)
        └─ build_sidecar_prompt_payload(...)   // 角色身份/技能/工具策略/模型设置全在此拼
        └─ execute_sidecar_prompt_streaming(app, agent_dir, payload)  (:895)
              └─ Command::new("pnpm") 跑 sidecar，逐行读 stdout
read_sidecar_stream (lib.rs:976)
  ├─ Progress(event)       → app.emit("pi_prompt_progress", event)   (:993)
  ├─ ConfirmRequest(req)   → app.emit("pi_tool_confirm", req)        (:997)
  └─ Final(response)       → 返回最终结果
```
→ **关键**：`run_sidecar_prompt` 已是可在任意后台线程调用的纯函数（入参 `app` +
`prompt` + 可选 `request`）。调度器到点时构造一个"系统发起"的请求直接调它即可，
不需要前端在场。

### 1b. 当前缺口
- 无任何"定时/cron"概念：没有调度线程、没有任务表。
- Tauri Builder（`lib.rs:2941`）只 `.manage(PromptStdinRegistry::default())`，没有
  调度器状态、没有 notification 插件。
- 角色无法自建任何持久化副作用——现有自定义工具都是即时返回，没有"回写 DB"的通道。

### 1c. 依赖现状（`src-tauri/Cargo.toml`）
- 已有：`tauri-plugin-dialog`、`tauri-plugin-opener`。
- **需新增**：`tauri-plugin-notification = "2"`（系统通知）、`tokio`（带 `time` feature，
  跑 `interval`；若已被 tauri 间接引入则只补 feature）。cron 解析可用 `cron = "0.12"`
  或自己解析受限网格（见 §3c，建议先自解析避免引入重依赖）。

---

## 2. 存储层（SQLite，`lib.rs` 建表区 ~2008 起）

### 2a. 任务表
```sql
CREATE TABLE IF NOT EXISTS scheduled_task (
  id              TEXT PRIMARY KEY,            -- uuid
  character_id    TEXT NOT NULL,               -- 由哪个角色执行（单角色）
  title           TEXT NOT NULL,               -- 列表展示名，如「每晚总结」
  prompt          TEXT NOT NULL,               -- 到点喂给该角色的指令正文
  schedule_kind   TEXT NOT NULL,               -- 'daily' | 'weekly' | 'weekdays' | 'once' | 'cron'
  schedule_spec   TEXT NOT NULL,               -- 见 §3c：'20:00' / '1,3,5@20:00' / ISO8601 / cron 串
  enabled         INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL DEFAULT 'user',-- 'user'(面板建) | 'agent'(角色建)
  next_run_at     TEXT,                        -- 预计算的下次触发(UTC ISO8601)，调度器主键
  last_run_at     TEXT,                        -- 上次实际触发
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_due
  ON scheduled_task(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_sched_character
  ON scheduled_task(character_id, created_at DESC);
```
> `next_run_at` 预计算是核心：调度器每分钟只需 `WHERE enabled=1 AND next_run_at<=now`，
> 不必每 tick 重算所有 cron。每次跑完 / 改定义后重算并回写 `next_run_at`。

### 2b. 运行历史表（面板查看 + 启动补跑判定）
```sql
CREATE TABLE IF NOT EXISTS scheduled_task_run (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  character_id  TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,                 -- 这次本应触发的时刻
  ran_at        TEXT NOT NULL,                 -- 实际开跑时刻
  status        TEXT NOT NULL,                 -- 'ok' | 'error' | 'skipped'
  result        TEXT,                          -- 角色产出的最终文本(截断存)
  error         TEXT,
  read          INTEGER NOT NULL DEFAULT 0,    -- 红点未读：0=未读
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_run_task ON scheduled_task_run(task_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_sched_run_unread ON scheduled_task_run(read);
```
> 红点未读数 = `SELECT count(*) FROM scheduled_task_run WHERE read=0`。打开面板/某任务
> 后置 `read=1`，与 `letter-badge` 完全同构。

> 归属说明：v1 用 `scheduled_task.character_id` 单角色归属（一个任务由一个角色执行），
> 不做技能那种多对多——简单优先。要"多角色各跑一份"就建多条任务。日后若要，再加
> `scheduled_task_assignment` 桥表升级为多对多（与 `character_skill` 同构），不影响现有数据。

### 2c. 新增 Rust Tauri 命令（模式同 `insert_character_moment_*` / `list_skills`）
| 命令 | 作用 |
|------|------|
| `list_scheduled_tasks(character_id: Option<String>) -> Vec<ScheduledTask>` | 面板列表；可按角色过滤 |
| `create_scheduled_task(req: SaveScheduledTaskRequest) -> ScheduledTask` | 校验 + 算 `next_run_at` + 插入 |
| `update_scheduled_task(req) -> ScheduledTask` | 重写定义 + 重算 `next_run_at` |
| `delete_scheduled_task(id)` | 删任务 + 其 run 历史 |
| `set_scheduled_task_enabled(id, enabled)` | 暂停/恢复（enabled 切换 + 重算 next） |
| `run_scheduled_task_now(id)` | "立即试跑一次"——手测用，复用同一执行路径 |
| `list_task_runs(task_id) -> Vec<TaskRun>` | 某任务运行历史（右栏明细） |
| `scheduled_unread_count() -> i64` | 侧边栏红点数 |
| `mark_task_runs_read(task_id: Option<String>)` | 清未读（打开面板或某任务时） |

Rust 结构（serde camelCase，抄 `SaveSkillRequest`/`SkillRecord` ~339）：
```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
struct SaveScheduledTaskRequest {
    id: Option<String>, character_id: String, title: String, prompt: String,
    schedule_kind: String, schedule_spec: String, enabled: bool,
}
#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
struct ScheduledTask { /* 全字段 + next_run_at/last_run_at */ }
```

---

## 3. 调度器（核心新增，Rust 进程内）

### 3a. 常驻线程（Tauri `setup` 内启动，`lib.rs:2942` Builder 链）
```rust
.setup(|app| {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        // 启动补跑：扫 enabled 且 next_run_at <= now 的过期任务，逐个执行一次
        catch_up_missed(&handle).await;
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            run_due_tasks(&handle).await;   // WHERE enabled=1 AND next_run_at<=now
        }
    });
    Ok(())
})
```
- **粒度 = 分钟**：到点容差 ≤60s，足够"每晚 8 点"类场景；省 CPU。
- `run_due_tasks`：查到期任务 → 逐个 `execute_scheduled(&handle, task)` → 更新
  `last_run_at` + 重算 `next_run_at`（若 `once` 则置 `enabled=0`）。
- **串行执行** + 软去重：用 `Mutex<HashSet<task_id>>`（`.manage` 的调度状态）防同一任务
  重入；不同任务顺序跑（避免多个 sidecar 同时 spawn 抢资源）。

### 3b. 单个任务执行 `execute_scheduled(handle, task)`
```
1. 插一行 scheduled_task_run(task_id, character_id, status 先留空, scheduled_for, ran_at=now)
2. 构造"系统发起"的 SendPiPromptRequest：
     characterId = task.character_id
     prompt      = task.prompt
     —— 复用 build_sidecar_prompt_payload，使该角色的技能/工具策略/记忆全部生效
3. run_sidecar_prompt(handle, task.prompt, Some(request), None)   // 现成函数
4. 拿到 Final 文本 → 更新 run.status='ok' / result=截断文本 / read=0
   出错 → status='error' / error=...
5. 触发推送（§5）：系统通知 + emit("scheduled_task_run", {...}) 让前端刷新红点
6. 更新任务 last_run_at + 重算 next_run_at（once → enabled=0）
```
> 注意：调度执行走**非交互**模式——工具确认（`pi_tool_confirm`）在无人值守时不能弹窗
> 等待。策略：定时任务默认按角色现有 `toolPolicySettings` 的"已允许"集合自动放行，遇到
> 需确认的工具则**跳过该工具调用并在结果里标注**（不阻塞、不静默全放开）。这条要在
> payload 里带一个 `unattended: true` 标志，sidecar 据此对"需确认"工具走拒绝分支。

### 3c. `schedule_spec` 解析与 `next_run_at` 计算
v1 不引 cron 库，自解析受限网格（覆盖绝大多数"每天/每周 X 点"需求）：

| `schedule_kind` | `schedule_spec` 例 | 含义 |
|-----------------|--------------------|------|
| `daily`    | `20:00`            | 每天 20:00（本地时区） |
| `weekdays` | `20:00`            | 周一~周五 20:00 |
| `weekly`   | `1,3,5@20:00`      | 周一/三/五 20:00（0=周日） |
| `once`     | `2026-06-10T20:00` | 指定本地时刻一次性 |
| `cron`     | `0 20 * * *`       | 逃生舱：高级用户填标准 cron（P2 接 `cron` 库） |

`compute_next_run(kind, spec, from)`：按本地时区算出严格大于 `from` 的最近触发点，转
UTC ISO8601 存。**时区**：以系统本地时区计算（用户说"晚 8 点"是本地概念），存 UTC 避免
DST/迁移歧义；用 `chrono::Local`。

---

## 4. 角色自助创建（聊天里"每晚 8 点帮我 xxx"）

### 4a. 新增 pi 自定义工具 `schedule_create`（sidecar 侧注册）
在 sidecar 现有 customTools 注册处加一个工具，schema：
```jsonc
{
  "name": "schedule_create",
  "description": "当用户要求你在未来某个时间/每天某时定期帮他做某事时调用，登记一个定时任务。",
  "input": {
    "title":        "string  // 简短任务名，如『每晚工作总结』",
    "prompt":       "string  // 到点时你要执行的完整指令（用第二人称写给未来的你自己）",
    "scheduleKind": "enum daily|weekdays|weekly|once|cron",
    "scheduleSpec": "string  // 见 §3c 格式，如 '20:00'",
    "confirmText":  "string  // 给用户的口头确认，如『好的，我每晚8点帮你总结～』"
  }
}
```
工具**不直接落库**（sidecar 无 DB）。它执行时：
1. 校验 spec 格式（非法则工具返回错误，让模型改）；
2. 发一条新 stream 消息（见 4b），把任务塞回 Rust；
3. 工具返回 `confirmText` 给模型，模型把它说给用户 → 用户在聊天里看到"好的，每晚 8 点…"。

### 4b. 新 stream 消息回写（抄 `ConfirmRequest` 范式）
`parse_sidecar_stream_line`（`lib.rs:946`）+ `read_sidecar_stream`（`:976`）加一支：
```rust
ScheduleUpsert(task) => {
    // 当前会话已知 character_id（payload 里有）= 执行角色，落库
    upsert_scheduled_task_from_agent(&app, current_character_id, task)?;
    app.emit("scheduled_task_changed", ());   // 前端面板若开着则刷新
}
```
> 角色自建 = 自己执行（"我帮你每晚总结"= 我来做）。agent 建和面板建写的是同一张表，
> `source` 字段区分来源。
sidecar 侧 `prompt-runner.mjs` 在工具回调里 `process.stdout.write(JSON.stringify({type:"schedule_upsert", task})+"\n")`，与现有 Progress/ConfirmRequest 同管道。

> 这样"角色建"和"面板建"最终都走 `upsert_scheduled_task_*` → 同一张表 → 同一个调度器。
> `source` 字段区分来源，面板里可给 agent 建的任务打个"由 XX 提议"标记。

### 4c. （可选，P2）`schedule_list` / `schedule_cancel` 工具
让角色也能"把我之前设的早八提醒取消掉"。同 4a/4b 范式，v1 先只做 create。

---

## 5. 推送：系统通知 + 红点

### 5a. 系统通知（`tauri-plugin-notification`）
`execute_scheduled` 跑完后：
```rust
use tauri_plugin_notification::NotificationExt;
app.notification().builder()
   .title(format!("{} · {}", character_name, task.title))
   .body(truncate(result, 120))
   .show()?;
```
点击通知 → 唤起主窗 + 打开定时任务面板对应任务（P2 接 deep-link；v1 仅弹通知）。
Builder 链加 `.plugin(tauri_plugin_notification::init())`，并在 `tauri.conf.json` 配
notification 权限。

### 5b. 侧边栏红点（复用 `letter-badge`）
- 新增 sidebar「定时任务」按钮（§6b），徽标数 = `scheduled_unread_count()`。
- Rust 每次 run 完 `emit("scheduled_task_run", {...})`；`App.tsx` 监听后刷新计数
  （抄现有 `onPiPromptProgress` 监听范式 `App.tsx:569`）。
- 打开面板 / 查看某任务 → `mark_task_runs_read` → 计数归零。

---

## 6. 前端

### 6a. 后端绑定（`desktop-backend.ts`，抄 skills 那批 `invoke` 封装）
类型 + 封装：`listScheduledTasks`、`createScheduledTask`、`updateScheduledTask`、
`deleteScheduledTask`、`setScheduledTaskEnabled`、`runScheduledTaskNow`、`listTaskRuns`、
`scheduledUnreadCount`、`markTaskRunsRead`；事件监听 `onScheduledTaskRun(cb)`、
`onScheduledTaskChanged(cb)`（`listen` 封装，抄 `onPiPromptProgress`）。
`createPreviewBackend` 给浏览器预览态补 mock。

### 6b. 侧边栏入口（`CompanionSidebar.tsx:202` footer + `App.tsx`）
- `CompanionSidebarProps` 加 `onSchedulesOpen?` + `schedulesUnreadCount?`。
- footer `sidebar-footer__group` 内加一颗按钮（闹钟图标），带 `letter-badge`（抄 :262）：
```tsx
<Button aria-label="定时任务" className="sidebar-icon-button" onPress={onSchedulesOpen} type="button">
  <svg className="sidebar-life-icon" viewBox="0 0 24 24" width="16" height="16"
       fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2" />
    <path d="M5 3 2.5 5.5M19 3l2.5 2.5" />   {/* 闹钟铃铛脚 */}
  </svg>
  {schedulesUnreadCount > 0 ? (
    <span className="letter-badge">{schedulesUnreadCount > 9 ? "9+" : schedulesUnreadCount}</span>
  ) : null}
</Button>
```
- `App.tsx` 加 `isSchedulesOpen` state + 打开时互斥关其它 panel（同 skills/life）。

### 6c. `SchedulesPanel.tsx`（新文件，双栏，复用 `SkillsPanel` 外壳）
- **左栏**：任务列表（`listScheduledTasks`），每行显示 `title` + 执行角色头像 + 下次触发的
  人类可读时间（"今天 20:00" / "每天 20:00"）+ enable 开关 + agent 来源标记；底部
  「＋ 新建任务」。
- **右栏（选中/新建）**编辑表单：
  - `title`、执行角色（下拉单选，`useCharacterCards`）、`prompt`（多行）
  - 调度方式：分段控件 `daily / weekdays / weekly / once / cron` → 对应输入：
    - daily/weekdays：时间选择器 → `HH:MM`
    - weekly：周几多选 + 时间 → `1,3,5@20:00`
    - once：日期时间选择器 → ISO
    - cron：裸文本框 + 校验提示（逃生舱）
  - 「立即试跑」按钮（`runScheduledTaskNow`，验证 prompt 效果）
  - 保存 / 删除 / 暂停
  - **运行历史区**：`listTaskRuns` 列出最近 N 次（时间 / 状态 / 结果摘要，点开看全文）。
    打开即 `markTaskRunsRead`。
- 外壳复用 `system-settings-panel` + `settings-page-inner`（同 SkillsPanel）。

### 6d.（可选 P2）角色卡侧反向入口
`CharacterCardSettings.tsx` 角色详情加"定时任务"区块，列出该角色名下的任务——与 6c 同
一张表的角色视角。v1 可不做。

---

## 7. 测试

- **Rust**：
  - `compute_next_run` 各 kind 正确性（跨午夜、跨周、weekdays 跳周末、once 过期不再触发、DST 边界）。
  - `scheduled_task` CRUD 往返；`run_due_tasks` 只取 `enabled=1 && next_run_at<=now`；
    跑完正确重算 next（once → enabled=0）。
  - `scheduled_task_run` 写入 + `scheduled_unread_count` + `mark_task_runs_read`。
  - 启动补跑：构造一条 `next_run_at` 在过去的任务，`catch_up_missed` 跑且只跑一次。
- **sidecar**（`prompt-runner.test.mjs` / 新 test）：
  - `schedule_create` 工具：合法输入 → 产出 `schedule_upsert` stream 消息且字段正确；
    非法 `scheduleSpec` → 工具返回错误、不发消息。
  - `unattended:true` 时需确认工具走拒绝分支、不挂起。
- **前端**：SchedulesPanel CRUD 渲染、调度方式分段控件 ↔ `schedule_spec` 互转、红点未读流转。

---

## 8. 分期

- **P1（最小闭环）**：两张表 + Rust 命令 + 调度线程（daily/weekdays/weekly/once）+
  `execute_scheduled` 复用 `run_sidecar_prompt` + 系统通知 + 红点 + SchedulesPanel 手动 CRUD
  （执行角色单选）。手测：建一条"1 分钟后"的 once 任务，验证到点角色跑、弹通知、红点亮、
  历史有记录。
- **P2（角色自助 + 体验）**：`schedule_create` 工具 + `schedule_upsert` 回写链路（§4）；
  通知点击 deep-link 到任务；运行历史全文查看；cron kind 接 `cron` 库；角色卡反向入口。
- **P3（进阶）**：`schedule_list`/`schedule_cancel` 工具让角色管理已有任务；失败重试与退避；
  "错过补跑"的用户可配策略（补跑 / 跳过 / 合并）；任务级独立工具白名单。

---

## 9. 边界与注意

1. **仅应用运行时**：app 关闭则不触发——这是已确认的范围。UI 要讲清"需保持牛马在后台
   运行"，避免用户以为关机也会跑。`once` 任务若错过，启动补跑只补"最近一次"，不补多次。
2. **无人值守的工具确认**：定时执行不能弹 `pi_tool_confirm` 等人。`unattended:true` 下
   需确认的工具一律拒绝并在结果标注，绝不静默全放开（安全围栏 `packages/safety` 仍生效）。
3. **并发与资源**：同一时刻多任务到点时串行跑，避免并发 spawn 多个 sidecar；单任务用
   `HashSet` 去重防重入（上一次还没跑完又到点）。
4. **时区**：按 `chrono::Local` 计算、存 UTC。用户改系统时区后，下次 `compute_next_run`
   自然以新时区算；不追溯已算出的 `next_run_at`（可在设置变更时提供"重算全部"）。
5. **删除一致性**：`delete_scheduled_task` 连带删 `scheduled_task_run`；角色被删时清其名下
   任务（或 `list` 时 join 角色表过滤孤儿）。
6. **prompt 注入风险**：`schedule_create` 由模型填 `prompt`，到点会以该角色身份执行——
   等价于角色给自己排了未来的指令。范围受该角色既有技能/工具策略约束，不放大权限。
7. **红点与通知一致**：通知是"瞬时"、红点是"留存未读"。两者都由 run 完成事件驱动，计数
   以 DB `read=0` 为准（重启后仍在），不依赖前端内存。
