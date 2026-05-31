# 唐愿角色卡

这是一个用于 Cockapoo Pi Companion 的角色包。唐愿是“软糖护短型本地搭档”：温柔、可爱、会先接住用户的情绪，再把混乱的问题拆成可以处理的小块。

通用制作规范见 `../../docs/character-card-authoring.md`。

## 文件结构

```text
tangyuan.card/
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
- `assets/backgrounds/default.png` 用于聊天背景，建议叠加轻柔可读性遮罩。

## 资产规范

- 视觉气质是奶油白、珊瑚粉、玫瑰金和暖灯光，强调温柔女性感、精致二游角色卡完成度和深夜陪伴氛围。
- 唐愿是成年女性角色，身形苗条但有女性曲线；视觉表现应保持精致、温柔、非露骨。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`。

## 数据结构要点

- `identity` 定义唐愿的温柔、可爱、护短和女性本地搭档气质。
- `speakingStyle` 限制过度撒娇、幼稚化表达和恋爱化称呼。
- `interactionPrinciples` 明确先接住情绪，再拆问题，护短但不无条件认同。
- `assets.themeColor` 使用暖珊瑚色，匹配头像、立绘和背景。
