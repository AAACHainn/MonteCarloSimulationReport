# AGENTS.md

## 项目概览

本项目是一个交易系统蒙特卡洛模拟 Web 应用 MVP。用户上传历史成交记录后，系统会把每笔交易转换为 `R-multiple`，再通过有放回 Bootstrap 抽样运行多轮权益曲线模拟，输出最终权益、最大回撤、爆仓概率、最大连亏和分位数资金曲线等报告指标。

当前版本假设单用户本地使用，不包含登录、权限、团队、云端部署和多租户隔离。

默认界面语言为简体中文，文案集中在 [lib/i18n.ts](D:/work/code/codex/MonteCarloSimulationReport/lib/i18n.ts)。

## 技术栈

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui 风格的本地组件
- Prisma ORM
- SQLite，本地数据库文件为 `prisma/dev.db`
- Recharts
- Zod
- csv-parse
- Vitest
- pnpm，通过 `corepack pnpm ...` 运行

## 目录结构

```text
app/
  api/                         API Routes
  datasets/                    数据集页面
  simulations/                 模拟创建、报告、历史页面
  layout.tsx                   全局布局与导航
  page.tsx                     首页
components/
  datasets/                    数据集相关客户端/展示组件
  simulations/                 模拟表单、报告指标、图表组件
  ui/                          shadcn/ui 风格基础组件
lib/
  csv/parse-trades.ts          CSV 解析与 R 倍数转换
  monte-carlo/                 纯模拟算法、类型、统计函数
  db.ts                        Prisma Client 单例
  format.ts                    金额、数字、百分比格式化
  i18n.ts                      简体中文默认文案与显示标签
  validations.ts               Zod 表单/API 校验
prisma/
  schema.prisma                Prisma schema
  migrations/                  SQL 迁移
scripts/
  init-sqlite.mjs              受限环境下的 SQLite 初始化兜底脚本
```

## 核心功能

### 数据集与 CSV 上传

- 用户在 `/datasets` 创建 `TradeDataset`。
- 用户在 `/datasets/[id]` 上传 CSV。
- 支持字段：

```text
date,symbol,direction,pnl,riskAmount,rMultiple,note
```

- 如果 CSV 中有有效 `rMultiple`，直接使用。
- 如果没有 `rMultiple`，但有有效 `pnl` 和非零 `riskAmount`，计算：

```text
rMultiple = pnl / riskAmount
```

- 上传 CSV 会替换该数据集下已有交易。
- 无法推导出有效 R 倍数的行会被拒绝，并在上传结果中显示原因。

### 模拟配置

模拟入口为 `/simulations/new`。核心字段：

- `initialCapital`：初始资金
- `riskPercent`：每笔风险百分比
- `simulationCount`：模拟次数，上限 `50000`
- `tradesPerSimulation`：每轮模拟交易数，上限 `5000`
- `compoundingMode`：
  - `SIMPLE_FIXED_RISK`：固定初始资金计算风险
  - `COMPOUND`：按当前权益计算风险
  - `STEP_COMPOUND`：按阶梯权益计算风险
- `stepSize`：阶梯复利的阶梯大小
- `ruinThreshold`：破产线
- `samplingMethod`：当前固定为 `BOOTSTRAP_WITH_REPLACEMENT`

额外防御限制：`simulationCount × tradesPerSimulation <= 5,000,000`，避免本地 MVP 卡死。

### 蒙特卡洛算法

核心函数是 [simulateMonteCarlo](D:/work/code/codex/MonteCarloSimulationReport/lib/monte-carlo/simulate.ts)。

设计约束：

- 必须保持纯函数，不依赖 React、Next、Prisma 或浏览器 API。
- 输入为模拟配置和交易 R 倍数样本。
- 每轮模拟使用有放回抽样生成交易序列。
- 每笔交易按资金管理模式计算风险金额：

```text
pnl = riskAmount * rMultiple
currentEquity += pnl
```

- 每轮记录完整 `equityCurve`，但持久化时只保存最多 100 条 `samplePaths`。
- 汇总会计算盈利/亏损/爆仓场景、最终权益统计、最大回撤统计、最大连亏统计、直方图数据和分位数资金曲线。

## 数据模型

Prisma schema 位于 [prisma/schema.prisma](D:/work/code/codex/MonteCarloSimulationReport/prisma/schema.prisma)。

### TradeDataset

表示一组历史交易样本。

关键字段：

- `id`
- `name`
- `description`
- `trades`
- `simulationRuns`
- `createdAt`
- `updatedAt`

### Trade

表示单笔历史成交记录。

关键字段：

- `datasetId`
- `date`
- `symbol`
- `direction`
- `pnl`
- `riskAmount`
- `rMultiple`
- `note`

### SimulationRun

表示一次已保存的模拟结果。

关键字段：

- `datasetId`
- `config`
- `summary`
- `samplePaths`
- `percentileCurves`

注意：由于当前数据库使用 SQLite，`config`、`summary`、`samplePaths`、`percentileCurves` 在 schema 中是 `String`，应用层使用 `JSON.stringify` / `JSON.parse` 存取。不要直接改回 Prisma `Json`，除非同时验证 SQLite 迁移和 Prisma engine 兼容性。

## API 路由

- `GET /api/datasets`：列出数据集
- `POST /api/datasets`：创建数据集
- `GET /api/datasets/[id]`：读取数据集和交易
- `DELETE /api/datasets/[id]`：删除数据集及关联交易/模拟
- `POST /api/datasets/[id]/trades/upload`：上传并解析 CSV
- `GET /api/simulations`：列出模拟历史
- `POST /api/simulations`：运行模拟并保存结果
- `GET /api/simulations/[id]`：读取单次模拟报告

## 页面

- `/`：首页和主要入口
- `/datasets`：创建/查看数据集
- `/datasets/[id]`：上传 CSV、查看交易、删除数据集、进入模拟
- `/simulations/new`：创建模拟配置并运行
- `/simulations/[id]`：模拟报告和图表
- `/simulations/history`：模拟历史列表

## 图表

图表使用 Recharts，组件位于 `components/simulations/`。

当前展示：

- 样本权益曲线，最多展示 100 条
- 分位数权益曲线：`p5`、`p25`、`p50`、`p75`、`p95`
- 最终权益直方图
- 最大回撤直方图
- 最大连亏分布

## 国际化

默认语言是简体中文。

当前 i18n 是轻量实现，不引入路由级 locale，也不根据浏览器语言自动切换。所有可见文案优先从 [lib/i18n.ts](D:/work/code/codex/MonteCarloSimulationReport/lib/i18n.ts) 的 `copy` 读取。

新增页面或组件时：

- 不要把大段可见文案硬编码在组件里。
- 先把文案加到 `lib/i18n.ts`。
- 格式化金额、数字、百分比优先使用 [lib/format.ts](D:/work/code/codex/MonteCarloSimulationReport/lib/format.ts)。

## 本地运行

安装依赖：

```powershell
corepack pnpm install
```

环境变量：

```env
DATABASE_URL="file:./dev.db"
```

初始化 SQLite：

```powershell
corepack pnpm run db:init-sqlite
```

常规 Prisma 迁移也可使用：

```powershell
corepack pnpm prisma migrate dev
```

启动开发服务器：

```powershell
corepack pnpm dev
```

访问：

```text
http://localhost:3000
```

## 验证命令

提交前建议运行：

```powershell
corepack pnpm lint
corepack pnpm test
corepack pnpm run build
```

如果 Windows 下 build 因 Prisma query engine DLL 被占用失败，通常是 dev server 正在运行。先停止 Node 进程，再重新执行 build。

## 协作与维护约定

- 业务算法放在 `lib/monte-carlo/`，不要写进 React 组件。
- CSV 解析放在 `lib/csv/`，不要在上传组件里手写解析逻辑。
- API 层负责校验、数据库读写和调用纯业务函数。
- 页面组件优先保持展示和交互职责，避免混入模拟算法。
- 确认、删除等弹窗统一使用 `components/ui/confirm-dialog.tsx` 的定制弹窗风格，不使用浏览器原生 `alert` / `confirm`。
- SQLite 数据库文件、日志、构建产物、依赖目录和 `.env` 不应提交。
- 新增复杂逻辑时优先补 Vitest 单元测试。
- 保持单用户 MVP 假设，除非明确需求要求加入登录或权限。
