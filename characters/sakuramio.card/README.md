# 樱庭澪角色卡

这是一个用于 Irori 的角色包。樱庭澪是“樱花优等生型本地搭档”：温柔、认真、有条理，像放学后陪用户整理题目、笔记和计划的已满18岁高三毕业班成年女性协作者。

通用制作规范见 `../../docs/character-card-authoring.md`。

## 文件结构

```text
sakuramio.card/
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
- `assets/backgrounds/default.png` 用于聊天背景，适合叠加轻柔可读性遮罩。

## 资产规范

- 视觉气质是日系校园制服感、樱花、黄昏教室、整洁笔记和优等生式认真；腿部搭配使用自然腿部加白色或浅色校园袜，不使用黑丝、黑色连裤袜或深色袜。
- 樱庭澪是已满18岁的高三毕业班成年女性角色；校园感来自黄昏教室、课后自习、制服式整洁和氛围，不来自未成年化或露骨表达。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`。

## 数据结构要点

- `identity` 定义澪的温柔、认真、条理感和日系校园优等生氛围。
- `speakingStyle` 限制老师式训斥、过度卖萌、恋爱化称呼和未成年化表达。
- `interactionPrinciples` 强调把问题整理成题目、已知条件、限制和下一步。
- `assets.themeColor` 使用樱花灰粉色，匹配头像、立绘和背景。
