// Run after pnpm build. Uses an isolated SQLite database, server and headless Chrome.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const folder = await mkdtemp(join(tmpdir(), "append-browser-"));
const databaseUrl = "file:" + join(folder, "qa.db");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolvePort) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
async function until(check, label, timeout = 40000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error("Timed out: " + label, { cause: lastError });
}
let server, browser, socket;
let serverLog = "";
try {
  execFileSync(process.execPath, ["scripts/init-sqlite.mjs"], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe",
  });
  const id = "browser-qa";
  const base = Date.UTC(2026, 8, 1);
  const count = 200;
  await prisma.marketDataset.create({ data: {
    id, name: "Replay browser QA", symbol: "MGC", timeframe: "1m", timezone: "UTC",
    sourceIntervalSeconds: 60, barCount: count, startTime: new Date(base), endTime: new Date(base + (count - 1) * 60000),
  } });
  for (let from = 0; from < count; from += 1000) {
    await prisma.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - from) }, (_, offset) => {
      const sequence = from + offset, close = 100 + Math.sin(sequence / 300);
      return { datasetId: id, sequence, timestamp: new Date(base + sequence * 60000),
        open: close, high: close + 1, low: close - 1, close, volume: 10 };
    }) });
  }
  await prisma.replayProgress.create({ data: {
    datasetId: id, startSequence: 0, currentSequence: 50, playbackRate: 7, displayIntervalSeconds: 60,
  } });
  await prisma.paperTradingSession.create({ data: {
    datasetId: id, initialCapital: 100000, currency: "USD", peakEquity: 100000, lastProcessedSequence: 50,
  } });
  const port = await freePort(), browserPort = await freePort();
  const origin = "http://127.0.0.1:" + port;
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--port", String(port)], {
    env: { ...process.env, DATABASE_URL: databaseUrl, REPLAY_QUERY_METRICS: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  await until(async () => (await fetch(origin + "/market-replay", { signal: AbortSignal.timeout(1500) })).ok, "isolated server");
  browser = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + browserPort, "--user-data-dir=" + join(folder, "chrome"), "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  const targets = await until(async () => {
    const list = await (await fetch("http://localhost:" + browserPort + "/json/list")).json();
    return list.length ? list : null;
  }, "headless browser");
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.id) {
      const handler = pending.get(message.id);
      if (handler) { pending.delete(message.id); if (message.error) handler.reject(message.error); else handler.resolve(message.result); }
    }
  };
  const send = (method, params = {}) => new Promise((resolveMessage, reject) => {
    const id = ++nextId; pending.set(id, { resolve: resolveMessage, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const outputRoot = process.env.QA_SCREENSHOT_DIR;
  const row = (index) => [new Date(base + index * 60000).toISOString(), 100, 102, 99, 101, 5, "MGC"].join(",");
  const file = join(folder, "mgc-new.csv");
  await writeFile(file, ["timestamp,open,high,low,close,volume,symbol", ...[198,199,200,200,202,203].map(row)].join("\n"));
  const click = async (label, insideDialog = false) => {
    const selector = insideDialog ? '[role="dialog"]' : 'body';
    await evaluate("(() => { const button = [...(document.querySelector(" + JSON.stringify(selector) + ")?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === " + JSON.stringify(label) + "); if (!button) throw new Error('Missing button'); button.focus(); button.click(); })()");
  };
  const pageText = () => evaluate("document.body.innerText");
  const assertNoOverflow = async () => assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  const screenshot = async (name) => {
    if (!outputRoot) return;
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(outputRoot, name + ".png"), Buffer.from(shot.data, "base64"));
  };
  await send("Page.navigate", { url: origin + "/market-replay" });
  await until(async () => (await pageText()).includes("追加行情"), "dashboard hydrated");
  await delay(700);
  await click("追加行情");
  await until(async () => await evaluate("Boolean(document.querySelector('#append-file'))"), "append dialog");
  await delay(100);
  assert.equal(await evaluate("document.activeElement.id"), "append-symbol");
  await assertNoOverflow();
  await screenshot("append-desktop");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
  await delay(100); await assertNoOverflow(); await screenshot("append-mobile");
  // Escape returns focus to the card action.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(async () => !(await evaluate("Boolean(document.querySelector('[role=dialog]'))")), "Escape closes dialog");
  assert.equal(await evaluate("document.activeElement.textContent.trim()"), "追加行情");
  await click("追加行情");
  const attach = async () => {
    const document = await send("DOM.getDocument");
    const node = await send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#append-file" });
    await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
  };
  await attach(); await click("追加行情", true);
  await until(async () => (await pageText()).includes("保留缺口并追加"), "gap confirmation", 90000);
  assert.equal((await prisma.marketDataset.findUnique({ where: { id } })).barCount, 200);
  await assertNoOverflow(); await screenshot("append-gap-mobile");
  let pendingJob = await prisma.marketDatasetImport.findFirst({ where: { status: "AWAITING_CONFIRMATION" } });
  assert.equal(JSON.parse(pendingJob.metadata).preview.duplicateRows, 1);
  assert.equal(JSON.parse(pendingJob.metadata).preview.gapCount, 1);
  await send("Page.reload");
  await until(async () => (await pageText()).includes("保留缺口并追加"), "confirmation survives reload");
  await click("取消任务", true);
  await until(async () => !(await evaluate("Boolean(document.querySelector('[role=dialog]'))")), "cancel staged append");
  assert.equal(await prisma.marketDatasetImport.findUnique({ where: { id: pendingJob.id } }), null);
  assert.equal((await prisma.marketDataset.findUnique({ where: { id } })).barCount, 200);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click("追加行情"); await attach(); await click("追加行情", true);
  await until(async () => (await pageText()).includes("保留缺口并追加"), "second gap confirmation", 90000);
  await assertNoOverflow(); await screenshot("append-gap-desktop");
  await click("保留缺口并追加", true);
  await until(async () => (await pageText()).includes("已追加 3 根 K 线"), "append completed", 90000);
  const target = await prisma.marketDataset.findUnique({ where: { id } });
  assert.equal(target.barCount, 203); assert.equal(target.endTime.getTime(), base + 203 * 60000); assert.equal(target.dataVersion, 2);
  assert.equal((await prisma.replayProgress.findUnique({ where: { datasetId: id } })).currentSequence, 50);
  assert.equal((await prisma.paperTradingSession.findUnique({ where: { datasetId: id } })).lastProcessedSequence, 50);
  assert.equal(await prisma.marketDataset.count({ where: { status: "IMPORTING" } }), 0);
  await screenshot("append-success-desktop");
  await click("追加行情");
  await evaluate("document.querySelector('#append-symbol').value = 'ES'");
  await attach(); await click("追加行情", true);
  await until(async () => (await pageText()).includes("文件品种与目标数据集不一致"), "metadata error");
  assert.equal((await prisma.marketDataset.findUnique({ where: { id } })).barCount, 203);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(JSON.stringify({ ok: true, verified: ["desktop/mobile", "keyboard focus/Escape", "upload", "deduplication", "gap preview", "reload", "cancel", "confirmed append", "preserved replay/account", "metadata rejection"], barCount: target.barCount }));
} catch (error) {
  console.error(serverLog); throw error;
} finally {
  socket?.close(); browser?.kill(); server?.kill();
  await prisma.$disconnect();
  await delay(1200);
  const resolved = resolve(folder);
  if (resolved.startsWith(resolve(tmpdir()) + sep) && basename(resolved).startsWith("append-browser-")) await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
