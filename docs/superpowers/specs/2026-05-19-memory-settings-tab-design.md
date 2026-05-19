# Memory Settings Tab Design

## Goal

Add a first-pass memory dashboard inside the existing system settings panel so the user can see what memory backend is configured, where local memory data lives, and what was recalled in the latest model turn.

## Scope

This is an observability UI, not a memory editor. The first version shows status and recent recall only. It does not delete memories, rebuild vectors, import/export data, or expose raw database controls.

## UI Placement

The existing settings tabs remain the shell. The `记忆` tab becomes a real panel with:

- Backend status: configured backend, actual latest run source, and fallback state.
- Local storage status: `memory-tdai` directory, whether `vectors.db` exists, and whether the TencentDB package path is present.
- Latest recall: count and cards for memories returned by the last `send_pi_prompt` call.

## Data Flow

Tauri exposes `get_memory_status`, which returns stable local paths and package/storage checks. `send_pi_prompt` keeps returning the assistant text, and now also forwards `recalledMemories` and `memoryBackendSource` from local-agent. `App` stores that latest memory run and passes it into `SystemSettingsPanel`.

## Error Handling

If memory status cannot be loaded, the tab shows a compact error message and keeps the rest of settings usable. If the TencentDB package is installed but only exposes the OpenClaw plugin API, the latest run source should honestly show `聊天历史 fallback` when that is what local-agent used.

## Testing

Use model and backend tests for the stable logic:

- local-agent prompt runner reports `memoryBackendSource`.
- desktop preview backend returns memory status and preserves recalled memory snapshots.
- Rust unit tests cover the memory status payload shape.
- Existing desktop and local-agent tests continue passing.
