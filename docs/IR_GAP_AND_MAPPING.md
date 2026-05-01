# IR.md ↔ 代码库对齐说明（迁移策略）

本文档对应升级计划中的「gap-current-vs-ir-md」交付物：**不修改** `docs/IR.md` 规范语义；代码侧采用 **单 Schema 扩展（`GroundTruthDraft` = IR.md 所称 `BusinessDocStructuredDraft` 的工程名）**。

## 1. 命名策略

| IR.md 名称 | 代码类型名 | 说明 |
|------------|------------|------|
| `BusinessDocStructuredDraft` | `GroundTruthDraft` | 保留现有导出名；可选 `schema_name` 标明业务别名 |

## 2. 字段对照（IR.md §2.2 ↔ `packages/ground-truth-schema`）

| IR.md `fields.*` | TS 字段 | 策略 |
|------------------|---------|------|
| `business_scenario` | `business_scenario` | 保持 |
| `scenario_goal` | `scenario_goal` | 保持 |
| `required_inputs` | `required_inputs` | 新增列表字段 |
| `deliverables` | `deliverables` | 保持 |
| `process_flow_or_business_model` | `process_flow_or_business_model` | 新增 |
| `execution_steps` | `execution_steps` | 新增；规则抽取与 `execution_actions` 同步填充 |
| `key_node_rationales` | `key_node_rationales` | 保持 |
| `page_screenshots` | `page_screenshots` | 保持 |
| `faq_types` | `faq_types` | 保持 |
| `judgment_basis` | `judgment_basis` | 保持 |
| `judgment_criteria` | `judgment_criteria` | 保持 |
| `resolution_methods` | `resolution_methods` | 保持 |
| `trigger_conditions` | `trigger_conditions` | 保持 |
| `termination_conditions` | `termination_conditions` | 保持 |
| `validation_methods` | `validation_methods` | 保持 |
| `tool_templates` | `tool_templates` | 保持 |
| `exceptions_and_non_applicable_scope` | `exceptions_and_non_applicable_scope` | 新增 |
| （PRD）思维框架类 | `thinking_framework` | 保留 |
| （PRD）执行动作 | `execution_actions` | 保留，与 `execution_steps` 同步 |

## 3. `document_meta`

写入 `GroundTruthDraft.document_meta`（`document_id`、`title`、`source_files` 等）。

## 4. `gaps` 四分法

新增 `gaps_structured`：`missing_fields` / `weak_fields` / `inferred_fields` / `needs_confirmation_fields`。保留原 `gaps[]` 便于兼容。

## 5. `field_status`

IR.md 小写与 TS Pascal 枚举互转：导出 `fieldStatusToIr` / `fieldStatusFromIr`。

## 6. `global_scores`

`GroundTruthDraft.global_scores`：`completeness_score`、`extraction_confidence_score`、`grounding_score`。

## 7. Document IR

`SourceRef` 增加可选 `source_file`。`DocumentBlock` 增加可选 `media_uri`（派生资源 API 路径）。

## 8. Docling 与 Grounding

Docling 输出经 Markdown→blocks 映射后，强化 `page_no` / `source_span`，支撑 IR.md §3.5。
