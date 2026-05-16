export type MemoryKind = "profile_fact" | "preference" | "relationship_note" | "project_note" | "session_summary";

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceSessionId?: string;
  frozen: boolean;
  createdAt: string;
  updatedAt: string;
};
