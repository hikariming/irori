# Cockapoo Pi Companion

Cockapoo Pi Companion is a local-first desktop companion client built around the Pi coding-agent SDK. Pi owns the embedded agent runtime; Cockapoo owns the product layer: character cards, local memory, safety confirmations, model/account integration, and optional cloud sync.

![Cockapoo Pi Companion Chinese Concept](../docs/assets/cockapoo-pi-companion-cn-concept.png)

## Workspace

```text
apps/
  desktop/       Tauri + React desktop shell
  local-agent/   Node daemon that embeds the Pi SDK
packages/
  character-card/ Character schema and prompt composition
  pi-runtime/     Pi SDK wrapper and local event adapter
  memory/         Local-first memory storage contracts
  safety/         Tool modes, confirmation policy, protected paths
  companion-core/ Shared domain types and orchestration
  ui/             Shared UI primitives and product surfaces
```

## Current Skeleton

This first pass intentionally keeps dependencies empty. The verified behavior lives in `packages/character-card` and can be run with:

```bash
node --test packages/character-card/test/*.test.mjs
```

## Design Inputs

- Product design: `../docs/superpowers/specs/2026-05-16-cockapoo-pi-companion-design.md`
- Skeleton plan: `../docs/superpowers/plans/2026-05-16-cockapoo-pi-companion-skeleton.md`
- Chinese UI concept board: `../docs/assets/cockapoo-pi-companion-cn-concept.png`
