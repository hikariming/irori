import { useMemo, useState } from "react";

import { useWorkspaceTree } from "./use-workspace-tree";
import {
  breadcrumbSegments,
  fileCategory,
  formatFileSize,
  rootLabel,
  type FileCategory,
  type WorkspaceNode,
  type WorkspaceRow,
  type WorkspaceTab
} from "./workspace-model";

type WorkspacePanelProps = {
  isOpen: boolean;
  onToggle: () => void;
};

const TABS: Array<{ id: WorkspaceTab; label: string; icon: string }> = [
  { id: "files", label: "文件", icon: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v8A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5z" },
  { id: "services", label: "服务", icon: "M5 4h14v5H5zM5 15h14v5H5zM8 6.5h.01M8 17.5h.01" },
  { id: "browser", label: "浏览器", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" }
];

// 每类文件一个语义化色块，纯展示。
const CATEGORY_TINT: Record<FileCategory, string> = {
  folder: "var(--teal-text)",
  code: "#5b8def",
  doc: "#8a8f9c",
  image: "#d08770",
  data: "#b48ead",
  config: "#caa94a",
  binary: "#6c7686",
  other: "#9aa0ac"
};

function TabIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`ws-chevron ${open ? "open" : ""}`} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function NodeGlyph({ node, expanded }: { node: WorkspaceNode; expanded: boolean }) {
  const category = fileCategory(node);
  if (node.kind === "folder") {
    return (
      <svg className="ws-node-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={CATEGORY_TINT.folder} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {expanded
          ? <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5L20 17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17z" />
          : <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v8A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5z" />}
      </svg>
    );
  }
  return <span className="ws-file-dot" style={{ backgroundColor: CATEGORY_TINT[category] }} aria-hidden />;
}

type FileExplorerProps = {
  rows: WorkspaceRow[];
  query: string;
  onQueryChange: (value: string) => void;
  onToggle: (node: WorkspaceNode) => void;
  selected: WorkspaceNode | null;
  onSelect: (node: WorkspaceNode) => void;
  error: string | null;
  isSearching: boolean;
};

function FileExplorer({ rows, query, onQueryChange, onToggle, selected, onSelect, error, isSearching }: FileExplorerProps) {
  function onRowActivate(node: WorkspaceNode) {
    onSelect(node);
    if (node.kind === "folder") {
      onToggle(node);
    }
  }

  return (
    <div className="ws-files">
      <div className="ws-search">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" />
        </svg>
        <input
          type="search"
          placeholder="搜索已展开的文件…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="搜索文件"
        />
      </div>

      {error ? <p className="ws-error" role="alert">{error}</p> : null}

      <div className="ws-tree" role="tree" aria-label="文件树">
        {rows.length === 0 ? (
          <p className="ws-empty">{isSearching ? `没有匹配「${query}」的已加载文件` : "工作区为空"}</p>
        ) : (
          rows.map(({ node, depth, expanded, loading }) => (
            <button
              key={node.id}
              type="button"
              role="treeitem"
              aria-expanded={node.kind === "folder" ? expanded : undefined}
              aria-selected={node.id === selected?.id}
              className={`ws-row ${node.id === selected?.id ? "selected" : ""}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => onRowActivate(node)}
            >
              {node.kind === "folder" ? <Chevron open={expanded} /> : <span className="ws-chevron-spacer" />}
              <NodeGlyph node={node} expanded={expanded} />
              <span className="ws-row-name">{node.name}</span>
              {loading ? <span className="ws-row-hint">…</span> : null}
              {node.kind === "file" ? <span className="ws-row-size">{formatFileSize(node.size)}</span> : null}
            </button>
          ))
        )}
      </div>

      {selected ? (
        <aside className="ws-detail" aria-label="文件详情">
          <div className="ws-detail-head">
            <NodeGlyph node={selected} expanded={false} />
            <strong>{selected.name}</strong>
          </div>
          <ol className="ws-breadcrumb">
            {breadcrumbSegments(selected.id).map((segment, index, all) => (
              <li key={`${segment}-${index}`} aria-current={index === all.length - 1 ? "true" : undefined}>
                {segment}
              </li>
            ))}
          </ol>
          <dl className="ws-detail-meta">
            <div>
              <dt>类型</dt>
              <dd>{selected.kind === "folder" ? "文件夹" : `${fileCategory(selected)} 文件`}</dd>
            </div>
            {selected.kind === "file" ? (
              <div>
                <dt>大小</dt>
                <dd>{formatFileSize(selected.size) || "—"}</dd>
              </div>
            ) : null}
            <div>
              <dt>来源</dt>
              <dd>{rootLabel(selected.rootId)}</dd>
            </div>
          </dl>
          <div className="ws-detail-actions">
            <button type="button">在聊天中引用</button>
            <button type="button">用 Pi 打开</button>
          </div>
        </aside>
      ) : (
        <p className="ws-detail ws-detail--hint">选择一个文件查看详情，或让 Pi 直接操作它。</p>
      )}
    </div>
  );
}

function PlaceholderTab({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="ws-placeholder" role="status">
      <strong>{title}</strong>
      <p>{hint}</p>
      <span className="ws-placeholder-tag">原型占位 · 待接入</span>
    </div>
  );
}

export function WorkspacePanel({ isOpen, onToggle }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("files");
  const [selected, setSelected] = useState<WorkspaceNode | null>(null);
  const tree = useWorkspaceTree(isOpen);

  function onRailSelect(tab: WorkspaceTab) {
    setActiveTab(tab);
    if (!isOpen) {
      onToggle();
    }
  }

  const activeLabel = useMemo(() => TABS.find((tab) => tab.id === activeTab)?.label, [activeTab]);

  return (
    <aside className={`workspace-panel ${isOpen ? "open" : "collapsed"}`} aria-label="工作区">
      <nav className="ws-rail" aria-label="工作区切换">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`ws-rail-button ${isOpen && activeTab === tab.id ? "active" : ""}`}
            aria-label={tab.label}
            aria-pressed={isOpen && activeTab === tab.id}
            onClick={() => onRailSelect(tab.id)}
          >
            <TabIcon path={tab.icon} />
          </button>
        ))}
        <span className="ws-rail-spacer" />
        <button
          type="button"
          className="ws-rail-button ws-rail-toggle"
          aria-label={isOpen ? "收起工作区" : "展开工作区"}
          onClick={onToggle}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={isOpen ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
          </svg>
        </button>
      </nav>

      {isOpen ? (
        <div className="ws-body">
          <header className="ws-header">
            <h2>{activeLabel}</h2>
            <small>Pi 工作区 · 本地</small>
          </header>
          {activeTab === "files" ? (
            <FileExplorer
              rows={tree.rows}
              query={tree.query}
              onQueryChange={tree.setQuery}
              onToggle={tree.toggleNode}
              selected={selected}
              onSelect={setSelected}
              error={tree.error}
              isSearching={tree.isSearching}
            />
          ) : null}
          {activeTab === "services" ? (
            <PlaceholderTab title="后端服务" hint="这里会列出 Pi 启动的本地服务、端口与日志，可一键打开或重启。" />
          ) : null}
          {activeTab === "browser" ? (
            <PlaceholderTab title="内置浏览器" hint="这里会嵌入一个轻量浏览器视图，Pi 可以替你打开网页、抓取内容。" />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
