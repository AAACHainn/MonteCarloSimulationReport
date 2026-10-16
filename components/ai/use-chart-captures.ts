"use client";
import { useEffect, useRef, useState } from "react";
import type { CaptureJob } from "@/lib/ai/chart-images-contract";
import { aiApi } from "./api";
import { fulfillChartCapture } from "./capture";

export function useChartCaptures(runIds: string[]) {
  const ids = useRef(runIds); ids.current = runIds;
  const [capturingRun, setCapturingRun] = useState<string | null>(null);
  useEffect(() => {
    const lifetime = new AbortController(); let running = false;
    async function poll() {
      if (running || document.hidden || !ids.current.length || lifetime.signal.aborted) return;
      running = true;
      try {
        const tasks = await aiApi<Array<{ id: string; runId: string }>>("captures?runIds=" + encodeURIComponent(ids.current.join(",")), "GET", undefined, lifetime.signal);
        for (const task of tasks) {
          if (document.hidden || !ids.current.includes(task.runId)) continue;
          let job: CaptureJob;
          try { job = await aiApi<CaptureJob>("captures/" + task.id + "/claim", "POST", {}, lifetime.signal); } catch { continue; }
          const controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, lifetime.signal, AbortSignal.timeout(Math.max(1, job.deadline - Date.now()))]);
          setCapturingRun(task.runId);
          const heartbeat = setInterval(() => {
            if (!ids.current.includes(task.runId)) { controller.abort(); return; }
            void aiApi("captures/" + job.id, "POST", { lease: job.lease, heartbeat: true }, signal).catch(() => controller.abort());
          }, 10000);
          try { await fulfillChartCapture(job, signal); }
          catch { if (!lifetime.signal.aborted) await aiApi("captures/" + job.id, "POST", { lease: job.lease, failed: true }).catch(() => undefined); }
          finally { clearInterval(heartbeat); if (!lifetime.signal.aborted) setCapturingRun(null); }
        }
      } catch { /* A disconnected page can reclaim persisted requests after its lease expires. */ }
      finally { running = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => { lifetime.abort(); clearInterval(timer); };
  }, []);
  return capturingRun;
}
