import assert from "node:assert/strict";
import { test } from "node:test";

import { composePromptBundle } from "../src/prompt-composer.mjs";

test("composePromptBundle orders character, policy, memory, session, and user prompt deterministically", () => {
  const card = {
    name: "澄",
    identity: {
      persona: "冷静、可靠的本地 AI 陪伴者。",
      speakingStyle: "简洁、温和、不会过度撒娇。",
      relationship: "长期协作伙伴。",
      firstMessage: "我在。今天从哪里开始？"
    },
    companionPolicy: {
      warmth: "medium",
      initiative: "balanced",
      emotionalSupportStyle: "先接住情绪，再帮用户拆解下一步。",
      boundaries: ["不诱导依赖", "不伪装成人类"]
    },
    agentPolicy: {
      defaultMode: "read",
      allowedTools: ["read", "grep", "ls"],
      protectedPaths: ["~/.ssh", "~/Library/Keychains"],
      alwaysConfirm: ["bash", "edit", "write"]
    }
  };

  const bundle = composePromptBundle(card, {
    basePrompt: "你是 Cockapoo Pi Companion 的本地陪伴代理。",
    memorySummary: "用户喜欢简洁的中文界面，偏好先规划再实现。",
    sessionContext: "当前项目：cockapoo-pi-companion。",
    userPrompt: "帮我看看下一步该做什么。"
  });

  assert.deepEqual(bundle.sections.map((section) => section.title), [
    "Base",
    "Character",
    "Companion Policy",
    "Agent Policy",
    "Memory",
    "Session",
    "User"
  ]);

  assert.equal(
    bundle.systemPrompt,
    [
      "# Base\n你是 Cockapoo Pi Companion 的本地陪伴代理。",
      "# Character\n名字：澄\n人设：冷静、可靠的本地 AI 陪伴者。\n说话风格：简洁、温和、不会过度撒娇。\n关系定位：长期协作伙伴。",
      "# Companion Policy\n温暖度：medium\n主动性：balanced\n情绪支持：先接住情绪，再帮用户拆解下一步。\n边界：不诱导依赖；不伪装成人类",
      "# Agent Policy\n默认模式：read\n允许工具：read, grep, ls\n保护路径：~/.ssh, ~/Library/Keychains\n始终确认：bash, edit, write",
      "# Memory\n用户喜欢简洁的中文界面，偏好先规划再实现。",
      "# Session\n当前项目：cockapoo-pi-companion。",
      "# User\n帮我看看下一步该做什么。"
    ].join("\n\n")
  );
});
