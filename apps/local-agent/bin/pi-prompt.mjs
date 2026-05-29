#!/usr/bin/env node

import { runCockapooPiPrompt } from "../src/prompt-runner.mjs";

async function readRequest() {
  let input = "";

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return JSON.parse(input);
}

try {
  const request = await readRequest();
  const result = await runCockapooPiPrompt({
    ...request,
    onProgressEvent: request.streamEvents
      ? (event) => {
          process.stdout.write(`${JSON.stringify({ type: "progress", event })}\n`);
        }
      : undefined
  });

  if (request.streamEvents) {
    process.stdout.write(`${JSON.stringify({ type: "final", response: result })}\n`);
  } else {
    process.stdout.write(JSON.stringify(result));
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
