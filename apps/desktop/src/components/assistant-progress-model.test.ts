import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAssistantProgress,
  reduceAssistantProgress,
  assistantProgressPrimaryText,
  assistantProgressStatusLabel,
  assistantReasoningActive,
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

test("reduceAssistantProgress treats cumulative answer fragments as replacements", () => {
  const progress = createAssistantProgress("run-1");
  const first = reduceAssistantProgress(progress, {
    runId: "run-1",
    phase: "answering",
    delta: "你"
  });
  const second = reduceAssistantProgress(first, {
    runId: "run-1",
    phase: "answering",
    delta: "你呢？"
  });

  assert.equal(second.answerText, "你呢？");
});

test("reduceAssistantProgress collects tool decisions without resetting the answer", () => {
  const answering = reduceAssistantProgress(createAssistantProgress("run-1"), {
    runId: "run-1",
    phase: "answering",
    delta: "我来改一下。"
  });

  const next = reduceAssistantProgress(answering, {
    runId: "run-1",
    phase: "tool",
    status: "已拦截 edit：.env",
    tool: { name: "edit", status: "blocked", target: ".env", reason: "命中受保护路径" }
  });

  assert.equal(next.answerText, "我来改一下。");
  assert.equal(next.phase, "answering");
  assert.equal(next.toolEvents.length, 1);
  assert.equal(next.toolEvents[0].status, "blocked");
});

test("reduceAssistantProgress ignores browser side-panel events without resetting the answer", () => {
  const answering = reduceAssistantProgress(createAssistantProgress("run-1"), {
    runId: "run-1",
    phase: "answering",
    delta: "我找到一个来源。"
  });

  const next = reduceAssistantProgress(answering, {
    runId: "run-1",
    phase: "browser",
    status: "打开右侧浏览器：https://example.com",
    browser: {
      action: "open",
      url: "https://example.com",
      source: "agent"
    }
  });

  assert.equal(next.answerText, "我找到一个来源。");
  assert.equal(next.phase, "answering");
});

test("assistantProgressStatusLabel maps each visible phase to an i18n key", () => {
  assert.equal(assistantProgressStatusLabel("queued").key, "chat.progress.statusLabel.queued");
  assert.equal(assistantProgressStatusLabel("thinking").key, "chat.progress.statusLabel.thinking");
  assert.equal(assistantProgressStatusLabel("answering").key, "chat.progress.statusLabel.answering");
});

test("assistantProgressPrimaryText does not label queued requests as thinking", () => {
  assert.equal(assistantProgressPrimaryText(createAssistantProgress("run-1")).key, "chat.progress.primary.queued");

  const withStatus = assistantProgressPrimaryText(
    reduceAssistantProgress(createAssistantProgress("run-1"), {
      runId: "run-1",
      phase: "queued",
      statusCode: "awaitingOutput",
      statusParams: { seconds: 3 }
    })
  );
  assert.equal(withStatus.key, "chat.progress.status.awaitingOutput");
  assert.deepEqual(withStatus.params, { seconds: 3 });

  assert.equal(
    assistantProgressPrimaryText({
      ...createAssistantProgress("run-1"),
      phase: "thinking"
    }).key,
    "chat.progress.primary.thinking"
  );
  assert.equal(
    assistantProgressPrimaryText({
      ...createAssistantProgress("run-1"),
      phase: "answering"
    }).key,
    "chat.progress.primary.answering"
  );
});

test("assistantReasoningActive flags when a thinking label should show", () => {
  assert.equal(assistantReasoningActive(createAssistantProgress("run-1")), false);
  assert.equal(
    assistantReasoningActive({
      ...createAssistantProgress("run-1"),
      phase: "thinking"
    }),
    true
  );
  assert.equal(
    assistantReasoningActive({
      ...createAssistantProgress("run-1"),
      phase: "answering",
      reasoningText: "先判断语气。"
    }),
    true
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
