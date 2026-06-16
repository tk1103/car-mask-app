/** API 送信用: ナンバーが写りやすい下部中央を切り出してから縮小する */
export type PlateSearchCrop = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export const DETECT_API_MAX_LONG_EDGE = 1280;

export function getPlateSearchCrop(imageW: number, imageH: number): PlateSearchCrop {
  const portrait = imageH >= imageW;
  const cropWRatio = portrait ? 0.92 : 0.78;
  const cropHRatio = portrait ? 0.48 : 0.52;
  const sw = Math.max(32, Math.round(imageW * cropWRatio));
  const sh = Math.max(32, Math.round(imageH * cropHRatio));
  const sx = Math.max(0, Math.round((imageW - sw) / 2));
  const sy = Math.max(0, Math.round(imageH - sh - imageH * 0.012));
  return { sx, sy, sw, sh };
}

export async function buildDetectImageBlob(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  crop: PlateSearchCrop | null,
  maxLongEdge = DETECT_API_MAX_LONG_EDGE
): Promise<{ blob: Blob; width: number; height: number }> {
  const sx = crop?.sx ?? 0;
  const sy = crop?.sy ?? 0;
  const sw = crop?.sw ?? sourceW;
  const sh = crop?.sh ?? sourceH;

  const apiScale = Math.min(maxLongEdge / Math.max(sw, sh), 1);
  const apiW = Math.max(1, Math.round(sw * apiScale));
  const apiH = Math.max(1, Math.round(sh * apiScale));

  const canvas = document.createElement('canvas');
  canvas.width = apiW;
  canvas.height = apiH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas error');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'contrast(1.3) brightness(1.06)';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, apiW, apiH);
  ctx.filter = 'none';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.92);
  });
  return { blob, width: apiW, height: apiH };
}

/** API の 0–1000 座標 → 原画像の 0–1 正規化座標 */
export function remapApiCornerToFullImage(
  apiX: number,
  apiY: number,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): { x: number; y: number } {
  const nx = Math.max(0, Math.min(1, apiX / 1000));
  const ny = Math.max(0, Math.min(1, apiY / 1000));
  if (!crop) return { x: nx, y: ny };
  const px = crop.sx + nx * crop.sw;
  const py = crop.sy + ny * crop.sh;
  return {
    x: Math.max(0, Math.min(1, px / imageW)),
    y: Math.max(0, Math.min(1, py / imageH)),
  };
}

export function remapApiPlateCornersToFullImage(
  apiCorners: Array<{ x: number; y: number }>,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): Array<{ x: number; y: number }> {
  return apiCorners.map((c) => {
    const p = remapApiCornerToFullImage(c.x, c.y, crop, imageW, imageH);
    return { x: p.x, y: p.y };
  });
}
