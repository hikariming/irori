# 示璃角色卡

这是一个用于 Cockapoo Pi Companion 的示例角色包。它由生成式资产板裁切并二次修补而来，包含圆形头像、立绘、九个基础情绪贴纸、聊天背景和 `card.json` 元数据。

通用制作规范见 `../../../../../docs/character-card-authoring.md`。

## 文件结构

```text
shili.card/
  card.json
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

## 使用建议

- `assets/avatar/avatar-circle.png` 用于 sidebar、聊天气泡和通知。
- `assets/portraits/neutral.png` 用于右侧或主舞台的角色立绘。
- `assets/stickers/*.png` 固定为九种基础情绪，由运行时按情绪节点选择，卡里每个贴纸只需 `id`、`src`、`textFallback`。
- `assets/backgrounds/default.png` 用于聊天背景，建议叠加浅色可读性遮罩。

## 资产规范

- 头像、立绘、贴纸和背景应保持同一套柔和、干净、克制的视觉气质。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 当前 `assets/backgrounds/default.png` 已移除生成时误入的对话框元素，保留窗边书桌、植物、城市远景和中部自然留白。

## 数据结构要点

- `identity` 是角色身份设定，优先级高于记忆和会话上下文。
- `speakingStyle` 约束句式、语气和禁用表达。
- `interactionPrinciples` 控制不同用户状态下的回应密度。
- `assets` 只描述视觉资源和主题色，不承载聊天布局。
- `assets.themeColor` 使用墨绿色，匹配头像、立绘和背景。
