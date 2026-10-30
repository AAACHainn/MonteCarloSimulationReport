# 文档目录

> 文档状态：当前规范。适用范围：文档分类与读取入口；状态标识不代替内容核验。

安装与功能概览从[项目 README](../README.md)开始；开发约束见[协作约定](../AGENTS.md)。默认只读取当前入口；需要追溯时再读下方的方案和历史材料。专题内单列的历史验收段落不代表当前版本已复测。

## 阅读方式

- **当前规范**：用于当前功能、接口与操作约束；仍须核对相关代码和实际环境。标识说明文档用途，不表示全文已重新审查或所有功能已测试通过。
- **设计与计划**：用于理解实施思路和范围；下列三份方案已有实施记录，不自动作为新待办，也不沿用当时的阶段授权。
- **历史记录**：用于追溯指定日期或版本，不作为当前行为或运行状态依据。需要实施时转到其顶部链接的当前规范，外部调研须重新核查官方资料。

从搜索结果直接进入文档也先读顶部标识，不按文件名判断权威性。用户资金文档的“当前规则”至“实现依据”维护完整资金约束，“历史交付与验收”仅供追溯；绘图等专题中的历史验收数字、机器环境与命令仍按历史记录处理。未列入当前入口且缺少标识的材料，先核实用途再采用。

## 持续维护

功能改动先定位下表的所属规范。改变行为、默认值、限制、配置、API 或安装升级步骤时，同步更新该规范及必要的 README 摘要和实现依据；未实现的要求记为明确限制，历史记录不另建一套当前规则。交付说明列出更新的规范；纯重构等没有规则变化的改动说明原因。

新增、移动或改变文档用途时，同时维护顶部状态、适用范围、当前规范链接及索引。标题变化检查原章节链接，必要时保留显式锚点兼容旧引用。

提交前执行 `corepack pnpm docs:check` 和 `git diff --check`。`corepack pnpm lint` 已先执行文档检查，失败返回非零退出码。脚本与回归用例见[检查入口](../scripts/check-docs.mjs)和[检查测试](../scripts/check-docs.test.mjs)。

- 范围为根目录 AGENTS / README 与 `docs/` 下全部 Markdown；检查本地文件、图片、内联/引用式链接、Markdown 章节及显式 HTML 锚点，并核对路径大小写。
- 检查顶部分类、索引分区与覆盖、历史/计划指向当前规范的关系；代码示例里的假链接与假标题不作为真实目标。
- 命令只核对当前规范代码片段中的根项目 pnpm 脚本/依赖入口、可静态识别的 Node 文件路径，以及 `package.json` 脚本的 Node 文件入口。历史文档中的旧命令不要求在当前版本存在；`node_modules` 内部文件、动态路径、Shell 参数和运行环境不作可执行性保证。
- 检查不执行命令、不访问数据库、不联网检查外链，也不判断功能语义是否正确。评审仍需对照代码和已确认需求核对规则，不以检查通过代替应用测试、实际环境或浏览器验收。

## 当前入口

每类规则在所属专题维护完整定义，README 只保留用法摘要。表中的实现依据用于核对实际行为；代码缺口不能自动覆盖已确认需求。使用说明与技术契约分工互补，历史实施记录不再承担当前规则入口。

| 类别 | 当前规范及职责 | 主要实现依据 |
| --- | --- | --- |
| 用户档案与成长 | [归属、经验及突破规则](account/user-growth-design.md) | [成长规则与参数](../lib/user-growth/rules.ts)、[原子结算](../lib/user-growth/settlement.ts) |
| 用户资金 | [初始发放、账本、存取及删除结算](account/user-wallet-transfers-progress.md#当前规则) | [钱包服务](../lib/user-wallet/service.ts)、[资金存取](../lib/user-wallet/transfers.ts) |
| AI 机器人 | [使用、配置与统计口径](ai/ai-assistant.md)；[取图、展示及截图契约](ai/ai-chart-images.md) | [工具注册](../lib/ai/tools.ts)、[上限](../lib/ai/limits.ts)、[图片契约](../lib/ai/chart-images-contract.ts) |
| 图表绘图 | [矩形](charting/rectangle-drawing.md)、[文字用法与数据](charting/text-drawing.md)、[文字保存状态机](charting/text-autosave-design.md)、[AB=CD](charting/abcd-drawing.md)、[箭头](charting/arrow-drawing.md)；跨工具保存规则见[会话绘图持久化](charting/archived-drawings.md) | [类型、样式与校验](../lib/market-replay/chart-drawings.ts)、[快捷键](../lib/market-replay/keyboard-shortcuts.ts)、[文字自动保存](../lib/market-replay/text-autosave.ts) |
| 行情数据 | [增量同步与预算](market-data/market-data-sync.md)；[时间聚合、质量与查询](market-data/time-aggregation.md) | [同步引擎](../lib/market-sync/engine.ts)、[调度](../lib/market-sync/runtime.ts)、[聚合任务](../lib/market-replay/aggregation-jobs.ts) |
| 回放与交易 | [会话与纠错](replay/replay-sessions-implementation.md)；[自营账户](replay/prop-practice-account-design.md)；[交易关卡](replay/training-gate.md)；[空仓推进](replay/flat-replay-advance.md) | [会话服务](../lib/replay-sessions/service.ts)、[自营规则](../lib/prop-practice/rules.ts)、[关卡状态](../lib/paper-trading/training-gate.ts)、[空仓推进](../lib/market-replay/flat-advance.ts) |
| PDF 导出 | [筛选、截图、分卷及任务生命周期](replay/replay-pdf-export.md) | [共享上限](../lib/paper-trading/pdf-types.ts)、[规划](../lib/paper-trading/pdf-planner.ts)、[任务管理](../components/market-replay/pdf-export-provider.tsx) |
| 蒙特卡洛 | [使用与计算口径](../README.md#蒙特卡洛风险分析) | [参数与计算量限制](../lib/validations.ts)、[模拟算法](../lib/monte-carlo/simulate.ts) |
| 安装与运维 | [升级、备份与部署](operations/upgrade.md)；数据库操作只从此入口选择路径 | [命令定义](../package.json)、[结构](../prisma/schema.prisma)、[迁移目录](../prisma/migrations/) |
| UI 规范 | [唯一 UI 规范](ui/ui-guidelines.md)，约束新增与修改部分 | [基础组件](../components/ui/)、[全局样式](../app/globals.css)、[格式](../lib/format.ts) |

## 方案与历史材料

以下内容不进入默认实现依据；其中的阶段目标不自动成为待开发需求，命令、授权、服务状态和验证结果只对应注明的版本。外部调研需要使用时先重新核查官方资料。

2026-10-30 精简历史材料时，移除了重复的启动/手动验收步骤、临时服务交接和已撤回方案的操作细节，保留决策理由、版本范围及必要验证证据。需要追溯精简前完整正文时，按原文档路径查看 Git 提交 `0716f3e`；不能从旧正文直接恢复操作授权。

旧数据库的 `v0.2 → v1.0` 升级仍使用 `v1.0` tag 的完整代码与同版本指南；当前升级入口及后续兼容边界只在[升级指南](operations/upgrade.md)维护。历史审查中的 AR-04 等未解决限制继续由当前专题跟踪，不因精简记录而标记修复。

### 设计与计划

| 类别 | 文档与当前入口 |
| --- | --- |
| 用户成长分阶段方案 | [五阶段实施顺序与交付摘要](account/user-growth-implementation-plan.md)；当前规范见[用户档案与成长](account/user-growth-design.md) |
| 聚合排队与写入冲突方案 | [聚合排队方案](operations/aggregation-lock-repair-plan.md)；当前规范见[时间聚合与查询](market-data/time-aggregation.md) |
| 旧升级入口交互方案 | [升级进度方案](operations/db-upgrade-progress-plan.md)；当前操作及版本边界见[升级指南](operations/upgrade.md) |

### 历史记录

| 类别 | 文档与适用范围 |
| --- | --- |
| 成长阶段交付 | [第一阶段](account/user-growth-stage-1-progress.md)、[第二阶段](account/user-growth-stage-2-progress.md)、[第三、四阶段](account/user-growth-stage-3-4-progress.md)、[第五阶段](account/user-growth-stage-5-progress.md) |
| 成长资源与界面记录 | [头像资源](account/user-growth-avatar-assets.md)、[头像弹窗经验条](account/user-growth-menu-experience-2026-10-26.md)、[规则弹窗](account/user-growth-rules-dialog-2026-10-26.md)、[界面微调](account/user-growth-ui-polish-2026-10-26.md)、[代码审核修复](account/user-growth-review-2026-10-26.md) |
| 资金实施与验收 | [钱包首版](account/user-wallet-progress.md)、[资金存取历史验收](account/user-wallet-transfers-progress.md#历史交付与验收2026-10-26) |
| 历史数据库操作 | [2026-10-26 正式升级记录](account/user-growth-formal-upgrade-2026-10-26.md)、[历史归属移除记录](account/user-growth-history-removal-2026-10-26.md)；当前操作统一使用升级指南 |
| AI 历史 | [自动交互](ai/ai-assistant-interaction.md)、[Function Calling 设计](ai/ai-function-calling-design.md)、[实施记录](ai/ai-function-calling-implementation.md)、[复盘规划](ai/ai-review-version-plan.md) |
| 回放设计与实施 | [交易关卡深化设计快照](replay/training-gate-v2-requirements.md)、[自营账户开发日志](replay/prop-practice-account-development-log.md)、[自营账户分阶段实施](replay/prop-practice-account-implementation.md)；当前规则见上方对应规范 |
| 性能与实现背景 | [趋势线性能](charting/trend-line-performance-results.md)、[普通推进优化](replay/replay-performance-optimizations.md)、[特殊场景等待](replay/replay-special-waits.md)、[SQLite WAL 验证](operations/sqlite-wal-validation.md) |
| 外部调研快照 | [机构账户模式调研（2026-10-23）](research/prop-firm-account-models-2026-10-23.md)；不保证今天的报价、销售状态或规则仍然相同 |
| 开发历史 | [截至 2026-10-19 的日志目录](logs/README.md)、[早期周报](logs/2026-early-weeks.md)、[近期日志](logs/2026-10.md)、[提交索引快照](logs/commits.md)、[2026-08-30 开发历史](history/development-history-2026-08-30.md) |
| 审查记录 | [历史交接摘要](reviews/handoff.md)、[2026-10-20 审查快照](reviews/architecture-review-2026-10-20.md)、[历史修复报告](reviews/fix-report-2026-10-20.md)、[2026-10-23 大文件扫描](reviews/large-code-files-over-1000-lines.md)；AR-04 当前状态见[聚合代次限制](market-data/time-aggregation.md#ar-04-generation-lifecycle) |
