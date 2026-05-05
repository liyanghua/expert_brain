import type {
  ContextualizedBlock,
  ContextCoverage,
  BlockRoleMap,
  ContinuityDecisionTrace,
  DocumentIR,
  DocumentMap,
  DocumentSynthesis,
  DocumentUnderstanding,
  ExpertGuidanceProfile,
  SchemaProfile,
  SemanticCoherenceProfile,
  SemanticUnitEnhancementProfile,
  SemanticUnitMatchProfile,
  SemanticSegment,
  SemanticUnit,
  SectionCard,
  SectionEvidenceHints,
  StepMetric,
  StructuredSection,
  StructuredSectionSummary,
  UnderstandingProfile,
} from "../types.js";

export type UnderstandingAdapterInput = {
  ir: DocumentIR;
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
  semanticCoherenceProfile?: SemanticCoherenceProfile;
  semanticUnitEnhancementProfile?: SemanticUnitEnhancementProfile;
  semanticUnitMatchProfile?: SemanticUnitMatchProfile;
  semanticUnitEvalReport?: boolean;
};

export type UnderstandingResult = {
  documentMap: DocumentMap;
  sectionCards: SectionCard[];
  understanding: DocumentUnderstanding;
  coverage: ContextCoverage;
  metrics: Record<string, StepMetric>;
  evidenceHints?: SectionEvidenceHints;
  structuredSections?: StructuredSection[];
  structuredSectionSummaries?: StructuredSectionSummary[];
  documentSynthesis?: DocumentSynthesis;
  contextualizedBlocks?: ContextualizedBlock[];
  semanticUnits?: SemanticUnit[];
  continuityDecisionTrace?: ContinuityDecisionTrace;
  semanticSegments?: SemanticSegment[];
  blockRoleMap?: BlockRoleMap;
  extraArtifacts?: Record<string, unknown>;
};

export type UnderstandingAdapter = {
  profile: UnderstandingProfile;
  understand(input: UnderstandingAdapterInput): UnderstandingResult;
};
