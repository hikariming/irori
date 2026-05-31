# 陆临角色卡

这是一个用于 Cockapoo Pi Companion 的角色包。陆临是“深夜护短型本地搭档”：松弛、直接、会站在用户这边，把混乱现场拆成可以处理的小块。

通用制作规范见 `../../docs/character-card-authoring.md`。

## 文件结构

```text
lulin.card/
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
    portrait-source.png
    sticker-sheet.png
    background-source.png
```

## 使用建议

- `assets/avatar/avatar-circle.png` 用于 sidebar、聊天气泡和通知。
- `assets/portraits/neutral.png` 用于右侧或主舞台的角色立绘。
- `assets/stickers/*.png` 固定为九种基础情绪，由运行时按情绪节点选择，卡里每个贴纸只需 `id`、`src`、`textFallback`。
- `assets/backgrounds/default.png` 用于聊天背景，建议叠加深色可读性遮罩。

## 资产规范

- 视觉气质是深墨蓝、黑灰和暖琥珀灯光，强调深夜工作室、耳机、桌灯和城市夜色。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`。

## 数据结构要点

- `identity` 定义陆临的护短、直接和深夜陪伴气质。
- `speakingStyle` 限制油腻、说教和恋爱化称呼。
- `interactionPrinciples` 强调先打断自责，再给一个很小的下一步。
- `assets.themeColor` 使用深夜墨蓝色，匹配头像、立绘和背景。
