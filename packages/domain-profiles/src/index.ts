/** Placeholder domain injection profiles (AGENTS §8.7). */
export type DomainProfile = {
  profile_id: string;
  description: string;
  extra_field_hints: Record<string, string>;
};

export const defaultProfile: DomainProfile = {
  profile_id: "generic_business",
  description: "Generic SOP / playbook extraction hints",
  extra_field_hints: {
    judgment_criteria: "Look for explicit pass/fail or threshold language.",
    validation_methods: "Look for test plans, audits, or KPI checks.",
  },
};
