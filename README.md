# Irori

![Irori hero banner](apps/desktop/public/assets/readme-hero.png)

**Irori** is a local-first desktop companion app built around the [Pi coding-agent SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). It turns agent sessions into character-driven companions: each character has a card, personality, memory surface, model settings, and a workflow role that can help you think, write, code, plan, and follow through.

[中文说明](README.zh-CN.md)

## Highlights

- **Character companions.** Use bundled characters or create your own character cards. A companion can have a distinct voice, backstory, working style, avatar, and prompt composition.
- **Workflow support.** Characters are designed to understand task context, break down requirements, track progress, organize conclusions, and work like focused collaborators.
- **Local memory and context.** Preferences, important project details, and collaboration habits can be kept locally so repeated conversations need less setup.
- **Model provider presets.** The desktop app includes preset provider/model options and OpenAI-compatible configuration fields for common model services.
- **Desktop-first experience.** Irori is a Tauri + React app with a native desktop shell, local sidecar runtime, safety confirmation gate, and multilingual onboarding.
- **Customizable role cards.** Swap, edit, or create character cards with your favorite original characters, personas, or working partners.

## Screens and Flow

Irori starts with a short onboarding flow:

1. Choose the interface language.
2. Meet the companion concept and the role-card system.
3. Select or configure a model provider.
4. Start a local companion workspace.

The app currently includes character assets and cards for several bundled companions, plus package-level tooling for deterministic card parsing and prompt composition.

## Workspace

```text
apps/
  desktop/          Tauri + React desktop shell
    src/            React frontend: chat, onboarding, settings, character UI
    src-tauri/      Rust backend for the desktop app
    sidecar/        Node sidecar embedding the Pi SDK runtime
characters/         Bundled character card packages
packages/
  character-card/   Character card schema and prompt composition
  companion-core/   Shared companion session domain types
  memory/           Local-first memory contracts and backends
  pi-runtime/       Adapter layer for Pi SDK sessions and events
  safety/           Tool modes, confirmation policy, protected paths
  ui/               Shared UI surfaces
docs/               Project notes and implementation docs
```

## Getting Started

Prerequisites:

- Node.js 22+
- [pnpm](https://pnpm.io/)
- [Rust toolchain](https://rustup.rs/) for Tauri desktop builds

Install dependencies:

```bash
pnpm install
```

Run the desktop app in development mode:

```bash
npm run dev
```

Useful scripts:

```bash
npm run desktop:vite   # Frontend only, Vite dev server on 127.0.0.1:1420
npm run desktop:build  # Production desktop build through Tauri
npm test               # Character-card package tests
```

## Model Setup

Irori supports provider presets in the desktop settings and onboarding flow. You can also configure an OpenAI-compatible provider manually with:

- Base URL
- Model name
- API key

Do not commit personal API keys or local secrets to the repository.

## Character Cards

Bundled character cards live in `characters/` and are mirrored under `apps/desktop/public/characters/` for the desktop app. The card tooling lives in `packages/character-card/`.

A character card is where Irori keeps the role definition: identity, style, skills, prompt fragments, and assets. This makes companions replaceable and editable instead of being hard-coded into the app.

## Testing

```bash
npm test

cd apps/desktop/sidecar
node --test test/*.mjs

cd apps/desktop
npm run typecheck
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
