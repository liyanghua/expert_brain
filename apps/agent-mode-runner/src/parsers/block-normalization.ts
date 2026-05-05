export function isIgnorableBlockText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(normalized)) return true;
  return /^[\s\-_*—–·•.。,:：;；|/\\]+$/.test(normalized) && normalized.length <= 12;
}
