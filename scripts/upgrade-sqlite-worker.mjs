import { parentPort, workerData } from "node:worker_threads";
import { upgradeDatabase } from "./upgrade-sqlite.mjs";

try {
  const result = await upgradeDatabase({ ...workerData.options, cancelFlag: new Int32Array(workerData.shared), onProgress: progress => parentPort.postMessage({ type: "progress", progress }) });
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({ type: "failure", message: error.message, report: error.report });
}
