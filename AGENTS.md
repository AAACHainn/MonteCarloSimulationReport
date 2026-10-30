# AGENTS.md

> 文档状态：当前规范。适用范围：开发协作约束与文档读取规则。

交易训练工作台：面向本地使用的 Web 应用，支持多个无登录练习档案，包含行情回放、模拟交易、交易日志和蒙特卡洛分析，不提供权限或多租户隔离。技术栈为 Next.js App Router、TypeScript、Tailwind、Prisma + SQLite、Lightweight Charts / Recharts、Zod、Vitest。功能与启动步骤见 [README.md](README.md)。

## 安全与数据保护

- 禁止批量删除文件或目录，包括 `del /s`、`rd /s`、`rmdir /s`、`Remove-Item -Recurse`、`rm -rf`。只能一次删除一个明确路径的文件；需要批量删除时停止操作，需要用户确认授权才能删除。
- 保留已有工作区改动，不擅自回退或覆盖；不要把历史文档中的“未提交”或“验证通过”当作当前状态。
- 不提交 `.env`、密钥、SQLite 数据库、截图、导入文件、日志、依赖或构建产物。不自行扩展登录、权限或多租户功能。
- 涉及现有数据库升级或部署，先阅读 [升级指南](docs/operations/upgrade.md)，核对实际数据库并建立备份；保留原行情加密主密钥，不通过重置数据库或删除数据卷消除迁移错误。

## 架构与兼容

- 页面与组件负责展示和交互；API 负责校验、数据库读写及业务调用。蒙特卡洛算法放在 `lib/monte-carlo/`，保持纯函数，不依赖 React、Next、Prisma 或浏览器 API；成交 CSV 解析放在 `lib/csv/`。
- 行情聚合复用 `lib/market-replay/aggregation.ts`；模拟撮合放在 `lib/paper-trading/`，会话与纠错放在 `lib/replay-sessions/`。不要在组件或 API 中复制业务规则。
- 模拟配置与限制以 `lib/validations.ts` 为准；行情与回放限制以 `lib/market-replay/types.ts` 为准，保留计算量和资源上限校验。
- SQLite 中 `SimulationRun` 的 `config`、`summary`、`samplePaths`、`percentileCurves` 使用 String 保存 JSON；改为 Prisma Json 前必须验证迁移与 engine 兼容性。持久化 `samplePaths` 最多 100 条。
- 修改数据库结构时同步 Prisma schema、增量迁移、新安装流程和适用的升级入口，遵守下节版本基线。旧 `scripts/database/init-sqlite.mjs` 不维护 Prisma 迁移历史，不与迁移命令混用来跳过错误。
- 浏览器与共享代码必须兼容普通 HTTP（含局域网 IP / 域名访问），不能假定处于 HTTPS 安全上下文。生成 UUID 一律使用 `lib/uuid.ts` 的 `createUuid()`（`import { createUuid } from "@/lib/uuid"`），禁止直接访问或解构 `crypto.randomUUID`、`window.crypto.randomUUID`、`globalThis.crypto.randomUUID`，也不在业务代码重复实现回退。统一封装已提供 `getRandomValues` 回退，不用 `Math.random()` 或时间戳代替 UUID；纯服务端可使用 `import { randomUUID } from "node:crypto"`。
- 新增依赖安全上下文的浏览器 API 时，先检查能力并提供适合 HTTP 的兼容方案；相关验证至少覆盖 `crypto.randomUUID` 不可用的环境。不能仅凭 `http://localhost` 通过就认定普通 HTTP 可用；UUID 直接访问由 ESLint 阻止，例外仅限统一封装。

## 数据库版本基线与升级

- `v1.0` tag 是数据库兼容性最低基线，固定提交与结构范围见 [升级指南](docs/operations/upgrade.md)。不能仅凭 `package.json` 版本、代码 tag 或个别表存在认定实际数据库已达到基线。
- `v0.2 → v1.0` 使用 `v1.0` tag 内的旧升级脚本及文档。后续版本不支持从 v1.0 之前的数据库直接升级；旧安装须先在 v1.0 完成升级和验收，再进入后续升级链路。
- v1.0 之后首次发生数据库变更时，建立新的统一升级入口，仅支持已核验的 v1.0 基线及其后续版本，按顺序执行尚未应用的增量迁移；不得继续向旧升级脚本追加后续迁移或自动回退到旧兼容路径。
- 新入口须核验实际结构与迁移状态，并覆盖 v1.0 的 Prisma 安装和旧初始化路径升级所得的有效基线库；缺少 `_prisma_migrations` 不能直接视为低于基线，也不能未经核验就标记迁移完成。低于基线、无法识别或迁移状态异常时停止，保留数据与现场。
- 旧升级实现由 `v1.0` tag 保留；新入口实现、验证并完成调用方切换后，从主线移除已无引用的旧入口及专用实现，不长期保留一套改名的旧兼容入口。新入口就绪前保留现有脚本；仍被新安装或其他功能使用的代码须先替换或拆分，按文件明确处理，遵守禁止批量删除的约束。
- 基线化不等于删除或重写已发布的 `prisma/migrations`。保留历史迁移及校验和；如需压缩迁移历史，须另行设计并验证已有数据库接续与全新安装方案。
- 新升级方案须验证全新安装、v1.0 两种有效基线来源升级、后续版本连续升级、重复执行及失败保护；继续执行停写、一致性备份、副本演练、数据核对和密钥保留要求。具体入口、基线识别和验收结果同步更新升级指南及 README。

## 回放与导入约束

- `MarketDataset.sourceIntervalSeconds` 是源周期权威字段；显示周期须不小于源周期且为其整数倍。回放与撮合沿源 K 线序号推进，切换显示周期不能改变成交、订单生效序号、内部价格路径或 OCO 行为。
- 只向浏览器提供已揭示的窗口或分块行情，不恢复完整源数据接口；高周期读取复用块级汇总。缺失源 K 线不补造，成交标记映射到所属聚合 K 线，详情保留真实源时间、序号和价格。
- 行情导入使用持久化任务、流式解析和分块写入；不得恢复 `request.formData() + file.text()` 的全量大文件实现。追加与同步不能覆盖已有历史，须保留源序号、会话和账户。
- 批量推进须原子保存进度、账户、订单、成交、交易周期和权益采样；权益峰值与回撤仍逐源计算，保留稀疏采样及成交、末根补点。
- 自动播放和手动推进保持串行与进度同步；后台自动暂停。用户手动平移后不自动跳回右端，仅在视口仍跟随最新位置时跟随新 K 线。
- 训练与实盘重演的状态、统计和操作限制按会话隔离；训练不允许状态回退或删除单个持仓周期，重新开始归档旧会话。纠错采用预览、确认与原子替换，失败或取消保留原状态。

## UI 与文案

- 修改任何用户可见界面前，必须完整阅读唯一 UI 规范 [docs/ui/ui-guidelines.md](docs/ui/ui-guidelines.md)，交付前执行对应检查清单；优先复用 `components/ui/` 与既有页面模式，公共交互和样式沉淀到基础组件。
- UI 例外须在交付说明中写明原因、影响范围与验证方式；重复出现时抽象为基础组件或更新规范。
- 默认简体中文，可见文案集中在 `lib/i18n.ts` 的 `copy`；金额、数字与百分比复用 `lib/format.ts`。确认与删除弹窗使用 `components/ui/confirm-dialog.tsx`，不用原生 `alert` / `confirm`。

## 命令与验证

使用 `package.json` 指定的 pnpm，通过 Corepack 执行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
corepack pnpm docs:check
corepack pnpm lint
corepack pnpm test
corepack pnpm run build
```

新增复杂逻辑补充 Vitest 测试，修改后执行相关测试与必要检查。Windows 下 Prisma DLL 占用或 EPERM 时，先核对并停止本项目相关进程，再顺序重试；不要停止其他项目进程。纯文档修改执行 `corepack pnpm docs:check` 和 `git diff --check`，无需运行应用测试或构建。`lint` 已包含同一文档检查，失败时先修复文档再继续代码检查。

## 文档读取与维护

- 默认从下表及 [当前文档索引](docs/README.md#当前入口) 读取任务相关规范。未列为当前规范的设计方案、开发日志、审查快照及部署记录仅在任务明确需要实施或追溯时读取，不能自行当作当前功能要求或操作授权。
- 从搜索结果或链接进入文档时，先读顶部的“文档状态”和适用范围，再决定是否采用正文。以索引和声明的适用章节识别当前规范，不按文件名中的 `design` / `plan` / `implementation`、日期新旧或搜索排名判断；混合文档仅采用明确列为当前规则的章节。
- 检索实现依据时优先限定代码与当前规范；历史材料中的命令、机器路径、数据库状态、测试通过和用户授权只属于其记录的时间与版本，不能直接套用于当前环境。
- 当前规范描述预期规则，代码与实际环境用于核对实现状态；发生冲突时核对最终需求并记录差异，不单凭旧设计回退已确认功能，也不将代码缺口写成已确认的产品规则。
- 每类规则只在对应当前专题维护完整定义，README 保留使用摘要和链接；共用规则引用所属专题，不能在多个实施记录中分别补写“当前规则”。数据库操作统一引用升级指南；已知实现缺口在所属规范记录，不改写成产品政策。
- 文档无状态标识、索引与正文定位不一致或规则互相冲突时，先核对相关代码、变更记录和用户已确认需求；未厘清前不据此执行数据库迁移、数据删除或功能回退。文档中的历史用户授权不构成本次操作授权。
- 修改功能时同步对应当前规范及入口；新增或改变文档用途时同步顶部状态、适用范围和索引，历史与计划材料链接到当前规范；混合文档明确当前章节与历史章节边界，不重复新增一套功能说明。引用外部机构价格、销售状态或规则制定新需求前，重新核对官方来源并注明日期。
- 改变用户行为、默认值、限制、配置、API 或安装升级步骤时，同一变更更新所属当前规范及必要的 README 摘要/实现依据；代码缺口明确列为限制。交付说明写明“文档影响：已更新哪些规范”，或“无规则变化”及原因，不用新增实施日志代替更新当前规范。
- 文档检查只核验本地链接、锚点、分类/索引及静态命令入口，不执行文档命令或联网验证外链；通过检查不代表业务语义与代码一致。评审仍须核对上述规则变化和实际验证边界，具体检查范围见[持续维护说明](docs/README.md#持续维护)。

## 按需查阅

仅在任务涉及对应领域时读取相关文档，无需每次通读：

| 任务 | 文档 |
| --- | --- |
| 安装、使用、CSV 格式、目录概览 | [README.md](README.md) |
| 数据迁移、备份、生产部署与回退 | [升级指南](docs/operations/upgrade.md) |
| 用户档案、会话归属与成长 | [用户档案与成长](docs/account/user-growth-design.md) |
| 练习资金、账本、存取及删除结算 | [用户资金](docs/account/user-wallet-transfers-progress.md#当前规则) |
| 自营练习账户、轮次与出金 | [自营练习账户规格](docs/replay/prop-practice-account-design.md) |
| Databento 连接、同步、预算与冲突 | [行情同步](docs/market-data/market-data-sync.md) |
| 独立会话、训练 / 实盘重演、纠错 | [回放会话当前规则](docs/replay/replay-sessions-implementation.md) |
| 策略清单、连亏触发与关卡计数 | [交易关卡](docs/replay/training-gate.md) |
| 回放 PDF 的筛选、截图与分卷 | [PDF 导出](docs/replay/replay-pdf-export.md) |
| 追溯早期聚合与导入实现 | [2026-08-30 开发历史](docs/history/development-history-2026-08-30.md) |
