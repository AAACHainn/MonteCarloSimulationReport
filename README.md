# 交易系统分析台

交易系统分析台是一个面向个人交易者的本地 Web 应用。它用于记录逐笔交易、管理历史样本，并通过有放回 Bootstrap 抽样运行蒙特卡洛模拟，帮助用户分析交易系统的收益分布、回撤风险、爆仓概率和最大连亏。

当前版本定位为单用户本地使用的 MVP，不包含登录、权限管理、多租户隔离和云端部署。

## 核心功能

### 交易日志

- 按账户创建独立交易日志。
- 记录日期、品种、策略、入场价、止损价、风险额、目标价和平仓价。
- 自动计算实际 `R-multiple`。
- 为每笔交易保存截图，支持预览和删除确认。
- 使用 ZIP 导出或导入日志备份。
- 将日志交易直接作为蒙特卡洛模拟样本。

### 数据集与 CSV 上传

- 创建交易数据集并上传历史成交记录。
- 支持以下 CSV 字段：

```text
date,symbol,direction,pnl,riskAmount,rMultiple,note
```

- 如果存在有效的 `rMultiple`，直接使用该值。
- 如果缺少 `rMultiple`，但存在有效的 `pnl` 和非零 `riskAmount`，自动计算：

```text
rMultiple = pnl / riskAmount
```

### 蒙特卡洛模拟

- 使用有放回 Bootstrap 抽样生成多轮权益曲线。
- 支持固定风险、复利和阶梯复利三种资金管理模式。
- 支持配置初始资金、每笔风险比例、模拟次数、每轮交易数和破产线。
- 输出盈利概率、爆仓概率、最终权益统计、最大回撤、最大连亏和分位数权益曲线。
- 保存模拟历史，便于后续查看报告。

## 技术栈

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui 风格本地组件
- Prisma ORM
- SQLite
- Recharts
- Zod
- csv-parse
- Vitest
- pnpm

## 本地运行

### 使用 Docker Compose 开发

项目可以在 WSL 内使用 Docker Compose 启动，无需在 WSL 中额外安装 Node.js 或 pnpm。

首次启动或依赖变更后执行：

```bash
docker compose up --build -d
```

查看启动日志：

```bash
docker compose logs -f app
```

停止容器：

```bash
docker compose down
```

重新构建并启动：

```bash
docker compose up --build -d
```

浏览器访问：

```text
http://localhost:3001
```

Compose 默认将宿主机的 `3001` 端口映射到容器内的 `3000` 端口。如果需要使用其他宿主机端口，可以在启动时设置 `APP_PORT`，例如：

```bash
APP_PORT=8080 docker compose up --build -d
```

局域网内其他设备可以通过 `http://<宿主机 IP>:3001` 访问。Compose 默认以开发模式运行 Next.js，并挂载当前源码目录以支持热更新。依赖和 `.next` 缓存保存在 Docker 命名卷中。SQLite 数据库仍保存在 `prisma/dev.db`，交易截图仍保存在 `storage/`；执行 `docker compose down` 不会删除这些业务数据。

### 使用生产镜像部署

发布镜像使用生产模式运行 Next.js，并在容器启动时自动执行已提交的 Prisma 迁移。拉取并启动 `v0.1`：

```bash
docker pull sudongpojiaozi/monte-carlo-simulation-report:v0.1
docker compose -f compose.prod.yaml up -d
```

浏览器访问：

```text
http://localhost:3001
```

生产 Compose 默认使用两个 Docker 命名卷：

- `app_data`：保存 SQLite 数据库 `/data/dev.db`
- `app_storage`：保存交易截图 `/app/storage`

执行 `docker compose -f compose.prod.yaml down` 不会删除业务数据。升级镜像后，重新拉取并启动：

```bash
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d
```

如需调整宿主机端口，可以设置 `APP_PORT`：

```bash
APP_PORT=8080 docker compose -f compose.prod.yaml up -d
```

### 直接使用本地 Node.js

### 1. 安装依赖

```powershell
corepack pnpm install
```

### 2. 配置环境变量

在项目根目录创建 `.env`：

```env
DATABASE_URL="file:./dev.db"
```

### 3. 初始化数据库

常规方式：

```powershell
corepack pnpm prisma migrate dev
```

如果当前环境无法运行 Prisma migrate，可以使用 SQLite 初始化脚本：

```powershell
corepack pnpm run db:init-sqlite
```

### 4. 启动开发服务器

```powershell
corepack pnpm dev
```

访问：

```text
http://localhost:3000
```

## 验证

```powershell
corepack pnpm lint
corepack pnpm test
corepack pnpm run build
```

如果 Windows 下构建时提示 Prisma query engine DLL 被占用，请先停止正在运行的开发服务器，再重新执行构建。

## 数据存储

- SQLite 数据库文件：`prisma/dev.db`
- 交易截图：本地文件系统
- 模拟报告：通过 Prisma 保存到 SQLite

`.env`、数据库文件、截图、日志、依赖目录和构建产物不应提交到 Git 仓库。

## 页面入口

- `/`：首页
- `/trade-journals`：交易日志
- `/datasets`：交易数据集
- `/simulations/new`：新建模拟
- `/simulations/history`：模拟历史
