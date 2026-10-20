# Architecture Review 修复报告

日期：2026-10-20。依据：[独立审查](architecture-review-2026-10-20.md)；修复前计划见 [Fix Plan](fix-plan-2026-10-20.md)。

第 1～7 节保留上一轮交付记录；后续只读审查发现的 P2 及最新修复版本见第 8 节。

## 1. 结果与版本

本轮确认 AR-01～AR-04 的问题存在，完成 AR-01（P1）、AR-02/AR-03（P2），暂缓 AR-04（P2）。没有 P0/P3 修复，也没有扩展为新的聚合架构。

业务基准为 `51c6017dfb07091776e906b888f371bb13df09e6`；执行中用户提交了仅含审查资料的 `f2b0637c973bdb3afb2e621c32acb09655b1cb40`，三个业务修复依次位于它之后，待复审业务版本为 `dfce674647dbcc1dfd55e44982731075086ba5df`。

| ID | 是否确认 / 证据 | 处置 | 对应 Commit SHA |
| --- | --- | --- | --- |
| AR-01 / P1 | 确认；新增 SQLite 回归在修复前实际得到 25 根而非 1000 根预热 | 已修复，受控续页完成指标窗口 | `c9344b1dc38c488b3bdb218a70fd0e19b41cfaf8` |
| AR-02 / P2 | 确认；修复前短稀疏 EOF 的普通 API 返回非空 completed，与形成中规则冲突 | 已修复，推进结束与桶收盘分离 | `e1e2a1954a1f40f379c18f358c120817ee695ebb` |
| AR-03 / P2 | 确认；源码过滤确实忽略同 dataVersion 的模式/代次变化，新增自动回归覆盖显示判断、缓存及重分类链 | 已修复；本轮未进行浏览器交互复现 | `dfce674647dbcc1dfd55e44982731075086ba5df` |
| AR-04 / P2 | 确认；本轮源码核对取消/失败仅更新 job，清理仅选择过期 RETIRED；独立审查已有生命周期探针 | 暂缓；没有增加清理代码，不算修复完成 | 无 |

未修改 Prisma schema、迁移、依赖、配置或历史业务数据；未执行正式库升级/清理，未停止业务服务，未推送、合并或部署。本轮没有重新计算正式库逐行摘要，不能套用之前开发阶段的数据核对作为本轮证据。

## 2. AR-01：完整指标预热

**根本原因**：单页读取因源行预算而缩页后退出；窗口 API 把这一页直接分成 visible/warmup，消费方无法区别“尚未读够”和“真实历史不足”。

**修复方式**：保留原 `readExportWindow` 的有界分页能力，增加 `readCompleteWindow` 协调器。按已有页面估算取页，保持原始读取每页 25,000 行限制；所有页绑定同一数据集快照、源揭示上界和时段。只有请求数量满足或真实历史读完才返回成功；不通过扩大单页原始预算修复。

累计行预算为 250,000、查询预算为 10,000，重试也消耗预算。预算按 SQL 返回后核算，可能在最后一个有界 SQL 批次超额后拒绝；这不是对 SQLite 物理扫描页/IO 字节的硬上限。超过预算整次失败，不返回伪完整结果。结束前复核 dataVersion/historyVersion、代次、源模式和聚合指纹，变化则拒绝混合窗口。

回放窗口调用完整协调器；导出窗口在请求指标预热时也调用，未请求预热的普通导出分页保留原行为。成功响应字段不变；新增明确失败 `422 / WINDOW_BUDGET` 和 `409 / WINDOW_VERSION_CHANGED`，复用现有错误展示区域和集中中文文案。未新增客户端分页协议或表结构。

**修改文件**：

- `lib/market-replay/export-window.ts`：完整窗口协调与最终版本复核。
- `lib/market-replay/aggregation-reader.ts`：累计预算专用错误，保留旧错误 message 兼容。
- `lib/market-replay/types.ts`：集中累计窗口预算常量。
- `app/api/market-datasets/[id]/bars/window/route.ts`：接入完整窗口和明确失败。
- `app/api/market-datasets/[id]/bars/export-window/route.ts`：导出预热完整性与同类错误。
- `lib/i18n.ts`：预算/版本变化中文错误。
- `lib/market-replay/window-warmup.integration.test.ts`：独立临时 SQLite，100,000 根秒源回归。
- `docs/reviews/fix-plan-2026-10-20.md`：修复前范围、风险及验证方案。

**测试证据**：专项 3 文件、25 项通过。60s 与 61s 均返回 300 可见 + 1000 预热，ABR(1000)=2，EMA(1000)≈100；实际短历史返回不足并保留 null 指标。覆盖导出预热、源揭示边界、不重叠、累计预算拒绝、四种版本/语义变化和错误响应。

**剩余风险**：完整预热会增加实际 SQL 工作量；极端合法周期/指标组合仍可能触发预算错误，需调整窗口/指标后重试，不能将它标为历史不足。本轮未重新测端到端性能；未新增“充分预热后真实下单日志”的浏览器验收，已有上下文/撮合集成测试在全量中回归。最终元数据复核采用乐观一致性，不引入长读事务。

## 3. AR-02：EOF 状态一致性

**根本原因**：普通计划器把 EOF 达到请求桶数写为 completed，API 又按 reachedVisibleBucket 关闭形成柱。数据耗尽与时间桶结束被混用。

**修复方式**：保留 reachedVisibleBucket 表示本次推进可停止；completed 只依真实时间边界判断。普通/快速计划复用 `isAggregationBucketClosed`；普通 API 只按明确 completed 桶修订，其他状态交给共享聚合规则。源推进目标、账户、撮合和采样逻辑未改。

**修改文件**：

- `lib/market-replay/bar-quality.ts`：共享真实时间收盘判断。
- `lib/market-replay/display-advance.ts`：记录真实桶末尾和已揭示时间，不以 EOF 单独宣告收盘。
- `lib/market-replay/flat-display-plan.ts`：复用相同判断。
- `app/api/market-datasets/[id]/replay/advance/route.ts`：移除 reachedVisibleBucket 强制关闭形成柱。
- `lib/market-replay/advance.integration.test.ts`：普通/快速/窗口刷新/增量四路径对照。
- `lib/market-replay/display-advance.test.ts`：短 EOF、真实边界和隐藏时段覆盖。

**测试证据**：专项 3 文件、72 项通过、1 项跳过。DENSE 的 `[0s,2s]`→5s 尾柱在四路径均 FORMING/NORMAL；`[0s,4s]` 已越过边界，均 CLOSED/GAP；连续 0～4s 均 CLOSED/NORMAL，保存进度不变。原 FIFO/OCO、费用、权益、幂等、跨会话、ABR 与纠错测试也在专项/全量中通过。

**剩余风险**：保留了既有“探测后继记录的时间、但不返回其价格”的计划语义。本次不扩展为完全不使用后继时间元数据；稀疏跨桶的 completed 提示和仅凭当前揭示源重新计算的区别仍需按原约定理解。历史已保存幂等回执不被批量重写。

## 4. AR-03：打开页面后的显示语义更新

**根本原因**：轮询仅比较源 dataVersion，但模式/聚合代次可以独立变化。另发现图表在时间轴未变时只更新尾柱，单纯更新状态不能刷新历史橙框。

**修复方式**：以独立显示签名判断模式、代次、规则与时段变化；源历史冲突仍优先拒绝。签名变化时阻断旧窗口/历史请求，等待推进与下单串行链，按新语义重读窗口，重分类保留的历史前缀。恢复原播放意图，失败显示现有错误并暂停；不改变用户手动平移后的历史窗口。

图表内部可选 `dataRevision` 与**已加载数据**一起更新，强制历史样式完整替换，避免新元数据先渲染、旧柱随后误走尾部更新。原有视口/价格轴保留逻辑继续使用。没有新增外部业务 API 或布局控件。

源缓存实例仅依源数据身份/版本创建，显示元数据变化不销毁原始内存缓存；显示缓存独立换域并释放旧对象，窗口缓存签名也包含显示语义。

**修改文件**：

- `lib/market-replay/dataset-refresh.ts`：显示签名、刷新分类、保留历史的窗口重分类/合并。
- `lib/market-replay/dataset-refresh.test.ts`：同版本模式/代次/规则变化、尾部/历史冲突、缓存与完整重分类。
- `components/market-replay/market-replay-client.tsx`：轮询、旧响应隔离、受控重读与数据修订。
- `lib/market-replay/use-replay-window-cache.ts`：源缓存身份独立、显示对象释放。
- `lib/market-replay/chart-data.ts`：尾部更新资格包含显示修订。
- `components/market-replay/replay-chart.tsx`：修订变化时走完整 series 更新，保留视口处理。

**测试证据**：专项 4 文件、33 项通过。新模块 8 项覆盖模式/代次/规则、无变化、历史冲突优先级、源 key 保持/显示 key 改变、历史 GAP→NORMAL、后续源增量等价、已确认缺口保留和未来缓存排除。验证修订变化不能只更新尾柱；原有播放意图/缓存测试一起回归。

**剩余风险**：轮询仍约 15 秒，操作占用时可能延后，不是推送式即时更新。本轮没有浏览器双页面改模式/重建操作验收，也没有通过浏览器验证失败重试、缩放和价格轴；纯函数、类型、静态检查不等于完整 UI 验收。未来聚合规则改变时间轴时仍应随版本升级刷新客户端，不把本次签名当通用旧规则解释器。

## 5. AR-04：确认后暂缓

保留失败/取消检查点有明确恢复价值，不能直接把所有失败代次归入退休并删除。要完整修复，需确定可恢复保留期、明确放弃入口、放弃后恢复如何拒绝，以及清理与运行 worker/活动指针/在途读取的互斥条件；这些会改变持久状态及用户恢复契约，超出本次低风险补丁。

本轮不自行决定“取消即删除”或任意到期时间，也不新增表或执行清理。后续建议先确认以下方案：保留 FAILED/CANCELLED/INTERRUPTED 的可恢复资格；显式放弃或满足已批准的过期策略后进入不可恢复终态；仅回收无活动引用、无运行任务且已过保护期的代次，分批执行并保留任务审计。是否需要新增字段应随该方案决定。

**剩余风险未消除**：反复失败/取消后另起重建仍可能积累部分摘要。本报告没有将其降级或写成已修复；上线容量决策仍需考虑该项。

## 6. 本轮真实验证记录

日志在被忽略的本机 `tmp/`，不是 Git 交付附件。表中结果仅代表本轮运行，未复用旧交接材料的通过数量。

| 命令/验证 | 结果 | 证据 |
| --- | --- | --- |
| AR-01 修复前新集成回归 | 失败：61s 预热实际 25/1000；同时发现常量 EMA 约 1.6e-12 浮点误差，断言容差调整为 1e-10 | `tmp/ar-01-before.log` |
| `corepack pnpm exec vitest run lib/market-replay/window-warmup.integration.test.ts lib/market-replay/export-window.test.ts lib/market-replay/aggregation.integration.test.ts --maxWorkers=1 --minWorkers=1` | 最终 3 文件、25 项通过 | `tmp/ar-01-after.log` |
| AR-02 修复前 `advance.integration.test.ts -t 'keeps EOF'` | 1 失败、2 通过，其余为命令过滤跳过 | `tmp/ar-02-before.log` |
| `corepack pnpm exec vitest run lib/market-replay/advance.integration.test.ts lib/market-replay/display-advance.test.ts lib/market-replay/bar-quality.test.ts --maxWorkers=1 --minWorkers=1` | 3 文件、72 项通过、1 项原 opt-in 跳过 | `tmp/ar-02-after.log` |
| `corepack pnpm exec vitest run lib/market-replay/dataset-refresh.test.ts lib/market-replay/bar-cache.test.ts lib/market-replay/bar-quality.test.ts lib/market-replay/playback-lifecycle.test.ts --maxWorkers=1 --minWorkers=1` | 4 文件、33 项通过 | `tmp/ar-03-after.log` |
| `corepack pnpm test --maxWorkers=4 --minWorkers=1` | **126 文件通过、1 文件跳过；1143 项通过、2 项跳过**，38.77 秒 | `tmp/ar-fixes-full-tests.log` |
| `corepack pnpm exec tsc --noEmit` | 通过 | `tmp/ar-fixes-types.log` |
| `corepack pnpm lint` | 通过 | `tmp/ar-fixes-lint.log` |
| `corepack pnpm run build` | **失败**，Prisma DLL rename EPERM，尚未进入 Next build | `tmp/ar-fixes-build.log` |
| `corepack pnpm exec next build D:/code/codex/ar-fixes-build-check-20261020`，从主仓库执行，显式指定隔离 DATABASE_URL 并关闭同步 | **通过**：Next.js 15.5.18 编译、lint/类型检查、页面数据收集、静态生成和构建追踪完成；不等同标准 build 脚本通过 | `tmp/ar-fixes-isolated-next-build.log` |

全量两项跳过仍为需显式开启的 20M 逻辑源规模测试与 1s→5min 基准，未开启，不算通过。故障注入产生的错误栈和模拟 503 属于相应测试预期，不改变最终断言结果。

执行过程还遇到 Vitest/esbuild 沙箱 spawn EPERM，允许隔离子进程后完成测试。AR-01 追加错误契约测试时，Prisma 动态 delegate spy 恢复产生夹具失败；已显式恢复原方法，最终专项和全量均通过。没有修改指标、财务算法或放宽已有测试超时来消除这些失败。

标准构建的 DLL rename EPERM 与占用/访问限制一致，本轮未通过终止进程验证具体持有者。为避免停止现有服务或覆盖其构建目录，将已提交源码归档到仓库外隔离目录，连接现有依赖并创建仅用于构建的空测试库，禁用行情同步，再使用已有 Prisma Client 执行 Next.js 构建。schema 未变化；本轮不把绕过重复 generate 写成该步骤通过。隔离目录不复制 `.env`、行情或密钥，未启动服务。

隔离目录中直接调用 pnpm 曾因模块目录位置校验触发安装流程，在无 TTY 时退出；没有允许清除模块或继续安装，随后从原仓库调用锁定 CLI 并明确传入隔离构建目录成功。隔离源码位于 `D:/code/codex/ar-fixes-build-check-20261020`，已移出仓库，避免临时 `.ts` 参与主仓库扫描；本轮没有批量删除清理它。

隔离 Next 构建有“未识别 Next.js ESLint plugin”的警告，构建退出码为 0；主仓库独立 `corepack pnpm lint` 已实际通过。本轮未修改 ESLint 配置，也未把该警告描述为没有任何诊断输出。

## 7. 复审与交付限制

重点复审 `readCompleteWindow` 的累计预算/游标/版本边界、普通 EOF 的 completed/reached 区分，以及显示修订和旧请求失效的配合。本轮补丁未宣称解决原审查中的所有长期风险：延迟上下文未来规则冻结、混合交易纠错长链、目标镜像/worker/真实旧库恢复和实际用户端延迟仍需独立验收。

UI 规范检查：已完整阅读；未增加布局、控件、颜色或数值格式；中文失败沿集中 i18n 和原错误区。新增显示修订走既有视口/价格轴保留路径。**例外**：本轮未执行 375/1440px 或其他视口浏览器视觉验收，避免把旧服务当成本轮新客户端验证，需在隔离运行环境补验。

本轮业务修复三个独立本地提交可按问题 ID 审查；审查/交接原文保持原样。AR-04 暂缓和标准构建限制均需在后续上线判断中保留，不能以全量测试通过代替。

报告交付前执行 `git diff --check`，并直接检查新增文档相对链接与行尾空白；仅报告文件待提交时没有重跑业务测试或构建。

## 8. 后续 P2：未应用窗口的显示刷新恢复（AR-03-R1）

**是否确认**：确认。独立只读审查指出 `displayedMetadataRef` 在窗口应用前即更新；本轮核对 `loadWindow` 发现取消、请求失效和回放状态变化均可直接返回，而调用者无法判断成功。dataset 已更新后，轮询返回 none，原 effect 不再尝试相同签名。

**根本原因**：将“已开始刷新”当作“新语义窗口已应用”，且缺少失败/失效后的独立重试机制。

**修复 Commit**：`e1005b5896ab937d31ae59566442ff0a731d8482`，基于 `d9dbe51`。这是针对后续审查问题的单独业务提交，不改写上一轮三个修复的历史。

**修复方式**：

- `loadWindow` 显式返回应用结果：取消、过期、源进度/周期/时段变化返回 false；真正写入窗口后才返回 true。
- 只在成功结果后提交显示签名；读取失败或返回 false 时保持待刷新，间隔 5 秒串行重试，不依赖 dataset 再次变化。
- 重试重新读取最新回放状态，沿既有推进/下单串行链等待；源历史冲突时停止自动重试，保留原冲突处理。
- effect 清理会取消待触发定时器并使旧任务失效；应用窗口前额外检查任务仍有效，防止旧版本迟到结果覆盖当前图表。旧任务迟到异常也不会更新错误区或版本标记。
- 成功后仅清除本次刷新产生且仍匹配的错误；保留其他错误与原用户播放意图。

**修改文件**：

| 文件 | 用途 |
| --- | --- |
| `components/market-replay/market-replay-client.tsx` | 明确窗口应用结果、取消应用保护、成功标记及恢复接入 |
| `lib/market-replay/dataset-refresh.ts` | 可取消、无并发重叠的显示刷新重试控制 |
| `lib/market-replay/dataset-refresh.test.ts` | 新增 7 项异步/假时钟回归 |

**测试证据（本轮实际执行）**：

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `corepack pnpm exec vitest run lib/market-replay/dataset-refresh.test.ts lib/market-replay/playback-lifecycle.test.ts lib/market-replay/server-request.test.ts --maxWorkers=1 --minWorkers=1` | 首轮专项 32 项通过；当时新恢复测试为 6 项，后续新增第 7 项由最终全量覆盖 | `tmp/ar-03-recovery-tests.log` |
| `corepack pnpm test --maxWorkers=4 --minWorkers=1` | 最终 126 文件通过、1 文件跳过；**1150 项通过、2 项跳过**，34.26 秒；刷新文件最终为 15 项（原 8 + 新 7） | `tmp/ar-03-recovery-full-tests.log` |
| `corepack pnpm exec tsc --noEmit` | 最终代码通过 | `tmp/ar-03-recovery-types.log` |
| `corepack pnpm lint` | 最终代码通过 | `tmp/ar-03-recovery-lint.log` |
| `corepack pnpm exec next build D:/code/codex/ar-fixes-build-check-20261020` | 最终隔离源码构建通过，编译、类型/页面生成和追踪完成；仍有 Next ESLint plugin 识别警告 | `tmp/ar-03-recovery-build.log` |
| `git diff --check` | 通过 | 交付时命令结果 |

7 项新增回归覆盖：网络失败后即使轮询结果为 none 也会重试；序号变化导致窗口失效后改用最新序号；清理后屏蔽迟到成功/失败结果两种返回；取消待重试且读取不重叠；旧版本迟到错误不覆盖新版本成功；历史冲突停止重试。

构建复用了仓库外隔离目录：核对 578 个受跟踪源码/配置路径，除本轮三份文件外与主仓库一致，再复制这三份文件并校验哈希。构建显式使用该隔离目录的测试库，禁用同步，使用已有 Prisma Client；本轮未执行标准 `pnpm run build` 或重复 `prisma generate`，不将此前 DLL rename EPERM 写成已解决。运行服务和主仓库 `.next` 未被构建替换。

**剩余风险和边界**：持续网络故障会保留旧图表/错误并每 5 秒重试，不能保证离线时立即更新。新增验证为控制器及相关状态/请求回归，未进行浏览器 effect 交互、固定视口或网络故障注入验收；没有新增布局/控件，本轮沿用已有 UI 验收例外。外部 API、数据库、依赖、撮合与聚合规则均未变更，AR-04 暂缓状态不变。没有推送、合并或部署。
