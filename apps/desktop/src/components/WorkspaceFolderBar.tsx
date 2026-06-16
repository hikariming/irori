import { useTranslation } from "react-i18next";

type WorkspaceFolderBarProps = {
  path: string;
  isPicking?: boolean;
  onChangeFolder: () => void;
};

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function WorkspaceFolderBar({ path, isPicking = false, onChangeFolder }: WorkspaceFolderBarProps) {
  const { t } = useTranslation("workspace");
  const unsetLabel = t("folderBar.unset");
  return (
    <div className="workspace-folder-bar" aria-label={t("folderBar.aria")}>
      <FolderIcon />
      <span className="workspace-folder-label">{t("folderBar.label")}</span>
      <span className="workspace-folder-path" title={path || unsetLabel}>
        {path || unsetLabel}
      </span>
      <button
        type="button"
        className="workspace-folder-change"
        onClick={onChangeFolder}
        disabled={isPicking}
      >
        {isPicking ? t("folderBar.picking") : t("folderBar.change")}
      </button>
    </div>
  );
}
