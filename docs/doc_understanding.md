

# step_2_hierarchical_understanding
##用 Document IR 的 heading tree 先构 section
##对每个 section 做 summary
##再做 document-level synthesis
##给每个 block 生成 contextualized representation

### section 怎么选

**优先用 `heading tree` 选 section，heading 不可靠时再用内容分块兜底。**

### section summary 怎么做

**第一版用“规则切块 + LLM 摘要”最稳。**
不要纯启发式，也不要整篇全文一次摘要。

### document-level synthesis 怎么做

**不要直接摘要全文，而是基于 `section_summaries` 做二次综合。**

### contextualized representation 包含什么

**至少包含 4 层信息：块本身、父 section、全文理解、结构化抽取线索。**

---

# 1. 先说总体原则

这一步不要把它理解成“做摘要”，而要理解成：

> **给后续抽取和 Agent 提供一个稳定的中间认知层。**

所以产物不是普通 summary，而是：

1. `sections`
2. `section_summaries`
3. `document_understanding`
4. `contextualized_blocks`

它们的目标分别是：

* `sections`：把文档分成可理解的主题单元
* `section_summaries`：把每个主题单元压缩成稳定认知
* `document_understanding`：给出全局主题、目标、主干结构
* `contextualized_blocks`：让后续每个 block 都带着“上下文身份”被理解

---

# 2. 第一步：选什么作为 section

## 2.1 默认规则：heading tree 优先

如果 `Document IR` 里已经有：

* `heading_level`
* `parent_block_id`
* `children_block_ids`

那么 section 的默认定义就是：

> **一个 heading 节点及其直到下一个同级 heading 之前的所有内容**

### 具体规则

假设标题层级是：

* H1：商品链接诊断

  * H2：前置准备
  * H2：流量结构诊断

    * H3：搜索流量分析
    * H3：推荐流量分析
  * H2：标签匹配度诊断

那么建议：

### section 粒度

**优先以 H2 为 section 主粒度**
H3 作为 section 的子块或子 section。

原因：

* H1 往往太大
* H3 往往太细
* H2 最符合“一个相对完整主题单元”

### 推荐策略

* 主 section：默认取 `heading_level = 2`
* 如果文档没有 H2，退化为：

  * 最高非标题页下的第一层 heading
* 如果 H2 下内容过长，再切成子 section

---

## 2.2 什么时候不能直接相信 heading tree

很多业务文档的标题层级其实不可靠，会出现：

* 标题样式不统一
* 大段内容没有标题
* 表格前后没有清晰 heading
* xmind / drawio 转出后层级异常

这时要加兜底策略。

---

## 2.3 兜底策略：内容分块成 section

当 heading tree 不可靠时，可以用以下启发式做 section：

### 规则 1：连续块主题一致

如果一串 block 都在讲同一个主题，例如：

* 流量不精准
* 原因判断
* 优化动作
* 验证方式

则可聚成一个 section。

### 规则 2：强结构信号触发新 section

出现这些信号时，倾向新建 section：

* 编号步骤开始
* “一、二、三”类大段标题
* 表格切换到新主题
* 明显的问题分类列表开始
* 明显的指标阈值列表开始

### 规则 3：长度阈值

如果一个 section 太长，比如：

* block 数 > 20
* token 数 > 2000

就要再切分成子 section。

---

## 2.4 最推荐的实现策略

### 主逻辑

1. 先按 heading tree 切
2. 再检查 section 长度和主题漂移
3. 太长或主题混杂时做二次切分
4. 没 heading 时再走启发式聚类

### section 对象建议

```yaml id="section_object"
section:
  section_id:
  title:
  heading_level:
  parent_section_id:
  block_ids: []
  start_block_id:
  end_block_id:
  token_count:
  section_type:
  confidence:
```

### `section_type` 可选值

* intro
* preparation
* framework
* diagnosis
* metrics
* actions
* validation
* template
* appendix

这个字段后面会非常有用。

---

# 3. 第二步：如何做 section summary

## 3.1 不建议纯启发式

纯启发式摘要只适合：

* 非常结构化表格
* 明确模板化文档
* 章节标题已经足够表达意思

但你的业务文档有很多隐含逻辑，例如：

* 为什么先看流量再看详情
* 指标之间的关系
* 动作和问题之间的映射

这些光靠启发式抓不出来。

---

## 3.2 第一版最稳：规则选材 + LLM 摘要

最推荐的做法是：

> **先用规则挑 section 的关键内容，再让 LLM 生成结构化 section summary。**

### 为什么

因为这样比“section 全文直接扔给 LLM”更稳，能减少：

* 冗长 section 的注意力稀释
* 表格/截图被忽略
* 无关段落干扰

---

## 3.3 section summary 的输入材料怎么选

建议一个 section 的 summary 输入不是“整个 section 原文”，而是：

### A. section 标题

最重要，决定主题。

### B. section 内关键 block

优先抽这些 block：

* 有指标阈值的
* 有动作建议的
* 有问题分类的
* 有“为什么”的解释的
* 有表格/截图说明的

### C. section 邻接信息

可附带：

* 上一个 section 标题
* 当前 section 在全文中的 role
* 当前场景 schema 重点字段

---

## 3.4 section summary 生成方式

建议 LLM 输出结构化 summary，而不是自然语言摘要一段话。

### 推荐 section summary schema

```yaml id="section_summary_schema"
section_summary:
  section_id:
  title:
  section_type:
  main_purpose:
  key_points: []
  related_schema_fields: []
  extracted_signals: []
  likely_gaps: []
  source_block_ids: []
  confidence:
```

### 解释

* `main_purpose`：这节主要干什么
* `key_points`：这节最重要的 3-7 个点
* `related_schema_fields`：这节和哪些 schema 字段相关
* `extracted_signals`：例如指标、规则、问题、动作
* `likely_gaps`：这一节明显缺什么
* `source_block_ids`：摘要主要来自哪些 block

---

## 3.5 哪些部分可以启发式抽，哪些必须 LLM

### 启发式适合抽

* section title
* token_count
* block_count
* 含表格/图片数量
* 粗粒度 section_type
* 数值规则候选
* 枚举列表候选

### LLM 更适合抽

* main_purpose
* key_points
* related_schema_fields
* likely_gaps
* 关键逻辑解释

所以最佳实践是：

> **启发式先做粗结构，LLM 再做语义压缩。**

---

# 4. 第三步：如何做 document-level synthesis

## 4.1 不要再读全文，直接综合 `section_summaries`

这一层最忌讳重新把全文塞进模型。
document-level synthesis 应该只基于：

* section_summaries
* 文档元信息
* schema_profile
* expert_guidance_profile

---

## 4.2 document-level synthesis 产出什么

推荐对象：

```yaml id="document_understanding_schema"
document_understanding:
  document_theme:
  business_scene:
  primary_goal:
  process_spine:
    - section_id:
      role:
  key_signals: []
  likely_gaps: []
  quality_risks: []
  summary_for_agent:
  confidence:
```

### 各字段含义

* `document_theme`：这份文档主要讨论什么
* `business_scene`：属于哪个业务场景
* `primary_goal`：核心业务目标
* `process_spine`：全文主干结构
* `key_signals`：最重要的指标/问题/动作信号
* `likely_gaps`：全文层面的缺口
* `quality_risks`：容易误抽/误判的点
* `summary_for_agent`：后续 Agent 快速阅读摘要

---

## 4.3 synthesis 的方法

建议不是“再摘要一遍”，而是做 **有约束的综合**。

### 推荐流程

1. 汇总所有 `section_summaries`
2. 找高频 schema field 覆盖
3. 找关键 section（目标、流程、指标、动作、验证）
4. 生成 document-level synthesis

### 关键点

document-level synthesis 要做的是：

* **抽主干**
* **抓缺口**
* **给后续 Agent 导航**

而不是写一段“这篇文章主要讲了……”

---

# 5. 第四步：contextualized representation 包含哪些内容

这个最关键，因为它直接影响后面：

* 结构化抽取
* QA
* Gap detection
* Plan generation
* Rewrite

---

## 5.1 最小必备内容

我建议每个 block 的 contextualized representation 至少包含 4 层：

### 层 1：块本身

* block_id
* block_type
* text_content
* source refs

### 层 2：section 上下文

* 所属 section_id
* section_title
* section_type
* section_summary.main_purpose
* section_summary.key_points

### 层 3：文档级上下文

* document_theme
* business_scene
* primary_goal
* process_spine role

### 层 4：结构化抽取线索

* likely_related_schema_fields
* current_field_mapping_candidates
* likely_gaps
* confidence hints

---

## 5.2 推荐对象结构

```yaml id="contextualized_block_schema"
contextualized_block:
  block_id:
  block_type:
  text_content:
  source_refs: []

  section_context:
    section_id:
    section_title:
    section_type:
    section_main_purpose:
    section_key_points: []

  document_context:
    document_theme:
    business_scene:
    primary_goal:
    process_role:

  extraction_context:
    likely_related_schema_fields: []
    likely_signal_types: []
    likely_gap_hints: []
    inference_risk_level:
```

---

## 5.3 `likely_signal_types` 可以是什么

例如：

* metric
* threshold
* issue
* action
* rationale
* trigger_condition
* validation
* template
* exception

这个字段非常适合后面做：

* targeted extraction
* explain mapping
* low-score repair

---

## 5.4 `inference_risk_level`

这个字段建议加上，值例如：

* low
* medium
* high

### 为什么重要

因为有些 block：

* 是明写事实
* 有些 block 是概括性语言
* 有些 block 只是专家经验归纳

这会直接影响后面的 `Inference Handling Accuracy`。

---

# 6. 推荐的最终实现方式

如果你要一个最稳的工程实现，我建议是：

## A. section 选择

* 默认按 H2 切 section
* H2 不可靠时按主题连续块兜底
* section 太长时再拆分子 section

## B. summary

* 用规则先挑关键 block
* 用 LLM 输出结构化 section summary

## C. document synthesis

* 只综合 section summaries，不重读全文
* 输出面向后续 Agent 的 `DocumentUnderstanding`

## D. contextualized representation

* 每个 block 都加：

  * section context
  * document context
  * extraction context

---

# 7. 给你一个最简洁的实施建议

如果第一版只做 MVP：

### 第一版必须有

* heading-tree based sections
* structured section summaries
* document understanding
* contextualized blocks

### 第一版先不做

* 完整 GraphRAG
* embedding-based contextual retrieval
* 自动图聚类
* 复杂跨文档 synthesis

这样你就能显著提升后面：

* schema 抽取
* QA
* 补强 Plan
* source grounding

---

# 8. 一句话结论

**section 最好先以 heading tree 的 H2 级别为主粒度；summary 最稳的方式是“启发式选材 + LLM 结构化摘要”；document-level synthesis 应只综合 section_summaries；而 contextualized representation 至少要包含块本身、section 上下文、文档上下文和结构化抽取线索四层信息。**
