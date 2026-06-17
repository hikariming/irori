import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const siteRoot = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(siteRoot, path), "utf8");

test("site exposes crawler and AI discovery files", () => {
  assert.ok(existsSync(join(siteRoot, "app/robots.ts")), "robots.ts should exist");
  assert.ok(existsSync(join(siteRoot, "app/sitemap.ts")), "sitemap.ts should exist");
  assert.ok(existsSync(join(siteRoot, "public/llms.txt")), "llms.txt should exist");

  const robots = read("app/robots.ts");
  assert.match(robots, /OAI-SearchBot/);
  assert.match(robots, /GPTBot/);
  assert.match(robots, /sitemap/i);

  const llms = read("public/llms.txt");
  assert.match(llms, /Irori/);
  assert.match(llms, /local-first/i);
  assert.match(llms, /https:\/\/github\.com\/hikariming\/irori/);
});

test("metadata is launch-ready for search and social previews", () => {
  const layout = read("app/layout.tsx");

  assert.match(layout, /Local-first AI companion/i);
  assert.match(layout, /canonical/);
  assert.match(layout, /alternates/);
  assert.match(layout, /twitter/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /\/assets\/irori-character-hero\.png/);
});

test("landing page has structured app data and real external CTAs", () => {
  const page = read("app/page.tsx");

  assert.match(page, /SoftwareApplication/);
  assert.match(page, /https:\/\/github\.com\/hikariming\/irori\/releases\/latest/);
  assert.doesNotMatch(page, /className="button secondary" href="#top"/);
});
