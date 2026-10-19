# 交易系统分析台

**Monte Carlo Simulation Report** · K 线回放训练、交易日志与蒙特卡洛风险分析

![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

面向个人交易者的本地 Web 应用：导入历史行情，在隐藏未来数据的环境中练习交易；记录策略、执行与复盘；使用历史交易的 `R-multiple` 样本，分析不同资金管理方式下的收益、回撤和连续亏损分布。默认界面语言为简体中文，数据保存在本地 SQLite 中。

[功能概览](#功能概览) · [快速开始](#快速开始) · [使用流程](#使用流程) · [功能说明](#功能说明) · [导入格式](#导入格式) · [数据与使用边界](#数据与使用边界) · [开发与验证](#开发与验证) · [文档导航](#文档导航)

## 功能概览

| 模块 | 主要能力 |
| --- | --- |
| K 线回放 | CSV / CSV.GZ 导入与追加、多周期聚合、逐根播放、EMA / ABR / Bar Count、图表绘图 |
| 回放会话 | 同一行情下建立多个独立训练或实盘重演会话，隔离进度、账户、订单与日志 |
| 模拟交易 | 市价 / 限价 / 止损单、止盈止损、风险定额下单、手续费与滑点、账户统计 |
| 交易关卡 | 策略检查清单、连续亏损触发、按实际入场成交计数、检查快照留存 |
| 交易复盘 | FIFO 成交配对、历史交易查看、复盘模板、Excel / PDF 导出 |
| AI 机器人 | 自定义模型端点、全局流式聊天、模板复盘草稿、单会话归纳与证据 |
| 交易日志 | 按账户记录交易、截图与标签、R 倍数计算、筛选统计、ZIP 备份与合并 |
| 蒙特卡洛分析 | Bootstrap 抽样、三种资金管理模式、权益分布、最大回撤、爆仓概率与最大连亏 |
| 行情同步 | Databento CME 行情手动 / 自动增量同步、费用预估与预算、重叠区间校验 |

## 快速开始

以下步骤用于全新安装。已有数据库的安装请先阅读 [升级指南](docs/upgrade.md)，按原有数据库管理方式升级。

### 获取源码

```bash
git clone https://github.com/AAACHainn/MonteCarloSimulationReport.git
cd MonteCarloSimulationReport
```

### 方式一：本地 Node.js

使用 Node.js 22，建议 22.14 或更新的 22.x 版本；pnpm 版本由 `package.json` 固定为 `11.4.0`，通过 Corepack 执行。

1. 从示例创建 `.env`。PowerShell：

   ```powershell
   Copy-Item .env.example .env
   ```

   macOS / Linux / WSL：

   ```bash
   cp .env.example .env
   ```

2. 安装依赖、生成 Prisma Client 并应用仓库中的数据库迁移：

   ```bash
   corepack pnpm install --frozen-lockfile
   corepack pnpm prisma generate
   corepack pnpm prisma migrate deploy
   ```

3. 启动开发服务：

   ```bash
   corepack pnpm dev
   ```

打开 [http://localhost:3000](http://localhost:3000)。

若环境无法运行 Prisma migrate，仓库提供 `corepack pnpm run db:init-sqlite` 兜底入口。它不维护 Prisma 迁移历史；选择前请阅读 [数据库升级路径](docs/upgrade.md#3-获取代码并选择迁移路径)，不要与迁移命令混用来跳过错误。

### 方式二：Docker Compose 开发

需要 Docker Engine + Compose，或 Docker Desktop；容器内已包含 Node.js 与 pnpm。

```bash
docker compose up --build -d
```

打开 [http://localhost:3001](http://localhost:3001)。首次启动会安装依赖、生成 Prisma Client、应用迁移并启动开发服务，进度可通过日志查看：

```bash
docker compose logs -f app
```

停止服务：

```bash
docker compose down
```

`compose.yaml` 挂载源码以支持热更新，依赖与构建缓存使用命名卷；数据库、截图和行情导入文件位于挂载的项目目录。上述停止命令保留这些数据。端口默认 `3001`，可通过 `APP_PORT` 环境变量调整。

### 环境变量

完整示例见 [`.env.example`](.env.example)。仅使用本地导入、回放和蒙特卡洛分析时，无需配置 Databento 连接。

| 变量 | 默认值 / 示例 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | 本地 Node 与开发 Compose 下对应 `prisma/dev.db` |
| `SQLITE_DRIVER` | `native` | 可选 `better-sqlite3`；切换前按升级指南备份并在目标环境验证 |
| `SQLITE_JOURNAL_MODE` | `delete`（示例配置） | 新驱动可显式设为 `wal`，每条连接保持 FULL；native 仅支持 DELETE |
| `MARKET_DATA_ENCRYPTION_KEY` | 空 | 可选；行情连接使用的 32 字节 Base64 加密主密钥，配置后须跨重启与升级保留 |
| `MARKET_DATA_SYNC_ENABLED` | `1` | 行情同步任务处理与调度开关；设为 `0` 关闭，数据集仍需单独启用同步 |
| `AI_ENCRYPTION_KEY` | 空 | 独立 AI 密钥加密主密钥；本地运行 `node scripts/setup-ai-key.mjs` 生成一次并保留 |
| `APP_PORT` | `3001` | Compose 的宿主机端口；本地 Node 开发默认使用 `3000` |

### 本地生产模式

在完成依赖安装、环境配置和数据库迁移后运行：

```bash
corepack pnpm run build
corepack pnpm start
```

仓库还提供 `Dockerfile.prod` 与 `compose.prod.yaml`。生产 Compose 引用预构建镜像，拉取源码不会自动更新该镜像；runner 已包含后台 worker 所需源码，仍须验证目标镜像的原生驱动、worker 与持久化。启用 WAL 时还需显式传入 SQLite 配置，并将迁移从服务启动命令分离，详见 [Docker 部署检查](docs/upgrade.md#docker-部署的额外检查)。

本次回放事务、浏览器和特殊等待优化无需新增结构迁移，重新构建、重启并刷新页面即可生效；SQLite WAL 提交优化需额外显式接入，版本来源和切换步骤见 [SQLite 升级](docs/upgrade.md#sqlite-引擎与-wal-升级)。

## 使用流程

1. **练习交易**：进入 `/market-replay`，导入行情，创建训练会话，选择起点，逐根回放并模拟下单。平仓后在回放交易日志中补充策略、交易理由与复盘，按需导出。
2. **记录交易**：进入 `/trade-journals`，按账户创建日志，填写风险与成交信息，添加截图和标签。品种、策略、交易理由和标签在 `/master-data` 统一维护。
3. **评估风险**：在 `/datasets` 上传历史成交 CSV，或使用交易日志对应的样本，进入 `/simulations/new` 设置资金管理参数，运行并保存报告。历史报告位于 `/simulations/history`。

## 功能说明

### 回放与模拟交易

- **隐藏未来数据**：选定的起点 K 线在执行“下一根”后揭示；支持单步、连续播放、暂停与 `1×–100×` 倍速，页面进入后台时自动暂停。
- **多周期图表**：支持 1 秒至 24 小时的固定显示周期；显示周期须不小于源周期且为其整数倍。切换周期不会改变回放位置或撮合结果。
- **图表工具**：最多 5 条可配置 EMA、ABR、Bar Count、成交量、K 线倒计时、区间测量、趋势线、斐波那契回撤和矩形；CME 股指期货支持 ETH / RTH 切换。
- **矩形标注**：`Shift + R`（Windows / Mac 通用）启动，两次点击确定对角；默认蓝色填充、不透明度 15%、无边框，支持颜色、透明度、独立边框和样式模板。点击边缘选中，拖动内部移动、8 个控制点缩放，双击边缘或点击对象窗口的设置按钮编辑。模板在矩形设置中保存和选用；每类最多 50 个，保存在当前浏览器和站点。普通回放和所有历史页的绘图统一按会话保存到后端，同一会话共用绘图，刷新后保留。对象窗口支持主动清空，归档不会自动清空。详见[矩形绘图与性能验证](docs/rectangle-drawing.md)和[归档绘图持久化](docs/archived-drawings.md)。
- **逐源撮合**：订单从下一根源 K 线开始生效，按源数据顺序处理；暂停时点击“一键平仓”或“全部平仓”，以当前已揭示源 K 线收盘价为基准立即成交，不推进回放；自动播放时仍按下一根开盘成交。支持保护单、撤单与反手，并将手续费和滑点计入结果。
- **后端成交与自动恢复**：撮合只在服务端执行，事务保存成功后才揭示新 K 线。网络中断、超时或临时服务错误时保持当前图表并自动重试，成功后续播；期间手动暂停或切到后台则保持暂停。请求按固定编号重试，避免响应丢失造成重复成交；状态冲突会原位暂停，不自动恢复旧进度。
- **风险定额下单**：通过入场、止损和目标价计算数量、预计盈亏与净盈亏比；图表展示委托线、持仓和成交位置。
- **独立会话**：同一行情可建立多个会话，切换时分别保存账户与进度；会话可重命名、归档和删除。

两种会话用途分别为：

| 模式 | 适用场景 | 记录规则 |
| --- | --- | --- |
| 模拟训练 | 在未知后续行情的条件下练习决策与执行 | 保留训练过程，不支持状态回退或删除单个持仓周期；重新开始会归档旧会话 |
| 实盘重演 | 按历史行情重演并整理交易过程 | 支持快速推进、回退与完整持仓周期删除；纠错经后台重建、预览与确认后生效 |

“实盘重演”使用本应用的回放撮合，不连接券商，也不接收真实成交覆盖。

训练会话还可启用 **交易关卡**：入场前选择策略并完成检查清单，按实际入场成交累计完成笔数；连续两次亏损结算会自动触发关卡。检查快照随交易留存，详细计数与恢复规则见 [交易关卡说明](docs/training-gate.md)。

### 行情导入与同步

- 支持标准 OHLCV CSV / CSV.GZ，以及 Databento CME parent-symbol OHLCV 文件；后者按成交量与 CME 换月规则筛选季度主力合约。
- 导入采用持久化任务、流式解析与分块写入，展示各阶段进度，失败或中断后可以重试。
- 已有数据集可追加行情，只发布当前结束时间之后的数据，跳过重叠与重复记录，保留原有源序号、回放进度和账户。
- 追加时校验品种、源周期与时间对齐，遇到时间缺口先展示预览，确认后保留缺口继续追加。
- Databento 同步按数据集启用，支持手动更新与自动计划；先检查可用范围、估算费用及预算，再分段下载并校验重叠区间。
- 自动同步随 Node 服务运行，无需系统定时任务或保持浏览器打开；数据修订与历史冲突会暂停同步，不自动覆盖已有行情。

API Key 配置、费用预算和同步边界见 [行情同步说明](docs/market-data-sync.md)。

### 交易日志与复盘

回放成交按 FIFO 配对为日志，保留 Setup、交易理由、风险与收益指标。可筛选记录、查看会话统计、填写复盘并复用模板；历史交易可在只读回放中查看当时的行情与成交标记。

回放日志支持 Excel 导出，以及包含中文明细和 K 线截图的 PDF 分卷导出。PDF 可以选择周期、ETH / RTH 与明细字段，具体范围和分卷行为见 [PDF 导出说明](docs/replay-pdf-export.md)。

独立交易日志按账户管理，支持截图、全局标签、策略代码、表格 / 浏览视图、筛选统计，以及 ZIP 导出、导入和合并备份。交易日志的有效 R 倍数可直接用于蒙特卡洛分析。

### AI 机器人

页面右下角提供唯一的 AI 机器人，直接提问即可自动识别普通讨论、图表分析、复盘草稿和整个会话报告，无需选择角色。在回放页面自动关联当前会话、可见图表或正在编辑的交易，按需调用只读工具；资料有歧义时再询问，也可通过“资料”指定其他范围。历史交易复盘保留模板和当前未保存草稿，采用后仍需手动保存；整个会话报告保留全量覆盖、证据与断点。图表默认获取当前周期图片，明确要求时支持多周期多图；缺图由浏览器按需生成，行情数据仅在程序内部用于绘图。详见 [图表图片工具](docs/ai-chart-images.md)。

首次使用先升级数据库并配置独立加密主密钥，再从首页“AI 配置”进入独立设置页，填写 Base URL 和可选 API Key，拉取并选择默认模型；机器人窗口的设置图标也可在新标签页打开该页面。保存不会自动探测模型；真实服务测试可能收费。使用、口径及限制见 [AI 机器人说明](docs/ai-assistant.md)。

“AI 配置 → 用量与上限”可设置输出 Token、输入估算、模型/工具请求和等待上限；聊天可临时调整后重试或继续已有批次。回答卡片显示服务实际报告的累计 Token 及最近输出/上限，未报告部分显示未知。每次输出上限与累计用量分别展示，实际容量仍受模型服务限制。

### 蒙特卡洛风险分析

从历史交易的 `R-multiple` 样本中进行有放回 Bootstrap 抽样，为不同交易顺序生成多轮权益结果。每笔盈亏由风险金额与抽中的 R 倍数计算：

```text
每笔盈亏 = 风险金额 × R-multiple
交易后权益 = 交易前权益 + 每笔盈亏
```

| 资金管理模式 | 风险金额计算基数 |
| --- | --- |
| 固定风险 | 初始资金 |
| 复利 | 当前权益 |
| 阶梯复利 | 按配置的阶梯大小计算权益基数 |

可配置初始资金、每笔风险比例、模拟次数、每轮交易数与破产线。报告包含盈利 / 亏损 / 爆仓场景统计、最终权益与最大回撤分布、最大连亏分布，以及 `P5 / P25 / P50 / P75 / P95` 分位数权益曲线。

Bootstrap 使用输入样本的经验分布并重新抽样交易顺序；报告用于理解样本和资金管理参数下的风险范围，不能视为未来收益保证。

## 导入格式

### 行情 K 线

必需列为 `timestamp,open,high,low,close`，`volume` 可选：

```csv
timestamp,open,high,low,close,volume
2026-01-02T09:30:00Z,6010.25,6011.50,6009.75,6011.00,1284
2026-01-02T09:31:00Z,6011.00,6012.00,6010.50,6011.75,946
```

`timestamp` 表示源 K 线的开盘时间。初次导入要求时间严格递增且不重复；不含时区的时间戳按导入时选择的 IANA 时区解释。系统校验 OHLC、源周期间隔和交易时段对齐，缺失 K 线不会自动补齐。

普通 CSV 追加可携带 `symbol` 与 `source_interval_seconds` 字段供校验；缺少时须在界面声明品种与源周期。

### 蒙特卡洛交易样本

可使用仓库中的 [成交 CSV 模板](public/templates/trades-template.csv)：

```csv
date,symbol,direction,pnl,riskAmount,rMultiple,note
2026-01-02,ES,LONG,150,100,1.5,直接使用 R 倍数
2026-01-03,NQ,SHORT,-120,100,,由盈亏与风险金额计算
2026-01-04,CL,LONG,75,100,0.75,可选备注
```

- 有效 `rMultiple` 优先使用；缺少时通过 `pnl / riskAmount` 推导，`riskAmount` 不能为零。
- 无法得到有效 R 倍数的行会被拒绝，并返回具体原因。
- 可额外提供 `strategyCode` 列保存策略代码。
- 向普通交易数据集上传 CSV 会替换该数据集的原有交易；交易日志关联的数据集由日志维护。

## 数据与使用边界

### 数据保存位置

| 数据 | 默认位置 |
| --- | --- |
| SQLite 数据库 | 本地 Node / 开发 Compose：`prisma/dev.db` |
| 行情导入任务文件 | `.market-imports/` |
| 交易截图 | `storage/` |
| 生产 Compose 数据 | 数据库使用 `app_data` 卷，截图使用 `app_storage` 卷 |

交易记录、模拟报告、回放会话、账户、订单与复盘保存在 SQLite 中。`.env`、数据库、截图、导入文件、日志、依赖和构建产物已由 `.gitignore` 排除。

备份时同时保存数据库、截图与环境配置；使用行情连接时须保留原加密主密钥。运行中的 SQLite 需使用一致性备份，详细步骤见 [备份与回退](docs/upgrade.md)。

### 当前范围与限制

- 面向单用户本地使用，未包含应用登录、权限管理与多租户隔离；远程访问需要自行提供访问保护。
- 单数据集最多 `20,000,000` 根源 K 线；上传文件与解压后内容的默认上限均为 `5 GiB`。实际导入速度取决于磁盘、内存与数据情况，上限不代表已完成对应规模的实机性能验证。
- 蒙特卡洛单次最多 `50,000` 轮，每轮最多 `5,000` 笔，另受总计算量限制；当前校验上限见 [`SIMULATION_WORK_LIMIT`](lib/validations.ts)。
- 图表显示周期是固定时长聚合，不提供自然周 / 月 K 线；EMA 使用可见窗口及左侧预热数据，窗口左端可能与全历史递推结果有差异。
- 行情导入和纠错依赖独立 Node 子进程及可写本地存储，部署环境需要支持这些能力。

## 开发与验证

技术栈：Next.js 15 App Router、React 19、TypeScript、Tailwind CSS、本地 shadcn/ui 风格组件、Prisma + SQLite、Lightweight Charts + Recharts、Zod、csv-parse 与 Vitest。

```text
app/                    页面与 API Routes
components/             业务组件与共享 UI 组件
lib/
  monte-carlo/          蒙特卡洛算法、统计与类型
  market-replay/        行情解析、聚合、回放与图表逻辑
  market-sync/          Databento 连接、同步与调度
  replay-sessions/      独立会话、状态持久化与纠错重建
  paper-trading/        模拟撮合、交易日志与导出
  trade-journal/        交易记录、标签与备份
  i18n.ts               简体中文文案
prisma/                 数据模型与迁移
scripts/                数据库初始化、后台 worker 与专项验证
public/templates/       CSV 模板
doc/logs/               开发周报、近期日记录与完整 Git 提交索引
docs/                   使用、开发与升级说明
```

提交改动前按顺序运行：

```bash
corepack pnpm lint
corepack pnpm test
corepack pnpm run build
```

Windows 下若 Prisma query engine DLL 被占用，请先确认并停止本项目的开发服务及关联 Node 进程，再重新构建。

参与开发前阅读 [协作约定](AGENTS.md)；涉及界面的修改须遵循 [UI 规范](docs/ui-guidelines.md)。业务算法保持独立，界面文案集中维护在 `lib/i18n.ts`，金额与数字格式化复用 `lib/format.ts`。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [开发日志](doc/logs/README.md) | main 分支开发历史：早期按周、近期按天及完整提交索引 |
| [现有安装升级与跨机器部署](docs/upgrade.md) | 备份、迁移路径、密钥保留、生产部署检查、验收与回退 |
| [行情增量同步](docs/market-data-sync.md) | Databento 连接、自动计划、预算与冲突处理 |
| [模拟训练交易关卡](docs/training-gate.md) | 策略清单、连亏触发、计数与会话恢复 |
| [回放交易 PDF 导出](docs/replay-pdf-export.md) | 筛选、截图、明细字段与分卷下载 |
| [回放多会话实施记录](docs/replay-sessions-implementation.md) | 会话模式、纠错规则与实现说明 |
| [AI 机器人与交易复盘](docs/ai-assistant.md) | 配置、草稿采用、会话分析、证据、限制与部署 |
| [AI 复盘版本规划](docs/ai-review-version-plan.md) | 规划背景、附件适配取舍与接入位置 |
| [UI 设计与实现规范](docs/ui-guidelines.md) | 页面、组件与交互约束 |

## 许可证

本项目采用 [MIT License](LICENSE)。
