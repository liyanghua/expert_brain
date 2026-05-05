# Agent Mode Runner Evaluation Report

## 1. Report Scope

This report records the current Agent Mode Runner baseline for later comparison.

- Baseline run: `run_42c5ba34-d06f-4894-b176-7e8abcad374f`
- Run directory: `data/agent-mode-runs/run_42c5ba34-d06f-4894-b176-7e8abcad374f/`
- Scene: `product_link_diagnosis` / 商品链接诊断
- Source document: `apps/agent-mode-runner/scenes/product_link_diagnosis/source.md`
- Spec source: `docs/Agent_mode_pipeline.YAML`
- Generated at: `2026-05-02T14:08:20.386Z`

This baseline is a rule-based, observable backend runner. It validates the end-to-end pipeline shape, artifact production, scene profile loading, scoring loop, and Plan execution loop. It is not yet a final LLM-quality extraction result.

## 2. Scene and Profile Inputs

Step 0 loads the scene from the runner-local scene registry.

| Item | Value |
| --- | --- |
| Scene ID | `product_link_diagnosis` |
| Scene name | `商品链接诊断` |
| Domain | `ecommerce_growth` |
| SchemaProfile | `schema.product_link_diagnosis.v1` |
| ExpertGuidanceProfile | `guidance.product_link_diagnosis.expert.v1` |
| EvaluationProfile | `eval.product_link_diagnosis.v1` |
| Required fields | 10 |
| Optional fields | 7 |
| Guidance rules loaded | 15 |
| Metric thresholds loaded | 8 |

Profile source paths:

- `apps/agent-mode-runner/scenes/product_link_diagnosis/SchemaProfile.YAML`
- `apps/agent-mode-runner/scenes/product_link_diagnosis/ExpertGuidanceProfile.YAML`
- `apps/agent-mode-runner/scenes/product_link_diagnosis/EvaluationProfile.YAML`

## 3. Current Implementation Path

The current runner executes 10 steps:

1. Step 0: load scene registry and three Profiles.
2. Step 1: parse `source.md` into `DocumentIR` with the built-in Markdown parser.
3. Step 2: build `DocumentMap`, `SectionCard[]`, `DocumentUnderstanding`, and coverage artifacts.
4. Step 3: create `structured_draft.v0.json` with a heuristic extractor.
5. Step 4: calculate `scorecard.v0.json` with EvaluationProfile thresholds.
6. Step 5: generate `agent_plan.v0.json` using ExpertGuidanceProfile and EvaluationProfile priority rules.
7. Step 6: auto-approve the generated plan.
8. Step 7: execute plan steps by appending structured draft candidate items.
9. Step 8: create `structured_draft.v1.json`, calculate `scorecard.v1.json`, and compare score delta.
10. Step 9: create mock `expert_review.json`, `strategy_feedback.json`, and `run_summary.json`.

The key logic is profile-driven:

- `SchemaProfile.YAML` defines what fields to extract.
- `ExpertGuidanceProfile.YAML` defines how to prioritize gaps and where inferred content must remain candidate.
- `EvaluationProfile.YAML` defines score thresholds and quality gates.

## 4. V0 Baseline

`v0` is the first structured draft produced after parsing and hierarchical understanding.

Artifact path:

- `data/agent-mode-runs/run_42c5ba34-d06f-4894-b176-7e8abcad374f/structured_draft.v0.json`
- `data/agent-mode-runs/run_42c5ba34-d06f-4894-b176-7e8abcad374f/scorecard.v0.json`

V0 scorecard:

| Metric | V0 Value | Status | Notes |
| --- | ---: | --- | --- |
| `field_coverage` | `0.5882` | `fail` | Below EvaluationProfile minimum `0.75`. |
| `field_accuracy` | `null` | `skipped` | Requires gold labels; not measured in this baseline. |
| `item_f1` | `null` | `skipped` | Requires item-level gold labels; not measured in this baseline. |
| `source_grounding_rate` | `1` | `pass` | All heuristic extracted items have source refs. |
| `structural_consistency` | `0.84` | `warn` | Above minimum `0.80`, below target `0.90`. |
| `gap_detection_accuracy` | `0.76` | `warn` | Above minimum `0.70`, below target `0.80`. |
| `inference_handling_accuracy` | `0.9` | `pass` | Meets target. |
| `human_revision_rate` | `null` | `skipped` | Requires expert edit data. |

V0 overall status: `blocked`.

Interpretation:

- The runner can extract and bind source refs, but field coverage is still too low.
- The result is a useful software baseline, not a business-quality structured extraction.
- The current extractor often maps section summaries into fields, so some fields are populated with coarse content rather than precise schema-specific items.

## 5. Agent Plan

The generated plan has 5 steps:

| Step | Target field | Rationale source | Evidence blocks |
| --- | --- | --- | --- |
| `plan_step_1` | `judgment_criteria` | ExpertGuidanceProfile: judging criteria is most important for executability. | `b1`-`b6` |
| `plan_step_2` | `validation_methods` | ExpertGuidanceProfile: validation is required to prove optimization effectiveness. | `b1`-`b6` |
| `plan_step_3` | `termination_conditions` | ExpertGuidanceProfile: missing termination conditions prevents workflow closure. | `b50`-`b55` |
| `plan_step_4` | `process_flow_or_business_model` | ExpertGuidanceProfile: align business model and execution steps. | `b1`-`b6` |
| `plan_step_5` | `tool_templates` | Missing field fallback from schema/profile coverage. | `b56`-`b58` |

Artifact path:

- `data/agent-mode-runs/run_42c5ba34-d06f-4894-b176-7e8abcad374f/agent_plan.v0.json`

Interpretation:

- Plan ordering confirms that `ExpertGuidanceProfile.planning_guidance` and `EvaluationProfile.gap_priority_rules` are active.
- The Plan is action-oriented, but execution is currently a rule-based append operation, not an LLM rewrite or expert-approved content generation.

## 6. V1 Baseline

`v1` is generated after plan approval and step-by-step execution.

Artifact path:

- `data/agent-mode-runs/run_42c5ba34-d06f-4894-b176-7e8abcad374f/structured_draft.v1.json`
- `data/agent-mode-runs/run_42c5ba34-d06f-4894-b176-7e8abcad374f/scorecard.v1.json`

V1 scorecard:

| Metric | V0 Value | V1 Value | Delta | V1 Status |
| --- | ---: | ---: | ---: | --- |
| `field_coverage` | `0.5882` | `0.7059` | `+0.1177` | `fail` |
| `field_accuracy` | `null` | `null` | `null` | `skipped` |
| `item_f1` | `null` | `null` | `null` | `skipped` |
| `source_grounding_rate` | `1` | `1` | `0` | `pass` |
| `structural_consistency` | `0.84` | `0.84` | `0` | `warn` |
| `gap_detection_accuracy` | `0.76` | `0.76` | `0` | `warn` |
| `inference_handling_accuracy` | `0.9` | `0.9` | `0` | `pass` |
| `human_revision_rate` | `null` | `null` | `null` | `skipped` |

V1 overall status: `blocked`.

Score delta:

| Delta metric | Value |
| --- | ---: |
| `net_quality_gain` | `0.1177` |
| `improved_fields_count` | `1` |
| `regressed_fields_count` | `0` |

Interpretation:

- The runner improves field coverage without regression.
- The improvement is not enough to pass EvaluationProfile minimum thresholds.
- This is expected for the current implementation because Step 7 only appends candidate items; it does not perform schema-grounded rewriting or true content synthesis.

## 7. Expert Review Baseline

Current expert review is mock data created by Step 9.

| Dimension | Score |
| --- | ---: |
| Overall | `4` |
| Completeness | `4` |
| Accuracy | `3.8` |
| Clarity | `4` |
| Actionability | `4` |
| Traceability | `4` |

Accepted final version: `true`.

Interpretation:

- This confirms the review artifact shape.
- It must not be treated as real expert validation.
- Future runs should replace this with manual `review-json` or a real expert review workflow.

## 8. What This Baseline Proves

This baseline proves:

- Scene registration works.
- Scene-local Profile assets are loaded and recorded.
- Profile versions are written into `run_summary.json`.
- Required/optional schema fields affect extraction scope.
- Expert planning guidance affects Agent Plan ordering.
- Evaluation thresholds affect scorecard pass/warn/fail states.
- Inference boundaries affect candidate status, for example `termination_conditions` becomes `InferredCandidate`.
- All 10 steps produce observable artifacts.

## 9. Current Limitations

The current baseline does not yet prove:

- Accurate field-level semantic extraction.
- Item-level precision/recall.
- True source grounding correctness.
- LLM-based document understanding quality.
- Real expert acceptance.
- Real improvement in business document quality.

Known implementation limits:

- YAML parsing is a lightweight runner-local parser.
- Step 3 extraction is heuristic and section-summary based.
- Step 7 execution appends candidate content rather than rewriting or synthesizing high-quality field content.
- `field_accuracy`, `item_f1`, and `human_revision_rate` are skipped because no gold labels or expert edits are available.

## 10. Recommended Next Comparison Target

The next upgrade should target Step 3 and Step 7:

1. Replace heuristic extraction with schema-guided LLM extraction.
2. Use `field_definitions.extraction_hint` and `ExpertGuidanceProfile.extraction_guidance` in the prompt.
3. Select evidence from `DocumentMap` and `SectionCard[]` instead of passing the full document.
4. Generate field-level items with source refs and candidate status.
5. Add gold labels for at least the critical fields:
   - `business_scenario`
   - `scenario_goal`
   - `process_flow_or_business_model`
   - `execution_steps`
   - `judgment_basis`
   - `judgment_criteria`
   - `resolution_methods`
   - `trigger_conditions`
   - `validation_methods`

Success criteria for the next run:

- `field_coverage >= 0.75`
- `source_grounding_rate >= 0.80`
- `structural_consistency >= 0.80`
- no regression in `regressed_fields_count`
- at least one real expert or gold-based metric replacing a skipped metric

## 11. Step 1 V2 Docling Evaluation

This section records the Step 1 parser upgrade from a single built-in Markdown parser to replaceable parser adapters.

Implemented paths:

- V1 baseline: `builtinMarkdownParserAdapter`, selected by `--parse-profile builtin`.
- V2 candidate: `doclingParserAdapter`, selected by `--parse-profile docling`.
- Shared output contract: both adapters produce `DocumentIR`, `parse_diagnostics.json`, and Step 1 metrics.
- Docling raw output retention: V2 writes `raw_docling_output.json` when the adapter completes.

Validation runs:

| Run | Parse profile | Status | Notes |
| --- | --- | --- | --- |
| `run_step1_v2_builtin` | `builtin` | completed | Real scene smoke run. |
| `run_step1_v2_docling` | `docling` | failed as expected | Current machine does not have Docling CLI installed; error is `docling_not_installed`. |
| `run_step1_v2_docling_mock` | `docling` | completed | Uses `AGENT_MODE_RUNNER_DOCLING_MARKDOWN_FIXTURE` to validate V2 adapter and downstream wiring. This is not a real Docling quality result. |

Step 1 metrics from the real builtin run and mock Docling-path run:

| Metric | Builtin V1 | Docling-path V2 mock | Result |
| --- | ---: | ---: | --- |
| `parse_success_rate` | `1` | `1` | Same. |
| `block_integrity_rate` | `0.90` | `0.94` | Improved from `warn` to `pass` by V2 adapter hint. |
| `heading_preservation_rate` | `0.95` | `0.96` | Slight proxy improvement. |
| `table_preservation_rate` | `1.00` | `0.92` | V1 looks high because no table blocks are recognized; V2 mock actually maps table blocks. |
| `source_span_completeness` | `1` | `1` | Same, but span semantics changed from `Lx-Ly` to `docling:block:n`. |
| `block_count` | `58` | `59` | Changed because V2 mock splits table/list-like content differently. |
| `heading_count` | `14` | `14` | Same. |
| `table_count` | `0` | `6` | Improved parser observability for table-like Markdown content. |

Downstream metrics:

| Metric | Builtin V1 run | Docling-path V2 mock run | Result |
| --- | ---: | ---: | --- |
| V0 `field_coverage` | `0.5882` | `0.5882` | Same. |
| V1 `field_coverage` | `0.7059` | `0.7059` | Same. |
| `source_grounding_rate` | `1` | `1` | Same. |
| `structural_consistency` | `0.84` | `0.84` | Same. |
| `gap_detection_accuracy` | `0.76` | `0.76` | Same. |
| `net_quality_gain` | `0.1177` | `0.1177` | Same. |
| `regressed_fields_count` | `0` | `0` | No regression. |

Interpretation:

- Improved: Step 1 now has a replaceable parser contract, CLI switch, diagnostics, raw output preservation, and a V2 mapping path that can recognize table/list/image blocks.
- Improved in the mock path: `table_count` changes from `0` to `6`, and Step 1 threshold status changes from `warn` to `pass`.
- Not improved yet downstream: `field_coverage`, `source_grounding_rate`, and `net_quality_gain` are unchanged because the downstream extractor is still heuristic and the V2 run used a Markdown fixture, not real Docling output.
- Potential degradation/risk: Docling source spans are currently block-level (`docling:block:n`) rather than original line ranges, so real traceability quality still needs a page/span mapping pass.
- Potential degradation/risk: real Docling parse duration is not measured here because Docling CLI is not installed. The mock run's `parse_duration_ms=1` is not representative.

Next required validation:

1. Install Docling outside the runner, for example `pip install docling`.
2. Run the same scene with a real DOCX/PDF input.
3. Compare real Docling output against builtin using `table_preservation_rate`, `block_integrity_rate`, `source_span_completeness`, and downstream `field_coverage`.

## 12. Step 1 Marked Markdown Adapter Evaluation

This section records the Markdown-specific parser upgrade requested after the Docling V2 adapter work.

Implemented paths:

- V1 baseline: `builtinMarkdownParserAdapter`, selected by `--parse-profile builtin`.
- Markdown enhanced adapter: `markedMarkdownParserAdapter`, selected by `--parse-profile marked`.
- Multi-format candidate remains: `doclingParserAdapter`, selected by `--parse-profile docling`.

Validation runs on the default `product_link_diagnosis` scene:

| Run | Parse profile | Status | Notes |
| --- | --- | --- | --- |
| `run_step1_marked_compare_builtin` | `builtin` | completed | Fresh baseline for the same default scene document. |
| `run_step1_marked_eval` | `marked` | completed | Uses `marked` tokens to map Markdown structure into `DocumentIR`. |

Step 1 parser metrics:

| Metric | Builtin V1 | Marked adapter | Result |
| --- | ---: | ---: | --- |
| `parse_success_rate` | `1` | `1` | Same. |
| `block_integrity_rate` | `0.90` | `0.94` | Improved from `warn` to `pass`. |
| `heading_preservation_rate` | `0.95` | `0.96` | Slight proxy improvement. |
| `table_preservation_rate` | `1.00` | `0.95` | Builtin score is misleading because it recognized no table blocks; marked recognizes real tables. |
| `source_span_completeness` | `1` | `1` | Same; marked preserves line-based spans. |
| `parse_duration_ms` | `1` | `7` | Slower, but still lightweight for the default Markdown source. |
| `block_count` | `58` | `58` | Same. |
| `heading_count` | `14` | `14` | Same. |
| `table_count` | `0` | `6` | Improved Markdown structure recognition. |

Downstream metrics:

| Metric | Builtin V1 run | Marked run | Result |
| --- | ---: | ---: | --- |
| V0 `field_coverage` | `0.5882` | `0.5882` | Same. |
| V1 `field_coverage` | `0.7059` | `0.7059` | Same. |
| `source_grounding_rate` | `1` | `1` | Same. |
| `structural_consistency` | `0.84` | `0.84` | Same. |
| `gap_detection_accuracy` | `0.76` | `0.76` | Same. |
| `inference_handling_accuracy` | `0.90` | `0.90` | Same. |
| `net_quality_gain` | `0.1177` | `0.1177` | Same. |
| `regressed_fields_count` | `0` | `0` | No regression. |

Interpretation:

- Marked is a better Markdown parser than the current hand-written builtin parser for Step 1.
- The concrete improvement in this default scene is structural: `table_count` changes from `0` to `6`, while headings and block count remain stable.
- Marked keeps line-based source spans, so it avoids the Docling mock path's current `docling:block:n` traceability tradeoff.
- Downstream quality does not improve yet because Step 2/3 still use heuristic section and field extraction; they do not currently give extra semantic weight to `table` blocks.
- Marked should be treated as a Markdown adapter upgrade, not as a replacement for Docling on DOCX/PDF/PPTX/XLSX.

Recommended next action:

1. Keep `builtin` as the minimal fallback.
2. Use `marked` as the default Markdown parser candidate after one more comparison on a table-heavy Markdown fixture.
3. Teach Step 2/3 to use `table` blocks explicitly so parser improvements can translate into field coverage or grounding improvements.

## 13. Step 2 Profile/Table-Aware Evaluation

This section records the Step 2 upgrade from a single hierarchical understanding implementation to replaceable understanding adapters.

Implemented paths:

- Baseline: `baselineUnderstandingAdapter`, selected by `--understanding-profile baseline`.
- Profile/table-aware deterministic adapter: `profileTableUnderstandingAdapter`, selected by `--understanding-profile profile_table`.
- Shared inputs: `DocumentIR`, `SchemaProfile`, and `ExpertGuidanceProfile`.
- Shared outputs: `document_map.json`, `section_cards.json`, `document_understanding.json`, and `coverage.step2.json`.
- Extra output in `profile_table`: `section_evidence_hints.json`.

Validation runs on the default `product_link_diagnosis` scene with `--parse-profile marked`:

| Run | Parse profile | Understanding profile | Status | Notes |
| --- | --- | --- | --- | --- |
| `run_step2_profile_table_baseline` | `marked` | `baseline` | completed | Fresh baseline using the improved Markdown parser. |
| `run_step2_profile_table_eval` | `marked` | `profile_table` | completed | Uses SchemaProfile / ExpertGuidanceProfile signals and table-aware evidence hints. |

Step 2 metrics:

| Metric | Baseline | Profile/table-aware | Result |
| --- | ---: | ---: | --- |
| `section_summary_coverage` | `1` | `1` | Same. |
| `summary_faithfulness` | `0.82` | `0.82` | Same; still proxy. |
| `summary_grounding_rate` | `1` | `1` | Same. |
| `theme_goal_accuracy` | `0.78` | `0.78` | Same; still proxy. |
| `summary_compression_ratio` | `0.2414` | `0.2414` | Same. |
| `summary_duration_ms` | `1` | `3` | Slightly slower due to profile/table signal matching. |
| `table_utilization_rate` | not emitted | `1` | New measured metric; all parsed table blocks are used in section evidence hints. |
| `profile_field_signal_coverage` | not emitted | `0.5882` | New measured metric; 10 of 17 profile target fields are matched by deterministic signals. |

Downstream metrics:

| Metric | Baseline | Profile/table-aware | Result |
| --- | ---: | ---: | --- |
| V0 `field_coverage` | `0.5882` | `0.5882` | Same. |
| V1 `field_coverage` | `0.7059` | `0.7059` | Same. |
| `source_grounding_rate` | `1` | `1` | Same. |
| `structural_consistency` | `0.84` | `0.84` | Same. |
| `gap_detection_accuracy` | `0.76` | `0.76` | Same. |
| `inference_handling_accuracy` | `0.90` | `0.90` | Same. |
| `net_quality_gain` | `0.1177` | `0.1177` | Same. |
| `regressed_fields_count` | `0` | `0` | No regression. |

Interpretation:

- Improved: Step 2 now has a replaceable interface and a deterministic `profile_table` implementation.
- Improved: `profile_table` creates `section_evidence_hints.json`, making table blocks and field-level evidence signals observable.
- Improved: the marked parser's table structure now reaches Step 2 through `table_utilization_rate=1`.
- Not improved yet downstream: Step 3 still consumes `SectionCard.summary` and `covered_schema_fields` heuristically, so richer evidence hints are not yet used in extraction scoring.
- Risk: field signal generation is still deterministic and string-match based, so `profile_field_signal_coverage=0.5882` should be treated as a routing signal, not a semantic quality score.

Recommended next action:

1. Teach Step 3 to use `section_evidence_hints.json` or equivalent in-memory hints when selecting field evidence.
2. Prefer table-backed blocks for `judgment_basis`, `judgment_criteria`, `validation_methods`, and `tool_templates`.
3. Add one table-heavy gold fixture so `profile_field_signal_coverage` can be correlated with real field coverage and source grounding.

## 14. Step 3 Hinted Extraction Evaluation

This section records the Step 3 upgrade from a single heuristic extractor to replaceable extraction adapters.

Implemented paths:

- Baseline: `baselineExtractionAdapter`, selected by `--extraction-profile baseline`.
- Hinted extractor: `hintedExtractionAdapter`, selected by `--extraction-profile hinted`.
- The hinted extractor consumes in-memory `section_evidence_hints` from Step 2 and writes `extraction_evidence_trace.json`.
- For diagnostic fields, hinted extraction prefers table-backed evidence when available: `judgment_basis`, `judgment_criteria`, `validation_methods`, and `tool_templates`.

Validation runs on the default `product_link_diagnosis` scene:

| Run | Parse profile | Understanding profile | Extraction profile | Status |
| --- | --- | --- | --- | --- |
| `run_step3_hinted_baseline_v2` | `marked` | `profile_table` | `baseline` | completed |
| `run_step3_hinted_eval_v2` | `marked` | `profile_table` | `hinted` | completed |

Step 3 metrics:

| Metric | Baseline extraction | Hinted extraction | Result |
| --- | ---: | ---: | --- |
| `field_coverage` | `0.5882` | `0.7059` | Improved from `fail` to `warn`. |
| `covered_fields` | `10 / 17` | `12 / 17` | Improved by 2 fields. |
| `source_bound_fields` | `10` | `12` | Improved with source refs preserved. |
| `source_grounding_rate` | `1` | `1` | Same. |
| `structural_consistency` | `0.82` | `0.82` | Same; still proxy. |
| `gap_detection_accuracy` | `0.72` | `0.72` | Same; still proxy. |
| `inference_handling_accuracy` | `0.90` | `0.90` | Same. |

Downstream scorecard metrics:

| Metric | Baseline extraction | Hinted extraction | Result |
| --- | ---: | ---: | --- |
| V0 `field_coverage` | `0.5882` | `0.7059` | Improved. |
| V1 `field_coverage` | `0.7059` | `0.7059` | Hinted V0 already reaches the previous post-plan level. |
| `source_grounding_rate` | `1` | `1` | Same. |
| `net_quality_gain` | `0.1177` | `0` | Expected: Step 7 has less remaining coverage gap after hinted extraction. |
| `regressed_fields_count` | `0` | `0` | No regression. |

Evidence trace highlights from `run_step3_hinted_eval_v2`:

| Field | Table-backed | Extraction method |
| --- | --- | --- |
| `judgment_basis` | `true` | `hinted_table_evidence` |
| `judgment_criteria` | `true` | `hinted_table_evidence` |
| `validation_methods` | `true` | `hinted_table_evidence` |
| `tool_templates` | `true` | `hinted_table_evidence` |

Interpretation:

- Improved: Step 3 now directly consumes Step 2 hints instead of only using `SectionCard.summary`.
- Improved: initial extraction coverage rises from `0.5882` to `0.7059`, and Step 3 threshold status moves from `fail` to `warn`.
- Improved: table evidence now backs the key diagnostic fields that should prefer table structure.
- Not improved yet: semantic correctness is still not gold-validated; `field_accuracy` and `item_f1` remain `pending_gold`.
- Expected side effect: `net_quality_gain` after Step 7 becomes `0` because the hinted V0 starts at the same coverage level that baseline reached only after plan execution.

Recommended next action:

1. Add table-heavy gold labels for `judgment_basis`, `judgment_criteria`, and `validation_methods`.
2. Upgrade Step 4 scoring to distinguish initial quality improvement from post-plan delta.
3. Make Step 7 plan generation aware of already-resolved hinted fields so it focuses on remaining gaps rather than repeating coverage work.

## 15. Step 2 Structured Context Evaluation

This section records the second Step 2 upgrade based on `docs/doc_understanding.md`.

Implemented paths:

- Existing deterministic adapter: `profileTableUnderstandingAdapter`, selected by `--understanding-profile profile_table`.
- New structured adapter: `structuredContextUnderstandingAdapter`, selected by `--understanding-profile structured_context`.
- New artifacts: `structured_sections.json`, `structured_section_summaries.json`, `document_synthesis.json`, and `contextualized_blocks.json`.
- Compatibility artifacts remain unchanged: `document_map.json`, `section_cards.json`, `document_understanding.json`, and `section_evidence_hints.json`.

Validation runs on the default `product_link_diagnosis` scene with `--parse-profile marked`:

| Run | Understanding profile | Extraction profile | Status | Artifacts |
| --- | --- | --- | --- | ---: |
| `step2-profile-table-hinted` | `profile_table` | `hinted` | completed | `57` |
| `step2-structured-baseline` | `structured_context` | `baseline` | completed | `60` |
| `step2-structured-hinted` | `structured_context` | `hinted` | completed | `61` |

Step 2 metrics:

| Metric | Profile/table hinted | Structured baseline | Structured hinted | Result |
| --- | ---: | ---: | ---: | --- |
| `section_summary_coverage` | `1` | `1` | `1` | Same; legacy metric still proxy. |
| `summary_grounding_rate` | `1` | `1` | `1` | Same. |
| `summary_compression_ratio` | `0.2414` | `0.0690` | `0.0690` | More compressed because summaries are H2-level structured summaries. |
| `table_utilization_rate` | `1` | `1` | `1` | Preserved after coverage fix. |
| `profile_field_signal_coverage` | `0.5882` | `0.5882` | `0.5882` | Preserved; no regression vs profile_table. |
| `structured_section_count` | not emitted | `4` | `4` | New measured metric. |
| `structured_summary_coverage` | not emitted | `1` | `1` | New measured metric. |
| `contextualized_block_coverage` | not emitted | `1` | `1` | New measured metric; every parsed block gets section/document/extraction context. |
| `structured_summary_grounding_rate` | not emitted | `1` | `1` | New measured metric. |

Step 3 / Step 8 metrics:

| Metric | Profile/table hinted | Structured baseline | Structured hinted | Interpretation |
| --- | ---: | ---: | ---: | --- |
| V0 `field_coverage` | `0.7059` | `0.5882` | `0.7059` | Structured context preserves hinted extraction quality when paired with `hinted`. |
| V0 `source_grounding_rate` | `1` | `1` | `1` | No grounding regression. |
| `net_quality_gain` | `0` | `0.1177` | `0` | Expected: hinted V0 already reaches the post-plan coverage level. |
| `regressed_fields_count` | `0` | `0` | `0` | No regression. |

Interpretation:

- Improved: Step 2 now has a stable intermediate understanding layer aligned with `docs/doc_understanding.md`: H2-oriented sections, structured section summaries, document-level synthesis, and contextualized blocks.
- Improved: future QA / Plan / rewrite steps can consume `contextualized_blocks.json` instead of re-reading raw blocks or relying only on `section_evidence_hints`.
- Preserved: `table_utilization_rate=1`, `profile_field_signal_coverage=0.5882`, `source_grounding_rate=1`, and `regressed_fields_count=0`.
- Not improved yet: `field_accuracy`, `item_f1`, `summary_faithfulness`, and `theme_goal_accuracy` still require gold labels or LLM/human evaluation.
- Tradeoff: H2 sections reduce `summary_compression_ratio` to `0.0690`; this is desirable for compact agent context, but needs a later lower/upper bound metric to avoid over-compression on other documents.

Recommended next action:

1. Use `structured_context + hinted` as the preferred deterministic Step 2/3 comparison profile.
2. Add a future LLM structured-summary adapter behind the same `UnderstandingAdapter` interface.
3. Extend Step 5 Plan generation and QA retrieval to consume `contextualized_blocks.json`.

## 16. Step 3 Schema-Guided Adapter Evaluation

This section records the Step 3 upgrade from hinted evidence filling to a schema-guided, source-grounded, typed extraction thin layer.

Implemented paths:

- Existing comparison profile: `hintedExtractionAdapter`, selected by `--extraction-profile hinted`.
- New deterministic adapter: `schemaGuidedExtractionAdapter`, selected by `--extraction-profile schema_guided`.
- New internal modules: field plan builder, evidence selector, typed field extractors, and draft validator under `src/extraction/schema-guided/`.
- New artifacts: `schema_guided_evidence_map.json`, `schema_guided_extraction_trace.json`, and `schema_guided_validation_report.json`.

Validation runs on the default `product_link_diagnosis` scene with `--parse-profile marked`:

| Run | Understanding profile | Extraction profile | Status | Artifacts |
| --- | --- | --- | --- | ---: |
| `step3-schema-hinted-baseline` | `structured_context` | `hinted` | completed | `61` |
| `step3-schema-structured-eval` | `structured_context` | `schema_guided` | completed | `63` |
| `step3-schema-profile-table-eval` | `profile_table` | `schema_guided` | completed | `59` |

Step 3 metrics:

| Metric | Structured hinted | Structured schema-guided | Profile/table schema-guided | Result |
| --- | ---: | ---: | ---: | --- |
| `field_coverage` | `0.7059` | `0.9412` | `0.9412` | Improved from `warn` to `pass`. |
| `source_grounding_rate` | `1` | `1` | `1` | Preserved. |
| `typed_validation_pass_rate` | not emitted | `0.9412` | `0.9412` | New measured metric. |
| `source_backed_item_rate` | not emitted | `1` | `1` | New measured metric. |
| `inferred_field_count` | not emitted | `4` | `4` | New measured metric; candidate fields are explicit. |
| `gap_count` | not emitted | `1` | `1` | New measured metric; missing screenshot evidence remains visible. |
| `table_row_extraction_count` | not emitted | `122` | `83` | New measured metric; structured_context gives broader table-row evidence. |

Step 4 / Step 8 metrics:

| Metric | Structured hinted | Structured schema-guided | Profile/table schema-guided | Interpretation |
| --- | ---: | ---: | ---: | --- |
| V0 `field_coverage` | `0.7059` | `0.9412` | `0.9412` | Schema-guided exceeds the `0.80` target. |
| V0 `source_grounding_rate` | `1` | `1` | `1` | No grounding regression. |
| V0 `gap_detection_accuracy` | `0.76` | `0.76` | `0.76` | Proxy preserved after validation gaps are written back. |
| V0 `overall_status` | `blocked` | `needs_improvement` | `needs_improvement` | Schema-guided removes the `field_coverage` hard fail; remaining issues are warning-level/pending-gold. |
| `net_quality_gain` | `0` | `0` | `0` | Expected: V0 already reaches high coverage before Step 7. |
| `regressed_fields_count` | `0` | `0` | `0` | No regression. |

Interpretation:

- Improved: Step 3 now follows a source-grounded extraction pattern: field plan -> evidence map -> typed extraction -> validation report.
- Improved: `field_coverage` rises from `0.7059` to `0.9412`, exceeding the configured target of `0.80`.
- Improved: `source_backed_item_rate=1`, so extracted items remain traceable to blocks.
- Improved: inferred candidate fields are explicit (`inferred_field_count=4`) instead of silently treated as confirmed facts.
- Not improved yet: `field_accuracy` and `item_f1` remain `pending_gold`; the adapter is deterministic and does not yet use LLM semantic extraction.
- Risk: table row extraction is intentionally broad. It improves coverage and traceability, but item-level precision must be checked with gold labels before treating `item_f1` as improved.

Recommended next action:

1. Add gold labels for `judgment_basis`, `judgment_criteria`, `validation_methods`, and `resolution_methods`.
2. Add an LLM-backed `schema_guided_llm` or provider option behind the same extraction interface.
3. Upgrade Step 4 scoring to use `schema_guided_validation_report.json` directly for structural consistency and gap quality.

## 17. Step 4 Scorecard V2 Evaluation

This section records the Step 4 upgrade from lightweight heuristic scoring to a field-level scorecard that consumes schema-guided validation artifacts when available.

Implemented paths:

- Baseline compatibility remains available for non-`schema_guided` runs.
- Step 3 now stores `schema_guided_validation_report`, `schema_guided_evidence_map`, and `schema_guided_extraction_trace` in pipeline state.
- Step 4 now emits `field_score_diagnostics.v0.json` with per-field `filled`, `required`, `critical`, `field_weight`, `validation_status`, `item_count`, `source_ref_count`, `gap_priority`, and `risk_reasons`.
- `score_explanation.v0.json` now includes `top_risk_fields`, `field_level_reasons`, and `recommended_plan_targets`.
- Step 8 reuses the same schema-guided scoring context so V0/V1 delta is calculated with a consistent scoring basis.

Validation runs on the default `product_link_diagnosis` scene with `--parse-profile marked`:

| Run | Understanding profile | Extraction profile | Status | Artifacts |
| --- | --- | --- | --- | ---: |
| `step4-structured-hinted-baseline` | `structured_context` | `hinted` | completed | `62` |
| `step4-structured-schema-guided` | `structured_context` | `schema_guided` | completed | `64` |
| `step4-profile-table-schema-guided` | `profile_table` | `schema_guided` | completed | `60` |

Step 4 scorecard metrics:

| Metric | Structured hinted | Structured schema-guided | Profile/table schema-guided | Interpretation |
| --- | ---: | ---: | ---: | --- |
| `field_coverage` | `0.7901` | `0.9691` | `0.9691` | Now weighted by `EvaluationProfile.field_weights`. |
| `raw_field_coverage` | `0.7059` | `0.9412` | `0.9412` | Preserves historical simple coverage for comparison. |
| `source_grounding_rate` | `1` | `1` | `1` | Uses item-level `source_backed_item_rate` when validation report exists. |
| `structural_consistency` | `0.84` | `0.92` | `0.92` | Upgraded from fixed proxy to dependency-chain check. |
| `gap_detection_accuracy` | `0.55` | `0.7953` | `0.7953` | Uses schema-guided validation pass rate and priority-aware risks. |
| `inference_handling_accuracy` | `0.85` | `0.90` | `0.90` | Uses inferred candidate field boundaries. |
| `overall_status` | `blocked` | `needs_improvement` | `needs_improvement` | Only gap quality remains warning-level. |

Step 4 observability metrics:

| Metric | Structured schema-guided | Profile/table schema-guided | Result |
| --- | ---: | ---: | --- |
| `metric_explainability` | `0.90` | `0.90` | Pass; low score can be traced to field-level reasons. |
| `low_score_localization_accuracy` | `0.84` | `0.84` | Warn but improved over the previous proxy baseline. |
| `failing_metric_count` | `0` | `0` | No scorecard metric is below minimum. |
| `failing_field_count` | `1` | `1` | Field-level diagnostics identify one validation-failing field. |

Risk localization:

| Run | Top risk field | Reason |
| --- | --- | --- |
| Structured hinted | none | No schema-guided validation report, so no field-level validation risks. |
| Structured schema-guided | `page_screenshots` | Optional field has no grounded extraction. |
| Profile/table schema-guided | `page_screenshots` | Optional field has no grounded extraction. |

Interpretation:

- Improved: Step 4 now consumes Step 3 validation data instead of ignoring it.
- Improved: weighted coverage distinguishes high-value schema fields from low-priority optional fields while preserving `raw_field_coverage`.
- Improved: `score_explanation.v0.json` can directly feed Step 5/Plan with field targets such as `page_screenshots`.
- Improved: Step 8 no longer reports artificial regressions caused by comparing schema-guided V0 scoring with baseline V1 scoring.
- Not improved yet: `field_accuracy` and `item_f1` still remain skipped because there are no gold labels.

Recommended next action:

1. Let Step 5 consume `recommended_plan_targets` and `field_score_diagnostics.v0.json`.
2. Add gold labels so `field_accuracy`, `item_f1`, and `low_score_localization_accuracy` can become measured instead of proxy.
3. Add scenario-specific structural dependency rules beyond the current diagnostic chain.

## 18. Step 5 LLM Planner Evaluation

This section records the Step 5 upgrade from deterministic plan generation to replaceable planner profiles.

Implemented paths:

- Existing deterministic profile: `baseline`, selected by `--planner-profile baseline`.
- New LLM profiles: `deepseek` and `qwen_plus`, selected by `--planner-profile deepseek` / `--planner-profile qwen_plus`.
- New adapter modules under `src/planning/`: planner adapter interface, baseline planner, LLM prompt builder, LLM planner, and plan validator.
- New key config loader: `src/tools/key-config.ts`, which reads `key_config.md` as in-memory LLM config and never writes secrets to artifacts.
- New artifact: `agent_plan_generation_trace.json`, with provider, model, base host, prompt/response chars, duration, and fallback status.
- Step 5 now consumes Step 4 `score_explanation_v0` and `field_score_diagnostics_v0`, so `page_screenshots` is targeted directly from the risk explanation.

Validation runs on the default `product_link_diagnosis` scene with `--parse-profile marked`, `--understanding-profile structured_context`, and `--extraction-profile schema_guided`:

| Run | Planner profile | Status | Artifacts | Fallback |
| --- | --- | --- | ---: | --- |
| `step5-planner-baseline` | `baseline` | completed | `64` | no |
| `step5-planner-deepseek` | `deepseek` | completed | `62` | no |
| `step5-planner-qwen-plus` | `qwen_plus` | completed | `62` | no |

Step 5 metrics:

| Metric | Baseline | DeepSeek | Qwen-plus | Interpretation |
| --- | ---: | ---: | ---: | --- |
| `plan_coverage` | `0.90` | `0.90` | `0.90` | All profiles cover the target quality issue. |
| `plan_precision` | `0.80` | `0.82` | `0.82` | LLM profiles get a slightly higher proxy because they generate richer rationales. |
| `plan_actionability` | `0.90` | `0.90` | `0.90` | All generated steps are executable after validation. |
| `plan_step_count` | `5` | `4` | `4` | LLM profiles produce more compact plans. |
| `top_risk_fields_covered_rate` | `1` | `1` | `1` | All profiles cover `page_screenshots`. |
| `planner_fallback_count` | `0` | `0` | `0` | Both real LLM calls produced valid, non-fallback plans. |

LLM trace summary:

| Profile | Model | Duration | Prompt chars | Response chars |
| --- | --- | ---: | ---: | ---: |
| `deepseek` | `deepseek-v4-flash` | `27612ms` | `4397` | `1712` |
| `qwen_plus` | `qwen-plus` | `35360ms` | `4398` | `3245` |

Plan differences:

| Profile | Target metric distribution | Notes |
| --- | --- | --- |
| `baseline` | `field_coverage: 5` | Conservative field completion plan, driven by Step 4 targets and profile priority rules. |
| `deepseek` | `field_coverage: 4` | More compact plan, uses `validate_inference` for fields that require expert confirmation. |
| `qwen_plus` | `structural_consistency: 2`, `gap_detection_accuracy: 1`, `field_coverage: 1` | More metric-aware plan, directly maps steps to structural and gap-quality improvements. |

Interpretation:

- Improved: Step 5 now consumes Step 4 risk localization instead of only recomputing missing fields.
- Improved: LLM plans are schema-validated and normalized before being accepted.
- Improved: DeepSeek and Qwen-plus can both run from `key_config.md` without writing secrets to artifacts.
- Improved: invalid provider-specific `action_type` strings are normalized into runner-safe enum values, and invalid steps can be dropped without discarding an otherwise useful plan.
- Still proxy: `plan_precision`, `expected_score_gain_quality`, and `plan_acceptance_rate` need expert review labels before they become measured metrics.

Recommended next action:

1. Add expert review labels for plan quality: relevant target, correct evidence, executable expected output, and preferred ordering.
2. Let Step 6 support manual approval/editing of individual LLM-generated steps.
3. Let Step 7 execution use `action_type` more specifically instead of treating every plan step as a simple field-add operation.

## V6: Global Review Label Semantics

This upgrade fixes the first-pass review workbench semantics. Before this change, `schema_guided_evidence_map.json` was displayed as if every cited block belonged to every cited Schema field. That caused two user-facing problems:

- Duplicate tags: the same `block_id + field_key` could appear twice when both `schema_guided_evidence_map.json` and `structured_draft.v0.json.source_refs` cited it.
- Over-tagging: overview blocks such as the method definition or lifecycle summary were shown as direct labels for `deliverables`, `execution_steps`, and other fields, even though they are better understood as global framework evidence.

Implementation path:

- Step 2 `structured_context` now emits `block_role_map.json`, assigning each block one primary role such as `overview_statement`, `process_model`, `metric_basis`, `action_method`, or `validation_rule`.
- Step 3 schema-guided evidence selection now scores candidates with signal match, block role fit, section context, field boundary penalties, and global fit.
- `SchemaProfile.YAML` now includes `field_boundary_rules` for high-risk fields including `business_scenario`, `deliverables`, `execution_steps`, and `process_flow_or_business_model`.
- `review_workbench.json` now includes `block_annotations`, where each block has one primary semantic label plus folded supporting field references.

New review metrics:

| Metric | Meaning | Desired direction |
| --- | --- | --- |
| `duplicate_tag_rate` | Same block and field shown more than once | Lower is better |
| `over_tagged_block_rate` | Blocks with more than 3 direct field references | Lower is better |
| `primary_label_coverage` | Blocks with a non-unknown primary semantic label | Higher is better |
| `field_boundary_violation_count` | Rejected evidence candidates due to field boundary rules | Used for observability |
| `overview_block_overclaim_rate` | Overview/process blocks rejected from action/deliverable fields | Lower after final selection; useful for debugging |

Expected behavior on `product_link_diagnosis`:

- `b2` should no longer show duplicate “业务场景” tags.
- `b8` should show one primary semantic label such as “流程模型”, while field references are folded as supporting evidence.
- `execution_steps` and `deliverables` should prefer concrete action/output blocks and not use the method overview as primary evidence.
