import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads `KEY=value` lines from repo-root `key_config.md` into `process.env` when unset.
 * For DeepSeek structuring, add e.g. `EBS_LLM_PROVIDER=deepseek` and `EBS_LLM_STRUCTURING=1`.
 */
export function loadKeyConfigMarkdown(repoRoot: string): void {
  const p = join(repoRoot, "key_config.md");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = val;
  }
}
