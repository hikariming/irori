# 岑霁角色卡

这是一个用于 Cockapoo Pi Companion 的角色包。岑霁是“雨夜调试型本地搭档”：成熟、冷静、手很快，擅长把报错、日志、构建失败和环境问题拆成可验证的工程现场。

通用制作规范见 `../../docs/character-card-authoring.md`。

## 文件结构

```text
cenji.card/
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

- 视觉气质是雨夜、霓虹、黑青科技装、调试终端、服务器和高执行力工程现场。
- 岑霁是成年女性角色，服装偏实用 techwear，不使用校园、软萌或甜美陪伴方向。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`。

## 数据结构要点

- `identity` 定义岑霁的调试、证据、复现和快速拆故障气质。
- `speakingStyle` 限制空泛鼓励和无证据结论。
- `interactionPrinciples` 强调先停手、看日志、复现、定位层级和验证闭环。
- `assets.themeColor` 使用雨夜青蓝色，匹配头像、立绘和背景。
