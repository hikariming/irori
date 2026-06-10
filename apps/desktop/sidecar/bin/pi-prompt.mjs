#!/usr/bin/env node

import readline from "node:readline";

import { runCockapooPiPrompt } from "../src/prompt-runner.mjs";
import { createStdinConfirmBridge } from "../src/stdin-confirm-bridge.mjs";
import { createLlmToolReviewer } from "../src/llm-tool-reviewer.mjs";

function writeLine(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();

  const first = await lines.next();
  if (first.done) {
    throw new Error("sidecar 没有收到请求负载。");
  }

  const request = JSON.parse(first.value);
  const streamEvents = request.streamEvents === true;
  const reviewMode = typeof request.reviewMode === "string" ? request.reviewMode : "default";

  // The autonomy mode only changes WHO answers a gated tool call; the safety
  // gate itself still produces the same confirm/block decisions.
  //   all  → auto-approve everything (risky, no review)
  //   auto → an LLM reviewer approves/rejects; on failure it falls back to the user
  //   default → round-trip to the user over stdin (manual review)
  //
  // The stdin confirm bridge is the manual-review channel. Only streaming runs
  // (a chat with a runId) keep stdin open for it; one-shot calls close stdin
  // right after the request. Both "default" and the "auto" fallback need it, so
  // it's created lazily on first use and reads stdin exactly once.
  let bridge = null;
  const ensureBridge = () => {
    if (!bridge && streamEvents && request.runId) {
      bridge = createStdinConfirmBridge({ runId: request.runId, write: writeLine });
      (async () => {
        for await (const line of lines) {
          bridge.handleLine(line);
        }
      })().catch(() => {
        // stdin closing early is expected once the run finishes.
      });
    }
    return bridge;
  };

  let onConfirm;

  if (reviewMode === "all") {
    onConfirm = async () => true;
  } else if (reviewMode === "auto") {
    const reviewer = createLlmToolReviewer({
      modelSettings: request.modelSettings,
      runtimeToken: request.runtimeToken
    });
    ensureBridge();
    onConfirm = async (confirmRequest) => {
      const verdict = await reviewer(confirmRequest);
      if (verdict.decision === "approve") {
        return true;
      }
      if (verdict.decision === "reject") {
        return false;
      }
      // Fallback: the LLM couldn't decide (timeout / unreachable / unclear), so
      // ask the user, telling them why the auto review handed it back.
      if (bridge) {
        return bridge.requestConfirm({
          ...confirmRequest,
          reason: `大模型审查失败（${verdict.reason}），已转交你手动确认。`
        });
      }
      return false;
    };
  } else if (ensureBridge()) {
    onConfirm = (confirmRequest) => bridge.requestConfirm(confirmRequest);
  }

  const result = await runCockapooPiPrompt({
    ...request,
    onProgressEvent: streamEvents
      ? (event) => writeLine({ type: "progress", event })
      : undefined,
    onScheduleUpsert: streamEvents
      ? (task) => writeLine({ type: "schedule_upsert", task })
      : undefined,
    onScheduleCancel: streamEvents
      ? (taskId) => writeLine({ type: "schedule_cancel", taskId })
      : undefined,
    onConfirm
  });

  if (streamEvents) {
    writeLine({ type: "final", response: result });
  } else {
    process.stdout.write(JSON.stringify(result));
  }

  rl.close();
}

// Exit only after the final output has drained: process.exit() does not wait
// for a piped stdout/stderr, so a large response could otherwise be truncated.
function exitAfterDrain(stream, code) {
  stream.write("", () => process.exit(code));
}

main()
  .then(() => exitAfterDrain(process.stdout, 0))
  .catch((error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    exitAfterDrain(process.stderr, 1);
  });
