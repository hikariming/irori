// 右侧「工作区」面板的纯逻辑层。
//
// 文件树是「懒加载」的：节点 id 就是真实文件系统的绝对路径，文件夹的子节点
// 只在展开时才向后端（Tauri command list_workspace_dir）取一层，结果存进
// childrenByPath。这样首屏只列两个根，不会一次性扫全盘。

export type WorkspaceTab = "files" | "services" | "browser";

export type WorkspaceRootId = "workspace" | "computer";

export type WorkspaceNodeKind = "folder" | "file";

// 后端 list_workspace_roots / list_workspace_dir 返回的一条目录项。
export type WorkspaceNode = {
  id: string; // 绝对路径
  name: string;
  kind: WorkspaceNodeKind;
  rootId: WorkspaceRootId;
  size?: number;
  modifiedAt?: number;
  hasChildren: boolean;
};

// 已加载的子节点：path -> 这一层的条目（文件夹展开后填充）。
export type WorkspaceChildren = ReadonlyMap<string, readonly WorkspaceNode[]>;

// 拍平后给列表渲染用的一行。
export type WorkspaceRow = {
  node: WorkspaceNode;
  depth: number;
  expanded: boolean;
  // 已展开但子节点还没拉回来 —— 渲染层据此显示「加载中」。
  loading: boolean;
};

// 按用途给文件归类，驱动图标 / 颜色（纯展示，不参与逻辑）。
export type FileCategory =
  | "folder"
  | "code"
  | "doc"
  | "image"
  | "data"
  | "config"
  | "binary"
  | "other";

const CATEGORY_BY_EXT: Record<string, FileCategory> = {
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  rs: "code",
  py: "code",
  go: "code",
  sh: "code",
  css: "code",
  html: "code",
  md: "doc",
  txt: "doc",
  pdf: "doc",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  json: "data",
  jsonl: "data",
  csv: "data",
  sqlite: "data",
  db: "data",
  toml: "config",
  yaml: "config",
  yml: "config",
  lock: "config",
  env: "config"
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
}

export function fileCategory(node: WorkspaceNode): FileCategory {
  if (node.kind === "folder") {
    return "folder";
  }
  const ext = fileExtension(node.name);
  if (!ext) {
    return "other";
  }
  return CATEGORY_BY_EXT[ext] ?? "other";
}

// 1024 进制、保留一位小数、整数不带小数点。
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// 把绝对路径拆成面包屑（兼容 / 与 \ 分隔）。
export function breadcrumbSegments(id: string): string[] {
  return id.split(/[/\\]+/).filter((segment) => segment.length > 0);
}

// 后端已按「文件夹在前、同类按名」排好；这里仅作为兜底（如 preview mock）再稳一次。
function compareNodes(left: WorkspaceNode, right: WorkspaceNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

export function sortNodes(nodes: readonly WorkspaceNode[]): WorkspaceNode[] {
  return [...nodes].sort(compareNodes);
}

// 把懒加载的树拍平成可见行：只有展开的文件夹才往下铺它「已加载」的子层。
// keepIds 非空时只保留命中搜索的节点（见 searchLoadedTree）。
export function flattenVisibleNodes(
  roots: readonly WorkspaceNode[],
  expandedIds: ReadonlySet<string>,
  childrenByPath: WorkspaceChildren,
  keepIds?: ReadonlySet<string>
): WorkspaceRow[] {
  const rows: WorkspaceRow[] = [];

  function walk(nodes: readonly WorkspaceNode[], depth: number) {
    for (const node of sortNodes(nodes)) {
      if (keepIds && !keepIds.has(node.id)) {
        continue;
      }
      const expanded = node.kind === "folder" && expandedIds.has(node.id);
      const loaded = childrenByPath.get(node.id);
      rows.push({ node, depth, expanded, loading: expanded && loaded === undefined });
      if (expanded && loaded) {
        walk(loaded, depth + 1);
      }
    }
  }

  walk(roots, 0);
  return rows;
}

export function toggleExpanded(expandedIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expandedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export type SearchResult = {
  // 命中节点 + 其祖先（用于 flatten 过滤）。
  keepIds: Set<string>;
  // 命中路径上的文件夹（用于自动展开）。
  expandIds: Set<string>;
};

// 在「已加载」的树里按名字搜索：保留命中节点及其祖先，并展开命中路径。
// 注意只覆盖已经拉回来的层级——没展开过的子树不在内存里，搜不到（之后可加
// 后端递归搜索 command 来补全）。query 为空时返回 null 表示「不过滤」。
export function searchLoadedTree(
  roots: readonly WorkspaceNode[],
  childrenByPath: WorkspaceChildren,
  query: string
): SearchResult | null {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const keepIds = new Set<string>();
  const expandIds = new Set<string>();

  function walk(node: WorkspaceNode): boolean {
    const selfMatch = node.name.toLowerCase().includes(trimmed);
    let descendantMatch = false;

    if (node.kind === "folder") {
      for (const child of childrenByPath.get(node.id) ?? []) {
        if (walk(child)) {
          descendantMatch = true;
        }
      }
    }

    if (selfMatch || descendantMatch) {
      keepIds.add(node.id);
      if (descendantMatch) {
        expandIds.add(node.id);
      }
      return true;
    }
    return false;
  }

  for (const root of roots) {
    walk(root);
  }

  return { keepIds, expandIds };
}

export function rootLabel(rootId: WorkspaceRootId): string {
  return rootId === "workspace" ? "工作区" : "这台电脑";
}
