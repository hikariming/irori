import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeToolGateConfig } from "../src/tool-gate-config.mjs";
import {
  closureGateActiveFlag,
  createInheritedToolGateExtension,
  createSubagentToolGateExtension
} from "../src/extensions/cockapoo-tool-gate.mjs";

function captureHandler(factory) {
  let handler;
  const pi = {
    on(eventName, fn) {
      if (eventName === "tool_call") {
        handler = fn;
      }
    }
  };
  factory(pi);
  if (!handler) {
    throw new Error("extension did not register a tool_call handler");
  }
  return handler;
}

async function writeConfig(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-inherited-gate-"));
  const configPath = join(dir, "cockapoo-tool-gate.json");
  await writeToolGateConfig({
    configPath,
    mode: overrides.mode ?? "confirm",
    gatePolicy: {
      allowedToolNames: overrides.allowedToolNames ?? ["read", "grep", "bash", "edit"],
      confirmToolNames: overrides.confirmToolNames ?? ["bash", "edit"],
      protectedPaths: overrides.protectedPaths ?? [".env"]
    }
  });
  return { dir, configPath };
}

test("inherited gate allows read-only calls from the config file", async () => {
  const { dir, configPath } = await writeConfig();
  try {
    const handler = captureHandler(createInheritedToolGateExtension({ configPath }));
    assert.equal(await handler({ toolName: "read", input: { path: "src/app.ts" } }), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inherited gate blocks tools missing from the allowlist", async () => {
  const { dir, configPath } = await writeConfig({ allowedToolNames: ["read"] });
  try {
    const handler = captureHandler(createInheritedToolGateExtension({ configPath }));
    const result = await handler({ toolName: "bash", input: { command: "ls" } });
    assert.equal(result.block, true);
    assert.match(result.reason, /未在当前策略中启用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inherited gate blocks protected-path writes", async () => {
  const { dir, configPath } = await writeConfig();
  try {
    const handler = captureHandler(createInheritedToolGateExtension({ configPath }));
    const result = await handler({ toolName: "edit", input: { path: ".env" } });
    assert.equal(result.block, true);
    assert.match(result.reason, /受保护路径/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inherited gate fails closed on confirm and tells the child to escalate over intercom", async () => {
  const { dir, configPath } = await writeConfig();
  try {
    const handler = captureHandler(createInheritedToolGateExtension({ configPath }));
    const result = await handler({ toolName: "edit", input: { path: "src/app.ts" } });
    assert.equal(result.block, true);
    assert.match(result.reason, /contact_supervisor/);
    assert.match(result.reason, /need_decision/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("subagent gate no-ops in the parent process (closure gate already active)", async () => {
  const { dir, configPath } = await writeConfig({ allowedToolNames: ["read"] });
  const hadFlag = Object.prototype.hasOwnProperty.call(globalThis, closureGateActiveFlag);
  const previous = globalThis[closureGateActiveFlag];
  globalThis[closureGateActiveFlag] = true;
  try {
    // No-op means it never registers a tool_call handler — it defers entirely to
    // the parent's closure gate, so the package gate adds nothing in-process.
    let registered = false;
    const pi = {
      on(eventName) {
        if (eventName === "tool_call") {
          registered = true;
        }
      }
    };
    createSubagentToolGateExtension({ configPath })(pi);
    assert.equal(registered, false);
  } finally {
    if (hadFlag) {
      globalThis[closureGateActiveFlag] = previous;
    } else {
      delete globalThis[closureGateActiveFlag];
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("subagent gate enforces in a child process (flag unset)", async () => {
  const { dir, configPath } = await writeConfig({ allowedToolNames: ["read"] });
  const hadFlag = Object.prototype.hasOwnProperty.call(globalThis, closureGateActiveFlag);
  const previous = globalThis[closureGateActiveFlag];
  delete globalThis[closureGateActiveFlag];
  try {
    const handler = captureHandler(createSubagentToolGateExtension({ configPath }));
    const blocked = await handler({ toolName: "bash", input: { command: "ls" } });
    assert.equal(blocked.block, true);
    assert.match(blocked.reason, /未在当前策略中启用/);
  } finally {
    if (hadFlag) {
      globalThis[closureGateActiveFlag] = previous;
    } else {
      delete globalThis[closureGateActiveFlag];
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("inherited gate still blocks dangerous bash under managed mode", async () => {
  const { dir, configPath } = await writeConfig({ mode: "managed" });
  try {
    const handler = captureHandler(createInheritedToolGateExtension({ configPath }));
    assert.equal(await handler({ toolName: "bash", input: { command: "npm test" } }), undefined);
    const dangerous = await handler({ toolName: "bash", input: { command: "rm -rf /" } });
    assert.equal(dangerous.block, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inherited gate fails closed when the config file is absent", async () => {
  const handler = captureHandler(createInheritedToolGateExtension({
    configPath: join(tmpdir(), "cockapoo-absent-gate-config.json")
  }));
  const result = await handler({ toolName: "read", input: { path: "src/app.ts" } });
  assert.equal(result.block, true);
});
