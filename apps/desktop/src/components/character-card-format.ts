// 角色 id 约束与 Rust 侧 is_valid_character_id 一致：小写 a-z0-9-、不首尾/连续连字符、<=64。
// 单独成文件，避免把 Tauri 依赖（convertFileSrc）带进只做校验的地方。
export function isValidCharacterId(id: string): boolean {
  if (!id || id.length > 64) {
    return false;
  }
  if (id.startsWith("-") || id.endsWith("-") || id.includes("--")) {
    return false;
  }
  return /^[a-z0-9-]+$/.test(id);
}
