export type Corner = { x: number; y: number };
export type Corners = [Corner, Corner, Corner, Corner];

export const PLATE_ASPECT_RATIO = 2;
/** 検出四隅を中心から外側へ拡張（マスクの取りこぼし防止） */
export const PLATE_MASK_COVERAGE_EXPAND = 1.18;

const MIN_PLATE_WIDTH_RATIO = 0.018;
const MIN_PLATE_HEIGHT_RATIO = 0.006;
const MIN_PLATE_ASPECT = 1.35;
const MAX_PLATE_ASPECT = 3.9;
/** 画面下寄りかつ小さい検出は地面のマーキング等を除外 */
const LOWER_FRAME_STRICT_Y = 0.72;
const LOWER_FRAME_MIN_WIDTH_RATIO = 0.026;
const BOTTOM_EDGE_REJECT_Y = 0.9;
const BOTTOM_EDGE_MIN_WIDTH_RATIO = 0.032;
const LOW_COVERAGE_WIDTH_RATIO = 0.024;

export function normalizeCornersOrder(corners: Corners): Corners {
  return corners;
}

export function measureQuadPlateSize(corners: Corners, imageW: number, imageH: number) {
  const plateWidthTop = Math.hypot((corners[1].x - corners[0].x) * imageW, (corners[1].y - corners[0].y) * imageH);
  const plateWidthBottom = Math.hypot((corners[2].x - corners[3].x) * imageW, (corners[2].y - corners[3].y) * imageH);
  const plateWidth = (plateWidthTop + plateWidthBottom) / 2;
  const plateHeightLeft = Math.hypot((corners[3].x - corners[0].x) * imageW, (corners[3].y - corners[0].y) * imageH);
  const plateHeightRight = Math.hypot((corners[2].x - corners[1].x) * imageW, (corners[2].y - corners[1].y) * imageH);
  const plateHeight = (plateHeightLeft + plateHeightRight) / 2;
  const centerNx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const centerNy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const areaRatio =
    imageW > 0 && imageH > 0
      ? Math.abs(shoelaceAreaNormalized(corners)) * imageW * imageH / (imageW * imageH)
      : 0;
  return { plateWidth, plateHeight, centerNx, centerNy, areaRatio };
}

function shoelaceAreaNormalized(corners: Corners): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function isConvexQuad(corners: Corners): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8) continue;
    if (sign === 0) sign = cross > 0 ? 1 : -1;
    else if ((cross > 0 ? 1 : -1) !== sign) return false;
  }
  return sign !== 0;
}

/** ナンバープレートらしい四隅か（地面の誤検出を除外） */
export function isPlausiblePlateCorners(corners: Corners, imageW: number, imageH: number): boolean {
  if (imageW <= 0 || imageH <= 0) return false;
  const { plateWidth, plateHeight, centerNy, areaRatio } = measureQuadPlateSize(corners, imageW, imageH);
  if (plateWidth <= 0 || plateHeight <= 0) return false;

  const widthRatio = plateWidth / imageW;
  const heightRatio = plateHeight / imageH;
  const aspect = plateWidth / plateHeight;

  if (widthRatio < MIN_PLATE_WIDTH_RATIO || heightRatio < MIN_PLATE_HEIGHT_RATIO) return false;
  if (aspect < MIN_PLATE_ASPECT || aspect > MAX_PLATE_ASPECT) return false;
  if (areaRatio < 0.00008) return false;
  if (!isConvexQuad(corners)) return false;

  if (centerNy > BOTTOM_EDGE_REJECT_Y && widthRatio < BOTTOM_EDGE_MIN_WIDTH_RATIO) return false;
  if (centerNy > LOWER_FRAME_STRICT_Y && widthRatio < LOWER_FRAME_MIN_WIDTH_RATIO) return false;

  return true;
}

function centerDistanceNx(c1: Corners, c2: Corners): number {
  const a = measureQuadPlateSize(c1, 1, 1);
  const b = measureQuadPlateSize(c2, 1, 1);
  return Math.hypot(a.centerNx - b.centerNx, a.centerNy - b.centerNy);
}

/** 近接する重複候補のうち小さい方を除去 */
export function dedupePlateCornersList(cornersList: Corners[], imageW: number, imageH: number): Corners[] {
  if (cornersList.length <= 1) return cornersList;

  const ranked = [...cornersList].sort((a, b) => {
    const ma = measureQuadPlateSize(a, imageW, imageH);
    const mb = measureQuadPlateSize(b, imageW, imageH);
    return mb.plateWidth * mb.plateHeight - ma.plateWidth * ma.plateHeight;
  });

  const kept: Corners[] = [];
  for (const candidate of ranked) {
    const mc = measureQuadPlateSize(candidate, imageW, imageH);
    const candidateArea = mc.plateWidth * mc.plateHeight;
    const overlaps = kept.some((existing) => {
      const me = measureQuadPlateSize(existing, imageW, imageH);
      const existingArea = me.plateWidth * me.plateHeight;
      if (centerDistanceNx(candidate, existing) > 0.09) return false;
      return candidateArea < existingArea * 0.65;
    });
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

export function filterPlateCornersList(cornersList: Corners[], imageW: number, imageH: number): Corners[] {
  const plausible = cornersList.filter((corners) => isPlausiblePlateCorners(corners, imageW, imageH));
  return dedupePlateCornersList(plausible, imageW, imageH);
}

export function hasLowCoveragePlateCorners(cornersList: Corners[], imageW: number, imageH: number): boolean {
  return cornersList.some((corners) => {
    const { plateWidth } = measureQuadPlateSize(corners, imageW, imageH);
    return plateWidth / Math.max(1, imageW) < LOW_COVERAGE_WIDTH_RATIO;
  });
}

function fitCornersToPlateAspect(
  corners: Corners,
  imageW: number,
  imageH: number,
  targetAspect = PLATE_ASPECT_RATIO
): Corners {
  if (imageW <= 0 || imageH <= 0) return corners;
  const { plateWidth, plateHeight, centerNx, centerNy } = measureQuadPlateSize(corners, imageW, imageH);
  if (plateWidth <= 0 || plateHeight <= 0) return corners;

  const currentAspect = plateWidth / plateHeight;
  let scaleX = 1;
  let scaleY = 1;
  if (currentAspect > targetAspect * 1.08) {
    scaleX = (plateHeight * targetAspect) / plateWidth;
  } else if (currentAspect < targetAspect / 1.08) {
    scaleY = plateWidth / targetAspect / plateHeight;
  }
  if (scaleX === 1 && scaleY === 1) return corners;

  return corners.map((c) => ({
    x: centerNx + (c.x - centerNx) * scaleX,
    y: centerNy + (c.y - centerNy) * scaleY,
  })) as Corners;
}

export function refinePlateCorners(corners: Corners, imageW: number, imageH: number): Corners {
  let next = fitCornersToPlateAspect(normalizeCornersOrder(corners), imageW, imageH);
  const { plateWidth, plateHeight, centerNx, centerNy } = measureQuadPlateSize(next, imageW, imageH);
  const maxWidthRatio = 0.14;
  const maxHeightRatio = 0.075;
  const widthRatio = plateWidth / imageW;
  const heightRatio = plateHeight / imageH;
  let shrink = 1;
  if (widthRatio > maxWidthRatio) shrink = Math.min(shrink, maxWidthRatio / widthRatio);
  if (heightRatio > maxHeightRatio) shrink = Math.min(shrink, maxHeightRatio / heightRatio);
  if (shrink < 1) {
    next = next.map((c) => ({
      x: centerNx + (c.x - centerNx) * shrink,
      y: centerNy + (c.y - centerNy) * shrink,
    })) as Corners;
  }
  return expandPlateCorners(next);
}

export function expandPlateCorners(
  corners: Corners,
  expandFactor = PLATE_MASK_COVERAGE_EXPAND
): Corners {
  const centerNx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const centerNy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  return corners.map((c) => ({
    x: Math.max(0, Math.min(1, centerNx + (c.x - centerNx) * expandFactor)),
    y: Math.max(0, Math.min(1, centerNy + (c.y - centerNy) * expandFactor)),
  })) as Corners;
}

export function refinePlateCornersList(cornersList: Corners[], imageW: number, imageH: number): Corners[] {
  return cornersList.map((corners) => refinePlateCorners(corners, imageW, imageH));
}

/** 編集用デフォルト四角（正規化座標 0-1） */
export function getDefaultCenterCorners(): Corners {
  const cx = 0.5;
  const cy = 0.82;
  const halfW = 0.042;
  const halfH = 0.021;
  return [
    { x: cx - halfW, y: cy - halfH },
    { x: cx + halfW, y: cy - halfH },
    { x: cx + halfW, y: cy + halfH },
    { x: cx - halfW, y: cy + halfH },
  ];
}

export function getPlateBaseAngle(corners: Corners): number {
  const topDx = corners[1].x - corners[0].x;
  const topDy = corners[1].y - corners[0].y;
  const bottomDx = corners[2].x - corners[3].x;
  const bottomDy = corners[2].y - corners[3].y;
  const angleTop = Math.atan2(topDy, topDx);
  const angleBottom = Math.atan2(bottomDy, bottomDx);
  let baseAngle = (angleTop + angleBottom) / 2;
  if (Math.abs(angleTop - angleBottom) > Math.PI) {
    baseAngle += Math.PI;
  }
  return baseAngle;
}
