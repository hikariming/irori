import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAssistantProgress,
  reduceAssistantProgress,
  assistantProgressPrimaryText,
  assistantProgressStatusLabel,
  assistantReasoningDisplayText,
  nextTypewriterText,
  removeAssistantStreamMessage,
  replaceAssistantStreamMessage,
  typewriterStepForText,
  upsertAssistantStreamMessage
} from "./assistant-progress-model.ts";
import type { ChatMessage } from "./chat-model.ts";

test("reduceAssistantProgress appends thinking and answer deltas for the active run", () => {
  const progress = createAssistantProgress("run-1");

  const thinking = reduceAssistantProgress(progress, {
    runId: "run-1",
    phase: "thinking",
    delta: "先整理角色设定。"
  });
  const answering = reduceAssistantProgress(thinking, {
    runId: "run-1",
    phase: "answering",
    delta: "我在。"
  });

  assert.equal(answering.reasoningText, "先整理角色设定。");
  assert.equal(answering.answerText, "我在。");
  assert.equal(answering.phase, "answering");
});

test("reduceAssistantProgress ignores progress from another prompt run", () => {
  const progress = createAssistantProgress("run-1");

  const next = reduceAssistantProgress(progress, {
    runId: "run-2",
    phase: "thinking",
    delta: "旧请求的增量"
  });

  assert.equal(next, progress);
});

test("reduceAssistantProgress uses final text_end content when provided", () => {
  const progress = reduceAssistantProgress(createAssistantProgress("run-1"), {
    runId: "run-1",
    phase: "answering",
    delta: "临时"
  });

  const next = reduceAssistantProgress(progress, {
    runId: "run-1",
    phase: "answering",
    text: "最终回复。"
  });

  assert.equal(next.answerText, "最终回复。");
});

test("assistantProgressStatusLabel describes each visible phase", () => {
  assert.equal(assistantProgressStatusLabel("queued"), "准备中");
  assert.equal(assistantProgressStatusLabel("thinking"), "推理中");
  assert.equal(assistantProgressStatusLabel("answering"), "生成回复");
});

test("assistantProgressPrimaryText does not label queued requests as thinking", () => {
  assert.equal(assistantProgressPrimaryText(createAssistantProgress("run-1")), "准备中");
  assert.equal(
    assistantProgressPrimaryText(
      reduceAssistantProgress(createAssistantProgress("run-1"), {
        runId: "run-1",
        phase: "queued",
        status: "正在整理上下文"
      })
    ),
    "正在整理上下文"
  );
  assert.equal(
    assistantProgressPrimaryText({
      ...createAssistantProgress("run-1"),
      phase: "thinking"
    }),
    "思考中"
  );
  assert.equal(
    assistantProgressPrimaryText({
      ...createAssistantProgress("run-1"),
      phase: "answering"
    }),
    "生成中"
  );
});

test("assistantReasoningDisplayText shows a thinking placeholder until reasoning deltas arrive", () => {
  assert.equal(assistantReasoningDisplayText(createAssistantProgress("run-1")), "");
  assert.equal(
    assistantReasoningDisplayText({
      ...createAssistantProgress("run-1"),
      phase: "thinking"
    }),
    "正在思考..."
  );
  assert.equal(
    assistantReasoningDisplayText({
      ...createAssistantProgress("run-1"),
      phase: "thinking",
      reasoningText: "先判断语气。"
    }),
    "先判断语气。"
  );
});

test("upsertAssistantStreamMessage inserts and updates one temporary assistant message", () => {
  const messages: ChatMessage[] = [
    {
      id: "user-1",
      speaker: "user",
      author: "你",
      text: "你好",
      time: "15:32"
    }
  ];

  const inserted = upsertAssistantStreamMessage(messages, {
    id: "assistant-stream-run-1",
    author: "示璃",
    text: "你",
    time: "15:32"
  });
  const updated = upsertAssistantStreamMessage(inserted, {
    id: "assistant-stream-run-1",
    author: "示璃",
    text: "你好。",
    time: "15:32"
  });

  assert.equal(inserted.length, 2);
  assert.equal(updated.length, 2);
  assert.equal(updated[1].id, "assistant-stream-run-1");
  assert.equal(updated[1].speaker, "character");
  assert.equal(updated[1].text, "你好。");
});

test("replaceAssistantStreamMessage swaps the temporary stream bubble for the persisted message", () => {
  const messages = upsertAssistantStreamMessage([], {
    id: "assistant-stream-run-1",
    author: "示璃",
    text: "临时回复",
    time: "15:32"
  });
  const persisted: ChatMessage = {
    id: "message-1",
    speaker: "character",
    author: "示璃",
    text: "最终回复",
    time: "15:33"
  };

  const replaced = replaceAssistantStreamMessage(messages, "assistant-stream-run-1", persisted);

  assert.deepEqual(replaced, [persisted]);
});

test("removeAssistantStreamMessage removes only the active temporary stream bubble", () => {
  const messages = upsertAssistantStreamMessage([
    {
      id: "user-1",
      speaker: "user",
      author: "你",
      text: "你好",
      time: "15:32"
    }
  ], {
    id: "assistant-stream-run-1",
    author: "示璃",
    text: "临时回复",
    time: "15:32"
  });

  const next = removeAssistantStreamMessage(messages, "assistant-stream-run-1");

  assert.equal(next.length, 1);
  assert.equal(next[0].id, "user-1");
});

test("nextTypewriterText reveals target text incrementally", () => {
  assert.equal(nextTypewriterText("", "你好世界", 2), "你好");
  assert.equal(nextTypewriterText("你好", "你好世界", 2), "你好世界");
});

test("nextTypewriterText resets when the final target differs from streamed text", () => {
  assert.equal(nextTypewriterText("临时", "最终回复", 2), "最终回复");
});

test("typewriterStepForText keeps long final replies from animating too slowly", () => {
  assert.equal(typewriterStepForText("短回复"), 1);
  assert.equal(typewriterStepForText("字".repeat(500)) > 1, true);
});
