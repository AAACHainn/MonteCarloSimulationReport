// Run after pnpm build. Uses an isolated SQLite database, server and headless Chrome.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const folder = await mkdtemp(join(tmpdir(), "replay-browser-"));
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
  const count = 18000;
  await prisma.marketDataset.create({ data: {
    id, name: "Replay browser QA", symbol: "QA", timeframe: "1s", timezone: "UTC",
    sourceIntervalSeconds: 1, barCount: count, startTime: new Date(base), endTime: new Date(base + (count - 1) * 1000),
  } });
  for (let from = 0; from < count; from += 1000) {
    await prisma.marketBar.createMany({ data: Array.from({ length: Math.min(1000, count - from) }, (_, offset) => {
      const sequence = from + offset, close = 100 + Math.sin(sequence / 300);
      return { datasetId: id, sequence, timestamp: new Date(base + sequence * 1000),
        open: close, high: close + 1, low: close - 1, close, volume: 10 };
    }) });
  }
  await prisma.replayProgress.create({ data: {
    datasetId: id, startSequence: 0, currentSequence: -1, playbackRate: 100, displayIntervalSeconds: 300,
  } });
  await prisma.paperTradingSession.create({ data: {
    datasetId: id, initialCapital: 100000, currency: "USD", peakEquity: 100000, lastProcessedSequence: -1,
  } });
  const port = await freePort(), browserPort = await freePort();
  const origin = "http://localhost:" + port;
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--port", String(port)], {
    env: { ...process.env, DATABASE_URL: databaseUrl, REPLAY_QUERY_METRICS: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  await until(async () => (await fetch(origin + "/market-replay/" + id)).ok, "isolated server");
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
  const instrument = () => {
    window.__qa = { records: [], inFlight: 0 };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = String(input), sync = path.includes("/replay/sync");
      const initialProgressLoad = path.endsWith("/progress") && !(init?.method && init.method !== "GET") && !sessionStorage.getItem("qa-progress-delay-used");
      if (sync && window.__qa.conflictNext) {
        window.__qa.conflictNext = false;
        init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), syncVersion: 999999 }) };
      }
      const start = performance.now();
      if (sync) window.__qa.inFlight++;
      try {
        const response = await originalFetch(input, init);
        if (path.includes("/api/")) {
          const body = await response.clone().json();
          window.__qa.records.push({
            path,
            status: response.status,
            request: init?.body ? JSON.parse(init.body) : null,
            body,
            ms: performance.now() - start,
            databaseQueries: Number(response.headers.get("X-Replay-Database-Queries")) || 0,
          });
        }
        if (initialProgressLoad) {
          sessionStorage.setItem("qa-progress-delay-used", "1");
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (sync && window.__qa.delayNext) {
          window.__qa.delayNext = false;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (sync && window.__qa.dropNext) {
          window.__qa.dropNext = false;
          throw new TypeError("Simulated lost sync response");
        }
        return response;
      } finally { if (sync) window.__qa.inFlight--; }
    };
  };
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "(" + instrument.toString() + ")()" });
  await send("Page.navigate", { url: origin + "/market-replay/" + id });
  const currentSequence = async () => (await prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } })).currentSequence;
  await until(() => evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一根'))"), "replay UI");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='播放').click()");
  await delay(100);
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='暂停')"));
  await until(() => evaluate("window.__qa.records.some(r=>r.path.endsWith('/progress'))"), "initial progress snapshot");
  await until(async () => await currentSequence() > -1, "playback after paper snapshot");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='暂停')?.click()");
  await until(() => evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='播放')"), "initial pause");
  console.log("PASS: play before paper snapshot resolves stays playing and advances");
  await evaluate("new Promise(resolve => { const request = indexedDB.deleteDatabase('market-replay-bars-v1'); request.onsuccess = request.onerror = request.onblocked = () => resolve(); })");
  await prisma.$transaction([
    prisma.paperEquityPoint.deleteMany({ where: { session: { datasetId: id } } }),
    prisma.paperFill.deleteMany({ where: { session: { datasetId: id } } }),
    prisma.paperTrade.deleteMany({ where: { session: { datasetId: id } } }),
    prisma.paperOrder.deleteMany({ where: { session: { datasetId: id } } }),
    prisma.paperTradingSession.update({ where: { datasetId: id }, data: {
      lastProcessedSequence: -1, netQuantity: 0, averageEntryPrice: null, realizedPnl: 0,
      totalFees: 0, totalSlippage: 0, peakEquity: 100000, maxDrawdown: 0, version: 1,
    } }),
    prisma.replayProgress.update({ where: { datasetId: id }, data: {
      currentSequence: -1, syncVersion: 0, lastSyncRequestId: null, lastSyncResponse: null,
    } }),
  ]);
  await send("Page.navigate", { url: origin + "/market-replay/" + id });
  await until(() => evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一根')) && window.__qa.records.some(r=>r.path.endsWith('/progress'))"), "replay reset for regression");
  const step = (count = 1) => evaluate("(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一根'));for(let i=0;i<" + count + ";i++)b.click()})()");
  await step(5);
  await until(async () => await currentSequence() === 1499 && await evaluate("window.__qa.inFlight === 0"), "5 rapid clicks", 60000);
  const records = await evaluate("window.__qa.records");
  const syncs = records.filter((r) => r.path.endsWith("/replay/sync"));
  assert.equal(syncs.length, 15);
  assert.ok(syncs.every((r, i) => r.status === 200
    && r.request.confirmedSequence === i * 100 - 1
    && r.request.targetSequence === (i + 1) * 100 - 1));
  assert.equal(records.filter((r) => r.path.includes("/bars/window")).length, 1);
  assert.equal(records.filter((r) => r.path.includes("/bars/chunks")).length, 1);
  console.log("PASS: 5 rapid clicks, 15 bounded syncs, one initial window and one daily source request");

  const coldChunkMs = records.find((r) => r.path.includes("/bars/chunks")).ms;
  await send("Page.navigate", { url: origin + "/market-replay/" + id });
  await until(() => evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一根')) && window.__qa.records.some(r=>r.path.endsWith('/progress'))"), "cached replay UI");
  await step();
  await until(async () => await currentSequence() === 1799 && await evaluate("window.__qa.inFlight === 0"), "persistent cache replay");
  assert.equal(await evaluate("window.__qa.records.filter(r=>r.path.includes('/bars/chunks')).length"), 0);
  console.log(`PASS: cold daily source request ${coldChunkMs.toFixed(1)} ms; persistent IndexedDB hit made 0 source requests`);

  await evaluate("for(let i=0;i<4;i++)document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true,bubbles:true}))");
  await until(async () => await currentSequence() === 2999 && await evaluate("window.__qa.inFlight === 0"), "rapid keyboard steps");
  console.log("PASS: 4 rapid keyboard steps after cache restoration");

  async function conflictRecovery(expectedSequence) {
    const before = await evaluate("window.__qa.records.filter(r=>r.path.endsWith('/progress') && !r.request).length");
    await evaluate("window.__qa.conflictNext = true");
    await step();
    await until(() => evaluate("window.__qa.records.filter(r=>r.path.endsWith('/progress') && !r.request).length > " + before + " && window.__qa.inFlight === 0"), "conflict recovery fetch");
    await delay(700);
    await step();
    await until(async () => await currentSequence() === expectedSequence && await evaluate("window.__qa.inFlight === 0"), "conflict next click");
  }
  await evaluate("window.__qa.dropNext = true");
  await step();
  await until(async () => await currentSequence() === 3299 && await evaluate("window.__qa.inFlight === 0"), "lost response retry");
  const retriedRequestCount = await evaluate("(() => {const ids=window.__qa.records.filter(r=>r.path.endsWith('/replay/sync')).map(r=>r.request.requestId);return Math.max(...ids.map(id=>ids.filter(other=>other===id).length))})()");
  assert.ok(retriedRequestCount >= 2);
  console.log("PASS: lost response retries the same request id without duplicate processing");
  await conflictRecovery(3599);
  console.log("PASS: 409 reconciles account and cursor, next click works");

  await evaluate("(() => {const c=document.querySelector('[aria-label=\"K 线回放图表\"]'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+200,clientY:r.top+100}))})()");
  await until(() => evaluate("!!document.querySelector('[data-testid=\"context-reset-chart-view\"]')"), "reset view menu");
  await evaluate("document.querySelector('[data-testid=\"context-reset-chart-view\"]').click()");
  assert.equal(await currentSequence(), 3599);
  assert.equal(await evaluate("!!document.querySelector('[data-context-menu]')"), false);

  await evaluate("window.__qa.delayNext=true;[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='播放').click()");
  await until(() => evaluate("window.__qa.inFlight > 0"), "autoplay in-flight");
  const persistedDuringDelay = await currentSequence();
  const visibleBeforeDelay = await evaluate("Number((/已揭示\\s*([\\d,]+)/.exec(document.body.textContent)?.[1] ?? '-1').replaceAll(',','')) - 1");
  await delay(300);
  const visibleAfterDelay = await evaluate("Number((/已揭示\\s*([\\d,]+)/.exec(document.body.textContent)?.[1] ?? '-1').replaceAll(',','')) - 1");
  assert.equal(await currentSequence(), persistedDuringDelay);
  assert.ok(visibleAfterDelay > visibleBeforeDelay && visibleAfterDelay > persistedDuringDelay);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='暂停').click()");
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='播放')"));
  await until(() => evaluate("window.__qa.inFlight === 0"), "paused request completes");
  await delay(400);
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='播放')"));
  const paused = await currentSequence();
  await delay(500);
  assert.equal(await currentSequence(), paused);
  const auto = await evaluate("window.__qa.records.filter(r=>r.path.endsWith('/replay/sync')).at(-1)");
  assert.ok(auto.request.targetSequence - auto.request.confirmedSequence <= 100);
  assert.ok(paused > 3699 && paused <= 3799);
  assert.ok(await evaluate("document.body.textContent.includes('形成中')"));
  console.log("PASS: 100x autoplay reveals a forming 5m candle through bounded source batches");
  console.log("PASS: delayed sync does not block visible playback; pause is immediate and then flushes the visible cursor");
  assert.deepEqual(exceptions, []);
  const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } });
  const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } });
  assert.equal(progress.currentSequence, session.lastProcessedSequence);
  assert.equal(session.version, session.lastProcessedSequence + 2);
  const measured = await evaluate("({records:window.__qa.records,frames:performance.getEntriesByName('market-replay-source-frame').map(e=>e.duration)})");
  const allRecords = [...records, ...measured.records];
  const measuredSyncs = allRecords.filter((record) => record.path.endsWith("/replay/sync") && record.status === 200);
  assert.ok(measuredSyncs.every((record) => record.databaseQueries <= 20));
  const sortedFrames = measured.frames.toSorted((a, b) => a - b);
  const p95FrameMs = sortedFrames[Math.max(0, Math.ceil(sortedFrames.length * 0.95) - 1)] ?? 0;
  const databaseQueries = allRecords.reduce((total, record) => total + record.databaseQueries, 0);
  console.log(`MEASURE: ${sortedFrames.length} source batches, p95 ${p95FrameMs.toFixed(2)} ms, max ${(sortedFrames.at(-1) ?? 0).toFixed(2)} ms; ${databaseQueries} Prisma query events`);
  console.log("PASS: no browser exceptions; account, version and cursor remain aligned");
} catch (error) {
  console.error(serverLog.slice(-5000));
  throw error;
} finally {
  socket?.close();
  browser?.kill();
  server?.kill();
  await prisma.$disconnect();
  await delay(500);
  assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep) && basename(folder).startsWith("replay-browser-"));
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
