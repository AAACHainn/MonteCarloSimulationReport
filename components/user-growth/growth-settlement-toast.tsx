import styles from "./user-growth.module.css";

/** Positioned outside document flow so settlement feedback never resizes the chart. */
export function GrowthSettlementToast({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="status" aria-live="polite" aria-atomic="true" className={`${styles.settlementToast} pointer-events-none absolute right-0 top-full z-40 mt-2 w-max max-w-[min(20rem,calc(100vw-2rem))] break-words rounded-md border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-xs leading-5 text-emerald-800 shadow-sm`}>{message}</p>;
}
