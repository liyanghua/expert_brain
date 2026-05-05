# Agent Mode Runner Implementation Log

本文件只记录 `apps/agent-mode-runner/` 独立后端 runner 的阶段性实施结果。规格源保持只读：`docs/Agent_mode.md` 与 `docs/Agent_mode_pipeline.YAML`。

## 记录模板

```markdown
## Step N: <name>
- 完成时间：
- 本次完成：
- 产物路径：
- 验证命令：
- 指标结果：
- 问题与风险：
- 下一步：
```

## Step 0: Profiles 场景注册
- 完成时间：2026-05-02 21:10 CST
- 本次完成：在 `apps/agent-mode-runner/` 内实现默认业务文档场景、schema profile、expert guidance profile、evaluation profile，不修改外围包。
- 产物路径：`data/agent-mode-runs/run_699cf5f7-e739-4fbc-b3c8-48bf1c6aa7aa/scene_binding.json`、`schema_profile.json`、`expert_guidance_profile.json`、`evaluation_profile.json`、`threshold_report.step_0.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --input data/fixtures/sample.md`
- 指标结果：profile load measured pass；scene match / wrong profile 以 proxy 记录，未伪装成人工 gold。
- 问题与风险：当前只有默认业务文档场景，后续需要接真实 profile registry。
- 下一步：继续扩展 profile selection 与行业专家提示词版本管理。

## Step 1: Parse / Normalize
- 完成时间：2026-05-02 21:10 CST
- 本次完成：实现 runner 内置 Markdown parser adapter，输出 `DocumentIR` 与 parse diagnostics，避免依赖未构建的外围 package dist。
- 产物路径：`data/agent-mode-runs/run_699cf5f7-e739-4fbc-b3c8-48bf1c6aa7aa/document_ir.json`、`parse_diagnostics.json`、`threshold_report.step_1.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner test`；CLI smoke 同上。
- 指标结果：parse success measured pass；block integrity / heading preservation / table preservation 按 proxy 或 measured 输出。
- 问题与风险：Docling/Marker/MinerU 目前仅保留工具注册与替换位，尚未真实接入。
- 下一步：补真实文件格式解析 adapter 的 A/B 接口。

## Step 2: Hierarchical Understanding
- 完成时间：2026-05-02 21:10 CST
- 本次完成：实现 `DocumentMap`、`SectionCard[]`、`DocumentUnderstanding`、`ContextCoverage`，Plan 与执行阶段都引用局部 block 证据。
- 产物路径：`data/agent-mode-runs/run_699cf5f7-e739-4fbc-b3c8-48bf1c6aa7aa/document_map.json`、`section_cards.json`、`document_understanding.json`、`coverage.step2.json`、`threshold_report.step_2.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`
- 指标结果：summary coverage / grounding pass；faithfulness 与 theme accuracy 以 proxy 记录。
- 问题与风险：摘要仍是启发式抽取，未接 LLM/人工 faithful eval。
- 下一步：接 section-first LLM 摘要与 contextual retrieval 增强。

## Step 3-5: 结构化抽取、初始评分、Agent Plan
- 完成时间：2026-05-02 21:10 CST
- 本次完成：实现启发式 `StructuredExtractor`、本地 scorecard、scorecard-guided plan；每个 PlanStep 绑定 target metric、target field、evidence blocks 与 expected output。
- 产物路径：`structured_draft.v0.json`、`gaps.v0/coverage.step3.json`、`scorecard.v0.json`、`score_explanation.v0.json`、`agent_plan.v0.json`、`coverage.step5.json`、对应 `threshold_report.step_3/4/5.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner test`
- 指标结果：field accuracy / item F1 使用 `pending_gold`；plan actionability measured/proxy pass。
- 问题与风险：抽取质量是 runner 第一版启发式能力，不代表最终 LLM schema extraction 效果。
- 下一步：替换为 schema-guided LLM extractor，并接 gold set 评估。

## Step 6-7: Expert Approval 与分步补强
- 完成时间：2026-05-02 21:10 CST
- 本次完成：实现 `--approval auto` 路径与分步执行器；每步输出 input/output/diff，并生成 `structured_draft_candidate_v1.json`。
- 产物路径：`approval_log.json`、`approved_agent_plan.json`、`steps/<step_id>/step_input.json`、`step_output.json`、`step_diff.json`、`document_v_next.json`、`structured_draft_candidate_v1.json`
- 验证命令：CLI smoke 同上。
- 指标结果：step completion pass；source-backed change measured pass；inference overreach 以 proxy 记录。
- 问题与风险：manual approval JSON 和专家编辑回放尚未接入。
- 下一步：补 manual-json approval schema 与拒绝/编辑分支测试。

## Step 8-9: Re-extraction、Score Delta、Expert Review
- 完成时间：2026-05-02 21:10 CST
- 本次完成：实现 v1 重评分、score delta、mock expert review、strategy feedback 与 `run_summary.json`。
- 产物路径：`structured_draft.v1.json`、`scorecard.v1.json`、`score_delta.json`、`expert_review.json`、`strategy_feedback.json`、`run_summary.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner run smoke -- --input data/fixtures/sample.md`
- 指标结果：sample run `net_quality_gain=0.2632`，`regressed_fields_count=0`，mock expert overall score `4`。
- 问题与风险：expert review 当前为 mock，metric-expert correlation 标记为 `pending_gold`。
- 下一步：接真实专家评分 JSON 与策略回流分析。

## Final Verification
- 完成时间：2026-05-02 21:10 CST
- 本次完成：完成 runner package、CLI、tests、artifact registry、run logger、threshold checker 与 9 步 pipeline。
- 产物路径：`apps/agent-mode-runner/`；`data/agent-mode-runs/run_699cf5f7-e739-4fbc-b3c8-48bf1c6aa7aa/run_summary.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --input data/fixtures/sample.md`
- 指标结果：typecheck pass；Node test 4/4 pass；CLI smoke completed，artifact_count=53，step_count=10。
- 问题与风险：首次 CLI smoke 在沙箱内因 `tsx` IPC pipe `EPERM` 失败，非沙箱重跑通过；runner 使用本地 adapter 避免改外围 package dist。
- 下一步：进入第二阶段真实 LLM/开源解析工具 adapter 接入与人工 gold 评估集建设。

## Step 0 Upgrade: 场景注册表与 Profile 资产加载
- 完成时间：2026-05-02 22:07 CST
- 本次完成：将 Step 0 从硬编码默认 profile 升级为 runner 内部 `scenes/registry.json` + `product_link_diagnosis/` 场景目录；Step 0 现在按 `--scene product_link_diagnosis` 加载 `source.md`、`SchemaProfile.YAML`、`ExpertGuidanceProfile.YAML`、`EvaluationProfile.YAML`，并输出真实 profile artifacts。
- 产物路径：`apps/agent-mode-runner/scenes/registry.json`、`apps/agent-mode-runner/scenes/product_link_diagnosis/`；验证 run：`data/agent-mode-runs/run_372c08ea-84f4-4040-8146-8cf5d0551054/scene_binding.json`、`profile_load_diagnostics.json`、`agent_plan.v0.json`、`run_summary.json`
- 验证命令：`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis`
- 指标结果：typecheck pass；Node test 6/6 pass；scene smoke completed，artifact_count=55，step_count=10；`scene_binding.scene_id=product_link_diagnosis`；Plan 优先补 `judgment_criteria`、`validation_methods`、`termination_conditions`。
- 问题与风险：YAML loader 是 runner 内的轻量解析器，目前只解析本阶段需要的字段；`scene_match_accuracy` 仍是 proxy，因为本阶段明确不做文档场景分类。
- 下一步：把 Profile 继续下沉到更真实的 LLM/schema-guided 抽取、hard gates 和人工 gold eval；后续可支持多个场景目录与 profile 版本对比。

## Step 1 Upgrade: Marked Markdown Adapter
- 完成时间：2026-05-02 23:01 CST
- 本次完成：在 `apps/agent-mode-runner/` 内新增 `markedMarkdownParserAdapter`，扩展 `--parse-profile builtin|marked|docling`；`marked` adapter 基于 Markdown tokens 输出 `DocumentIR`，支持 heading、paragraph、list、table、image-like block，并保留 `Lx-Ly` source span。
- 产物路径：`apps/agent-mode-runner/src/parsers/marked-markdown-parser.ts`、`apps/agent-mode-runner/tests/parser-adapter.test.ts`、`apps/agent-mode-runner/tests/pipeline.test.ts`；评估 run：`data/agent-mode-runs/run_step1_marked_compare_builtin/`、`data/agent-mode-runs/run_step1_marked_eval/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis --parse-profile builtin --run-id run_step1_marked_compare_builtin`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis --parse-profile marked --run-id run_step1_marked_eval`。
- 指标结果：默认场景下 `marked` run completed；Step 1 overall status 从 builtin `warn` 变为 marked `pass`；`table_count` 从 `0` 提升到 `6`；`block_count=58`、`heading_count=14`、`source_span_completeness=1` 保持稳定；下游 `field_coverage`、`source_grounding_rate`、`net_quality_gain` 暂无变化。
- 问题与风险：`parse_duration_ms` 从 `1` 增至 `7`，仍可接受；下游启发式抽取尚未显式利用 table block，因此结构解析提升尚未转化为 scorecard 提升。
- 下一步：增加 table-heavy Markdown fixture，并让 Step 2/3 在 section understanding 和 evidence selection 中显式使用 `table` blocks。

## Step 2 Upgrade: Understanding Adapter 与 Profile/Table-Aware 理解
- 完成时间：2026-05-02 23:21 CST
- 本次完成：将 Step 2 改为可替换 `UnderstandingAdapter`，保留 `baseline`，新增 `profile_table`；`profile_table` 使用 `SchemaProfile.field_definitions`、`ExpertGuidanceProfile.field_guidance` 与 table blocks 生成字段信号和 `section_evidence_hints.json`，便于 A/B 对比。
- 产物路径：`apps/agent-mode-runner/src/understanding/understanding-adapter.ts`、`apps/agent-mode-runner/src/understanding/understanding-adapters.ts`、`apps/agent-mode-runner/tests/understanding-adapter.test.ts`、`apps/agent-mode-runner/tests/pipeline.test.ts`；评估 run：`data/agent-mode-runs/run_step2_profile_table_baseline/`、`data/agent-mode-runs/run_step2_profile_table_eval/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis --parse-profile marked --understanding-profile baseline --run-id run_step2_profile_table_baseline`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis --parse-profile marked --understanding-profile profile_table --run-id run_step2_profile_table_eval`。
- 指标结果：两组 smoke completed；`understanding_profile` 已写入 `run_summary.json`；`profile_table` 额外输出 `section_evidence_hints.json`；新增指标 `table_utilization_rate=1`、`profile_field_signal_coverage=0.5882`；下游 `field_coverage`、`source_grounding_rate`、`net_quality_gain` 暂无变化，`regressed_fields_count=0`。
- 问题与风险：profile/table-aware 目前仍是确定性字符串信号，不等于语义准确率；Step 3 尚未消费 `section_evidence_hints`，因此 Step 2 的结构化理解提升还没有转化为 scorecard 提升。
- 下一步：升级 Step 3 evidence selection，让 `judgment_basis`、`judgment_criteria`、`validation_methods`、`tool_templates` 优先使用 table-backed evidence，并加入 table-heavy gold fixture。

## Step 3 Upgrade: Extraction Adapter 与 Hinted Evidence 消费
- 完成时间：2026-05-02 23:40 CST
- 本次完成：将 Step 3 改为可替换 `ExtractionAdapter`，保留 `baseline`，新增 `hinted`；`hinted` 读取 Step 2 的 `section_evidence_hints`，优先使用 table-backed evidence 抽取 `judgment_basis`、`judgment_criteria`、`validation_methods`、`tool_templates`，并输出 `extraction_evidence_trace.json`。
- 产物路径：`apps/agent-mode-runner/src/extraction/extraction-adapter.ts`、`apps/agent-mode-runner/src/extraction/extraction-adapters.ts`、`apps/agent-mode-runner/tests/extraction-adapter.test.ts`、`apps/agent-mode-runner/tests/pipeline.test.ts`；评估 run：`data/agent-mode-runs/run_step3_hinted_baseline_v2/`、`data/agent-mode-runs/run_step3_hinted_eval_v2/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis --parse-profile marked --understanding-profile profile_table --extraction-profile baseline --run-id run_step3_hinted_baseline_v2`；`pnpm --filter @ebs/agent-mode-runner run smoke -- --scene product_link_diagnosis --parse-profile marked --understanding-profile profile_table --extraction-profile hinted --run-id run_step3_hinted_eval_v2`。
- 指标结果：两组 smoke completed；Step 3 `field_coverage` 从 `0.5882` 提升到 `0.7059`，状态从 `fail` 变为 `warn`；`covered_fields` 从 `10/17` 提升到 `12/17`；`source_grounding_rate=1` 保持；`judgment_basis`、`judgment_criteria`、`validation_methods`、`tool_templates` 均在 trace 中标记为 `hinted_table_evidence`。
- 问题与风险：语义正确性尚未 gold 验证，`field_accuracy` 和 `item_f1` 仍是 `pending_gold`；由于 hinted V0 已达到 baseline V1 的 coverage，Step 8 `net_quality_gain` 从 `0.1177` 变为 `0`，这代表初始抽取更强而不是执行退化。
- 下一步：为 table-heavy 字段补 gold labels；升级 Step 4 区分 initial quality lift 与 post-plan delta；让 Step 7 避免重复处理 hinted 已补齐字段。

## Step 2 Upgrade: Structured Context 理解层
- 完成时间：2026-05-03 00:18 CST
- 本次完成：基于 `docs/doc_understanding.md` 在 runner 内新增 `structured_context` understanding profile；保留 `baseline` / `profile_table`，新增 H2 主粒度 `structured_sections`、结构化 section summaries、基于 summaries 的 `document_synthesis`，以及覆盖每个 block 的四层 `contextualized_blocks`。同时继续输出 `section_evidence_hints.json`，保证 Step 3 `hinted` 可继续消费。
- 产物路径：`apps/agent-mode-runner/src/types.ts`、`apps/agent-mode-runner/src/understanding/understanding-adapter.ts`、`apps/agent-mode-runner/src/understanding/understanding-adapters.ts`、`apps/agent-mode-runner/src/steps/step2-understanding.ts`、`apps/agent-mode-runner/src/cli.ts`、`apps/agent-mode-runner/tests/understanding-adapter.test.ts`、`apps/agent-mode-runner/tests/pipeline.test.ts`；评估 run：`data/agent-mode-runs-step2-structured/step2-profile-table-hinted/`、`step2-structured-baseline/`、`step2-structured-hinted/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step2-profile-table-hinted --output-root data/agent-mode-runs-step2-structured --scene product_link_diagnosis --parse-profile marked --understanding-profile profile_table --extraction-profile hinted`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step2-structured-baseline --output-root data/agent-mode-runs-step2-structured --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile baseline`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step2-structured-hinted --output-root data/agent-mode-runs-step2-structured --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile hinted`。
- 指标结果：Node test 21/21 pass；typecheck pass；三组 smoke completed。`structured_context` 新增 `structured_section_count=4`、`structured_summary_coverage=1`、`contextualized_block_coverage=1`、`structured_summary_grounding_rate=1`；保持 `table_utilization_rate=1`、`profile_field_signal_coverage=0.5882`、`source_grounding_rate=1`、`regressed_fields_count=0`。与 `hinted` 搭配时 V0 `field_coverage=0.7059`，不低于 `profile_table + hinted`。
- 问题与风险：本轮仍是确定性摘要与字符串信号，`summary_faithfulness`、`theme_goal_accuracy` 仍为 proxy，`field_accuracy` 和 `item_f1` 仍需 gold labels。H2 压缩后 `summary_compression_ratio=0.0690`，默认场景合理，但后续需要在多文档上验证是否过度压缩。
- 下一步：让 Step 5 Plan 与后续 QA/rewrite 读取 `contextualized_blocks.json`；在同一 `UnderstandingAdapter` 接口下新增 LLM structured summary profile；补 gold labels 评估语义准确率。

## Step 3 Upgrade: Schema-Guided Adapter
- 完成时间：2026-05-03 01:09 CST
- 本次完成：在 runner 内新增 `schema_guided` extraction profile，保留 `baseline` / `hinted`；新增 field plan builder、source-grounded evidence selector、typed field extractors 和 draft validator。新 adapter 借鉴 LangExtract 的 source-grounded extraction 思想，以及 BAML/Instructor 的 typed structured output 边界，但本轮不引入重依赖。
- 产物路径：`apps/agent-mode-runner/src/extraction/schema-guided/field-plan.ts`、`evidence-selector.ts`、`field-extractors.ts`、`draft-validator.ts`、`schema-guided-adapter.ts`；同时更新 `types.ts`、`extraction-adapter.ts`、`extraction-adapters.ts`、`step3-structuring.ts`、`cli.ts`、`tests/extraction-adapter.test.ts`、`tests/pipeline.test.ts`。评估 run：`data/agent-mode-runs-step3-schema-guided/step3-schema-hinted-baseline/`、`step3-schema-structured-eval/`、`step3-schema-profile-table-eval/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step3-schema-hinted-baseline --output-root data/agent-mode-runs-step3-schema-guided --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile hinted`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step3-schema-structured-eval --output-root data/agent-mode-runs-step3-schema-guided --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile schema_guided`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step3-schema-profile-table-eval --output-root data/agent-mode-runs-step3-schema-guided --scene product_link_diagnosis --parse-profile marked --understanding-profile profile_table --extraction-profile schema_guided`。
- 指标结果：Node test 23/23 pass；typecheck pass；三组 smoke completed。`schema_guided` 下 Step 3 `field_coverage=0.9412`，从 `warn` 变为 `pass`；`source_grounding_rate=1`；新增 `typed_validation_pass_rate=0.9412`、`source_backed_item_rate=1`、`inferred_field_count=4`、`gap_count=1`、`table_row_extraction_count=122`（structured_context）/`83`（profile_table）。Step 4 V0 `overall_status` 从 hinted 的 `blocked` 改善为 `needs_improvement`，`regressed_fields_count=0`。
- 问题与风险：本轮仍是 deterministic thin layer，不代表 LLM 语义准确率；`field_accuracy` 和 `item_f1` 仍需 gold labels。table row extraction 覆盖较强，可能带来 item 粒度噪声，必须通过 gold set 验证精度。
- 下一步：补 gold labels；让 Step 4 直接消费 `schema_guided_validation_report.json`；在相同 adapter 接口下增加 LLM-backed schema-guided provider。

## Step 4 Upgrade: Scorecard V2 字段级评分
- 完成时间：2026-05-03 01:38 CST
- 本次完成：升级 Step 4 初始评分，让 scorecard 在存在 `schema_guided_validation_report` 时消费 Step 3 validation/evidence/trace；新增字段级诊断产物，输出每个字段的 filled/required/critical/weight/status/item/source/gap priority/risk reasons；`field_coverage` 改为 weighted coverage，同时保留 `raw_field_coverage`；`source_grounding_rate` 优先使用 item-level `source_backed_item_rate`；`structural_consistency`、`gap_detection_accuracy`、`inference_handling_accuracy` 改为 schema-guided aware proxy；`score_explanation.v0.json` 增加 `top_risk_fields`、`field_level_reasons`、`recommended_plan_targets`。Step 8 重评分复用同一 schema-guided scoring context，避免 V0/V1 评分口径不一致。
- 产物路径：`apps/agent-mode-runner/src/tools/scoring.ts`、`apps/agent-mode-runner/src/steps/step3-structuring.ts`、`apps/agent-mode-runner/src/steps/step4-scorecard.ts`、`apps/agent-mode-runner/src/steps/step8-rescore.ts`、`apps/agent-mode-runner/src/types.ts`、`apps/agent-mode-runner/tests/scoring.test.ts`、`apps/agent-mode-runner/tests/pipeline.test.ts`；评估 run：`data/agent-mode-runs-step4-scorecard-upgrade/step4-structured-hinted-baseline/`、`step4-structured-schema-guided/`、`step4-profile-table-schema-guided/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step4-structured-hinted-baseline --output-root data/agent-mode-runs-step4-scorecard-upgrade --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile hinted`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step4-structured-schema-guided --output-root data/agent-mode-runs-step4-scorecard-upgrade --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile schema_guided`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step4-profile-table-schema-guided --output-root data/agent-mode-runs-step4-scorecard-upgrade --scene product_link_diagnosis --parse-profile marked --understanding-profile profile_table --extraction-profile schema_guided`。
- 指标结果：Node test 25/25 pass；typecheck pass；三组 smoke completed。schema-guided 两组 Step 4 `field_coverage=0.9691`、`raw_field_coverage=0.9412`、`source_grounding_rate=1`、`structural_consistency=0.92`、`gap_detection_accuracy=0.7953`、`inference_handling_accuracy=0.9`；`overall_status=needs_improvement`。`metric_explainability=0.90` pass，`low_score_localization_accuracy=0.84` warn，`failing_metric_count=0`，`failing_field_count=1`。`top_risk_fields` 定位到 `page_screenshots`，原因是 optional field has no grounded extraction。
- 问题与风险：`field_accuracy` 与 `item_f1` 仍因缺 gold labels 保持 skipped；`gap_detection_accuracy` 和 `low_score_localization_accuracy` 仍是 proxy，不应当当作真实人工准确率；当前 structural consistency 只覆盖通用诊断链，后续需要场景化 dependency rules。
- 下一步：让 Step 5 Plan 直接消费 `field_score_diagnostics.v0.json` / `recommended_plan_targets`；补 gold labels，把 `field_accuracy`、`item_f1`、`low_score_localization_accuracy` 从 proxy 推进到 measured；增加场景特定 structural dependency 配置。

## Step 5 Upgrade: LLM Planner
- 完成时间：2026-05-03 02:25 CST
- 本次完成：将 Step 5 从内联 deterministic planner 升级为 `PlannerAdapter` 架构，保留 `baseline`，新增 `deepseek` 与 `qwen_plus` planner profile；Step 5 现在消费 Step 4 的 `score_explanation_v0` 与 `field_score_diagnostics_v0`，优先覆盖 `recommended_plan_targets` 和 top risk fields。新增 `key_config.md` loader，读取 DeepSeek/DashScope 配置但不把 secret 写入 artifact；新增 LLM prompt、OpenAI-compatible client、AgentPlan validator、provider trace 和 fallback 机制。validator 会把 LLM 常见 action_type 表达归一化为 runner 安全枚举，并丢弃非法 step，而不是丢弃整份可用计划。
- 产物路径：`apps/agent-mode-runner/src/planning/planner-adapter.ts`、`baseline-planner.ts`、`llm-planner.ts`、`llm-planner-prompt.ts`、`agent-plan-validator.ts`、`apps/agent-mode-runner/src/tools/key-config.ts`；同时更新 `types.ts`、`step4-scorecard.ts`、`step5-plan.ts`、`cli.ts`、`pipeline.ts`、`tests/planner-adapter.test.ts`、`tests/pipeline.test.ts`。评估 run：`data/agent-mode-runs-step5-llm-planner/step5-planner-baseline/`、`step5-planner-deepseek/`、`step5-planner-qwen-plus/`。
- 验证命令：`pnpm --filter @ebs/agent-mode-runner test`；`pnpm --filter @ebs/agent-mode-runner typecheck`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step5-planner-baseline --output-root data/agent-mode-runs-step5-llm-planner --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile schema_guided --planner-profile baseline`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step5-planner-deepseek --output-root data/agent-mode-runs-step5-llm-planner --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile schema_guided --planner-profile deepseek`；`pnpm --filter @ebs/agent-mode-runner smoke -- --run-id step5-planner-qwen-plus --output-root data/agent-mode-runs-step5-llm-planner --scene product_link_diagnosis --parse-profile marked --understanding-profile structured_context --extraction-profile schema_guided --planner-profile qwen_plus`。
- 指标结果：Node test 30/30 pass；typecheck pass；三组 smoke completed。baseline / DeepSeek / Qwen-plus 的 `plan_coverage=0.90`、`top_risk_fields_covered_rate=1`、`planner_fallback_count=0`。DeepSeek 使用 `deepseek-v4-flash`，`duration_ms=27612`，生成 4 步计划；Qwen-plus 使用 `qwen-plus`，`duration_ms=35360`，生成 4 步计划。DeepSeek target metric distribution 为 `field_coverage:4`；Qwen-plus 为 `structural_consistency:2`、`gap_detection_accuracy:1`、`field_coverage:1`。三组 Step 8 `net_quality_gain=0.0897`，`regressed_fields_count=0`。
- 问题与风险：`plan_precision` 仍是 proxy，不能替代专家对 plan 质量的判断；Qwen-plus 会生成更自由的 target metric 和 action_type，需要持续保留 validator/normalizer；当前 Step 7 对 action_type 的执行仍偏通用，尚未充分利用 LLM plan 的细粒度意图。
- 下一步：补专家 plan quality labels；让 Step 6 支持人工逐步编辑/批准 LLM plan；让 Step 7 针对 `validate_inference`、`request_expert_input`、`rebind_sources` 等 action type 做差异化执行。
