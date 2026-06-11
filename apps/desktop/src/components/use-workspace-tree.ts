import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { desktopBackend } from "./desktop-backend";
import { formatUnknownError } from "./error-message";
import {
  flattenVisibleNodes,
  searchLoadedTree,
  toggleExpanded,
  workspaceTreeScopeChanged,
  type WorkspaceNode,
  type WorkspaceRow
} from "./workspace-model";

// 懒加载文件树的状态机：首屏拉两个根，展开文件夹时按层取子节点并缓存。
export function useWorkspaceTree(enabled: boolean, scopeKey = "") {
  const { t } = useTranslation("workspace");
  const [roots, setRoots] = useState<WorkspaceNode[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, WorkspaceNode[]>>(() => new Map());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [rootsLoaded, setRootsLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const previousScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (!workspaceTreeScopeChanged(previousScopeRef.current, scopeKey)) {
      return;
    }

    previousScopeRef.current = scopeKey;
    setRoots([]);
    setChildrenByPath(new Map());
    setExpandedIds(new Set());
    setLoadingIds(new Set());
    setError(null);
    setRootsLoaded(false);
    setQuery("");
  }, [scopeKey]);

  // 面板首次打开才拉根，避免没用到也扫盘。
  useEffect(() => {
    if (!enabled || rootsLoaded) {
      return;
    }
    let cancelled = false;
    setRootsLoaded(true);
    desktopBackend
      .listWorkspaceRoots()
      .then((loaded) => {
        if (!cancelled) {
          setRoots(loaded);
          setError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setRootsLoaded(false);
          setError(formatUnknownError(cause, t("errors.rootLoad")));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, rootsLoaded]);

  const loadChildren = useCallback(
    async (node: WorkspaceNode) => {
      if (childrenByPath.has(node.id) || loadingIds.has(node.id)) {
        return;
      }
      setLoadingIds((current) => new Set(current).add(node.id));
      try {
        const children = await desktopBackend.listWorkspaceDir(node.id, node.rootId);
        setChildrenByPath((current) => new Map(current).set(node.id, children));
        setError(null);
      } catch (cause) {
        // 失败也缓存成空，避免反复重试；同时提示一次。
        setChildrenByPath((current) => new Map(current).set(node.id, []));
        setError(formatUnknownError(cause, t("errors.readNode", { name: node.name })));
      } finally {
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(node.id);
          return next;
        });
      }
    },
    [childrenByPath, loadingIds]
  );

  const toggleNode = useCallback(
    (node: WorkspaceNode) => {
      if (node.kind !== "folder") {
        return;
      }
      const willExpand = !expandedIds.has(node.id);
      setExpandedIds((current) => toggleExpanded(current, node.id));
      if (willExpand) {
        void loadChildren(node);
      }
    },
    [expandedIds, loadChildren]
  );

  const search = useMemo(
    () => searchLoadedTree(roots, childrenByPath, query),
    [roots, childrenByPath, query]
  );

  const rows: WorkspaceRow[] = useMemo(() => {
    const effectiveExpanded = search
      ? new Set<string>([...expandedIds, ...search.expandIds])
      : expandedIds;
    return flattenVisibleNodes(roots, effectiveExpanded, childrenByPath, search?.keepIds);
  }, [roots, expandedIds, childrenByPath, search]);

  return { rows, query, setQuery, toggleNode, error, isSearching: search !== null };
}
