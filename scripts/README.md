# 脚本目录

> 文档状态：当前规范。适用范围：当前脚本分类、调用方式和维护入口；数据库升级规则以升级指南为准。

从仓库根目录运行脚本，优先使用 [package.json](../package.json) 已提供的 pnpm 命令。目录按用途分类；文件名含 `.test.` 的是自动测试，其余文件包括运行入口、手动验收或辅助工具。

| 目录 | 用途 | 典型入口 |
| --- | --- | --- |
| [workers/](workers/) | 应用运行时后台任务，由业务模块启动 | AI 分析、行情导入、行情聚合、回放纠错 |
| [database/](database/) | SQLite 初始化、驱动准备、运行时诊断及保留的升级实现；相关自动测试就近存放 | `db:init-sqlite`、`db:prepare-sqlite`、`db:runtime`、`db:upgrade` |
| [acceptance/](acceptance/) | 手动验收、独立预览和浏览器验证 | `acceptance:user-wallet`、`acceptance:user-growth`、`preview:user-growth` |
| [benchmarks/](benchmarks/) | 性能测量和诊断；`sqlite-wal/` 是独立 WAL 验证工具组 | `benchmark:*`、`diagnose:sqlite-commit` |
| [tools/](tools/) | 文档检查、品牌图标和示例数据生成、AI 密钥设置；文档检查测试就近存放 | `docs:check`、`lint` |

测试辅助进程及验收数据准备放在 [tests/fixtures/](../tests/fixtures/)；历史迁移用例放在 [tests/legacy-migrations-v1/](../tests/legacy-migrations-v1/)，其执行范围和退役约定见[升级指南](../docs/operations/upgrade.md#历史迁移测试)。自动测试使用默认 `corepack pnpm test`，不自动执行手动验收或 benchmark 脚本。

数据库升级、停写、备份、密钥及历史版本边界统一见[升级指南](../docs/operations/upgrade.md)。`acceptance/verify-replay-migration.mjs` 和 `verify-prop-practice-upgrade.mjs` 属于历史专项核对，不能作为当前通用升级入口；前者依赖本机临时基线及固定数据库路径。

移动或新增脚本时，同步检查 package 命令、业务子进程入口、相对导入、基于文件位置定位仓库根目录的代码，以及测试和文档引用。生产镜像继续复制整个 `scripts/`，运行时 worker 不依赖 `tests/fixtures/`。
