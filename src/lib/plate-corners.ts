export type Corner = { x: number; y: number };
export type Corners = [Corner, Corner, Corner, Corner];

export const PLATE_ASPECT_RATIO = 2;

export function normalizeCornersOrder(corners: Corners): Corners {
  return corners;
}

function measureQuadPlateSize(corners: Corners, imageW: number, imageH: number) {
  const plateWidthTop = Math.hypot((corners[1].x - corners[0].x) * imageW, (corners[1].y - corners[0].y) * imageH);
  const plateWidthBottom = Math.hypot((corners[2].x - corners[3].x) * imageW, (corners[2].y - corners[3].y) * imageH);
  const plateWidth = (plateWidthTop + plateWidthBottom) / 2;
  const plateHeightLeft = Math.hypot((corners[3].x - corners[0].x) * imageW, (corners[3].y - corners[0].y) * imageH);
  const plateHeightRight = Math.hypot((corners[2].x - corners[1].x) * imageW, (corners[2].y - corners[1].y) * imageH);
  const plateHeight = (plateHeightLeft + plateHeightRight) / 2;
  const centerNx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const centerNy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  return { plateWidth, plateHeight, centerNx, centerNy };
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
  return next;
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
