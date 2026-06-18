# Irori

![Irori 宣传横幅](apps/desktop/public/assets/readme-hero.png)

> **你的本地优先二次元 AI 伴侣，真的能帮你干活。**

**Irori** 是一个本地优先的桌面角色陪伴应用，基于 [Pi coding-agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 构建。它把 agent 会话包装成更有角色感的陪伴体验：每个角色都有自己的角色卡、人设、工作风格、记忆上下文、模型设置和协作能力，可以陪你聊天，也可以帮你写作、写代码、规划任务、整理结论。

[English README](README.md)

## 特色

- **角色陪伴。** 使用内置角色，或者创建你自己的角色卡。角色可以拥有不同的语气、人设、故事背景、头像和工作方式。
- **专业协作能力。** 角色能理解任务背景，拆解需求、跟进进度、整理结论，像专业搭档一样推进工作。
- **本地记忆与上下文。** 偏好、项目重点、协作习惯等信息可以保存在本地，后续沟通可持续引用，减少重复说明。
- **模型供应商预设。** 欢迎流程和设置页复用了模型供应商预设，也支持填写 OpenAI 兼容的 Base URL、模型名和 API Key。
- **桌面优先体验。** 使用 Tauri + React 构建，包含本地 sidecar runtime、安全确认门、角色 UI 和多语言欢迎流程。
- **自由角色卡。** 角色卡可以自由更换和创作：用你喜欢的角色、人物或原创设定，打造专属陪伴。

## 对比一览

聊天角色扮演和桌面虚拟形象都有很棒的工具。Irori 的不同之处在于：陪伴角色**真的能帮你把活干完**——它跑在 agent 运行时上，拥有本地记忆，并且是原生桌面应用。

| | **Irori** | **SillyTavern** | **Open-LLM-VTuber** | **OpenClaw** |
|---|---|---|---|---|
| 核心定位 | 能真正干活的二次元伴侣 | 角色扮演与聊天前端 | 语音互动的虚拟主播陪伴 | 通用 AI agent / 自动化 |
| 原生本地优先桌面应用 | ✅ Tauri 外壳 | ⚠️ 自建 Web UI | ⚠️ 自建 Web/桌面 | ⚠️ 多为终端 / Web |
| 智能体协作（写作 · 写码 · 规划 · 跟进） | ✅ 基于 Pi agent SDK，写码与任务执行更强 | ❌ 仅聊天 | ❌ 仅聊天 | ✅ 通用 agent |
| 二次元角色陪伴 | ✅ 核心体验 | ⚠️ 偏角色扮演 | ✅ | ❌ |
| 角色卡 | ✅ 可编辑 schema + 提示词组合 | ✅ | ⚠️ 有限 | ❌ |
| 本地记忆与上下文 | ✅ 内置，本地优先 | ⚠️ 需插件 | ⚠️ 基于会话 | ⚠️ 视实现而定 |
| 工具调用与安全门 | ✅ 确认策略 + 受保护路径 | ❌ | ❌ | ⚠️ 视实现而定 |
| 语音 / Live2D 形象 | 🔜 规划中 | ⚠️ 需插件 | ✅ 核心功能 | ❌ |
| 多渠道接入（Discord 等） | 🔜 规划中 | ⚠️ 需插件 | ⚠️ | ⚠️ 视实现而定 |
| 陪伴手机 App | 🔜 规划中 | ❌ | ❌ | ❌ |
| 最适合 | 帮你思考、写作、交付的搭档 | 沉浸式角色扮演 | 和桌面老婆聊天 | 无界面任务自动化 |

想要沉浸式角色扮演，SillyTavern 很出色；想要会说话的 Live2D 形象，Open-LLM-VTuber 很出色；想要纯粹的无界面自动化，OpenClaw 也合适。而 Irori 把**真正的二次元角色陪伴**和**更强的写码与任务执行能力**结合在一个原生、本地优先的桌面应用里——多渠道接入和手机 App 也已在规划中。

### 路线图

- **多渠道接入** —— 把你的陪伴角色带到 Discord 等聊天渠道。
- **陪伴手机 App** —— 在手机上延续同一个角色、记忆与工作流。
- **语音与 Live2D** —— 给角色一张脸和一把声音。

## 使用流程

Irori 的欢迎流程会引导你完成基础设置：

1. 选择界面语言。
2. 了解角色陪伴和角色卡系统。
3. 选择或配置模型供应商。
4. 进入本地角色陪伴工作区。

项目目前包含多个内置角色资源和角色卡，并提供角色卡解析、校验和提示词组合的基础包。

## 项目结构

```text
apps/
  desktop/          Tauri + React 桌面端
    src/            React 前端：聊天、欢迎页、设置、角色界面
    src-tauri/      桌面端 Rust 后端
    sidecar/        嵌入 Pi SDK runtime 的 Node sidecar
characters/         内置角色卡包
packages/
  character-card/   角色卡 schema 与提示词组合
  companion-core/   角色会话相关共享类型
  memory/           本地优先记忆接口与后端
  pi-runtime/       Pi SDK 会话与事件适配层
  safety/           工具模式、确认策略、受保护路径
  ui/               共享 UI 组件
docs/               项目实现说明
```

## 本地开发

准备环境：

- Node.js 22+
- [pnpm](https://pnpm.io/)
- [Rust toolchain](https://rustup.rs/)（Tauri 桌面构建需要）

安装依赖：

```bash
pnpm install
```

启动桌面端开发模式：

```bash
npm run dev
```

常用脚本：

```bash
npm run desktop:vite   # 只启动前端，Vite 地址为 127.0.0.1:1420
npm run desktop:build  # 通过 Tauri 构建桌面端
npm test               # 运行角色卡包测试
```

## 模型配置

Irori 在欢迎流程和设置页里提供模型供应商预设。你也可以手动配置 OpenAI 兼容供应商：

- Base URL
- 模型名称
- API Key

请不要把个人 API Key 或本地密钥提交到仓库。

## 角色卡

内置角色卡位于 `characters/`，桌面端可访问的副本位于 `apps/desktop/public/characters/`。角色卡相关工具位于 `packages/character-card/`。

角色卡负责描述角色的身份、语气、技能、提示词片段和资源引用。这样角色就不是写死在应用里的功能，而是可以自由替换、编辑和创作的陪伴对象。

## 测试

```bash
npm test

cd apps/desktop/sidecar
node --test test/*.mjs

cd apps/desktop
npm run typecheck
```

## License

本项目基于 [Apache License, Version 2.0](LICENSE) 授权。
