import { formatClockTime } from "../i18n/formatters.ts";

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
  userId?: string;
  characterId?: string;
  projectId?: string;
  sessionId?: string;
  confidence?: number;
  sourceRef?: string;
  approved?: boolean;
};

export type MemoryRunSnapshot = {
  memoryBackendSource?: MemoryBackendSource;
  recalledMemories?: RecalledMemorySnapshot[];
};

export const memoryCharacterLabels: Record<string, string> = {
  shili: "示璃",
  lulin: "陆临",
  shenyanzhou: "沈砚洲"
};

export type MemoryDebugEventKind = "recall" | "fallback" | "capture" | "skipped";

export type MemoryDebugEvent = {
  id: string;
  kind: MemoryDebugEventKind;
  sourceLabel: string;
  summary: string;
  timeLabel: string;
};

// 文案已抽到 i18n 的 settings:memory.*；这里只产出稳定的 key，文本由组件/调用方用 t() 渲染。
// MemoryTranslate 是 react-i18next TFunction 的最小子集，避免把 model 文件耦合到 i18next 类型。
export type MemoryTranslate = (key: string, options?: Record<string, unknown>) => string;

export function memoryBackendSourceKey(source?: MemoryBackendSource): string {
  switch (source) {
    case "explicit":
      return "explicit";
    case "tencentdb":
      return "tencentdb";
    case "chat-history":
      return "chatHistory";
    case "none":
      return "none";
    default:
      return "unknown";
  }
}

export function memoryConfiguredBackendKey(backend: MemoryStatus["configuredBackend"]): string {
  return backend === "tencentdb" ? "tencentdb" : "chatHistory";
}

function formatDebugTime(date: Date) {
  return formatClockTime(date);
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
  run,
  t
}: {
  now?: Date;
  run: MemoryRunSnapshot;
  t: MemoryTranslate;
}): MemoryDebugEvent {
  const sourceLabel = t(`memory.source.${memoryBackendSourceKey(run.memoryBackendSource)}`);
  const recalledCount = run.recalledMemories?.length ?? 0;
  const kind = debugKindForSource(run.memoryBackendSource);
  const summary =
    kind === "skipped"
      ? t("memory.debug.noInject")
      : t("memory.debug.recalled", { count: recalledCount, source: sourceLabel });

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

function sourceMatches(sourceRef: string | undefined, expected: string | undefined, prefix: string) {
  if (!sourceRef || !expected) {
    return false;
  }

  return sourceRef === expected || sourceRef === `${prefix}:${expected}` || sourceRef.startsWith(`${expected}/`);
}

function isVisibleForCharacter(memory: RecalledMemorySnapshot, characterId: string) {
  if (memory.scope === "user" || memory.scope === "project") {
    return true;
  }

  if (memory.scope === "character") {
    return memory.characterId === characterId || sourceMatches(memory.sourceRef, characterId, "character");
  }

  if (memory.scope === "session") {
    return !memory.characterId || memory.characterId === characterId;
  }

  return false;
}

function ownerLabel(memory: RecalledMemorySnapshot, t: MemoryTranslate) {
  if (memory.scope === "user") {
    return t("memory.owner.shared");
  }

  if (memory.scope === "project") {
    return t("memory.owner.project");
  }

  if (memory.characterId) {
    return memoryCharacterLabels[memory.characterId] ?? memory.characterId;
  }

  return memory.scope;
}

export function buildMemoryDashboardViewModel({
  status,
  latestRun,
  debugEvents = [],
  selectedCharacterId = "shili",
  t
}: {
  status: MemoryStatus | null;
  latestRun?: MemoryRunSnapshot | null;
  debugEvents?: MemoryDebugEvent[];
  selectedCharacterId?: string;
  t: MemoryTranslate;
}) {
  const allMemories = latestRun?.recalledMemories ?? [];
  const memories = allMemories.filter((memory) => isVisibleForCharacter(memory, selectedCharacterId));

  return {
    backendLabel: status
      ? t(`memory.backend.${memoryConfiguredBackendKey(status.configuredBackend)}`)
      : t("memory.backend.loading"),
    latestSourceLabel: t(`memory.source.${memoryBackendSourceKey(latestRun?.memoryBackendSource)}`),
    recalledCount: memories.length,
    totalRecalledCount: allMemories.length,
    selectedCharacterId,
    selectedCharacterLabel: memoryCharacterLabels[selectedCharacterId] ?? selectedCharacterId,
    storageRows: status
      ? [
          { label: t("memory.storage.memoryDir"), value: status.memoryDir },
          { label: t("memory.storage.tencentDb"), value: t(status.tencentDbPackageAvailable ? "memory.status.installed" : "memory.status.notFound") },
          { label: t("memory.storage.sqliteVec"), value: t(status.sqliteVecAvailable ? "memory.status.available" : "memory.status.unconfirmed") },
          { label: t("memory.storage.vectorsDb"), value: t(status.vectorsDbExists ? "memory.status.created" : "memory.status.notCreated") }
        ]
      : [],
    memories: memories.map((memory) => ({
      ...memory,
      kindLabel: t(`memory.kind.${memory.kind}`),
      ownerLabel: ownerLabel(memory, t),
      sourceLabel: memory.sourceRef ?? memory.scope
    })),
    debugEvents
  };
}
