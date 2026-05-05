# Semantic Unit & Schema Match Evaluation

## Summary

- semantic_navigation_score: 0.9
- metric_notes: No golden set is available yet; metrics are proxy checks for structure, readability, noise and consistency.

## Metrics

- unit_count: 18
- avg_blocks_per_unit: 1.9444
- heading_overuse_rate: 0
- summary_compression_ratio: 0.8841
- title_specificity_proxy: 1
- primary_field_coverage: 1
- avg_primary_fields_per_unit: 1
- over_tag_rate: 0
- context_demotion_rate: 1
- rejected_field_rate: 0
- validation_pass_rate: 1
- fallback_rate: 1

## Baseline vs Enhanced

- baseline over_tag_rate: 1
- enhanced over_tag_rate: 0
- baseline heading_overuse_rate: 0
- enhanced heading_overuse_rate: 0

## Examples

### unit_1 · 这套方法论的核心不是“商品链接诊断”，而是： 用 G...

用 GMV 拆解确定增长问题，用生命周期判断商品阶段，用人群与流量匹配定位根因，用转化与利润验证商品价值，最后把诊断结论转成增长任务。

- primary: scenario_goal
- supporting: execution_steps, judgment_basis
- context: judgment_criteria
- rejected: none
### unit_2 · 换句话说： 商品链接诊断 = GMV增长归因 × 商...

商品链接诊断 = GMV增长归因 × 商品生命周期 × 人群流量匹配 × 转化利润验证 × 任务闭环。 1. 商品诊断不是看数据，而是“问题 -> 方案 -> 任务 -> 增长”，并且要按生命周期、诊断维度、指标对标、问题排查、方案执行、数据验证形成闭环。 2. 链接诊断拆成新品期、成长期、成熟期、爆款期、衰退期，并给出各阶段的核心目标、关键指标和诊断动作。 商品链接增长诊断，是一套以 GMV 结果为起点，以商品生命周期为主线，以人群匹配为核心，以流量、点击、转化、利润、竞品...

- primary: scenario_goal
- supporting: execution_steps, judgment_basis
- context: judgment_criteria
- rejected: none

### unit_3 · 它解决五个连续问题： 1. GMV为什么变好或变差？...

1. GMV为什么变好或变差？ 2. 当前商品处在哪个生命周期？ 3. 这个阶段最核心的问题是什么？ 4. 问题出在流量、人群、点击、转化、利润、竞品还是体验？ 5. 今天应该先做什么，做完看什么数据证明有效？

- primary: scenario_goal
- supporting: execution_steps, judgment_basis
- context: judgment_criteria
- rejected: none

### unit_4 · GMV = 访客数 × 转化率 × 客单价

GMV = 访客数 × 转化率 × 客单价。 | GMV杠杆 | 代表问题 | 经营语言 | | --- | --- | --- | | 访客数 | 有没有人来 | 流量问题 | | 转化率 | 来了买不买 | 承接问题 | | 客单价 | 买得多不多、贵不贵 | 价值放大问题 |

- primary: scenario_goal
- supporting: execution_steps, judgment_basis
- context: judgment_criteria
- rejected: none

### unit_5 · 所以商品链接诊断的第一步，不是直接看主图、详情页、投...

所以商品链接诊断的第一步，不是直接看主图、详情页、投放，而是先判断 GMV 变化到底来自访客数、转化率还是客单价。

- primary: scenario_goal
- supporting: execution_steps, judgment_basis
- context: judgment_criteria
- rejected: none

### unit_6 · 访客数可以继续拆为：访客数 = 展现量 × 点击率，...

访客数 = 展现量 × 点击率，也可以按来源拆为：免费流量 + 付费流量 + 自主访问流量。 访客数下降时，不能直接说“流量不够”，而要继续判断： | 问题类型 | 具体含义 | | --- | --- | | 展现不足 | 平台没有把商品展示给足够多人 | | 点击率低 | 展示了，但用户不愿意点 | | 搜索下降 | 人找货入口失效 | | 推荐下降 | 货找人入口失效 | | 付费下降 | 推广计划失效或预算不足 | | 自主访问下降 | 老客、收藏、私域、品牌心智下降...

- primary: scenario_goal
- supporting: judgment_basis, judgment_criteria
- context: validation_methods
- rejected: none
