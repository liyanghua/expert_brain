# Expert Brain Studio NotebookLM 风格升级方案

**Summary**

当前代码已经完成了第一轮 `Focus Task driven QA` 收口，最近提交 `Upgrade expert QA focus workflow` 说明这条主线已经成形：有任务焦点、有候选问题、有 QA、可回写、可版本化。

但你现在遇到的核心体验问题也非常明确：

- 交互虽然从面板噪音里解放出来了，但**中间对话时间线仍然不是一个稳定的工作流时间线**
- “系统推荐问题 → 用户采用/改写 → Agent 回答 → 用户回写”的整个过程没有被组织成一个**可追踪、可回看、可继续推进的单元**
- 所以用户会感觉时间线错乱、上下文漂移、每次回答像散落在聊天流里的独立事件，而不是在推进一个明确任务

结合当前实现和 NotebookLM 风格，下一版的升级目标应调整为：

**从 Focus Task 驱动的 QA 工作流，升级为 Sources + Timeline + Studio 的知识工作台**
并把每一次问答组织成一条清晰的 `Task Thread`，而不是松散消息流。

---

## 1. 当前实现已经具备的基础

基于 [apps/web/src/App.tsx](/Users/yichen/Desktop/OntologyBrain/Expert%20Brain%20Studio/apps/web/src/App.tsx)、[apps/api/src/index.ts](/Users/yichen/Desktop/OntologyBrain/Expert%20Brain%20Studio/apps/api/src/index.ts)、[packages/agent-core/src/agents.ts](/Users/yichen/Desktop/OntologyBrain/Expert%20Brain%20Studio/packages/agent-core/src/agents.ts)，当前已经具备：

- `FocusContext` 与字段质量行
- 当前优先任务摘要
- `candidateQuestions`
- block 与字段联动
- QA async/fallback
- `qa/refine-question`
- QA 回写
- 写回模式 `append / replace`
- 质量面板折叠
- 版本比较

这意味着下一版**不应该再停留在“继续减少 panel noise”**，而是应该进入第二阶段：

1. 重构主交互时间线
2. 明确 NotebookLM 风格的信息架构
3. 把 GroundTruth 写回、笔记沉淀、右侧工具区重新分层

---

## 2. 新的产品骨架：Sources + Timeline + Studio

下一版建议将整体交互升级为三栏稳定结构：

### 左栏 `Sources`
负责所有“来源相关”的工作：

- 文档列表 / 来源列表
- 友好的原文阅读
- block 引用
- 当前高亮证据
- Add to Timeline
- Add to GT Review

### 中栏 `Timeline`
成为绝对主工作区：

- 当前任务线程
- 系统推荐问题
- 用户采用/改写的问题
- Agent 回答
- GT 候选修改
- 专家笔记
- 回写确认结果

### 右栏 `Studio`
承载所有“结构化操作”和“派生产物”：

- `GroundTruth`
- `Quality`
- `Transform`

其中：
- `GroundTruth`：GT 候选、字段状态、待确认项
- `Quality`：Gap、评分、任务队列、发布就绪
- `Transform`：音频、PPT、思维导图、其他衍生工具

默认打开右栏 `GroundTruth`，不是 `Transform`。

---

## 3. 核心改造：把消息流改成 Task Thread 时间线

当前最大问题不是消息气泡样式，而是**消息是按“发送顺序”堆的，不是按“任务推进顺序”组织的**。

### 推荐的新时间线单元

新增 `TaskThread` 和 `ThreadStep` 概念。

`TaskThread` 最小字段：

- `thread_id`
- `task_id`
- `field_key`
- `status`
- `title`
- `created_at`
- `latest_step_at`
- `source_block_ids`
- `recommended_question`
- `accepted_writeback?`

`ThreadStep` 最小字段：

- `step_id`
- `thread_id`
- `type`
- `timestamp`
- `payload`

`type` 固定为：

- `task_started`
- `question_suggested`
- `question_edited`
- `question_sent`
- `agent_answered`
- `note_saved`
- `gt_candidate_created`
- `writeback_confirmed`
- `writeback_rejected`
- `task_completed`

这样时间线就不再是“用户消息 + Agent消息 + 一堆零散按钮”，而是：

1. 当前任务启动
2. 系统给出建议问题
3. 用户采用或改写该问题
4. Agent 回答
5. 回答形成 GT 候选
6. 用户确认写回
7. 任务完成并推荐下一个任务

### UI 表达方式

中栏每个任务线程用一个 `Thread Card` 表示，而不是单纯消息气泡堆叠。

一个线程卡的结构：

- 头部：目标字段 / 当前状态 / 来源证据数
- Step 1：系统建议问题
- Step 2：用户实际发送的问题
- Step 3：Agent 回答
- Step 4：GT 候选卡
- Step 5：写回结果

这会让整个过程第一次变得“可回顾、可理解、可继续”。

---

## 4. 重新设计“问题生成与提问”的位置

现在“系统生成问题、用户用生成问题提问、Agent回答”发生在同一个消息流层级，容易混乱。

下一版应分层：

### 层 1：任务头部显示推荐问题
不是先把问题塞进输入框，而是在当前 `TaskThread` 顶部显示：

- `推荐问题`
- `换一种问法`
- `我自己写`

### 层 2：输入区只负责“最终发出的用户问题”
输入区应该始终表示：

- 这是专家最终要发出去的问题
- 系统推荐只是草稿，不是已经发生的事件

### 层 3：时间线只记录“实际发生的事”
不要把“推荐问题”和“最终发送问题”混在一条文本里。  
时间线里应明确区分：

- 系统推荐了什么
- 用户真正问了什么
- Agent 真正回答了什么

这样“时间线错乱”的感觉会明显下降。

---

## 5. 把 QA 回写从消息按钮升级为 GT Candidate 阶段

当前实现里，回答下面直接跟着字段选择、append/replace、编辑、回写按钮，这会让用户感觉自己还在“操作消息”，而不是在“推进 GroundTruth”。

下一版建议：

### Agent 回答结束后，不直接显示回写按钮组
而是自动生成一个 `GT Candidate Card`：

- 目标字段
- 建议内容
- 依据 block
- 是否推断
- 推荐写回模式
- 可编辑内容摘要

### GT Candidate Card 是右栏 GroundTruth 的主对象
中栏时间线里显示这个卡片的摘要，右栏展示完整确认界面。

默认路径变成：

- 时间线里看到“回答已生成 GT 候选”
- 右栏 `GroundTruth` tab 自动聚焦到这个候选
- 用户在右栏确认写回

这样中栏负责“发生了什么”，右栏负责“怎么确认结构化修改”。

这比把所有回写控件塞在聊天流里更像 NotebookLM 的 Studio 交互。

---

## 6. 笔记层要显式存在，但不能和 GT 混为一体

借鉴 NotebookLM 时，必须补上 `Notes` 层，但你这边不能让笔记替代 GroundTruth。

### 建议新增两类沉淀对象

- `ExpertNote`
  - 自由记录
  - 可挂在线程中
  - 不直接写 GT
- `GTCandidate`
  - 结构化修改候选
  - 进入右栏确认

每次回答后至少有两个动作：

- `保存为笔记`
- `生成 GT 候选`

默认如果回答有明确 `target_field`，则系统自动生成 `GTCandidate`，同时允许用户附加说明笔记。

这样既保留了 NotebookLM 的 note 风格，又不损失 GT 生产主线。

---

## 7. 右栏 Studio 的具体职责

右栏不能只是“工具箱”，而应是三层 Studio。

### Tab 1: GroundTruth
- 当前 GT Candidate
- 字段状态
- 待确认项
- 最近写回
- 可撤销或编辑的候选

### Tab 2: Quality
- Focus Task 队列
- 当前 Gap
- 指标摘要
- 发布就绪状态

### Tab 3: Transform
- 音频
- PPT
- 思维导图
- 结构化导出
- 其他衍生工具

默认规则：

- QA 发生后自动切 `GroundTruth`
- 写回完成后短暂展示 `Quality` 更新
- `Transform` 完全是消费层，不打断主任务

---

## 8. 后端与状态层需要新增的模型

为了支撑新的时间线和 NotebookLM 风格，需要正式引入以下模型，而不是继续全部堆在 `messages` state 里。

### 新增领域模型

- `TaskThread`
- `ThreadStep`
- `ExpertNote`
- `GTCandidate`
- `ChatAttachment`
- `FocusTask`

### 新增或升级接口

- `GET /documents/:docId/focus-tasks`
- `GET /documents/:docId/threads`
- `POST /documents/:docId/threads`
- `POST /documents/:docId/threads/:threadId/steps`
- `POST /documents/:docId/notes`
- `POST /documents/:docId/gt-candidates`
- `POST /documents/:docId/gt-candidates/:id/confirm`

这一步不必一步到位全做完，但前端必须按这个方向拆状态，否则之后越改越乱。

---

## 9. Hermes 与个性化在这个新形态里的位置

NotebookLM 风格下，Hermes 最适合负责中栏 `Timeline` 里的 Agent 行为，而不是整套系统。

Hermes 未来的职责：

- 根据当前 `TaskThread` 和附件上下文生成更像专家的回答
- 根据专家画像改写推荐问题
- 对回答生成更接近专家风格的 GT Candidate
- 在多轮线程中保持“连续追问感”

Hermes 不负责：

- 直接改 GT
- 管理版本
- 管理 Studio 工具区

因此本轮仍然建议保留：

- Node 主系统做数据主干
- QAProvider seam 预留 Hermes
- GroundTruth/Quality/Transform 仍由主系统管理

---

## 10. 实施优先级

### Phase 1: 时间线重构
- 引入 `TaskThread` / `ThreadStep`
- 重构中栏为线程式时间线
- 推荐问题、实际问题、回答分层显示

### Phase 2: GT Candidate 化
- 从消息按钮改为 GT Candidate Card
- 回写确认移动到右栏 GroundTruth
- 中栏只保留进度摘要

### Phase 3: NotebookLM 风格 Studio
- 左 Sources
- 中 Timeline
- 右 Studio
- Quality / Transform 分层

### Phase 4: Notes 层
- 加 `ExpertNote`
- 支持回答保存为笔记
- 笔记和 GT 候选双轨沉淀

### Phase 5: Hermes 接入
- 用 QAProvider 替换中栏 Agent
- 个性化推荐问题
- 线程级长期风格保持

---

## 11. 验收标准

- 用户能看懂“当前正在推进哪个任务线程”。
- 系统推荐问题、用户实际问题、Agent 回答不会再混成一团。
- 回答后的 GT 修改候选不会再以零散按钮形式挂在消息下，而是以明确候选卡进入右栏。
- 中栏成为真正的工作时间线，不再像普通聊天记录。
- 右栏成为 Studio，而不是“杂功能堆放区”。
- 用户在体验上能感受到：
  - 左边找来源
  - 中间推进任务
  - 右边确认产物

**Assumptions**

- 当前 `Focus Task` 驱动形态保留，不回退。
- 默认产物仍然是 `GT优先`。
- GT 默认落点仍然是右栏确认卡。
- Notes 是辅助沉淀层，不替代 GroundTruth。
- 本轮重点先解决时间线编排与 Studio 结构，不先做知识编译层。
