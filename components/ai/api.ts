"use client";
import { copy } from "@/lib/i18n";
export async function aiApi<T = unknown>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/ai/" + path, {
    method, signal, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(copy.ai.failed); }
  if (!response.ok) throw new Error(data.error ?? copy.ai.failed);
  return data as T;
}
