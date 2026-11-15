# AGENTS.md

> 文档状态：当前规范。适用范围：开发协作约束与文档读取规则。

本地交易训练 Web 应用，支持多个无登录练习档案；不自行扩展登录、权限或多租户隔离。技术栈：Next.js App Router、TypeScript、Tailwind、Prisma + SQLite、Lightweight Charts / Recharts、Zod、Vitest。功能与启动步骤见 [README.md](README.md)。

## 安全与数据保护

- 保留已有工作区改动，不擅自回退或覆盖。不提交 `.env`、密钥、SQLite 数据库、截图、导入文件、日志、依赖或构建产物。
- 默认禁止批量或递归删除。执行清理前必须完整阅读 [文件清理与现场保留](docs/operations/file-cleanup.md)；仅规范内已核实的可丢弃产物可自动清理，超出范围的批量或递归删除须获得用户对明确路径的授权。不能证明归属或可丢弃性时不删除。
- 保护真实数据库及 WAL/SHM、原行情加密主密钥、用户文件、正式备份、数据卷和失败现场；不得为了通过验证而删除数据、重置库或移除升级锁。

## 架构与兼容

- 页面与组件负责展示和交互；API 负责校验、数据库读写及业务调用。蒙特卡洛算法放在 `lib/monte-carlo/`，保持纯函数，不依赖 React、Next、Prisma 或浏览器 API；成交 CSV 解析放在 `lib/csv/`。
- 行情聚合复用 `lib/market-replay/aggregation.ts`；模拟撮合放在 `lib/paper-trading/`，会话与纠错放在 `lib/replay-sessions/`。不要在组件或 API 中复制业务规则。
- 模拟配置与限制以 `lib/validations.ts` 为准；行情与回放限制以 `lib/market-replay/types.ts` 为准，保留计算量和资源上限校验。
- SQLite 中 `SimulationRun` 的 `config`、`summary`、`samplePaths`、`percentileCurves` 使用 String 保存 JSON；改为 Prisma Json 前必须验证迁移与 engine 兼容性。持久化 `samplePaths` 最多 100 条。
- 浏览器与共享代码须兼容普通 HTTP（含局域网访问）。UUID 使用 `import { createUuid } from "@/lib/uuid"`；禁止直接访问或解构浏览器 `crypto.randomUUID`、重复实现回退或用 `Math.random()` / 时间戳代替。纯服务端可用 `import { randomUUID } from "node:crypto"`；ESLint 限制的浏览器 UUID 直接访问仅在统一封装内允许。
- 新增依赖安全上下文的浏览器 API，须检查能力并提供 HTTP 兼容方案；相关验证至少覆盖 `crypto.randomUUID` 不可用的环境，不能只验证 `http://localhost`。

## 数据库版本基线与升级

- 修改数据库结构、升级、备份或部署前，必须阅读 [升级指南](docs/operations/upgrade.md)，遵守其中的入口选择、实际结构核验、停写、备份、副本演练与验收要求。
- `v1.0` tag 是最低兼容基线；更早数据库须先按该 tag 升级并验收。后续数据库变更须按指南建立统一升级入口，不继续扩展旧兼容链路；旧 `init-sqlite.mjs` 不维护 Prisma 迁移历史，不能与迁移命令混用来跳过错误。
- 结构变更同步 Prisma schema、增量迁移、新安装与适用升级入口；保留已发布的 `prisma/migrations` 及校验和。基线识别、两种来源接续、旧入口退役与验证矩阵只在升级指南维护。

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

- 开始任务时，从 [当前文档索引](docs/README.md#当前入口) 选择并阅读相关规范，无需通读全部专题；检索优先限定代码与当前规范。进入文档先核对顶部状态和适用章节，不按文件名、日期或搜索排名判断权威性；计划与历史仅在任务明确需要实施或追溯时读取，不能作为当前需求、环境状态或操作授权。
- 规范描述预期规则，代码与实际环境用于核对实现。状态、索引或规则有冲突时，核对代码、变更记录与已确认需求并记录差异；未厘清前不据此迁移、删除数据或回退功能，也不把实现缺口改写为产品政策。
- 规则完整定义只在所属专题维护，README 保留摘要与链接。功能规则变化须同步所属规范及必要的 README 摘要/实现依据；交付说明列出“文档影响”或“无规则变化”及原因。文档分类、索引、外部资料核验和检查边界遵循 [持续维护说明](docs/README.md#持续维护)，不以新增实施日志代替更新规范。

## 按需查阅

业务专题与实现入口统一见 [当前文档索引](docs/README.md#当前入口)，追溯入口见其“方案与历史材料”；不在本文件重复维护专题目录。清理、数据库和 UI 任务须先阅读上文指定规范。
