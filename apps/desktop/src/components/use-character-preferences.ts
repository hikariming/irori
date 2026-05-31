import { useCallback, useState } from "react";

import {
  loadCharacterPreferences,
  saveCharacterPreferences,
  setCharacterPreference,
  type CharacterPreference,
  type CharacterPreferences
} from "./character-preferences";

export function useCharacterPreferences() {
  const [preferences, setPreferences] = useState<CharacterPreferences>(() => loadCharacterPreferences());

  const updatePreference = useCallback((characterId: string, patch: Partial<CharacterPreference>) => {
    setPreferences((current) => {
      const next = setCharacterPreference(current, characterId, patch);
      saveCharacterPreferences(next);
      return next;
    });
  }, []);

  return { preferences, updatePreference } as const;
}
