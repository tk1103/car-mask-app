import {
  buildDetectImageBlob,
  getPlateSearchCrop,
  remapApiPlateCornersToFullImage,
  type PlateSearchCrop,
} from './detect-image';
import {
  getPlateBaseAngle,
  normalizeCornersOrder,
  refinePlateCorners,
  refinePlateCornersList,
  type Corners,
} from './plate-corners';

export type DetectApiResponse = {
  found?: boolean;
  plates?: Array<{ corners?: Array<{ x: number; y: number }> }>;
  corners?: Array<{ x: number; y: number }>;
  reasoning?: string;
  inferred?: boolean;
  error?: unknown;
  userMessage?: string;
  errorType?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  remainingToday?: number | null;
  plan?: string;
};

export type DetectRunOutcome = {
  ok: boolean;
  status: number;
  result: DetectApiResponse;
  corners: Corners[] | null;
  usedCrop: boolean;
};

function plateApiToFullCorners(
  apiCorners: Array<{ x: number; y: number }>,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): Corners {
  return remapApiPlateCornersToFullImage(apiCorners, crop, imageW, imageH) as Corners;
}

function parseCornersFromResult(
  result: DetectApiResponse,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): Corners[] | null {
  if (result.plates && Array.isArray(result.plates) && result.plates.length > 0) {
    const platesCorners: Corners[] = result.plates
      .filter((plate) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4)
      .map((plate) =>
        refinePlateCorners(
          normalizeCornersOrder(plateApiToFullCorners(plate.corners!, crop, imageW, imageH)),
          imageW,
          imageH
        )
      );
    return platesCorners.length > 0 ? platesCorners : null;
  }
  if (result.found && result.corners && Array.isArray(result.corners) && result.corners.length === 4) {
    return [
      refinePlateCorners(
        normalizeCornersOrder(plateApiToFullCorners(result.corners, crop, imageW, imageH)),
        imageW,
        imageH
      ),
    ];
  }
  return null;
}

async function postDetect(
  blob: Blob,
  width: number,
  height: number,
  deviceId: string,
  signal?: AbortSignal
): Promise<{ status: number; result: DetectApiResponse }> {
  const fd = new FormData();
  fd.append('image', blob, 'photo.jpg');
  fd.append('width', String(width));
  fd.append('height', String(height));
  const res = await fetch('/api/detect', {
    method: 'POST',
    body: fd,
    signal,
    headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
  });
  let result: DetectApiResponse = {};
  try {
    result = (await res.json()) as DetectApiResponse;
  } catch {
    result = {};
  }
  return { status: res.status, result };
}

/** 下部クロップ優先 → 失敗時は原画像全体で再試行 */
export async function runPlateDetection(
  fullResCanvas: HTMLCanvasElement,
  imageW: number,
  imageH: number,
  deviceId: string,
  signal?: AbortSignal
): Promise<DetectRunOutcome> {
  const crop = getPlateSearchCrop(imageW, imageH);
  const croppedPayload = await buildDetectImageBlob(fullResCanvas, imageW, imageH, crop);
  let { status, result } = await postDetect(croppedPayload.blob, croppedPayload.width, croppedPayload.height, deviceId, signal);

  let corners = status >= 200 && status < 300 ? parseCornersFromResult(result, crop, imageW, imageH) : null;
  if (corners) {
    return { ok: true, status, result, corners, usedCrop: true };
  }

  if (!signal?.aborted) {
    const fullPayload = await buildDetectImageBlob(fullResCanvas, imageW, imageH, null);
    ({ status, result } = await postDetect(fullPayload.blob, fullPayload.width, fullPayload.height, deviceId, signal));
    corners = status >= 200 && status < 300 ? parseCornersFromResult(result, null, imageW, imageH) : null;
    if (corners) {
      return { ok: true, status, result, corners, usedCrop: false };
    }
  }

  return { ok: status >= 200 && status < 300, status, result, corners: null, usedCrop: true };
}

export { getPlateBaseAngle, refinePlateCornersList };
