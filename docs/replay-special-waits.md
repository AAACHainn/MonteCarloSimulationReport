# 特殊场景的较长等待

2026-10-18，接续 [普通推进与浏览器优化](replay-performance-optimizations.md)。本次处理跨非显示时段和高周期手动推进/日期快进，不修改撮合算法、数据库结构或默认自动播放速度。

## 改动

- 显示周期推进原先一次读取最多 86,401 根完整候选行情。现在先读取较小页面，再按需分页，每页最多 4,096 条，仅取源序号与时间。找到所需显示桶就停止；仍保留单次最多 86,400 根源 K 线及一根只用于判定桶结束的探测，不揭示或撮合探测 K 线。
- 复用撮合事务已经读取的源行情，首次成功的显示推进不再重复读取整个已推进区间。复用数据只供服务端构造聚合增量，HTTP 响应与幂等回执不包含内部 processedBars。
- 跨非显示时段采用聚合增量更新现有图表与缓存，移除每次提交后的完整窗口请求。完整桶修订使用替换，避免重复累计成交量；历史窗口和指标预热保持，超出既有历史上限时才压缩。仅隐藏时段推进时保留图表数据引用，数据结束时完成末根状态。
- 新增显式 BULK 模式，手动整根推进按源/显示周期比例选择批量，日期快进每次最多 1,000 根；默认请求和自动播放仍最多 100 根。模式、源跨度、上下文数组与逐段连续性均校验，超限在写入前拒绝。
- 每根源 K 线仍由客户端准备当时的 ABR 上下文，后端逐源撮合与计算权益峰值/回撤；订单、成交、FIFO 批次、日志、权益与进度仍原子保存。合并请求保留原来每 100 根提交边界的权益补点，以及稀疏采样、成交和末根补点。
- 继续串行执行，取消在批次边界生效；已经发出的请求仍使用同一请求编号取回回执。暂停、后台暂停、快捷键松开与等待中的队列沿用原有规则。

相关实现：[候选分页](../lib/market-replay/display-advance.ts)、[显示推进路由](../app/api/market-datasets/[id]/replay/advance/route.ts)、[批量校验](../lib/validations.ts)、[推进事务](../lib/market-replay/replay-sync.ts)、[客户端](../components/market-replay/market-replay-client.tsx)、[增量窗口](../lib/market-replay/advance-display.ts)。

## 相同环境的前后基准

本机 Windows / Node 24.15.0 / SQLite 3.51.3 / WAL + FULL；每场景 5 次，人工行情、独立数据库，执行真实 API handler 并读取响应。该小样本不包含 HTTP 与浏览器绘制，不用于承诺生产环境或实际点击的固定提速比例。

| 场景 | 中位耗时 ms，前 → 后 | P95 ms，前 → 后 | SQL 数量，前 → 后 | 行情读取行数，前 → 后 | 提交请求数，前 → 后 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 90,000 根分钟行情，跨 RTH 关闭时段到下一根 5 分钟显示 K 线 | 1910.8 → 130.5 | 2031.7 → 183.2 | 34 → 34 | 88,481 → 5,200 | 1 → 1 |
| 1 秒源行情，手动推进一根 5 分钟 K 线 | 327.5 → 64.7 | 591.7 → 129.9 | 88 → 31 | 300 → 300 | 3 → 1 |

行情读取数统计各 findMany 返回行数，包括重复读取，不含已揭示当前价的单行查询。RTH 优化主要减少读取量和对象分配，SQL 数量未减少；这组测量未计入浏览器移除的整窗请求收益。

[复现程序](../scripts/benchmark-replay-special-cases.ts) 与 [Vitest 配置](../scripts/benchmark-replay-special-cases.config.ts) 专供显式基准，不由普通测试自动执行：

~~~powershell
$env:SQLITE_DRIVER = "better-sqlite3"
$env:SQLITE_JOURNAL_MODE = "wal"
$env:MARKET_DATA_SYNC_ENABLED = "0"
corepack pnpm exec node node_modules/vitest/vitest.mjs run --config scripts/benchmark-replay-special-cases.config.ts --maxWorkers=1 --minWorkers=1
~~~

默认报告位于 tmp/replay-special-benchmark-current.json；本次前后报告分别为 tmp/replay-special-benchmark-before-step4.json 与 tmp/replay-special-benchmark-after-step4.json，均按已有规则忽略。

## 验证与本机接入

相关 SQLite、会话/训练关卡和客户端单元测试通过，覆盖：候选分页、探测与源上限、RTH 缺口、自然数据结尾；完整桶替换与成交量不重复、隐藏区间不重载、历史压缩和指标预热；显式批量上限；1,000 根合并请求与 100 根分批请求的逐源 ABR、FIFO、费用、OCO、日志、上下文与全部权益采样一致；大批次失败回滚和丢失响应重试。浮点量按 1e-10 精度比较，时间、源序号、身份及上下文内容仍严格核对。

本次没有增加布局、控件、文案或视觉语义，沿用既有缓冲/错误反馈和图表跟随规则；按本会话持续要求仅进行自动化检查，未执行 computer use 或固定视口截图，手感由用户本机体验。

154 项相关测试通过（87 项真实 SQLite 集成测试、67 项相关单元测试），1 项原有基准跳过；原生 SQLite / DELETE + FULL 下另行复测 3 项新增大批次用例通过。lint、TypeScript 与生产构建通过。

本机已完成备份与接入：48 张表计数、两个账户和两条回放进度与重建前基线一致，原 .env 保持一致，数据库完整性检查为 ok、外键检查无异常。备份位置记录在 tmp/local-replay-special-current-backup.txt，核对与运行记录为 tmp/local-replay-special-install-report.json。服务已恢复至 http://localhost:3000，页面/API 只读检查返回 200，实际连接为 SQLite 3.51.3 / WAL / FULL；刷新页面加载新客户端。生产环境未部署。
