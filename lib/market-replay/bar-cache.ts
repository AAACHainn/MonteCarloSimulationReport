"use client";

import { addCalendarDays, chunkRequestDates } from "./chunks";
import {
  MARKET_CACHE_BUDGET_BYTES,
  MARKET_CACHE_EVICT_TO_RATIO,
  MARKET_DISPLAY_CACHE_BUDGET_BYTES,
  REPLAY_HISTORY_BAR_LIMIT,
  type AggregatedMarketBarData,
  type DisplaySession,
  type MarketBarChunksResponse,
  type MarketBarDayChunk,
  type MarketBarData,
  type MarketDatasetSummary,
} from "./types";

const DATABASE_NAME = "market-replay-bars-v1";
const STORE_NAME = "daily-chunks";
const DISPLAY_STORE_NAME = "display-bars";
const DISPLAY_SCOPE_STORE_NAME = "display-scopes";
const DATABASE_VERSION = 2;
const MEMORY_CHUNK_LIMIT = 14;
const DISPLAY_CACHE_EVICT_TO_RATIO = 0.8;

export type StoredMarketChunk = MarketBarDayChunk & {
  key: string;
  datasetId: string;
  dataVersion: number;
  symbol: string;
  sourceIntervalSeconds: number;
  serializedBytes: number;
  writtenAt: number;
  requestStartDate?: string;
  nextStartDate?: string | null;
};

export type DisplayBarCacheScope = {
  datasetId: string;
  dataVersion: number;
  displayIntervalSeconds: number;
  displaySession: DisplaySession;
  sessionFingerprint: string;
};

type StoredDisplayBar = {
  scopeKey: string;
  timestamp: string;
  bar: AggregatedMarketBarData;
  serializedBytes: number;
};

type StoredDisplayScope = {
  scopeKey: string;
  serializedBytes: number;
  barCount: number;
  accessedAt: number;
};

export function displayBarScopeKey(scope: DisplayBarCacheScope) {
  return [scope.datasetId, scope.dataVersion, scope.displayIntervalSeconds, scope.displaySession, scope.sessionFingerprint]
    .map(encodeURIComponent).join("|");
}

export function marketChunkKey(input: Pick<StoredMarketChunk, "datasetId" | "dataVersion" | "symbol" | "sourceIntervalSeconds" | "tradingDay">) {
  return [input.datasetId, input.dataVersion, input.symbol, input.sourceIntervalSeconds, input.tradingDay].map(encodeURIComponent).join("|");
}

export function selectFifoEvictions(records: Pick<StoredMarketChunk, "key" | "serializedBytes" | "writtenAt">[], budgetBytes: number, targetRatio = MARKET_CACHE_EVICT_TO_RATIO) {
  const ordered = [...records].sort((a, b) => a.writtenAt - b.writtenAt || a.key.localeCompare(b.key));
  let total = ordered.reduce((sum, record) => sum + record.serializedBytes, 0);
  if (total <= budgetBytes) return [] as string[];
  const target = Math.max(0, budgetBytes * targetRatio);
  const evicted: string[] = [];
  for (const record of ordered) {
    if (total <= target) break;
    total -= record.serializedBytes;
    evicted.push(record.key);
  }
  return evicted;
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function serializedSize(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

export class MarketBarCache {
  private memory = new Map<string, StoredMarketChunk>();
  private memoryBars: MarketBarData[] = [];
  private memoryBarsDirty = true;
  private dateInflight = new Map<string, Promise<MarketBarChunksResponse>>();
  private nextRanges = new Map<string, string | null>();
  private database: Promise<IDBDatabase | null> | null = null;
  private persistentDisabled = false;
  private writeCounter = Date.now();

  constructor(
    private dataset: Pick<MarketDatasetSummary, "id" | "dataVersion" | "symbol" | "sourceIntervalSeconds">,
    private fetcher: typeof fetch = fetch,
    private budgetBytes = MARKET_CACHE_BUDGET_BYTES,
  ) {}

  private key(tradingDay: string) {
    return marketChunkKey({
      datasetId: this.dataset.id,
      dataVersion: this.dataset.dataVersion,
      symbol: this.dataset.symbol,
      sourceIntervalSeconds: this.dataset.sourceIntervalSeconds!,
      tradingDay,
    });
  }

  private open() {
    if (this.database) return this.database;
    this.database = new Promise((resolve) => {
      if (this.persistentDisabled || typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        if (!request.result.objectStoreNames.contains(DISPLAY_STORE_NAME)) {
          request.result.createObjectStore(DISPLAY_STORE_NAME, { keyPath: ["scopeKey", "timestamp"] });
        }
        if (!request.result.objectStoreNames.contains(DISPLAY_SCOPE_STORE_NAME)) {
          request.result.createObjectStore(DISPLAY_SCOPE_STORE_NAME, { keyPath: "scopeKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.persistentDisabled = true; resolve(null); };
      request.onblocked = () => { this.persistentDisabled = true; resolve(null); };
    });
    return this.database;
  }

  private remember(record: StoredMarketChunk) {
    if (!this.memory.has(record.key) && this.memory.size >= MEMORY_CHUNK_LIMIT) {
      const oldest = this.memory.keys().next().value as string | undefined;
      if (oldest) {
        this.memory.delete(oldest);
        this.memoryBarsDirty = true;
      }
    }
    this.memory.set(record.key, record);
    this.memoryBarsDirty = true;
  }

  private orderedMemoryBars() {
    if (!this.memoryBarsDirty) return this.memoryBars;
    const barsBySequence = new Map<number, MarketBarData>();
    for (const chunk of this.memory.values()) {
      for (const bar of chunk.bars) barsBySequence.set(bar.sequence, bar);
    }
    this.memoryBars = [...barsBySequence.values()].sort((a, b) => a.sequence - b.sequence);
    this.memoryBarsDirty = false;
    return this.memoryBars;
  }

  private async read(tradingDay: string) {
    const key = this.key(tradingDay);
    const memory = this.memory.get(key);
    if (memory) return memory;
    const database = await this.open();
    if (!database) return null;
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const record = await requestValue(transaction.objectStore(STORE_NAME).get(key)) as StoredMarketChunk | undefined;
      await done;
      if (record) this.remember(record);
      return record ?? null;
    } catch {
      return null;
    }
  }

  private async evict(database: IDBDatabase, incomingBytes = 0, incomingKeys = new Set<string>()) {
    const read = database.transaction(STORE_NAME, "readonly");
    const readDone = transactionDone(read);
    const storedRecords = await requestValue(read.objectStore(STORE_NAME).getAll()) as StoredMarketChunk[];
    await readDone;
    const records = incomingKeys.size
      ? storedRecords.filter((record) => !incomingKeys.has(record.key))
      : storedRecords;
    const keys = selectFifoEvictions(
      incomingBytes ? [...records, { key: "__incoming__", serializedBytes: incomingBytes, writtenAt: Number.MAX_SAFE_INTEGER }] : records,
      this.budgetBytes,
    ).filter((key) => key !== "__incoming__");
    if (!keys.length) return;
    const write = database.transaction(STORE_NAME, "readwrite");
    for (const key of keys) write.objectStore(STORE_NAME).delete(key);
    await transactionDone(write);
  }

  private async persistMany(records: StoredMarketChunk[]) {
    if (!records.length) return;
    const database = await this.open();
    if (!database) return;
    const uniqueRecords = [...new Map(records.map((record) => [record.key, record])).values()];
    const incomingBytes = uniqueRecords.reduce((sum, record) => sum + record.serializedBytes, 0);
    const incomingKeys = new Set(uniqueRecords.map((record) => record.key));
    const attempt = async () => {
      await this.evict(database, incomingBytes, incomingKeys);
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const record of uniqueRecords) store.put(record);
      await transactionDone(transaction);
    };
    try {
      await attempt();
    } catch (error) {
      if (!isQuotaError(error)) return;
      try {
        await this.evict(database, this.budgetBytes, incomingKeys);
        await attempt();
      } catch {
        this.persistentDisabled = true;
        database.close();
        this.database = Promise.resolve(null);
      }
    }
  }

  private toRecord(chunk: MarketBarDayChunk, requestStartDate: string, nextStartDate: string | null): StoredMarketChunk {
    const core = {
      ...chunk,
      datasetId: this.dataset.id,
      dataVersion: this.dataset.dataVersion,
      symbol: this.dataset.symbol,
      sourceIntervalSeconds: this.dataset.sourceIntervalSeconds!,
      requestStartDate,
      nextStartDate,
    };
    const key = marketChunkKey(core);
    return {
      ...core,
      key,
      serializedBytes: serializedSize(core),
      writtenAt: this.memory.get(key)?.writtenAt ?? ++this.writeCounter,
    };
  }

  async loadRange(startDate: string) {
    const sourceIntervalSeconds = this.dataset.sourceIntervalSeconds;
    if (!sourceIntervalSeconds) throw new Error("Missing source interval.");
    const expected = chunkRequestDates(startDate, sourceIntervalSeconds);
    const cached = await Promise.all(expected.map((date) => this.read(date)));
    const missing = expected.filter((_, index) => !cached[index]);
    if (!missing.length) {
      const persistedRange = cached.find((record) => record?.requestStartDate === startDate);
      const nextStartDate = this.nextRanges.has(startDate)
        ? this.nextRanges.get(startDate)!
        : persistedRange && Object.hasOwn(persistedRange, "nextStartDate")
          ? persistedRange.nextStartDate ?? null
          : addCalendarDays(startDate, expected.length);
      return {
        chunks: cached as StoredMarketChunk[],
        nextStartDate,
        cacheHit: true,
      };
    }
    const pending = new Set(missing.flatMap((date) => {
      const active = this.dateInflight.get(date);
      return active ? [active] : [];
    }));
    const uncovered = missing.filter((date) => !this.dateInflight.has(date));
    if (uncovered.length) {
      const params = new URLSearchParams({
        version: String(this.dataset.dataVersion),
        startDate,
        dates: uncovered.join(","),
      });
      const request = this.fetcher.call(
        globalThis,
        `/api/market-datasets/${this.dataset.id}/bars/chunks?${params}`,
      ).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Unable to load market bars.");
        return body as MarketBarChunksResponse;
      });
      for (const date of uncovered) this.dateInflight.set(date, request);
      request.finally(() => {
        for (const date of uncovered) {
          if (this.dateInflight.get(date) === request) this.dateInflight.delete(date);
        }
      }).catch(() => undefined);
      pending.add(request);
    }
    const responses = await Promise.all(pending);
    const persistence: StoredMarketChunk[] = [];
    for (const response of responses) {
      if (response.dataVersion !== this.dataset.dataVersion || response.datasetId !== this.dataset.id) {
        throw new Error("Market data cache version conflict.");
      }
      this.nextRanges.set(response.requestStartDate, response.nextStartDate);
      for (const chunk of response.chunks) {
        const record = this.toRecord(chunk, response.requestStartDate, response.nextStartDate);
        this.remember(record);
        persistence.push(record);
      }
    }
    await this.persistMany(persistence);
    const result = await Promise.all(expected.map((date) => this.read(date)));
    const nextStartDate = this.nextRanges.has(startDate)
      ? this.nextRanges.get(startDate)!
      : addCalendarDays(startDate, expected.length);
    return {
      chunks: result.filter(Boolean) as StoredMarketChunk[],
      nextStartDate,
      cacheHit: false,
    };
  }

  readMemoryBarsAfter(sequence: number, count: number) {
    if (count <= 0) return [];
    const bars = this.orderedMemoryBars();
    let low = 0;
    let high = bars.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (bars[middle].sequence <= sequence) low = middle + 1;
      else high = middle;
    }
    const result: MarketBarData[] = [];
    let expectedSequence = sequence + 1;
    for (let index = low; index < bars.length && result.length < count; index += 1) {
      const bar = bars[index];
      if (bar.sequence !== expectedSequence) break;
      result.push(bar);
      expectedSequence += 1;
    }
    return result;
  }

  async getBarsAfter(sequence: number, count: number, startDate: string) {
    let cursorDate: string | null = startDate;
    for (let attempt = 0; attempt < 32 && cursorDate; attempt += 1) {
      const existing = this.readMemoryBarsAfter(sequence, count);
      if (existing.length >= count) return existing;
      const loaded = await this.loadRange(cursorDate);
      if (loaded.nextStartDate) void this.loadRange(loaded.nextStartDate).catch(() => undefined);
      const bars = this.readMemoryBarsAfter(sequence, count);
      if (bars.length >= count || loaded.nextStartDate === null) return bars;
      cursorDate = loaded.nextStartDate;
    }
    return this.readMemoryBarsAfter(sequence, count);
  }

  /** Read a contiguous cached suffix before a sequence without fetching missing days. */
  async readCachedBarsBefore(sequence: number, startDate: string, options: { maxBars?: number; maxBytes?: number } = {}) {
    const maxBars = Math.max(0, options.maxBars ?? 250_000);
    const maxBytes = Math.max(0, options.maxBytes ?? 16 * 1024 * 1024);
    if (!maxBars || !maxBytes || sequence < 0) return [];
    const descending: MarketBarData[] = [];
    let bytes = 0;
    let tradingDay = startDate;
    for (let day = 0; day < 3_660 && descending.length < maxBars && bytes < maxBytes; day += 1) {
      const chunk = await this.read(tradingDay);
      if (!chunk) break;
      bytes += chunk.serializedBytes;
      for (let index = chunk.bars.length - 1; index >= 0; index -= 1) {
        const bar = chunk.bars[index];
        if (bar.sequence > sequence) continue;
        descending.push(bar);
        if (descending.length >= maxBars) break;
      }
      tradingDay = addCalendarDays(tradingDay, -1);
    }
    descending.sort((a, b) => a.sequence - b.sequence);
    if (!descending.length) return descending;
    const contiguous: MarketBarData[] = [descending.at(-1)!];
    for (let index = descending.length - 2; index >= 0; index -= 1) {
      if (descending[index].sequence !== contiguous[0].sequence - 1) break;
      contiguous.unshift(descending[index]);
    }
    return contiguous;
  }

  prefetch(startDate: string) {
    void this.loadRange(startDate).then((loaded) => {
      if (loaded.nextStartDate) void this.loadRange(loaded.nextStartDate).catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** Persistent cache of already aggregated display candles. Failures are intentionally non-fatal. */
export class DisplayBarCache {
  private database: Promise<IDBDatabase | null> | null = null;
  private disabled = false;
  readonly scopeKey: string;

  constructor(private scope: DisplayBarCacheScope, private budgetBytes = MARKET_DISPLAY_CACHE_BUDGET_BYTES) {
    this.scopeKey = displayBarScopeKey(scope);
  }

  private open() {
    if (this.database) return this.database;
    this.database = new Promise((resolve) => {
      if (this.disabled || typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        if (!request.result.objectStoreNames.contains(DISPLAY_STORE_NAME)) {
          request.result.createObjectStore(DISPLAY_STORE_NAME, { keyPath: ["scopeKey", "timestamp"] });
        }
        if (!request.result.objectStoreNames.contains(DISPLAY_SCOPE_STORE_NAME)) {
          request.result.createObjectStore(DISPLAY_SCOPE_STORE_NAME, { keyPath: "scopeKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.disabled = true; resolve(null); };
      request.onblocked = () => { this.disabled = true; resolve(null); };
    });
    return this.database;
  }

  async readBefore(currentSequence: number, count = REPLAY_HISTORY_BAR_LIMIT) {
    const database = await this.open();
    if (!database || count <= 0) return [] as AggregatedMarketBarData[];
    try {
      const transaction = database.transaction(DISPLAY_STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(DISPLAY_STORE_NAME);
      const range = IDBKeyRange.bound([this.scopeKey, ""], [this.scopeKey, "\uffff"]);
      const bars = await new Promise<AggregatedMarketBarData[]>((resolve, reject) => {
        const descending: AggregatedMarketBarData[] = [];
        const request = store.openCursor(range, "prev");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || descending.length >= count) return resolve(descending.reverse());
          const record = cursor.value as StoredDisplayBar;
          if (record.bar.lastSequence <= currentSequence) descending.push(record.bar);
          cursor.continue();
        };
      });
      await done;
      void this.touch().catch(() => undefined);
      return bars;
    } catch {
      return [];
    }
  }

  private async touch() {
    const database = await this.open();
    if (!database) return;
    const read = database.transaction(DISPLAY_SCOPE_STORE_NAME, "readonly");
    const done = transactionDone(read);
    const current = await requestValue(read.objectStore(DISPLAY_SCOPE_STORE_NAME).get(this.scopeKey)) as StoredDisplayScope | undefined;
    await done;
    if (!current) return;
    const write = database.transaction(DISPLAY_SCOPE_STORE_NAME, "readwrite");
    write.objectStore(DISPLAY_SCOPE_STORE_NAME).put({ ...current, accessedAt: Date.now() });
    await transactionDone(write);
  }

  private async trimScope(database: IDBDatabase, excess: number) {
    if (excess <= 0) return;
    const transaction = database.transaction(DISPLAY_STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(DISPLAY_STORE_NAME);
    const range = IDBKeyRange.bound([this.scopeKey, ""], [this.scopeKey, "\uffff"]);
    await new Promise<void>((resolve, reject) => {
      let remaining = excess;
      const request = store.openCursor(range, "next");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || remaining <= 0) return resolve();
        cursor.delete();
        remaining -= 1;
        cursor.continue();
      };
    });
    await done;
  }

  private async evictScopes(database: IDBDatabase) {
    const read = database.transaction(DISPLAY_SCOPE_STORE_NAME, "readonly");
    const done = transactionDone(read);
    const scopes = await requestValue(read.objectStore(DISPLAY_SCOPE_STORE_NAME).getAll()) as StoredDisplayScope[];
    await done;
    let total = scopes.reduce((sum, item) => sum + item.serializedBytes, 0);
    if (total <= this.budgetBytes) return;
    const target = this.budgetBytes * DISPLAY_CACHE_EVICT_TO_RATIO;
    for (const item of [...scopes].sort((a, b) => a.accessedAt - b.accessedAt)) {
      if (total <= target) break;
      const transaction = database.transaction([DISPLAY_STORE_NAME, DISPLAY_SCOPE_STORE_NAME], "readwrite");
      transaction.objectStore(DISPLAY_STORE_NAME).delete(IDBKeyRange.bound([item.scopeKey, ""], [item.scopeKey, "\uffff"]));
      transaction.objectStore(DISPLAY_SCOPE_STORE_NAME).delete(item.scopeKey);
      await transactionDone(transaction);
      total -= item.serializedBytes;
    }
  }

  async persist(bars: AggregatedMarketBarData[]) {
    const database = await this.open();
    if (!database || !bars.length) return;
    const unique = [...new Map(bars.map((bar) => [bar.timestamp, bar])).values()];
    try {
      const read = database.transaction([DISPLAY_STORE_NAME, DISPLAY_SCOPE_STORE_NAME], "readonly");
      const readDone = transactionDone(read);
      const displayStore = read.objectStore(DISPLAY_STORE_NAME);
      const existingRequests = unique.map((bar) => requestValue(displayStore.get([this.scopeKey, bar.timestamp])) as Promise<StoredDisplayBar | undefined>);
      const scopeRequest = requestValue(read.objectStore(DISPLAY_SCOPE_STORE_NAME).get(this.scopeKey)) as Promise<StoredDisplayScope | undefined>;
      const [existing, currentScope] = await Promise.all([Promise.all(existingRequests), scopeRequest]);
      await readDone;
      const records = unique.map((bar) => {
        const core = { scopeKey: this.scopeKey, timestamp: bar.timestamp, bar };
        return { ...core, serializedBytes: serializedSize(core) } satisfies StoredDisplayBar;
      });
      const replacedBytes = existing.reduce((sum, item) => sum + (item?.serializedBytes ?? 0), 0);
      const newCount = existing.filter((item) => !item).length;
      const nextScope: StoredDisplayScope = {
        scopeKey: this.scopeKey,
        serializedBytes: Math.max(0, (currentScope?.serializedBytes ?? 0) - replacedBytes + records.reduce((sum, item) => sum + item.serializedBytes, 0)),
        barCount: (currentScope?.barCount ?? 0) + newCount,
        accessedAt: Date.now(),
      };
      const write = database.transaction([DISPLAY_STORE_NAME, DISPLAY_SCOPE_STORE_NAME], "readwrite");
      for (const record of records) write.objectStore(DISPLAY_STORE_NAME).put(record);
      write.objectStore(DISPLAY_SCOPE_STORE_NAME).put(nextScope);
      await transactionDone(write);
      const excess = Math.max(0, nextScope.barCount - REPLAY_HISTORY_BAR_LIMIT);
      if (excess) {
        await this.trimScope(database, excess);
        const metadata = database.transaction(DISPLAY_SCOPE_STORE_NAME, "readwrite");
        metadata.objectStore(DISPLAY_SCOPE_STORE_NAME).put({ ...nextScope, barCount: REPLAY_HISTORY_BAR_LIMIT });
        await transactionDone(metadata);
      }
      await this.evictScopes(database);
    } catch (error) {
      if (isQuotaError(error)) this.disabled = true;
    }
  }
}

export class ReplayWindowMemoryCache<T> {
  private values = new Map<string, T>();
  private sizes = new Map<string, number>();
  private totalBytes = 0;
  constructor(private budgetBytes = 32 * 1024 * 1024) {}
  get(key: string) {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }
  set(key: string, value: T) {
    const size = serializedSize(value);
    const previousSize = this.sizes.get(key) ?? 0;
    this.totalBytes = this.totalBytes - previousSize + size;
    this.values.delete(key);
    this.values.set(key, value);
    this.sizes.set(key, size);
    while (this.totalBytes > this.budgetBytes && this.values.size > 1) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (!oldest) break;
      this.values.delete(oldest);
      this.totalBytes -= this.sizes.get(oldest) ?? 0;
      this.sizes.delete(oldest);
    }
  }
}
