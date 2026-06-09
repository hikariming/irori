import { Avatar, Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";

import type { CharacterCard } from "./character-cards";
import { desktopBackend, type SkillRecord } from "./desktop-backend";
import { formatUnknownError } from "./error-message";
import { skillTemplates, type SkillTemplate } from "./skill-templates";
import { skillToolOptions } from "./skill-tools";

type SkillsPanelProps = {
  isOpen: boolean;
  cards: CharacterCard[];
  onClose: () => void;
};

type Draft = {
  name: string;
  description: string;
  body: string;
  disableModelInvocation: boolean;
  allowedTools: string[];
};

const emptyDraft: Draft = {
  name: "",
  description: "",
  body: "",
  disableModelInvocation: false,
  allowedTools: []
};

// 与 Rust 端 is_valid_skill_name 对齐：1-64 字、全小写 a-z0-9-、不能首尾/连续连字符。
function skillNameError(name: string): string | null {
  if (!name) return "请填写技能标识。";
  if (name.length > 64) return "技能标识不能超过 64 个字符。";
  if (name.startsWith("-") || name.endsWith("-")) return "技能标识不能以连字符开头或结尾。";
  if (name.includes("--")) return "技能标识不能包含连续连字符。";
  if (!/^[a-z0-9-]+$/.test(name)) return "技能标识只能用小写字母、数字和连字符。";
  return null;
}

export function SkillsPanel({ isOpen, cards, onClose }: SkillsPanelProps) {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // 打开面板时加载技能库，并默认选中第一个。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null);
    desktopBackend
      .listSkills()
      .then((loaded) => {
        if (cancelled) return;
        setSkills(loaded);
        setIsCreating(false);
        setSelectedName((current) => current ?? loaded[0]?.name ?? null);
      })
      .catch((cause) => {
        if (!cancelled) setError(formatUnknownError(cause, "加载技能失败"));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.name === selectedName) ?? null,
    [skills, selectedName]
  );

  // 选中某个技能时，同步草稿 + 拉取它的角色映射。
  useEffect(() => {
    if (isCreating || !selectedSkill) return;
    setDraft({
      name: selectedSkill.name,
      description: selectedSkill.description,
      body: selectedSkill.body,
      disableModelInvocation: selectedSkill.disableModelInvocation,
      allowedTools: selectedSkill.allowedTools
    });
    let cancelled = false;
    desktopBackend
      .listSkillAssignments(selectedSkill.name)
      .then((rows) => {
        if (cancelled) return;
        setAssignedIds(new Set(rows.filter((row) => row.enabled).map((row) => row.characterId)));
      })
      .catch(() => {
        if (!cancelled) setAssignedIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [isCreating, selectedSkill]);

  // 新建时实时校验：先查格式，再查重名，提交前就拦下。所有 Hook 必须在任何
  // 条件式 return 之前调用，否则面板关闭时 Hook 数量会变（Rules of Hooks）。
  const nameError = useMemo(() => {
    if (!isCreating) return null;
    const formatError = skillNameError(draft.name);
    if (formatError) return formatError;
    if (skills.some((skill) => skill.name === draft.name)) return "已存在同名技能。";
    return null;
  }, [isCreating, draft.name, skills]);

  if (!isOpen) return null;

  function startCreate() {
    setIsCreating(true);
    setSelectedName(null);
    setDraft(emptyDraft);
    setAssignedIds(new Set());
    setError(null);
  }

  function selectSkill(name: string) {
    setIsCreating(false);
    setSelectedName(name);
    setError(null);
  }

  function applyTemplate(template: SkillTemplate) {
    // 已有同名技能时帮用户避开冲突，其余字段照填。
    const taken = skills.some((skill) => skill.name === template.name);
    setDraft({
      name: taken ? "" : template.name,
      description: template.description,
      body: template.body,
      disableModelInvocation: false,
      allowedTools: []
    });
  }

  function toggleTool(toolId: string, on: boolean) {
    setDraft((current) => {
      const set = new Set(current.allowedTools);
      if (on) set.add(toolId);
      else set.delete(toolId);
      return { ...current, allowedTools: [...set] };
    });
  }

  async function save() {
    if (isBusy) return;
    if (isCreating && nameError) {
      setError(nameError);
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const saved = isCreating
        ? await desktopBackend.createSkill(draft)
        : await desktopBackend.updateSkill(draft);
      const next = await desktopBackend.listSkills();
      setSkills(next);
      setIsCreating(false);
      setSelectedName(saved.name);
    } catch (cause) {
      setError(formatUnknownError(cause, "保存技能失败"));
    } finally {
      setIsBusy(false);
    }
  }

  async function remove() {
    if (isBusy || !selectedSkill) return;
    setIsBusy(true);
    setError(null);
    try {
      await desktopBackend.deleteSkill(selectedSkill.name);
      const next = await desktopBackend.listSkills();
      setSkills(next);
      setSelectedName(next[0]?.name ?? null);
      setIsCreating(false);
    } catch (cause) {
      setError(formatUnknownError(cause, "删除技能失败"));
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleAssignment(characterId: string, enabled: boolean) {
    if (!selectedSkill) return;
    // 乐观更新，失败再回滚。
    setAssignedIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(characterId);
      else next.delete(characterId);
      return next;
    });
    try {
      await desktopBackend.setCharacterSkill(characterId, selectedSkill.name, enabled);
    } catch (cause) {
      setError(formatUnknownError(cause, "更新角色技能失败"));
      setAssignedIds((current) => {
        const next = new Set(current);
        if (enabled) next.delete(characterId);
        else next.add(characterId);
        return next;
      });
    }
  }

  const showEditor = isCreating || Boolean(selectedSkill);

  return (
    <aside className="system-settings-panel" aria-label="技能管理">
      <div className="settings-page-inner">
        <div className="settings-panel-header">
          <Button aria-label="返回主界面" className="settings-back" onPress={onClose} type="button">
            <span className="settings-back-arrow" aria-hidden="true">←</span>
            返回
          </Button>
          <div className="settings-header-titles">
            <span>技能管理</span>
            <h2>技能库与角色配置</h2>
          </div>
        </div>

        <div className="character-card-layout">
          <aside className="character-card-list" role="tablist" aria-label="技能列表">
            {skills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className={`character-card-list-item ${
                  !isCreating && skill.name === selectedName ? "is-active" : ""
                }`}
                onClick={() => selectSkill(skill.name)}
              >
                <span className="character-card-list-copy">
                  <strong>{skill.name}</strong>
                  <small>{skill.description || "（未填写描述）"}</small>
                </span>
              </button>
            ))}
            {skills.length === 0 ? (
              <p className="skills-empty">还没有技能，点下面新建一个。</p>
            ) : null}
            <Button className="skills-new-button" onPress={startCreate} type="button">
              ＋ 新建技能
            </Button>
          </aside>

          <div className="character-card-detail">
            {error ? <p className="skills-error" role="alert">{error}</p> : null}

            {showEditor ? (
              <div className="skills-editor">
                {isCreating ? (
                  <div className="skills-templates">
                    <span className="skills-templates-label">从模板开始</span>
                    <div className="skills-templates-chips">
                      {skillTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className="skills-template-chip"
                          onClick={() => applyTemplate(template)}
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <label className="skills-field">
                  <span>技能标识</span>
                  <input
                    type="text"
                    value={draft.name}
                    readOnly={!isCreating}
                    placeholder="例如 tarot-reading"
                    onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value.trim() }))}
                  />
                  <small>
                    {isCreating
                      ? "小写字母 / 数字 / 连字符，创建后作为目录名，不可改。"
                      : "标识创建后固定不变。"}
                  </small>
                  {nameError ? <em className="skills-field-error">{nameError}</em> : null}
                </label>

                <label className="skills-field">
                  <span>描述（模型据此判断何时使用）</span>
                  <input
                    type="text"
                    value={draft.description}
                    maxLength={1024}
                    placeholder="当用户想算塔罗 / 求指引时使用…"
                    onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
                  />
                </label>

                <label className="skills-field">
                  <span>技能内容（SKILL.md 正文：方法论 / 步骤）</span>
                  <textarea
                    rows={10}
                    value={draft.body}
                    placeholder="# 塔罗解读&#10;抽牌、牌阵、解读口吻…"
                    onChange={(event) => setDraft((d) => ({ ...d, body: event.target.value }))}
                  />
                </label>

                <label className="skills-toggle">
                  <input
                    type="checkbox"
                    checked={draft.disableModelInvocation}
                    onChange={(event) =>
                      setDraft((d) => ({ ...d, disableModelInvocation: event.target.checked }))
                    }
                  />
                  <span>
                    <strong>仅手动触发</strong>
                    <small>勾选后不写入系统提示，只能用 /skill:{draft.name || "name"} 显式调用。</small>
                  </span>
                </label>

                <section className="skills-tools" aria-label="技能可用的工具">
                  <div className="skills-tools-head">
                    <strong>需要的工具</strong>
                    <small>勾选后，会这个技能的角色对话时会按需放开这些能力（仍走工具审核）。</small>
                  </div>
                  <div className="skills-tools-grid">
                    {skillToolOptions.map((tool) => (
                      <label className="skills-tool-row" key={tool.id}>
                        <input
                          type="checkbox"
                          checked={draft.allowedTools.includes(tool.id)}
                          onChange={(event) => toggleTool(tool.id, event.target.checked)}
                        />
                        <span>
                          <strong>{tool.label}</strong>
                          <small>{tool.hint}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>

                <div className="skills-actions">
                  <Button
                    className="skills-save-button"
                    isDisabled={isBusy || (isCreating && Boolean(nameError))}
                    onPress={save}
                    type="button"
                  >
                    {isCreating ? "创建技能" : "保存修改"}
                  </Button>
                  {!isCreating && selectedSkill ? (
                    <Button className="skills-delete-button" isDisabled={isBusy} onPress={remove} type="button">
                      删除
                    </Button>
                  ) : null}
                </div>

                {!isCreating && selectedSkill ? (
                  <section className="skills-assign">
                    <header>
                      <h4>哪些角色会这个技能</h4>
                      <p>勾选后，该角色对话时会带上这个技能（其它角色看不到）。</p>
                    </header>
                    {cards.length === 0 ? <p className="skills-empty">还没有角色。</p> : null}
                    {cards.map((card) => (
                      <label className="skills-assign-row" key={card.id}>
                        <Avatar className="skills-assign-avatar">
                          {card.assets.avatar ? (
                            <Avatar.Image alt={card.name} src={card.assets.avatar} />
                          ) : null}
                          <Avatar.Fallback>{card.name.slice(0, 1)}</Avatar.Fallback>
                        </Avatar>
                        <span>{card.name}</span>
                        <input
                          type="checkbox"
                          checked={assignedIds.has(card.id)}
                          onChange={(event) => toggleAssignment(card.id, event.target.checked)}
                        />
                      </label>
                    ))}
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="skills-intro">
                <h3>什么是技能</h3>
                <p>
                  技能是一段「方法论」，描述角色在特定场景该怎么做（比如算塔罗、解梦、写诗）。
                  你可以把同一个技能分配给多个角色，没分配到的角色就不会、也不会看到它。
                </p>
                <Button className="skills-save-button" onPress={startCreate} type="button">
                  ＋ 新建第一个技能
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
