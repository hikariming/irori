function section(title, content) {
  return {
    title,
    content,
    text: `# ${title}\n${content}`
  };
}

function joinList(items, fallback = "无") {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  return items.join(", ");
}

function joinChineseList(items, fallback = "无") {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  return items.join("；");
}

export function composePromptBundle(card, context) {
  const sections = [
    section("Base", context.basePrompt),
    section(
      "Character",
      [
        `名字：${card.name}`,
        `人设：${card.identity.persona}`,
        `说话风格：${card.identity.speakingStyle}`,
        `关系定位：${card.identity.relationship}`
      ].join("\n")
    ),
    section(
      "Companion Policy",
      [
        `温暖度：${card.companionPolicy.warmth}`,
        `主动性：${card.companionPolicy.initiative}`,
        `情绪支持：${card.companionPolicy.emotionalSupportStyle}`,
        `边界：${joinChineseList(card.companionPolicy.boundaries)}`
      ].join("\n")
    ),
    section(
      "Agent Policy",
      [
        `默认模式：${card.agentPolicy.defaultMode}`,
        `允许工具：${joinList(card.agentPolicy.allowedTools)}`,
        `保护路径：${joinList(card.agentPolicy.protectedPaths)}`,
        `始终确认：${joinList(card.agentPolicy.alwaysConfirm)}`
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
