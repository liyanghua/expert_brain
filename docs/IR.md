下面我把问题收敛成 **第一个任务**：

> **先定义“业务文档结构化抽取层”的 Schema**
> **再定义“结构化抽取评估指标体系”**
> **最后给出可直接用于 AI-coding 的 prompts**

不展开 Agent Strategy Schema，只为后面预留接口。

---

# 一、任务边界

当前阶段只做三件事：

1. **定义业务文档结构化抽取 Schema**
2. **定义结构化抽取评估指标体系**
3. **给出 AI-coding prompts，帮助快速实现**

目标产物是：

* 原始业务文档
* `Document IR`
* `BusinessDocStructuredDraft`
* `ExtractionScorecard`
* `ImprovementPlan`

---

# 二、业务文档结构化抽取 Schema

## 2.1 设计目标

这层 schema 不是给 Agent 直接执行的，而是给：

* 文档增强工作台
* 专家 review
* 结构化抽取评测
* 后续编译成 Agent Strategy Schema

所以它必须满足：

* 对专家语言友好
* 对文档抽取友好
* 对版本管理友好
* 对 source refs 友好
* 可评估

---

## 2.2 推荐 Schema：`BusinessDocStructuredDraft`

```yaml id="jlwmhg"
schema_name: BusinessDocStructuredDraft
schema_version: v1

document_meta:
  document_id:
  title:
  doc_type:
  domain:
  scene:
  source_files: []
  version:
  status:

fields:
  business_scenario:
    value:
    confidence:
    source_refs: []
    field_status:

  scenario_goal:
    value:
    confidence:
    source_refs: []
    field_status:

  required_inputs:
    items: []
    confidence:
    source_refs: []
    field_status:

  deliverables:
    items: []
    confidence:
    source_refs: []
    field_status:

  process_flow_or_business_model:
    value:
    confidence:
    source_refs: []
    field_status:

  execution_steps:
    items: []
    confidence:
    source_refs: []
    field_status:

  key_node_rationales:
    items: []
    confidence:
    source_refs: []
    field_status:

  page_screenshots:
    items: []
    confidence:
    source_refs: []
    field_status:

  faq_types:
    items: []
    confidence:
    source_refs: []
    field_status:

  judgment_basis:
    items: []
    confidence:
    source_refs: []
    field_status:

  judgment_criteria:
    items: []
    confidence:
    source_refs: []
    field_status:

  resolution_methods:
    items: []
    confidence:
    source_refs: []
    field_status:

  trigger_conditions:
    items: []
    confidence:
    source_refs: []
    field_status:

  termination_conditions:
    items: []
    confidence:
    source_refs: []
    field_status:

  validation_methods:
    items: []
    confidence:
    source_refs: []
    field_status:

  tool_templates:
    items: []
    confidence:
    source_refs: []
    field_status:

  exceptions_and_non_applicable_scope:
    items: []
    confidence:
    source_refs: []
    field_status:

gaps:
  missing_fields: []
  weak_fields: []
  inferred_fields: []
  needs_confirmation_fields: []

global_scores:
  completeness_score:
  extraction_confidence_score:
  grounding_score:
```

---

## 2.3 字段说明

### 1）`business_scenario`

回答：这份文档解决的业务场景是什么？

### 2）`scenario_goal`

回答：这份文档希望达成什么业务目标？

### 3）`required_inputs`

回答：执行这个场景前，需要哪些前置信息 / 数据 / 输入？

### 4）`deliverables`

回答：最终产出什么成果物？

### 5）`process_flow_or_business_model`

回答：这个场景的流程图、流程主干或业务模型是什么？

### 6）`execution_steps`

回答：实际执行步骤是什么？

### 7）`key_node_rationales`

回答：关键节点为什么这样做？背后的业务逻辑是什么？

### 8）`page_screenshots`

回答：有哪些页面截图或界面示意可辅助执行？

### 9）`faq_types`

回答：常见问题类型有哪些？

### 10）`judgment_basis`

回答：判断时看哪些依据 / 指标 / 信号？

### 11）`judgment_criteria`

回答：判断标准是什么？数量 / 质量 / 时限 / 频率如何定义？

### 12）`resolution_methods`

回答：问题对应的解决方法或执行动作是什么？

### 13）`trigger_conditions`

回答：流程 / 场景何时开始？

### 14）`termination_conditions`

回答：流程 / 场景何时结束或停止？

### 15）`validation_methods`

回答：如何验证方法有效？

### 16）`tool_templates`

回答：有哪些工具、表单、模板可配套使用？

### 17）`exceptions_and_non_applicable_scope`

回答：有哪些例外情况或不适用范围？

---

## 2.4 字段状态 `field_status`

推荐枚举：

* `missing`
* `partial`
* `drafted`
* `confirmed`
* `inferred_candidate`

说明：

* `missing`：完全没抽到
* `partial`：有内容但明显不完整
* `drafted`：已抽取，待人工确认
* `confirmed`：人工确认通过
* `inferred_candidate`：推断得出，必须标明不是 strict extract

---

## 2.5 source_refs 设计

每个字段必须支持来源引用，至少支持指向 Document IR block。

示例：

```yaml id="m5t08g"
source_refs:
  - block_id: b_013
    source_file: 链接诊断SOP.docx
    source_span: p2:para4
    page_no: 2
```

---

## 2.6 列表字段 item 结构建议

对于 `items: []` 的字段，建议统一 item 结构：

```yaml id="5rmyy0"
item:
  item_id:
  text:
  confidence:
  source_refs: []
  status:
  notes:
```

---

# 三、结构化抽取评估指标体系

这里围绕你指定的 8 个核心指标，定义为系统可计算、可驱动补强的指标体系。

---

## 3.1 指标总表

```yaml id="2c7rrl"
metrics:
  - field_coverage
  - field_accuracy
  - item_f1
  - source_grounding_rate
  - structural_consistency
  - gap_detection_accuracy
  - inference_handling_accuracy
  - human_revision_rate
```

---

## 3.2 `Field Coverage`

### 定义

目标 schema 中，应抽字段里，成功抽到非空内容的比例。

### 公式

```text id="6i3was"
Field Coverage = 非空字段数 / 目标字段总数
```

### 计算对象

字段级。

### 建议门槛

* target: `0.80`
* minimum: `0.70`

### 低于门槛时的优化方向

* 优先做缺失字段补全
* 优先触发 Gap Detection Agent
* 右侧工作台优先显示缺失字段卡

---

## 3.3 `Field Accuracy`

### 定义

已抽取字段中，语义正确的比例。

### 评分方式

推荐打分映射：

* `exact = 1.0`
* `acceptable = 0.8`
* `partial = 0.4`
* `wrong = 0.0`

### 公式

```text id="1g8vwz"
Field Accuracy = 所有字段得分总和 / 已评估字段数
```

### 计算对象

适合单值字段和整体字段。

### 建议门槛

* target: `0.85`
* minimum: `0.75`

### 低于门槛时的优化方向

* 重点做字段解释与字段重映射
* 让用户确认：

  * “这段是否确实属于 judgment_criteria？”
* 针对低分字段发起定向问答

---

## 3.4 `Item F1`

### 定义

针对列表字段，把每个条目作为抽取单元，计算 Precision / Recall / F1。

### 适用字段

* execution_steps
* faq_types
* judgment_basis
* judgment_criteria
* resolution_methods
* trigger_conditions
* validation_methods
* tool_templates
* exceptions_and_non_applicable_scope

### 公式

```text id="jjlwmg"
Precision = 匹配正确条目数 / 抽取条目数
Recall = 匹配正确条目数 / 应抽条目数
F1 = 2 * Precision * Recall / (Precision + Recall)
```

### 建议门槛

* target: `0.80`
* minimum: `0.70`

### 低于门槛时的优化方向

* 缺项补全
* 重复条目合并
* 条目拆分与去重
* 引导专家补充“是否还有遗漏项”

---

## 3.5 `Source Grounding Rate`

### 定义

抽取出的字段或条目，是否正确绑定回原文来源。

### 评分映射

* `exact_source = 1.0`
* `nearby_source = 0.7`
* `wrong_source = 0.0`
* `no_source = 0.0`

### 公式

```text id="yzdaef"
Source Grounding Rate = grounding_score 总和 / 抽取单元总数
```

### 建议门槛

* target: `0.90`
* minimum: `0.80`

### 低于门槛时的优化方向

* 强化 source ref 回填
* 右侧 Agent 发起“来源确认”
* 左文档 / 右字段做对照高亮

---

## 3.6 `Structural Consistency`

### 定义

结构化字段之间是否逻辑一致、没有明显冲突。

### 典型检查规则

* trigger_conditions 是否与 business_scenario 对应
* execution_steps 是否与 process_flow_or_business_model 对应
* judgment_basis 与 judgment_criteria 是否匹配
* resolution_methods 是否解决对应 faq_types
* validation_methods 是否与 scenario_goal 对应
* inferred_candidate 是否没有被当成 confirmed

### 公式

定义规则集 `R`

* pass = `1`
* partial = `0.5`
* fail = `0`

```text id="y8fni6"
Structural Consistency = 规则得分总和 / 规则总数
```

### 建议门槛

* target: `0.90`
* minimum: `0.80`

### 低于门槛时的优化方向

* 发起冲突检查
* 让 Agent 指出：

  * “这条判断标准似乎没有对应判断依据”
  * “这条动作可能不属于当前流程阶段”

---

## 3.7 `Gap Detection Accuracy`

### 定义

系统指出的缺失项 / 弱项是否真实存在，且真正的缺口是否被发现。

### 公式

可按 gap 的 Precision / Recall / F1 来算，最后用 F1 作为主指标。

```text id="rt2hdj"
Gap Precision = 正确缺口数 / 系统指出缺口数
Gap Recall = 正确缺口数 / 实际缺口数
Gap Detection Accuracy = Gap F1
```

### 建议门槛

* target: `0.80`
* minimum: `0.70`

### 低于门槛时的优化方向

* 不先给修改建议，而先做缺口确认
* 右侧 Agent 先问：

  * “这里是否真的没有验证方式？”
  * “这里是不是已有模板，只是写在附件里？”

---

## 3.8 `Inference Handling Accuracy`

### 定义

系统对“推断字段”的处理是否规范。

### 检查项

对每个 inferred field 评 4 项：

* 是否标记为 inferred_candidate
* 是否没有冒充 strict extract
* 是否语义合理
* 是否要求人工确认

### 公式

```text id="tn0ei0"
每个推断字段分数 = 四项得分平均
Inference Handling Accuracy = 所有推断字段分数平均
```

### 建议门槛

* target: `0.90`
* minimum: `0.85`

### 低于门槛时的优化方向

* 所有推断字段统一降级为 candidate
* 右侧 Agent 必须发起确认，不允许自动发布

---

## 3.9 `Human Revision Rate`

### 定义

专家对系统抽取结果需要修改的比例。

### 公式

```text id="8p0tg0"
Human Revision Rate = 被修改的字段/条目数 / 已呈现字段/条目数
```

建议同时跟踪：

```text id="h1h3ww"
Hard Rejection Rate = 被完全驳回字段/条目数 / 已呈现字段/条目数
```

### 建议门槛

* target_max: `0.30`
* hard_max: `0.45`

### 过高时的优化方向

这时不是只修当前文档，而是要回头优化抽取模块：

* 哪些字段总被改
* 哪类文档总出错
* 哪种 prompt / skill 需要重写

---

# 四、指标计算输出对象

建议系统在每次抽取后生成：

## 4.1 `ExtractionScorecard`

```yaml id="ghr4ro"
document_id: doc_001
version_id: v0.1

scores:
  field_coverage: 0.80
  field_accuracy: 0.84
  item_f1: 0.76
  source_grounding_rate: 0.88
  structural_consistency: 0.91
  gap_detection_accuracy: 0.83
  inference_handling_accuracy: 0.95
  human_revision_rate: 0.00

threshold_check:
  field_coverage: pass
  field_accuracy: warn
  item_f1: warn
  source_grounding_rate: warn
  structural_consistency: pass
  gap_detection_accuracy: pass
  inference_handling_accuracy: pass
  human_revision_rate: pass

overall_status: needs_improvement
```

---

## 4.2 `ImprovementPlan`

```yaml id="mcr3wc"
document_id: doc_001
version_id: v0.1

priority_actions:
  - metric: item_f1
    reason: judgement_criteria 和 execution_steps 可能存在漏项
    actions:
      - run_list_completion_prompt
      - ask_user_for_missing_items
      - merge_duplicate_items

  - metric: source_grounding_rate
    reason: 多个条目没有精确 block 绑定
    actions:
      - rerun_source_binding
      - enable_mapping_confirmation_ui

  - metric: field_accuracy
    reason: 部分字段归类偏差
    actions:
      - trigger_explain_mapping
      - request_expert_confirmation
```

---

# 五、分数驱动交互式 Agent 补强逻辑

这是最关键的闭环。

---

## 5.1 当 `Field Coverage` 低

### 系统动作

* 优先列出 missing fields
* 右侧 Agent 先问缺字段，不先改已有字段

### 推荐问法

* “这份文档里是否有明确的输出成果？”
* “是否有流程终止条件，只是没有单独写标题？”
* “这里有没有工具模板，是否在附件里？”

---

## 5.2 当 `Field Accuracy` 低

### 系统动作

* 逐字段触发 explain mapping
* 让专家确认“这段是不是属于这个字段”

### 推荐问法

* “我把这段归到 scenario_goal，因为它描述了阶段目标。是否正确？”
* “这里更像判断标准还是判断依据？”

---

## 5.3 当 `Item F1` 低

### 系统动作

* 针对列表字段做缺项补全和重复项清洗

### 推荐问法

* “除了这 4 条判断标准外，还有遗漏项吗？”
* “这两条动作是不是应该合并？”
* “这一步是否应该拆成两步？”

---

## 5.4 当 `Source Grounding Rate` 低

### 系统动作

* 触发来源确认模式
* 左右高亮映射

### 推荐问法

* “这条判断标准是不是来自这一段？”
* “这个流程步骤对应的是不是这张截图？”

---

## 5.5 当 `Structural Consistency` 低

### 系统动作

* 触发冲突检查
* 先指出不一致，再让用户裁定

### 推荐问法

* “这条动作似乎没有对应判断依据，是否补一条判断信号？”
* “这个终止条件与流程目标似乎不一致，是否调整？”

---

## 5.6 当 `Gap Detection Accuracy` 低

### 系统动作

* 不直接出大段建议
* 先做 gap confirmation

### 推荐问法

* “这里系统认为缺少验证方式，是否真实缺失？”
* “这里的模板字段是缺失，还是已经在表格附件中存在？”

---

## 5.7 当 `Inference Handling Accuracy` 低

### 系统动作

* 所有推断项标记为 candidate
* 不允许进入 approved / published

### 推荐问法

* “以下内容是系统归纳出的思维框架，不是原文明写。是否接受？”
* “是否将这条终止条件作为候选项保留？”

---

## 5.8 当 `Human Revision Rate` 高

### 系统动作

* 启动 error pattern mining
* 更新抽取 prompt / skill / routing

### 处理重点

不是当前文档修几条，而是改系统：

* 哪类字段总错
* 哪类文档总错
* 哪种解析路线要换

---

# 六、建议的阶段门槛

---

## 6.1 自动进入 Draft

要求：

* Field Coverage ≥ 0.70
* Field Accuracy ≥ 0.75
* Source Grounding Rate ≥ 0.80
* Structural Consistency ≥ 0.80

---

## 6.2 可进入人工补强

要求：

* 有至少一项低于 target 但高于 minimum

处理：

* 自动生成 ImprovementPlan
* 右侧 Agent 进入补强模式

---

## 6.3 可进入 Approved 候选

要求：

* 所有核心指标达到 target
* inferred_candidate 已确认
* Human Revision Rate 不高于目标

---

# 七、AI-coding Prompts

下面给你一组可直接用于 AI-coding 的 prompts。

---

## Prompt 1：定义结构化抽取 Schema

```text id="6lpjlwm"
你正在为一个“业务文档增强型 Ground Truth 工作台”实现第一阶段的结构化抽取层。

请完成以下任务：

1. 定义一个名为 `BusinessDocStructuredDraft` 的结构化抽取 schema
2. 字段包括：
- document_meta
- business_scenario
- scenario_goal
- required_inputs
- deliverables
- process_flow_or_business_model
- execution_steps
- key_node_rationales
- page_screenshots
- faq_types
- judgment_basis
- judgment_criteria
- resolution_methods
- trigger_conditions
- termination_conditions
- validation_methods
- tool_templates
- exceptions_and_non_applicable_scope
- gaps
- global_scores

3. 每个字段需要支持：
- value 或 items
- confidence
- source_refs
- field_status

4. `field_status` 枚举：
- missing
- partial
- drafted
- confirmed
- inferred_candidate

5. 输出内容：
- TypeScript type 定义
- Pydantic / Python schema 定义
- 示例 JSON 对象
- 字段说明注释

要求：
- 结构清晰
- 强类型
- 适合前后端共用
- 保证后续可扩展到 versioning 和 review
```

---

## Prompt 2：实现 8 个指标的计算模块

```text id="oa6qtn"
请实现一个“结构化抽取评分模块”，输入为：
- Document IR
- BusinessDocStructuredDraft
- 可选的 gold annotations
- 可选的 human review events

输出为：
- ExtractionScorecard
- ImprovementPlan

需要计算以下 8 个指标：
1. Field Coverage
2. Field Accuracy
3. Item F1
4. Source Grounding Rate
5. Structural Consistency
6. Gap Detection Accuracy
7. Inference Handling Accuracy
8. Human Revision Rate

请完成以下内容：
1. 定义每个指标的计算函数
2. 明确输入输出类型
3. 支持“有 gold”与“无 gold”两种模式
4. 支持字段级与条目级评价
5. 给出评分阈值配置
6. 输出汇总评分对象

要求：
- 函数职责清晰
- 可测试
- 不要把业务逻辑写死在 controller 中
- 要方便未来接入前端 scorecard 展示
```

---

## Prompt 3：实现 ImprovementPlan 生成器

```text id="0tt3kh"
基于结构化抽取评分结果 `ExtractionScorecard`，实现一个 `ImprovementPlanGenerator`。

输入：
- scorecard
- current BusinessDocStructuredDraft
- optional field-level diagnostics

输出：
- ImprovementPlan

逻辑要求：
1. 若 Field Coverage 低，则生成“缺失字段补强任务”
2. 若 Field Accuracy 低，则生成“字段重映射确认任务”
3. 若 Item F1 低，则生成“列表补全 / 去重 / 拆分任务”
4. 若 Source Grounding Rate 低，则生成“来源重新绑定任务”
5. 若 Structural Consistency 低，则生成“冲突检查任务”
6. 若 Gap Detection Accuracy 低，则生成“缺口确认任务”
7. 若 Inference Handling Accuracy 低，则生成“推断字段确认任务”
8. 若 Human Revision Rate 高，则生成“抽取策略优化任务”

请输出：
- TypeScript 类型
- Python dataclass / Pydantic 模型
- 规则实现代码
- 示例输出 JSON

要求：
- 每个任务有 priority、reason、actions
- 可以直接喂给右侧交互式 Agent
```

---

## Prompt 4：把评分和补强接入双栏工作台

```text id="y0sv32"
请为双栏工作台实现“结构化抽取评分卡 + 补强面板”功能。

页面已有：
- 左侧文档区
- 右侧 Agent 区
- 底部抽屉

现在需要新增：
1. ExtractionScorecard 面板
2. ImprovementPlan 面板
3. 低分指标触发对应快捷操作 chips
4. 针对低分项，右侧 Agent 自动推荐补强问题

请输出：
- 前端组件树设计
- 页面状态机
- API 接口定义
- 前端类型定义
- 后端路由与服务设计

要求：
- 评分和补强是独立模块
- 不破坏原有文档/Agent双栏结构
- 低分项能够精准驱动交互，而不是只显示分数
```

---

# 八、一句话总结

**第一阶段先把“业务文档结构化抽取层”做好：定义统一 schema、定义 8 个核心指标、定义评分与补强闭环。这样原始文档先被稳定提升成高质量业务文档，再进入后续 Agent Strategy 编译层。**
