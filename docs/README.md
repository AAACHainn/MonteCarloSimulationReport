# 文档目录

安装与功能概览从[项目 README](../README.md)开始；开发约束见[协作约定](../AGENTS.md)。默认只读取当前入口；需要追溯时再读下方的方案和历史材料。专题内单列的历史验收段落不代表当前版本已复测。

## 当前入口

| 类别 | 文档 |
| --- | --- |
| 用户档案、成长与资金 | [用户档案与成长](account/user-growth-design.md)、[用户资金用法](../README.md#用户资金)、[资金存取规则](account/user-wallet-transfers-progress.md#验收反馈与当前行为) |
| AI 机器人 | [使用与配置](ai/ai-assistant.md)、[图表图片](ai/ai-chart-images.md) |
| 图表绘图 | [矩形](charting/rectangle-drawing.md)、[文字](charting/text-drawing.md)、[自动保存契约](charting/text-autosave-design.md)、[AB=CD](charting/abcd-drawing.md)、[箭头](charting/arrow-drawing.md)、[会话绘图持久化](charting/archived-drawings.md) |
| 行情数据 | [行情同步](market-data/market-data-sync.md)、[时间聚合与查询](market-data/time-aggregation.md) |
| 回放与交易 | [会话与纠错当前规则](replay/replay-sessions-implementation.md)、[自营练习账户规格](replay/prop-practice-account-design.md)、[交易关卡](replay/training-gate.md)、[PDF 导出](replay/replay-pdf-export.md)、[空仓快速推进](replay/flat-replay-advance.md) |
| 蒙特卡洛 | [使用与计算口径](../README.md#蒙特卡洛风险分析)、[参数与计算量限制](../lib/validations.ts) |
| 安装与运维 | [升级、备份与部署](operations/upgrade.md) |
| UI 规范 | [UI 开发规范](ui/ui-guidelines.md) |

## 方案与历史材料

以下内容不进入默认实现依据；其中的阶段目标不自动成为待开发需求，命令、授权、服务状态和验证结果只对应注明的版本。外部调研需要使用时先重新核查官方资料。

| 类别 | 文档与适用范围 |
| --- | --- |
| 账户阶段记录 | [成长阶段计划](account/user-growth-implementation-plan.md)、[钱包首版](account/user-wallet-progress.md)、[资金存取历史验收](account/user-wallet-transfers-progress.md#验收环境与步骤) |
| 历史数据库操作 | [2026-10-26 正式升级记录](account/user-growth-formal-upgrade-2026-10-26.md)、[历史归属移除记录](account/user-growth-history-removal-2026-10-26.md)；当前操作统一使用升级指南 |
| AI 历史 | [自动交互](ai/ai-assistant-interaction.md)、[Function Calling 设计](ai/ai-function-calling-design.md)、[实施记录](ai/ai-function-calling-implementation.md)、[复盘规划](ai/ai-review-version-plan.md) |
| 性能与实现背景 | [趋势线性能](charting/trend-line-performance-results.md)、[普通推进优化](replay/replay-performance-optimizations.md)、[特殊场景等待](replay/replay-special-waits.md)、[SQLite WAL 验证](operations/sqlite-wal-validation.md)、[聚合排队方案](operations/aggregation-lock-repair-plan.md)、[升级进度方案](operations/db-upgrade-progress-plan.md) |
| 外部调研快照 | [机构账户模式调研（2026-10-23）](research/prop-firm-account-models-2026-10-23.md)；不保证今天的报价、销售状态或规则仍然相同 |
| 开发历史 | [截至 2026-10-19 的日志与提交索引](logs/README.md)、[2026-08-30 开发历史](history/development-history-2026-08-30.md) |
| 审查记录 | [历史交接摘要](reviews/handoff.md)、[2026-10-20 审查快照](reviews/architecture-review-2026-10-20.md)、[历史修复报告](reviews/fix-report-2026-10-20.md)；AR-04 当前状态见[聚合代次限制](market-data/time-aggregation.md#ar-04-generation-lifecycle) |
