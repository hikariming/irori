import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attachmentKindLabel,
  describeAttachmentsForPrompt,
  formatAttachmentSize,
  mergeAttachments,
  summarizeAttachmentsForMessage
} from "./attachment-model.ts";
import type { StagedAttachment } from "./desktop-backend.ts";

function attachment(overrides: Partial<StagedAttachment> = {}): StagedAttachment {
  return {
    id: "report.pdf",
    name: "report.pdf",
    relPath: "attachments/report.pdf",
    absPath: "/ws/attachments/report.pdf",
    size: 2_400,
    kind: "pdf",
    ...overrides
  };
}

test("formatAttachmentSize scales units and keeps bytes whole", () => {
  assert.equal(formatAttachmentSize(0), "0 B");
  assert.equal(formatAttachmentSize(900), "900 B");
  assert.equal(formatAttachmentSize(1536), "1.5 KB");
  assert.equal(formatAttachmentSize(2_400_000), "2.3 MB");
});

test("attachmentKindLabel falls back to 文件 for unknown kinds", () => {
  assert.equal(attachmentKindLabel("image"), "图片");
  assert.equal(attachmentKindLabel("totally-unknown"), "文件");
});

test("mergeAttachments dedupes by relPath and preserves order", () => {
  const current = [attachment()];
  const merged = mergeAttachments(current, [
    attachment(),
    attachment({ id: "a.png", name: "a.png", relPath: "attachments/a.png", kind: "image" })
  ]);
  assert.deepEqual(
    merged.map((item) => item.relPath),
    ["attachments/report.pdf", "attachments/a.png"]
  );
});

test("summary and prompt descriptions are empty without attachments", () => {
  assert.equal(summarizeAttachmentsForMessage([]), "");
  assert.equal(describeAttachmentsForPrompt([]), "");
});

test("summarizeAttachmentsForMessage lists names for the user bubble", () => {
  const summary = summarizeAttachmentsForMessage([
    attachment(),
    attachment({ name: "notes.md", relPath: "attachments/notes.md" })
  ]);
  assert.match(summary, /已附上 2 个文件/);
  assert.match(summary, /report\.pdf、notes\.md/);
});

test("describeAttachmentsForPrompt exposes relative paths and a read hint", () => {
  const described = describeAttachmentsForPrompt([attachment()]);
  assert.match(described, /attachments\/report\.pdf/);
  assert.match(described, /PDF/);
  assert.match(described, /read \/ grep/);
});
