export type CompanionSession = {
  id: string;
  characterId: string;
  workspacePath?: string;
  mode: "companion" | "read" | "action" | "focus";
  createdAt: string;
};
