# Cockapoo 角色卡制作规范

本文档描述 Cockapoo Pi Companion 当前实际加载的角色卡包格式。`characters/shili.card` 是参考实现，桌面端会把可用角色包复制到 `apps/desktop/public/characters/` 下供前端直接加载。

本规范以前端解析器 `apps/desktop/src/components/character-cards.ts` 的实际行为为准。解析器只读取下文列出的字段，未列出的字段会被忽略。

## 目标

角色卡应该同时回答两个问题：

- 这个角色是谁：人格、背景、动机、说话方式、关系定位、互动原则。
- 前端如何呈现这个角色：头像、立绘、背景、表情贴纸、主题色。

角色卡不应该把运行时 UI 画死在图片里。聊天气泡、输入框、状态条、通知点、角色详情面板、按钮和文字说明都由前端渲染。

陪伴强度、工具权限和记忆策略目前不在角色卡里配置：工具确认和记忆行为由运行时（local-agent 与安全策略）统一控制，与角色无关。

## 包结构

推荐目录结构：

```text
<character-id>.card/
  card.json
  README.md
  assets/
    avatar/
      avatar.png
      avatar-circle.png
      avatar-small.png
    portraits/
      neutral.png
    stickers/
      neutral.png
      happy.png
      thinking.png
      comfort.png
      shy.png
      focused.png
      surprised.png
      worried.png
      proud.png
    backgrounds/
      default.png
  source/
    asset-sheet.png
```

`source/` 存放生成源图、资产板、提示词记录或人工编辑源文件。运行时不依赖 `source/`，但保留它能帮助后续重新生成和修补资产。

## 角色清单 manifest.json

前端先读取 `characters/manifest.json` 拿到角色 ID 列表，再逐个加载 `characters/<id>.card/card.json`。新增或下线角色时必须同步更新 manifest。

```json
{
  "characters": ["shili", "lulin", "shenyanzhou", "tangyuan", "sakuramio", "cenji"]
}
```

## card.json

`card.json` 顶层只有四类字段：元信息、`identity`、`assets`。结构示例：

```json
{
  "id": "shili",
  "name": "示璃",
  "identity": {
    "persona": "...",
    "background": "...",
    "coreMotivation": "...",
    "speakingStyle": "...",
    "interactionPrinciples": ["...", "..."],
    "examples": [
      { "user": "...", "reply": "...\n[sticker:focused]" }
    ]
  },
  "assets": {
    "avatar": "assets/avatar/avatar-circle.png",
    "portrait": "assets/portraits/neutral.png",
    "background": "assets/backgrounds/default.png",
    "themeColor": "#2f6f68",
    "stickers": [
      { "id": "neutral", "src": "assets/stickers/neutral.png", "textFallback": "我在听。" }
    ]
  }
}
```

### 元信息

- `id`：稳定的机器可读 ID，使用小写字母、数字和连字符。需与目录名和 manifest 一致。
- `name`：展示名。缺省时回退为 `id`。

### identity

`identity` 决定角色的灵魂，优先级高于记忆和会话上下文。所有字段都是字符串或字符串数组。

- `persona`：角色核心人格和陪伴气质。
- `background`：角色背景设定。写可影响行为的背景，不堆无关履历。
- `coreMotivation`：角色为什么愿意陪伴用户。
- `speakingStyle`：句式、语气、节奏、禁用表达。
- `interactionPrinciples`：字符串数组，根据不同用户状态调整回应密度的原则。
- `examples`：示例对话数组,用于锁定语气和处理方式(few-shot)。每条是 `{ "user": "用户说的话", "reply": "角色的回复" }`,建议每个角色 2-3 条,覆盖典型场景(如情绪安抚、要效率、追问)。`reply` 里可以单独成行放一个 `[sticker:<id>]` 标记演示表情用法。模型会模仿示例风格但不照抄内容。

写作要求：

- 角色设定要能指导具体回应，而不只是形容词。
- 避免强依赖、恋爱承诺、冒充真人关系。
- 不要让角色自称拥有未被授权的真实经历、位置或身份能力。

> 注：角色卡不再包含 `firstMessage`/开场白字段。新会话从空白开始，由用户先发起。

### assets

`assets` 描述视觉资源和主题。头像、立绘、背景是相对 `card.json` 的图片路径（也支持 `/` 开头的绝对路径或 `http` 链接）。

- `avatar`：主要头像路径。缺省为 `assets/avatar/avatar-circle.png`。
- `portrait`：立绘路径，用于角色详情或主舞台。缺省为 `assets/portraits/neutral.png`。
- `background`：聊天背景路径。缺省为 `assets/backgrounds/default.png`。
- `themeColor`：角色主题色（十六进制）。缺省为 `#2f6f68`。应来自头像、立绘或背景，不要只因为好看而脱离角色资产。
- `stickers`：表情贴纸数组，见下。

#### stickers

贴纸用于轻量情绪反馈。基础集固定为九种，ID 必须完整覆盖：

```text
neutral  happy  thinking  comfort  shy  focused  surprised  worried  proud
```

每个贴纸条目只需三个字段：

- `id`：贴纸 ID，必须是上面九种之一，并与文件名保持一致。
- `src`：图片路径。缺省为 `assets/stickers/<id>.png`。
- `textFallback`：无法显示贴纸时的短文本。

情绪标签、意图（`react`/`comfort`/`celebrate`/`nudge`/`tease`）和中文标签由前端的 `stickerMeta` 统一提供，不在角色卡里配置。运行时会按九种基础情绪渲染缺失的贴纸条目，但应在卡里补全九种以保证视觉一致。贴纸可以夸张一些，但应该与 `speakingStyle` 一致。

#### backgrounds 画面边界

背景图只画环境，不画前端 UI。

允许：

- 室内、窗景、桌面、光影、植物、城市远景等环境元素。
- 适合叠加聊天内容的自然留白。
- 与角色气质一致的色温和材质。

禁止：

- 聊天气泡、消息框、输入框、通知点。
- 圆角 UI 卡片、按钮、状态栏、面板边框。
- 文字、水印、logo。
- 会被误认为前端控件的半透明矩形或装饰点。

## 资产制作规范

### 尺寸与格式

- 运行时图片使用 PNG。
- 当前示例背景为 `555x817` 竖图，桌面端会通过 CSS 覆盖聊天区域。
- 头像至少保留一份高质量源图、一份圆形展示图、一份小尺寸图。
- 贴纸尺寸应保持同一视觉尺度，避免某个情绪显得异常巨大或模糊。

### 风格一致性

同一角色的头像、立绘、贴纸和背景应该共享：

- 线条密度。
- 色温。
- 光照方向。
- 材质处理。
- 年龄感和气质。

### 前端边界

图片资产只负责角色和环境。以下内容永远属于前端：

- 聊天气泡和消息布局。
- 输入框。
- 角色状态条。
- 角色详情卡片。
- 在线状态、通知点、按钮。
- 任何可交互控件。

如果生成图里出现上述内容，应重新生成或编辑移除，不应靠 CSS 遮挡。

## 制作流程

1. 写 `identity`，先确认角色行为。
2. 生成或绘制资产板，产出头像、立绘、九种贴纸、背景。
3. 裁切并命名资产，保持路径与 `card.json` 一致。
4. 检查背景是否没有 UI 元素。
5. 检查贴纸是否覆盖九种基础情绪。
6. 更新 `README.md`，说明资产来源和使用建议。
7. 把角色包复制到 `apps/desktop/public/characters/`，并把 `id` 加入两份 `manifest.json`，保持运行时资源同步。
8. 在桌面端加载检查头像、立绘、贴纸、背景和主题色。

## 发布前清单

- `card.json` 是合法 JSON。
- `id` 与目录名、`manifest.json` 一致。
- `identity` 字段齐全，`interactionPrinciples` 为字符串数组，`examples` 为 `{ user, reply }` 对象数组。
- 所有 `src` 指向的文件都存在。
- `assets.stickers` 覆盖九种基础情绪 ID，且文件名与 `id` 一致。
- 头像、立绘、贴纸和背景风格一致。
- 背景没有聊天气泡、消息框、输入框、按钮、状态点、文字或水印。
- `themeColor` 来自角色资产配色。
- 根角色包和桌面端 public 角色包内容同步，两份 `manifest.json` 一致。
