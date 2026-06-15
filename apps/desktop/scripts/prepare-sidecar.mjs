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
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

log("done.");
