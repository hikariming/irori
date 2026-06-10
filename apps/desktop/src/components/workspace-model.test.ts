import assert from "node:assert/strict";
import { test } from "node:test";

import {
  breadcrumbSegments,
  fileCategory,
  fileExtension,
  flattenVisibleNodes,
  formatFileSize,
  rootLabel,
  workspaceTreeScopeChanged,
  searchLoadedTree,
  sortNodes,
  toggleExpanded,
  type WorkspaceNode
} from "./workspace-model.ts";

function folder(id: string, name: string, hasChildren = true): WorkspaceNode {
  return { id, name, kind: "folder", rootId: "workspace", hasChildren };
}

function file(id: string, name: string, size = 0): WorkspaceNode {
  return { id, name, kind: "file", rootId: "workspace", size, hasChildren: false };
}

const roots: WorkspaceNode[] = [folder("/root", "root")];
const childrenByPath = new Map<string, WorkspaceNode[]>([
  ["/root", [file("/root/zeta.txt", "zeta.txt", 10), folder("/root/src", "src")]],
  ["/root/src", [file("/root/src/app.ts", "app.ts", 2048)]]
]);

test("fileExtension handles dotfiles and trailing dots", () => {
  assert.equal(fileExtension("App.tsx"), "tsx");
  assert.equal(fileExtension("archive.tar.gz"), "gz");
  assert.equal(fileExtension(".env"), "");
  assert.equal(fileExtension("README"), "");
  assert.equal(fileExtension("weird."), "");
});

test("fileCategory maps known extensions and folders", () => {
  assert.equal(fileCategory(folder("/a", "a")), "folder");
  assert.equal(fileCategory(file("/b", "lib.rs")), "code");
  assert.equal(fileCategory(file("/c", "data.json")), "data");
  assert.equal(fileCategory(file("/d", "mystery.xyz")), "other");
});

test("formatFileSize is human readable", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2 KB");
  assert.equal(formatFileSize(1_572_864), "1.5 MB");
  assert.equal(formatFileSize(undefined), "");
});

test("sortNodes puts folders before files, then by name", () => {
  const mixed = [file("/z", "z.txt"), folder("/b", "b"), folder("/a", "a"), file("/m", "m.txt")];
  assert.deepEqual(sortNodes(mixed).map((node) => node.name), ["a", "b", "m.txt", "z.txt"]);
});

test("flattenVisibleNodes only descends into expanded, loaded folders", () => {
  const collapsed = flattenVisibleNodes(roots, new Set(), childrenByPath);
  assert.deepEqual(collapsed.map((row) => row.node.id), ["/root"]);

  const expanded = flattenVisibleNodes(roots, new Set(["/root"]), childrenByPath);
  // src (folder) sorts before zeta.txt (file).
  assert.deepEqual(expanded.map((row) => row.node.id), ["/root", "/root/src", "/root/zeta.txt"]);
  assert.equal(expanded.find((row) => row.node.id === "/root/src")?.depth, 1);

  const deep = flattenVisibleNodes(roots, new Set(["/root", "/root/src"]), childrenByPath);
  assert.deepEqual(deep.map((row) => row.node.id), ["/root", "/root/src", "/root/src/app.ts", "/root/zeta.txt"]);
});

test("flattenVisibleNodes flags expanded-but-unloaded folders as loading", () => {
  // /root is expanded but its children aren't in the (empty) map yet.
  const rows = flattenVisibleNodes(roots, new Set(["/root"]), new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].loading, true);
});

test("toggleExpanded flips membership without mutating input", () => {
  const start = new Set(["a"]);
  const added = toggleExpanded(start, "b");
  assert.deepEqual([...added].sort(), ["a", "b"]);
  assert.deepEqual([...start], ["a"]);
  assert.deepEqual([...toggleExpanded(added, "a")], ["b"]);
});

test("searchLoadedTree keeps matches + ancestors over the loaded tree and auto-expands the path", () => {
  const result = searchLoadedTree(roots, childrenByPath, "app");
  assert.ok(result);
  assert.ok(result.keepIds.has("/root/src/app.ts"));
  assert.ok(result.keepIds.has("/root/src"));
  assert.ok(result.keepIds.has("/root"));
  assert.ok(!result.keepIds.has("/root/zeta.txt"));
  assert.ok(result.expandIds.has("/root"));
  assert.ok(result.expandIds.has("/root/src"));

  // Filtering the flatten with keepIds drops non-matching siblings.
  const expanded = new Set<string>([...result.expandIds]);
  const rows = flattenVisibleNodes(roots, expanded, childrenByPath, result.keepIds);
  assert.deepEqual(rows.map((row) => row.node.id), ["/root", "/root/src", "/root/src/app.ts"]);

  assert.equal(searchLoadedTree(roots, childrenByPath, "   "), null);
  assert.equal(searchLoadedTree(roots, childrenByPath, "nope")?.keepIds.size, 0);
});

test("breadcrumbSegments splits both posix and windows paths", () => {
  assert.deepEqual(breadcrumbSegments("/Users/rqq/irori"), ["Users", "rqq", "irori"]);
  assert.deepEqual(breadcrumbSegments("C:\\Users\\rqq"), ["C:", "Users", "rqq"]);
});

test("rootLabel names the two roots", () => {
  assert.equal(rootLabel("workspace"), "工作区");
  assert.equal(rootLabel("computer"), "这台电脑");
});

test("workspaceTreeScopeChanged only resets when workspace path changes", () => {
  assert.equal(workspaceTreeScopeChanged("/Users/rqq/project-a", "/Users/rqq/project-a"), false);
  assert.equal(workspaceTreeScopeChanged("/Users/rqq/project-a", "/Users/rqq/project-b"), true);
  assert.equal(workspaceTreeScopeChanged("", "/Users/rqq/project-b"), true);
});
