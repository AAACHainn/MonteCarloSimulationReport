# Prop firm 账户模式调研：Lucid、Apex、FundedNext、Topstep

核查日期：2026-10-23（北京时间）。用途：为后续模拟账户类别设计提供规则依据。本轮只整理调研结论，不修改应用、数据库或撮合逻辑。

调研由两个 `gpt-6-luna` 子代理分别覆盖 Lucid / Apex、FundedNext / Topstep，主代理交叉核对关键官方页面。以下链接均为公司官网或官方帮助中心；“当前”表示核查时公开页面所载，不代表已验证结账资格或个别账户协议。美元金额均为 USD；K 表示千。

## 1. 主要结论

- 公司名不足以定义账户类别。需要区分产品、考核 / 模拟 funded / live 阶段、规则版本，以及购买时的附加选项；Apex 还存在交易平台差异。
- `funded` 不一定代表真实资金交易。Lucid 的模拟 funded、Apex PA、Topstep XFA 都与后续 live 阶段分开；FundedNext 的奖励账户也不能直接当作真实经纪账户。[Lucid 路径](https://lucidtrading.com/general-faq/)、[Apex 路径](https://apextraderfunding.com/)、[Topstep XFA](https://help.topstep.com/en/articles/8284215-express-funded-account-parameters)、[FundedNext live 路径](https://helpfutures.fundednext.com/en/articles/16522296-road-to-live-trading-rapid-flex-direct)。
- 最大回撤至少存在盘中追踪、日终追踪、静态三类。**日终追踪只是阈值更新在日终，不意味着盘中可以跌穿阈值再恢复。** Apex、Topstep、FundedNext 的相关规则明确包含盘中触线处理。[Apex EOD](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-drawdown-explained/)、[Topstep MLL](https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit)、[FundedNext Rapid Daily](https://helpfutures.fundednext.com/en/articles/17229779-fundednext-futures-rapid-daily-fundednext-account-all-rules)。
- 出金需要独立规则：盈利日计数、一致性、周期利润、缓冲额、最低 / 最高提款额、分成、可提款次数，以及提款后止损底线的变化。
- 历史规则仍有现实用途。Apex 官网正在展示 Legacy 限时回归，Lucid 首页仍列 Black，但相关帮助中心使用停售或 Legacy 标签；必须把销售状态与规则版本分开记录，见第 7 节。

## 2. 统一阅读口径

| 名称 | 本文含义 | 后续模拟需要区别的内容 |
| --- | --- | --- |
| 名义规模 | 25K / 50K 等产品档位 | 不等于可亏金额，也不必等于账面初始余额 |
| Balance / Equity | 已实现余额 / 包含浮动盈亏的权益 | 更新回撤高水位和检查触线可能使用不同口径 |
| MLL / loss floor | 最大允许亏损额度 / 对应的最低权益线 | 额度 `$2,000` 和底线 `$48,000` 是不同字段 |
| Intraday trailing | 随盘中高水位抬升底线 | 可能包含未实现盈利，盈利回吐也会触线 |
| EOD trailing | 按交易日收盘高水位抬升底线 | 更新时点与盘中违规检查时点需要分开 |
| Static | 底线不随盈利抬升 | 提款等事件仍可能改变后续底线 |
| DLL | Daily Loss Limit，每日损失限制 | 常见为强平并暂停到下一交易时段，区别于账户失败 |
| Consistency | 最大盈利日占规定利润基数的比例 | 可能限制过关或提款；通常不是触线即失败 |
| Buffer / safety net | 提款后必须留在账户的缓冲额 | 区别于 MLL 底线与周期最低盈利目标 |

示意：同为 50K、回撤额度 2K，若盘中权益最高 52K，日终余额 50.5K，则未触发任何封顶或特殊事件时，盘中追踪底线可为 50K，日终追踪底线为 48.5K，静态底线为 48K。同一条价格路径可能产生不同结果。这是计算口径示例，不是任何一家公司的完整账户模板。

## 3. Lucid Trading：期货

### 3.1 产品及考核

Pro / Flex / Daily 通常为考核 → 模拟 funded → live 路径；Direct 跳过考核，直接进入模拟 funded。官网说明账户费为一次性、没有交易账户月订阅；配置和活动影响售价，本文不固定促销价格。[官网 FAQ](https://lucidtrading.com/general-faq/)、[模拟账户费用](https://support.lucidtrading.com/en/articles/11404620-simulated-account-fees)。

下表数列均依次对应 **25K / 50K / 100K / 150K**；Direct 无考核目标。

| 产品 | 考核利润目标 | 回撤额度 | 回撤方式与一致性 | DLL / 仓位 |
| --- | --- | --- | --- | --- |
| LucidPro | 1,250 / 3,000 / 6,000 / 9,000 | 1,000 / 2,000 / 3,000 / 4,500 | 考核及 funded 为 EOD；考核页允许最快一天通过，未列考核一致性 | 考核 DLL：无 / 1,200 / 1,800 / 2,700；最大 2 / 4 / 6 / 10 mini |
| LucidFlex | 同 Pro | 同 Pro | EOD；考核一致性购买时选 40% 或 50%，funded 无一致性 | DLL 可开关；最大 2 / 4 / 6 / 10 mini |
| LucidDaily | 同 Pro | 同 Pro | 考核可选 EOD 或 Intraday，**funded 一律 Intraday**；考核一致性可选 40% / 50% | DLL 可开关；开启时 600 / 1,200 / 1,800 / 2,700；最大 2 / 4 / 6 / 10 mini |
| LucidDirect | 无考核 | 1,000 / 2,000 / 3,500 / 5,000 | EOD；提款一致性 20% | DLL：无 / 1,200 / 2,100 / 3,000；最大 2 / 4 / 6 / 10 mini |

来源：[Pro 考核](https://support.lucidtrading.com/en/articles/12890029-lucidpro-evaluation-account)、[Flex 考核](https://support.lucidtrading.com/en/articles/12945790-lucidflex-evaluation-account)、[Flex 配置](https://support.lucidtrading.com/en/articles/16226050-lucidflex-customization)、[Daily 考核](https://support.lucidtrading.com/en/articles/15996664-luciddaily-evaluation)、[Daily 配置](https://support.lucidtrading.com/en/articles/16033858-luciddaily-customization)、[Direct 账户](https://support.lucidtrading.com/en/articles/12890148-luciddirect-funded-account)。

Pro 的 50K 例子：初始底线 48K，EOD 余额达到规定追踪停止区间后，底线锁至 50,100；官方明确区分 52,100 的 Initial Trail Balance 和 50,100 的 Locked MLL Balance。Flex 有相同的金额表。不能把“锁定底线”误当作“触发锁定所需余额”。[Pro 回撤](https://support.lucidtrading.com/en/articles/12890136-lucidpro-drawdown)、[Flex 回撤](https://support.lucidtrading.com/en/articles/12945815-lucidflex-drawdown)。

Pro / Direct 的 DLL 还存在 LucidScale：达到对应追踪阶段后，按历史最高 EOD 利润的 60% 计算，且不随亏损下调；具体是否开启、何时转换应按产品与阶段绑定。[Pro DLL](https://support.lucidtrading.com/en/articles/12890122-lucidpro-daily-loss-limit)、[Direct DLL](https://support.lucidtrading.com/en/articles/12890185-luciddirect-daily-loss-limit)。

### 3.2 模拟 funded 的提款差异（以 50K 为例）

| 产品 | 提款资格关键条件 | 提款额度与分成 |
| --- | --- | --- |
| Pro | 周期盈利至少 500；最大盈利日不超过周期利润 40%；保留 52,100 缓冲余额 | 最低 500；首笔最高 2,000，后续最高 2,500；通常 90% 归交易者 |
| Flex | 每周期 5 个各赚至少 150 的盈利日、周期净利为正；无 funded 一致性、无提款 buffer | 最低 500；最多利润的 50%，上限 2,000；90% 分成 |
| Daily | 只提 52,100 缓冲余额之上的利润；上次提款后净利为正；无 funded 一致性 | 最低 500；上限为缓冲之上利润，无固定每笔美元上限；90% 分成 |
| Direct | 首轮利润目标 3,000，后续周期目标 2,500；20% 一致性 | 最低 500；前 3 笔上限 2,000，第 4–5 笔 2,500；90% 分成 |

来源：[Pro 提款](https://support.lucidtrading.com/en/articles/12890092-lucidpro-payouts)、[Flex 提款](https://support.lucidtrading.com/en/articles/12945796-lucidflex-payouts)、[Daily 提款](https://support.lucidtrading.com/en/articles/15997266-luciddaily-payouts)、[Direct 提款](https://support.lucidtrading.com/en/articles/12890164-luciddirect-payout-objectives)。

Flex / Daily 的最新购买配置还影响提款时点：DLL 开启可获得盘中 On Demand 提款；Flex 盘中请求后会暂停交易至当日结束。Daily 配置页允许同一时段多次请求，需逐次满足条件。**On Demand 不等于取消其它提款资格。** [Flex 配置](https://support.lucidtrading.com/en/articles/16226050-lucidflex-customization)、[Daily 配置](https://support.lucidtrading.com/en/articles/16033858-luciddaily-customization)。

Daily 另有高影响 USD 新闻前后限制及每日模拟利润上限；其 50K 每日利润上限为 8,000，涉及转 live 流程。旧提款页使用自动转 live 文案，最新 live 总则涉及风险团队审核，后续不能仅用一次阈值触发就模拟为真实资金已到账。[Daily funded](https://support.lucidtrading.com/en/articles/15997244-luciddaily-funded-account)、[Daily 提款](https://support.lucidtrading.com/en/articles/15997266-luciddaily-payouts)、[最新 live 结构](https://support.lucidtrading.com/en/articles/16558826-new-live-structure)。

其它版本：Pro 在 2025-11-28 15:00 美东时间前后购买 / reset 的账户，一致性及首 10K 利润分成不同。Black 在帮助中心归 Legacy，官网仍展示商品；它是单独规则族，考核 60% 一致性、funded 40% 且有仓位 scaling，不能套 Pro / Flex。[Pro 一致性](https://support.lucidtrading.com/en/articles/12890109-lucidpro-consistency-percentage)、[Black 考核](https://support.lucidtrading.com/en/articles/13424894-lucidblack-evaluation-account)、[Black funded](https://support.lucidtrading.com/en/articles/13424896-lucidblack-funded-account)。

## 4. Apex Trader Funding：期货

### 4.1 新版 EOD / Intraday

两条新版主线都是 Evaluation → 模拟 PA → 可能获邀进入 live。新考核一次付费、30 个自然日有效，无新制 reset；过关后通常须在 7 日内激活 PA。购买可选 Standard 或 No Activation Fee，费用方案与交易风控分开。[费用和访问期](https://apextraderfunding.com/help-center/billing/evaluation-plan-fees-and-access-explained/)、[免激活费方案](https://apextraderfunding.com/help-center/uncategorized/no-activation-fee-evaluations/)、[激活期限](https://apextraderfunding.com/help-center/billing/pa-activation-process-deadline-explained/)。

| 新版考核规模 | 目标 | 回撤额度 | EOD 考核 DLL | 考核最大标准合约 |
| --- | --- | --- | --- | --- |
| 25K | 1,500 | 1,000 | 500 | 4 |
| 50K | 3,000 | 2,000 | 1,000 | 6 |
| 100K | 6,000 | 3,000 | 1,500 | 8 |
| 150K | 9,000 | 4,000 | 2,000 | 12 |

EOD 在日终更新底线、盘中执行；Intraday 实时追踪包含未实现盈亏的高水位，其考核无 DLL。两者考核均无一致性要求、无最低交易日，允许最快一天通过。[EOD 考核](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations/)、[Intraday 考核](https://apextraderfunding.com/help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/)。

**平台例外**：考核的 Rithmic / WealthCharts 与 Tradovate 追踪停止条件不同。EOD 文档的 50K 例子中，前两者底线最多追踪至目标余额 53K，而 Tradovate 考核持续追踪；PA 则在底线达到初始额 +100 时停止。Intraday 也需按平台分别处理。[EOD 回撤详解](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-drawdown-explained/)、[Intraday 回撤详解](https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/)。

PA 仓位与 DLL 采用前一个完整交易日 EOD 余额决定的 tier，次日固定，允许升降级。例如 50K PA 最大仓位按档位为 2 → 3 → 4 mini，不是考核的 6 mini；不能在盘中盈利后立即切换新 tier。超过允许仓位的订单可被拒绝。[PA scaling 表](https://apextraderfunding.com/help-center/additional-helpful-items/scaling-levels-pa-explained/)。

### 4.2 新版 PA 提款（50K）

| 规则 | EOD PA | Intraday PA |
| --- | --- | --- |
| 合格盈利日 | 每周期 5 天，每天至少 250 | 每周期 5 天，每天至少 200 |
| 一致性 | 最大盈利日必须严格小于周期总利润 50% | 相同 |
| 安全缓冲 | 52,100；只能提缓冲之上金额 | 相同 |
| 最低请求 | 500 | 500 |
| 第 1–6 笔上限 | 1,500 / 1,500 / 2,000 / 2,500 / 2,500 / 3,000 | 1,500 / 2,000 / 2,500 / 2,500 / 3,000 / 3,000 |
| 分成 / 结束 | 获批金额 100% 归交易者；第 6 笔后该 PA 关闭 | 相同 |

来源：[EOD 提款](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/)、[Intraday 提款](https://apextraderfunding.com/help-center/uncategorized/intraday-trailing-drawdown-payouts/)。不要把严格 `<50%` 写成 `≤50%`。

新 PA 还有滚动活跃要求：每个滚动 30 自然日内至少 2 个净利不低于 50 的交易日；仅下单不能满足。DLL 触发暂停当日，MLL 触发则失败 / 关闭。[活跃规则](https://apextraderfunding.com/help-center/billing/inactivity-policy-on-performance-accounts-pa/)、[DLL](https://apextraderfunding.com/help-center/additional-helpful-items/daily-loss-limit-explained/)。

### 4.3 Legacy 必须单独保留

帮助中心称旧版自 2026-03-01 停售且不追溯改规则；但核查日的首页及独立促销页明确展示 Legacy 限时回归，含 25K / 50K / 100K / 150K / 250K / 300K、三个平台。可确认的是公开销售展示，促销截止时间与结账资格未确认。[Legacy 总则](https://apextraderfunding.com/help-center/legacy-products/legacy-products-overview/)、[当前 Legacy 促销页](https://apextraderfunding.com/legacy-products/)。

Legacy 50K 展示目标 3,000、追踪额度 2,500、最大 10 mini、月订阅，区别于新版 50K 的 2,000 回撤 / 6 mini / 一次性费。Legacy PA 常见旧提款规则还包括 8 个交易日、其中 5 天至少 50、30% 一致性以及前 25K 利润全归交易者的分成结构；不能使用新版 5 天 / 50% / 6 次结束的组合。[Legacy 促销参数](https://apextraderfunding.com/legacy-products/)、[Legacy 提款](https://apextraderfunding.com/help-center/legacy-payouts/legacy-pa-payout-parameters/)。

## 5. FundedNext：Futures 与 CFD 分开

### 5.1 Futures 当前规则族

新文档分别列 Flex、Legacy、Rapid Pro、Rapid Daily；旧名 Rapid / Bolt 自 2026-07-10 起停止新购及 reset，**不等于新版 Rapid Pro / Daily 停售**。带有 Legacy 名称的期货产品也有当前规则页，不能只凭名字推断是否可用。[产品列表](https://helpfutures.fundednext.com/en/articles/14255818-what-types-and-sizes-of-challenges-are-available-at-fundednext-futures)、[提款总则中的旧产品说明](https://helpfutures.fundednext.com/en/articles/17242064-how-can-i-withdraw-my-performance-reward)。

| 考核产品 | 规模 | 目标（依规模顺序） | EOD 回撤额度 | DLL / 一致性 |
| --- | --- | --- | --- | --- |
| Flex | 50K / 100K / 150K | 2,500 / 5,000 / 8,000 | 1,500 / 2,500 / 4,000 | 无 DLL；考核 40%，funded 无一致性 |
| Legacy | 25K / 50K / 100K | 1,250 / 3,000 / 6,000 | 1,000 / 2,000 / 3,000 | 无 DLL；考核 40%，funded 无一致性 |
| Rapid Pro | 25K / 50K / 100K | 1,500 / 3,000 / 5,000 | 1,000 / 2,000 / 2,500 | DLL 默认无、可购买时加；考核无一致性，funded 40% |
| Rapid Daily | 25K / 50K / 100K | 1,500 / 3,000 / 5,000 | 1,000 / 2,000 / 2,500 | DLL 500 / 1,000 / 1,250；全程无一致性 |

来源：[Flex 考核](https://helpfutures.fundednext.com/en/articles/17229829-fundednext-futures-flex-challenge-all-rules)、[Legacy 考核](https://helpfutures.fundednext.com/en/articles/17229536-fundednext-futures-legacy-challenge-all-rules)、[Rapid Pro 考核](https://helpfutures.fundednext.com/en/articles/17229677-fundednext-futures-rapid-pro-challenge-all-rules)、[Rapid Daily 考核](https://helpfutures.fundednext.com/en/articles/17229762-fundednext-futures-rapid-daily-challenge-all-rules)。

Flex / Rapid 的 MLL 底线锁定值为初始额 +100；Legacy 的锁定值为初始额。MLL 日终抬升，盘中浮亏触线仍可即时违规。仓位固定而非盈利 scaling，Flex 为 3 / 5 / 8 mini，Rapid 两种为 2 / 4 / 6 mini，micro 通常按 10:1 换算。[Flex funded](https://helpfutures.fundednext.com/en/articles/17229848-fundednext-futures-flex-fundednext-account-all-rules)、[Rapid Pro funded](https://helpfutures.fundednext.com/en/articles/17229713-fundednext-futures-rapid-pro-fundednext-account-all-rules)、[Legacy funded](https://helpfutures.fundednext.com/en/articles/17229581-fundednext-futures-legacy-fundednext-account-all-rules)。

### 5.2 Futures funded 提款（50K）

| 产品 | 资格 | 金额 / 分成 / 生命周期 |
| --- | --- | --- |
| Flex | 每周期 5 个至少 200 的 Benchmark Day，周期盈利至少 500；无 buffer / funded 一致性 | 最低 250；利润最多提 50%，单次上限 1,500；95% 分成；5 次后结项 |
| Legacy | 每周期 5 个至少 200 的 Benchmark Day，周期盈利至少 500；无 buffer | 最低 250；达到累计 30 Benchmark Days 前最多提利润 50%，50K 单次 cap 6,000；80% 分成；达到 30 天后提款比例及 cap 放开 |
| Rapid Pro | 周期利润至少 500；40% 一致性，最快每 3 天；无 buffer | 最低 250、最高 1,200；90% 分成；5 次后结项 |
| Rapid Daily | 周期利润至少 500；EOD 余额达到 52,100，只提 buffer 之上利润；无最少天数 | 最低 250、最高 1,200；90% 分成；5 次后结项 |

来源：[Flex funded](https://helpfutures.fundednext.com/en/articles/17229848-fundednext-futures-flex-fundednext-account-all-rules)、[Legacy funded](https://helpfutures.fundednext.com/en/articles/17229581-fundednext-futures-legacy-fundednext-account-all-rules)、[Rapid Pro funded](https://helpfutures.fundednext.com/en/articles/17229713-fundednext-futures-rapid-pro-fundednext-account-all-rules)、[Rapid Daily funded](https://helpfutures.fundednext.com/en/articles/17229779-fundednext-futures-rapid-daily-fundednext-account-all-rules)。

“每天可提”仍有执行条件：Rapid Daily 页写明，当天开过新交易可能使当天转钱包入口不可用；不应把频率描述当成任何时刻都可提款。各产品规则还涉及超仓利润扣除、短于约 10 秒的盈利交易占比等，并非所有违规都对应关闭账户。[Rapid Daily 执行细则](https://helpfutures.fundednext.com/en/articles/17229779-fundednext-futures-rapid-daily-fundednext-account-all-rules)。

Futures Direct 当前另有独立常规规则页，不能与旧 FNL:003 Labs 混称：50K、EOD 回撤 2,000、DLL 1,000、20% Perpetual Consistency、90% 分成。最高盈利日跨周期保留，按当前周期利润检查比例。官方明确 No Profit Goal；800 是最低提款金额，不是独立的周期最低净利润，另需清除 2,100 buffer。[Direct 当前规则](https://helpfutures.fundednext.com/en/articles/17430065-fundednext-futures-direct-account-all-rules)。

FNL:003 是另有独立条款的 Labs 直通模拟 funded 产品，其限量购买资格未确认，不作为默认可购主线；同样不能把缓冲之上至少可提 800 推导成一条独立周期利润目标。[FNL:003 账户](https://help.fundednext.com/en/articles/16847874-what-is-the-fundednext-futures-fnl-003-50k-instant-account)、[奖励资格](https://help.fundednext.com/en/articles/16847913-what-are-the-requirements-for-requesting-a-performance-reward-on-the-fundednext-futures-fnl-003-50k-instant-account)。

收费结构以一次性考核费为主；公开页同时存在标价、首几次购买价、后续购买价和 reset 价，且优惠可能变化。后续若模拟商业成本，应独立记录价格版本，不从名义规模推算费用。[Flex 当前价格表](https://helpfutures.fundednext.com/en/articles/17229829-fundednext-futures-flex-challenge-all-rules)。

### 5.3 CFD 产品：作为不同资产体系补充

| 产品 | 阶段与目标 | 每日 / 总损失限制 | 最少交易日 |
| --- | --- | --- | --- |
| Stellar 1-Step | 单阶段，10% | 3% / 6% | 考核 2 天 |
| Stellar 2-Step | 两阶段，8% → 5% | 5% / 10% | 每期 5 天 |
| Stellar Lite | 两阶段，8% → 4% | 4% / 8% | 每期 5 天 |
| Stellar Instant | 跳过考核 | 无 DLL；6% 追踪总损失，底线封顶初始余额 | 无最少天数 |

前三者总损失以初始额为基准，不能套用期货 EOD 追踪模型。Instant 的追踪又与前三者不同。杠杆 / lot、交易日重置口径、新闻 / 隔夜、风险敞口与奖励选项应另设规则族，不混入期货 mini / micro 模型。[1-Step](https://help.fundednext.com/en/articles/17252927-stellar-1-step-account)、[2-Step](https://help.fundednext.com/en/articles/17255124-stellar-2-step-challenge)、[Lite](https://help.fundednext.com/en/articles/17253939-stellar-lite-account)、[Instant](https://help.fundednext.com/en/articles/17253243-stellar-instant-account)。

## 6. Topstep：期货

### 6.1 标准 Trading Combine → XFA

| Combine 规模 | 目标 | EOD 追踪回撤额度 | 最大 mini / micro | 可选 DLL |
| --- | --- | --- | --- | --- |
| 50K | 3,000 | 2,000 | 5 / 50 | 1,000 |
| 100K | 6,000 | 3,000 | 10 / 100 | 2,000 |
| 150K | 9,000 | 4,500 | 15 / 150 | 3,000 |

当前 Combine 一致性为 **55%**，不是常见旧资料中的 50%。最大盈利日过大时提高实际所需利润目标，不是立即判失败；最快两天通过。公式可概括为：所需利润至少为原目标与 `最大盈利日 / 0.55` 两者较大值。[Combine 参数](https://help.topstep.com/en/articles/8284197-trading-combine-parameters)、[2026-09-17 一致性说明](https://help.topstep.com/en/articles/8284208-consistency-at-topstep)。

Combine 的 EOD 追踪底线最高锁至初始余额；盘中包含浮亏触线即违规。XFA 则从 **0 账面余额**开始，50K 档的初始底线为 -2,000，EOD 随盈利抬升至 0；第一次提款后底线强制为 0。50K 是购买力标签，不是 XFA 初始现金。考核盈利不转入 XFA。[MLL](https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit)、[XFA 激活](https://help.topstep.com/en/articles/8284217-express-funded-account-activation)。

### 6.2 XFA 两条提款路径

| 路径 | 资格 | 普通单笔 cap：50K / 100K / 150K |
| --- | --- | --- |
| Standard | 每周期 5 个净利至少 150 的盈利日，不必连续；后续提款另需周期净利为正 | 最多余额 50%，上限 2,000 / 3,000 / 5,000 |
| Consistency | 3 个交易日；最大盈利日不超过本周期利润 40%；提款后重置 | 最多余额 50%，上限 3,000 / 4,000 / 6,000 |

通常 90% 归交易者；核查时有购买 Combine 时加入 DLL 可令后续 XFA cap 翻倍的限时安排，不能把活动 cap 作为永久基础规则。旧用户可能仍有首 10K 利润分成优惠。[提款政策](https://help.topstep.com/en/articles/8284233-topstep-payout-policy)。

XFA 仓位按余额 scaling；最多 5 个活动 XFA。DLL 可选且触发通常为当日暂停，区别于 MLL 使账户失去资格 / 关闭。出金路径在激活时选择，不能随意切换。[XFA 参数](https://help.topstep.com/en/articles/8284215-express-funded-account-parameters)、[DLL](https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account)。

### 6.3 收费、Live 与额外分支

标准 Combine 月费按 50K / 100K / 150K 为 49 / 99 / 199，过关后每个 XFA 一次激活费 149；No Activation Fee 路径月费为 95 / 149 / 229。公开旧销售页仍可能显示不同价格，应采用当前帮助页并保留核查日期。[当前收费页](https://help.topstep.com/en/articles/14289835-topstep-pricing-and-payment-questions)。

Live 由风险团队决定晋级，存在可交易余额与 reserve 分批解锁，不能简单复制 XFA 的 0 起点模型。部分地区另有模拟 Pro Account，最多一个、无 Live 的余额扩展机制，不能因名称 Pro 就标为 live。[Live 参数](https://help.topstep.com/en/articles/10657969-live-funded-account-parameters)、[Pro Account](https://help.topstep.com/en/articles/14645398-what-is-a-pro-account)。

Labs 还展示静态回撤、一次性收费和固定奖励后关闭的两轮挑战。例如 50K Static：目标 4,000、静态回撤 2,000、必选 DLL 1,000、90 天有效、一次费 149。Labs 顶部已说明部分产品改为持续可购，不能把所有 Labs 一概写成停售或仅限量。各个实验产品仍应单独绑定版本和可用状态。[Labs 总表](https://help.topstep.com/en/articles/15520357-topstep-labs)。

此外，整体仓位上限之外还有按品种 / 波动情况调整的限制；“最大 5 mini”不意味着每个品种均可下 5 手。[风险调整](https://help.topstep.com/en/articles/13613539-risk-adjustments-high-risk-high-volatility)。

## 7. 明确保留的冲突与待核实项

| 项目 | 当前证据 | 对后续模板的处理建议 |
| --- | --- | --- |
| Apex Legacy 销售状态 | 帮助总则称 3 月停售；官网及独立促销页显示限时回归 | 标记“官网展示限时可购；帮助总则未同步”，不推测截止日期 |
| LucidBlack | 首页列商品，帮助中心称 Legacy | 保留独立产品族，销售状态不由 Legacy 名称推断 |
| LucidDaily 配置 | 旧摘要常写 50% / 四种组合；最新配置列 40% / 50%，实际八种组合 | 新账户参考最新配置，旧账户不追溯覆盖 |
| Lucid 转 live | 部分旧产品文案称若干次提款后转 live；新总则涉及风控审核 | 区分达到审核资格、审核通过、实际转入三个事件 |
| FundedNext MLL 锁定文案 | 部分简表将“锁定底线值”与“余额达到何值停止追踪”的措辞混用 | 已确认底线锁定数值；实现前另核对专门 MLL 页及示例，不把底线直接当触发余额 |
| 提款操作时点 | On Demand / Daily 文案之外，仍有已开仓、当日交易、审批等待等限制 | 出金额度与申请时点分别建模 |
| 价格 / 活动 / 地区 | 不同购买次数、附加项、优惠、可购地区改变价格和资格 | 本报告不确认个别用户结账资格，不固化促销价 |
| 日切与夏令时 | 官方分别使用美东 / 芝加哥交易时段；不是北京时间自然日 | 未来使用产品交易日历和具名时区；逐项核对节假日与强制平仓时刻 |

对应证据见各产品段落链接。未确认内容不应补成“默认无约束”。

## 8. 对本项目后续账户类别的初步启示

以下为根据调研作出的工程推论，不是任何公司的官方规则，也不是本轮已实施的设计。

1. **保留普通模拟账户，再增加规则模板。** 模板身份至少包含公司、市场、产品、规模、阶段、平台、规则版本、购买时选项。训练 / 实盘重演仍是会话模式，与账户是否 funded 是不同维度。
2. **分开名义购买力、账面余额、风险底线。** Topstep XFA 的 0 起点直接说明，单一 `initialCapital` 无法表达所有产品；0 起点账户也不能沿用以峰值余额作分母的回撤百分比作为合规判断。
3. **将回撤高水位更新与违规检查分开。** 支持静态、EOD、盘中高水位；分别配置浮盈浮亏口径、封顶底线、首次提款后的变化，以及触及 / 跌破的边界。
4. **分开硬失败、暂停、拒单、奖励资格不足。** DLL 暂停、MLL 失败、超仓拒单、一致性暂不能提款、违规利润扣除，是不同事件与状态。
5. **日统计与提款周期独立记录。** 需要交易日净利、最高盈利日、合格日、Benchmark Day、累计 / 周期利润、提款次数与剩余额度；有的统计提款后重置，有的跨周期保留。
6. **事件必须能重演。** 日切、提款扣款、底线锁定、仓位 tier 变动、强制平仓、晋级和结项都需与行情推进同步，不能只在页面上计算资格。
7. **先做代表性模板，避免一次复制全部商业套餐。** 优先候选：普通账户、EOD 考核、Intraday 考核、EOD funded、Intraday funded、直通 funded、静态回撤；公司的特殊资格作为模板参数。CFD 两阶段可另开产品族。

与现有代码的关联：[`PaperAccountConfig`](../../lib/paper-trading/types.ts) 目前主要是初始资金、币种与费率；[`engine.ts`](../../lib/paper-trading/engine.ts) 已有源 K 线内部价格路径，但权益峰值 / 百分比回撤在该根收盘结算。今后若做盘中触线，需在既有内部路径上检查并处理风险事件，不能只拿收盘权益判断，也不能在切换显示周期时改变结果。OHLC 路径是回放假设，不等价于真实逐笔顺序，模拟精度需据数据粒度说明。

建议后续先确定要模拟“考核通关”“funded 生存”“提款能力”中的哪些目标，再把本报告中的候选规则收敛成正式需求。本轮尚未选定实现范围。

## 9. 四项出金资格条件复核

复核日期：2026-10-23。由原两位 gpt-6-luna 调研子代理分别复查 Lucid / Apex、FundedNext Futures / Topstep，主代理核对关键原文。仅比较期货模拟 funded / PA / XFA 出金账户，不把考核阶段或 CFD 要求混入本表。

本次“统一要求”的判断口径为：四家所比较出金产品均要求该项。仅部分公司、部分产品或某条提款路径要求，不算统一。数值不同与条件是否存在分别判断。

“普通交易日”仅要求有成交；“合格盈利日”还有单日净利门槛。5 个合格盈利日本身包含 5 个不同交易日，不能再叠加另一套普通交易日计数。buffer、最低提款额、一致性公式隐含的盈利需求，均不自动变成独立周期利润目标。

### 9.1 机构与账户类别对照

| 机构 / 出金账户 | 最少普通交易日 | 合格盈利日 | 独立周期最低净利润 | 一致性 |
| --- | --- | --- | --- | --- |
| LucidPro simulated funded | 无独立要求 | 无 | 25K / 50K / 100K / 150K：250 / 500 / 750 / 1,000 | 当前 40%；旧版本 35% |
| LucidFlex simulated funded | 无独立要求 | 每周期 5 天；按规模每天至少 100 / 150 / 200 / 250 | 每周期净利为正，官方举例哪怕 1 | 无 funded 一致性，购买时 40% / 50% 属于考核 |
| LucidDaily simulated funded | 无 | 无 | 上次提款后净利为正，另有 buffer | 无 funded 一致性 |
| LucidDirect simulated funded | 无 | 无 | 首轮按规模 1,500 / 3,000 / 6,000 / 9,000；后续 1,250 / 2,500 / 3,500 / 4,500 | 20% |
| LucidBlack Legacy funded | 官方明确无交易日要求 | 无 | 25K / 50K / 100K：1,500 / 3,000 / 4,500；bonus 另计 | 40% |
| Apex 新版 EOD PA | 5 个合格日，不另加普通日计数 | 5 天；25K / 50K / 100K / 150K 每日净利至少 100 / 250 / 300 / 350 | 无独立固定周期利润目标；有 safety net 与最低请求余额 | 最大盈利日严格小于周期利润 50% |
| Apex 新版 Intraday PA | 5 个合格日，不另加普通日计数 | 5 天；按规模每天至少 100 / 200 / 250 / 300 | 同 EOD，无独立固定周期利润目标 | 严格小于 50% |
| Apex Legacy PA | 每周期 8 个交易日 | 8 天中至少 5 天净利 ≥50 | 无统一固定周期目标；缓冲 / 提款额 / 一致性另计 | 常见旧版 30%，适用范围按 Legacy 版本 |
| FundedNext Futures Flex funded | 无独立要求 | 5 Benchmark Days；50K / 100K 每日 ≥200，150K ≥250 | 500 | 无 |
| FundedNext Futures Legacy funded | 无独立要求 | 5 Benchmark Days；25K 每日 ≥100，50K / 100K ≥200 | 500 | 无 |
| FundedNext Futures Rapid Pro funded | 规则称一致性至少需 3 天；不另当成明确的 3 个有效交易日计数器 | 无 Benchmark Day / 合格盈利日计数 | 500 | 40% |
| FundedNext Futures Rapid Daily funded | 无 | 无 | 500，另有 buffer | 无 |
| FundedNext Futures Direct 50K | 无 | 无 | 官方明确无独立 Profit Goal；800 是最低提款额 | 20% Perpetual；历史最高盈利日跨周期保留 |
| FundedNext FNL:003 Labs 50K | 无 | 无 | 未列独立周期目标；buffer 之上至少可提 800 不等于该字段 | 20% Perpetual |
| Topstep XFA Standard | 不另设普通日计数 | 每周期 5 天，日净利 ≥150 | 首次提款豁免；后续较上次提款须净赚至少 0.01 | 无 |
| Topstep XFA Consistency | 每周期至少 3 天，每天至少 1 笔，不要求当天盈利 | 无 | 无另列固定金额目标；一致性计算需要正净利润 | 40% |

Lucid 来源：[Pro 提款](https://support.lucidtrading.com/en/articles/12890092-lucidpro-payouts)、[Pro 版本](https://support.lucidtrading.com/en/articles/12890109-lucidpro-consistency-percentage)、[Flex 提款](https://support.lucidtrading.com/en/articles/12945796-lucidflex-payouts)、[Flex 配置适用阶段](https://support.lucidtrading.com/en/articles/16226050-lucidflex-customization)、[Daily 提款](https://support.lucidtrading.com/en/articles/15997266-luciddaily-payouts)、[Daily funded](https://support.lucidtrading.com/en/articles/15997244-luciddaily-funded-account)、[Direct 提款](https://support.lucidtrading.com/en/articles/12890164-luciddirect-payout-objectives)、[Black funded](https://support.lucidtrading.com/en/articles/13424896-lucidblack-funded-account)、[Black 提款](https://support.lucidtrading.com/en/articles/13424897-lucidblack-payout-objectives)。

Apex 来源：[EOD PA 提款](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/)、[Intraday PA 提款](https://apextraderfunding.com/help-center/uncategorized/intraday-trailing-drawdown-payouts/)、[Legacy PA 提款](https://apextraderfunding.com/help-center/legacy-payouts/legacy-pa-payout-parameters/)。

FundedNext Futures 来源：[Flex funded](https://helpfutures.fundednext.com/en/articles/17229848-fundednext-futures-flex-fundednext-account-all-rules)、[Legacy funded](https://helpfutures.fundednext.com/en/articles/17229581-fundednext-futures-legacy-fundednext-account-all-rules)、[Rapid Pro funded](https://helpfutures.fundednext.com/en/articles/17229713-fundednext-futures-rapid-pro-fundednext-account-all-rules)、[Rapid Daily funded](https://helpfutures.fundednext.com/en/articles/17229779-fundednext-futures-rapid-daily-fundednext-account-all-rules)、[Direct 当前规则](https://helpfutures.fundednext.com/en/articles/17430065-fundednext-futures-direct-account-all-rules)、[FNL:003 奖励](https://help.fundednext.com/en/articles/16847913-what-are-the-requirements-for-requesting-a-performance-reward-on-the-fundednext-futures-fnl-003-50k-instant-account)。

Topstep 来源：[XFA 两条路径](https://help.topstep.com/en/articles/8284215-express-funded-account-parameters)、[提款政策](https://help.topstep.com/en/articles/8284233-topstep-payout-policy)。Pro 模拟分支沿用 Standard，Labs 各产品另行规定，不能据此推出全公司统一门槛。[Pro](https://help.topstep.com/en/articles/14645398-what-is-a-pro-account)、[Labs](https://help.topstep.com/en/articles/15520357-topstep-labs)。

### 9.2 对简化模板的处理

四项均不满足“统一要求”的标准，因此按用户指示从[设计方案第 3.4 节](../replay/prop-practice-account-design.md#34-出金资格与额度)全部删除，不保留可关闭开关、默认门槛或隐藏校验。同步移除出金周期计数器、周期利润公式与示例资格。

考核阶段的交易日、盈利日和一致性不在截图指定的本次删除范围内。出金仍保留申请金额、可提比例、上限、buffer、分成和首次出金底线等现有配置，也保留用户已确认的“出金后当日暂停、次日恢复”。

删除是本项目选择简化练习模型，不表示上述公司不存在这些真实要求；本模板将不完整复刻有这些门槛的产品。
