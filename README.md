# 交易训练工作台

**Trading Practice Workbench** · 回放训练 · 交易复盘 · 风险分析

![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

面向个人交易者的本地 Web 应用：导入历史行情，在隐藏未来数据的环境中练习交易；记录策略、执行与复盘；使用历史交易的 `R-multiple` 样本，分析不同资金管理方式下的收益、回撤和连续亏损分布。默认界面语言为简体中文，数据保存在本地 SQLite 中。

[功能概览](#功能概览) · [快速开始](#快速开始) · [已有安装升级](#已有安装升级) · [使用流程](#使用流程) · [功能说明](#功能说明) · [导入格式](#导入格式) · [数据与使用边界](#数据与使用边界) · [开发与验证](#开发与验证) · [文档导航](#文档导航)

## 功能概览

| 模块 | 主要能力 |
| --- | --- |
| K 线回放 | CSV / CSV.GZ 导入与追加、多周期聚合、逐根播放、EMA / ABR / Bar Count、图表绘图 |
| 用户档案与成长 | 无登录的个人练习档案、8 个头像与上传裁切、会话归属、逐笔成长与筑基突破 |
| 用户资金 | 练习余额与账本、自有资金账户存取、自营购买费与激活费、出金入账 |
| 回放会话 | 同一行情下建立多个独立训练或实盘重演会话，隔离进度、账户、订单与日志 |
| 模拟交易 | 市价 / 限价 / 止损单、止盈止损、风险定额下单、手续费与滑点、账户统计 |
| 自营练习账户 | 考核与出金阶段、回撤规则、失败平仓、会话内重新考核与历史轮次 |
| 交易关卡 | 策略清单或交易计划、可配置连亏触发、按实际入场成交计数、下单前快照留存 |
| 交易复盘 | FIFO 成交配对、历史交易查看、复盘模板、Excel / PDF 导出 |
| AI 机器人 | 自定义模型端点、全局流式聊天、模板复盘草稿、单会话归纳与证据 |
| 交易日志 | 按账户记录交易、截图与标签、R 倍数计算、筛选统计、ZIP 备份与合并 |
| 蒙特卡洛分析 | Bootstrap 抽样、三种资金管理模式、权益分布、最大回撤、爆仓概率与最大连亏 |
| 行情同步 | Databento CME 行情手动 / 自动增量同步、费用预估与预算、重叠区间校验 |

## 快速开始

以下步骤用于全新安装。已有数据库请使用下方的[已有安装升级](#已有安装升级)流程；迁移路径、备份和回退细节见[升级指南](docs/operations/upgrade.md)。

### 获取源码

```bash
git clone https://github.com/AAACHainn/MonteCarloSimulationReport.git
cd MonteCarloSimulationReport
```

### 方式一：Windows 一键安装（生产模式）

适用于全新安装。先安装 Node.js 22.14 或以上版本和 Corepack，并确保 `node --version`、`corepack --version` 能正常执行。安装过程需要联网下载依赖，无需管理员权限。

获取完整源码后，在项目根目录双击 [`install.bat`](install.bat)，或在 PowerShell 中运行：

```powershell
.\install.bat
```

脚本会自动完成以下步骤：

1. 提示选择 SQLite 同步模式，回车默认选择 **NORMAL**；两种模式均使用 `better-sqlite3 + WAL`。
2. 通过 Corepack 安装项目锁定版本的 pnpm 依赖，准备 SQLite 原生模块并生成 Prisma Client。
3. 确认数据库可用于全新安装后，根据 `.env.example` 创建或补齐 `.env`，分别生成 `MARKET_DATA_ENCRYPTION_KEY` 和 `AI_ENCRYPTION_KEY`：均为 32 个安全随机字节的 Base64 编码；已有有效密钥保留。
4. 应用数据库迁移，核对 SQLite 版本、WAL、同步级别、完整性和外键检查结果。
5. 执行生产构建，并通过 `corepack pnpm start` 启动服务。

| 同步模式 | 提交行为与取舍 |
| --- | --- |
| NORMAL（安装脚本默认） | 减少提交时的磁盘同步，通常更快；断电或系统崩溃时可能丢失最近已提交的事务 |
| FULL | 每次提交额外同步 WAL，已提交事务的持久性更强，磁盘写入开销更大 |

等待终端显示 `Ready` 后打开 [http://localhost:3000](http://localhost:3000)。保持窗口打开以运行服务，按 `Ctrl+C` 停止。之后启动只需在项目根目录执行：

```powershell
corepack pnpm start
```

请保留生成的 `.env` 和其中的加密密钥，以便跨重启和升级解密已保存的行情、AI 凭据。

脚本发现非空数据库文件、WAL/SHM 文件或升级锁时会停止，即使数据库尚无业务记录，也不作为全新库重新初始化；已有安装使用[升级流程](#已有安装升级)。若已完成迁移，仅构建或启动失败，解决报错后按[本地生产模式](#本地生产模式)重新构建并启动。若提示环境变量冲突，先核对 `.env.local`、`.env.production`、`.env.production.local` 和终端／系统中的覆盖项，再重新执行。

### 方式二：Node.js 手动安装（开发模式）

使用 Node.js 22.14 或更新的 22.x 版本，并准备 Corepack；pnpm 版本以 `package.json` 的 `packageManager` 为准，通过 Corepack 执行。

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

### 方式三：Docker Compose 开发

需要 Docker Engine + Compose，或 Docker Desktop；容器内已包含 Node.js 与 pnpm。

```bash
docker compose up --build -d
```

打开 [http://localhost:3001](http://localhost:3001)。当前开发镜像每次启动都会安装依赖、生成 Prisma Client、执行 `prisma migrate deploy` 并启动开发服务；仅在新安装或已完成离线升级核验的数据库上使用。进度可通过日志查看：

```bash
docker compose logs -f app
```

停止服务：

```bash
docker compose down
```

`compose.yaml` 挂载源码以支持热更新，依赖与构建缓存使用命名卷；数据库、截图和行情导入文件位于挂载的项目目录。上述停止命令保留这些数据。端口默认 `3001`，可通过 `APP_PORT` 环境变量调整。

### 环境变量

完整示例见 [`.env.example`](.env.example)。一键安装会自动补齐环境配置并生成两项加密密钥；手动安装使用示例中的默认值。仅使用本地导入、回放和蒙特卡洛分析时，无需配置 Databento 连接。

| 变量 | 默认值 / 示例 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | 本地 Node 与开发 Compose 下对应 `prisma/dev.db` |
| `SQLITE_DRIVER` | 示例 `native`；一键安装 `better-sqlite3` | native 仅支持 DELETE + FULL；已有数据库切换驱动前按升级指南备份并验证 |
| `SQLITE_JOURNAL_MODE` | 示例 `delete`；一键安装 `wal` | `wal` 需要 `better-sqlite3`，不能单独交给 native 驱动使用 |
| `SQLITE_SYNCHRONOUS` | 示例 `FULL`；一键安装默认 `NORMAL` | NORMAL 仅支持 better-sqlite3 + WAL；FULL 更重视已提交事务的持久性 |
| `MARKET_DATA_ENCRYPTION_KEY` | 示例为空；一键安装自动生成 | 行情连接使用的 32 字节 Base64 加密主密钥，配置后须跨重启与升级保留 |
| `MARKET_DATA_SYNC_ENABLED` | `1` | 行情同步任务处理与调度开关；设为 `0` 关闭，数据集仍需单独启用同步 |
| `AI_ENCRYPTION_KEY` | 示例为空；一键安装自动生成 | 独立 AI 凭据加密主密钥；手动安装可运行 `node scripts/setup-ai-key.mjs` 生成一次并保留 |
| `USER_AVATAR_DIR` | 默认 `storage/user-avatars/` | 上传头像的持久化目录，须与数据库一起备份 |
| `APP_PORT` | `3001` | Compose 的宿主机端口；本地 Node 开发默认使用 `3000` |

### 本地生产模式

在完成依赖安装、环境配置和数据库迁移后运行：

```bash
corepack pnpm run build
corepack pnpm start
```

仓库还提供 `Dockerfile.prod` 与 `compose.prod.yaml`。生产 Compose 当前固定引用 `v0.1` 镜像，不能代表当前源码；部署时须构建或指定目标版本镜像。生产 Dockerfile 默认启动时也会执行迁移，已有库应将迁移改为离线执行；启用 WAL 时还需显式传入 SQLite 配置。详情见 [Docker 部署检查](docs/operations/upgrade.md#docker-部署的额外检查)。

已有数据库的迁移、SQLite 驱动或 WAL 配置变更，请按[升级指南](docs/operations/upgrade.md)核对目标环境、备份并执行相应步骤。

## 已有安装升级

**数据库最低兼容基线为 `v1.0` tag。** `v0.2 → v1.0` 使用该 tag 中的旧升级脚本及同版本文档；v1.0 之前的数据库须先升级并验收到 v1.0，不能直接交给后续版本升级。

当前代码的 Prisma schema 和迁移集合仍与 v1.0 相同，`db:upgrade` 仍指向旧的 `scripts/upgrade-sqlite.mjs`；新的后续升级入口尚未实现。v1.0 之后首次发生数据库变更时，须提供新的统一入口，仅接受已核验的 v1.0 及后续数据库。旧入口在新入口验证并完成调用方切换后移除，历史实现由 v1.0 tag 保留。基线与脚本状态见[升级指南](docs/operations/upgrade.md)。

本地 Node 安装按以下顺序操作，每条命令成功后再继续：

1. 按升级指南核对当前版本、目标版本和实际数据库路径，停止本项目服务及所有关联 worker，确认导入、同步和纠错任务已停止，并建立一致性数据库、业务文件和环境配置备份。

2. 更新到适用的目标代码，保留原 `.env`、密钥和业务文件，不用示例配置覆盖。安装依赖、准备 SQLite 原生模块并生成当前 Prisma Client：

   ```bash
   corepack pnpm install --frozen-lockfile
   corepack pnpm run db:prepare-sqlite
   corepack pnpm prisma generate
   ```

3. 仅在目标版本存在待应用的数据库变更时，按该版本升级指南准备维护驱动、执行适用入口，在副本上演练并核对后再升级正式库。已达到 v1.0 且仅更新当前代码时，无需重复执行旧升级脚本。旧入口参数与保护机制见[旧升级编排说明](docs/operations/upgrade.md#legacy-v1-upgrade)。

4. 数据库核对通过后重新构建并启动生产服务，再刷新浏览器、核对页面和账户数据：

   ```bash
   corepack pnpm run build
   corepack pnpm start
   ```

   开发模式使用 `corepack pnpm dev`，不要与生产服务同时运行。

升级失败时保留数据库、WAL/SHM、备份、报告和维护锁，按[升级指南](docs/operations/upgrade.md)核实具体阶段；不要重置数据库、自动覆盖恢复，或靠反复切换迁移方式、删除锁文件跳过失败。

Docker 部署须使用目标镜像及实际数据卷、环境配置执行离线升级；不能直接套用宿主机默认数据库路径，也不能将升级命令塞入每次服务启动流程。具体步骤见[Docker 部署检查](docs/operations/upgrade.md#docker-部署的额外检查)。

## 使用流程

1. **练习交易**：进入 `/market-replay`，导入行情，创建训练会话，选择起点，逐根回放并模拟下单。平仓后在回放交易日志中补充策略、交易理由与复盘，按需导出。
2. **记录交易**：进入 `/trade-journals`，按账户创建日志，填写风险与成交信息，添加截图和标签。品种、策略、交易理由和标签在 `/master-data` 统一维护。
3. **评估风险**：在 `/datasets` 上传历史成交 CSV，或使用交易日志对应的样本，进入 `/simulations/new` 设置资金管理参数，运行并保存报告。历史报告位于 `/simulations/history`。

## 功能说明

### 用户档案与成长

右上角头像可打开用户菜单；无需创建用户也能使用全局数据。选择个人后普通新建训练会话归属该用户；进入其他人的会话会先确认并切换到归属人。回放中不提供切换用户，成果始终归实际会话所属者。旧未归属会话保留在全部用户范围，不支持事后归属，也不参与个人成长。

支持 8 个预制头像或上传静态 PNG/JPEG/WebP（最多 5 MiB），上传时可裁切；保存后生成 512px WebP。上传头像须与数据库一起备份；代理服务器应允许至少 6 MiB 请求。

当前成长规则为 `user-growth-v1`：完整持仓周期 +5、首次逐笔复盘 +10、每轮考核通过 +100、每轮首次成功出金 +200；后续出金仍计次数及 USDT 实得。六项突破条件、去重和删除保留规则详见[用户档案与成长设计](docs/account/user-growth-design.md)。

### 用户资金

每个用户一次性获得 10,000 USDT 的练习资金，余额为 0 不自动补发。在用户档案的“用户资金”中查看可用余额、账户内资金和分页账本；账户创建界面固定使用 USDT。

只有归属用户的模拟训练参与资金管理：自有资金账户支持部分/全部提取及再次存入，存取不归档会话；自营账户购买及重新考核扣购买费，手动确认转为出金账户时扣非零激活费，成功出金只计交易者实得。日终自动晋级尚未接入激活费扣款，见[自营账户已知限制](docs/replay/prop-practice-account-design.md#10-当前限制与待确认事项)。实盘重演及未归属会话不参与。删除会话须确认提取、出金或放弃不可提资金，费用不退；用户账本保留。这些资金不涉及真实转账。

### 回放与模拟交易

- **隐藏未来数据**：选定的起点 K 线在执行“下一根”后揭示；支持单步、连续播放、暂停与 `1×–100×` 倍速，页面进入后台时自动暂停。
- **多周期图表**：支持 1 秒至 24 小时的固定显示周期；显示周期须不小于源周期且为其整数倍。切换周期不会改变回放位置或撮合结果。
- **图表工具**：最多 5 条可配置 EMA、ABR、Bar Count、成交量、K 线倒计时、区间测量、趋势线、斐波那契回撤、AB=CD 等幅测量、矩形、文字和上下箭头；CME 股指期货支持 ETH / RTH 切换。
- **绘图保存**：普通回放与历史页共用会话绘图，刷新和归档后保留；样式模板保存在当前浏览器和站点。操作详见[矩形](docs/charting/rectangle-drawing.md)、[文字](docs/charting/text-drawing.md)、[AB=CD](docs/charting/abcd-drawing.md)、[箭头](docs/charting/arrow-drawing.md)和[会话绘图持久化](docs/charting/archived-drawings.md)。
- **自营练习账户**：支持考核、出金和会话内重新考核，各轮保留独立交易与结果。触发最大回撤失败时，按当前已揭示源 K 收盘价为基准市价全平，计入滑点和手续费，并撤销剩余挂单。规则及模板见[自营练习账户规格](docs/replay/prop-practice-account-design.md)。
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

训练会话还可启用 **交易关卡**：每轮选择策略清单或交易计划模式，按实际入场成交累计完成笔数；持续笔数默认 10，自动开启默认关闭，下一轮默认使用交易计划。启用自动开启后，连续亏损达到配置阈值（默认 2 笔）时触发。下单前的检查或交易计划随交易留存，详细规则见 [交易关卡说明](docs/replay/training-gate.md)。

### 行情导入与同步

- 支持标准 OHLCV CSV / CSV.GZ，以及 Databento CME parent-symbol OHLCV 文件；后者按成交量与 CME 换月规则筛选季度主力合约。
- 导入采用持久化任务、流式解析与分块写入，展示各阶段进度，失败或中断后可以重试。
- 已有数据集可追加行情，只发布当前结束时间之后的数据，跳过重叠与重复记录，保留原有源序号、回放进度和账户。
- 追加时校验品种、源周期与时间对齐，遇到时间缺口先展示预览，确认后保留缺口继续追加。
- Databento 同步按数据集启用，支持手动更新与自动计划；先检查可用范围、估算费用及预算，再分段下载并校验重叠区间。
- 自动同步随 Node 服务运行，无需系统定时任务或保持浏览器打开；数据修订与历史冲突会暂停同步，不自动覆盖已有行情。

API Key 配置、费用预算和同步边界见 [行情同步说明](docs/market-data/market-data-sync.md)。

### 交易日志与复盘

回放成交按 FIFO 配对为日志，保留 Setup、交易理由、风险与收益指标。可筛选记录、查看会话统计、填写复盘并复用模板；历史交易可在只读回放中查看当时的行情与成交标记。

回放日志支持 Excel 导出，以及包含中文明细和 K 线截图的 PDF 分卷导出。PDF 可以选择周期、ETH / RTH 与明细字段，具体范围和分卷行为见 [PDF 导出说明](docs/replay/replay-pdf-export.md)。

独立交易日志按账户管理，支持截图、全局标签、策略代码、表格 / 浏览视图、筛选统计，以及 ZIP 导出、导入和合并备份。交易日志的有效 R 倍数可直接用于蒙特卡洛分析。

### AI 机器人

页面右下角提供唯一的 AI 机器人，直接提问即可自动识别普通讨论、图表分析、复盘草稿和整个会话报告，无需选择角色。在回放页面自动关联当前会话、可见图表或正在编辑的交易，按需调用只读工具；资料有歧义时再询问，也可通过“资料”指定其他范围。历史交易复盘保留模板和当前未保存草稿，采用后仍需手动保存；整个会话报告保留全量覆盖、证据与断点。图表默认获取当前周期图片，明确要求时支持多周期多图；缺图由浏览器按需生成，行情数据仅在程序内部用于绘图。详见 [图表图片工具](docs/ai/ai-chart-images.md)。

完成安装并配置独立 AI 加密主密钥后，从首页“AI 配置”进入设置页，填写 Base URL 和可选 API Key，拉取并选择默认模型；机器人窗口的设置图标也可在新标签页打开该页面。保存不会自动探测模型；真实服务测试可能收费。使用、口径及限制见 [AI 机器人说明](docs/ai/ai-assistant.md)。

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
| 交易截图、AI 文件与上传头像 | `storage/`；头像可由 `USER_AVATAR_DIR` 改为其他目录 |
| 生产 Compose 数据 | 数据库使用 `app_data` 卷，默认 `storage/` 使用 `app_storage` 卷；自定义目录需另行挂载 |

交易记录、模拟报告、回放会话、账户、订单与复盘保存在 SQLite 中。默认数据目录、`.env`、数据库、日志、依赖和构建产物已由 `.gitignore` 排除；另行存放的导入原文件或备份须自行确认不会进入版本管理。

备份时同时保存数据库、`storage/`、环境配置及自定义头像目录，保留行情与 AI 两项原加密主密钥；需要恢复导入任务时还须保留 `.market-imports/`。运行中的 SQLite 需使用一致性备份，详细步骤见 [备份与回退](docs/operations/upgrade.md)。

### 当前范围与限制

- 面向本地使用，支持多个无登录练习档案；任何使用者均可切换和查看档案，未包含权限管理与多租户隔离。远程访问需要自行提供访问保护。
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
scripts/                数据库初始化与升级、后台 worker 与专项验证
public/templates/       CSV 模板
install.bat             Windows 全新安装、环境配置与生产启动
docs/                   按主题分类的文档与目录索引
```

代码改动按影响范围运行相关测试及必要检查，提交前完成适用的验证：

```bash
corepack pnpm lint
corepack pnpm test
corepack pnpm run build
```

纯文档修改检查文件链接、章节锚点和 `git diff --check`，无需运行应用测试或构建。

Windows 下若 Prisma query engine DLL 被占用，请先确认并停止本项目的开发服务及关联 Node 进程，再重新构建。

参与开发前阅读 [协作约定](AGENTS.md)；涉及界面的修改须遵循 [UI 规范](docs/ui/ui-guidelines.md)。业务算法保持独立，界面文案集中维护在 `lib/i18n.ts`，金额与数字格式化复用 `lib/format.ts`。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [分类文档目录](docs/README.md) | 按主题查找功能说明、部署指南与开发规范 |
| [现有安装升级与跨机器部署](docs/operations/upgrade.md) | `db:upgrade`、备份、迁移路径、密钥保留、生产部署检查、验收与回退 |
| [用户档案与成长](docs/account/user-growth-design.md) | 档案选择、会话归属、头像与成长规则 |
| [自营练习账户](docs/replay/prop-practice-account-design.md) | 模板、考核、出金、风控与账户轮次 |
| [行情增量同步](docs/market-data/market-data-sync.md) | Databento 连接、自动计划、预算与冲突处理 |
| [模拟训练交易关卡](docs/replay/training-gate.md) | 策略清单、连亏触发、计数与会话恢复 |
| [回放交易 PDF 导出](docs/replay/replay-pdf-export.md) | 筛选、截图、明细字段与分卷下载 |
| [回放多会话实施说明](docs/replay/replay-sessions-implementation.md) | 会话模式、纠错规则与实现说明 |
| [AI 机器人与交易复盘](docs/ai/ai-assistant.md) | 配置、草稿采用、会话分析、证据、限制与部署 |
| [UI 设计与实现规范](docs/ui/ui-guidelines.md) | 页面、组件与交互约束 |

## 许可证

本项目采用 [MIT License](LICENSE)。
