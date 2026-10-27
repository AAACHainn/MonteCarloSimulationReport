@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Please install Node.js 22.14+ and reopen this script.
  pause
  exit /b 1
)
set "TPW_INSTALLER_FILE=%~f0"
pushd "%~dp0"
if errorlevel 1 exit /b 1
node -e "const fs=require('node:fs');const s=fs.readFileSync(process.env.TPW_INSTALLER_FILE,'utf8');const m='// __TPW_NODE__';eval(s.slice(s.lastIndexOf(m)+m.length));"
set "TPW_INSTALLER_EXIT=%ERRORLEVEL%"
popd
echo.
pause
exit /b %TPW_INSTALLER_EXIT%

// __TPW_NODE__
// Single-file Windows installer. Node.js is used for UTF-8, dotenv and secure keys.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const net = require('node:net');

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function checkNode(version) {
  const [major, minor] = version.split('.').map(Number);
  ensure(major > 22 || (major === 22 && minor >= 14),
    '需要 Node.js 22.14 或以上版本。请安装后重新打开本脚本。');
}

function prepareConfig(template, original, mode) {
  ensure(['NORMAL', 'FULL'].includes(mode), '同步模式必须为 NORMAL 或 FULL。');
  const defaults = parseEnv(template);
  const existing = parseEnv(original);
  const values = { ...defaults, ...existing };
  const managed = Object.keys(defaults);
  for (const key of managed) {
    const entries = original.match(new RegExp('^\\s*(?:export\\s+)?' + key + '\\s*=', 'gm')) || [];
    ensure(entries.length <= 1, '.env 中的 ' + key + ' 重复，请保留一个定义后重试。');
    if (!values[key]?.trim()) values[key] = defaults[key];
  }
  values.DATABASE_URL ||= 'file:./dev.db';
  values.SQLITE_DRIVER = 'better-sqlite3';
  values.SQLITE_JOURNAL_MODE = 'wal';
  values.SQLITE_SYNCHRONOUS = mode;
  for (const key of ['MARKET_DATA_ENCRYPTION_KEY', 'AI_ENCRYPTION_KEY']) {
    if (values[key]) {
      const bytes = Buffer.from(values[key], 'base64');
      ensure(bytes.length === 32 && bytes.toString('base64') === values[key],
        key + ' 格式无效，需要 32 字节的标准 Base64；请核实原值，脚本不会替换已有密钥。');
    } else {
      values[key] = randomBytes(32).toString('base64');
    }
  }
  let updated = original;
  for (const key of managed) {
    const entry = new RegExp('^[ \\t]*(?:export[ \\t]+)?' + key + '[ \\t]*=.*$', 'm');
    // Managed defaults and generated keys are single-line dotenv values.
    ensure(!/[\r\n"\\]/.test(values[key]), key + ' 含不支持的字符，请使用单行值，路径使用 /。');
    const line = key + '="' + values[key] + '"';
    updated = entry.test(updated)
      ? updated.replace(entry, () => line)
      : updated.trimEnd() + '\n' + line + '\n';
  }
  updated = updated.replace(/\r\n/g, '\n').replace(/\n*$/, '\n').replace(/\n/g, '\r\n');
  return { text: updated, values: parseEnv(updated), managed };
}

function checkOverrides(root, values, managed, inherited) {
  for (const name of ['.env.local', '.env.production', '.env.production.local']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const overrides = parseEnv(fs.readFileSync(file, 'utf8'));
    ensure(!managed.some(key => Object.hasOwn(overrides, key)),
      name + ' 含安装配置的覆盖项。请先合并到 .env 并手动移除重复定义，再重试。');
  }
  for (const key of managed) {
    ensure(inherited[key] === undefined || inherited[key] === values[key],
      '终端或系统环境变量 ' + key + ' 与安装配置冲突，请清除该覆盖后重新打开脚本。');
  }
}

function checkFreshDatabase(database) {
  for (const suffix of ['-wal', '-shm', '.upgrade.lock']) {
    ensure(!fs.existsSync(database + suffix),
      '发现数据库附属文件或升级锁：' + database + suffix + '\n请停止本项目相关进程并按 docs/operations/upgrade.md 核实，不要删除文件绕过检查。');
  }
  if (fs.existsSync(database)) {
    ensure(fs.statSync(database).isFile() && fs.statSync(database).size === 0,
      '发现已有非空数据库：' + database + '\n本脚本仅用于全新安装，不自动升级已有数据库。\n若上次已完成迁移、仅构建失败，可执行 corepack pnpm run build，再执行 corepack pnpm start。\n已有安装的升级请阅读 docs/operations/upgrade.md。');
  }
}

function run(command, root, env) {
  console.log('\n> ' + command);
  // Commands are fixed strings; user paths and values are passed only via cwd/env.
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  ensure(!result.error && result.status === 0,
    '命令执行失败：' + command + '\n请根据上方输出解决问题；脚本已停止后续步骤。');
}

async function checkPort(port) {
  ensure(/^\d+$/.test(String(port)) && Number(port) >= 1 && Number(port) <= 65535,
    'PORT 必须是 1 到 65535 之间的整数。');
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('端口 ' + port + ' 不可用。请停止占用该端口的服务，或在 .env 配置其他 PORT。')));
    server.listen(Number(port), '0.0.0.0', () => server.close(resolve));
  });
}

async function chooseMode() {
  console.log('\n请选择 SQLite 同步模式（两者均使用 better-sqlite3 + WAL）：');
  console.log('  1. NORMAL（默认）：提交时减少磁盘同步，通常更快。');
  console.log('     断电或系统崩溃可能丢失最近已提交的事务；普通应用崩溃不等同于断电。');
  console.log('  2. FULL：每次提交额外同步 WAL，持久性更强，磁盘写入开销更大。');
  console.log('     适合更重视已提交交易记录持久性的场景。');
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await input.question('输入 1 / 2，或直接回车选择 NORMAL：')).trim().toUpperCase();
      if (answer === '' || answer === '1' || answer === 'NORMAL') return 'NORMAL';
      if (answer === '2' || answer === 'FULL') return 'FULL';
      console.log('请输入 1 或 2。');
    }
  } finally { input.close(); }
}

async function main() {
  checkNode(process.versions.node);
  const root = path.dirname(process.env.TPW_INSTALLER_FILE);
  process.chdir(root);
  for (const file of ['package.json', 'pnpm-lock.yaml', '.env.example', 'prisma/schema.prisma', 'lib/sqlite-client.mjs']) {
    ensure(fs.existsSync(path.join(root, file)), '缺少 ' + file + '，请将 install.bat 放在完整项目根目录。');
  }
  console.log('交易训练工作台 · Windows 全新安装');
  console.log('项目目录：' + root);
  console.log('需要已安装 Node.js / Corepack 和可访问依赖仓库的网络；无需管理员权限。');
  console.log('流程：配置环境 → 安装依赖 → 初始化数据库 → 构建 → pnpm start。');
  console.log('已有有效密钥保留；缺失密钥自动生成，不在终端显示。');
  const mode = await chooseMode();
  const envFile = path.join(root, '.env');
  const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const original = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : template;
  const config = prepareConfig(template, original, mode);
  checkOverrides(root, config.values, config.managed, process.env);
  const env = { ...process.env, ...config.values, NODE_ENV: 'production', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' };
  const port = env.PORT || '3000';
  env.PORT = port;
  await checkPort(port);

  console.log('\n[1/6] 检查 Corepack / 安装项目锁定的 pnpm 依赖');
  const probe = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'corepack --version'], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  ensure(!probe.error && probe.status === 0,
    '找不到可用的 Corepack。请安装 Corepack 并重新打开终端后重试。');
  run('corepack pnpm install --frozen-lockfile --prod=false', root, env);

  console.log('\n[2/6] 准备 SQLite 原生模块并生成 Prisma Client');
  run('corepack pnpm run db:prepare-sqlite', root, env);
  run('corepack pnpm prisma generate', root, env);

  // Use the application's authoritative SQLite path rules after dependencies exist.
  const { resolveSqlitePath } = await import(pathToFileURL(path.join(root, 'lib/sqlite-client.mjs')).href);
  const database = resolveSqlitePath(config.values.DATABASE_URL, root);
  checkFreshDatabase(database);
  console.log('\n[3/6] 保存 .env，数据库路径：' + database);
  // Save only after all configuration and existing-database checks succeed.
  fs.writeFileSync(envFile, config.text, { mode: 0o600 });
  console.log('已配置 better-sqlite3 / wal / ' + mode + '，两项独立加密密钥已就绪。');

  // Recheck immediately before the only schema initialization entry point.
  checkFreshDatabase(database);
  console.log('\n[4/6] 应用全新数据库迁移，随后验证 WAL / 同步级别 / 完整性');
  run('corepack pnpm prisma migrate deploy', root, env);
  run('corepack pnpm run db:runtime --integrity', root, env);

  console.log('\n[5/6] 生成生产构建');
  run('corepack pnpm run build', root, env);

  await checkPort(port);
  console.log('\n[6/6] 安装完成，正在启动生产服务');
  console.log('打开 http://localhost:' + port + '（等待 Next.js 显示 Ready）。');
  console.log('保持此窗口打开；按 Ctrl+C 停止服务。');
  console.log('以后启动：在项目目录执行 corepack pnpm start。');
  console.log('请保留 .env 中的两项密钥，以便解密已保存的行情和 AI 凭据。');
  run('corepack pnpm start', root, env);
}

main().catch(error => {
  console.error('\n[安装停止] ' + error.message);
  console.error('已生成的 .env 和数据库会保留，不会自动重置或清理。');
  console.error('若遇到 Prisma DLL 占用，请仅停止本项目相关进程后再重试。');
  console.error('迁移已完成后遇到构建/启动失败：解决上方错误后执行 corepack pnpm run build，再执行 corepack pnpm start。');
  process.exitCode = 1;
});
