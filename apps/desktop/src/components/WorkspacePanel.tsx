import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { BrowserOpenRequest, BrowserPanelState } from "./browser-panel-model";
import { useWorkspaceTree } from "./use-workspace-tree";
import {
  breadcrumbSegments,
  fileCategory,
  formatFileSize,
  type FileCategory,
  type WorkspaceNode,
  type WorkspaceRow,
  type WorkspaceTab
} from "./workspace-model";

type WorkspacePanelProps = {
  activeTab?: WorkspaceTab;
  browser: BrowserPanelState;
  isOpen: boolean;
  workspacePath?: string;
  onBrowserInputChange: (value: string) => void;
  onBrowserLoad: () => void;
  onBrowserNavigate: (request: BrowserOpenRequest) => void;
  onTabChange?: (tab: WorkspaceTab) => void;
  onToggle: () => void;
};

const TABS: Array<{ id: WorkspaceTab; icon: string }> = [
  { id: "files", icon: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v8A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5z" },
  { id: "services", icon: "M5 4h14v5H5zM5 15h14v5H5zM8 6.5h.01M8 17.5h.01" },
  { id: "browser", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" }
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
  const { t } = useTranslation("workspace");

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
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t("searchAria")}
        />
      </div>

      {error ? <p className="ws-error" role="alert">{error}</p> : null}

      <div className="ws-tree" role="tree" aria-label={t("treeAria")}>
        {rows.length === 0 ? (
          <p className="ws-empty">{isSearching ? t("emptyNoMatch", { query }) : t("emptyWorkspace")}</p>
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
        <aside className="ws-detail" aria-label={t("detailAria")}>
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
              <dt>{t("fieldType")}</dt>
              <dd>{selected.kind === "folder" ? t("folder") : t("fileOfType", { category: fileCategory(selected) })}</dd>
            </div>
            {selected.kind === "file" ? (
              <div>
                <dt>{t("fieldSize")}</dt>
                <dd>{formatFileSize(selected.size) || "—"}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t("fieldSource")}</dt>
              <dd>{t(`source.${selected.rootId}`)}</dd>
            </div>
          </dl>
          <div className="ws-detail-actions">
            <button type="button">{t("referenceInChat")}</button>
            <button type="button">{t("openWithPi")}</button>
          </div>
        </aside>
      ) : (
        <p className="ws-detail ws-detail--hint">{t("detailHint")}</p>
      )}
    </div>
  );
}

function PlaceholderTab({ title, hint }: { title: string; hint: string }) {
  const { t } = useTranslation("workspace");
  return (
    <div className="ws-placeholder" role="status">
      <strong>{title}</strong>
      <p>{hint}</p>
      <span className="ws-placeholder-tag">{t("placeholderTag")}</span>
    </div>
  );
}

function BrowserTab({
  browser,
  onInputChange,
  onLoad,
  onNavigate
}: {
  browser: BrowserPanelState;
  onInputChange: (value: string) => void;
  onLoad: () => void;
  onNavigate: (request: BrowserOpenRequest) => void;
}) {
  const { t } = useTranslation("workspace");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onNavigate({
      action: "open",
      url: browser.urlInput,
      source: "user"
    });
  }

  function openExternal() {
    if (!browser.currentUrl) {
      return;
    }

    window.open(browser.currentUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="ws-browser">
      <form className="ws-browser-bar" onSubmit={submit}>
        <input
          aria-label={t("browserUrlAria")}
          inputMode="url"
          placeholder="https://example.com"
          type="text"
          value={browser.urlInput}
          onChange={(event) => onInputChange(event.target.value)}
        />
        <button type="submit" aria-label={t("openPageAria")} className="ws-icon-button">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
        </button>
        <button type="button" aria-label={t("openInSystemBrowserAria")} className="ws-icon-button" disabled={!browser.currentUrl} onClick={openExternal}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 3h7v7" />
            <path d="M10 14 21 3" />
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
        </button>
      </form>

      <div className="ws-browser-meta" aria-live="polite">
        {browser.currentUrl ? (
          <>
            <span className={`ws-browser-status ${browser.status}`}>{browser.status === "ready" ? t("status.ready") : browser.status === "error" ? t("status.error") : t("status.loading")}</span>
            <span className="ws-browser-url">{browser.title || browser.currentUrl}</span>
          </>
        ) : (
          <span className="ws-browser-url">{t("noPage")}</span>
        )}
      </div>

      {browser.error ? <p className="ws-error">{browser.error}</p> : null}

      {browser.currentUrl ? (
        <div className="ws-browser-frame">
          <iframe
            key={browser.currentUrl}
            title={browser.title || t("browserPreviewTitle")}
            src={browser.currentUrl}
            sandbox="allow-same-origin allow-scripts allow-popups"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={onLoad}
          />
        </div>
      ) : (
        <div className="ws-browser-empty" role="status">
          <strong>{t("noPageOpen")}</strong>
          <p>{t("browserEmptyHint")}</p>
        </div>
      )}
    </div>
  );
}

export function WorkspacePanel({
  activeTab: controlledActiveTab,
  browser,
  isOpen,
  onBrowserInputChange,
  onBrowserLoad,
  onBrowserNavigate,
  onTabChange,
  onToggle,
  workspacePath = ""
}: WorkspacePanelProps) {
  const { t } = useTranslation("workspace");
  const [internalActiveTab, setInternalActiveTab] = useState<WorkspaceTab>("files");
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const [selected, setSelected] = useState<WorkspaceNode | null>(null);
  const tree = useWorkspaceTree(isOpen, workspacePath);

  useEffect(() => {
    setSelected(null);
  }, [workspacePath]);

  function onRailSelect(tab: WorkspaceTab) {
    if (controlledActiveTab === undefined) {
      setInternalActiveTab(tab);
    }
    onTabChange?.(tab);
    if (!isOpen) {
      onToggle();
    }
  }

  const activeLabel = useMemo(() => t(`tabs.${activeTab}`), [activeTab, t]);

  return (
    <aside className={`workspace-panel ${isOpen ? "open" : "collapsed"}`} aria-label={t("panelAria")}>
      <nav className="ws-rail" aria-label={t("railAria")}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`ws-rail-button ${isOpen && activeTab === tab.id ? "active" : ""}`}
            aria-label={t(`tabs.${tab.id}`)}
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
          aria-label={isOpen ? t("collapse") : t("expand")}
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
            <small>{t("headerSub")}</small>
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
            <PlaceholderTab title={t("servicesTitle")} hint={t("servicesHint")} />
          ) : null}
          {activeTab === "browser" ? (
            <BrowserTab
              browser={browser}
              onInputChange={onBrowserInputChange}
              onLoad={onBrowserLoad}
              onNavigate={onBrowserNavigate}
            />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
