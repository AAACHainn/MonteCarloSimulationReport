// Version belongs to frozen render input, never to the browser's appearance preference.
export const CURRENT_CHART_RENDERER_VERSION = 3;
export const LEGACY_CHART_RENDERER_VERSION = 2;
export const CURRENT_CHART_IMAGE_VARIANT = "image:4";
export const LEGACY_CHART_IMAGE_VARIANT = "image:3";
export function snapshotRendererVersion(version?: number) {
  return version === CURRENT_CHART_RENDERER_VERSION ? CURRENT_CHART_RENDERER_VERSION : LEGACY_CHART_RENDERER_VERSION;
}
export function chartImageVariantVersion(version?: number) {
  return snapshotRendererVersion(version) === CURRENT_CHART_RENDERER_VERSION ? CURRENT_CHART_IMAGE_VARIANT : LEGACY_CHART_IMAGE_VARIANT;
}
