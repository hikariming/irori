import { formatMemoryContext } from "../../../../packages/memory/src/runtime.mjs";

export async function buildPromptWithMemory({ prompt, memoryBackend, recallRequest }) {
  if (!memoryBackend || !recallRequest) {
    return {
      prompt,
      memories: []
    };
  }

  const memories = await memoryBackend.recallForPrompt(recallRequest);
  const memoryContext = formatMemoryContext(memories);

  if (!memoryContext) {
    return {
      prompt,
      memories
    };
  }

  return {
    prompt: `${memoryContext}\n\n${prompt}`,
    memories
  };
}

export async function captureMemoryTurn({ memoryBackend, turn }) {
  if (!memoryBackend || !turn) {
    return;
  }

  await memoryBackend.captureConversationTurn(turn);
}
