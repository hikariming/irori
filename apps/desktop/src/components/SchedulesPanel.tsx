import { Avatar, Button } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CharacterCard } from "./character-cards";
import {
  desktopBackend,
  type ScheduledTask,
  type ScheduledTaskRun,
  type ScheduleKind,
  type SaveScheduledTaskRequest,
  type MissedTaskPolicy
} from "./desktop-backend";
import { formatUnknownError } from "./error-message";

type SchedulesPanelProps = {
  isOpen: boolean;
  cards: CharacterCard[];
  onClose: () => void;
  /** 运行历史被标记已读后通知外层刷新红点。 */
  onRunsRead?: () => void;
};

type Draft = {
  title: string;
  characterId: string;
  prompt: string;
  kind: ScheduleKind;
  time: string; // HH:MM，用于 daily / weekdays / weekly
  weekDays: number[]; // 0=周日..6=周六，用于 weekly
  onceAt: string; // datetime-local，用于 once
  cron: string; // 用于 cron
  enabled: boolean;
};

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const KIND_OPTIONS: { value: ScheduleKind; label: string }[] = [
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "once", label: "单次" },
  { value: "cron", label: "Cron" }
];

function emptyDraft(characterId: string): Draft {
  return {
    title: "",
    characterId,
    prompt: "",
    kind: "daily",
    time: "20:00",
    weekDays: [1],
    onceAt: "",
    cron: "0 20 * * *",
    enabled: true
  };
}

// 把 UI 草稿折成后端的 scheduleSpec 字符串。
function buildSpec(draft: Draft): string {
  switch (draft.kind) {
    case "daily":
    case "weekdays":
      return draft.time;
    case "weekly": {
      const days = [...draft.weekDays].sort((a, b) => a - b).join(",");
      return `${days}@${draft.time}`;
    }
    case "once":
      return draft.onceAt;
    case "cron":
      return draft.cron.trim();
    default:
      return draft.time;
  }
}

// 把已存任务的 scheduleSpec 反解回 UI 草稿字段。
function parseTask(task: ScheduledTask): Draft {
  const base = emptyDraft(task.characterId);
  base.title = task.title;
  base.prompt = task.prompt;
  base.kind = task.scheduleKind;
  base.enabled = task.enabled;
  const spec = task.scheduleSpec;
  if (task.scheduleKind === "weekly" && spec.includes("@")) {
    const [days, time] = spec.split("@");
    base.weekDays = days
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
    base.time = time;
  } else if (task.scheduleKind === "once") {
    base.onceAt = spec;
  } else if (task.scheduleKind === "cron") {
    base.cron = spec;
  } else {
    base.time = spec;
  }
  return base;
}

// 结构化校验 cron：5/6/7 段（与后端 normalize_cron 一致），每段为 cron 记号。
// 不做取值范围校验（交后端 cron crate），只挡明显非法串避免静默不触发。
const CRON_FIELD = /^(\*|\?|(\d+)(-\d+)?)(\/\d+)?(,(\*|\?|(\d+)(-\d+)?)(\/\d+)?)*$/;
function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (![5, 6, 7].includes(fields.length)) return false;
  return fields.every((field) => CRON_FIELD.test(field));
}

function draftError(draft: Draft): string | null {
  if (!draft.title.trim()) return "请填写任务名称。";
  if (!draft.characterId) return "请选择执行角色。";
  if (!draft.prompt.trim()) return "请填写要执行的指令。";
  if (draft.kind === "weekly" && draft.weekDays.length === 0) return "请至少选择一个星期几。";
  if (draft.kind === "once") {
    if (!draft.onceAt) return "请选择执行时间。";
    const at = new Date(draft.onceAt).getTime();
    if (!Number.isFinite(at)) return "执行时间格式无效。";
    if (at <= Date.now()) return "执行时间需晚于当前时间。";
  }
  if (draft.kind === "cron") {
    if (!draft.cron.trim()) return "请填写 cron 表达式。";
    if (!isValidCron(draft.cron)) return "cron 表达式格式无效（需 5–7 段，如 0 20 * * *）。";
  }
  return null;
}

function formatRunAt(value: string | null): string {
  if (!value) return "未排程";
  const millis = Number(value);
  if (!Number.isFinite(millis)) return value;
  return new Date(millis).toLocaleString();
}

function describeSchedule(task: ScheduledTask): string {
  switch (task.scheduleKind) {
    case "daily":
      return `每天 ${task.scheduleSpec}`;
    case "weekdays":
      return `工作日 ${task.scheduleSpec}`;
    case "weekly": {
      const [days, time] = task.scheduleSpec.split("@");
      const label = days
        .split(",")
        .map((value) => WEEK_LABELS[Number(value)] ?? value)
        .join("、");
      return `每周${label} ${time ?? ""}`;
    }
    case "once":
      return `单次 ${task.scheduleSpec.replace("T", " ")}`;
    case "cron":
      return `Cron ${task.scheduleSpec}`;
    default:
      return task.scheduleSpec;
  }
}

export function SchedulesPanel({ isOpen, cards, onClose, onRunsRead }: SchedulesPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(cards[0]?.id ?? ""));
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [missedPolicy, setMissedPolicy] = useState<MissedTaskPolicy>("catchup");

  const cardName = useMemo(() => {
    const map = new Map<string, CharacterCard>();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  async function refreshTasks() {
    const loaded = await desktopBackend.listScheduledTasks();
    setTasks(loaded);
    return loaded;
  }

  // 打开面板时加载任务，并把运行历史标记已读（清红点）。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null);
    desktopBackend
      .loadMissedTaskPolicy()
      .then((policy) => {
        if (!cancelled) setMissedPolicy(policy);
      })
      .catch(() => {});
    Promise.all([refreshTasks(), desktopBackend.markTaskRunsRead()])
      .then(([loaded]) => {
        if (cancelled) return;
        setIsCreating(false);
        setSelectedId((current) => current ?? loaded[0]?.id ?? null);
        onRunsRead?.();
      })
      .catch((cause) => {
        if (!cancelled) setError(formatUnknownError(cause, "加载定时任务失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 角色在聊天里自建任务时后端会广播；面板开着就实时刷新列表。
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    desktopBackend
      .onScheduledTaskChanged(() => {
        refreshTasks().catch(() => {});
      })
      .then((next) => {
        if (cancelled) next();
        else unlisten = next;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isOpen]);

  // 当前选中任务的 id，供事件回调读取避免闭包过期。
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // 后台调度器跑完任务也会广播 scheduled_task_run；面板开着就刷新列表（下次/上次
  // 时间）与当前选中任务的运行历史，否则右栏会停留旧数据直到重新选中。
  useEffect(() => {
    if (!isOpen) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    desktopBackend
      .onScheduledTaskRun((event) => {
        refreshTasks().catch(() => {});
        const current = selectedIdRef.current;
        if (current && event.taskId === current) {
          desktopBackend
            .listTaskRuns(current)
            .then((rows) => setRuns(rows))
            .catch(() => {});
        }
      })
      .then((next) => {
        if (cancelled) next();
        else unlisten = next;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isOpen]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [tasks, selectedId]
  );

  // 选中任务时同步草稿 + 拉运行历史。
  useEffect(() => {
    if (isCreating || !selectedTask) return;
    setDraft(parseTask(selectedTask));
    let cancelled = false;
    desktopBackend
      .listTaskRuns(selectedTask.id)
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isCreating, selectedTask]);

  if (!isOpen) return null;

  function startCreate() {
    setIsCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft(cards[0]?.id ?? ""));
    setRuns([]);
    setError(null);
  }

  function selectTask(id: string) {
    setIsCreating(false);
    setSelectedId(id);
    setError(null);
  }

  function toggleWeekDay(day: number, on: boolean) {
    setDraft((current) => {
      const set = new Set(current.weekDays);
      if (on) set.add(day);
      else set.delete(day);
      return { ...current, weekDays: [...set] };
    });
  }

  async function save() {
    if (isBusy) return;
    const validation = draftError(draft);
    if (validation) {
      setError(validation);
      return;
    }
    setIsBusy(true);
    setError(null);
    const request: SaveScheduledTaskRequest = {
      id: isCreating ? undefined : selectedTask?.id,
      characterId: draft.characterId,
      title: draft.title.trim(),
      prompt: draft.prompt.trim(),
      scheduleKind: draft.kind,
      scheduleSpec: buildSpec(draft),
      enabled: draft.enabled
    };
    try {
      const saved = isCreating
        ? await desktopBackend.createScheduledTask(request)
        : await desktopBackend.updateScheduledTask(request);
      await refreshTasks();
      setIsCreating(false);
      setSelectedId(saved.id);
    } catch (cause) {
      setError(formatUnknownError(cause, "保存定时任务失败"));
    } finally {
      setIsBusy(false);
    }
  }

  async function remove() {
    if (isBusy || !selectedTask) return;
    setIsBusy(true);
    setError(null);
    try {
      await desktopBackend.deleteScheduledTask(selectedTask.id);
      const next = await refreshTasks();
      setSelectedId(next[0]?.id ?? null);
      setIsCreating(false);
    } catch (cause) {
      setError(formatUnknownError(cause, "删除定时任务失败"));
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleEnabled(enabled: boolean) {
    if (!selectedTask) return;
    try {
      await desktopBackend.setScheduledTaskEnabled(selectedTask.id, enabled);
      await refreshTasks();
    } catch (cause) {
      setError(formatUnknownError(cause, "更新任务状态失败"));
    }
  }

  async function runNow() {
    if (isBusy || !selectedTask) return;
    setIsBusy(true);
    setError(null);
    try {
      await desktopBackend.runScheduledTaskNow(selectedTask.id);
      const [, refreshed] = await Promise.all([
        refreshTasks(),
        desktopBackend.listTaskRuns(selectedTask.id)
      ]);
      setRuns(refreshed);
      await desktopBackend.markTaskRunsRead(selectedTask.id);
      onRunsRead?.();
    } catch (cause) {
      setError(formatUnknownError(cause, "立即执行失败"));
    } finally {
      setIsBusy(false);
    }
  }

  async function changeMissedPolicy(policy: MissedTaskPolicy) {
    const previous = missedPolicy;
    setMissedPolicy(policy); // 乐观
    try {
      const saved = await desktopBackend.saveMissedTaskPolicy(policy);
      setMissedPolicy(saved);
    } catch (cause) {
      setMissedPolicy(previous);
      setError(formatUnknownError(cause, "保存错过策略失败"));
    }
  }

  const showEditor = isCreating || Boolean(selectedTask);
  const showTimePicker = draft.kind === "daily" || draft.kind === "weekdays" || draft.kind === "weekly";

  return (
    <aside className="system-settings-panel" aria-label="定时任务">
      <div className="settings-page-inner">
        <div className="settings-panel-header">
          <Button aria-label="返回主界面" className="settings-back" onPress={onClose} type="button">
            <span className="settings-back-arrow" aria-hidden="true">←</span>
            返回
          </Button>
          <div className="settings-header-titles">
            <span>定时任务</span>
            <h2>让角色按时帮你做事</h2>
          </div>
          <div className="schedule-missed-policy" role="group" aria-label="错过补跑策略">
            <span className="schedule-missed-policy__label">
              关机时错过的任务
              <small>
                {missedPolicy === "skip"
                  ? "下次开机不补跑，只等下一个时间点"
                  : "下次开机补跑一次"}
              </small>
            </span>
            <div className="schedule-kind-segments">
              <button
                type="button"
                className={`schedule-kind-segment ${missedPolicy === "catchup" ? "is-active" : ""}`}
                onClick={() => changeMissedPolicy("catchup")}
              >
                补跑一次
              </button>
              <button
                type="button"
                className={`schedule-kind-segment ${missedPolicy === "skip" ? "is-active" : ""}`}
                onClick={() => changeMissedPolicy("skip")}
              >
                跳过
              </button>
            </div>
          </div>
        </div>

        <div className="character-card-layout">
          <aside className="character-card-list" role="tablist" aria-label="任务列表">
            {tasks.map((task) => {
              const card = cardName.get(task.characterId);
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`character-card-list-item ${
                    !isCreating && task.id === selectedId ? "is-active" : ""
                  }`}
                  onClick={() => selectTask(task.id)}
                >
                  <Avatar className="schedule-list-avatar">
                    {card?.assets.avatar ? <Avatar.Image alt={card.name} src={card.assets.avatar} /> : null}
                    <Avatar.Fallback>{(card?.name ?? "?").slice(0, 1)}</Avatar.Fallback>
                  </Avatar>
                  <span className="character-card-list-copy">
                    <strong>
                      {task.title}
                      {task.source === "agent" ? <em className="schedule-agent-tag">AI 安排</em> : null}
                      {!task.enabled ? <em className="schedule-paused-tag">已暂停</em> : null}
                    </strong>
                    <small>{describeSchedule(task)} · 下次 {formatRunAt(task.nextRunAt)}</small>
                  </span>
                </button>
              );
            })}
            {tasks.length === 0 ? (
              <p className="skills-empty">还没有定时任务，点下面新建一个。</p>
            ) : null}
            <Button className="skills-new-button" onPress={startCreate} type="button">
              ＋ 新建任务
            </Button>
          </aside>

          <div className="character-card-detail">
            {error ? <p className="skills-error" role="alert">{error}</p> : null}

            {showEditor ? (
              <div className="skills-editor">
                <label className="skills-field">
                  <span>任务名称</span>
                  <input
                    type="text"
                    value={draft.title}
                    placeholder="例如 每晚工作总结"
                    onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
                  />
                </label>

                <label className="skills-field">
                  <span>执行角色</span>
                  <select
                    value={draft.characterId}
                    onChange={(event) => setDraft((d) => ({ ...d, characterId: event.target.value }))}
                  >
                    {cards.length === 0 ? <option value="">（还没有角色）</option> : null}
                    {cards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="skills-field">
                  <span>到点要做什么（指令）</span>
                  <textarea
                    rows={5}
                    value={draft.prompt}
                    placeholder="把今天的聊天和待办梳理成一段晚间总结，并提醒我明天的安排。"
                    onChange={(event) => setDraft((d) => ({ ...d, prompt: event.target.value }))}
                  />
                </label>

                <div className="schedule-field">
                  <span className="schedule-field-label">什么时候执行</span>
                  <div className="schedule-kind-segments" role="tablist" aria-label="调度方式">
                    {KIND_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`schedule-kind-segment ${draft.kind === option.value ? "is-active" : ""}`}
                        onClick={() => setDraft((d) => ({ ...d, kind: option.value }))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {draft.kind === "weekly" ? (
                    <div className="schedule-weekdays" aria-label="选择星期几">
                      {WEEK_LABELS.map((label, day) => (
                        <label
                          key={day}
                          className={`schedule-weekday-chip ${draft.weekDays.includes(day) ? "is-active" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={draft.weekDays.includes(day)}
                            onChange={(event) => toggleWeekDay(day, event.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {showTimePicker ? (
                    <input
                      className="schedule-time-input"
                      type="time"
                      value={draft.time}
                      onChange={(event) => setDraft((d) => ({ ...d, time: event.target.value }))}
                    />
                  ) : null}

                  {draft.kind === "once" ? (
                    <input
                      className="schedule-time-input"
                      type="datetime-local"
                      value={draft.onceAt}
                      onChange={(event) => setDraft((d) => ({ ...d, onceAt: event.target.value }))}
                    />
                  ) : null}

                  {draft.kind === "cron" ? (
                    <label className="skills-field">
                      <input
                        type="text"
                        value={draft.cron}
                        placeholder="0 20 * * *"
                        onChange={(event) => setDraft((d) => ({ ...d, cron: event.target.value }))}
                      />
                      <small>高级：标准 5 段 cron 表达式（分 时 日 月 周），按本地时区触发。</small>
                    </label>
                  ) : null}
                </div>

                <label className="skills-toggle">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft((d) => ({ ...d, enabled: event.target.checked }))}
                  />
                  <span>
                    <strong>启用</strong>
                    <small>关闭后任务保留但不会到点触发。</small>
                  </span>
                </label>

                <div className="skills-actions">
                  <Button className="skills-save-button" isDisabled={isBusy} onPress={save} type="button">
                    {isCreating ? "创建任务" : "保存修改"}
                  </Button>
                  {!isCreating && selectedTask ? (
                    <>
                      <Button className="schedule-run-button" isDisabled={isBusy} onPress={runNow} type="button">
                        立即试跑
                      </Button>
                      <Button
                        className="schedule-pause-button"
                        isDisabled={isBusy}
                        onPress={() => toggleEnabled(!selectedTask.enabled)}
                        type="button"
                      >
                        {selectedTask.enabled ? "暂停" : "恢复"}
                      </Button>
                      <Button className="skills-delete-button" isDisabled={isBusy} onPress={remove} type="button">
                        删除
                      </Button>
                    </>
                  ) : null}
                </div>

                {!isCreating && selectedTask ? (
                  <section className="schedule-runs" aria-label="运行历史">
                    <header>
                      <h4>运行历史</h4>
                      <p>下次触发：{formatRunAt(selectedTask.nextRunAt)}</p>
                    </header>
                    {runs.length === 0 ? <p className="skills-empty">还没有运行记录。</p> : null}
                    {runs.map((run) => (
                      <details className="schedule-run-item" key={run.id}>
                        <summary>
                          <span className={`schedule-run-status schedule-run-status--${run.status}`}>
                            {run.status === "ok" ? "成功" : "失败"}
                          </span>
                          <time>{formatRunAt(run.ranAt)}</time>
                        </summary>
                        <p className="schedule-run-body">{run.error ?? run.result ?? "（无内容）"}</p>
                      </details>
                    ))}
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="skills-intro">
                <h3>定时任务</h3>
                <p>
                  让角色在你设定的时间帮你做事——比如「每晚 8 点把今天的聊天梳理成总结」。到点后角色会自动跑一遍，
                  结果通过系统通知推送，侧边栏也会亮红点。
                </p>
                <Button className="skills-save-button" onPress={startCreate} type="button">
                  ＋ 新建第一个任务
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
