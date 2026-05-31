#!/usr/bin/env node

import readline from "node:readline";

import { runCockapooPiPrompt } from "../src/prompt-runner.mjs";
import { createStdinConfirmBridge } from "../src/stdin-confirm-bridge.mjs";

function writeLine(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();

  const first = await lines.next();
  if (first.done) {
    throw new Error("local-agent 没有收到请求负载。");
  }

  const request = JSON.parse(first.value);
  const streamEvents = request.streamEvents === true;

  // Only streaming runs (a chat with a runId) keep stdin open for the confirm
  // round-trip. One-shot calls (connection test, opening message) close stdin
  // right after the request, so the remaining-lines loop just ends.
  let bridge = null;
  if (streamEvents && request.runId) {
    bridge = createStdinConfirmBridge({ runId: request.runId, write: writeLine });
    (async () => {
      for await (const line of lines) {
        bridge.handleLine(line);
      }
    })().catch(() => {
      // stdin closing early is expected once the run finishes.
    });
  }

  const result = await runCockapooPiPrompt({
    ...request,
    onProgressEvent: streamEvents
      ? (event) => writeLine({ type: "progress", event })
      : undefined,
    onConfirm: bridge ? (confirmRequest) => bridge.requestConfirm(confirmRequest) : undefined
  });

  if (streamEvents) {
    writeLine({ type: "final", response: result });
  } else {
    process.stdout.write(JSON.stringify(result));
  }

  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
