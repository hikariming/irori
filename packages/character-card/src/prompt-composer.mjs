function section(title, content) {
  return {
    title,
    content,
    text: `# ${title}\n${content}`
  };
}

function joinChineseList(items, fallback = "无") {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  return items.join("；");
}

function optionalLine(label, value) {
  if (!value) {
    return [];
  }

  return [`${label}：${value}`];
}

function optionalListLine(label, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return [`${label}：${joinChineseList(items)}`];
}

export function composePromptBundle(card, context) {
  const sections = [
    section("Base", context.basePrompt),
    section(
      "Character",
      [
        `名字：${card.name}`,
        `人设：${card.identity.persona}`,
        ...optionalLine("背景", card.identity.background),
        ...optionalLine("核心动机", card.identity.coreMotivation),
        `说话风格：${card.identity.speakingStyle}`,
        `关系定位：${card.identity.relationship}`,
        ...optionalListLine("互动原则", card.identity.interactionPrinciples),
        ...optionalListLine("沉浸提示", card.identity.immersionCues)
      ].join("\n")
    ),
    section("Memory", context.memorySummary),
    section("Session", context.sessionContext),
    section("User", context.userPrompt)
  ];

  return {
    sections,
    systemPrompt: sections.map((item) => item.text).join("\n\n")
  };
}
