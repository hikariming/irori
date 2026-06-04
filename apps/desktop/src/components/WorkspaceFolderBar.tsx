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
  return (
    <div className="workspace-folder-bar" aria-label="当前对话工作文件夹">
      <FolderIcon />
      <span className="workspace-folder-label">工作文件夹</span>
      <span className="workspace-folder-path" title={path || "未设置"}>
        {path || "未设置"}
      </span>
      <button
        type="button"
        className="workspace-folder-change"
        onClick={onChangeFolder}
        disabled={isPicking}
      >
        {isPicking ? "选择中…" : "更改"}
      </button>
    </div>
  );
}
