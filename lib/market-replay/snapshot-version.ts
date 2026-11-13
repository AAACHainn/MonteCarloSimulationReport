// Version belongs to frozen render input, never to the browser's appearance preference.
export const ETH_BAR_COUNT_RENDERER_VERSION = 4;
export const CONTINUOUS_BAR_COUNT_RENDERER_VERSION = 5;
export const CURRENT_CHART_RENDERER_VERSION = CONTINUOUS_BAR_COUNT_RENDERER_VERSION;
export const LEGACY_CHART_RENDERER_VERSION = 2;
export const CURRENT_CHART_IMAGE_VARIANT = "image:6";
export const LEGACY_CHART_IMAGE_VARIANT = "image:3";
export function snapshotRendererVersion(version?: number) {
  return version === 3 || version === ETH_BAR_COUNT_RENDERER_VERSION || version === CURRENT_CHART_RENDERER_VERSION ? version : LEGACY_CHART_RENDERER_VERSION;
}
export function chartImageVariantVersion(version?: number) {
  const resolved = snapshotRendererVersion(version);
  return resolved === CURRENT_CHART_RENDERER_VERSION ? CURRENT_CHART_IMAGE_VARIANT
    : resolved === ETH_BAR_COUNT_RENDERER_VERSION ? "image:5"
      : resolved === 3 ? "image:4" : LEGACY_CHART_IMAGE_VARIANT;
}
