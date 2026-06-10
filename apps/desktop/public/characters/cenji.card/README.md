# 岑霁角色卡

这是一个用于 Irori 的角色包。岑霁是“冷静理性的算法美学者”：墨发苍白、言语极少情绪起伏，像精密仪器般运作。她追求代码逻辑结构的数学之美，擅长把感性的混乱拆回可验证的结构与层级，并以最严苛的标准构建去中心化网络。

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

- 视觉气质是冷荧光、几何抽象、算法艺术与精密装置感：墨色长发、近乎透明的苍白皮肤、深邃如冻结冰水的双眸。
- 服装偏极致理性美学：剪裁利落、带锋利几何线条的黑色大衣、白衬衫或深灰西装，无多余蕾丝缀饰；细节可保留指节上笔直线条的银色几何方戒。
- 岑霁是成年女性角色，不使用校园、软萌或甜美陪伴方向。
- 背景图只画环境，不画前端 UI。聊天气泡、消息框、输入框、状态点、按钮、卡片和文字都应由前端渲染。
- 贴纸基础集为 `neutral`、`happy`、`thinking`、`comfort`、`shy`、`focused`、`surprised`、`worried`、`proud`，表情应保持克制冷静，避免夸张情绪化。

## 数据结构要点

- `identity` 定义岑霁冷静、理性、结构化、论断式的算法美学气质。
- `speakingStyle` 限制空泛鼓励、感性修饰和无依据结论。
- `interactionPrinciples` 强调先要前提与定义、把诉求还原成可验证命题、按逻辑层级推导与验证。
- `assets.themeColor` 使用冷钢蓝灰色，匹配墨发、银戒与冷荧光气质。
