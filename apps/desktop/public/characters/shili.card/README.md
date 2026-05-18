# 示璃角色卡

这是一个用于 Cockapoo Pi Companion 的示例角色包。它由一张生成式资产板裁切而来，包含圆形头像、立绘、六个表情包、聊天背景和 `card.json` 元数据。

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
- `assets/stickers/*.png` 固定为九种基础情绪，由运行时根据 `emotion`、`intent`、`cooldownSeconds` 选择。
- `assets/backgrounds/default.png` 用于聊天背景，建议叠加浅色可读性遮罩。
