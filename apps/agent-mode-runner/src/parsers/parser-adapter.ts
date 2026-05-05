import type { DocumentIR, ParserProfile } from "../types.js";

export type ParseDiagnostics = {
  parser_name: string;
  parser_version: string;
  input_file_type: string;
  parse_duration_ms: number;
  block_count: number;
  heading_count: number;
  table_count: number;
  image_count: number;
  conversion_mode?: string;
  raw_docling_output_path?: string;
  ignored_block_count?: number;
  ignored_block_reasons?: string[];
  warnings: string[];
};

export type ParserMetricHints = {
  block_integrity_rate?: number;
  heading_preservation_rate?: number;
  table_preservation_rate?: number;
};

export type ParserResult = {
  ir: DocumentIR;
  diagnostics: ParseDiagnostics;
  metricHints?: ParserMetricHints;
  extraArtifacts?: Record<string, unknown>;
};

export type ParserInput = {
  inputPath: string;
  docId: string;
  versionId: string;
};

export type ParserAdapter = {
  profile: ParserProfile;
  parse(input: ParserInput): Promise<ParserResult>;
};
