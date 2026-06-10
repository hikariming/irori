# Tangyuan Character Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Tangyuan, a soft protective female companion character, as a complete Irori character card with generated visual assets.

**Architecture:** Follow the existing simple character-card package shape used by `characters/lulin.card` and `characters/shenyanzhou.card`. Generate source images, post-process them into avatar, portrait, background, and the nine required sticker assets, then copy the finished package into `apps/desktop/public/characters`.

**Tech Stack:** JSON character card metadata, PNG assets, `sips`/local image post-processing, Node character-card tests.

---

### Task 1: Generate Source Assets

**Files:**
- Create: `characters/tangyuan.card/source/portrait-source.png`
- Create: `characters/tangyuan.card/source/sticker-sheet.png`
- Create: `characters/tangyuan.card/source/background-source.png`

**Steps:**
1. Generate a soft anime-style female companion portrait for Tangyuan.
2. Generate a 3x3 expression sheet with the required sticker moods in stable order.
3. Generate a vertical cozy desk background with no UI, text, watermark, or character.
4. Inspect the outputs before using them.

### Task 2: Produce Runtime Assets

**Files:**
- Create: `characters/tangyuan.card/assets/avatar/avatar.png`
- Create: `characters/tangyuan.card/assets/avatar/avatar-small.png`
- Create: `characters/tangyuan.card/assets/avatar/avatar-circle.png`
- Create: `characters/tangyuan.card/assets/portraits/neutral.png`
- Create: `characters/tangyuan.card/assets/backgrounds/default.png`
- Create: `characters/tangyuan.card/assets/stickers/*.png`

**Steps:**
1. Resize/crop the portrait into the standard portrait and avatar sizes.
2. Crop the 3x3 sticker sheet into the nine required sticker files.
3. Resize/crop the background into the existing vertical background dimensions.
4. Verify image dimensions with `sips`.

### Task 3: Add Card Metadata

**Files:**
- Create: `characters/tangyuan.card/card.json`
- Create: `characters/tangyuan.card/README.md`
- Modify: `characters/manifest.json`
- Create/copy: `apps/desktop/public/characters/tangyuan.card/**`
- Modify: `apps/desktop/public/characters/manifest.json`

**Steps:**
1. Add Tangyuan's identity fields and sticker fallbacks.
2. Update both manifests to include `tangyuan`.
3. Copy the completed card package to the desktop public character directory.

### Task 4: Verify

**Steps:**
1. Run `node --test packages/character-card/test/*.test.mjs`.
2. Run a direct loader smoke test for `characters/tangyuan.card`.
3. Inspect representative generated images.
