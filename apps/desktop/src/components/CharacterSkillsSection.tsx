import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { desktopBackend, type SkillRecord } from "./desktop-backend";
import { formatUnknownError } from "./error-message";

type CharacterSkillsSectionProps = {
  characterId: string;
  characterName: string;
};

// 角色视角的技能配置：列出全部技能，勾选这个角色会哪些。与「技能」面板里的
// 「哪些角色会这个技能」是同一张映射表的两个视角。
export function CharacterSkillsSection({ characterId, characterName }: CharacterSkillsSectionProps) {
  const { t } = useTranslation("skills");
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    Promise.all([desktopBackend.listSkills(), desktopBackend.listCharacterSkills(characterId)])
      .then(([all, mine]) => {
        if (cancelled) return;
        setSkills(all);
        setEnabled(new Set(mine));
        setError(null);
      })
      .catch((cause) => {
        if (!cancelled) setError(formatUnknownError(cause, t("errors.load")));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  async function toggle(name: string, on: boolean) {
    setEnabled((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
    try {
      await desktopBackend.setCharacterSkill(characterId, name, on);
    } catch (cause) {
      setError(formatUnknownError(cause, t("errors.assign")));
      setEnabled((current) => {
        const next = new Set(current);
        if (on) next.delete(name);
        else next.add(name);
        return next;
      });
    }
  }

  return (
    <section className="character-skills-section" aria-label={t("sectionAria", { name: characterName })}>
      <div className="character-skills-head">
        <h4>{t("sectionTitle")}</h4>
        <p>{t("sectionHint", { name: characterName })}</p>
      </div>
      {error ? <p className="skills-error" role="alert">{error}</p> : null}
      {loaded && skills.length === 0 ? (
        <p className="skills-empty">{t("sectionEmpty")}</p>
      ) : null}
      <div className="character-skills-list">
        {skills.map((skill) => (
          <label className="character-skill-row" key={skill.name}>
            <span className="character-skill-copy">
              <strong>{skill.name}</strong>
              <small>{skill.description || t("noDescription")}</small>
              {skill.allowedTools.length > 0 ? (
                <span className="character-skill-tools">
                  {skill.allowedTools.map((tool) => (
                    <span className="character-skill-tool-badge" key={tool}>
                      {t(`tool.${tool}.label`, { defaultValue: tool })}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <input
              type="checkbox"
              checked={enabled.has(skill.name)}
              onChange={(event) => toggle(skill.name, event.target.checked)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
