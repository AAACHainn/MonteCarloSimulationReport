# 用户成长正式数据库升级记录

日期：2026-10-26。用户明确授权：直接升级正式库，在最终成果上验证。目标为 `01d723f` 加第五阶段尚未提交的实现，保留工作区改动，未提交或推送。

## 本次目标与数据保护

正式库：`D:/work/code/codex/MonteCarloSimulationReport/prisma/dev.db`，本地 Node 24.15.0 / Windows，better-sqlite3 12.8.0 / SQLite 3.51.3，原配置 WAL / NORMAL。实际核对无 `_prisma_migrations`、升级前无用户表；按原初始化方式升级，不切换 Prisma 迁移路径、不补造迁移历史。

停止自己启动的 3103 验收服务后，以进程和端口清单确认无本项目服务或 worker；已有任务均完成。原第三四、第五阶段验收库保留，未导入或覆盖正式库。`.env`、行情及 AI 加密密钥未更改；完整源文件指纹另存在忽略目录 `tmp/user-growth-stage5/formal-code-target.json`。

## 实际执行

使用仓库标准 `db:upgrade`，显式核对正式路径和停写声明。备份放在权限允许的工作区忽略目录内，不纳入 Git：

`tmp/user-growth-stage5/formal-upgrades/2026-10-25T17-57-54-558Z-b1543326-82f3-4e36-8292-6ead57407fde/`

保留 `before.db`、`environment.backup`、`storage/`、`.market-imports/`、`baseline.json`、`rehearsal.json`、`actual.json`、子进程日志、进度与 `report.json`。备份使用 SQLite backup API，包含已提交 WAL；不是复制主文件代替一致性备份。

标准流程在新副本执行初始化及重复演练，检查全部目标模型、隐式关联表、完整性/外键、原字段全量指纹；写入前复核源库未变化和执行代码未变化，再对正式库执行同一路径。正式结果与演练一致，55 张原表全部原字段与升级前备份一致。最终完整性 `ok`、外键 0、仍 WAL；维护连接临时 FULL，应用仍使用原 NORMAL。

成功命令退出码 0；报告 `status=SUCCESS`、`databaseStatus=SUCCESS`、`method=init`、`cleanup.status=COMPLETE`，完成时间为北京时间 2026-10-26 02:05:28。成功后仅逐个清理本次明确路径的三个演练数据库文件；备份、配置附件及报告保留，维护锁已释放。

首次普通沙箱执行曾在 `init-sqlite.mjs:530` 报 `SQLITE_READONLY`。先停止并保留现场，再只读全量核实 55 表原字段及 schema 均未变化、用户表尚未创建、原进程已退出。随后仅移除该退出进程对应的单个维护锁，提升权限重跑完整标准流程成功。未更改 ACL、删除 WAL/SHM 或用备份回灌。失败目录 `2026-10-25T17-48-19-969Z-aba2b3ca-50e9-4c3e-bd18-a97b93c2b9e3` 及 `failure-audit.json` 均保留，不能将其 FAILED 报告与最终成功报告混淆。

## tester 独立只读核对

按既有 tester 配置执行，未覆盖模型设置。

- 基线 55 表、升级后 59 表；原字段全量一致。`actual.json` 的 ReplaySession 全字段哈希因新增四列变化，原 14 个字段已逐行与 `before.db` 比较相等。
- 10 个原会话全部 `userId=NULL`、`ownershipSource=UNASSIGNED`、`growthEligible=false`、`assignedAt=NULL`。
- UserProfile、UserGrowth、UserGrowthFact、UserRealmRecord 均为 0，没有导入验收用户或补算旧经验。
- 未在正式库创建测试用户、交易、出金、改归属或执行删除。

`.env` 与本轮 environment.backup 字节相同；行情及 AI 密钥哈希与升级前一致。存储和导入文件备份均存在。此次不重复此前已完成的 1,552 项功能测试，另做正式构建及升级后的只读接口核对。

## 正式运行与用户验证

标准 `corepack pnpm run build` 在独立验收数据库、关闭同步及全部预览/验收标志为 0 的环境执行，退出码 0：Prisma 原版本生成、Next 编译、类型/检查、23 页生成、build traces 全部通过。正式构建位于默认 `.next`，不复用带验收横幅的隔离构建。

正式入口：<http://localhost:3000/users>，原工作台：<http://localhost:3000/market-replay>。服务已启动，显式指向上述 `prisma/dev.db`；实际连接日志为 SQLite 3.51.3 / wal / synchronous:1 / NORMAL。上传目录使用正式 `storage/user-avatars/`。3103 验收服务已停止，未将其用户或图片复制到正式库。

首次正式验收仅在服务进程设置 `MARKET_DATA_SYNC_ENABLED=0`，`.env` 原同步配置仍为 1，未主动调用行情提供商下载。验收期间重新启动可在项目目录执行：

```powershell
$env:MARKET_DATA_SYNC_ENABLED = "0"
corepack pnpm start --hostname 0.0.0.0 --port 3000
```

用户确认后可结束此服务，并在没有该临时覆盖的新终端按原配置启动，恢复原自动同步；数据库升级不需要重复执行。

最终 tester 只读 GET：`/api/users` 200、0 用户；`/api/user-sessions?page=1` 200、10 会话；`/api/market-datasets` 200、3 个行情；`/users` 200 且无独立验收横幅。8 个预制头像均 200、MIME image/webp、RIFF/WEBP 签名有效。检查未产生正式测试数据。实际界面由用户在最终成果上验证；本次依升级指南仅通过 CLI 和只读 API 核对，不另做浏览器自动操作。

正式数据没有预置用户是预期结果。用户应创建自己的档案并新建训练会话验证成长；旧会话保留未归属，手动历史归属不补算旧成果。正式试用后的新数据须继续保留，不能用升级前备份自动回退覆盖。

随后按用户要求，由 gpt-6.1-sol / xhigh 审核全部未 push 的需求代码，确认并修复交易日志进入归属确认、头像不确定提交清理两项问题。2026-10-26 已重新备份、核对原数据、构建并启动正式 3000；无需新迁移。最新检查及本轮备份位置见[代码审核与修复记录](user-growth-review-2026-10-26.md)，不把本文件较早构建的结果代替最新运行结果。
