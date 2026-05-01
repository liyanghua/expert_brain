import type { DocumentStatus } from "./schema.js";

const transitions: Record<DocumentStatus, DocumentStatus[]> = {
  Draft: ["Extracted"],
  Extracted: ["Under Review", "Draft"],
  "Under Review": ["Revised", "Extracted"],
  Revised: ["Under Review", "Approved"],
  Approved: ["Published", "Revised"],
  Published: [],
};

export function canTransitionStatus(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: DocumentStatus,
  to: DocumentStatus,
): void {
  if (!canTransitionStatus(from, to)) {
    throw new Error(`Invalid status transition: ${from} -> ${to}`);
  }
}
