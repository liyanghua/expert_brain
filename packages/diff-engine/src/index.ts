import { diffLines } from "diff";

export function textDiff(before: string, after: string): string {
  const parts = diffLines(before, after);
  return parts
    .map((p) => {
      const prefix = p.added ? "+" : p.removed ? "-" : " ";
      return p.value
        .split("\n")
        .filter((l) => l.length || p.value.includes("\n"))
        .map((l) => `${prefix} ${l}`)
        .join("\n");
    })
    .join("\n");
}

export type FieldChange = {
  field: string;
  before: unknown;
  after: unknown;
};

export function structuredDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    const b = JSON.stringify(before[k]);
    const a = JSON.stringify(after[k]);
    if (b !== a) out.push({ field: k, before: before[k], after: after[k] });
  }
  return out;
}
