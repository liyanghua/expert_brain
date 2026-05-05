import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadKeyConfigMarkdown(repoRoot: string): void {
  const path = join(repoRoot, "key_config.md");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const normalized = line.trim();
    if (!normalized || normalized.startsWith("#")) continue;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    const value = normalized.slice(eq + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}
