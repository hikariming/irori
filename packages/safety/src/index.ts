export type CompanionMode = "companion" | "read" | "action" | "focus";

export type SafetyPolicy = {
  mode: CompanionMode;
  allowedTools: string[];
  protectedPaths: string[];
  alwaysConfirm: string[];
};
