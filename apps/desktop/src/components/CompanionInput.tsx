import { Button, TextArea, Tooltip } from "@heroui/react";
import { useState } from "react";

import { canSendMessage, defaultComposerState } from "./input-model";
import {
  DEFAULT_REVIEW_MODE,
  reviewModeOption,
  reviewModeOptions,
  type ReviewMode
} from "./review-mode-model";

type ToolAction = {
  id: string;
  label: string;
  icon: string;
};

const toolActions: ToolAction[] = [
  { id: "attach", label: "添加上下文", icon: "+" },
  { id: "voice", label: "语音输入", icon: "⌁" },
  { id: "prompt", label: "提示模板", icon: "/" }
];

type CompanionInputProps = {
  disabled?: boolean;
  isSending?: boolean;
  reviewMode?: ReviewMode;
  onReviewModeChange?: (mode: ReviewMode) => void;
  onSend?: (draft: string) => Promise<void> | void;
};

function ReviewModeIcon({ risky }: { risky: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.6C8 19.4 5 15.4 5 11V6z" />
      {risky ? <path d="M12 8v4M12 15.5h.01" /> : <path d="M9 12l2 2 4-4" />}
    </svg>
  );
}

function ReviewModeSelector({
  reviewMode,
  onReviewModeChange
}: {
  reviewMode: ReviewMode;
  onReviewModeChange?: (mode: ReviewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = reviewModeOption(reviewMode);

  return (
    <div className="composer-mode">
      <button
        type="button"
        className={`composer-mode-trigger ${current.risky ? "risky" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="工具审核模式"
        onClick={() => setOpen((value) => !value)}
      >
        <ReviewModeIcon risky={current.risky} />
        <span>{current.short}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <button className="composer-mode-backdrop" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
          <ul className="composer-mode-menu" role="listbox" aria-label="工具审核模式">
            {reviewModeOptions.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === reviewMode}
                  className={`composer-mode-option ${option.id === reviewMode ? "active" : ""} ${option.risky ? "risky" : ""}`}
                  onClick={() => {
                    onReviewModeChange?.(option.id);
                    setOpen(false);
                  }}
                >
                  <strong>
                    {option.label}
                    {option.risky ? <em>有风险</em> : null}
                  </strong>
                  <small>{option.description}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function CompanionInput({
  disabled = false,
  isSending = false,
  reviewMode = DEFAULT_REVIEW_MODE,
  onReviewModeChange,
  onSend
}: CompanionInputProps) {
  const [draft, setDraft] = useState(defaultComposerState.draft);
  const isSendable = canSendMessage({ draft, disabled });

  async function sendMessage() {
    if (!isSendable) {
      return;
    }

    const message = draft;
    setDraft("");
    await onSend?.(message);
  }

  return (
    <section className="companion-input-shell" aria-label="消息输入">
      <div className="composer-card">
        <TextArea
          aria-label="输入给角色的消息"
          className="composer-textarea"
          disabled={disabled}
          maxLength={1200}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={disabled ? "先在系统设置里配置模型供应商..." : "跟示璃说点什么，或者丢一个任务让 ta 陪你拆..."}
          value={draft}
        />

        <div className="composer-footer">
          <div className="composer-tools" aria-label="输入工具">
            <ReviewModeSelector reviewMode={reviewMode} onReviewModeChange={onReviewModeChange} />
            {toolActions.map((action) => (
              <Tooltip key={action.id}>
                <Tooltip.Trigger>
                  <Button aria-label={action.label} className="composer-tool-button" type="button">
                    {action.icon}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>{action.label}</Tooltip.Content>
              </Tooltip>
            ))}
          </div>

          <div className="composer-send-area">
            <span>{draft.trim().length}/1200</span>
            <Button
              className="composer-send-button"
              isDisabled={!isSendable}
              onPress={sendMessage}
              type="button"
            >
              {isSending ? "发送中" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
