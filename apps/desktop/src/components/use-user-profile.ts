import { useCallback, useState } from "react";

import { loadUserProfile, saveUserProfile, type UserProfile } from "./user-profile";

// 「我」档案的读写：初始从 localStorage 读，改动即时落盘。
export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfile((current) => {
      const next = { ...current, ...patch };
      saveUserProfile(next);
      return next;
    });
  }, []);

  return { profile, updateProfile } as const;
}
