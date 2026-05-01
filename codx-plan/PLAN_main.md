# Expert Brain Studio 升级计划（基于当前实现的合并路线）

**Summary**

这次不再把前面三个计划并列推进，而是以当前代码为真实基线，把它们收敛成一条连续路线：

- 先把已经出现雏形的主链路收紧成真正可用的产品流：`低分指标 -> 候选问题/字段缺口 -> block 高亮 -> Add2Chat -> QA -> 轻量确认 -> 写回 -> 版本管理`
- 再把“个性化专家 Brain”从当前的 `expert_memory + LLM QA` 升级成“每专家独立 profile + 可替换 QA runtime”
- 最后把 Hermes 接到现有 QA seam 上，而不是一开始推翻 Node 主干

当前实现已经具备的基础主要集中在 [apps/web/src/App.tsx](/Users/yichen/Desktop/OntologyBrain/Expert%20Brain%20Studio/apps/web/src/App.tsx)、[apps/api/src/index.ts](/Users/yichen/Desktop/OntologyBrain/Expert%20Brain%20Studio/apps/api/src/index.ts)、[packages/agent-core/src/orchestrator.ts](/Users/yichen/Desktop/OntologyBrain/Expert%20Brain%20Studio/packages/agent-core/src/orchestrator.ts)：

- 有 scorecard、improvement plan、candidate questions、compare 视图、Add2Chat、QA apply、expert memory、版本比较
- 但这些能力还分散，没有形成“简单、单线、友好”的默认工作流
- 当前个性化还是文档级 `expert_memory`，不是专家级 persona/runtime
- 当前 QA 仍是本地 LLM/fallback，不是 Hermes

**Current Baseline**

- `schema`、中文字段定义、gap 中文文案、scorecard 解释、candidate questions 已经落地，可以直接作为“字段缺口驱动”的起点
- `Add2Chat` 已有第一版，但本质还是把选中 block 文本前缀塞进 textarea，还不是正式的 chat attachment 模型
- `QA -> apply` 已有接口，但目前是直接把回答 append/replace 成 `Drafted` 字段项，没有“轻量确认卡 + 状态推进 + gap 收敛”这一层
- `compare` 模式已能从 `source_refs` 反查字段，但还不能从“缺口字段”反向定位“候选证据块”
- `expert_memory` 已可读写，但作用域是 `doc_id`，还不是“每专家独立 profile / memory”
- 多 source 导入仍会按当前 version 重写 `ir.json`，这会限制后续 evidence localization 和真实工作台体验

**Implementation Changes**

## 1. 把当前能力收口成一个正式主流程

- 新增 `FieldGapTask` 作为统一任务对象，来源于 `draft + gaps_structured + scorecard + candidate_questions`，字段固定为：
  - `task_id`
  - `metric`
  - `field_key`
  - `priority`
  - `reason`
  - `candidate_question`
  - `candidate_block_ids`
  - `status`
- 默认页面不再先展示整块评分面板，而是展示“当前优先任务卡”
- `candidate_questions` 从底部 eval 抽屉提升为主路径入口；抽屉保留完整评测视图
- GapCard 从纯展示升级为可点击任务入口，点击后直接进入该字段的聚焦处理流
- `compare` 模式不再只是展示已绑定字段，还要支持“从缺口字段定位候选 block”

## 2. 把 Add2Chat 从 textarea 技巧升级为正式上下文模型

- 新增 `ChatAttachment` 类型，固定保存：
  - `attachment_id`
  - `block_id`
  - `field_key?`
  - `metric?`
  - `source_label`
  - `preview_text`
- `Add2Chat` 行为改为“加入附件篮”，不再把原文硬编码进输入框正文
- 输入框只负责问题文本；附件区单独显示已加入的 block chips
- 默认提问入口继续采用“预填问题 + 可改写”
- 预填问题来源固定为：
  - `FieldGapTask.candidate_question`
  - 若用户是从 block 手动加入，则用 `block + field_key?` 生成默认问法
- 允许一次带多个 block 进入 QA，但第一阶段只要求 UI 支持“1-3 个 block”

## 3. 把 QA 回答从“直接回写”升级为“轻量确认卡”

- 保留现有 `/qa` 与 `/qa/apply` 主接口，但中间新增 `PendingWriteback` 视图模型：
  - `target_field`
  - `answer_mode`
  - `suggested_content`
  - `source_block_refs`
  - `confidence`
  - `review_note`
- 右侧聊天区默认不再直接显示“认可并回写”按钮，而是先渲染轻量确认卡
- 轻量确认卡只保留三个动作：
  - `确认写回`
  - `编辑后写回`
  - `暂不写回`
- `qa/apply` 升级后的写回规则固定为：
  - 写入字段项时带 `from_qa`
  - 更新字段状态，不再一律写成裸 `Drafted`
  - 收敛对应 `gaps_structured` 项
  - 记录 audit 和 writeback 来源
- 写回后不强制立刻生成版本，而是进入 `pending changes` 状态

## 4. 把版本管理从“每次动作都显式处理”改为“阶段性收尾”

- 顶部状态新增 `pending change count`
- 底部新增轻量变更条，展示：
  - 刚刚更新了哪个字段
  - 来自哪些 block
  - 查看变更
  - 生成版本
- `newVersion()` 继续沿用当前版本快照实现，但版本摘要要包含：
  - 本次新增/修改字段
  - QA 回写次数
  - gap 变化
  - scorecard 变化摘要
- `scorecard/compare` 继续作为版本后反馈，但默认只显示一句总结，完整明细折叠

## 5. 把个性化从“文档级 memory”升级成“专家级 profile”

- 新增 `ExpertProfile` 存储目录，按 `expert_id` 隔离，而不是挂在 `doc_id`
- 当前 `ExpertMemory` 拆成两层：
  - `ExpertProfile`：稳定风格、术语、追问习惯
  - `ExpertSessionMemory`：某专家在某文档/版本上的短中期记忆
- API 固定新增 `expert_id` 参与 `/qa`、`/qa/apply`
- 当前 `expert_memory.json` 迁移策略：
  - 已有 `profile` 内容抽到专家级 profile
  - `recent_questions / correction_summaries` 转为 `expert_id + doc_id` 作用域
- Web 新增专家选择器，但第一阶段只做简版下拉，不做完整配置中心

## 6. 为 Hermes 接入先做可替换 QAProvider，不直接硬切

- 在 `agent-core` 内抽出 `QAProvider` 接口
- 第一阶段保留 `LocalLlmQaProvider`，直接承接当前 `runDocQAAsync`
- 第二阶段新增 `HermesQaProvider`
- API 层只依赖 `QAProvider`，不感知底层是本地 LLM 还是 Hermes
- Hermes 接入固定采用 sidecar 方式：
  - `apps/hermes-qa/`
  - 只提供 QA，不接管 structuring / suggestion / version
- Hermes profile 映射固定为：
  - `SOUL.md`：平台默认 QA 行为 + 专家风格
  - `USER.md`：专家显式偏好
  - `MEMORY.md`：会话记忆
- Hermes 第一阶段只读工具：
  - 读 IR block
  - 搜索 block
  - 读 Draft
  - 读 FieldGapTask
  - 读版本差异
- 对外 `/qa` 契约尽量保持不变，避免前端二次返工

## 7. 把“缺口定位”从已绑定 source_refs 扩展为真实 evidence localization

- 当前 block 高亮主要依赖已有 `source_refs` 反查，这只适合已抽到的字段
- 新增 `FieldEvidenceLocator`，为 `Missing / Partial / InferredCandidate` 字段生成候选 block
- 候选 block 生成规则固定为：
  - 规则优先：heading、list、table、关键词、页面截图
  - 检索补充：按字段定义和 gap guidance 在 IR 中找相关 block
- `FieldGapTask.candidate_block_ids` 由这个定位器统一生成
- 左侧原文模式新增“任务聚焦态”：
  - 强高亮当前主 block
  - 弱高亮其他候选 block
  - 允许“换一个相关片段”

## 8. 修正多 source 与数据一致性问题

- 同一版本下上传多个 source 时，IR 不能被后一次上传覆盖
- 解析结果改为 append/merge 到该版本的 source-aware IR
- block identity 与 `source_file`、页码、sheet、node_path 一起稳定保存
- 版本元数据补 `source manifest`
- 这是后续 Add2Chat、evidence localization、Hermes grounded QA 的必要前提

**Public APIs / Types**

- 新增类型：
  - `FieldGapTask`
  - `ChatAttachment`
  - `PendingWriteback`
  - `ExpertSessionMemory`
  - `QAProvider`
- 升级接口：
  - `POST /documents/:docId/qa`
    - 新增 `expert_id`
    - 新增 `attachment_block_ids[]`
    - 保留 `target_field`、`metric`
  - `POST /documents/:docId/qa/apply`
    - 新增 `answer_mode`
    - 新增 `source_block_refs`
  - `GET /documents/:docId/focus-tasks`
  - `GET /experts`
  - `GET /experts/:expertId`
- 保留兼容接口：
  - `scorecard`
  - `improvement-plan`
  - `versions`
  - `scorecard/compare`

**Phased Rollout**

## Phase 1: 收口现有主链

- 实现 `FieldGapTask`
- 实现 `ChatAttachment`
- 改造右侧 QA 为“轻量确认卡”
- 改造顶部/底部 pending changes 反馈

## Phase 2: 数据与定位正确性

- 实现 evidence locator
- 改造 compare/gap 卡联动
- 修正多 source merge
- 写回时同步 gap/status/confidence

## Phase 3: 专家级个性化

- 引入 `expert_id`
- 拆分 profile 与 session memory
- 前端加专家选择器
- 保留本地 LLM provider

## Phase 4: Hermes 接入

- 引入 `QAProvider`
- 新增 Hermes sidecar
- 映射 `SOUL/USER/MEMORY`
- 用同一 UI/API 契约切换到 Hermes

## Phase 5: 治理与评测

- 增加 focused-flow E2E
- 增加 personalized QA regression
- 增加 grounded writeback regression
- 完善 publish readiness 门禁

**Test Plan**

- 低分指标出现时，系统能生成唯一的当前优先任务，而不是只展示分数。
- 用户从 GapCard 或 candidate question 进入后，左侧能定位候选 block 并完成 Add2Chat。
- Add2Chat 改为附件模型后，问题文本与 block 上下文分离，仍能正确发送 QA。
- QA 返回后，必须先经过轻量确认卡；确认写回后字段状态、gap 状态、audit 同步更新。
- `pending changes` 能累积多次 QA 回写，再统一生成版本。
- 切换专家后，近期问题、修正偏好和风格不能串线。
- 多 source 上传后，旧 IR 不会被覆盖，候选 block 可跨 source 定位。
- 在 `LocalLlmQaProvider` 与 `HermesQaProvider` 间切换时，前端与 API 不需要重写。

**Assumptions**

- Node monorepo 继续作为系统主干，Hermes 只接管 QA，不接管 structuring、storage、version。
- 第一阶段继续沿用当前 UI 和 API 结构演进，不做大规模重构。
- 第一阶段专家配置只做简版选择和后端 profile 种子，不做完整配置中心。
- `Add2Chat` 第一阶段支持 block 级附件，不做 block 内文本片段选择。
- 现有 `expert_memory`、`candidate_questions`、`qa/apply` 被视为迁移基础，不推翻重写。
