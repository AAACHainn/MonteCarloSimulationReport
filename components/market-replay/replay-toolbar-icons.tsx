/** The rail uses the prototype's slate tone, including on both custom drawing icons. */
export const replayToolButtonColors = "text-[#526278] dark:text-secondary-text hover:bg-slate-100 dark:hover:bg-hover hover:text-blue-700 dark:hover:text-link";

export function TrendLineToolIcon() {
  return <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 18 19 5M5 18h2M17 5h2v2" />
  </svg>;
}

export function FibonacciToolIcon() {
  return <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4h18M3 9h15M3 15h18M6 20h15" />
    <circle cx="20" cy="9" r="2" />
    <circle cx="4" cy="20" r="2" />
  </svg>;
}
