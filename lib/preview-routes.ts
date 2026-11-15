/** Exact, UI-only routes: never wrap them in user, AI, PDF or business-data providers. */
export function isIsolatedPreviewPath(pathname: string) {
  return pathname === "/preview/user-growth" || pathname === "/preview/chart-style";
}
