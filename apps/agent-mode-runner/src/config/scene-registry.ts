import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRUCTURED_FIELD_KEYS,
  type BlockRole,
  type EvaluationProfile,
  type ExpertGuidanceProfile,
  type FieldBoundaryRule,
  type FieldDefinition,
  type GapPriorityRule,
  type ProfileSourcePaths,
  type SceneDefinition,
  type SceneRegistry,
  type SchemaProfile,
  type StructuredFieldKey,
  type ThresholdRule,
} from "../types.js";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCENES_DIR = resolve(ROOT_DIR, "scenes");
const REGISTRY_PATH = resolve(SCENES_DIR, "registry.json");
const FIELD_SET = new Set<string>(STRUCTURED_FIELD_KEYS);

function topScalar(yaml: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(yaml);
  return match?.[1]?.trim() ?? "";
}

function toStructuredField(value: string): StructuredFieldKey | null {
  return FIELD_SET.has(value) ? (value as StructuredFieldKey) : null;
}

function parseTopList(yaml: string, key: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line === `${key}:`) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item) out.push(item[1]!.trim());
  }
  return out;
}

function parseFieldList(yaml: string, key: string): StructuredFieldKey[] {
  return parseTopList(yaml, key)
    .map(toStructuredField)
    .filter((value): value is StructuredFieldKey => Boolean(value));
}

function parseStringList(yaml: string, key: string): string[] {
  return parseTopList(yaml, key);
}

function parseNestedSimpleMap(yaml: string, key: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/);
  const out: Record<string, string> = {};
  let inSection = false;
  for (const line of lines) {
    if (line === `${key}:`) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const item = /^\s{2}([\w_]+):\s+(.+)$/.exec(line);
    if (item) out[item[1]!] = item[2]!.trim();
  }
  return out;
}

function parseMetricThresholds(yaml: string): Record<string, ThresholdRule> {
  const lines = yaml.split(/\r?\n/);
  const out: Record<string, ThresholdRule> = {};
  let current: string | null = null;
  let inSection = false;
  for (const line of lines) {
    if (line === "metric_thresholds:") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const metric = /^\s{2}([\w_]+):\s*$/.exec(line);
    if (metric) {
      current = metric[1]!;
      out[current] = {};
      continue;
    }
    const threshold = /^\s{4}(target|minimum|target_max|hard_max):\s+([0-9.]+)$/.exec(line);
    if (current && threshold) {
      out[current]![threshold[1] as keyof ThresholdRule] = Number(threshold[2]);
    }
  }
  return out;
}

function parseNumberMap(yaml: string, key: string): Record<string, number> {
  const simple = parseNestedSimpleMap(yaml, key);
  return Object.fromEntries(
    Object.entries(simple).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v)),
  );
}

function parseFieldDefinitions(yaml: string): Partial<Record<StructuredFieldKey, FieldDefinition>> {
  const lines = yaml.split(/\r?\n/);
  const out: Partial<Record<StructuredFieldKey, FieldDefinition>> = {};
  let inSection = false;
  let current: StructuredFieldKey | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line === "field_definitions:") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const field = /^\s{2}([\w_]+):\s*$/.exec(line);
    if (field) {
      const key = toStructuredField(field[1]!);
      current = key;
      if (current) out[current] = {};
      continue;
    }
    if (!current) continue;
    const prop = /^\s{4}(type|required|description|extraction_hint):\s*(.*)$/.exec(line);
    if (!prop) continue;
    const propName = prop[1] as "type" | "required" | "description" | "extraction_hint";
    const rawValue = prop[2] ?? "";
    if (propName === "required") {
      out[current]!.required = rawValue === "true";
      continue;
    }
    if (rawValue === ">") {
      const next = lines[i + 1]?.trim();
      out[current]![propName as "type" | "description" | "extraction_hint"] = next ?? "";
    } else {
      out[current]![propName as "type" | "description" | "extraction_hint"] = rawValue.trim();
    }
  }
  return out;
}

function parseFieldBoundaryRules(yaml: string): Partial<Record<StructuredFieldKey, FieldBoundaryRule>> {
  const lines = yaml.split(/\r?\n/);
  const out: Partial<Record<StructuredFieldKey, FieldBoundaryRule>> = {};
  let inSection = false;
  let current: StructuredFieldKey | null = null;
  let currentList: keyof FieldBoundaryRule | null = null;
  for (const line of lines) {
    if (line === "field_boundary_rules:") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const field = /^\s{2}([\w_]+):\s*$/.exec(line);
    if (field) {
      current = toStructuredField(field[1]!);
      currentList = null;
      if (current) out[current] = {};
      continue;
    }
    if (!current) continue;
    const listProp = /^\s{4}(allowed_primary_roles|disallowed_primary_roles|required_any_signals|negative_signals):\s*$/.exec(line);
    if (listProp) {
      currentList = listProp[1] as keyof FieldBoundaryRule;
      (out[current] as Record<string, unknown>)[currentList] = [];
      continue;
    }
    const notes = /^\s{4}notes:\s+(.+)$/.exec(line);
    if (notes) {
      out[current]!.notes = notes[1]!.trim();
      continue;
    }
    const item = /^\s{6}-\s+(.+)$/.exec(line);
    if (item && currentList) {
      const value = item[1]!.trim();
      const target = (out[current] as Record<string, unknown[]>)[currentList] ?? [];
      target.push(
        currentList === "allowed_primary_roles" || currentList === "disallowed_primary_roles"
          ? (value as BlockRole)
          : value,
      );
      (out[current] as Record<string, unknown[]>)[currentList] = target;
    }
  }
  return out;
}

function parseHardGates(yaml: string): EvaluationProfile["hard_gates"] {
  const lines = yaml.split(/\r?\n/);
  const out: EvaluationProfile["hard_gates"] = [];
  let inSection = false;
  let current: EvaluationProfile["hard_gates"][number] | null = null;
  for (const line of lines) {
    if (line === "hard_gates:") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const gate = /^\s+-\s+gate_id:\s+(.+)$/.exec(line);
    if (gate) {
      current = { gate_id: gate[1]!.trim() };
      out.push(current);
      continue;
    }
    const prop = /^\s{4}(description|condition):\s+(.+)$/.exec(line);
    if (current && prop) current[prop[1] as "description" | "condition"] = prop[2]!.trim();
  }
  return out;
}

function parseGapPriorityRules(yaml: string): GapPriorityRule[] {
  const lines = yaml.split(/\r?\n/);
  const out: GapPriorityRule[] = [];
  let inSection = false;
  let current: GapPriorityRule | null = null;
  for (const line of lines) {
    if (line === "gap_priority_rules:") {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^[a-zA-Z_][\w_]*:/.test(line)) break;
    const priority = /^\s+-\s+priority:\s+(.+)$/.exec(line);
    if (priority) {
      current = { priority: priority[1]!.trim(), reason: "" };
      out.push(current);
      continue;
    }
    const when = /^\s{6}-\s+([\w_]+)\.field_status/.exec(line);
    if (current && when) current.field_key = toStructuredField(when[1]!) ?? undefined;
    const reason = /^\s{4}reason:\s+(.+)$/.exec(line);
    if (current && reason) current.reason = reason[1]!.trim();
  }
  return out;
}

function loadYaml(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

export function loadSceneRegistry(): SceneRegistry {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as SceneRegistry;
}

export function resolveScene(sceneId?: string): {
  registry: SceneRegistry;
  scene: SceneDefinition;
  paths: ProfileSourcePaths;
} {
  const registry = loadSceneRegistry();
  const selected = sceneId ?? registry.default_scene_id;
  const scene = registry.scenes.find((candidate) => candidate.scene_id === selected);
  if (!scene) throw new Error(`Unknown scene_id: ${selected}`);
  const sceneDir = resolve(SCENES_DIR, scene.directory);
  return {
    registry,
    scene,
    paths: {
      scene_dir: sceneDir,
      source_document: resolve(sceneDir, scene.default_input),
      schema_profile: resolve(sceneDir, scene.schema_profile),
      expert_guidance_profile: resolve(sceneDir, scene.expert_guidance_profile),
      evaluation_profile: resolve(sceneDir, scene.evaluation_profile),
    },
  };
}

export function loadSceneProfiles(sceneId?: string): {
  registry: SceneRegistry;
  scene: SceneDefinition;
  paths: ProfileSourcePaths;
  schema_profile: SchemaProfile;
  expert_guidance_profile: ExpertGuidanceProfile;
  evaluation_profile: EvaluationProfile;
} {
  const resolved = resolveScene(sceneId);
  const schemaYaml = loadYaml(resolved.paths.schema_profile);
  const guidanceYaml = loadYaml(resolved.paths.expert_guidance_profile);
  const evaluationYaml = loadYaml(resolved.paths.evaluation_profile);
  const schema_profile: SchemaProfile = {
    profile_id: topScalar(schemaYaml, "profile_id"),
    profile_name: topScalar(schemaYaml, "profile_name"),
    scene: topScalar(schemaYaml, "scene"),
    domain: topScalar(schemaYaml, "domain"),
    version: topScalar(schemaYaml, "version"),
    required_fields: parseFieldList(schemaYaml, "required_fields"),
    optional_fields: parseFieldList(schemaYaml, "optional_fields"),
    inferred_candidate_fields: parseFieldList(schemaYaml, "inferred_candidate_fields"),
    field_definitions: parseFieldDefinitions(schemaYaml),
    field_boundary_rules: parseFieldBoundaryRules(schemaYaml),
    normalization_rules: parseStringList(schemaYaml, "normalization_rules"),
    output_requirements: parseStringList(schemaYaml, "output_requirements"),
  };
  const expert_guidance_profile: ExpertGuidanceProfile = {
    profile_id: topScalar(guidanceYaml, "profile_id"),
    profile_name: topScalar(guidanceYaml, "profile_name"),
    scene: topScalar(guidanceYaml, "scene"),
    domain: topScalar(guidanceYaml, "domain"),
    role: topScalar(guidanceYaml, "role"),
    version: topScalar(guidanceYaml, "version"),
    field_guidance: {
      execution_steps: parseStringList(guidanceYaml, "extraction_guidance"),
      judgment_criteria: parseStringList(guidanceYaml, "planning_guidance"),
      validation_methods: parseStringList(guidanceYaml, "gap_detection_guidance"),
    },
    extraction_guidance: parseStringList(guidanceYaml, "extraction_guidance"),
    gap_detection_guidance: parseStringList(guidanceYaml, "gap_detection_guidance"),
    planning_guidance: parseStringList(guidanceYaml, "planning_guidance"),
    inference_boundaries: parseStringList(guidanceYaml, "inference_boundaries"),
    quality_preferences: parseStringList(guidanceYaml, "quality_preferences"),
  };
  const evaluation_profile: EvaluationProfile = {
    profile_id: topScalar(evaluationYaml, "profile_id"),
    profile_name: topScalar(evaluationYaml, "profile_name"),
    scene: topScalar(evaluationYaml, "scene"),
    domain: topScalar(evaluationYaml, "domain"),
    version: topScalar(evaluationYaml, "version"),
    metrics: parseStringList(evaluationYaml, "core_metrics"),
    metric_thresholds: parseMetricThresholds(evaluationYaml),
    field_weights: parseNumberMap(evaluationYaml, "field_weights"),
    critical_fields: parseFieldList(evaluationYaml, "critical_fields"),
    list_fields: parseFieldList(evaluationYaml, "list_fields"),
    single_fields: parseFieldList(evaluationYaml, "single_fields"),
    hard_gates: parseHardGates(evaluationYaml),
    gap_priority_rules: parseGapPriorityRules(evaluationYaml),
  };
  return { ...resolved, schema_profile, expert_guidance_profile, evaluation_profile };
}
