# Expert Brain Studio GroundTruth 工作模式升级计划

**Summary**

你现在这套模式是对的，而且很接近一个真正能沉淀行业专家 GroundTruth 的工作台：

- `原文 / 结构化 / 对照` 是正确的主界面骨架，因为它同时覆盖了证据、解释和写回。
- `schema -> gap -> block -> QA -> review -> writeback -> version` 是正确的核心闭环，因为它把专家注意力放在“缺什么、依据在哪、怎么确认”上。
- `评估指标 + 全局视角 + 局部修订` 也是对的，因为 GroundTruth 不是一次抽取，而是持续收敛质量。

但如果目标是“后续给应用层 Agent 使用”，仅靠“修订原文 + 结构化字段”还不够。更好的模式不是推翻当前方案，而是在现有模式上加一层“知识编译层”。

推荐的最终模式是三层：

1. **工作层**：原文、结构化、对照、Gap、QA、写回、版本
2. **GroundTruth 层**：经过专家确认的结构化知识、出处、边界、状态
3. **Agent 编译层**：把 GroundTruth 编译成更适合 Agent 使用的知识单元

也就是说，你现在的模式适合“采集和校正专家知识”，但要让下游 Agent 真正好用，还需要“把知识编译成 Agent-friendly 形态”。

**Key Product Changes**

## 1. 明确产品的主产物不是“修订后的原文”，而是“GroundTruth”

- 原始上传文件继续保持不可变。
- UI 里的“原文修订”本质上应是“工作草稿”或“可编辑衍生文档”，不能等同于 raw source。
- 真正的 canonical artifact 应该是 `GroundTruthDraft / GroundTruth / Versioned Review Trail`。
- 这样既满足专家工作习惯，也不会把后续 Agent 建立在不稳定的长文表述上。

## 2. 保留现在的三视图，但角色要更清晰

- **原文视图**：负责找证据、看上下文、做局部修订。
- **结构化视图**：负责看 schema 覆盖度、字段状态、缺失项、可回写内容。
- **对照视图**：负责做 block-to-field 映射确认，是 QA 和写回的主战场。

默认主路径应是：

- 系统给出当前优先 Gap
- 自动高亮候选 block
- 用户 `Add2Chat`
- 系统预填问题
- QA 返回答案和可写回卡
- 用户确认写回
- 系统更新字段状态和版本差异

不要让用户先看一大堆指标和抽屉，再决定做什么。默认应是任务驱动，不是面板驱动。

## 3. 全局视角和局部视角要分工，而不是并列堆叠

- **全局视角** 只负责回答三个问题：
  - 现在整体质量怎么样
  - 当前最该补哪个 Gap
  - 还剩几项没处理
- **局部视角** 只负责回答三个问题：
  - 这段原文在说什么
  - 它对应哪个字段或缺哪个字段
  - 我现在要不要写回

更好的交互形态不是更多 tab，而是“全局驾驶舱 + 局部手术台”。

## 4. QA 写回不能只写字段内容，还要写“知识属性”

每次 QA 写回至少要沉淀：

- 目标字段
- 内容
- 来源 block
- 是否推断
- 谁确认的
- 当前状态
- 更新时间
- 相关问题或修订理由

否则后续 Agent 能读到结论，但读不到“为什么能信、适用边界是什么、哪里还没定”。

**GroundTruth Compilation Layer**

这是当前模式之外最重要的新增层，也是“能否给 Agent 用好”的关键。

在 GroundTruth 被确认后，不要只保留一份大 JSON 或一份修订文档，还要编译出更小、更稳定的知识单元：

- `Process Spine`
  - 主流程、阶段、入口、出口、顺序
- `Decision Rules`
  - 判断依据、判断标准、阈值、触发/终止条件
- `Action Cards`
  - 问题类型 -> 处理动作 -> 预期结果
- `Exception Cards`
  - 不适用范围、例外情形、升级路径
- `Evidence Glossary`
  - 术语、指标定义、页面/截图含义
- `FAQ / Diagnostic Patterns`
  - 常见问法、常见误判、常见补救动作

下游 Agent 更适合消费这些“原子化知识单元”，而不是直接读整份专家文档。

**What Else To Consider**

## 1. “接近专家”不等于“保留原话”

要给 Agent 用，知识需要同时满足两件事：

- 足够接近专家：保留判断逻辑、经验性提醒、例外意识、业务口径
- 足够 Agent-friendly：原子化、结构化、可检索、可组合、可校验

所以建议保留双层表达：

- **Canonical Layer**：标准化、去歧义、适合执行
- **Expert Overlay**：专家风格备注、经验性提醒、追问习惯、风险提示

不要把这两者混成一层。

## 2. 要把“为什么”当成一等公民

很多专家知识真正有价值的不是动作本身，而是：

- 为什么这么判断
- 为什么不是另一种判断
- 哪些情况下这个经验失效
- 哪些信号只是参考，哪些是硬标准

所以 `key_node_rationales`、`exceptions`、`validation_methods` 不能只是附属字段，而应该成为 GroundTruth 的核心组成。

## 3. 要支持“不确定”和“待确认”

高质量 GroundTruth 不是“把所有东西都填满”，而是“明确知道哪些已确认，哪些只是推断”。

所以需要长期保留：

- `Confirmed`
- `Drafted`
- `Partial`
- `InferredCandidate`
- `Needs Confirmation`

如果后续 Agent 无法区分这些状态，就会把草稿当真理用掉。

## 4. 要为下游 Agent 设计消费接口，而不是只设计编辑界面

后续应用层 Agent 至少会需要：

- 按场景检索知识单元
- 按字段读取规则和边界
- 根据问题拿到推荐流程和判断卡
- 引用出处
- 判断是否需要升级到人工

所以发布阶段要考虑导出：

- `ground-truth.json`
- `knowledge-cards.json`
- `process-spine.json`
- 面向 RAG 的 chunked markdown / JSONL
- 带 `source_refs` 和状态字段的检索索引

**Recommended Product Shape**

推荐产品形态不是“聊天工具 + 文档编辑器”，而是：

- **一个以 Gap 为入口的知识校正工作台**
- **一个以 GroundTruth 为 canonical artifact 的知识沉淀系统**
- **一个以知识单元编译为出口的 Agent 知识工厂**

对应 UI 可以理解为三段式：

1. **Focus Task**
   - 当前最重要 Gap
   - 候选 block
   - 推荐问题
2. **Evidence Workspace**
   - 原文 / 对照
   - Add2Chat
   - QA
   - 轻量确认写回
3. **GroundTruth & Publish**
   - 字段状态变化
   - 版本差异
   - 编译后的 Agent 包

**Upgrade Plan**

## Phase 1: 收紧当前主链

- 把低分指标、candidate questions、GapCard 收口成统一 `Focus Task`
- 把 `Add2Chat` 从“填 textarea”升级成正式上下文附件
- 把 QA 回答升级成“轻量确认卡”
- 写回后优先更新字段状态和 gap 状态，而不是只 append 内容

## Phase 2: 强化 GroundTruth 语义

- 把“原文修订”和“GroundTruth 写回”明确分离
- 每次写回都记录出处、状态、确认信息、推断标记
- 对照视图支持“字段缺口 -> 候选 block”反向定位
- 支持全局优先任务与局部聚焦切换

## Phase 3: 增加知识编译层

- 从已确认字段编译出 `process spine / decision cards / action cards / exception cards`
- 为后续 Agent 提供结构化导出和检索友好导出
- 建立“文档工作层 -> GroundTruth 层 -> Agent 层”的清晰边界

## Phase 4: 个性化专家 Brain

- 把当前文档级 `expert_memory` 升级为专家级 profile + session memory
- 引入 Hermes 作为 QA runtime，但不替换 Node 主数据主干
- 保留专家风格层，作为问答和编译时的 overlay，而不是直接污染 canonical GT

**Success Criteria**

- 专家可以在 1-2 次点击内从 Gap 进入局部修订。
- 专家可以快速确认“这段原文补的是哪个字段、为什么、是否可写回”。
- 每次写回都能让 GroundTruth 更完整、更可追溯，而不是只让文档更好看。
- 发布后的知识不仅适合人阅读，也适合 Agent 检索、引用、组合和执行。
- 系统能同时保留“专家味道”和“结构化可计算性”。

**Assumptions**

- GroundTruth 是主产物，修订后的原文只是辅助产物。
- 原始 source 不可变，所有修订发生在衍生草稿和结构化层。
- 当前三视图模式保留，不改产品基本骨架。
- 后续给 Agent 用时，必须新增知识编译层；仅靠当前文档+字段层不够。
- 个性化专家 Brain 主要作用于 QA 和知识补强，不直接决定 canonical GT 的正确性。
