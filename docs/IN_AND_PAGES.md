
# 《双栏工作台：Figma 级页面框架文本稿 + 页面字段定义》

## 1. 页面定位

页面名称：**文档增强型 Ground Truth 工作台**

产品定位：
围绕一份业务文档，完成以下闭环：

1. 自动抽取核心结构
2. 针对任意内容问答
3. 生成修改 / 添加建议
4. 专家确认后修改
5. 生成版本
6. 逐步沉淀为行业 Ground Truth

页面核心形态：

* **左栏：文档区**
* **右栏：Agent 交互区**
* **底部：版本 / 建议 / diff 抽屉**
* **顶部：文档状态与操作栏**

---

# 2. 页面总结构

```text id="zxfyz6"
┌────────────────────────────────────────────────────────────────────────────┐
│ 顶部导航栏                                                                │
│ 文档名 | 当前版本 | 状态 | 结构化完整度 | 保存状态 | 版本历史 | 发布        │
├──────────────────────────────────────┬─────────────────────────────────────┤
│ 左侧文档区                           │ 右侧 Agent 交互区                  │
│                                      │                                     │
│ 模式切换：原文 / 结构化 / 对照        │ Context Bar                         │
│ 文档标题                              │ 对话流                              │
│ 文档区块列表                          │ 建议卡                              │
│ 图片/表格/脑图                        │ 结构抽取卡                          │
│ 选中块高亮                            │ 快捷动作 chips                      │
│ inline suggestion 标记                │ 输入区                              │
├──────────────────────────────────────┴─────────────────────────────────────┤
│ 底部抽屉：待确认建议 | 版本 Diff | 结构字段变化 | 操作日志                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

# 3. 顶部导航栏设计

---

## 3.1 顶栏布局

### 左侧

* 返回按钮
* 项目名 / 工作空间名
* 文档标题

### 中间

* 当前版本号
* 当前状态
* 结构化完整度
* 自动保存状态

### 右侧

* 导入新文件
* 查看版本历史
* 生成新版本
* 发布 / 标记为 Ground Truth
* 更多操作

---

## 3.2 顶栏字段定义

### 文档标题

字段名：`document_title`
类型：string
示例：`儿童学习桌垫主图背景选择 SOP`

### 当前版本

字段名：`current_version`
类型：string
示例：`v0.3-draft`

### 文档状态

字段名：`document_status`
枚举：

* Draft
* Extracted
* Under Review
* Revised
* Approved
* Published

### 结构化完整度

字段名：`structure_completeness`
类型：percentage
示例：`72%`

计算建议：

* 已抽取且经确认字段数量 / 应有字段数量

### 自动保存状态

字段名：`save_status`
枚举：

* Saved
* Saving
* Unsaved Changes
* Save Failed

---

## 3.3 顶栏按钮定义

### 按钮：导入新文件

用途：补充新的附件或替换源文档
行为：

* 支持 md / pdf / xmind / excel / 图片 / docx
* 导入后进入当前版本的 source list，不直接覆盖正文

### 按钮：查看版本历史

用途：打开版本历史侧板

### 按钮：生成新版本

用途：把当前已确认修改生成一个新版本

### 按钮：发布 / 标记为 Ground Truth

用途：仅在满足最低完整度和审核要求后允许发布

### 更多操作

下拉项建议：

* 导出 Markdown
* 导出结构化 JSON
* 查看源文件引用
* 查看字段完整度明细
* 回退到某版本

---

# 4. 左侧文档区设计

左侧是页面主视觉区，必须支持“阅读 + 选中 + 修改建议映射”。

---

## 4.1 左栏顶部工具条

### 区块：模式切换 Tabs

三个 Tab：

#### Tab 1：原文模式

显示原始文档经过标准化后的内容

#### Tab 2：结构化模式

按结构字段展示文档内容

#### Tab 3：对照模式

左边原文，右边结构化字段映射高亮

---

## 4.2 左栏文档头部

### 展示字段

* 文档标题
* 场景名
* 文档摘要（一句话）
* 已识别结构字段数
* 缺失字段数
* 来源文件数

### 示例文案

* 场景：儿童学习桌垫主图背景选择
* 已识别字段：9 / 14
* 缺失字段：5
* 来源文件：3

---

## 4.3 原文模式设计

### 展示内容

文档按 block 渲染：

* 一级标题
* 二级标题
* 段落
* 列表
* 表格
* 图片
* 脑图转换后的 outline
* Excel 转换后的表格 block

### 每个 block 的交互

hover 时出现 block 工具条：

* 提问
* 改写建议
* 补充建议
* 映射字段
* 查看来源
* 插入批注

### block 选中态

点击后：

* 当前 block 高亮
* 右侧 Context Bar 更新为当前 block
* 右侧推荐问题更新

### inline 标记

对已有建议的区域显示标记：

* 蓝色：有解释建议
* 绿色：有新增建议
* 橙色：有结构缺口建议
* 红色：有冲突 / 需确认

---

## 4.4 结构化模式设计

结构化模式不是自由文档，而是按固定槽位展示。

### 固定结构槽位列表

1. 业务场景
2. 场景目标
3. 输出成果
4. 目标思维框架
5. 执行动作
6. 关键节点思路说明
7. 页面截图
8. 常见问题类型
9. 判断依据 / 指标
10. 判断标准
11. 问题解决方法 / 执行动作
12. 流程触发条件
13. 流程终止条件
14. 方法有效性验证方式
15. 工具表单模板

### 每个字段卡片展示

#### 字段头

* 字段名称
* 完整度状态
* 置信度
* 来源数量

#### 字段内容区

* 已抽取内容
* 缺失提示
* 来源引用

#### 字段操作区

* 重新抽取
* 让 Agent 补充
* 手动编辑
* 查看原文映射

### 字段状态枚举

* Missing
* Partial
* Drafted
* Confirmed

---

## 4.5 对照模式设计

这是非常关键的专业模式。

### 左侧

显示原文 block

### 右侧

显示结构字段映射

### 高亮机制

选中一个字段时：

* 左侧高亮它来源的原文 block
  选中一个 block 时：
* 右侧高亮它被映射到的字段

### 用途

* 检查抽取是否准确
* 检查字段是否漏映射
* 检查某段是否被错误理解

---

# 5. 右侧 Agent 交互区设计

右侧不是普通聊天框，而是一个 **上下文化文档 Copilot**。

---

## 5.1 右栏顶部：Context Bar

### 展示内容

* 当前选中 block 标题 / 简述
* 当前对应结构字段
* 来源信息
* 当前任务模式

### 字段定义

#### `selected_block_label`

示例：`段落 #12：背景选择逻辑说明`

#### `mapped_field`

示例：`关键节点思路说明`

#### `source_ref`

示例：

* `主文档 / 第 2 节`
* `PDF p.4`
* `Excel Sheet2`
* `XMind node_path: 背景选择 > 护眼卖点`

#### `agent_mode`

枚举：

* QA
* Suggest
* Rewrite
* Add Missing Field
* Explain Mapping

---

## 5.2 右栏主体：对话流

### 消息类型

右侧对话流建议支持以下消息样式：

#### 1. 用户消息

普通提问或指令

#### 2. Agent 回答

直接回答内容问题

#### 3. 建议卡消息

Agent 给出修改 / 添加建议时，不只是一段话，而是一张卡

#### 4. 结构抽取卡

显示某字段的候选抽取结果

#### 5. 缺口提醒卡

指出：

* 这个文档缺什么
* 哪块不完整
* 哪个判断标准不够

#### 6. 执行结果消息

用户接受建议后，显示：

* 已更新文档
* 已更新字段
* 已生成版本草稿

---

## 5.3 建议卡设计

建议卡是右侧最重要的组件之一。

### 建议卡头部

* 建议类型
* 目标区域
* 影响字段
* 置信度

### 建议类型枚举

* Rewrite
* Add
* Clarify
* Split
* Merge
* Question
* Validation Needed

### 建议卡正文

包含：

* 建议内容
* 为什么建议这样改
* 依据是什么
* 影响了哪些字段

### 建议卡按钮

* 接受
* 编辑后接受
* 拒绝
* 以后再看

---

## 5.4 快捷动作 Chips

这是 AI-native 体验的重点。

当用户选中某段时，右侧自动出现推荐 chips：

* 解释这段
* 给出改写建议
* 还缺什么
* 映射到哪个字段
* 补判断标准
* 补验证方式
* 补截图说明
* 补工具模板
* 查是否有冲突

### 设计要求

* chips 数量控制在 4–8 个
* 根据当前上下文动态变化
* 不需要用户先学复杂命令

---

## 5.5 输入区设计

### 输入区组成

* 多行文本框
* 附件按钮
* 发送按钮
* 快捷模式开关

### 支持输入类型

* 文本
* 图片 / 截图
* 文件引用
* 引用文档 block

### 占位文案示例

* “问我这段内容为什么这样写，或让系统给出修改建议”
* “你可以问：这段还缺什么判断标准？”

---

# 6. 底部抽屉设计

底部是辅助层，默认折叠，减少主界面干扰。

---

## 6.1 抽屉 Tabs

### Tab 1：待确认建议

显示所有尚未处理建议

字段：

* 建议类型
* 目标位置
* 影响字段
* 状态
* 创建时间

---

### Tab 2：版本 Diff

显示当前版本与上一版本差异

支持两种视图：

* 文本 diff
* 结构字段 diff

---

### Tab 3：结构字段变化

专门看结构层变化

例如：

* `判断标准`：从 Missing → Drafted
* `验证方式`：从 Partial → Confirmed

---

### Tab 4：操作日志

记录：

* 谁做了什么
* 哪条建议被接受
* 哪个字段被改动
* 哪个版本被生成

---

# 7. 关键页面状态

---

## 7.1 空状态

场景：刚进入，没有导入文档

### 页面文案

左侧：

* “导入一份业务文档，开始构建 Ground Truth”

右侧：

* “支持 md / pdf / xmind / excel / docx / 图片”

CTA：

* 导入文档

---

## 7.2 首次抽取完成状态

场景：导入后结构化抽取完成

### 页面表现

左侧：

* 原文可阅读
* 结构模式可切换

右侧：

* Agent 主动总结：

  * 已抽取到哪些字段
  * 哪些字段缺失
  * 建议优先补什么

---

## 7.3 文档问答状态

场景：用户选中段落并提问

### 页面表现

左侧：

* 当前段落高亮

右侧：

* Context Bar 更新
* 推荐 chips 更新
* 对话围绕当前 block 展开

---

## 7.4 建议确认状态

场景：Agent 提出建议

### 页面表现

右侧：

* 出现建议卡
* 可接受 / 拒绝 / 编辑后接受

左侧：

* 被影响区域出现 suggestion marker

---

## 7.5 版本生成状态

场景：用户确认多条建议后生成版本

### 页面表现

顶部：

* 版本号变化

底部：

* diff 可见

右侧：

* Agent 显示变更摘要

---

# 8. 页面字段定义（可供前后端）

---

## 8.1 顶栏字段

```json id="qmvxbp"
{
  "document_title": "string",
  "current_version": "string",
  "document_status": "Draft|Extracted|Under Review|Revised|Approved|Published",
  "structure_completeness": "number",
  "save_status": "Saved|Saving|Unsaved Changes|Save Failed"
}
```

---

## 8.2 左侧文档字段

```json id="nu3tnv"
{
  "view_mode": "raw|structured|compare",
  "document_summary": "string",
  "identified_field_count": "number",
  "missing_field_count": "number",
  "source_file_count": "number",
  "blocks": [
    {
      "block_id": "string",
      "block_type": "heading|paragraph|list|table|image|outline",
      "content": "string|object",
      "selected": true,
      "suggestion_markers": [],
      "mapped_fields": []
    }
  ]
}
```

---

## 8.3 结构字段卡字段

```json id="1d7qzm"
{
  "field_name": "string",
  "field_status": "Missing|Partial|Drafted|Confirmed",
  "field_confidence": "number",
  "source_count": "number",
  "content": "object|string|array",
  "source_refs": []
}
```

---

## 8.4 右侧 Context Bar 字段

```json id="1sqnx4"
{
  "selected_block_label": "string",
  "mapped_field": "string|null",
  "source_ref": "string",
  "agent_mode": "QA|Suggest|Rewrite|Add Missing Field|Explain Mapping"
}
```

---

## 8.5 Suggestion 字段

```json id="tnmwnj"
{
  "suggestion_id": "string",
  "suggestion_type": "Rewrite|Add|Clarify|Split|Merge|Question|Validation Needed",
  "target_block_id": "string",
  "target_field": "string|null",
  "confidence": "number",
  "suggestion_text": "string",
  "rationale": "string",
  "source_refs": [],
  "status": "Draft|Accepted|Rejected|Edited"
}
```

---

## 8.6 Version 字段

```json id="rjky67"
{
  "version_id": "string",
  "parent_version_id": "string|null",
  "change_summary": "string",
  "created_at": "datetime",
  "created_by": "string"
}
```

---

# 9. Figma 组件清单

为了方便设计拆组件，我建议最少拆这些组件。

---

## 通用组件

* TopNav
* StatusBadge
* CompletenessBar
* ActionButton
* TabSwitch
* Drawer

## 左侧文档组件

* DocumentHeader
* DocBlock
* TableBlock
* ImageBlock
* OutlineBlock
* SuggestionMarker
* StructuredFieldCard
* CompareMappingHighlight

## 右侧 Agent 组件

* ContextBar
* ChatMessage
* SuggestionCard
* ExtractionCard
* GapCard
* QuickActionChips
* AgentInputBox

## 底部组件

* PendingSuggestionRow
* DiffViewer
* FieldChangeRow
* LogRow

---

# 10. 最小实现优先级

如果让设计和前端快速开工，我建议按下面优先级。

---

## P0 必做

* 顶栏
* 左侧原文模式
* 右侧对话区
* 选中 block 上下文联动
* SuggestionCard
* 底部待确认建议抽屉

## P1 应做

* 结构化模式
* 对照模式
* 版本 Diff
* 结构字段卡
* 快捷动作 chips

## P2 后做

* 图片细粒度解释
* 多来源对照
* 高级映射视图
* 批量建议确认

---

# 11. 一句话总结

**这个双栏工作台的核心不是“左边看文档，右边聊天”，而是“左边维护业务文档 Ground Truth，右边由 Agent 持续做抽取、解释、补全、修订和版本化”。**


