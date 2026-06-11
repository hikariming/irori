import { Avatar, Button } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
// 返回 skills:validation.* 的 key，文案在组件里用 t() 渲染。
function skillNameErrorKey(name: string): string | null {
  if (!name) return "required";
  if (name.length > 64) return "tooLong";
  if (name.startsWith("-") || name.endsWith("-")) return "dashEnds";
  if (name.includes("--")) return "doubleDash";
  if (!/^[a-z0-9-]+$/.test(name)) return "charset";
  return null;
}

export function SkillsPanel({ isOpen, cards, onClose }: SkillsPanelProps) {
  const { t } = useTranslation(["skills", "common"]);
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
        if (!cancelled) setError(formatUnknownError(cause, t("errors.load")));
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
    const formatKey = skillNameErrorKey(draft.name);
    if (formatKey) return t(`validation.${formatKey}`);
    if (skills.some((skill) => skill.name === draft.name)) return t("validation.duplicate");
    return null;
  }, [isCreating, draft.name, skills, t]);

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
      setError(formatUnknownError(cause, t("errors.save")));
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
      setError(formatUnknownError(cause, t("errors.delete")));
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
      setError(formatUnknownError(cause, t("errors.assign")));
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
    <aside className="system-settings-panel" aria-label={t("panelAria")}>
      <div className="settings-page-inner">
        <div className="settings-panel-header">
          <Button aria-label={t("common:nav.backToMain")} className="settings-back" onPress={onClose} type="button">
            <span className="settings-back-arrow" aria-hidden="true">←</span>
            {t("common:nav.back")}
          </Button>
          <div className="settings-header-titles">
            <span>{t("eyebrow")}</span>
            <h2>{t("title")}</h2>
          </div>
        </div>

        <div className="character-card-layout">
          <aside className="character-card-list" role="tablist" aria-label={t("listAria")}>
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
                  <small>{skill.description || t("noDescription")}</small>
                </span>
              </button>
            ))}
            {skills.length === 0 ? (
              <p className="skills-empty">{t("emptyList")}</p>
            ) : null}
            <Button className="skills-new-button" onPress={startCreate} type="button">
              {t("newSkill")}
            </Button>
          </aside>

          <div className="character-card-detail">
            {error ? <p className="skills-error" role="alert">{error}</p> : null}

            {showEditor ? (
              <div className="skills-editor">
                {isCreating ? (
                  <div className="skills-templates">
                    <span className="skills-templates-label">{t("fromTemplate")}</span>
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
                  <span>{t("nameLabel")}</span>
                  <input
                    type="text"
                    value={draft.name}
                    readOnly={!isCreating}
                    placeholder={t("namePlaceholder")}
                    onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value.trim() }))}
                  />
                  <small>
                    {isCreating ? t("nameHintCreating") : t("nameHintFixed")}
                  </small>
                  {nameError ? <em className="skills-field-error">{nameError}</em> : null}
                </label>

                <label className="skills-field">
                  <span>{t("descLabel")}</span>
                  <input
                    type="text"
                    value={draft.description}
                    maxLength={1024}
                    placeholder={t("descPlaceholder")}
                    onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
                  />
                </label>

                <label className="skills-field">
                  <span>{t("bodyLabel")}</span>
                  <textarea
                    rows={10}
                    value={draft.body}
                    placeholder={t("bodyPlaceholder")}
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
                    <strong>{t("manualOnly")}</strong>
                    <small>{t("manualOnlyHint", { name: draft.name || "name" })}</small>
                  </span>
                </label>

                <section className="skills-tools" aria-label={t("toolsAria")}>
                  <div className="skills-tools-head">
                    <strong>{t("toolsNeeded")}</strong>
                    <small>{t("toolsHint")}</small>
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
                          <strong>{t(`tool.${tool.id}.label`)}</strong>
                          <small>{t(`tool.${tool.id}.hint`)}</small>
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
                    {isCreating ? t("create") : t("saveChanges")}
                  </Button>
                  {!isCreating && selectedSkill ? (
                    <Button className="skills-delete-button" isDisabled={isBusy} onPress={remove} type="button">
                      {t("delete")}
                    </Button>
                  ) : null}
                </div>

                {!isCreating && selectedSkill ? (
                  <section className="skills-assign">
                    <header>
                      <h4>{t("assignTitle")}</h4>
                      <p>{t("assignHint")}</p>
                    </header>
                    {cards.length === 0 ? <p className="skills-empty">{t("noCharacters")}</p> : null}
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
                <h3>{t("introTitle")}</h3>
                <p>{t("introBody")}</p>
                <Button className="skills-save-button" onPress={startCreate} type="button">
                  {t("createFirst")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
