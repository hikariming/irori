# Pi Provider Routing

The desktop settings UI owns display state only. For now the model surface is intentionally one OpenAI-compatible endpoint:

- `baseUrl`: endpoint root, such as `https://api.openai.com/v1` or `http://localhost:11434/v1`.
- `token`: saved by the Tauri layer and never echoed back to React.
- `modelName`: the exact model id sent to the OpenAI-compatible backend.

The local agent owns SDK integration:

1. Build a Pi custom model with `buildOpenAiCompatibleModel`.
2. Use provider id `openai-compatible` and Pi API type `openai-completions`.
3. Put the saved token into `AuthStorage.setRuntimeApiKey("openai-compatible", token)`.
4. Build `createAgentSession` options with `buildPiSessionOptions`.
5. Start the SDK session with `createCockapooPiSession` or run the CLI bridge with `pnpm --dir apps/desktop/sidecar prompt`.

Tokens should be handled in the local agent/Tauri layer, not in React component state. The current Tauri command persists a local JSON file in the app data directory and only returns `hasToken` plus a short `tokenHint`. This is enough for the prototype; the next hardening step is moving the token into the macOS Keychain.

Current default:

| Field | Value |
| --- | --- |
| Base URL | `https://api.openai.com/v1` |
| Model name | `gpt-5.2` |
| Pi provider id | `openai-compatible` |
