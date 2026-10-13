export type PileSizePreferences = { height?: number; imageSize: number; collapsed?: boolean };
export const DEFAULT_PILE_SIZE: PileSizePreferences = { imageSize: 112 };

export function readPileSize(projectId: string): PileSizePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(`folder-sort-pile:${projectId}`) || '{}');
    return {
      imageSize: Number.isFinite(value.imageSize) ? Math.max(72, Math.min(240, value.imageSize)) : 112,
      height: Number.isFinite(value.height) ? Math.max(120, Math.min(500, value.height)) : undefined,
      ...(value.collapsed === true ? { collapsed: true } : {}),
    };
  } catch { return { ...DEFAULT_PILE_SIZE }; }
}

/** Leave useful board space and enough tray space for the complete image. */
export function pileSizeGeometry(width: number, height: number, preferences: PileSizePreferences) {
  const head = width <= 700 ? 64 : 60;
  const grip = 16;
  const maxHeight = Math.max(head + grip + 88, Math.min(500, Math.floor(height * .6), height - Math.min(260, Math.round(height * .46))));
  const maxImageSize = Math.min(240, Math.floor((maxHeight - head - grip - 16) / 8) * 8);
  const imageSize = Math.max(72, Math.min(preferences.imageSize, maxImageSize));
  const minHeight = head + grip + imageSize + 16;
  const defaultHeight = head + grip + 159;
  const expandedHeight = Math.max(minHeight, Math.min(maxHeight, preferences.height ?? defaultHeight));
  const collapsedHeight = head + grip;
  const paneHeight = preferences.collapsed ? collapsedHeight : expandedHeight;
  return { head, grip, imageSize, paneHeight, expandedHeight, collapsedHeight, minHeight, maxHeight, maxImageSize, step: Math.round(imageSize * 68 / 112) };
}
