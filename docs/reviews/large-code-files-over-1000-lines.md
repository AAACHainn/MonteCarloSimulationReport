# 超过 1000 行的代码文件

> 文档状态：历史记录。适用范围：2026-10-23 的大文件扫描；文件清单、行数和临时目录仅对应当时范围，不作为当前重构待办。
> 当前规范：[当前文档索引](../README.md#当前入口)。

扫描日期：2026-10-23

扫描范围：仓库内的 `.ts`、`.tsx`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.py`、`.css`、`.scss`、`.sass`、`.less`、`.sql`、`.prisma`、`.sh`、`.ps1`、`.html`、`.mdx` 文件；排除 `node_modules`、`.next`、`.git`、`coverage`、`dist`、`build`、`.turbo`、`.vercel` 目录。临时目录 `tmp/` 中的代码文件也纳入统计。按物理行统计，空行计入。

共扫描 1113 个代码文件，发现 9 个文件超过 1000 行。

| 行数 | 文件路径 |
| ---: | --- |
| 42969 | `tmp/chart-hide-after-qa.js` |
| 3702 | `tmp/chart-hide-after-qa.css` |
| 2967 | `components/market-replay/market-replay-client.tsx` |
| 2367 | `components/market-replay/replay-chart.tsx` |
| 1778 | `lib/i18n.ts` |
| 1436 | `components/trade-journals/journal-trade-table.tsx` |
| 1380 | `lib/market-replay/advance.integration.test.ts` |
| 1371 | `components/market-replay/paper-journal-table.tsx` |
| 1201 | `lib/ai/ai.integration.test.ts` |

