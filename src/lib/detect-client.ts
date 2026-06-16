import {
  buildDetectImageBlob,
  getPlateSearchCrop,
  remapApiPlateCornersToFullImage,
  type PlateSearchCrop,
} from './detect-image';
import {
  filterPlateCornersList,
  getPlateBaseAngle,
  hasLowCoveragePlateCorners,
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
  rawPlateCount: number;
  filteredPlateCount: number;
  lowCoverage: boolean;
};

function plateApiToFullCorners(
  apiCorners: Array<{ x: number; y: number }>,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): Corners {
  return remapApiPlateCornersToFullImage(apiCorners, crop, imageW, imageH) as Corners;
}

function collectRefinedCornersFromResult(
  result: DetectApiResponse,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): Corners[] {
  const refined: Corners[] = [];

  if (result.plates && Array.isArray(result.plates)) {
    for (const plate of result.plates) {
      if (!plate.corners || !Array.isArray(plate.corners) || plate.corners.length !== 4) continue;
      refined.push(
        refinePlateCorners(
          normalizeCornersOrder(plateApiToFullCorners(plate.corners, crop, imageW, imageH)),
          imageW,
          imageH
        )
      );
    }
    return refined;
  }

  if (result.found && result.corners && Array.isArray(result.corners) && result.corners.length === 4) {
    refined.push(
      refinePlateCorners(
        normalizeCornersOrder(plateApiToFullCorners(result.corners, crop, imageW, imageH)),
        imageW,
        imageH
      )
    );
  }

  return refined;
}

function parseCornersFromResult(
  result: DetectApiResponse,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number
): Pick<DetectRunOutcome, 'corners' | 'rawPlateCount' | 'filteredPlateCount' | 'lowCoverage'> {
  const refined = collectRefinedCornersFromResult(result, crop, imageW, imageH);
  const rawPlateCount = refined.length;
  const filtered = filterPlateCornersList(refined, imageW, imageH);
  const filteredPlateCount = Math.max(0, rawPlateCount - filtered.length);
  const corners = filtered.length > 0 ? filtered : null;
  const lowCoverage = corners ? hasLowCoveragePlateCorners(corners, imageW, imageH) : false;
  return { corners, rawPlateCount, filteredPlateCount, lowCoverage };
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

function buildOutcome(
  status: number,
  result: DetectApiResponse,
  crop: PlateSearchCrop | null,
  imageW: number,
  imageH: number,
  usedCrop: boolean
): DetectRunOutcome {
  const parsed =
    status >= 200 && status < 300
      ? parseCornersFromResult(result, crop, imageW, imageH)
      : {
          corners: null as Corners[] | null,
          rawPlateCount: 0,
          filteredPlateCount: 0,
          lowCoverage: false,
        };

  return {
    ok: status >= 200 && status < 300,
    status,
    result,
    usedCrop,
    ...parsed,
  };
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

  let outcome = buildOutcome(status, result, crop, imageW, imageH, true);
  if (outcome.corners) {
    return outcome;
  }

  if (!signal?.aborted) {
    const fullPayload = await buildDetectImageBlob(fullResCanvas, imageW, imageH, null);
    ({ status, result } = await postDetect(fullPayload.blob, fullPayload.width, fullPayload.height, deviceId, signal));
    outcome = buildOutcome(status, result, null, imageW, imageH, false);
    if (outcome.corners) {
      return outcome;
    }
  }

  return outcome;
}

export { getPlateBaseAngle, filterPlateCornersList, refinePlateCornersList };
