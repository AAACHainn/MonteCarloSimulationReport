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
    datasetId: id, startSequence: 0, currentSequence: -1, intervalMs: 1000, playbackRate: 100, displayIntervalSeconds: 300,
  } });
  await prisma.paperTradingSession.create({ data: {
    datasetId: id, initialCapital: 100000, currency: "USD", peakEquity: 100000, lastProcessedSequence: -1,
  } });
  const port = await freePort(), browserPort = await freePort();
  const origin = "http://localhost:" + port;
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--port", String(port)], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
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
      const path = String(input), advance = path.includes("/replay/advance");
      if (advance && window.__qa.conflictNext) {
        window.__qa.conflictNext = false;
        init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), expectedVersion: 1 }) };
      }
      const start = performance.now();
      if (advance) window.__qa.inFlight++;
      try {
        const response = await originalFetch(input, init);
        if (path.includes("/api/")) {
          const body = await response.clone().json();
          window.__qa.records.push({ path, status: response.status, request: init?.body ? JSON.parse(init.body) : null, body, ms: performance.now() - start });
        }
        if (advance && window.__qa.delayNext) {
          window.__qa.delayNext = false;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (advance && window.__qa.dropNext) {
          window.__qa.dropNext = false;
          throw new TypeError("Simulated lost advance response");
        }
        return response;
      } finally { if (advance) window.__qa.inFlight--; }
    };
  };
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "(" + instrument.toString() + ")()" });
  await send("Page.navigate", { url: origin + "/market-replay/" + id });
  await until(() => evaluate("!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一根')) && window.__qa.records.some(r=>r.path.endsWith('/paper-session'))"), "replay UI");
  const step = (count = 1) => evaluate("(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一根'));for(let i=0;i<" + count + ";i++)b.click()})()");
  const currentSequence = async () => (await prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } })).currentSequence;
  await step(30);
  await until(async () => await currentSequence() === 8999 && await evaluate("window.__qa.inFlight === 0"), "30 rapid clicks", 60000);
  const records = await evaluate("window.__qa.records");
  const advances = records.filter((r) => r.path.endsWith("/replay/advance"));
  assert.equal(advances.length, 30);
  assert.ok(advances.every((r, i) => r.status === 200 && r.request.expectedCurrentSequence === i * 300 - 1));
  assert.equal(records.filter((r) => r.path.includes("/bars/window")).length, 1);
  assert.ok(advances.every((r) => r.body.aggregatedBars.length === 1));
  console.log("PASS: 30 rapid clicks, correct sequences, one initial window request");

  await evaluate("for(let i=0;i<5;i++)document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true,bubbles:true}))");
  await until(async () => await currentSequence() === 10499 && await evaluate("window.__qa.inFlight === 0"), "rapid keyboard steps");
  console.log("PASS: 5 rapid keyboard steps");

  async function failureRecovery(flag, expectedSequence) {
    const before = await evaluate("window.__qa.records.filter(r=>r.path.endsWith('/progress') && !r.request).length");
    await evaluate("window.__qa." + flag + " = true");
    await step();
    await until(() => evaluate("window.__qa.records.filter(r=>r.path.endsWith('/progress') && !r.request).length > " + before + " && window.__qa.inFlight === 0"), "recovery fetch");
    await delay(700);
    await step();
    await until(async () => await currentSequence() === expectedSequence && await evaluate("window.__qa.inFlight === 0"), flag + " next click");
  }
  await failureRecovery("dropNext", 11099);
  console.log("PASS: lost response reconciles committed progress and next click works");
  await failureRecovery("conflictNext", 11399);
  console.log("PASS: 409 reconciles account and cursor, next click works");

  await evaluate("(() => {const c=document.querySelector('[aria-label=\"K 线回放图表\"]'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+200,clientY:r.top+100}))})()");
  await until(() => evaluate("!!document.querySelector('[data-testid=\"context-reset-chart-view\"]')"), "reset view menu");
  await evaluate("document.querySelector('[data-testid=\"context-reset-chart-view\"]').click()");
  assert.equal(await currentSequence(), 11399);
  assert.equal(await evaluate("!!document.querySelector('[data-context-menu]')"), false);

  await evaluate("window.__qa.delayNext=true;[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='播放').click()");
  await until(() => evaluate("window.__qa.inFlight > 0"), "autoplay in-flight");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='暂停').click()");
  await until(() => evaluate("window.__qa.inFlight === 0"), "paused request completes");
  await delay(400);
  assert.ok(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='播放')"));
  const paused = await currentSequence();
  await delay(500);
  assert.equal(await currentSequence(), paused);
  const auto = await evaluate("window.__qa.records.filter(r=>r.path.endsWith('/replay/advance')).at(-1)");
  assert.equal(auto.request.displayIntervalSeconds, 300);
  assert.equal(auto.request.count, 1);
  assert.equal(paused, 11699);
  console.log("PASS: autoplay advances a complete displayed 5m candle, preserving source matching");
  console.log("PASS: pause during an in-flight playback request stays paused");
  assert.deepEqual(exceptions, []);
  const progress = await prisma.replayProgress.findUniqueOrThrow({ where: { datasetId: id } });
  const session = await prisma.paperTradingSession.findUniqueOrThrow({ where: { datasetId: id } });
  assert.equal(progress.currentSequence, session.lastProcessedSequence);
  assert.equal(session.version, session.lastProcessedSequence + 2);
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
