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

## 当前开发摘要（2026-08-30）

当前工作区已经实现 K 线回放、EMA、多周期聚合和模拟交易。相关修改尚未暂存或提交，继续开发时应保留这些改动，不要回退或覆盖。

### 多周期 K 线聚合

- 回放时间线与图表时间线已经分离：回放及模拟撮合始终按源 K 线序号推进，图表可以显示聚合后的高周期 K 线。
- `MarketDataset.sourceIntervalSeconds` 是源周期的权威字段，旧的 `timeframe` 只用于显示和旧数据兼容。
- 支持 1 秒至 24 小时的固定周期。目标周期必须不小于源周期、是源周期的整数倍；例如支持 `1s → 9m`、`5m → 10m`，拒绝 `5m → 9m`。
- 交易时段支持：
  - `TWENTY_FOUR_SEVEN`：按 UTC 固定边界聚合。
  - `DAILY_SESSION`：按 IANA 时区、单个日内开收盘时间及交易星期对齐。
- 第一版不支持跨夜时段、午休分段、交易所节假日历及日/周/月自然周期。
- 聚合结果状态为 `FORMING`、`COMPLETE` 或 `INCOMPLETE`。缺失源 K 线不会被补齐，回放会直接跳到下一根真实数据，并在图表标记不完整。
- 核心纯 TypeScript 实现位于 `lib/market-replay/aggregation.ts`，不得把聚合规则复制到 React 或 API 路由中。

### 回放数据流与图表

- 浏览器不再获取完整源数据；旧的 `GET /api/market-datasets/[id]/bars` 已返回 `410`。
- 图表窗口通过 `GET /api/market-datasets/[id]/bars/window` 获取，接口只返回当前源序号及以前的聚合窗口、EMA 预热区和最后一根源 K 线。
- 回放起点通过 `POST /api/market-datasets/[id]/replay/start` 在服务端定位。
- `ReplayProgress` 使用 `playbackRate`（整数 `1–100`）和 `displayIntervalSeconds`。旧 `intervalMs` 暂时保留一轮迁移兼容，不应再用于新回放逻辑。
- 自动播放和“下一根”按显示周期整根推进。1× 的每根等待时间等于显示周期，倍率相应缩短等待；例如 5 分钟 / 100× 为每 3 秒一根。时间戳缺口、周末和休市不会额外等待。页面进入后台时自动暂停。
- `POST /api/market-datasets/[id]/replay/advance` 未传显示周期时单次最多推进 100 根源 K 线；传显示周期时 `count` 表示显示 K 线根数，单次读取上限 86,400 根源 K 线。模拟交易引擎仍按顺序逐源处理，不能把一批源 K 线合并后撮合。
- 显示周期推进返回 `aggregatedBars`（受影响桶的完整修订）和 `lastSourceBar`，前端替换/追加这些桶，不再每一步请求完整窗口。权益采样点批量写入，账户快照在推进事务内读取。
- `GET /api/market-datasets/[id]/progress` 用于失败后的权威进度和账户同步；`PUT` 只保存速度与显示周期，不覆盖推进序号或重新创建已清空的回放。快速手动点击串行执行。
- Lightweight Charts 使用 `series.update()` 更新当前形成 K 线；用户手动平移后不得自动跳回左侧，只有视口仍位于实时右边缘时才跟随新 K 线。
- EMA 只使用屏幕可见聚合 K 线及左侧最多 `max EMA length` 根预热数据，不从数据集第一根递推，因此窗口左端可能与 TradingView 全历史 EMA 有轻微差异。
- 成交标记显示在成交源序号所属的聚合 K 线上，详情仍保留真实源时间、序号和成交价。

### 千万级导入与存储

- 单数据集上限为 `20,000,000` 根源 K 线；上传文件和解压后内容的默认上限均为 5 GB。
- 支持 CSV 和 CSV.GZ，`timestamp` 始终表示源 K 线开盘时间。
- 导入使用持久化任务：创建任务、流式上传、流式解压/校验、分块写入、成功后发布数据集。
- 导入中的数据集状态为 `IMPORTING`，不会出现在正常列表中；失败时删除隐藏数据，保留原文件供从头重试。
- 导入接口：
  - `POST /api/market-dataset-imports`
  - `PUT /api/market-dataset-imports/[jobId]/file`
  - `POST /api/market-dataset-imports/[jobId]/process`
  - `GET/DELETE /api/market-dataset-imports/[jobId]`
- 旧的 `POST /api/market-datasets` 全量表单导入已返回 `410`，不要重新引入 `request.formData() + file.text()` 的大文件实现。
- 每 4096 根源 K 线生成一条 `MarketBarBlock` 汇总。高周期窗口优先组合完整块，只读取跨目标桶边界的原始 K 线。
- 旧数据集首次打开窗口时会补建块级汇总；无法自动识别源周期时，详情页提供一次性元数据修正并校验全部时间戳。
- 临时上传文件保存在 `.market-imports/`，该目录已加入 `.gitignore`。

### 模拟交易兼容

- 显示周期只影响图表，不能改变模拟交易成交结果、订单生效序号、K 线内部路径或 OCO 行为。
- 批量推进必须在同一事务中更新回放进度、模拟账户、订单、成交、交易周期和权益采样点。
- 最大权益和最大回撤仍逐源 K 线计算；`PaperEquityPoint` 使用固定步长稀疏采样，使常规权益点约不超过 20,000 个，并在成交和最后一根额外保存。
- 重置或重新选择起点仍会清空模拟交易会话；单纯切换显示周期不会清空账户、挂单、成交或持仓。

### 数据库与验证状态

- Prisma 迁移：`prisma/migrations/20260830120000_add_market_aggregation/migration.sql`。
- `scripts/init-sqlite.mjs` 已同步新表、新字段和索引，本地 `prisma/dev.db` 已执行初始化。
- 当前验证结果：
  - `corepack pnpm lint`：通过。
  - `corepack pnpm test`：18 个测试文件、126 项测试通过。
  - `corepack pnpm run build`：通过。
  - `/market-replay`、行情数据集 API、导入任务 API 的生产运行态冒烟检查均返回 `200`。
- 测试包含以块级汇总代表 2000 万根源 K 线的逻辑聚合场景；尚未在当前工作区实际写入并导入一个完整 5 GB/2000 万行文件。
- Windows 下如果 Prisma 生成或构建出现 `EPERM`，先确认并停止命令行属于本项目的 Next.js/Node 开发进程，再运行生成或构建。
