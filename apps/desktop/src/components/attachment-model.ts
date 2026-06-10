import type { StagedAttachment } from "./desktop-backend.ts";

const KIND_LABELS: Record<string, string> = {
  image: "图片",
  pdf: "PDF",
  text: "文本",
  document: "文档",
  file: "文件"
};

export function attachmentKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? KIND_LABELS.file;
}

// 把字节数压成人能读的单位；只在 KB 以上保留一位小数。
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// 同一个文件（相对路径相同）只保留一份，避免重复拖拽刷出多个相同附件。
export function mergeAttachments(
  current: StagedAttachment[],
  incoming: StagedAttachment[]
): StagedAttachment[] {
  const seen = new Set(current.map((item) => item.relPath));
  const merged = [...current];
  for (const item of incoming) {
    if (seen.has(item.relPath)) {
      continue;
    }
    seen.add(item.relPath);
    merged.push(item);
  }
  return merged;
}

// 用户气泡里的简短附件摘要（只给人看）。
export function summarizeAttachmentsForMessage(attachments: StagedAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  const names = attachments.map((item) => item.name).join("、");
  return `📎 已附上 ${attachments.length} 个文件：${names}`;
}

// 给模型看的附件清单：相对路径 + 类型/大小 + 读取指引，让角色用 read / grep 自行打开。
export function describeAttachmentsForPrompt(attachments: StagedAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  const lines = attachments.map(
    (item) => `- ${item.relPath}（${attachmentKindLabel(item.kind)}，${formatAttachmentSize(item.size)}）`
  );
  return [
    "用户拖入了以下文件，已复制到当前工作区，可用 read / grep / ls 等工具按相对路径打开：",
    ...lines,
    "请先读取并理解这些文件内容，再回应用户的请求；用户没有额外文字时，主动给出处理结果或先确认要做什么。"
  ].join("\n");
}
