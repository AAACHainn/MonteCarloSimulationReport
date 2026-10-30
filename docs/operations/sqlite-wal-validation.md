# SQLite 提交优化：隔离验证

> 状态：2026-10-18 的历史试验与本机接入记录，不是当前部署指南。版本、性能数字、FULL 配置示例和命令只适用于所述场景；当前安装、WAL / NORMAL / FULL 选择及回退统一见[升级指南](upgrade.md)。不照搬本机路径、旧依赖试验或数据库状态。

第一阶段验证数据库提交优化，未切换默认应用驱动或正式数据库日志模式。验证日期：2026-10-18。随后按用户要求接入本机试用，见下方“本机接入”；生产部署仍以 [升级指南](upgrade.md) 为入口。

## 版本来源与候选组合

| 项目 | 原应用 | 隔离候选 |
| --- | --- | --- |
| Prisma Client / CLI | 锁定 6.19.3 | 保留 6.19.3 |
| SQLite 驱动 | Prisma 默认内置驱动 | @prisma/adapter-better-sqlite3 6.19.3 + better-sqlite3 12.8.0 |
| 实测 SQLite | 3.46.0 | 3.51.3 |
| 日期存储 | Unix 毫秒 | 显式 unixepoch-ms |
| 提交配置 | DELETE + FULL | 分别测试 DELETE + FULL、WAL + FULL |

候选版本写在 [独立包清单](../../scripts/sqlite-wal/candidate-package.json) 和 [独立锁文件](../../scripts/sqlite-wal/candidate-lock.yaml)，不改变根项目依赖。

SQLite 3.51.3 修复了本次讨论的 WAL-reset 问题，better-sqlite3 12.8.0 发布说明确认内置该版本。依据：[SQLite WAL 说明](https://www.sqlite.org/wal.html#walreset)、[驱动发布说明](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.8.0)。

**候选依赖不是默认生产配置。** 适配器 6.19.3 声明的驱动依赖为 ^11.9.0；本次只在独立临时安装中将它定向覆盖为 12.8.0，以验证技术可行性。此组合超过适配器声明的依赖范围。第一阶段保留根配置不变；随后本机接入已将这组精确版本与覆盖策略写入根依赖和锁文件，并接入统一连接工厂。默认仍为 native 驱动，只有本机 .env 显式启用新驱动与 WAL。Prisma schema 和生产镜像未升级。不能将本机通过结果视为已完成生产升级。

## 验证方法

- 本机 Windows、Node 24.15.0。当前环境没有 Docker，未执行 Linux / Node 22 生产镜像验收。
- 通过真实回放同步路由测量：5,000 根人工行情，每场景预热 5 次、采样 30 次，串行运行三组配置。
- 场景：空仓单根、持仓无成交单根、已有最近历史单根、五根源 K 线、五根及一百根逐源上下文变化。
- 统计接口路由 P50/P95、COMMIT 耗时、SQL 数量、响应体积和分段耗时；原始样本写入 tmp/sqlite-wal-validation/benchmark-*.json。单独执行 PASSIVE checkpoint 并记录结果。
- 指标不含 HTTP 和浏览器绘制时间；人工小库结果不能直接承诺给生产环境。不同驱动的 BEGIN 日志可见性不同，SQL 条数不用于宣称业务查询已经减少。
- 使用现有回放、会话和训练关卡集成测试，覆盖源序号、OCO、权益与回撤、丢失响应重试、立即平仓、回滚、纠错和独立 worker。
- 真实本地库以只读连接通过 SQLite 在线备份 API 建立 pristine.db，再创建 working.db；仅工作副本进入 WAL。比较 46 个模型的记录数及每模型最多 5 条稳定排序的日期/数字/枚举/标识字段摘要。检查完整性、外键、毫秒日期写入、事务失败回滚及原驱动重新读取。抽样摘要不代表逐行核对了全部交易字段。

## 本次结果

本机串行基准，单位 ms；每格为 **P50 / P95**。每场景预热 5 次、采样 30 次，三组均为 FULL。

| 场景 | 原引擎 DELETE | 候选引擎 DELETE | 候选引擎 WAL |
| --- | ---: | ---: | ---: |
| 空仓单根 | 114.8 / 138.1 | 145.7 / 321.4 | 59.9 / 72.9 |
| 持仓无成交单根 | 138.4 / 265.9 | 145.5 / 206.6 | 51.7 / 85.1 |
| 最近历史较多时单根 | 69.7 / 106.9 | 141.1 / 198.3 | 60.2 / 103.3 |
| 五根源 K 线 | 87.2 / 154.5 | 152.8 / 274.9 | 56.5 / 73.6 |
| 五根且上下文逐源变化 | 142 / 302.5 | 142.6 / 269.3 | 79.7 / 115.9 |
| 一百根且上下文逐源变化 | 203.2 / 289.9 | 257.4 / 372 | 143.2 / 162.7 |

空仓单根的提交中位耗时为 88 → 18 ms，持仓无成交单根为 106 → 8 ms。候选驱动保留 DELETE 时没有稳定提速；WAL 的提交方式是主要有效变化。最近历史较多场景的原引擎耗时较低，说明本机磁盘等待仍有波动；全部场景均保留原始样本，目标机器仍需复测。

本次保留默认 1,000 页自动 checkpoint。末尾 PASSIVE checkpoint 的返回值为：[{"busy":0,"log":472,"checkpointed":472}]。这只能证明此次短基准的收尾情况，不能代替生产长时间播放与并发 checkpoint 的长尾验收。

原始报告和私有备份保留在被 Git 忽略的 tmp/sqlite-wal-validation/ 中。

已通过：候选 WAL 下的 80 项原有集成测试，1 项原有跳过；真实库副本的 46 个模型计数与抽样读取一致，integrity_check 为 ok，foreign_key_check 无记录，日期、回滚及重新读取检查通过。连接跟踪确认独立纠错进程同样使用 SQLite 3.51.3、WAL、FULL；8 项隔离路径保护单元测试、完整 lint 和 TypeScript 检查通过。原生依赖的显式引导流程已重新执行，并核对安装前后文件 SHA256 一致。

## 复现

> 复现仅限明确的隔离测试库；下列命令不用于核验或迁移当前业务库。目标环境仍须先按升级指南确认数据库路径与备份。

先按根项目锁文件安装依赖；不需要修改 .env，不需要修改源数据库配置。备份副本检查使用 Node 22.16+ 或 Node 24+ 的 node:sqlite backup API；本次实际使用 Node 24.15.0。

从项目根目录逐条执行：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm exec node scripts/sqlite-wal/prepare.mjs
corepack pnpm --dir tmp/sqlite-wal-candidate install --ignore-scripts --frozen-lockfile --store-dir ../sqlite-wal-store
corepack pnpm exec node scripts/sqlite-wal/prepare.mjs --native
corepack pnpm exec node scripts/sqlite-wal/run.mjs
```

独立安装首先跳过依赖脚本；prepare --native 再显式安装官方原生预编译文件并验证 SQLite 版本。缺少当前平台/Node ABI 的预编译文件时会失败，需要先处理验证环境，不能因此更换正式库或降低校验。

只运行基准或回归时，分别使用 run.mjs --benchmark、run.mjs --regression。正常 pnpm test 会发现隔离路径保护测试和本机连接工厂集成测试，不会自动安装候选驱动或启动性能基准。preload.cjs 只通过显式启动的验证进程加载，并由 NODE_OPTIONS 传递到纠错子进程；连接跟踪写入 connections.jsonl，可核对实际 worker 的版本和 FULL 设置。

对已有库进行副本验证时，先核对真实路径，再执行下面的显式只读源备份命令。它保留原始一致性备份和工作副本，约需要源文件两倍磁盘空间；源文件不存在时直接失败，不创建空源库：

```powershell
corepack pnpm exec node scripts/sqlite-wal/check-copy.mjs --source prisma/dev.db
```

生产 Compose 的真实库位于数据卷 /data/dev.db，不能用宿主机同名文件代替。此命令不是正式部署命令；生产执行前仍按升级指南停止写入并备份配置、密钥及 storage。

验证程序只接受明确的测试库前缀及 tmp/sqlite-wal-validation/ 下的副本路径；拒绝默认正式库、相对数据库 URL、路径越界和 URL 参数。它不会删除已有业务目录或数据卷。私有备份与报告不提交 Git，保留以便人工检查。

## 本机接入（2026-10-18）

> 本节记录当时采用 WAL + FULL 的本机方案，不要求所有当前安装改为 FULL。当前连接工厂也支持明确配置的 WAL + NORMAL，适用边界见升级指南；不得将下面的环境设置直接覆盖到现有安装。

根依赖固定 Prisma / 适配器 6.19.3、better-sqlite3 12.8.0，覆盖策略记录在 pnpm-workspace.yaml。lib/sqlite-client.mjs 供 lib/db.ts、独立 worker 和初始化脚本共同使用：相对 DATABASE_URL 仍以 prisma/ 为基准，日期保留 Unix 毫秒，每条实际连接检查 SQLite 3.51.3、外键、日志模式和 FULL。应用运行时拒绝悄悄新建不存在的数据库，并阻止把 WAL 库误交给旧 native 引擎写入。

在已停止写入、完成数据库/配置/storage/导入文件备份并核对真实库之后，将本机 .env 设置为：

```dotenv
SQLITE_DRIVER="better-sqlite3"
SQLITE_JOURNAL_MODE="wal"
```

现有 DATABASE_URL、行情和 AI 加密主密钥保留原值。当前本机是旧初始化方式管理的数据库，没有 Prisma 迁移历史；这次只换驱动和日志模式，没有运行结构迁移或再次执行初始化脚本。本机已完成切换：48 张表记录数、账户及回放进度与备份基线一致，完整性/外键检查通过；96 项相关测试通过、1 项既有跳过，lint、TypeScript 和生产构建通过。HTTP 页面/API 返回正常，服务器日志确认实际连接为 3.51.3 / wal / FULL。服务地址为 http://localhost:3000，备份和核对记录保留在被忽略的 tmp/local-sqlite-wal-install-report.json。

逐条执行依赖安装、原生驱动准备、测试和构建；构建验证可让 DATABASE_URL 指向备份的工作副本并设置 MARKET_DATA_SYNC_ENABLED=0。正式本机服务沿用原 DATABASE_URL，首次连接按显式配置启用 WAL：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run db:prepare-sqlite
corepack pnpm run db:runtime --integrity
corepack pnpm lint
corepack pnpm test lib/sqlite-client.integration.test.ts scripts/init-sqlite.test.ts
corepack pnpm exec node scripts/sqlite-wal/run.mjs --regression
corepack pnpm run build
corepack pnpm start
```

db:runtime 必须报告 SQLite 3.51.3、journalMode=wal、synchronous=2、foreignKeys=1。服务器第一次连接会记录 sqlite-runtime 日志，确认页面/API 的实际连接也使用相同配置。run.mjs 现在复用正式连接工厂执行回归，初始化和 worker 继承同一套驱动标志，不依赖试验用的全局替换去修改真实服务。

### 本机回到原提交方式

> 历史回退记录。实际回退应按当前升级指南重新核对驱动、日志模式、备份及新增数据，不能仅凭本节命令判定可安全回退。

先停止本项目服务和 worker，并备份试用后新增的数据。若要保留试用期间的交易，使用新驱动在离线状态转换回 DELETE，不能直接用旧备份覆盖新交易：

```powershell
$env:SQLITE_DRIVER = "better-sqlite3"
$env:SQLITE_JOURNAL_MODE = "delete"
corepack pnpm run db:runtime --integrity
```

确认返回 delete 后，再将 .env 的 SQLITE_DRIVER 改为 native、SQLITE_JOURNAL_MODE 改为 delete，并清除当前终端这两个临时环境覆盖，然后重启。该转换保留原有数据；不要手动删除 -wal / -shm。退回旧代码、旧依赖或恢复备份仍按升级指南执行，明确恢复点及新增数据的处理。

## 生产部署前的剩余工作

1. 明确生产采用的依赖覆盖策略，或选择并验证处于上游支持依赖范围内的引擎/驱动组合；锁定所有依赖。
2. 本机已接入应用及独立 worker；生产仍需核对实际启动环境、持久化路径与每个连接的 FULL 设置，不将本机 .env 或数据库覆盖过去。
3. 在实际 Linux / Node 版本和 Docker 生产镜像中验证原生依赖打包、迁移入口、跨进程锁、长时间播放、默认自动 checkpoint 长尾及异常恢复。迁移期间关闭旧应用，避免混用不同版本的写入引擎。
4. 完成备份与副本演练后，再切换正式数据库 WAL。保留原数据卷和原密钥，记录新镜像摘要；验收通过后开放写入。

本机接入不等于生产部署；上述生产事项尚未执行。


## 后续普通推进与浏览器优化

第 2、3 项的实施范围、同版本 WAL + FULL 前后基准及验证边界，见 [普通推进性能优化](../replay/replay-performance-optimizations.md)。
