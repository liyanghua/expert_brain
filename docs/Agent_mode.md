 **Agent Mode**，整体方案

这套方案的目标是：

* **可执行**：每一步知道做什么
* **可替换**：每一步都能换工具
* **可评估**：每一步都有指标
* **可观测**：每一步都有 trace / log / artifact
* **可闭环**：最后证明文档质量提升

Docling、Marker、MinerU 都适合做文档解析与标准化；GraphRAG 适合做图增强检索；LangGraph 适合做有状态执行与人工介入；Langfuse 和 Phoenix 适合做 LLM/Agent 可观测与评估；Hyper-Extract 的强类型、模板化、增量 feed 思想很适合借到抽取层；Hermes Agent 的“memory + skills + self-improvement”思路适合借到右侧 Agent 内核。([GitHub][1])

---

# 1. 整体 Agent Mode 架构

## 1.1 总链路

```text id="agent-mode-end-to-end"
Raw Document
→ Parse & Normalize
→ Document IR
→ Hierarchical Understanding
→ Structured Extraction
→ Extraction Scorecard v0
→ Agent Plan
→ Expert Approval
→ Step-by-step Improvement Run
→ Structured Re-Extraction
→ Extraction Scorecard v1
→ Expert Review
→ Strategy Update
```

这条链里，**长文档理解优化** 主要放在前三层：

* Parse & Normalize
* Hierarchical Understanding
* Structured Extraction

这样右侧 Agent 就不是“每次重读整篇文档”，而是读：

* `Document IR`
* `Section Summaries`
* `BusinessDocStructuredDraft`
* `Scorecard`
* `AgentPlan`

---

## 1.2 核心原则

### 原则 A：全文不直接塞给 LLM

长文档不能直接靠大上下文硬吃，而是要分层理解。

### 原则 B：先结构化，再交互

先产出 `Document IR`、`DocumentUnderstanding`、`StructuredDraft`，再让 Agent 补强。

### 原则 C：每一步都是状态机节点

每一步都有输入、输出、状态、日志、指标。

### 原则 D：低分指标驱动下一步动作

Scorecard 不是展示分数，而是自动生成补强计划。

---

# 2. 执行计划：分 9 步

---

## Step 0：场景注册与配置注入

### 做什么

给每类业务文档绑定：

* `SchemaProfile`
* `ExpertGuidanceProfile`
* `EvaluationProfile`

### 怎么做

输入文档前先选场景，例如：

* 链接诊断
* 内容策划
* 主图优化
* SOP / Playbook

然后加载对应配置：

```yaml id="scene-config-example"
scene: link_diagnosis

schema_profile_ref: schema.link_diagnosis.v1
expert_guidance_profile_ref: guidance.link_diagnosis.expert.v1
evaluation_profile_ref: eval.link_diagnosis.v1
```

### 借鉴工具

这一层不依赖外部工具，建议自研配置中心即可。
可以借鉴 Hyper-Extract 的 template-first 思路：把抽取目标和方法显式模板化。([GitHub][2])

### 可评估

* 场景识别是否正确
* 绑定的 schema 是否完整
* 提示词 / guidance 是否加载成功

### 可观测

记录：

* scene_id
* schema_version
* guidance_version
* eval_profile_version

---

## Step 1：文档解析与标准化

### 做什么

把原始文档转成高保真的 `Document IR`。

### 怎么做

保留：

* block_id
* block_type
* heading_level
* parent / children
* source_span
* page_no / sheet_name / node_path
* tables / images / captions / outline

推荐对象：

```yaml id="document-ir-example"
DocumentIR:
  doc_id:
  blocks:
    - block_id:
      block_type:
      text_content:
      heading_level:
      parent_block_id:
      children_block_ids: []
      source_file:
      source_span:
      page_no:
      sheet_name:
      node_path:
      attachment_refs: []
```

### 可替换工具

首选做 A/B：

* **Docling**：多格式、统一表示、版面/表格/阅读顺序强。([GitHub][1])
* **Marker**：转 Markdown / JSON / chunks 很适合工作台。([GitHub][3])
* **MinerU**：Office-heavy、图文混排重场景可并测。([GitHub][4])

### 可评估

新增解析层指标：

* Parse Success Rate
* Block Integrity Rate
* Heading Preservation Rate
* Table Preservation Rate
* Source Span Completeness

### 可观测

每次解析都记录：

* parser_name
* parser_version
* input_type
* block_count
* table_count
* image_count
* parse_duration_ms
* parse_warnings

并保存 artifact：

* `document_ir.json`

---

## Step 2：层级化文档理解

### 做什么

解决长文档理解受上下文压缩影响的问题。

### 怎么做

不要直接全文摘要，而是分层做：

1. block summaries
2. section summaries
3. document understanding

新增对象：

```yaml id="document-understanding-example"
DocumentUnderstanding:
  document_theme:
  business_scene:
  primary_goal:
  section_summaries:
    - section_id:
      summary:
      source_block_ids: []
  key_signals: []
  likely_gaps: []
  confidence:
```

### 为什么这么做

这样右侧 Agent 以后优先读：

* 当前 block
* parent section summary
* document understanding
  而不是反复压整篇文档。

### 可替换工具 / 方案

* **RAPTOR 思想**：递归聚类 + 层级摘要，非常适合长文档的多层理解。([GitHub][5])
* 可先自研轻量版：

  * section-first summaries
  * top-level synthesis

### 可评估

* Section Summary Coverage
* Summary Faithfulness
* Summary Grounding Rate
* Theme/Goal Accuracy

### 可观测

保存 artifacts：

* `section_summaries.json`
* `document_understanding.json`

记录：

* section_count
* summary_token_usage
* summary_duration_ms

---

## Step 3：结构化抽取

### 做什么

根据 `SchemaProfile` 和 `ExpertGuidanceProfile` 把文档抽成 `BusinessDocStructuredDraft`。

### 怎么做

字段还是你前面定义的这一套：

* business_scenario
* scenario_goal
* required_inputs
* deliverables
* process_flow_or_business_model
* execution_steps
* key_node_rationales
* page_screenshots
* faq_types
* judgment_basis
* judgment_criteria
* resolution_methods
* trigger_conditions
* termination_conditions
* validation_methods
* tool_templates
* exceptions_and_non_applicable_scope

并且每个字段必须带：

* confidence
* source_refs
* field_status

### 长文档优化如何融入

这里不要“一次抽全”硬跑，而是分三层抽：

1. 文档级字段
2. section/list 字段
3. inferred/weak 字段

### 可替换工具 / 方案

* **Hyper-Extract 思想**：强类型、模板化、增量 feed，最适合借到这一层。([GitHub][2])
* 你可以自研 `SchemaProfile + extractor`，但抽取模板设计可强借鉴它。

### 可评估

这里直接算你前面定义的 8 项指标的前 7 项（Human Revision 先空）：

* Field Coverage
* Field Accuracy
* Item F1
* Source Grounding Rate
* Structural Consistency
* Gap Detection Accuracy
* Inference Handling Accuracy

### 可观测

保存：

* `structured_draft.v0.json`
* `gaps.json`

记录：

* extraction_method
* schema_version
* field_count_non_empty
* inferred_field_count
* extraction_duration_ms

---

## Step 4：初始评分

### 做什么

对 `StructuredDraft v0` 计算评分，生成第一版 `ExtractionScorecard`。

### 怎么做

输出：

```yaml id="scorecard-example"
ExtractionScorecard:
  version_id: v0
  scores:
    field_coverage:
    field_accuracy:
    item_f1:
    source_grounding_rate:
    structural_consistency:
    gap_detection_accuracy:
    inference_handling_accuracy:
    human_revision_rate:
  below_threshold: []
  overall_status:
```

### 可替换工具

这一层建议自研，因为评分逻辑和你的产品定义高度绑定。

### 可评估

评分本身要再评两件事：

* Score Stability
* Metric Explainability

### 可观测

保存：

* `scorecard.v0.json`

记录：

* metric calculation time
* rules hit
* failing fields
* failing items

---

## Step 5：生成 Agent Plan

### 做什么

不是直接改文档，而是先生成一份 **优化计划**。

### 怎么做

输入：

* `Document IR`
* `DocumentUnderstanding`
* `StructuredDraft v0`
* `Scorecard v0`
* `SchemaProfile`
* `ExpertGuidanceProfile`

输出：

```yaml id="agent-plan-example"
AgentPlan:
  plan_id:
  goal:
  steps:
    - step_id:
      title:
      target_metric:
      target_field:
      rationale:
      evidence_block_ids: []
      action_type:
      expected_output:
      status:
  expected_improvement:
    field_coverage:
    item_f1:
    source_grounding_rate:
```

### 长文档优化如何融入

Plan 不是针对全文随便提建议，而是**针对低分指标和具体字段/section 生成 targeted reread / targeted rewrite / targeted ask**。

### 可替换工具 / 方案

* **LangGraph** 最适合借它的 stateful workflow / durable execution / HITL 机制来表达 Plan 和 Step。([GitHub][6])
* Hermes 风格 runtime 可用来生成 step rationale 和执行策略。([GitHub][7])

### 可评估

* Plan Coverage（是否覆盖低分指标）
* Plan Precision（建议是否对准真实问题）
* Plan Actionability
* Plan Acceptance Rate

### 可观测

保存：

* `agent_plan.v0.json`

记录：

* plan_generation_duration
* number_of_steps
* target_metrics_distribution

---

## Step 6：专家确认

### 做什么

让专家先批计划，再执行。

### 怎么做

支持：

* Approve All
* Approve Step-by-Step
* Edit Step Then Approve
* Reject Step

新增对象：

* `PlanApproval`
* `ExpertComment`
* `RejectedReason`

### 可替换工具

这一层主要是产品流程，自研即可。

### 可评估

* Plan Approval Rate
* Step Approval Rate
* Rejection Reason Distribution

### 可观测

记录：

* who approved
* which steps rejected
* approval duration
* edited steps count

---

## Step 7：分步执行补强

### 做什么

按 PlanStep 逐步执行优化。

### 怎么做

每个 Step 都有固定动作类型，例如：

* clarify_structure
* add_missing_field
* rewrite_section
* complete_list
* rebind_sources
* validate_inference
* request_expert_input

每一步都生成：

* candidate output
* updated draft
* step diff
* step metrics snapshot

### 长文档优化如何融入

这一步绝不能重新喂全文。
每一步只读：

* 当前 block / target field
* parent section summary
* document understanding
* relevant source refs
* previous step artifacts

### 可替换工具 / 方案

* **LangGraph**：执行图、checkpoint、人工中断恢复最适合。([GitHub][6])
* **Hermes 风格 runtime**：适合右侧 Agent 在 step 内做 reasoning / rewrite / ask。([GitHub][7])

### 可评估

* Step Completion Rate
* Step Failure Rate
* Step Rework Rate
* Source-backed Change Rate
* Inference Overreach Rate

### 可观测

每步保存：

* `step_input.json`
* `step_output.json`
* `step_diff.json`

每步记录：

* status transitions
* duration
* model / tool used
* token / cost
* errors
* expert intervention

---

## Step 8：重抽取 + 重评分

### 做什么

优化后再次抽取并重新评分，证明是否变好。

### 怎么做

重新跑：

* Structured Extraction
* Scorecard

生成：

* `StructuredDraft v1`
* `Scorecard v1`
* `ScoreDelta`

### 可评估

* Score Delta by Metric
* Improved Fields Count
* Regressed Fields Count
* Net Quality Gain

### 可观测

保存：

* `structured_draft.v1.json`
* `scorecard.v1.json`
* `score_delta.json`

记录：

* re-extraction duration
* changed field count
* changed item count

---

## Step 9：专家评分与策略回流

### 做什么

让专家给最终结果打分，并把反馈沉淀为系统改进信号。

### 怎么做

新增：

```yaml id="expert-review-example"
ExpertReview:
  overall_score:
  dimension_scores:
    completeness:
    accuracy:
    clarity:
    actionability:
    traceability:
  comments:
```

### 可评估

* Expert Overall Score
* Expert Acceptance Rate
* Expert Override Rate
* Metric–Expert Correlation

### 可观测

保存：

* `expert_review.json`

记录：

* score
* dimension scores
* free-text comments
* accepted_final_version

---

# 3. 让整套流程“可观测”的统一实现

## 3.1 统一执行对象

建议新增两个核心对象：

```yaml id="run-step-model"
DocumentOptimizationRun:
  run_id:
  document_id:
  base_version_id:
  final_version_id:
  status:
  baseline_scorecard_ref:
  final_scorecard_ref:
  score_delta_ref:
  plan_ref:
  expert_review_ref:

DocumentOptimizationStep:
  step_id:
  run_id:
  step_type:
  title:
  assigned_tool:
  input_refs: []
  output_refs: []
  target_metrics: []
  status:
  logs: []
  metrics_snapshot: {}
  error_reason:
```

---

## 3.2 统一观测层

### 建议组合

* **OpenTelemetry**：统一 traces / metrics / logs。([GitHub][8])
* **Langfuse**：更适合 prompt / LLM tracing / evals / datasets / prompt management。([GitHub][8])
* **Phoenix**：更适合 AI observability / evaluation / experimentation。([GitHub][9])

### 推荐落地

* 底层埋点统一用 **OpenTelemetry**
* LLM / Agent tracing 先选 **Langfuse**
* 如果后面你更重实验分析，再补 Phoenix

---

# 4. AI-coding 友好的实现拆分

下面是最适合直接交给 AI-coding 的模块拆分。

## Module A：Profiles

* `SchemaProfile`
* `ExpertGuidanceProfile`
* `EvaluationProfile`

## Module B：Parsing

* parser adapter interface
* docling adapter
* marker adapter
* mineru adapter
* `DocumentIRBuilder`

## Module C：Understanding

* section summarizer
* document understanding builder
* targeted reread selector

## Module D：Structuring

* schema-based extractor
* field mapper
* source grounding binder
* gaps detector

## Module E：Scoring

* 8 metric calculators
* scorecard builder
* improvement trigger generator

## Module F：Planning

* plan generator
* plan step generator
* expected score delta predictor

## Module G：Execution

* step executor
* suggestion applier
* rewrite executor
* rebind executor
* inference validation executor

## Module H：Review

* expert approval
* expert review
* release readiness

## Module I：Observability

* run/step tracer
* artifact registry
* OTel instrumentation
* Langfuse logger

---

# 5. 推荐目录结构

```text id="repo-structure-suggestion"
apps/
  api/
  web/
packages/
  profiles/
    schema_profiles/
    expert_guidance_profiles/
    evaluation_profiles/
  parsing/
    adapters/
    document_ir/
  understanding/
  structuring/
  scoring/
  planning/
  execution/
  review/
  observability/
  shared-types/
data/
  prompts/
  skills/
  evals/
  fixtures/
```

---

# 6. 推荐实施顺序

## Week 1–2

先把骨架跑通：

* Run / Step 对象
* Document IR
* StructuredDraft
* Scorecard v0
* AgentPlan
* Plan Approval

## Week 3–4

把执行闭环跑通：

* Step execution
* re-extraction
* Scorecard v1
* score delta
* expert review

## Week 5–6

把可观测补齐：

* OTel
* Langfuse
* artifact registry
* step-level logs

## Week 7–8

做工具对比实验：

* Docling vs Marker
* need-based MinerU benchmark
* plan quality / score delta comparison

---

# 7. 一句话收束

**把长文档理解优化融入 Agent Mode 的关键，不是“让模型一次读懂整篇文档”，而是把整条链路做成：分层理解、结构化抽取、评分驱动计划、分步补强、前后对比验证，并且每一步都可观测、可评估、可替换。**

如果你愿意，我下一步可以直接给你：

**《Agent Mode 全链路对象模型 + 状态机 + API 草案》**

[1]: https://github.com/docling-project/docling "GitHub - docling-project/docling: Get your documents ready for gen AI · GitHub"
[2]: https://github.com/yifanfeng97/hyper-extract "GitHub - yifanfeng97/Hyper-Extract: Transform unstructured text into structured knowledge with LLMs. Graphs, hypergraphs, and spatio-temporal extractions — with one command. · GitHub"
[3]: https://github.com/datalab-to/marker "GitHub - datalab-to/marker: Convert PDF to markdown + JSON quickly with high accuracy · GitHub"
[4]: https://github.com/opendatalab/mineru "GitHub - opendatalab/MinerU: Transforms complex documents like PDFs and Office docs into LLM-ready markdown/JSON for your Agentic workflows. · GitHub"
[5]: https://github.com/microsoft/graphrag "GitHub - microsoft/graphrag: A modular graph-based Retrieval-Augmented Generation (RAG) system · GitHub"
[6]: https://github.com/langchain-ai/langgraph "GitHub - langchain-ai/langgraph: Build resilient language agents as graphs. · GitHub"
[7]: https://github.com/nousresearch/hermes-agent "GitHub - NousResearch/hermes-agent: The agent that grows with you · GitHub"
[8]: https://github.com/langfuse/langfuse "GitHub - langfuse/langfuse:  Open source LLM engineering platform: LLM Observability, metrics, evals, prompt management, playground, datasets. Integrates with OpenTelemetry, Langchain, OpenAI SDK, LiteLLM, and more. YC W23 · GitHub"
[9]: https://github.com/arize-ai/phoenix "GitHub - Arize-ai/phoenix: AI Observability & Evaluation · GitHub"
