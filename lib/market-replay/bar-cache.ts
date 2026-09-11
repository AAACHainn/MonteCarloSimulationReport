"use client";

import { addCalendarDays, chunkRequestDates } from "./chunks";
import {
  MARKET_CACHE_BUDGET_BYTES,
  MARKET_CACHE_EVICT_TO_RATIO,
  type MarketBarChunksResponse,
  type MarketBarDayChunk,
  type MarketBarData,
  type MarketDatasetSummary,
} from "./types";

const DATABASE_NAME = "market-replay-bars-v1";
const STORE_NAME = "daily-chunks";
const DATABASE_VERSION = 1;
const MEMORY_CHUNK_LIMIT = 14;

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

  prefetch(startDate: string) {
    void this.loadRange(startDate).then((loaded) => {
      if (loaded.nextStartDate) void this.loadRange(loaded.nextStartDate).catch(() => undefined);
    }).catch(() => undefined);
  }
}

export class ReplayWindowMemoryCache<T> {
  private values = new Map<string, T>();
  constructor(private limit = 24) {}
  get(key: string) { return this.values.get(key); }
  set(key: string, value: T) {
    if (!this.values.has(key) && this.values.size >= this.limit) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest) this.values.delete(oldest);
    }
    this.values.set(key, value);
  }
}
