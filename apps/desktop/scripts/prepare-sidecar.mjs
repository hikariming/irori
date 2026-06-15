#!/usr/bin/env node
// Assembles a self-contained copy of the Pi sidecar under
// src-tauri/resources/sidecar so `tauri build` can bundle it. Runs from
// `beforeBuildCommand`, so every build (local or CI, regardless of repo
// layout) ships a working sidecar instead of an empty placeholder dir.
//
// Two things make the in-tree sidecar non-portable, both handled here:
//   1. Its node_modules are pnpm symlinks into the workspace store, which
//      dangle once copied. We re-install prod deps with npm to get a flat,
//      copy-safe tree.
//   2. Its source imports sibling workspace packages via
//      `../../../../packages/{memory,safety}/src/runtime.mjs`, paths that
//      escape the bundle. We vendor those runtime files into the bundle and
//      rewrite the imports to point at the local copies.

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, ".."); // apps/desktop
const workspaceRoot = join(desktopDir, "..", ".."); // repo root (apps/desktop -> apps -> root)
const sidecarSrc = join(desktopDir, "sidecar");
const outDir = join(desktopDir, "src-tauri", "resources", "sidecar");

// Sibling workspace packages the sidecar imports at runtime. `from` is the
// exact import literal in the source; `vendorPath` is where we drop the runtime
// inside the bundle; `to` is the rewritten import literal (relative to src/*).
const VENDORED = [
  {
    name: "memory",
    runtime: join(workspaceRoot, "packages", "memory", "src", "runtime.mjs"),
    from: "../../../../packages/memory/src/runtime.mjs",
    to: "../vendor/memory/runtime.mjs",
  },
  {
    name: "safety",
    runtime: join(workspaceRoot, "packages", "safety", "src", "runtime.mjs"),
    from: "../../../../packages/safety/src/runtime.mjs",
    to: "../vendor/safety/runtime.mjs",
  },
];

function log(message) {
  process.stdout.write(`[prepare-sidecar] ${message}\n`);
}

// Recursively rewrite the vendored-package import literals in every .mjs file.
function rewriteImports(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteImports(full);
      continue;
    }
    if (!entry.name.endsWith(".mjs")) continue;
    let text = readFileSync(full, "utf8");
    let changed = false;
    for (const pkg of VENDORED) {
      if (text.includes(pkg.from)) {
        text = text.split(pkg.from).join(pkg.to);
        changed = true;
      }
    }
    if (changed) writeFileSync(full, text);
  }
}

log(`output: ${outDir}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
// Keep the placeholder so the tracked dir survives a clean rebuild (see the
// sibling resources/.gitignore, which ignores everything else here).
writeFileSync(join(outDir, ".gitkeep"), "");

// Copy only what the runtime needs — no node_modules (re-installed below),
// no tests, no scripts.
for (const item of ["bin", "src", "extensions", "package.json"]) {
  cpSync(join(sidecarSrc, item), join(outDir, item), { recursive: true });
}

// Vendor sibling-package runtimes and point the imports at them.
for (const pkg of VENDORED) {
  const dest = join(outDir, "vendor", pkg.name, "runtime.mjs");
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(pkg.runtime, dest);
}
rewriteImports(join(outDir, "src"));
rewriteImports(join(outDir, "bin"));
rewriteImports(join(outDir, "extensions"));

// Fail loudly if any escaping import survived the rewrite — a new file with a
// different relative depth would slip past the literal match above.
function assertNoEscapingImports(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "vendor") continue;
      assertNoEscapingImports(full);
      continue;
    }
    if (!entry.name.endsWith(".mjs")) continue;
    const text = readFileSync(full, "utf8");
    if (/\.\.\/\.\.\/\.\.\/\.\.\/packages\//.test(text)) {
      throw new Error(
        `Unhandled workspace import in ${full}. Add it to VENDORED in prepare-sidecar.mjs.`,
      );
    }
  }
}
assertNoEscapingImports(outDir);

log("installing production dependencies (npm, flat node_modules)…");
// Use execSync (a shell) rather than execFileSync so `npm`/`npm.cmd` resolves
// the same way on every platform — Node 22 refuses to execFile a .cmd without
// a shell, and PATH lookup is more forgiving here.
execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", {
  cwd: outDir,
  stdio: "inherit",
});

pruneBundle(outDir);

log("done.");

// Trim dead weight from the installed tree. Both prunes are pure size wins with
// no behavior change for the desktop app; the CI verify step still imports the
// sidecar module graph afterwards to catch any over-pruning.
function pruneBundle(root) {
  const before = dirSize(join(root, "node_modules"));
  pruneKoffiPlatforms(root);
  pruneUnusedBm25Dictionaries(root);
  const after = dirSize(join(root, "node_modules"));
  log(`pruned node_modules: ${mb(before)} → ${mb(after)} (saved ${mb(before - after)})`);
}

// koffi ships prebuilt binaries for ~18 platforms inside one package (unlike the
// other natives, which npm already platform-filters via optionalDependencies).
// Keep only the directory matching this build; drop the rest.
function pruneKoffiPlatforms(root) {
  const target = `${process.platform}_${process.arch}`; // e.g. darwin_arm64, win32_x64
  for (const koffiRoot of findDirs(join(root, "node_modules"), "koffi")) {
    const platformsDir = join(koffiRoot, "build", "koffi");
    if (!existsSync(platformsDir)) {
      continue;
    }
    const platforms = readdirSync(platformsDir);
    if (!platforms.includes(target)) {
      // Don't risk removing the only usable binary if naming ever changes.
      log(`[prune] koffi: target "${target}" not found in ${platformsDir}; leaving as-is`);
      continue;
    }
    for (const platform of platforms) {
      if (platform !== target) {
        rmSync(join(platformsDir, platform), { recursive: true, force: true });
      }
    }
    log(`[prune] koffi: kept ${target}, removed ${platforms.length - 1} other platform(s)`);
  }
}

// tcvdb-text bundles a 192MB English BM25 dictionary next to the 81MB Chinese
// one. The desktop never configures bm25.language, so the engine always loads
// the default "zh" encoder — the English dictionary is never read.
function pruneUnusedBm25Dictionaries(root) {
  for (const dataDir of findDirs(join(root, "node_modules"), "tcvdb-text").map((d) => join(d, "data"))) {
    const en = join(dataDir, "bm25_en_default.json");
    if (existsSync(en)) {
      const saved = statSync(en).size;
      rmSync(en, { force: true });
      log(`[prune] tcvdb-text: removed unused English BM25 dictionary (${mb(saved)})`);
    }
  }
}

// Recursively find every directory named `name` under `from` (walks into
// node_modules so nested copies are caught too).
function findDirs(from, name) {
  const found = [];
  if (!existsSync(from)) {
    return found;
  }
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = join(from, entry.name);
    if (entry.name === name) {
      found.push(full);
    }
    found.push(...findDirs(full, name));
  }
  return found;
}

function dirSize(dir) {
  if (!existsSync(dir)) {
    return 0;
  }
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
