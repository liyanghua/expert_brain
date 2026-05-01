import type { FieldCardStatus } from "./schema.js";

/** IR.md §2.4 lowercase field_status */
export type FieldStatusIr =
  | "missing"
  | "partial"
  | "drafted"
  | "confirmed"
  | "inferred_candidate";

const toIr: Record<FieldCardStatus, FieldStatusIr> = {
  Missing: "missing",
  Partial: "partial",
  Drafted: "drafted",
  Confirmed: "confirmed",
  InferredCandidate: "inferred_candidate",
};

const fromIr: Record<FieldStatusIr, FieldCardStatus> = {
  missing: "Missing",
  partial: "Partial",
  drafted: "Drafted",
  confirmed: "Confirmed",
  inferred_candidate: "InferredCandidate",
};

export function fieldStatusToIr(s: FieldCardStatus): FieldStatusIr {
  return toIr[s];
}

export function fieldStatusFromIr(s: FieldStatusIr): FieldCardStatus {
  return fromIr[s];
}
