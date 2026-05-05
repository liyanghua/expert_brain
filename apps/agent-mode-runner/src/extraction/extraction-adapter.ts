import type {
  ContextualizedBlock,
  BlockRoleMap,
  DocumentIR,
  DocumentSynthesis,
  DocumentUnderstanding,
  EvaluationProfile,
  ExpertGuidanceProfile,
  ExtractionEvidenceTrace,
  ExtractionProfile,
  GroundTruthDraft,
  SchemaProfile,
  SemanticSegment,
  SectionCard,
  SectionEvidenceHints,
  StepMetric,
} from "../types.js";

export type ExtractionAdapterInput = {
  ir: DocumentIR;
  understanding: DocumentUnderstanding;
  sectionCards: SectionCard[];
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
  evaluationProfile?: EvaluationProfile;
  sectionEvidenceHints?: SectionEvidenceHints;
  documentSynthesis?: DocumentSynthesis;
  contextualizedBlocks?: ContextualizedBlock[];
  semanticSegments?: SemanticSegment[];
  blockRoleMap?: BlockRoleMap;
};

export type ExtractionResult = {
  adapterProfile: ExtractionProfile;
  draft: GroundTruthDraft;
  evidenceTrace?: ExtractionEvidenceTrace;
  metrics?: Record<string, StepMetric>;
  extraArtifacts?: Record<string, unknown>;
};

export type ExtractionAdapter = {
  profile: ExtractionProfile;
  extract(input: ExtractionAdapterInput): ExtractionResult;
};
