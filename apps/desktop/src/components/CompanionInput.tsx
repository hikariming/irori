import { Button, TextArea } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatAttachmentSize } from "./attachment-model";
import type { StagedAttachment } from "./desktop-backend";
import { canSendMessage, defaultComposerState } from "./input-model";
import {
  DEFAULT_REVIEW_MODE,
  reviewModeOption,
  reviewModeOptions,
  type ReviewMode
} from "./review-mode-model";

type CompanionInputProps = {
  disabled?: boolean;
  isSending?: boolean;
  reviewMode?: ReviewMode;
  attachments?: StagedAttachment[];
  isStagingFiles?: boolean;
  onRemoveAttachment?: (id: string) => void;
  onReviewModeChange?: (mode: ReviewMode) => void;
  onSend?: (draft: string) => Promise<void> | void;
};

function AttachmentIcon({ kind }: { kind: StagedAttachment["kind"] }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "image" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="M21 16l-5-5L5 20" />
        </>
      ) : (
        <>
          <path d="M14 3v5h5" />
          <path d="M6 3h8l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        </>
      )}
    </svg>
  );
}

function AttachmentChips({
  attachments,
  isStaging,
  onRemove
}: {
  attachments: StagedAttachment[];
  isStaging: boolean;
  onRemove?: (id: string) => void;
}) {
  const { t } = useTranslation("companion");

  if (attachments.length === 0 && !isStaging) {
    return null;
  }

  return (
    <div className="composer-attachments" aria-label={t("input.attachmentsAria")}>
      {attachments.map((attachment) => (
        <span className="composer-attachment" key={attachment.id} title={`${t(`input.attachmentKind.${attachment.kind}`)} · ${formatAttachmentSize(attachment.size)}`}>
          <AttachmentIcon kind={attachment.kind} />
          <span className="composer-attachment__name">{attachment.name}</span>
          <span className="composer-attachment__size">{formatAttachmentSize(attachment.size)}</span>
          <button
            type="button"
            className="composer-attachment__remove"
            aria-label={t("input.removeAttachment", { name: attachment.name })}
            onClick={() => onRemove?.(attachment.id)}
          >
            ×
          </button>
        </span>
      ))}
      {isStaging ? <span className="composer-attachment is-staging">{t("input.staging")}</span> : null}
    </div>
  );
}

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
  const { t } = useTranslation("companion");
  const [open, setOpen] = useState(false);
  const current = reviewModeOption(reviewMode);

  return (
    <div className="composer-mode">
      <button
        type="button"
        className={`composer-mode-trigger ${current.risky ? "risky" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("input.toolReviewTitle")}
        onClick={() => setOpen((value) => !value)}
      >
        <ReviewModeIcon risky={current.risky} />
        <span>{t(`reviewMode.${current.id}.short`)}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <button className="composer-mode-backdrop" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
          <ul className="composer-mode-menu" role="listbox" aria-label={t("input.reviewMenuAria")}>
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
                    {t(`reviewMode.${option.id}.label`)}
                    {option.risky ? <em>{t("input.risky")}</em> : null}
                  </strong>
                  <small>{t(`reviewMode.${option.id}.description`)}</small>
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
  attachments = [],
  isStagingFiles = false,
  onRemoveAttachment,
  onReviewModeChange,
  onSend
}: CompanionInputProps) {
  const { t } = useTranslation("companion");
  const [draft, setDraft] = useState(defaultComposerState.draft);
  // 有附件时即使没打字也能发：让角色直接处理拖进来的文件。
  const hasAttachments = attachments.length > 0;
  const isSendable = canSendMessage({ draft, disabled }) || (!disabled && hasAttachments);

  async function sendMessage() {
    if (!isSendable) {
      return;
    }

    const message = draft;
    setDraft("");
    await onSend?.(message);
  }

  return (
    <section className="companion-input-shell" aria-label={t("input.shellAria")}>
      <div className="composer-card">
        <AttachmentChips attachments={attachments} isStaging={isStagingFiles} onRemove={onRemoveAttachment} />
        <TextArea
          aria-label={t("input.messageAria")}
          className="composer-textarea"
          disabled={disabled}
          maxLength={1200}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            disabled
              ? t("input.placeholderDisabled")
              : hasAttachments
                ? t("input.placeholderAttachments")
                : t("input.placeholderDefault")
          }
          value={draft}
        />

        <div className="composer-footer">
          <div className="composer-tools" aria-label={t("input.toolsAria")}>
            <ReviewModeSelector reviewMode={reviewMode} onReviewModeChange={onReviewModeChange} />
          </div>

          <div className="composer-send-area">
            <span>{draft.trim().length}/1200</span>
            <Button
              className="composer-send-button"
              isDisabled={!isSendable}
              onPress={sendMessage}
              type="button"
            >
              {isSending ? t("input.sending") : t("input.send")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
