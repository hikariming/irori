# Cockapoo 角色卡制作规范

本文档描述 Cockapoo Pi Companion 当前的角色卡包格式。`characters/shili.card` 是参考实现，桌面端会把可用角色包复制到 `apps/desktop/public/characters/` 下供前端直接加载。

## 目标

角色卡应该同时回答三个问题：

- 这个角色是谁：人格、背景、说话方式、边界。
- 这个角色如何陪伴和协作：情绪支持、主动性、工具权限、记忆策略。
- 前端如何呈现这个角色：头像、立绘、表情贴纸、背景、主题色。

角色卡不应该把运行时 UI 画死在图片里。聊天气泡、输入框、状态条、通知点、角色详情面板、按钮和文字说明都由前端渲染。

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

## card.json

当前示例使用 `version: 2`。顶层字段分为元信息、身份、策略、资产、运行时默认值和来源信息。

### 元信息

- `id`：稳定的机器可读 ID，使用小写字母、数字和连字符。
- `version`：角色卡结构版本。结构字段变更时递增。
- `name`：展示名。
- `tagline`：一句短描述，用于角色详情或列表。
- `locale`：主要语言，例如 `zh-CN`。

### identity

`identity` 决定角色的灵魂，优先级高于记忆和会话上下文。

- `persona`：角色核心人格和陪伴气质。
- `background`：角色背景设定。写可影响行为的背景，不堆无关履历。
- `coreMotivation`：角色为什么愿意陪伴用户。
- `speakingStyle`：句式、语气、节奏、禁用表达。
- `relationship`：与用户的关系定位。
- `firstMessage`：新会话的开场语。
- `interactionPrinciples`：根据不同用户状态调整回应密度的原则。
- `immersionCues`：少量沉浸感表达，用于保持角色感。

写作要求：

- 角色设定要能指导具体回应，而不只是形容词。
- 避免强依赖、恋爱承诺、冒充真人关系。
- 不要让角色自称拥有未被授权的真实经历、位置或身份能力。

### companionPolicy

`companionPolicy` 控制陪伴强度和边界。

- `warmth`：温暖程度，例如 `low`、`medium`、`high`。
- `initiative`：主动性，例如 `low`、`balanced`、`high`。
- `emotionalSupportStyle`：情绪支持策略。
- `boundaries`：明确禁止或需要降级的陪伴方式。

### agentPolicy

`agentPolicy` 控制本地 Agent 行为。

- `defaultMode`：默认模式，例如 `companion`。
- `allowedTools`：无需额外确认即可使用的能力。
- `protectedPaths`：默认视为敏感的路径。
- `alwaysConfirm`：始终需要用户确认的能力。

原则：角色的亲近感不能绕过安全确认。写入文件、执行命令、外部网络访问等高风险动作应该保持确认。

### memoryPolicy

`memoryPolicy` 控制长期记忆。

- `rememberFacts`：是否记住稳定事实。
- `rememberPreferences`：是否记住偏好。
- `rememberEmotionalContext`：是否记住情绪上下文。默认应谨慎。
- `excludedTopics`：不应自动记忆的主题。

记忆是背景上下文，不是新的身份设定。记忆与 `identity` 冲突时，以角色卡身份为准。

### assets

`assets` 描述视觉资源和主题。

#### avatar

- `src`：主要头像，当前推荐圆形头像。
- `sourceSrc`：未裁切或高清源头像。
- `thumbnailSrc`：小尺寸头像。
- `shape`：展示形状，例如 `circle`。
- `fallbackText`：图片加载失败时的单字占位。
- `dominantColor`：头像主色，用于 UI 辅助色。
- `statusRing`：状态环风格，例如 `online`。

#### portraits

立绘用于角色详情面板或主舞台展示。

- `id`：立绘 ID。
- `src`：图片路径。
- `mood`：情绪基线。
- `pose`：姿势。
- `crop.desktopAnchor`：桌面端裁切锚点。
- `crop.mobileAnchor`：移动端裁切锚点。

立绘应只包含角色本体和必要的透明或干净背景，不要包含聊天界面元素。

#### stickers

贴纸用于轻量情绪反馈。当前基础集是九种：

- `neutral`
- `happy`
- `thinking`
- `comfort`
- `shy`
- `focused`
- `surprised`
- `worried`
- `proud`

每个贴纸条目包含：

- `id`：贴纸 ID，与文件名保持一致。
- `src`：图片路径。
- `emotion`：情绪标签。
- `intent`：使用意图，例如 `react`、`celebrate`、`comfort`、`nudge`、`tease`。
- `intensity`：强度，建议 1 到 3。
- `cooldownSeconds`：冷却时间，避免表情过度重复。
- `textFallback`：无法显示贴纸时的短文本。
- `triggerHints`：触发参考词，不是硬规则。

贴纸可以夸张一些，但应该与 `speakingStyle` 一致。

#### backgrounds

背景图用于聊天区域的环境氛围。背景必须只画场景，不画前端 UI。

允许：

- 室内、窗景、桌面、光影、植物、城市远景等环境元素。
- 适合叠加聊天内容的自然留白。
- 与角色气质一致的色温和材质。

禁止：

- 聊天气泡、消息框、输入框、通知点。
- 圆角 UI 卡片、按钮、状态栏、面板边框。
- 文字、水印、logo。
- 会被误认为前端控件的半透明矩形或装饰点。

字段：

- `id`：背景 ID。
- `src`：图片路径。
- `scene`：场景标签。
- `readabilityOverlay`：建议前端遮罩，例如 `light`。
- `defaultForMode`：默认使用模式，例如 `companion`。

#### theme

- `primaryColor`：主色，用于角色相关 UI。
- `accentColor`：辅助色。
- `textTone`：文本气质，例如 `clean`。

主题色应来自头像、立绘或背景，不要只因为好看而脱离角色资产。

### runtimeDefaults

`runtimeDefaults` 是角色首次加载时的状态，不是永久记忆。

- `currentMood`：初始情绪。
- `energy`：初始能量值。
- `affinity`：初始熟悉度。
- `activePortraitId`：默认立绘。
- `activeBackgroundId`：默认背景。

### provenance

`provenance` 记录资产来源。

- `source`：来源类型。
- `sourceImage`：源图路径。
- `generatedWith`：生成或制作方式。

如果资产经过二次修补，应在 README 或来源记录里说明关键修改，例如“背景图已移除生成时误入的聊天气泡，UI 由前端渲染”。

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

1. 写 `identity` 和策略字段，先确认角色行为。
2. 生成或绘制资产板，产出头像、立绘、九种贴纸、背景。
3. 裁切并命名资产，保持路径与 `card.json` 一致。
4. 检查背景是否没有 UI 元素。
5. 检查贴纸情绪是否覆盖基础九种状态。
6. 更新 `README.md`，说明资产来源和使用建议。
7. 把角色包复制到 `apps/desktop/public/characters/`，保持运行时资源同步。
8. 在桌面端加载检查头像、立绘、贴纸、背景和主题色。

## 发布前清单

- `card.json` 是合法 JSON。
- 所有 `src` 指向的文件都存在。
- `runtimeDefaults.activePortraitId` 存在于 `assets.portraits`。
- `runtimeDefaults.activeBackgroundId` 存在于 `assets.backgrounds`。
- 头像、立绘、贴纸和背景风格一致。
- 背景没有聊天气泡、消息框、输入框、按钮、状态点、文字或水印。
- 贴纸有合理的 `textFallback` 和 `cooldownSeconds`。
- `agentPolicy.alwaysConfirm` 覆盖写入、命令、外部网络等高风险动作。
- `memoryPolicy.excludedTopics` 覆盖敏感主题。
- 根角色包和桌面端 public 角色包内容同步。
