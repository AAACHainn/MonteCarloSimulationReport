# 文档目录

> 文档状态：当前规范。适用范围：文档分类与读取入口；状态标识不代替内容核验。

安装与功能概览从[项目 README](../README.md)开始；开发约束见[协作约定](../AGENTS.md)。默认只读取当前入口；需要追溯时再读下方的方案和历史材料。专题内单列的历史验收段落不代表当前版本已复测。

## 阅读方式

- **当前规范**：用于当前功能、接口与操作约束；仍须核对相关代码和实际环境。标识说明文档用途，不表示全文已重新审查或所有功能已测试通过。
- **设计与计划**：用于理解实施思路和范围；下列三份方案已有实施记录，不自动作为新待办，也不沿用当时的阶段授权。
- **历史记录**：用于追溯指定日期或版本，不作为当前行为或运行状态依据。需要实施时转到其顶部链接的当前规范，外部调研须重新核查官方资料。

从搜索结果直接进入文档也先读顶部标识，不按文件名判断权威性。资金存取文档仅“验收反馈与当前行为”“实现和统计边界”属于当前规范；绘图等专题中的历史验收数字、机器环境与命令仍按历史记录处理。未列入当前入口且缺少标识的材料，先核实用途再采用。

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

### 设计与计划

| 类别 | 文档与当前入口 |
| --- | --- |
| 用户成长分阶段方案 | [成长阶段计划](account/user-growth-implementation-plan.md)；当前规范见[用户档案与成长](account/user-growth-design.md) |
| 聚合排队与写入冲突方案 | [聚合排队方案](operations/aggregation-lock-repair-plan.md)；当前规范见[时间聚合与查询](market-data/time-aggregation.md) |
| 旧升级入口交互方案 | [升级进度方案](operations/db-upgrade-progress-plan.md)；当前操作及版本边界见[升级指南](operations/upgrade.md) |

### 历史记录

| 类别 | 文档与适用范围 |
| --- | --- |
| 成长阶段交付 | [第一阶段](account/user-growth-stage-1-progress.md)、[第二阶段](account/user-growth-stage-2-progress.md)、[第三、四阶段](account/user-growth-stage-3-4-progress.md)、[第五阶段](account/user-growth-stage-5-progress.md) |
| 成长资源与界面记录 | [头像资源](account/user-growth-avatar-assets.md)、[头像弹窗经验条](account/user-growth-menu-experience-2026-10-26.md)、[规则弹窗](account/user-growth-rules-dialog-2026-10-26.md)、[界面微调](account/user-growth-ui-polish-2026-10-26.md)、[代码审核修复](account/user-growth-review-2026-10-26.md) |
| 资金实施与验收 | [钱包首版](account/user-wallet-progress.md)、[资金存取历史验收](account/user-wallet-transfers-progress.md#验收环境与步骤) |
| 历史数据库操作 | [2026-10-26 正式升级记录](account/user-growth-formal-upgrade-2026-10-26.md)、[历史归属移除记录](account/user-growth-history-removal-2026-10-26.md)；当前操作统一使用升级指南 |
| AI 历史 | [自动交互](ai/ai-assistant-interaction.md)、[Function Calling 设计](ai/ai-function-calling-design.md)、[实施记录](ai/ai-function-calling-implementation.md)、[复盘规划](ai/ai-review-version-plan.md) |
| 回放设计与实施 | [交易关卡深化设计快照](replay/training-gate-v2-requirements.md)、[自营账户开发日志](replay/prop-practice-account-development-log.md)、[自营账户分阶段实施](replay/prop-practice-account-implementation.md)；当前规则见上方对应规范 |
| 性能与实现背景 | [趋势线性能](charting/trend-line-performance-results.md)、[普通推进优化](replay/replay-performance-optimizations.md)、[特殊场景等待](replay/replay-special-waits.md)、[SQLite WAL 验证](operations/sqlite-wal-validation.md) |
| 外部调研快照 | [机构账户模式调研（2026-10-23）](research/prop-firm-account-models-2026-10-23.md)；不保证今天的报价、销售状态或规则仍然相同 |
| 开发历史 | [截至 2026-10-19 的日志目录](logs/README.md)、[早期周报](logs/2026-early-weeks.md)、[近期日志](logs/2026-10.md)、[提交索引快照](logs/commits.md)、[2026-08-30 开发历史](history/development-history-2026-08-30.md) |
| 审查记录 | [历史交接摘要](reviews/handoff.md)、[2026-10-20 审查快照](reviews/architecture-review-2026-10-20.md)、[历史修复报告](reviews/fix-report-2026-10-20.md)、[2026-10-23 大文件扫描](reviews/large-code-files-over-1000-lines.md)；AR-04 当前状态见[聚合代次限制](market-data/time-aggregation.md#ar-04-generation-lifecycle) |
