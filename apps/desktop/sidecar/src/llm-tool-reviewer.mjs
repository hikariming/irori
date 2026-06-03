import { normalizeOpenAiCompatibleSettings } from "./model-provider-resolver.mjs";

/**
 * Classify a model's verdict text. Pure and forgiving: tries JSON
 * ({ decision: "approve" | "reject", reason }) first, then scans for an
 * approve/allow vs reject/deny/block keyword.
 *
 * Returns { decision: "approve" | "reject" | "unknown", reason }. "unknown"
 * means the model gave no clear verdict — the caller turns that (and any
 * network failure) into a fallback to manual review, never a silent approve.
 */
export function classifyReviewDecision(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) {
    return { decision: "unknown", reason: "" };
  }

  try {
    const parsed = JSON.parse(raw);
    const decision = typeof parsed?.decision === "string" ? parsed.decision.toLowerCase() : "";
    const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
    if (decision === "approve" || decision === "allow") {
      return { decision: "approve", reason };
    }
    if (decision === "reject" || decision === "deny" || decision === "block") {
      return { decision: "reject", reason };
    }
  } catch {
    // Not JSON — fall through to keyword scan.
  }

  const lower = raw.toLowerCase();
  const approve = /\b(approve|approved|allow|allowed)\b/.test(lower);
  const reject = /\b(reject|rejected|deny|denied|block|blocked|unsafe)\b/.test(lower);

  if (approve && !reject) {
    return { decision: "approve", reason: "" };
  }
  if (reject && !approve) {
    return { decision: "reject", reason: "" };
  }
  return { decision: "unknown", reason: "" };
}

const SYSTEM_PROMPT = [
  "你是一个 AI 陪伴助手的「操作安全审查员」。助手想执行一次工具调用（改文件、跑命令、写记忆、操作浏览器等），",
  "你要替用户判断这次操作是否安全、是否符合用户意图，决定放行还是拒绝。",
  "放行（approve）：读取/搜索、对工作区内文件的常规可逆改动、明显无害的命令。",
  "拒绝（reject）：删除或覆盖重要数据（如 rm -rf、dd、mkfs）、读写凭证/密钥、越权访问工作区外的隐私路径、",
  "外发数据、关机重启等高风险或意图不明的操作。",
  '只回一个 JSON：{"decision":"approve"|"reject","reason":"一句话理由"}，不要多余文字。'
].join("\n");

function buildReviewMessages({ toolName, input, reason }) {
  const payload = {
    tool: toolName,
    reason: reason ?? "",
    input: input ?? {}
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `请审查这次工具调用：\n${JSON.stringify(payload)}` }
  ];
}

/**
 * Build a reviewer that asks the configured model to approve/reject each gated
 * tool call — the "大模型审查" autonomy mode.
 *
 * Returns async ({ toolName, input, reason }) => { decision, reason } where
 * decision is "approve" | "reject" | "fallback". A "fallback" (model
 * unreachable, timeout, error status, or no clear verdict) tells the caller to
 * hand the decision back to the user for manual review, carrying `reason` so
 * the UI can explain why the LLM didn't decide. The model never silently
 * approves on failure.
 *
 * fetchImpl / timeoutMs are injectable for tests.
 */
export function createLlmToolReviewer({
  modelSettings,
  runtimeToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000
} = {}) {
  const normalized = normalizeOpenAiCompatibleSettings(modelSettings);

  return async function reviewToolCall({ toolName, input, reason }) {
    if (typeof fetchImpl !== "function" || !normalized.baseUrl || !normalized.modelName) {
      return { decision: "fallback", reason: "大模型未配置或不可用" };
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(`${normalized.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(runtimeToken ? { authorization: `Bearer ${runtimeToken}` } : {})
        },
        body: JSON.stringify({
          model: normalized.modelName,
          messages: buildReviewMessages({ toolName, input, reason }),
          temperature: 0,
          max_tokens: 200,
          stream: false
        }),
        signal: controller?.signal
      });

      if (!response || typeof response.json !== "function") {
        return { decision: "fallback", reason: "大模型响应无效" };
      }
      if (response.ok === false) {
        return { decision: "fallback", reason: `大模型返回状态 ${response.status ?? "错误"}` };
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      const verdict = classifyReviewDecision(typeof content === "string" ? content : "");

      if (verdict.decision === "approve") {
        return { decision: "approve", reason: verdict.reason || "大模型判定安全" };
      }
      if (verdict.decision === "reject") {
        return { decision: "reject", reason: verdict.reason || "大模型判定有风险" };
      }
      return { decision: "fallback", reason: "大模型未给出明确结论" };
    } catch (error) {
      const aborted = error?.name === "AbortError";
      return { decision: "fallback", reason: aborted ? "大模型审查超时" : "无法连接大模型" };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
