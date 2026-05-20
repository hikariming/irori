import { Button, TextArea, Tooltip } from "@heroui/react";
import { useState } from "react";

import { canSendMessage, defaultComposerState } from "./input-model";

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
  onSend?: (draft: string) => Promise<void> | void;
};

export function CompanionInput({ disabled = false, isSending = false, onSend }: CompanionInputProps) {
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
