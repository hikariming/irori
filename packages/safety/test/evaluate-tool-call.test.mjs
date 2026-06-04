import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commandTouchesProtectedPath,
  defaultProtectedPaths,
  evaluateToolCall,
  isProtectedPath
} from "../src/runtime.mjs";

const basePolicy = {
  allowedToolNames: [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "edit",
    "write",
    "memory_read",
    "memory_write",
    "web_search",
    "fetch_content",
    "get_search_content",
    "browser_view"
  ],
  confirmToolNames: ["bash", "edit", "write", "memory_write"],
  protectedPaths: defaultProtectedPaths
};

test("read-only tools are allowed without confirmation", () => {
  const result = evaluateToolCall({ toolName: "read", input: { path: "src/app.ts" }, policy: basePolicy });
  assert.equal(result.decision, "allow");
});

test("tools missing from the policy are blocked", () => {
  const result = evaluateToolCall({ toolName: "browser_action", input: {}, policy: basePolicy });
  assert.equal(result.decision, "block");
});

test("writes to protected paths are blocked even when the tool is allowed", () => {
  const result = evaluateToolCall({ toolName: "edit", input: { path: "/home/me/.ssh/config" }, policy: basePolicy });
  assert.equal(result.decision, "block");
  assert.match(result.reason, /受保护路径/);
});

test("dotenv variants are recognised as protected", () => {
  assert.equal(isProtectedPath(".env.local", defaultProtectedPaths), true);
  assert.equal(isProtectedPath("config/app.ts", defaultProtectedPaths), false);
});

test("dangerous shell commands require confirmation in confirm mode", () => {
  const result = evaluateToolCall({ toolName: "bash", input: { command: "rm -rf build" }, policy: basePolicy });
  assert.equal(result.decision, "confirm");
});

test("dangerous shell commands stay confirm even in managed mode", () => {
  const result = evaluateToolCall({ toolName: "bash", input: { command: "sudo reboot" }, policy: basePolicy, mode: "managed" });
  assert.equal(result.decision, "confirm");
});

test("bash commands touching a protected path are blocked", () => {
  assert.equal(commandTouchesProtectedPath("cat .env", defaultProtectedPaths), true);
  const result = evaluateToolCall({ toolName: "bash", input: { command: "cat .env" }, policy: basePolicy });
  assert.equal(result.decision, "block");
});

test("confirm-tools prompt in confirm mode", () => {
  const result = evaluateToolCall({ toolName: "edit", input: { path: "src/app.ts" }, policy: basePolicy });
  assert.equal(result.decision, "confirm");
});

test("auto mode auto-allows reversible writes but still confirms bash", () => {
  assert.equal(evaluateToolCall({ toolName: "edit", input: { path: "src/app.ts" }, policy: basePolicy, mode: "auto" }).decision, "allow");
  assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "npm test" }, policy: basePolicy, mode: "auto" }).decision, "confirm");
});

test("managed mode auto-allows non-dangerous bash", () => {
  const result = evaluateToolCall({ toolName: "bash", input: { command: "npm test" }, policy: basePolicy, mode: "managed" });
  assert.equal(result.decision, "allow");
});

test("readonly mode blocks every write tool", () => {
  assert.equal(evaluateToolCall({ toolName: "write", input: { path: "out.txt" }, policy: basePolicy, mode: "readonly" }).decision, "block");
  assert.equal(evaluateToolCall({ toolName: "read", input: { path: "out.txt" }, policy: basePolicy, mode: "readonly" }).decision, "allow");
});

test("readonly mode allows web search and content fetch tools", () => {
  assert.equal(evaluateToolCall({ toolName: "web_search", input: { query: "Pi docs" }, policy: basePolicy, mode: "readonly" }).decision, "allow");
  assert.equal(evaluateToolCall({ toolName: "fetch_content", input: { url: "https://example.com" }, policy: basePolicy, mode: "readonly" }).decision, "allow");
  assert.equal(evaluateToolCall({ toolName: "get_search_content", input: { responseId: "abc123" }, policy: basePolicy, mode: "readonly" }).decision, "allow");
  assert.equal(evaluateToolCall({ toolName: "browser_view", input: { url: "https://example.com" }, policy: basePolicy, mode: "readonly" }).decision, "allow");
});
