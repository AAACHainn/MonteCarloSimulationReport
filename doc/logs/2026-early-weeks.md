# 早期开发周报：2026-05-28 至 2026-10-04

[返回目录](README.md) · [近期开发日志](2026-10.md) · [完整提交索引](commits.md)

以下按北京时间的自然周归纳，共 88 条提交、13 个有提交的自然周。合并提交也保留在关联记录中，但不重复视为新增功能。周标题覆盖完整自然周，实际首条记录始于 5 月 28 日。

<a id="week-2026-05-25"></a>

## 2026-05-25 至 2026-05-31：建立蒙特卡洛分析与交易记录基础

- 建立 Next.js、TypeScript、Tailwind、Prisma / SQLite 和 Vitest 项目骨架，形成 CSV 交易样本导入、蒙特卡洛计算、统计与报告展示的首版流程。
- 加入交易记录功能，完善页面展示、中文文案、README 和 Git 忽略规则。
- 纳入 MIT 许可证及远程仓库合并记录；忽略本地 Codex 环境配置，区分项目源码与本机配置。

关联提交（8 条）：[40a533a](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/40a533a229f78757cda47aacdf6efc55081773d0)、[2dd5cb6](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/2dd5cb6bf28a9c9c15ed5ec7eda7b82356c1095a)、[99d1e73](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/99d1e739482a2da65233084e70887733cf51ceba)、[219979e](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/219979e5a3888be231482b4791db51813026da51)、[a39e352](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/a39e352c3a768d53a16ee34fa9721cdfa91e5a8f)、[93925e7](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/93925e7e541ec91ea4e1b3e1541245bff6d3a7fb)、[e2c1f04](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e2c1f04aee99bb1d42d7f2e95d74806a7b7dbcbd)、[fb0c077](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/fb0c077353111a9a5b0dd76661dd56e23272f106)。

<a id="week-2026-06-01"></a>

## 2026-06-01 至 2026-06-07：部署与交易日志展示

- 交易截图改用与交易品种相关的命名，便于识别记录与图片。
- 增加 Docker 部署配置和 v0.1 生产镜像配置，通过发布分支合并进入 `main`。
- 优化交易记录页面，并修复筛选框交互问题。

关联提交（6 条）：[c8224bc](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/c8224bc2f6ddf0d9341c878b39c1207a348f5cc8)、[55ae712](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/55ae712d293b919d77cc9f7a23f71eb8d672b14b)、[1b482b8](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/1b482b8b8ad9adcff0efa0d46fef7e1ad27b5649)、[7748a0d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/7748a0d8ed4ebf16e7cd328d5c1b3eb9230280e6)、[7f3035d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/7f3035db0b8f7fc990b8ce314aaa3753289c9538)、[59bae0a](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/59bae0a1a2e3dceb9084790dce0a12ff56598d0c)。

<a id="week-2026-06-08"></a>

## 2026-06-08 至 2026-06-14：交易日志编辑与多选筛选

- 增加交易日志编辑能力，统一卡片操作按钮的位置和呈现方式。
- 优化日志查看页面，改善阅读和编辑入口。
- 策略筛选支持多选，减少反复切换单一策略的操作。

关联提交（3 条）：[270ed40](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/270ed4041a69bcef39c71158029c5ad81b22af39)、[520bc1d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/520bc1dec1f2e4b006bae1ec8010e3f6f4d0c8f2)、[e1347bb](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e1347bb4595e2dcf4bc2a553cd397b242df2de09)。

<a id="week-2026-07-06"></a>

## 2026-07-06 至 2026-07-12：筛选控件修复

- 修复日期筛选窗口被其他界面覆盖的问题，并改进日期选择操作。
- 优化实际 R 倍数筛选。
- 修复日期控件的其他交互问题，完善日志检索体验。

关联提交（4 条）：[460b9db](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/460b9db22be3d69f72a2e5c67f6e64dd67b35f4c)、[4647823](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/46478239550e66deede34862a23791c0b6566cf0)、[a284b89](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/a284b89df17e5fbc3017213ba8cfaae5202e4f34)、[36ff374](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/36ff374778469b7f0be20f89af439e5f453a9b2e)。

<a id="week-2026-07-13"></a>

## 2026-07-13 至 2026-07-19：策略代码与导入

- 为交易记录增加策略代码字段。
- 优化导入流程，补充策略代码相关处理。
- 调整策略代码的识别与判断逻辑，使录入和导入使用更一致的规则。

关联提交（3 条）：[758bf56](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/758bf567210e07190284c91369e6b000afa83e05)、[5582f61](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/5582f61ff3aa5b17dfffe74f3059cf777ea65a85)、[83ef8d7](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/83ef8d742cdef34e26c75a20e680c7b18014965a)。

<a id="week-2026-07-20"></a>

## 2026-07-20 至 2026-07-26：图片浏览、标签与快捷筛选

- 增加交易记录浏览模式，改善按记录切换图片的体验。
- 建立标签体系，增加快捷代码筛选功能。
- 修复图片替换问题，使截图维护与浏览切换更可靠。

关联提交（5 条）：[aa3b535](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/aa3b5357552051bfa4fb1a5eab6e2d169ec056ea)、[e64051f](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e64051febad9c3220ec2806125cd5b78b4d7a9d6)、[f3706b6](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/f3706b63a1fe281363d0d13115aad6cd44a266a8)、[f400a3d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/f400a3d4bc46e6398061ed02a7e1880f55ad3388)、[79912ee](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/79912ee465c8d8b79074ade80c1f20cde290eb8b)。

<a id="week-2026-07-27"></a>

## 2026-07-27 至 2026-08-02：SQN 统计

- 增加 SQN 统计，为交易系统表现评估补充指标。
- 本周只有一条相关提交，不扩展推断其他统计功能或未记录的开发活动。

关联提交（1 条）：[9ef6885](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/9ef688518f3753eb32ec4a7fd47d05daa9402d3f)。

<a id="week-2026-08-24"></a>

## 2026-08-24 至 2026-08-30：行情回放与模拟交易首版

- 增加 K 线回放功能，项目从交易记录与分析扩展到历史行情训练。
- 接入模拟交易，建立回放与交易操作的基础流程。
- 增加多周期聚合，为不同显示周期的图表展示提供基础。

相关历史背景见[早期聚合与回放实现记录](../../docs/development-history-2026-08-30.md)。

关联提交（3 条）：[39b7d49](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/39b7d492423f3c483b8d3aa684acc382092d5fde)、[d714d03](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/d714d031bdc0e6653bbef50932e29ac61116529e)、[43dd812](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/43dd81285b74be766b312eb0dafbf154d1ed8614)。

<a id="week-2026-08-31"></a>

## 2026-08-31 至 2026-09-06：下单与播放体验

- 优化模拟交易的下单功能。
- 优化 K 线播放性能，减少回放过程中的等待和重复处理。

关联提交（2 条）：[5089562](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/5089562d6e23bfc36ecde65fb3a7ea61b833d986)、[9f69f54](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/9f69f54fb18a682da8690787922688fdf62184dc)。

<a id="week-2026-09-07"></a>

## 2026-09-07 至 2026-09-13：回放工具、行情导入与 UI 体系

- 持续优化播放与聚合，支持 Databento CME 期货行情导入；增加持久化导入进度及独立导入 worker 等处理。
- 增加测量、趋势线和斐波那契回撤工具，调整重新选择起点的流程。
- 重构回放模块，增加显示时区选项和行情编辑入口；补充成交量显示开关、ABR 与 Bar Count。
- 开发回放交易日志和图表标注，逐步完善日志与图表的关联。
- 提取基础数据管理模块，建立统一 UI 规范。

关联提交（21 条）：[68ed2cc](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/68ed2cc675094ad1fcf21322efb3d1f14f8ceae0)、[0a4b74b](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/0a4b74b6c03e4b3a6db3e070bbc5d11a441d2461)、[9590ee2](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/9590ee295fc3e0df688389af8f24df0427cc99fe)、[eb4c3f4](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/eb4c3f4b8e48bb0414da3683810bc6f1c8dcc12e)、[0c92460](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/0c9246017a9d7c9cbf4bad4f7450b1331516b185)、[9ae2232](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/9ae22320f89f386f08287d0f77dcf37b529dbd11)、[a4ca181](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/a4ca181cf021584ef327432085c8a8d716e9a67f)、[6a1d9b1](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/6a1d9b16aa82fb40c8b74d5f420261c71b8bbae1)、[5459caf](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/5459cafde00adf5d10dfb6f082532644892b8d77)、[55faa33](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/55faa3327ca946c0d0c5cb3f0bfb3db28dfe994f)、[e9c054a](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e9c054a65722695534e9771dc937a49b2a68e831)、[2c512b4](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/2c512b494930387280af34024e6f3bcbfe57623e)、[3a3270d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/3a3270df203a3609efd36fd9efa82be193a8304e)、[9626eee](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/9626eee15bc3097cc8ef3b6e4697f271819b672d)、[45f8ba7](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/45f8ba756427b62265d5a90a4da5ed4647da9703)、[68edebe](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/68edebe10670ff90d67496936b38d720d43c6128)、[e2fef04](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e2fef047f7fd3af3a7111cbd04e98c8006d46c23)、[a4d5f9d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/a4d5f9d3b3fb29395024430656c072b9fa13318e)、[0a8948d](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/0a8948d367cfa821ad4d3bac5d3714bf4e005237)、[5d50455](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/5d50455de15593f6d10833fea28174d4a43d49dd)、[807f160](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/807f1601c284c3f8d713143ebbcf08cf445caf75)。

<a id="week-2026-09-14"></a>

## 2026-09-14 至 2026-09-20：历史复盘隔离、日志检索与回放稳定性

- 优化 K 线加载和 Bar Count 性能；拆分回放窗口缓存、播放生命周期和账户运行逻辑，整理历史窗口读取路径。
- 增加交易 Setup 填写，建立独立历史回放页面，并优化回放可视范围、交易标注及下单点差相关显示。
- 改造历史日志的会话管理、统计面板、表达式筛选与多条件筛选；增加交易理由管理，完善标签与基础数据维护。
- 增加 K 线倒计时，继续调整回放日志展示。

其中 `a8ce14b` 的标题包含“重构计划”，实际提交同时包含窗口服务、缓存及生命周期代码调整，因此按已提交的实现归纳，而不只记为文档计划。

关联提交（16 条）：[15c9c9a](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/15c9c9aa592ad21a7d815aa635baa60db14c44d9)、[ff3bc08](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/ff3bc0820d10fe4d5ddd9770b22c5d2117f638fc)、[1ec4421](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/1ec44215b93c18ea120a6ab70cc218cdf2c914ba)、[869abea](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/869abeaa31df32de7174caed2dc7c66346c23de3)、[3d4f5d4](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/3d4f5d45e2df0ad4e5df07b237405dd8c58dbe94)、[8e25876](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/8e2587611bdfbd1877de2720ebb6d61adece7a6c)、[e949af2](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e949af2a5a590e1c2eaac3931f8772cec8634a69)、[4e86d33](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/4e86d338b0953d6a8f30fa7919ddc1ed7e5ab106)、[a0e03ac](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/a0e03accc3113120affe7995709d6b44426ed74a)、[60920f7](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/60920f76af537455001cccf15143f6c74b0ed8a6)、[765dc13](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/765dc13078f5c433a707d9ae7031b1ed53ba7897)、[7a79d6f](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/7a79d6f43010955ca3b69d2b54c1ff3636ee7914)、[6d12151](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/6d1215150d866130886c17429b98d63835a0d328)、[a8ce14b](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/a8ce14bb0f35349253dcc24590d2036b859c223c)、[0da5401](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/0da540154d37e0ef43548b0d755ba55b664d089d)、[e18b2ed](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e18b2ed9c01b2fe10f96c7fd2e8012e7fe8c936b)。

<a id="week-2026-09-21"></a>

## 2026-09-21 至 2026-09-27：快捷操作、导出与绘图映射

- 优化历史日志表格显示和列宽处理，增加回放日志 Excel 导出。
- 增加播放快捷键，完善自动暂停与恢复提示；指标设置抽取为普通页和历史页共用弹窗。
- 优化绘图与聚合 K 线的映射、测量功能及显示周期快捷输入，调整限价单与风险计算相关交互。
- 增加图表元素显隐控制与复盘列，修正训练统计横坐标。
- 更新 README，使使用说明与持续增加的功能保持一致。

关联提交（11 条）：[f54eba8](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/f54eba87eb53ce87b78318a53b0391bc98add611)、[3f281dc](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/3f281dc6ac0a794c30363438cf462f7607c878fe)、[586e40c](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/586e40c689b9257aaff26efefcdaa2a4854d55fe)、[c514166](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/c51416627877e581ee7da3b956574124d5523bcf)、[7a3d489](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/7a3d489ef142bc55f6067dc56ff69edbfe1644eb)、[6b51f19](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/6b51f1981ce28e29c6f4447913d665cc856003f9)、[be7e475](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/be7e47593eafd67e642393f430589f52ad215eeb)、[87234d5](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/87234d5261ff146e6854aca535593202302a8bda)、[f38a298](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/f38a298f733daefef6fc8f57bd79ec5b63942e0f)、[b0296a6](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/b0296a6c4e1c26cb6f5b3d4443305fb595939861)、[d37119c](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/d37119c7f6d829188cbe0ae94f61591df3bbef2c)。

<a id="week-2026-09-28"></a>

## 2026-09-28 至 2026-10-04：统计口径与图表显示

- 斐波那契设置改为只检查启用层级的重复值，避免未启用层级干扰保存。
- 训练统计按当前会话的 FIFO 开平配对日志逐条统计，并继续调整交易统计口径与展示。
- 增加网页全屏按钮和网格显隐选项，改善图表工作区的阅读空间。

关联提交（5 条）：[e858611](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e858611c31371409d9749eb8dd1ecc5931e9a654)、[66fa090](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/66fa090547c3c73c0f4dbd4be5b8515c60d3d8a7)、[e46d0a3](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/e46d0a33e29db926353a5d1308104433eda1a9ab)、[6f21cf7](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/6f21cf7e03c495d5f62c799111ddd1b1aeb0cd11)、[59cc194](https://github.com/AAACHainn/MonteCarloSimulationReport/commit/59cc194058ad91fdc03b039e00dc65098c1baa60)。

本阶段结束后的开发记录转为[近期按天记录](2026-10.md)。
