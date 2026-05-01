# Expert Brain Studio 实施交付包

## 目录
2. 总体架构
3. 产品 PRD
4. UI 交互稿（Figma 级）

---
# 2. 总体架构

## 2.1 总体目标

实现一个双栏工作台产品，使一份业务文档能够被持续增强，最终沉淀为结构化、可版本化、可治理的行业 Ground Truth。

---

## 2.2 技术分层

### Layer 1：输入适配层

支持格式：

* Markdown
* PDF
* Docx
* Excel
* XMind
* 图片

职责：

* 上传
* 文件识别
* 类型路由
* 标准化前解析

---

### Layer 2：标准化层（Document IR）

统一转成中间格式：

* block_id
* block_type
* text_content
* heading_level
* source_file
* source_span
* page_no / sheet_name / node_path
* attachment_refs
* parent / children

作用：

* 让所有输入格式进入同一套下游 Agent 链路

---

### Layer 3：结构抽取层

基于固定 schema 生成 GroundTruthDraft。

目标字段：

* business_scenario
* scenario_goal
* deliverables
* thinking_framework
* execution_actions
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

输出：

* GroundTruthDraft
* confidence_by_field
* gaps
* source_refs

---

### Layer 4：Agent 协作层

包含前面定义的 6 个 Agent。

作用：

* 问答
* 抽取
* 建议
* 版本更新
* 缺口提示
* 状态治理

---

### Layer 5：版本与治理层

存储：

* 文档版本
* 结构化版本
* suggestion records
* diff logs
* review states

状态：

* Draft
* Extracted
* Under Review
* Revised
* Approved
* Published

---

### Layer 6：沉淀与复用层

用于后续扩展：

* wiki compile
* ontology candidates
* skill candidates
* case cards
* decision cards

本期先预留接口。

---

## 2.3 数据对象

### Document IR

```json
{
  "doc_id": "",
  "version_id": "",
  "blocks": [
    {
      "block_id": "",
      "block_type": "heading|paragraph|list|table|image|outline",
      "text_content": "",
      "heading_level": 0,
      "source_file": "",
      "source_span": "",
      "page_no": null,
      "sheet_name": null,
      "node_path": null,
      "attachment_refs": []
    }
  ]
}
```

### GroundTruthDraft

```json
{
  "doc_id": "",
  "version_id": "",
  "business_scenario": {},
  "scenario_goal": {},
  "deliverables": [],
  "thinking_framework": [],
  "execution_actions": [],
  "key_node_rationales": [],
  "page_screenshots": [],
  "faq_types": [],
  "judgment_basis": [],
  "judgment_criteria": [],
  "resolution_methods": [],
  "trigger_conditions": [],
  "termination_conditions": [],
  "validation_methods": [],
  "tool_templates": [],
  "gaps": [],
  "confidence_by_field": {},
  "source_refs": {}
}
```

### Suggestion

```json
{
  "suggestion_id": "",
  "target_block_id": "",
  "target_field": "",
  "suggestion_type": "rewrite|add|delete|merge|clarify",
  "suggestion_text": "",
  "rationale": "",
  "source_refs": [],
  "status": "draft|accepted|rejected|edited"
}
```

### Version

```json
{
  "version_id": "",
  "parent_version_id": "",
  "doc_snapshot_path": "",
  "ground_truth_snapshot_path": "",
  "change_summary": "",
  "created_by": "",
  "created_at": ""
}
```

---

# 3. 产品 PRD

## 3.1 产品名称

文档增强型 Ground Truth 工作台

## 3.2 产品定位

围绕一份业务文档，完成“结构抽取、内容问答、修改建议、专家确认、版本沉淀”的双栏工作台。

## 3.3 核心用户

### 主用户

* 行业专家

### 次用户

* 产品经理
* 知识工程师
* 算法/Agent 工程师

---

## 3.4 用户目标

用户希望：

1. 导入一份业务文档后自动提取关键结构
2. 围绕任意内容问答和补充
3. 快速接受或调整建议
4. 形成结构化、版本化的 Ground Truth

---

## 3.5 MVP 范围

### 输入格式

* Markdown
* PDF
* Excel
* 图片
* Docx
* XMind（可选次优先）

### 核心功能

* 导入文档
* 结构化抽取
* 左侧文档阅读与选中
* 右侧文档问答
* 右侧建议卡
* 轻量修正
* 版本生成
* diff 展示

### 暂不做

* 多人协同
* 复杂图谱编辑
* 自动 skill 编译
* 多 Agent 辩论界面

---

## 3.6 核心流程

1. 导入文档
2. 系统生成 Document IR
3. 系统抽取 GroundTruthDraft
4. 右侧展示当前缺口与初步总结
5. 用户在左侧选中任意 block
6. 用户在右侧问答或点快捷建议
7. Agent 给出建议卡
8. 用户接受 / 拒绝 / 编辑后接受
9. 系统更新文档草稿和结构字段
10. 用户生成新版本
11. 最终达到可发布状态

---

## 3.7 功能拆分

### F1. 文档导入

* 支持多格式上传
* 识别文件类型
* 形成 source list

### F2. 结构化抽取

* 自动识别 15 个固定字段
* 输出结构化草稿
* 标注完整度与缺失项

### F3. 文档问答

* 任意 block 选中问答
* 上下文化回答
* 回答引用 source refs

### F4. 建议系统

* 改写建议
* 新增建议
* 拆分/合并建议
* 缺失字段补全建议

### F5. 轻量修正

* 接受
* 编辑后接受
* 拒绝
* 稍后处理

### F6. 版本管理

* 生成版本
* 版本 diff
* 操作日志
* 审核状态

---

## 3.8 成功指标

### 使用指标

* 平均首轮抽取完成时间
* block 选中后问答触发率
* 建议采纳率
* 用户二次修改率
* 版本生成率

### 质量指标

* 字段抽取完整度
* source ref 覆盖率
* 建议可接受率
* Ground Truth 达标率

---

# 4. UI 交互稿（Figma 级）

## 4.1 页面总结构

```text
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
│ 底部抽屉：待确认建议 | 版本Diff | 结构字段变化 | 操作日志                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4.2 顶部导航栏

### 左侧

* Back Button
* Workspace / Project Name
* Document Title

### 中间

* Current Version
* Document Status
* Structure Completeness
* Save Status

### 右侧按钮

* 导入补充文件
* 查看版本历史
* 生成新版本
* 发布为 Ground Truth
* 更多操作

### 顶栏字段

```json
{
  "document_title": "string",
  "current_version": "string",
  "document_status": "Draft|Extracted|Under Review|Revised|Approved|Published",
  "structure_completeness": "number",
  "save_status": "Saved|Saving|Unsaved Changes|Save Failed"
}
```

---

## 4.3 左侧文档区

### 左栏顶部工具区

Tabs：

* 原文
* 结构化
* 对照

次级控件：

* 搜索框
* 仅看有建议段落
* 仅看缺失项关联段落
* 仅看已确认字段映射

---

### 左栏文档头部

显示：

* 文档标题
* 场景名
* 一句话摘要
* 已识别字段数
* 缺失字段数
* 来源文件数

---

### 原文模式

按 block 渲染：

* heading
* paragraph
* list
* table
* image
* outline

每个 block hover 工具条：

* 提问
* 改写建议
* 补充建议
* 映射字段
* 查看来源
* 插入批注

block 选中后：

* 左侧高亮
* 右侧 Context Bar 更新
* 右侧推荐问题更新

inline 标记：

* 蓝色：解释建议
* 绿色：新增建议
* 橙色：缺口建议
* 红色：冲突/待确认

---

### 结构化模式

固定字段卡片：

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

每张字段卡：

* 字段名
* 状态（Missing / Partial / Drafted / Confirmed）
* 置信度
* 来源数
* 内容区
* 操作区（重新抽取 / 让 Agent 补充 / 手动编辑 / 查看映射）

---

### 对照模式

左侧：原文 block
右侧：结构字段映射

交互：

* 选中字段 → 高亮左侧来源 block
* 选中 block → 高亮右侧对应字段

---

## 4.4 右侧 Agent 交互区

### 顶部 Context Bar

显示：

* 当前选中 block 简述
* 当前对应结构字段
* 来源信息（页码 / sheet / node_path）
* 当前 Agent 模式

字段：

```json
{
  "selected_block_label": "string",
  "mapped_field": "string|null",
  "source_ref": "string",
  "agent_mode": "QA|Suggest|Rewrite|Add Missing Field|Explain Mapping"
}
```

---

### 对话流支持的消息类型

* 用户消息
* Agent 回答
* SuggestionCard
* ExtractionCard
* GapCard
* 执行结果消息

---

### SuggestionCard

头部：

* suggestion_type
* target_block_id
* target_field
* confidence

正文：

* suggestion_text
* rationale
* source_refs

按钮：

* 接受
* 编辑后接受
* 拒绝
* 稍后处理

字段：

```json
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

### 快捷动作 Chips

根据当前 block 动态生成：

* 解释这段
* 给出改写建议
* 还缺什么
* 映射到哪个字段
* 补判断标准
* 补验证方式
* 补截图说明
* 补工具模板
* 检查是否有冲突

---

### 输入区

组成：

* 多行文本框
* 附件按钮
* 发送按钮
* 模式切换（QA / Suggest / Rewrite）

支持输入：

* 文本
* 图片 / 截图
* 文件引用
* block 引用

---

## 4.5 底部抽屉

### Tabs

* 待确认建议
* 版本 Diff
* 结构字段变化
* 操作日志

### 待确认建议

显示：

* 建议类型
* 目标位置
* 影响字段
* 状态
* 创建时间

### 版本 Diff

支持：

* 文本 diff
* 结构字段 diff

### 结构字段变化

例如：

* 判断标准：Partial → Drafted
* 工具表单模板：Missing → Drafted

### 操作日志

记录：

* 谁做了什么
* 哪条建议被接受
* 哪个字段被改动
* 哪个版本被生成

---

## 4.6 页面状态

### 空状态

* 左侧：导入引导
* 右侧：支持格式说明
* CTA：导入文档

### 首次抽取完成状态

* 左侧：原文可阅读
* 右侧：展示已识别字段与缺失字段

### 文档问答状态

* 左侧：当前 block 高亮
* 右侧：围绕当前 block 问答和建议

### 建议确认状态

* 左侧：suggestion marker
* 右侧：SuggestionCard 主导

### 版本生成状态

* 顶部：Unsaved Changes / New Version Ready
* 底部：diff 可见
* 右侧：变更摘要

---


## 总结

这个产品的核心，不是“左边看文档，右边聊天”，而是：

**左边维护业务文档 Ground Truth，右边由 Agent 持续做抽取、解释、补全、修订和版本化。**

它是 Expert Brain Studio 的最小可落地入口，也是后续 wiki / ontology / skill 沉淀的起点。
