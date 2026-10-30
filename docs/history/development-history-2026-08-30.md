# 开发历史：2026-08-30

> 文档状态：历史记录。适用范围：2026-08-30 的开发摘要；工作区状态、实现限制和验证结果不代表当前版本。
> 当前规范：[当前文档索引](../README.md#当前入口)。

本文件保存原 AGENTS.md 中的开发摘要，仅供追溯。以下工作区状态、实现细节、限制与验证结果均为当时记录，不代表当前代码、未提交改动或已完成的验证。

当前协作规则见 [AGENTS.md](../../AGENTS.md)，功能与启动方式见 [README.md](../../README.md)；涉及升级、回放会话等后续改动时，以对应专题文档和当前代码为准。

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
- `ReplayProgress` 使用 `playbackRate`（整数 `1–100`）和 `displayIntervalSeconds`；旧 `intervalMs` 兼容字段已完成迁移并移除。
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
- `scripts/database/init-sqlite.mjs` 已同步新表、新字段和索引，本地 `prisma/dev.db` 已执行初始化。
- 当前验证结果：
  - `corepack pnpm lint`：通过。
  - `corepack pnpm test`：18 个测试文件、126 项测试通过。
  - `corepack pnpm run build`：通过。
  - `/market-replay`、行情数据集 API、导入任务 API 的生产运行态冒烟检查均返回 `200`。
- 测试包含以块级汇总代表 2000 万根源 K 线的逻辑聚合场景；尚未在当前工作区实际写入并导入一个完整 5 GB/2000 万行文件。
- Windows 下如果 Prisma 生成或构建出现 `EPERM`，先确认并停止命令行属于本项目的 Next.js/Node 开发进程，再运行生成或构建。
