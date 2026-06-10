export type CharacterPreference = {
  enabled: boolean;
  showInSidebar: boolean;
};

export type CharacterPreferences = Record<string, CharacterPreference>;

export const STORAGE_KEY = "irori-character-preferences";

export const defaultCharacterPreference: CharacterPreference = {
  enabled: true,
  showInSidebar: true
};

export function getCharacterPreference(
  preferences: CharacterPreferences,
  characterId: string
): CharacterPreference {
  return { ...defaultCharacterPreference, ...preferences[characterId] };
}

export function setCharacterPreference(
  preferences: CharacterPreferences,
  characterId: string,
  patch: Partial<CharacterPreference>
): CharacterPreferences {
  const next = { ...getCharacterPreference(preferences, characterId), ...patch };
  return { ...preferences, [characterId]: next };
}

// A character only appears in the sidebar when it is enabled AND opted into the
// sidebar; showInSidebar is kept independently so re-enabling restores the prior choice.
export function isCharacterVisibleInSidebar(
  preferences: CharacterPreferences,
  characterId: string
): boolean {
  const pref = getCharacterPreference(preferences, characterId);
  return pref.enabled && pref.showInSidebar;
}

export function sanitizeCharacterPreferences(value: unknown): CharacterPreferences {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: CharacterPreferences = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    result[id] = {
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : defaultCharacterPreference.enabled,
      showInSidebar:
        typeof entry.showInSidebar === "boolean" ? entry.showInSidebar : defaultCharacterPreference.showInSidebar
    };
  }
  return result;
}

export function loadCharacterPreferences(): CharacterPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeCharacterPreferences(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveCharacterPreferences(preferences: CharacterPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // localStorage may be unavailable in some environments.
  }
}
