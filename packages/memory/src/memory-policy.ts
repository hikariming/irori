import type { MemoryKind } from "./index.ts";

export type MemoryCandidate = {
  kind: MemoryKind;
  text: string;
  inferred?: boolean;
};

export type MemoryPolicyDecision =
  | { action: "allow"; reason: string }
  | { action: "requires_approval"; reason: string }
  | { action: "reject"; reason: string };

const sensitivePatterns = [
  /api\s*key/i,
  /\bsk-[a-z0-9-]{8,}/i,
  /password|token|secret|credential/i,
  /密码|令牌|密钥|凭证|身份证|银行卡|财务账号/,
  /健康诊断|医疗诊断|治疗方案|病历/
];

const autoAllowedKinds = new Set<MemoryKind>([
  "preference",
  "project_note",
  "session_summary"
]);

export function classifyMemoryCandidate(candidate: MemoryCandidate): MemoryPolicyDecision {
  const text = candidate.text.trim();

  if (!text) {
    return {
      action: "reject",
      reason: "空记忆不会被保存。"
    };
  }

  if (sensitivePatterns.some((pattern) => pattern.test(text))) {
    return {
      action: "reject",
      reason: "内容包含敏感信息，不会自动保存。"
    };
  }

  if (candidate.inferred) {
    return {
      action: "requires_approval",
      reason: "这是推断出的记忆，需要用户确认。"
    };
  }

  if (candidate.kind === "relationship_note") {
    return {
      action: "requires_approval",
      reason: "关系互动记忆需要用户确认。"
    };
  }

  if (candidate.kind === "profile_fact") {
    return {
      action: "requires_approval",
      reason: "用户事实需要用户确认。"
    };
  }

  if (autoAllowedKinds.has(candidate.kind)) {
    return {
      action: "allow",
      reason: "非敏感偏好、项目背景或会话摘要可以自动保存。"
    };
  }

  return {
    action: "requires_approval",
    reason: "未知记忆类型需要用户确认。"
  };
}
