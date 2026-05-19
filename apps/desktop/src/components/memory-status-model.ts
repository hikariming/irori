export type MemoryBackendSource = "explicit" | "tencentdb" | "chat-history" | "none";

export type MemoryStatus = {
  configuredBackend: "tencentdb" | "chat-history";
  fallbackBackend: "chat-history";
  memoryDir: string;
  sqliteVecAvailable: boolean;
  tencentDbPackageAvailable: boolean;
  vectorsDbExists: boolean;
};

export type RecalledMemorySnapshot = {
  id: string;
  scope: "user" | "character" | "project" | "session";
  kind: "profile_fact" | "preference" | "relationship_note" | "project_note" | "session_summary";
  text: string;
  confidence?: number;
  sourceRef?: string;
  approved?: boolean;
};

export type MemoryRunSnapshot = {
  memoryBackendSource?: MemoryBackendSource;
  recalledMemories?: RecalledMemorySnapshot[];
};

export type MemoryDebugEventKind = "recall" | "fallback" | "capture" | "skipped";

export type MemoryDebugEvent = {
  id: string;
  kind: MemoryDebugEventKind;
  sourceLabel: string;
  summary: string;
  timeLabel: string;
};

export const memoryKindLabels: Record<RecalledMemorySnapshot["kind"], string> = {
  profile_fact: "用户事实",
  preference: "偏好",
  relationship_note: "关系互动",
  project_note: "项目背景",
  session_summary: "会话摘要"
};

export function formatMemoryBackendSource(source?: MemoryBackendSource) {
  switch (source) {
    case "explicit":
      return "调试注入后端";
    case "tencentdb":
      return "TencentDB 记忆";
    case "chat-history":
      return "聊天历史 fallback";
    case "none":
      return "未注入记忆";
    default:
      return "还没有运行记录";
  }
}

export function formatConfiguredMemoryBackend(backend: MemoryStatus["configuredBackend"]) {
  return backend === "tencentdb" ? "TencentDB 记忆" : "聊天历史";
}

function formatDebugTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function debugKindForSource(source?: MemoryBackendSource): MemoryDebugEventKind {
  if (source === "chat-history") {
    return "fallback";
  }

  if (source === "none" || !source) {
    return "skipped";
  }

  return "recall";
}

export function createMemoryDebugEventFromRun({
  now = new Date(),
  run
}: {
  now?: Date;
  run: MemoryRunSnapshot;
}): MemoryDebugEvent {
  const sourceLabel = formatMemoryBackendSource(run.memoryBackendSource);
  const recalledCount = run.recalledMemories?.length ?? 0;
  const kind = debugKindForSource(run.memoryBackendSource);
  const summary =
    kind === "skipped"
      ? "本轮没有注入记忆。"
      : `召回 ${recalledCount} 条，使用${sourceLabel}。`;

  return {
    id: `${now.toISOString()}-${run.memoryBackendSource ?? "unknown"}-${recalledCount}`,
    kind,
    sourceLabel,
    summary,
    timeLabel: formatDebugTime(now)
  };
}

export function appendMemoryDebugEvent(events: MemoryDebugEvent[], event: MemoryDebugEvent) {
  return [event, ...events].slice(0, 10);
}

export function buildMemoryDashboardViewModel({
  status,
  latestRun,
  debugEvents = []
}: {
  status: MemoryStatus | null;
  latestRun?: MemoryRunSnapshot | null;
  debugEvents?: MemoryDebugEvent[];
}) {
  const memories = latestRun?.recalledMemories ?? [];

  return {
    backendLabel: status ? formatConfiguredMemoryBackend(status.configuredBackend) : "加载中",
    latestSourceLabel: formatMemoryBackendSource(latestRun?.memoryBackendSource),
    recalledCount: memories.length,
    storageRows: status
      ? [
          { label: "记忆目录", value: status.memoryDir },
          { label: "TencentDB 包", value: status.tencentDbPackageAvailable ? "已安装" : "未找到" },
          { label: "sqlite-vec", value: status.sqliteVecAvailable ? "可用" : "未确认" },
          { label: "vectors.db", value: status.vectorsDbExists ? "已创建" : "尚未创建" }
        ]
      : [],
    memories: memories.map((memory) => ({
      ...memory,
      kindLabel: memoryKindLabels[memory.kind],
      sourceLabel: memory.sourceRef ?? memory.scope
    })),
    debugEvents
  };
}
