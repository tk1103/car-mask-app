'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle, RotateCcw, Share2, Facebook, Twitter, Instagram, Copy, Download, Monitor, Download as DownloadIcon } from 'lucide-react';

/** ヘッダー用。ファイル読み込みに依存せず常に表示するインラインSVG */
function CarkusLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className={className}
      aria-label="Carkus"
    >
      <text
        x={4}
        y={24}
        fontFamily="system-ui, sans-serif"
        fontSize={20}
        fontWeight={300}
        fill="currentColor"
        letterSpacing="0.15em"
      >
        Carkus
      </text>
    </svg>
  );
}

type Corner = { x: number; y: number }; // 0-1

// PWAインストールプロンプトの型定義
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
  // OpenCV.js (loaded from CDN in camera mode)
  // eslint-disable-next-line no-var
  var cv: unknown;
}
type Corners = [Corner, Corner, Corner, Corner]; // topLeft, topRight, bottomRight, bottomLeft

// API座標をクライアント座標に変換（0-1000 → 0-1）。Gemini 3 座標系に完全一致（Y軸反転なし）
function apiCornersToClient(plate: { corners: { x: number; y: number }[] }): Corners {
  return plate.corners.map((c) => ({
    x: c.x / 1000,
    y: c.y / 1000,
  })) as Corners;
}

function normalizeCornersOrder(corners: Corners): Corners {
  return corners;
}

// 3点対応のアフィン行列を算出（srcTri → dstTri）。setTransform(a,b,c,d,e,f) に渡す配列を返す。
// Canvas 2D は射影変換を直接サポートしないため、四角を2三角形に分割しそれぞれアフィンで描画してパースを近似する。
function getAffineFromTri(
  src: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ],
  dst: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ]
): [ number, number, number, number, number, number ] {
  const [ s0, s1, s2 ] = src;
  const [ d0, d1, d2 ] = dst;
  const M = [
    [ s0.x, s0.y, 1 ],
    [ s1.x, s1.y, 1 ],
    [ s2.x, s2.y, 1 ],
  ];
  const det = M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]);
  if (Math.abs(det) < 1e-10) return [ 1, 0, 0, 1, 0, 0 ];
  const inv = [
    [ (M[1][1]*M[2][2]-M[1][2]*M[2][1])/det, -(M[0][1]*M[2][2]-M[0][2]*M[2][1])/det, (M[0][1]*M[1][2]-M[0][2]*M[1][1])/det ],
    [ -(M[1][0]*M[2][2]-M[1][2]*M[2][0])/det, (M[0][0]*M[2][2]-M[0][2]*M[2][0])/det, -(M[0][0]*M[1][2]-M[0][2]*M[1][0])/det ],
    [ (M[1][0]*M[2][1]-M[1][1]*M[2][0])/det, -(M[0][0]*M[2][1]-M[0][1]*M[2][0])/det, (M[0][0]*M[1][1]-M[0][1]*M[1][0])/det ],
  ];
  const a = inv[0][0]*d0.x + inv[0][1]*d1.x + inv[0][2]*d2.x;
  const c = inv[1][0]*d0.x + inv[1][1]*d1.x + inv[1][2]*d2.x;
  const e = inv[2][0]*d0.x + inv[2][1]*d1.x + inv[2][2]*d2.x;
  const b = inv[0][0]*d0.y + inv[0][1]*d1.y + inv[0][2]*d2.y;
  const d = inv[1][0]*d0.y + inv[1][1]*d1.y + inv[1][2]*d2.y;
  const f = inv[2][0]*d0.y + inv[2][1]*d1.y + inv[2][2]*d2.y;
  return [ a, b, c, d, e, f ];
}

type QuadPx = [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ];

// 四角形を黒で塗りつぶし（マスク）
function fillQuad(ctx: CanvasRenderingContext2D, quad: QuadPx, fillStyle: string) {
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  ctx.lineTo(quad[1].x, quad[1].y);
  ctx.lineTo(quad[2].x, quad[2].y);
  ctx.lineTo(quad[3].x, quad[3].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 画像を四角形に射影変換（2三角形アフィン近似）でワープして描画
function drawImageWarpedToQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  quad: QuadPx,
  logoW: number,
  logoH: number
) {
  const [ TL, TR, BR, BL ] = quad;
  // 三角形1: TL, TR, BR（画像の (0,0)-(logoW,0)-(logoW,logoH) をマッピング）
  const srcTri1: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ] = [
    { x: 0, y: 0 },
    { x: logoW, y: 0 },
    { x: logoW, y: logoH },
  ];
  const dstTri1: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ] = [ TL, TR, BR ];
  const t1 = getAffineFromTri(srcTri1, dstTri1);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(TL.x, TL.y);
  ctx.lineTo(TR.x, TR.y);
  ctx.lineTo(BR.x, BR.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(t1[0], t1[1], t1[2], t1[3], t1[4], t1[5]);
  ctx.drawImage(img, 0, 0, logoW, logoH, 0, 0, logoW, logoH);
  ctx.restore();
  // 三角形2: TL, BR, BL（画像の (0,0)-(logoW,logoH)-(0,logoH) をマッピング）
  const srcTri2: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ] = [
    { x: 0, y: 0 },
    { x: logoW, y: logoH },
    { x: 0, y: logoH },
  ];
  const dstTri2: [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ] = [ TL, BR, BL ];
  const t2 = getAffineFromTri(srcTri2, dstTri2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(TL.x, TL.y);
  ctx.lineTo(BR.x, BR.y);
  ctx.lineTo(BL.x, BL.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(t2[0], t2[1], t2[2], t2[3], t2[4], t2[5]);
  ctx.drawImage(img, 0, 0, logoW, logoH, 0, 0, logoW, logoH);
  ctx.restore();
}

// 回転済み座標系の中心(0,0)に Carkus ロゴを描画（角丸黒背景＋SVGロゴ or 白文字「Carkus」）
// 注意: この関数は既に回転された座標系で呼ばれるため、内部で save/restore を使わない
function drawCarkusuLogoAtOrigin(
  ctx: CanvasRenderingContext2D,
  logoWidth: number,
  logoHeight: number,
  options?: { backgroundAlpha?: number },
  logoImage?: HTMLImageElement | null
) {
  const alpha = options?.backgroundAlpha ?? 0.92;
  const halfW = logoWidth / 2;
  const halfH = logoHeight / 2;
  const cornerRadius = Math.min(logoHeight * 0.1, halfW, halfH);

  ctx.beginPath();
  ctx.moveTo(-halfW + cornerRadius, -halfH);
  ctx.lineTo(halfW - cornerRadius, -halfH);
  ctx.quadraticCurveTo(halfW, -halfH, halfW, -halfH + cornerRadius);
  ctx.lineTo(halfW, halfH - cornerRadius);
  ctx.quadraticCurveTo(halfW, halfH, halfW - cornerRadius, halfH);
  ctx.lineTo(-halfW + cornerRadius, halfH);
  ctx.quadraticCurveTo(-halfW, halfH, -halfW, halfH - cornerRadius);
  ctx.lineTo(-halfW, -halfH + cornerRadius);
  ctx.quadraticCurveTo(-halfW, -halfH, -halfW + cornerRadius, -halfH);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fill();

  if (logoImage?.complete && logoImage.naturalWidth && logoImage.naturalHeight) {
    const svgAspect = logoImage.naturalWidth / logoImage.naturalHeight;
    const boxAspect = logoWidth / logoHeight;
    let drawW: number, drawH: number;
    if (svgAspect > boxAspect) {
      drawW = logoWidth * 0.9;
      drawH = drawW / svgAspect;
    } else {
      drawH = logoHeight * 0.5;
      drawW = drawH * svgAspect;
    }
    ctx.drawImage(logoImage, -drawW / 2, -drawH / 2, drawW, drawH);
  } else {
    const gothicFont = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
    ctx.fillStyle = '#ffffff';
    const testFontSize = logoHeight * 0.5;
    ctx.font = `bold ${testFontSize}px ${gothicFont}`;
    const textMetrics = ctx.measureText('Carkus');
    const maxTextWidth = logoWidth * 0.9;
    const fontSize = textMetrics.width > maxTextWidth
      ? (testFontSize * maxTextWidth / textMetrics.width)
      : testFontSize;
    ctx.font = `bold ${Math.max(12, fontSize)}px ${gothicFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Carkus', 0, 0);
  }
}

// 簡易ブレ検出：Laplacianの分散（低い＝ぼけている）
function getBlurScore(sourceCanvas: HTMLCanvasElement): number {
  const maxSize = 320;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const scale = w > h ? maxSize / w : maxSize / h;
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  ctx.drawImage(sourceCanvas, 0, 0, w, h, 0, 0, sw, sh);
  const img = ctx.getImageData(0, 0, sw, sh);
  const d = img.data;
  const stride = sw * 4;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * stride + x * 4;
      const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const l =
        4 * g -
        (d[i - stride] + d[i - stride + 1] + d[i - stride + 2]) / 3 -
        (d[i + stride] + d[i + stride + 1] + d[i + stride + 2]) / 3 -
        (d[i - 4] + d[i - 3] + d[i - 2]) / 3 -
        (d[i + 4] + d[i + 5] + d[i + 6]) / 3;
      sum += l;
      sumSq += l * l;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

const BLUR_SCORE_THRESHOLD = 120; // これ以下ならブレ警告
const API_DAILY_LIMIT = 20; // 1日のナンバー検出API利用回数上限

const OPENCV_DETECT_SIZE = 320; // 検出用の短辺（アスペクトで長辺も決める）
const DETECT_INTERVAL_MS = 150;
// 検出する四角の最小面積（画面に対する比率）。0.0015 = 約0.15%（320x240で約115px²）。これより小さいと検出されない。
const DETECT_MIN_AREA_RATIO = 0.0015;
// ロゴキャンバスのアスペクト（ナンバープレートに合わせる＝横長）。ワープ時に伸びないようにプレート比に近づける
const LOGO_CANVAS_WIDTH = 400;
const LOGO_CANVAS_HEIGHT = 88; // 約4.55:1（プレートに近い）

/** 1枚のバイナリ画像から四角形候補を探し、条件を満たす最大面積の4点を返す。 */
function findBestQuadFromBinary(
  cv: Record<string, unknown>,
  binary: { delete: () => void },
  sw: number,
  sh: number
): { points: { x: number; y: number }[]; area: number } | null {
  const contours = new (cv.MatVector as new () => { get: (i: number) => unknown; size: () => number; delete: () => void })();
  const hierarchy = new (cv.Mat as new () => { delete: () => void })();
  (cv.findContours as (img: unknown, c: unknown, h: unknown, mode: number, method: number) => void)(
    binary, contours, hierarchy, cv.RETR_LIST as number, cv.CHAIN_APPROX_SIMPLE as number
  );
  hierarchy.delete();

  let bestQuad: { points: { x: number; y: number }[]; area: number } | null = null;
  const minArea = (sw * sh) * DETECT_MIN_AREA_RATIO;
  const maxArea = (sw * sh) * 0.85;

  const parseFourPoints = (data: Int32Array): { x: number; y: number }[] | null => {
    if (!data || data.length < 8) return null;
    // レイアウト1: インターリーブ [x0,y0, x1,y1, x2,y2, x3,y3]
    const interleaved = [
      { x: data[0], y: data[1] },
      { x: data[2], y: data[3] },
      { x: data[4], y: data[5] },
      { x: data[6], y: data[7] },
    ];
    if (interleaved.every((p) => p.x >= 0 && p.x <= sw && p.y >= 0 && p.y <= sh)) return interleaved;
    // レイアウト2: チャンネル別 [x0,x1,x2,x3, y0,y1,y2,y3]（OpenCV ビルドによってはこちら）
    const channelMajor = [
      { x: data[0], y: data[4] },
      { x: data[1], y: data[5] },
      { x: data[2], y: data[6] },
      { x: data[3], y: data[7] },
    ];
    if (channelMajor.every((p) => p.x >= 0 && p.x <= sw && p.y >= 0 && p.y <= sh)) return channelMajor;
    return null;
  };

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i) as { rows?: number; data32S?: Int32Array; delete?: () => void } | undefined;
    if (!cnt) continue;
    const area = (cv.contourArea as (c: unknown) => number)(cnt);
    if (area < minArea || area > maxArea) continue;
    const epsilon = 0.04 * (cv.arcLength as (c: unknown, closed: boolean) => number)(cnt, true);
    const approx = new (cv.Mat as new () => { rows: number; data32S: Int32Array; delete: () => void })();
    (cv.approxPolyDP as (curve: unknown, approx: unknown, eps: number, closed: boolean) => void)(cnt, approx, epsilon, true);
    if (approx.rows !== 4) {
      approx.delete();
      continue;
    }
    const rect = (cv.boundingRect as (c: unknown) => { width: number; height: number })(approx);
    let rw = rect.width;
    let rh = rect.height;
    if (rw < 3 || rh < 3) {
      approx.delete();
      continue;
    }
    if (rw < rh) [rw, rh] = [rh, rw];
    const ratio = rw / rh;
    if (ratio < 1.2 || ratio > 9) {
      approx.delete();
      continue;
    }
    const points = parseFourPoints(approx.data32S);
    approx.delete();
    if (!points) continue;
    if (!bestQuad || area > bestQuad.area) bestQuad = { points, area };
  }
  contours.delete();
  return bestQuad;
}

/** OpenCVで低解像度グレースケールから四角形候補を検出し、動画ピクセル座標の QuadPx を返す。失敗時は null。 */
function detectQuadFromCanvas(
  smallCanvas: HTMLCanvasElement,
  videoWidth: number,
  videoHeight: number
): QuadPx | null {
  const w = typeof window !== 'undefined' ? window : undefined;
  const cv = w ? (w as unknown as { cv?: Record<string, unknown> }).cv as Record<string, unknown> | undefined : undefined;
  if (!cv || typeof cv.imread !== 'function' || typeof cv.Mat !== 'function') return null;

  const sw = smallCanvas.width;
  const sh = smallCanvas.height;
  if (!sw || !sh) return null;

  let src: { delete: () => void } | null = null;
  let gray: { delete: () => void } | null = null;
  let blurred: { delete: () => void } | null = null;
  let binary: { delete: () => void } | null = null;
  let edges: { delete: () => void } | null = null;
  try {
    src = cv.imread(smallCanvas) as { delete: () => void };
    gray = new (cv.Mat as new () => { delete: () => void })();
    blurred = new (cv.Mat as new () => { delete: () => void })();
    binary = new (cv.Mat as new () => { delete: () => void })();
    edges = new (cv.Mat as new () => { delete: () => void })();
    (cv.cvtColor as (a: unknown, b: unknown, code: number) => void)(src, gray, cv.COLOR_RGBA2GRAY as number);
    (cv.GaussianBlur as (a: unknown, b: unknown, k: unknown, s: number) => void)(gray, blurred, new (cv.Size as new (a: number, b: number) => unknown)(5, 5), 0);

    let bestQuad: { points: { x: number; y: number }[]; area: number } | null = null;

    // 1) Canny エッジから検出
    (cv.Canny as (a: unknown, b: unknown, l: number, h: number) => void)(blurred, edges, 25, 120);
    type QuadCandidate = { points: { x: number; y: number }[]; area: number };
    const fromCanny = findBestQuadFromBinary(cv, edges, sw, sh);
    if (fromCanny) {
      const better = bestQuad === null || fromCanny.area > (bestQuad as QuadCandidate).area;
      if (better) bestQuad = fromCanny;
    }
    // 2) 適応的閾値から検出（照明むらに強い）
    const ADAPTIVE_THRESH_GAUSSIAN_C = 1;
    const THRESH_BINARY = 0;
    if (typeof (cv as Record<string, unknown>).adaptiveThreshold === 'function') {
      (cv.adaptiveThreshold as (src: unknown, dst: unknown, maxVal: number, adaptiveMethod: number, thresholdType: number, blockSize: number, C: number) => void)(
        blurred, binary, 255, ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY, 11, 2
      );
      const fromAdaptive = findBestQuadFromBinary(cv, binary, sw, sh);
      if (fromAdaptive) {
        const better = bestQuad === null || fromAdaptive.area > (bestQuad as QuadCandidate).area;
        if (better) bestQuad = fromAdaptive;
      }
    }

    if (!bestQuad) return null;

    const pts = bestQuad.points;
    const byY = [...pts].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = byY.slice(2, 4).sort((a, b) => a.x - b.x);
    const TL = top[0] ?? pts[0];
    const TR = top[1] ?? pts[1];
    const BR = bottom[1] ?? pts[2];
    const BL = bottom[0] ?? pts[3];

    const scaleX = videoWidth / sw;
    const scaleY = videoHeight / sh;
    const quadPx: QuadPx = [
      { x: TL.x * scaleX, y: TL.y * scaleY },
      { x: TR.x * scaleX, y: TR.y * scaleY },
      { x: BR.x * scaleX, y: BR.y * scaleY },
      { x: BL.x * scaleX, y: BL.y * scaleY },
    ];
    return quadPx;
  } catch {
    return null;
  } finally {
    try {
      src?.delete?.();
      gray?.delete?.();
      blurred?.delete?.();
      binary?.delete?.();
      edges?.delete?.();
    } catch {}
  }
}

export default function Home() {
  const [screenMode, setScreenMode] = useState<'idle' | 'camera' | 'preview_edit'>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);

  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<Corners[]>([]); // 複数プレート対応
  const [editLogoOffset, setEditLogoOffset] = useState({ x: 0, y: 0 });
  const [editLogoScale, setEditLogoScale] = useState(1);
  const [editLogoRotation, setEditLogoRotation] = useState(0); // 度（-30〜30）
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [showFlash, setShowFlash] = useState(false); // フラッシュ効果用
  const [showShareMenu, setShowShareMenu] = useState(false); // SNS共有メニュー表示用
  const [isBlurWarning, setIsBlurWarning] = useState(false);
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null); // APIから返る本日の残り回数（null=未取得）
  const [carkusuLogoImage, setCarkusuLogoImage] = useState<HTMLImageElement | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAttemptCountRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number; startOffset: { x: number; y: number } } | null>(null);
  const scaleStartRef = useRef<{ y: number; startScale: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const logoCanvasRef = useRef<HTMLCanvasElement | null>(null); // マスク画像が無いときのロゴ用オフスクリーン
  const opencvReadyRef = useRef(false);
  const liveQuadRef = useRef<QuadPx | null>(null);
  const cameraOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [overlayCanvasReady, setOverlayCanvasReady] = useState(false); // オーバーレイ用キャンバスがマウントされたら true（描画ループ開始のトリガー）
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null); // 320x240 for OpenCV
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const [opencvReady, setOpencvReady] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setMaskImage(img);
    img.onerror = () => setMaskImage(null);
    img.src = '/mask-logo.png';
  }, []);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setCarkusuLogoImage(img);
    img.onerror = () => setCarkusuLogoImage(null);
    img.src = '/Carkus.svg';
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => {}).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);
    setIsAndroid(/Android/.test(navigator.userAgent));
    const standalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);
    const onBeforeInstall = (e: Event) => { e.preventDefault(); setDeferredPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  /** 画面表示用に残り回数を取得（APIは消費しない） */
  const fetchRemainingQuota = useCallback(async () => {
    try {
      const res = await fetch('/api/detect-plate');
      if (res.ok) {
        const data = await res.json();
        if (typeof data.remainingToday === 'number') setDailyRemaining(data.remainingToday);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (screenMode === 'idle' || screenMode === 'camera') fetchRemainingQuota();
  }, [screenMode, fetchRemainingQuota]);

  // OpenCV.js をカメラモード時のみ読み込む（同一オリジン優先 → CDN フォールバック）
  useEffect(() => {
    if (screenMode !== 'camera') return;
    const trySetReady = () => {
      try {
        const cv = (window as unknown as { cv?: { Mat?: new () => { delete?: () => void } } }).cv;
        if (!cv?.Mat) return false;
        const m = new cv.Mat();
        if (m && typeof (m as { delete?: () => void }).delete === 'function') {
          (m as { delete: () => void }).delete();
        }
        opencvReadyRef.current = true;
        setOpencvReady(true);
        return true;
      } catch {
        return false;
      }
    };
    if (trySetReady()) return;
    if (document.querySelector('script[src*="opencv"]')) {
      const poll = setInterval(() => { if (trySetReady()) clearInterval(poll); }, 300);
      return () => clearInterval(poll);
    }

    const sources = [
      '/opencv.js', // 同一オリジン（public/opencv.js を配置すると確実）
      'https://unpkg.com/@techstark/opencv-js@4.11.0-release.1/dist/opencv.js', // npm 経由の CDN
      'https://docs.opencv.org/4.8.0/opencv.js',
    ];
    let index = 0;
    const tryNext = () => {
      if (index >= sources.length) {
        setCameraError('OpenCV の読み込みに失敗しました。public フォルダに opencv.js を配置するか、ネットワークを確認してください。');
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.src = sources[index];
      script.onload = () => {
        const cv = (window as unknown as { cv?: { Mat?: unknown; onRuntimeInitialized?: () => void } }).cv;
        if (!cv) {
          index++;
          tryNext();
          return;
        }
        if (trySetReady()) return;
        (cv as Record<string, unknown>).onRuntimeInitialized = () => {
          opencvReadyRef.current = true;
          setOpencvReady(true);
        };
        const poll = setInterval(() => { if (trySetReady()) clearInterval(poll); }, 200);
        setTimeout(() => clearInterval(poll), 15000);
      };
      script.onerror = () => {
        script.remove();
        index++;
        tryNext();
      };
      document.head.appendChild(script);
    };
    tryNext();

    return () => {
      document.querySelectorAll('script[src*="opencv"]').forEach((s) => s.remove());
    };
  }, [screenMode]);

  // リアルタイム矩形検出（低解像・グレースケール）。OpenCV 用の小さいキャンバスは DOM に置く（imread が動く環境があるため）。
  useEffect(() => {
    if (screenMode !== 'camera' || !stream) return;
    const video = videoRef.current;
    if (!video) return;

    let smallCanvas = smallCanvasRef.current;
    if (!smallCanvas) {
      smallCanvas = document.createElement('canvas');
      smallCanvas.width = OPENCV_DETECT_SIZE;
      smallCanvas.height = Math.round((OPENCV_DETECT_SIZE * (video.videoHeight || 9)) / (video.videoWidth || 16)) || 240;
      smallCanvas.setAttribute('data-opencv-input', '1');
      smallCanvasRef.current = smallCanvas;
      smallCanvas.style.cssText = 'position:absolute;left:-9999px;width:320px;height:240px;pointer-events:none;';
      document.body.appendChild(smallCanvas);
    }
    const ctx = smallCanvas.getContext('2d');
    if (!ctx) return;

    const tick = () => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || !v.videoHeight) return;
      if (smallCanvas.width !== OPENCV_DETECT_SIZE) {
        smallCanvas.width = OPENCV_DETECT_SIZE;
        smallCanvas.height = Math.round((OPENCV_DETECT_SIZE * v.videoHeight) / v.videoWidth) || 240;
      }
      ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, smallCanvas.width, smallCanvas.height);
      const quad = detectQuadFromCanvas(smallCanvas, v.videoWidth, v.videoHeight);
      liveQuadRef.current = quad;
    };

    const id = setInterval(tick, DETECT_INTERVAL_MS);
    detectionIntervalRef.current = id;
    tick();
    return () => {
      clearInterval(id);
      detectionIntervalRef.current = null;
      liveQuadRef.current = null;
      if (smallCanvasRef.current?.parentNode) {
        smallCanvasRef.current.parentNode.removeChild(smallCanvasRef.current);
      }
      smallCanvasRef.current = null;
    };
  }, [screenMode, stream]);

  // カメラオーバーレイ描画（OpenCV で検出した四角にマスク＋ロゴを表示）。キャンバスがマウントされたら描画ループ開始。
  useEffect(() => {
    if (screenMode !== 'camera') return;

    const draw = () => {
      if (screenMode !== 'camera') return;
      const v = videoRef.current;
      const c = cameraOverlayCanvasRef.current;
      if (!c) {
        overlayRafRef.current = requestAnimationFrame(draw);
        return;
      }
      const ctx = c.getContext('2d');
      if (!ctx) {
        overlayRafRef.current = requestAnimationFrame(draw);
        return;
      }
      const vw = v?.videoWidth ?? 0;
      const vh = v?.videoHeight ?? 0;
      if (vw > 0 && vh > 0) {
        if (c.width !== vw || c.height !== vh) {
          c.width = vw;
          c.height = vh;
        }
      } else {
        const rect = c.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (c.width !== rect.width || c.height !== rect.height)) {
          c.width = rect.width;
          c.height = rect.height;
        }
      }
      const w = c.width;
      const h = c.height;
      if (w < 1 || h < 1) {
        overlayRafRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.clearRect(0, 0, w, h);
      const quad = liveQuadRef.current;
      if (quad && maskImage !== undefined) {
        fillQuad(ctx, quad, 'rgba(0,0,0,0.92)');
        if (maskImage?.complete && maskImage.naturalWidth) {
          drawImageWarpedToQuad(ctx, maskImage, quad, maskImage.naturalWidth, maskImage.naturalHeight);
        } else {
          let logoCanvas = logoCanvasRef.current;
          if (!logoCanvas) {
            logoCanvas = document.createElement('canvas');
            logoCanvas.width = LOGO_CANVAS_WIDTH;
            logoCanvas.height = LOGO_CANVAS_HEIGHT;
            logoCanvasRef.current = logoCanvas;
            const lctx = logoCanvas.getContext('2d');
            if (lctx) {
              lctx.clearRect(0, 0, LOGO_CANVAS_WIDTH, LOGO_CANVAS_HEIGHT);
              lctx.save();
              lctx.translate(LOGO_CANVAS_WIDTH / 2, LOGO_CANVAS_HEIGHT / 2);
              drawCarkusuLogoAtOrigin(lctx, LOGO_CANVAS_WIDTH * 0.95, LOGO_CANVAS_HEIGHT * 0.95, { backgroundAlpha: 0.92 }, carkusuLogoImage ?? undefined);
              lctx.restore();
            }
          }
          if (logoCanvasRef.current) {
            const lc = logoCanvasRef.current;
            drawImageWarpedToQuad(ctx, lc, quad, lc.width, lc.height);
          }
        }
      } else {
        const msg = vw > 0 ? 'プレビュー: 検出中' : '読み込み中...';
        ctx.save();
        ctx.font = '16px sans-serif';
        const metrics = ctx.measureText(msg);
        const pad = 10;
        const x = w - metrics.width - pad - 10;
        const y = h - 26;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(x - pad, y - 16, metrics.width + pad * 2, 24);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillText(msg, x, y);
        ctx.restore();
      }
      overlayRafRef.current = requestAnimationFrame(draw);
    };
    overlayRafRef.current = requestAnimationFrame(draw);
    return () => {
      if (overlayRafRef.current != null) cancelAnimationFrame(overlayRafRef.current);
      overlayRafRef.current = null;
    };
  }, [screenMode, maskImage, carkusuLogoImage, overlayCanvasReady]);

  const handleInstallClick = useCallback(async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
      } catch (_) {}
    } else {
      setShowInstallGuide(true);
    }
  }, [deferredPrompt]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('カメラを利用するには https でアクセスしてください。');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = s;
      setStream(s);
      setScreenMode('camera');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(msg.includes('Permission') ? 'カメラの許可をオンにしてください。' : 'カメラを起動できませんでした。許可と接続をご確認ください。');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setScreenMode('idle');
    setCameraError(null);
    setPreviewImageUrl(null);
    setDetectedCorners([]);
    setEditLogoOffset({ x: 0, y: 0 });
    setEditLogoScale(1);
    setEditLogoRotation(0);
    playAttemptCountRef.current = 0;
  }, []);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    const video = videoRef.current;
    const t = setTimeout(() => {
      video.srcObject = stream;
      video.play().catch(() => {});
    }, 100);
    return () => clearTimeout(t);
  }, [stream]);

  // カメラ画面に戻ったとき（撮り直し含む）にストリームを再設定する。プレビューで video がアンマウントされるため必須。
  useEffect(() => {
    if (screenMode !== 'camera' || !videoRef.current) return;
    const v = videoRef.current;
    const streamToUse = streamRef.current;
    if (streamToUse) {
      v.srcObject = streamToUse;
    }
    playAttemptCountRef.current = 0;
    const tryPlay = () => {
      if (playAttemptCountRef.current < 5) {
        playAttemptCountRef.current++;
        v.play().catch(() => {});
      }
    };
    const t = setTimeout(() => {
      tryPlay();
      const id = setInterval(tryPlay, 400);
      setTimeout(() => clearInterval(id), 2000);
    }, 150);
    return () => clearTimeout(t);
  }, [screenMode]);

  // 画像の明るさを検知（0-255の平均輝度を返す）
  const detectBrightness = useCallback((canvas: HTMLCanvasElement): number => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 128; // デフォルト値（中間の明るさ）
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let sum = 0;
    
    // RGB値から輝度を計算（サンプリング：10ピクセルごと）
    for (let i = 0; i < data.length; i += 40) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 輝度計算式: 0.299*R + 0.587*G + 0.114*B
      const brightness = r * 0.299 + g * 0.587 + b * 0.114;
      sum += brightness;
    }
    
    return sum / (data.length / 40);
  }, []);

  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    // 撮影前に残数チェック（ローディングを出さずに即エラーにする）
    try {
      const quotaRes = await fetch('/api/detect-plate');
      if (quotaRes.ok) {
        const quotaData = await quotaRes.json();
        const remaining = quotaData.remainingToday;
        if (typeof remaining === 'number') setDailyRemaining(remaining);
        if (remaining === 0) {
          setCameraError(`本日の検出回数（${API_DAILY_LIMIT}回）に達しました。明日またお試しください。`);
          return;
        }
      }
    } catch (_) {}

    // フラッシュ効果を表示
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 200);

    // 明るさを検知してフラッシュの必要性を判定
    const brightnessCanvas = document.createElement('canvas');
    brightnessCanvas.width = Math.min(video.videoWidth, 320);
    brightnessCanvas.height = Math.min(video.videoHeight, 240);
    const brightnessCtx = brightnessCanvas.getContext('2d');
    if (brightnessCtx) {
      brightnessCtx.drawImage(video, 0, 0, brightnessCanvas.width, brightnessCanvas.height);
    }
    const avgBrightness = detectBrightness(brightnessCanvas);
    const isDark = avgBrightness < 100; // 閾値100（0-255の範囲で、100以下は暗いと判定）

    // 実際のカメラフラッシュを有効化（暗い場合のみ、API能力を活かすため）
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    let flashEnabled = false;
    if (isDark && videoTrack && 'applyConstraints' in videoTrack) {
      try {
        await videoTrack.applyConstraints({
          advanced: [{ torch: true } as any],
        });
        flashEnabled = true;
        console.log(`Flash enabled (brightness: ${avgBrightness.toFixed(1)})`);
      } catch (e) {
        // フラッシュがサポートされていない場合は無視
        console.log('Flash not supported:', e);
      }
    } else {
      console.log(`Flash skipped (brightness: ${avgBrightness.toFixed(1)}, threshold: 100)`);
    }

    setIsProcessing(true);
    setCameraError(null);

    try {
      const originalW = video.videoWidth;
      const originalH = video.videoHeight;
      
      // 高解像度画像を保存用にキャプチャ（後で使用）
      const fullResCanvas = document.createElement('canvas');
      fullResCanvas.width = originalW;
      fullResCanvas.height = originalH;
      const fullResCtx = fullResCanvas.getContext('2d');
      if (!fullResCtx) throw new Error('Canvas error');
      
      // フラッシュを有効化した後、少し待ってからキャプチャ（フラッシュが点灯する時間を確保）
      if (flashEnabled) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      
      fullResCtx.drawImage(video, 0, 0, originalW, originalH);
      
      // キャプチャ後、フラッシュをオフ
      if (flashEnabled && videoTrack && 'applyConstraints' in videoTrack) {
        try {
          await videoTrack.applyConstraints({
            advanced: [{ torch: false } as any],
          });
        } catch (e) {
          console.log('Failed to disable flash:', e);
        }
      }
      
      const fullResBlob = await new Promise<Blob>((resolve, reject) => {
        fullResCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.98);
      });

      // API送信画像は長辺512に制限（軽量化で解析速度を確保）
      const maxApiLongEdge = 512;
      const apiScale = Math.min(maxApiLongEdge / Math.max(originalW, originalH), 1);
      const apiW = Math.round(originalW * apiScale);
      const apiH = Math.round(originalH * apiScale);
      const apiCanvas = document.createElement('canvas');
      apiCanvas.width = apiW;
      apiCanvas.height = apiH;
      const apiCtx = apiCanvas.getContext('2d');
      if (!apiCtx) throw new Error('Canvas error');
      apiCtx.imageSmoothingEnabled = true;
      apiCtx.imageSmoothingQuality = 'low';
      apiCtx.filter = 'contrast(1.4) brightness(1.1)';
      apiCtx.drawImage(fullResCanvas, 0, 0, originalW, originalH, 0, 0, apiW, apiH);
      apiCtx.filter = 'none';

      const apiBlob = await new Promise<Blob>((resolve, reject) => {
        apiCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.1);
      });

      // 撮影後すぐプレビュー表示（体感短縮）。ブレ検出は非同期で実行しAPI呼び出しを遅らせない
      setPreviewImageUrl(URL.createObjectURL(fullResBlob));
      setScreenMode('preview_edit');
      setDetectedCorners([]);
      setIsProcessing(true);
      setCameraError(null);
      // ブレ検出を非同期化（API呼び出しをブロックしない）
      setTimeout(() => {
        const blurScore = getBlurScore(apiCanvas);
        setIsBlurWarning(blurScore < BLUR_SCORE_THRESHOLD);
      }, 0);

      const createFormData = () => {
        const fd = new FormData();
        fd.append('image', apiBlob, 'photo.jpg');
        fd.append('width', apiW.toString());
        fd.append('height', apiH.toString());
        return fd;
      };

      const performFetch = async (retryCount: number): Promise<Response> => {
        const controller = new AbortController();
        const fetchStart = Date.now();
        const timeoutId = setTimeout(() => controller.abort(), 17_000); // 17秒でタイムアウト（API側15sと合わせる）
        try {
          const res = await fetch('/api/detect-plate', { method: 'POST', body: createFormData(), signal: controller.signal });
          clearTimeout(timeoutId);
          const elapsed = Date.now() - fetchStart;
          console.log(`[client] API fetch completed in ${elapsed}ms, status=${res.status}`);
          return res;
        } catch (fetchErr: unknown) {
          clearTimeout(timeoutId);
          const elapsed = Date.now() - fetchStart;
          if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
            console.error(`[client] API fetch timeout after ${elapsed}ms`);
          } else {
            console.error(`[client] API fetch error after ${elapsed}ms:`, fetchErr);
          }
          if (retryCount === 0 && (fetchErr instanceof Error && fetchErr.name === 'AbortError' || fetchErr instanceof TypeError)) {
            setCameraError('画像サイズを小さくして再試行しています...');
            await new Promise((resolve) => setTimeout(resolve, 100));
            return performFetch(1);
          }
          throw fetchErr;
        }
      };

      let res: Response;
      try {
        res = await performFetch(0);
      } catch (fetchErr: unknown) {
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          setCameraError('解析がタイムアウトしました。通信環境を確認してもう一度お試しください。');
        } else {
          setCameraError('解析に失敗しました。通信を確認してもう一度お試しください。');
        }
        setDetectedCorners([[
          { x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 },
          { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }
        ]]);
        setDetectionFailed(true);
        setIsProcessing(false);
        return;
      }
      const result = await res.json();

      if (!res.ok) {
        const videoTrack = streamRef.current?.getVideoTracks()[0];
        if (videoTrack && 'applyConstraints' in videoTrack) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
          } catch (_) {}
        }
        const raw = (result.error || '') as string;
        const isQuota = res.status === 429 || /quota|rate limit|exceeded/i.test(raw);
        const message = (result as { userMessage?: string }).userMessage
          ?? (isQuota ? `本日の検出回数（${API_DAILY_LIMIT}回）に達しました。明日またお試しください。` : (result.error || `解析に失敗しました（${res.status}）`));
        setCameraError(message);
        const remaining = (result as { remainingToday?: number }).remainingToday;
        if (remaining !== undefined) setDailyRemaining(remaining);
        setDetectedCorners([[
          { x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 },
          { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }
        ]]);
        setDetectionFailed(true);
        setIsProcessing(false);
        return;
      }

      if (result.found && result.plates && Array.isArray(result.plates) && result.plates.length > 0) {
        const platesCorners: Corners[] = result.plates
          .filter((plate: any) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4)
          .map((plate: any) => normalizeCornersOrder(apiCornersToClient(plate)));
        if (platesCorners.length > 0) {
          setDetectionFailed(false);
          setDetectedCorners(platesCorners);
          setEditLogoOffset({ x: 0, y: 0 });
          setEditLogoScale(1);
          setEditLogoRotation(0);
        } else {
          setDetectionFailed(true);
          setDetectedCorners([[
            { x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 },
            { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }
          ]]);
          setCameraError('プレートの座標が不正でした。手動で調整してください。');
        }
      } else if (result.found && result.corners && Array.isArray(result.corners) && result.corners.length === 4) {
        setDetectionFailed(false);
        const single = normalizeCornersOrder(apiCornersToClient({ corners: result.corners }));
        setDetectedCorners([single]);
        setEditLogoOffset({ x: 0, y: 0 });
        setEditLogoScale(1);
        setEditLogoRotation(0);
      } else {
        setDetectionFailed(true);
        setDetectedCorners([[
          { x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 },
          { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }
        ]]);
        setEditLogoOffset({ x: 0, y: 0 });
        setEditLogoScale(1);
        setEditLogoRotation(0);
        setCameraError('AIが自動検出できなかったため、手動で調整してください。');
      }
      const remaining = (result as { remainingToday?: number }).remainingToday;
      if (remaining !== undefined) setDailyRemaining(remaining);
      setIsProcessing(false);
    } catch (e) {
      const videoTrack = streamRef.current?.getVideoTracks()[0];
      if (videoTrack && 'applyConstraints' in videoTrack) {
        try {
          await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
        } catch (_) {}
      }
      setCameraError('解析に失敗しました。しばらく経ってから再度お試しください。');
      setDetectedCorners([[
        { x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 },
        { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }
      ]]);
      setDetectionFailed(true);
      setIsProcessing(false);
    }
  }, []);

  const retake = useCallback(() => {
    if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
    setPreviewImageUrl(null);
    setDetectedCorners([]);
    setEditLogoOffset({ x: 0, y: 0 });
    setEditLogoScale(1);
    setEditLogoRotation(0);
    setPreviewImageLoaded(false);
    setCameraError(null);
    setIsBlurWarning(false);
    setDetectionFailed(false);
    setScreenMode('camera');
    // ストリーム再設定は screenMode の useEffect で行う（video は再マウント後のため、ここでは ref がまだ更新されていない場合がある）
    // フォールバック: DOM 更新後に再設定を試みる
    const stream = streamRef.current;
    if (stream) {
      const applyStream = () => {
        const video = videoRef.current;
        if (video && stream.active) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      };
      setTimeout(applyStream, 250);
      setTimeout(applyStream, 600);
    }
  }, [previewImageUrl]);

  useEffect(() => {
    if (!previewImageUrl) {
      previewImageRef.current = null;
      setPreviewImageLoaded(false);
      return;
    }
    setPreviewImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      previewImageRef.current = img;
      setPreviewImageLoaded(true);
    };
    img.src = previewImageUrl;
    return () => {
      previewImageRef.current = null;
    };
  }, [previewImageUrl]);

  useEffect(() => {
    if (screenMode !== 'preview_edit' || !previewCanvasRef.current || !previewImageLoaded) return;
    const img = previewImageRef.current;
    if (!img || !img.width) return;

    const canvas = previewCanvasRef.current;
    const w = img.width;
    const h = img.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 高品質描画設定（プレビュー表示用、保存時はtoBlobで品質を制御）
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0);

    if (detectedCorners.length > 0 && (maskImage?.complete || true)) {
      const scale = editLogoScale;
      const cosR = Math.cos((editLogoRotation * Math.PI) / 180);
      const sinR = Math.sin((editLogoRotation * Math.PI) / 180);

      // マスク画像が無いとき用のロゴキャンバス（黒背景＋Carkus）。アスペクトをプレートに合わせて横伸びしないように
      if (!maskImage?.complete || !maskImage.naturalWidth) {
        const Lw = LOGO_CANVAS_WIDTH;
        const Lh = LOGO_CANVAS_HEIGHT;
        let logoCanvas = logoCanvasRef.current;
        if (!logoCanvas) {
          logoCanvas = document.createElement('canvas');
          logoCanvas.width = Lw;
          logoCanvas.height = Lh;
          logoCanvasRef.current = logoCanvas;
        }
        const lctx = logoCanvas.getContext('2d');
        if (lctx) {
          lctx.clearRect(0, 0, Lw, Lh);
          lctx.save();
          lctx.translate(Lw / 2, Lh / 2);
          drawCarkusuLogoAtOrigin(lctx, Lw * 0.95, Lh * 0.95, { backgroundAlpha: 0.92 }, carkusuLogoImage);
          lctx.restore();
        }
      }

      detectedCorners.forEach((corners) => {
        const centerNx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        const centerNy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        const centerX = centerNx * w;
        const centerY = centerNy * h;

        const scaled: Corners = corners.map((c) => ({
          x: centerNx + (c.x - centerNx) * scale,
          y: centerNy + (c.y - centerNy) * scale,
        })) as Corners;

        const dx = scaled[1].x - scaled[0].x;
        const dy = scaled[1].y - scaled[0].y;
        const baseAngle = Math.atan2(dy, dx);
        const finalRotation = baseAngle + (editLogoRotation * Math.PI) / 180;
        const cf = Math.cos(finalRotation);
        const sf = Math.sin(finalRotation);

        const plateWidth = Math.hypot((scaled[1].x - scaled[0].x) * w, (scaled[1].y - scaled[0].y) * h);
        const plateHeightLeft = Math.hypot((scaled[3].x - scaled[0].x) * w, (scaled[3].y - scaled[0].y) * h);
        const plateHeightRight = Math.hypot((scaled[2].x - scaled[1].x) * w, (scaled[2].y - scaled[1].y) * h);
        const plateHeight = (plateHeightLeft + plateHeightRight) / 2;
        const logoWidth = plateWidth * 1.1;
        const logoHeight = plateHeight * 1.1;
        const offsetX = (editLogoOffset.x / 100) * logoWidth;
        const offsetY = (editLogoOffset.y / 100) * logoHeight;
        const offsetPxX = offsetX * cf - offsetY * sf;
        const offsetPxY = offsetX * sf + offsetY * cf;

        // 4隅をピクセル座標に（スケール→回転→オフセット）
        const quadPx: QuadPx = scaled.map((c) => {
          const px = c.x * w - centerX;
          const py = c.y * h - centerY;
          return {
            x: centerX + px * cf - py * sf + offsetPxX,
            y: centerY + px * sf + py * cf + offsetPxY,
          };
        }) as QuadPx;

        // 1) 黒マスクを四角で塗りつぶし（パースに合わせた四角形）
        fillQuad(ctx, quadPx, 'rgba(0,0,0,0.92)');

        // 2) ロゴ／マスク画像を同じ四角に射影変換（2三角形アフィン）でワープして合成
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (maskImage && maskImage.complete && maskImage.naturalWidth) {
          drawImageWarpedToQuad(ctx, maskImage, quadPx, maskImage.naturalWidth, maskImage.naturalHeight);
        } else if (logoCanvasRef.current) {
          const c = logoCanvasRef.current;
          drawImageWarpedToQuad(ctx, c, quadPx, c.width, c.height);
        }
      });
    }
  }, [screenMode, previewImageLoaded, detectedCorners, maskImage, carkusuLogoImage, editLogoOffset, editLogoScale, editLogoRotation]);

  const handleSaveFromPreview = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      previewCanvasRef.current.toBlob(
        async (blob) => {
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          const file = new File([blob], `number-mask-${Date.now()}.jpg`, { type: 'image/jpeg' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Carkusu' });
            setShowSaveSuccess(true);
            setTimeout(() => setShowSaveSuccess(false), 2500);
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(a.href);
            setShowSaveSuccess(true);
            setTimeout(() => setShowSaveSuccess(false), 2500);
          }
          setIsProcessing(false);
        },
        'image/jpeg',
        0.99
      );
    } catch (e) {
      setIsProcessing(false);
    }
  }, []);

  const handleShareToSNS = useCallback(async (platform: 'facebook' | 'twitter' | 'instagram') => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      previewCanvasRef.current.toBlob(
        async (blob) => {
          if (!blob) {
            setIsProcessing(false);
            return;
          }

          const file = new File([blob], `automoni-${Date.now()}.jpg`, { type: 'image/jpeg' });

          // navigator.share APIを使用してネイティブのShare Sheetを開く
          // これにより、登録されているSNSアプリが直接選択できる
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            try {
              // プラットフォームに応じたテキストを設定
              const shareTexts: Record<string, string> = {
                facebook: 'Carkusuでナンバープレートをマスクしました',
                twitter: 'Carkusuでナンバープレートをマスクしました',
                instagram: 'Carkusuでナンバープレートをマスクしました',
              };

              await navigator.share({
                files: [file],
                title: 'Carkusu',
                text: shareTexts[platform] || 'Carkusuでナンバープレートをマスクしました',
              });
              
              setShowShareMenu(false);
              setShowSaveSuccess(true);
              setTimeout(() => setShowSaveSuccess(false), 2500);
            } catch (shareError: any) {
              // ユーザーがキャンセルした場合はエラーを無視
              if (shareError.name !== 'AbortError') {
                console.error('Share error:', shareError);
                setCameraError('共有に失敗しました');
              }
            }
          } else {
            // Share APIが使えない場合、画像をサーバーに一時アップロードしてURLを共有
            try {
              const formData = new FormData();
              formData.append('image', file);

              const uploadRes = await fetch('/api/upload-image', {
                method: 'POST',
                body: formData,
              });

              if (!uploadRes.ok) {
                throw new Error('画像のアップロードに失敗しました');
              }

              const uploadData = await uploadRes.json();
              const imageUrl = uploadData.url;

              // 各SNSの共有URLを構築
              const shareUrls: Record<string, string> = {
                facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(imageUrl)}`,
                twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent('Carkusuでナンバープレートをマスクしました')}&url=${encodeURIComponent(imageUrl)}`,
                instagram: `https://www.instagram.com/create/select/`,
              };

              // SNSの共有URLを開く
              window.open(shareUrls[platform], '_blank');
              
              setShowShareMenu(false);
              setShowSaveSuccess(true);
              setTimeout(() => setShowSaveSuccess(false), 2500);
            } catch (uploadError) {
              console.error('Upload error:', uploadError);
              // エラー時はクリップボードにコピーしてフォールバック
              try {
                await navigator.clipboard.write([
                  new ClipboardItem({ 'image/jpeg': blob }),
                ]);
                const urls: Record<string, string> = {
                  facebook: 'https://www.facebook.com',
                  twitter: 'https://twitter.com/compose/tweet',
                  instagram: 'https://www.instagram.com/create/select/',
                };
                window.open(urls[platform], '_blank');
                setShowShareMenu(false);
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 2500);
              } catch (clipboardError) {
                // クリップボードAPIが使えない場合、ダウンロードにフォールバック
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = file.name;
                a.click();
                URL.revokeObjectURL(a.href);
                setShowShareMenu(false);
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 2500);
                setCameraError('共有に失敗しました。画像をダウンロードしました。');
              }
            }
          }
          setIsProcessing(false);
        },
        'image/jpeg',
        0.99
      );
    } catch (e) {
      setIsProcessing(false);
      setCameraError('画像の処理に失敗しました');
    }
  }, []);

  /** 端末に保存（ダウンロード or 共有シートで「画像を保存」を選択） */
  const handleSaveToDevice = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      previewCanvasRef.current.toBlob(
        async (blob) => {
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          const file = new File([blob], `automoni-${Date.now()}.jpg`, { type: 'image/jpeg' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: 'Carkusu',
                text: '画像を端末に保存する場合は「画像を保存」などを選んでください。',
              });
              setShowShareMenu(false);
              setShowSaveSuccess(true);
              setTimeout(() => setShowSaveSuccess(false), 2500);
            } catch (shareErr: any) {
              if (shareErr.name !== 'AbortError') {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = file.name;
                a.click();
                URL.revokeObjectURL(a.href);
                setShowShareMenu(false);
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 2500);
              }
            }
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(a.href);
            setShowShareMenu(false);
            setShowSaveSuccess(true);
            setTimeout(() => setShowSaveSuccess(false), 2500);
          }
          setIsProcessing(false);
        },
        'image/jpeg',
        0.99
      );
    } catch (e) {
      setIsProcessing(false);
    }
  }, []);

  /** 近くのPCなどに共有（共有シートに「近くのデバイス」が出る場合あり） */
  const handleShareToNearbyDevice = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      previewCanvasRef.current.toBlob(
        async (blob) => {
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          const file = new File([blob], `automoni-${Date.now()}.jpg`, { type: 'image/jpeg' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: 'Carkusu',
                text: '近くのPCやデバイスを選択して共有できます。',
              });
              setShowShareMenu(false);
              setShowSaveSuccess(true);
              setTimeout(() => setShowSaveSuccess(false), 2500);
            } catch (shareErr: any) {
              if (shareErr.name !== 'AbortError') setCameraError('共有に失敗しました');
            }
          } else {
            setCameraError('お使いの環境では共有シートを利用できません。');
          }
          setIsProcessing(false);
        },
        'image/jpeg',
        0.99
      );
    } catch (e) {
      setIsProcessing(false);
    }
  }, []);

  const handleCopyToClipboard = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      previewCanvasRef.current.toBlob(
        async (blob) => {
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/jpeg': blob }),
            ]);
            setShowShareMenu(false);
            setShowSaveSuccess(true);
            setTimeout(() => setShowSaveSuccess(false), 2500);
          } catch (clipboardError) {
            setCameraError('クリップボードへのコピーに失敗しました');
          }
          setIsProcessing(false);
        },
        'image/jpeg',
        0.99
      );
    } catch (e) {
      setIsProcessing(false);
    }
  }, []);

  const onPreviewTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        dragStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          startOffset: { ...editLogoOffset },
        };
      } else if (e.touches.length === 2) {
        const dy = Math.abs(e.touches[1].clientY - e.touches[0].clientY);
        scaleStartRef.current = { y: dy, startScale: editLogoScale };
      }
    },
    [editLogoOffset, editLogoScale]
  );

  const onPreviewTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1 && dragStartRef.current) {
        const dx = e.touches[0].clientX - dragStartRef.current.x;
        const dy = e.touches[0].clientY - dragStartRef.current.y;
        setEditLogoOffset({
          x: dragStartRef.current.startOffset.x + dx * 0.5,
          y: dragStartRef.current.startOffset.y + dy * 0.5,
        });
      } else if (e.touches.length === 2 && scaleStartRef.current) {
        const dy = Math.abs(e.touches[1].clientY - e.touches[0].clientY);
        const delta = (dy - scaleStartRef.current.y) * 0.01;
        setEditLogoScale(Math.max(0.3, Math.min(2, scaleStartRef.current.startScale + delta)));
      }
    },
    []
  );

  const onPreviewTouchEnd = useCallback(() => {
    dragStartRef.current = null;
    scaleStartRef.current = null;
  }, []);

  const fontFamily = '"Helvetica Neue", Helvetica, "Hiragino Sans", "Yu Gothic", sans-serif';

  return (
    <div className="min-h-screen bg-black" style={{ fontFamily }}>
      {screenMode === 'idle' && (
        <header className="sticky top-0 z-10 bg-white/10 backdrop-blur-md border-b border-white/10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-2 flex-wrap">
            <span className="h-6 flex items-center shrink-0 text-white">
              <CarkusLogo className="h-full w-auto" />
            </span>
            <span className="px-2 py-0.5 rounded-md bg-white/20 backdrop-blur-sm border border-white/10 text-white/90 text-[10px] font-medium tracking-widest shrink-0">BETA</span>
            <span className="text-white/90 text-xs font-extralight shrink-0">ver0.8</span>
          </div>
        </header>
      )}

      {showSaveSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white/20 backdrop-blur-xl border border-white/10 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            <CheckCircle className="text-emerald-300" size={40} strokeWidth={2} />
            <p className="text-white font-light">保存しました</p>
            <p className="text-white/80 text-xs font-extralight">ご利用ありがとうございます</p>
          </div>
        </div>
      )}

      {cameraError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-5 max-w-sm shadow-2xl flex flex-col items-center gap-4">
            <p className="text-white font-light text-sm text-center leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={() => setCameraError(null)}
              className="px-6 py-2.5 rounded-full bg-white/20 text-white text-sm font-light backdrop-blur-md border border-white/10 hover:bg-white/30 active:bg-white/40 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {screenMode === 'camera' && (
        <div className="fixed inset-0 z-0 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <canvas
            ref={(el) => {
              (cameraOverlayCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
              setOverlayCanvasReady(!!el);
            }}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none z-[5]"
            style={{ left: 0, top: 0, right: 0, bottom: 0 }}
          />
          {showFlash && (
            <div className="absolute inset-0 bg-white z-30 pointer-events-none" style={{ animation: 'flash 0.2s ease-out' }} />
          )}
          {isProcessing && (
            <div className="absolute inset-0 bg-black/30 backdrop-blur-md flex flex-col items-center justify-between z-10 px-4 py-8">
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin text-white" size={48} strokeWidth={2.5} />
                <p className="text-white font-light text-sm">AIが愛車をスキャン中...</p>
                <p className="text-white/80 text-xs font-extralight text-center max-w-xs">少々お待ちください</p>
              </div>
              <div className="w-full min-h-[100px] flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-lg border border-white/10">
                <span className="text-white/40 text-xs">広告枠（ベータ）</span>
              </div>
            </div>
          )}
          <div className="absolute top-0 left-0 right-0 z-20 pt-[env(safe-area-inset-top)] pb-4 px-4 bg-white/10 backdrop-blur-md border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 shrink-0">
                <span className="h-5 flex items-center shrink-0 text-white">
                  <CarkusLogo className="h-full w-auto" />
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/20 backdrop-blur-sm border border-white/10 text-white/90 text-[10px] font-medium tracking-widest">BETA</span>
              </div>
              <button
                onClick={stopCamera}
                className="py-2 px-4 rounded-full bg-white/20 text-white text-sm font-light backdrop-blur-md border border-white/10 hover:bg-white/30 active:bg-white/40 transition-colors"
              >
                終了
              </button>
            </div>
            {cameraError && <p className="mt-2 text-red-300 text-xs font-light">{cameraError}</p>}
            <p className="mt-1 text-white/70 text-sm font-light">本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-20 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12 bg-black/30 backdrop-blur-md border-t border-white/10 flex flex-col items-center gap-2">
            <button
              onClick={captureAndDetect}
              disabled={isProcessing}
              className="min-w-[8rem] px-6 py-3 rounded-full bg-white/20 backdrop-blur-md border border-white/10 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {isProcessing ? (
                <Loader2 className="animate-spin text-white" size={28} strokeWidth={2} />
              ) : (
                <span className="text-white font-light text-sm tracking-wide">撮影する</span>
              )}
            </button>
            <p className="text-white/70 text-sm font-light">本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}</p>
          </div>
        </div>
      )}

      {screenMode === 'idle' && (
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] gap-8 px-6">
          <p className="text-white/80 text-sm font-extralight tracking-wide">カメラを起動して撮影してください</p>
          <button
            onClick={startCamera}
            className="flex items-center gap-3 px-10 py-4 rounded-full bg-white/20 text-white font-light text-sm tracking-widest backdrop-blur-md border border-white/10 hover:bg-white/30 active:bg-white/40 transition-colors"
          >
            <Camera size={22} strokeWidth={1.5} />
            カメラを起動
          </button>
          {cameraError && (
            <p className="text-red-400 text-xs font-light max-w-xs text-center">{cameraError}</p>
          )}
          {!isStandalone && (
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-blue-500/20 text-blue-300 font-light text-xs tracking-wide backdrop-blur-md border border-blue-400/30 hover:bg-blue-500/30 active:bg-blue-500/40 transition-colors"
            >
              <DownloadIcon size={16} strokeWidth={1.5} />
              {isIOS ? 'ホーム画面に追加（iOS）' : isAndroid ? (deferredPrompt ? 'ホーム画面に追加（Android）' : 'ホーム画面に追加') : deferredPrompt ? 'ホーム画面に追加（Chrome）' : 'アプリをインストール'}
            </button>
          )}
          <p className="text-white/70 text-sm font-light mt-4">本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}</p>
        </main>
      )}

      {showInstallGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-6 max-w-md w-full shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-light text-lg">ホーム画面に追加</h2>
              <button onClick={() => setShowInstallGuide(false)} className="text-white/60 hover:text-white">✕</button>
            </div>
            {isIOS ? (
              <div className="text-white/90 text-sm space-y-2">
                <p className="font-medium">【iPhone / iPad】</p>
                <p>1. アドレスバー右の「共有」ボタン（□↑）をタップ</p>
                <p>2. 「ホーム画面に追加」を選択 → 「追加」をタップ</p>
              </div>
            ) : isAndroid ? (
              <div className="text-white/90 text-sm space-y-2">
                <p className="font-medium">【Android】</p>
                <p>1. ブラウザメニュー（⋮）→「ホーム画面に追加」または「アプリをインストール」</p>
                <p>2. 「追加」をタップ</p>
              </div>
            ) : (
              <p className="text-white/90 text-sm">ブラウザのメニューから「ホーム画面に追加」を選択してください。</p>
            )}
            <button onClick={() => setShowInstallGuide(false)} className="mt-2 px-6 py-3 rounded-full bg-white/20 text-white text-sm font-light border border-white/10 hover:bg-white/30">閉じる</button>
          </div>
        </div>
      )}

      {screenMode === 'preview_edit' && previewImageUrl && (
        <div className="fixed inset-0 z-0 bg-black flex flex-col">
          {(isBlurWarning || detectionFailed) && (
            <div className="shrink-0 px-4 py-3 flex flex-col gap-2 bg-black/30 backdrop-blur-md border-b border-white/10">
              {isBlurWarning && (
                <p className="text-amber-200 text-sm font-light text-center">
                  写真がぼやけている可能性があります。撮り直すことをお勧めします。
                </p>
              )}
              {detectionFailed && (
                <>
                  <p className="text-amber-200 text-sm font-light text-center">
                    ナンバーを自動検出できませんでした。位置を手動で調整するか、もう一度撮影してください。
                  </p>
                  <p className="text-white/70 text-sm font-light text-center">
                    本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}。制限に達した場合は明日お試しください。
                  </p>
                  <button
                    type="button"
                    onClick={retake}
                    className="mx-auto flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-amber-500 text-gray-900 font-medium text-sm hover:bg-amber-400 active:bg-amber-300 transition-colors"
                  >
                    <RotateCcw size={20} strokeWidth={2} />
                    もう一度撮影
                  </button>
                </>
              )}
            </div>
          )}
          <div
            className="flex-1 min-h-0 relative touch-none"
            onTouchStart={onPreviewTouchStart}
            onTouchMove={onPreviewTouchMove}
            onTouchEnd={onPreviewTouchEnd}
            onTouchCancel={onPreviewTouchEnd}
          >
            <canvas
              ref={previewCanvasRef}
              className="absolute inset-0 w-full h-full object-contain"
              style={{ touchAction: 'none' }}
            />
            {isProcessing && detectedCorners.length === 0 && (
              <div className="absolute inset-0 flex flex-col bg-black/30 backdrop-blur-md">
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="animate-spin text-white" size={40} strokeWidth={2} />
                  <p className="text-white/90 text-sm font-light">AIが愛車をスキャン中...</p>
                  <p className="text-white/60 text-xs font-extralight">少々お待ちください</p>
                </div>
                <div className="w-full min-h-[80px] flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-lg border border-white/10 mx-4 mb-4">
                  <span className="text-white/40 text-xs">広告枠（ベータ）</span>
                </div>
              </div>
            )}
          </div>
          <div className="bg-black/30 backdrop-blur-md border-t border-white/10 pt-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-white/90 text-xs font-light w-12">角度</span>
              <input
                type="range"
                min="-30"
                max="30"
                step="1"
                value={editLogoRotation}
                onChange={(e) => setEditLogoRotation(Number(e.target.value))}
                className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none accent-white max-w-[200px]"
              />
              <span className="text-white/70 text-xs tabular-nums w-8">{editLogoRotation}°</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-white/90 text-xs font-light w-12">サイズ</span>
              <input
                type="range"
                min="0.3"
                max="2"
                step="0.05"
                value={editLogoScale}
                onChange={(e) => setEditLogoScale(Number(e.target.value))}
                className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none accent-white max-w-[200px]"
              />
            </div>
            <div className="flex justify-center items-center gap-2 flex-wrap">
              <button
                onClick={retake}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-light backdrop-blur-md border border-white/10 transition-colors ${
                  detectionFailed
                    ? 'bg-amber-500/90 text-gray-900 font-medium hover:bg-amber-400 active:bg-amber-300'
                    : 'bg-white/20 text-white hover:bg-white/30 active:bg-white/40'
                }`}
              >
                <RotateCcw size={18} strokeWidth={2} />
                撮り直す
              </button>
              <button
                onClick={handleSaveToDevice}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/20 backdrop-blur-md border border-white/10 text-white hover:bg-white/30 active:bg-white/40 transition-colors disabled:opacity-50"
                title="端末に保存"
              >
                <Download size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('facebook')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="Facebook"
              >
                <Facebook size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('twitter')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="X"
              >
                <Twitter size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('instagram')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="Instagram"
              >
                <Instagram size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/20 backdrop-blur-md border border-white/10 text-white text-sm font-light hover:bg-white/30 active:bg-white/40 transition-colors disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} strokeWidth={2} /> : <Share2 size={18} strokeWidth={2} />}
                その他
              </button>
            </div>
            {showShareMenu && (
              <div className="flex flex-wrap justify-center gap-2 mt-3 pt-3 border-t border-white/10">
                <button onClick={handleShareToNearbyDevice} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/20 backdrop-blur-md border border-white/10 text-white text-xs font-light hover:bg-white/30 transition-colors disabled:opacity-50"><Monitor size={14} /> 近くのPC</button>
                <button onClick={handleCopyToClipboard} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/20 backdrop-blur-md border border-white/10 text-white text-xs font-light hover:bg-white/30 transition-colors disabled:opacity-50"><Copy size={14} /> コピー</button>
              </div>
            )}
            <div className="mt-3 min-h-[60px] flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-lg border border-white/10">
              <span className="text-white/40 text-xs">広告枠（ベータ）</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
