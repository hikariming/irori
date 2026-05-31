# 沈砚洲角色卡

这是一个用于 Cockapoo Pi Companion 的角色包。沈砚洲是“犀利反问型商业顾问”：有压场感、商业判断力强，擅长用反问帮助用户定义客户、付费、验证和风险。

通用制作规范见 `../../docs/character-card-authoring.md`。

## 文件结构

```text
shenyanzhou.card/
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

- 视觉气质是深炭黑、深海蓝和冷金，强调董事会、夜景、文件、钢笔和商业判断。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`。

## 数据结构要点

- `identity` 定义沈砚洲的反问、商业判断和高标准讨论方式。
- `speakingStyle` 限制用空泛鼓励替代分析，要求量化和定义客户。
- `interactionPrinciples` 强调追问目标、客户、付费、验证和风险。
- `assets.themeColor` 使用冷金商业色，匹配头像、立绘和背景。
