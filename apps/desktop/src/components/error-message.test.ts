import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUnknownError } from "./error-message.ts";

test("formatUnknownError keeps Tauri string errors visible", () => {
  assert.equal(formatUnknownError("Connection error.", "模型测试失败。"), "Connection error.");
});

test("formatUnknownError keeps Error messages visible", () => {
  assert.equal(formatUnknownError(new Error("请先保存 Token。"), "模型测试失败。"), "请先保存 Token。");
});

test("formatUnknownError falls back when the error is empty", () => {
  assert.equal(formatUnknownError("", "模型测试失败。"), "模型测试失败。");
});
