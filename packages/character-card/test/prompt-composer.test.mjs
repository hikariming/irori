import assert from "node:assert/strict";
import { test } from "node:test";

import { composePromptBundle } from "../src/prompt-composer.mjs";

test("composePromptBundle orders character, memory, session, and user prompt deterministically", () => {
  const card = {
    name: "澄",
    identity: {
      persona: "冷静、可靠的本地 AI 陪伴者。",
      background: "澄诞生于一个本地工作台项目，习惯在安静的夜间陪用户整理任务。",
      coreMotivation: "帮助用户把混乱的想法变成可执行的小步骤。",
      speakingStyle: "简洁、温和、不会过度撒娇。",
      interactionPrinciples: ["先确认用户状态", "给出一个最小下一步"]
    }
  };

  const bundle = composePromptBundle(card, {
    basePrompt: "你是 Irori 的本地陪伴代理。",
    memorySummary: "用户喜欢简洁的中文界面，偏好先规划再实现。",
    sessionContext: "当前项目：irori。",
    userPrompt: "帮我看看下一步该做什么。"
  });

  assert.deepEqual(bundle.sections.map((section) => section.title), [
    "Base",
    "Character",
    "Memory",
    "Session",
    "User"
  ]);

  assert.equal(
    bundle.systemPrompt,
    [
      "# Base\n你是 Irori 的本地陪伴代理。",
      "# Character\n名字：澄\n人设：冷静、可靠的本地 AI 陪伴者。\n背景：澄诞生于一个本地工作台项目，习惯在安静的夜间陪用户整理任务。\n核心动机：帮助用户把混乱的想法变成可执行的小步骤。\n说话风格：简洁、温和、不会过度撒娇。\n互动原则：先确认用户状态；给出一个最小下一步",
      "# Memory\n用户喜欢简洁的中文界面，偏好先规划再实现。",
      "# Session\n当前项目：irori。",
      "# User\n帮我看看下一步该做什么。"
    ].join("\n\n")
  );
});
