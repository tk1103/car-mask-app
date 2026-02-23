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
}
type Corners = [Corner, Corner, Corner, Corner]; // topLeft, topRight, bottomRight, bottomLeft

const DEVICE_ID_KEY = 'carkus_device_id';
/** デバイス単位のAPI制限用。localStorage に UUID を保存し、同一デバイスは 20回/日 */
function getDeviceId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (_) {}
  }
  return id ?? '';
}

// API座標をクライアント座標に変換（0-1000 → 0-1）。画像の幅・高さに依存しない正規化座標（portrait/landscape 共通）
function apiCornersToClient(plate: { corners: { x: number; y: number }[] }): Corners {
  return plate.corners.map((c) => ({
    x: Math.max(0, Math.min(1, c.x / 1000)),
    y: Math.max(0, Math.min(1, c.y / 1000)),
  })) as Corners;
}

/** 編集用デフォルト四角（画像中央・正規化座標 0-1）。解析失敗時やAPIエラー時に使用 */
function getDefaultCenterCorners(): Corners {
  return [
    { x: 0.35, y: 0.45 },
    { x: 0.65, y: 0.45 },
    { x: 0.65, y: 0.55 },
    { x: 0.35, y: 0.55 },
  ];
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

// 黒マスクの上に白で Carkus のみを中央配置
function drawCarkusLogoAtOrigin(
  ctx: CanvasRenderingContext2D,
  logoWidth: number,
  logoHeight: number,
  _options?: { backgroundAlpha?: number },
  logoImage?: HTMLImageElement | null
) {
  const halfW = logoWidth / 2;
  const halfH = logoHeight / 2;
  const gothicFont = '-apple-system, "Helvetica Neue", "Hiragino Sans", "Yu Gothic", sans-serif';

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (logoImage?.complete && logoImage.naturalWidth && logoImage.naturalHeight) {
    const svgAspect = logoImage.naturalWidth / logoImage.naturalHeight;
    const drawH = logoHeight * 0.5;
    const drawW = Math.min(drawH * svgAspect, logoWidth * 0.9);
    const h = drawW / svgAspect;
    ctx.save();
    ctx.filter = 'brightness(0) invert(1)';
    ctx.drawImage(logoImage, -drawW / 2, -h / 2, drawW, h);
    ctx.restore();
  } else {
    const trialSize = Math.min(logoHeight * 0.4, 28);
    ctx.font = `500 ${trialSize}px ${gothicFont}`;
    const textW = ctx.measureText('Carkus').width;
    const fontSize = textW > logoWidth * 0.9 ? (trialSize * (logoWidth * 0.9) / textW) : trialSize;
    ctx.font = `500 ${Math.max(14, fontSize)}px ${gothicFont}`;
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

// 編集画面のロゴ描画用（quad のアスペクトに合わせて横縮みしない）
const LOGO_CANVAS_WIDTH = 400;

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
  const [detectionFailed, setDetectionFailed] = useState(false); // 編集画面では常に「編集モード」として扱い、トーストのみ表示
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null); // APIから返る本日の残り回数（null=未取得）
  const [carkusLogoImage, setCarkusLogoImage] = useState<HTMLImageElement | null>(null);
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
  const logoCanvasRef = useRef<HTMLCanvasElement | null>(null); // 編集画面でマスク画像が無いときのロゴ用オフスクリーン

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
    img.onload = () => setCarkusLogoImage(img);
    img.onerror = () => setCarkusLogoImage(null);
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
      const deviceId = getDeviceId();
      const res = await fetch('/api/detect-plate', {
        headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.remainingToday === 'number') setDailyRemaining(data.remainingToday);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (screenMode === 'idle' || screenMode === 'camera') fetchRemainingQuota();
  }, [screenMode, fetchRemainingQuota]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(t);
  }, [toastMessage]);

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
      const deviceId = getDeviceId();
      const quotaRes = await fetch('/api/detect-plate', {
        headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
      });
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

      // API送信: 1回目は長辺1024（品質とタイムアウトのバランス）、再試行時は512で軽量送信
      const maxApiLongEdge = 1024;
      const apiScale = Math.min(maxApiLongEdge / Math.max(originalW, originalH), 1);
      const apiW = Math.round(originalW * apiScale);
      const apiH = Math.round(originalH * apiScale);
      const apiCanvas = document.createElement('canvas');
      apiCanvas.width = apiW;
      apiCanvas.height = apiH;
      const apiCtx = apiCanvas.getContext('2d');
      if (!apiCtx) throw new Error('Canvas error');
      apiCtx.imageSmoothingEnabled = true;
      apiCtx.imageSmoothingQuality = 'high';
      apiCtx.filter = 'contrast(1.4) brightness(1.1)';
      apiCtx.drawImage(fullResCanvas, 0, 0, originalW, originalH, 0, 0, apiW, apiH);
      apiCtx.filter = 'none';

      const apiBlob = await new Promise<Blob>((resolve, reject) => {
        apiCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.88);
      });

      const maxApiLongEdgeSmall = 512;
      const apiScaleSmall = Math.min(maxApiLongEdgeSmall / Math.max(originalW, originalH), 1);
      const apiWSmall = Math.round(originalW * apiScaleSmall);
      const apiHSmall = Math.round(originalH * apiScaleSmall);
      const apiCanvasSmall = document.createElement('canvas');
      apiCanvasSmall.width = apiWSmall;
      apiCanvasSmall.height = apiHSmall;
      const apiCtxSmall = apiCanvasSmall.getContext('2d');
      if (apiCtxSmall) {
        apiCtxSmall.imageSmoothingEnabled = true;
        apiCtxSmall.imageSmoothingQuality = 'high';
        apiCtxSmall.filter = 'contrast(1.4) brightness(1.1)';
        apiCtxSmall.drawImage(fullResCanvas, 0, 0, originalW, originalH, 0, 0, apiWSmall, apiHSmall);
        apiCtxSmall.filter = 'none';
      }
      const apiBlobSmall = await new Promise<Blob>((resolve, reject) => {
        apiCanvasSmall.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.85);
      });

      // 投機的実行: 即座に編集画面へ移行し、中央にデフォルトロゴを表示。API はバックグラウンドで実行
      setPreviewImageUrl(URL.createObjectURL(fullResBlob));
      setScreenMode('preview_edit');
      setDetectedCorners([getDefaultCenterCorners()]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(1);
      setEditLogoRotation(0);
      setCameraError(null);
      setToastMessage(null);
      setIsProcessing(true);

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

      const applyResult = (result: any, res: Response) => {
        const remaining = (result as { remainingToday?: number }).remainingToday;
        if (remaining !== undefined) setDailyRemaining(remaining);
        if (!res.ok) {
          const raw = (result.error || '') as string;
          const isQuota = res.status === 429 || /quota|rate limit|exceeded/i.test(raw);
          setToastMessage(
            isQuota
              ? `本日の検出回数（${API_DAILY_LIMIT}回）に達しました。位置を手動で調整してください。`
              : ((result as { userMessage?: string }).userMessage || '解析できませんでした。位置を手動で調整してください。')
          );
          setIsProcessing(false);
          return;
        }
        if (result.found && result.plates && Array.isArray(result.plates) && result.plates.length > 0) {
          const platesCorners: Corners[] = result.plates
            .filter((plate: any) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4)
            .map((plate: any) => normalizeCornersOrder(apiCornersToClient(plate)));
          if (platesCorners.length > 0) {
            setDetectedCorners(platesCorners);
            setEditLogoOffset({ x: 0, y: 0 });
            setEditLogoScale(1);
            setEditLogoRotation(0);
          } else {
            setToastMessage('プレートの座標を読み取れませんでした。位置を手動で調整してください。');
          }
        } else if (result.found && result.corners && Array.isArray(result.corners) && result.corners.length === 4) {
          const single = normalizeCornersOrder(apiCornersToClient({ corners: result.corners }));
          setDetectedCorners([single]);
          setEditLogoOffset({ x: 0, y: 0 });
          setEditLogoScale(1);
          setEditLogoRotation(0);
        } else {
          setToastMessage('ナンバーを検出できませんでした。位置を手動で調整してください。');
        }
        setIsProcessing(false);
      };

      (async () => {
        const videoTrack = streamRef.current?.getVideoTracks()[0];
        if (videoTrack && 'applyConstraints' in videoTrack) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
          } catch (_) {}
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 48_000);
        try {
          const deviceId = getDeviceId();
          const res = await fetch('/api/detect-plate', {
            method: 'POST',
            body: createFormData(),
            signal: controller.signal,
            headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
          });
          clearTimeout(timeoutId);
          const result = await res.json();
          applyResult(result, res);
        } catch (fetchErr: unknown) {
          clearTimeout(timeoutId);
          setToastMessage(
            fetchErr instanceof Error && fetchErr.name === 'AbortError'
              ? '解析がタイムアウトしました。位置を手動で調整してください。'
              : '通信エラーです。位置を手動で調整してください。'
          );
          setIsProcessing(false);
        }
      })();
    } catch (e) {
      const videoTrack = streamRef.current?.getVideoTracks()[0];
      if (videoTrack && 'applyConstraints' in videoTrack) {
        try {
          await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
        } catch (_) {}
      }
      setDetectedCorners([getDefaultCenterCorners()]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(1);
      setEditLogoRotation(0);
      setToastMessage('解析に失敗しました。位置を手動で調整してください。');
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
    setToastMessage(null);
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
    // キャンバスを画像実寸に合わせ、API の 0-1000 座標を画像ピクセルに正確にマッピング。object-cover 表示でも保存画像は正しい位置に描画される
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

      detectedCorners.forEach((corners) => {
        // 正規化座標 0-1 をそのまま画像ピクセルにマッピング（portrait/landscape 共通で w,h が画像実寸）
        const centerNx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        const centerNy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        const centerX = centerNx * w;
        const centerY = centerNy * h;

        const scaled: Corners = corners.map((c) => ({
          x: centerNx + (c.x - centerNx) * scale,
          y: centerNy + (c.y - centerNy) * scale,
        })) as Corners;

        // 上辺(0→1)と下辺(3→2)の角度を平均し、ナンバーに対して平行なロゴ向きを算出（45度傾きでも安定）
        const topDx = scaled[1].x - scaled[0].x;
        const topDy = scaled[1].y - scaled[0].y;
        const bottomDx = scaled[2].x - scaled[3].x;
        const bottomDy = scaled[2].y - scaled[3].y;
        const angleTop = Math.atan2(topDy, topDx);
        const angleBottom = Math.atan2(bottomDy, bottomDx);
        let baseAngle = (angleTop + angleBottom) / 2;
        if (Math.abs(angleTop - angleBottom) > Math.PI) {
          baseAngle += Math.PI;
        }
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

        // 黒マスク + その上に白で Carkus / carkus.net（iPhone URL 風）
        fillQuad(ctx, quadPx, '#000000');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (maskImage && maskImage.complete && maskImage.naturalWidth) {
          drawImageWarpedToQuad(ctx, maskImage, quadPx, maskImage.naturalWidth, maskImage.naturalHeight);
        } else {
          const Lw = LOGO_CANVAS_WIDTH;
          const Lh = Math.max(40, Math.round(Lw * (plateHeight / plateWidth)));
          let logoCanvas = logoCanvasRef.current;
          if (!logoCanvas) {
            logoCanvas = document.createElement('canvas');
            logoCanvasRef.current = logoCanvas;
          }
          logoCanvas.width = Lw;
          logoCanvas.height = Lh;
          const lctx = logoCanvas.getContext('2d');
          if (lctx) {
            lctx.clearRect(0, 0, Lw, Lh);
            lctx.save();
            lctx.translate(Lw / 2, Lh / 2);
            drawCarkusLogoAtOrigin(lctx, Lw * 0.95, Lh * 0.95, undefined, carkusLogoImage);
            lctx.restore();
          }
          drawImageWarpedToQuad(ctx, logoCanvas, quadPx, Lw, Lh);
        }
      });
    }
  }, [screenMode, previewImageLoaded, detectedCorners, maskImage, carkusLogoImage, editLogoOffset, editLogoScale, editLogoRotation]);

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
            await navigator.share({ files: [file], title: 'Carkus' });
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
                facebook: 'Carkusでナンバープレートをマスクしました',
                twitter: 'Carkusでナンバープレートをマスクしました',
                instagram: 'Carkusでナンバープレートをマスクしました',
              };

              await navigator.share({
                files: [file],
                title: 'Carkus',
                text: shareTexts[platform] || 'Carkusでナンバープレートをマスクしました',
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
                twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent('Carkusでナンバープレートをマスクしました')}&url=${encodeURIComponent(imageUrl)}`,
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
                title: 'Carkus',
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
                title: 'Carkus',
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
    <div className="min-h-screen bg-white" style={{ fontFamily }}>
      {screenMode === 'idle' && (
        <header className="sticky top-0 z-10 bg-white/40 backdrop-blur-xl border-b border-white/30">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-2 flex-wrap">
            <span className="h-6 flex items-center shrink-0 text-gray-900">
              <CarkusLogo className="h-full w-auto text-gray-900" />
            </span>
            <span className="px-2 py-0.5 rounded-md bg-white/50 backdrop-blur-sm border border-white/40 text-gray-600 text-[10px] font-medium tracking-widest shrink-0">BETA</span>
            <span className="text-gray-500 text-xs font-extralight shrink-0">ver0.8</span>
          </div>
        </header>
      )}

      {showSaveSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white/60 backdrop-blur-2xl border border-white/40 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            <CheckCircle className="text-emerald-500" size={40} strokeWidth={2} />
            <p className="text-gray-900 font-light">保存しました</p>
            <p className="text-gray-600 text-xs font-extralight">ご利用ありがとうございます</p>
          </div>
        </div>
      )}

      {cameraError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-md">
          <div className="bg-white/70 backdrop-blur-2xl rounded-2xl px-6 py-5 max-w-sm shadow-2xl flex flex-col items-center gap-4 border border-white/40">
            <p className="text-gray-900 font-light text-sm text-center leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={() => setCameraError(null)}
              className="px-6 py-2.5 rounded-full bg-white/60 backdrop-blur-sm text-gray-900 text-sm font-light border border-white/40 hover:bg-white/80 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {screenMode === 'camera' && (
        <div className="fixed inset-0 z-0 flex flex-col landscape:flex-row">
          <div className="flex-1 min-h-0 relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {showFlash && (
              <div className="absolute inset-0 bg-white z-30 pointer-events-none" style={{ animation: 'flash 0.2s ease-out' }} />
            )}
            {isProcessing && (
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex flex-col items-center justify-center z-10 px-4">
                <Loader2 className="animate-spin text-white" size={48} strokeWidth={2.5} />
                <p className="text-white font-light text-sm mt-4">解析中...</p>
                <p className="text-white/80 text-xs font-extralight text-center max-w-xs mt-1">そのまま位置を調整できます</p>
              </div>
            )}
            <div className="absolute top-0 left-0 right-0 z-20 pt-[env(safe-area-inset-top)] pb-4 px-4 bg-white/30 backdrop-blur-xl border-b border-white/20 landscape:right-0 landscape:border-b-0 landscape:border-r landscape:border-white/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="h-5 flex items-center shrink-0 text-white drop-shadow-md">
                    <CarkusLogo className="h-full w-auto text-white" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white/30 backdrop-blur-sm border border-white/30 text-white/90 text-[10px] font-medium tracking-widest">BETA</span>
                </div>
                <button
                  onClick={stopCamera}
                  className="py-2 px-4 rounded-full bg-white/30 backdrop-blur-sm text-white text-sm font-light border border-white/30 hover:bg-white/50 transition-colors"
                >
                  終了
                </button>
              </div>
              {cameraError && <p className="mt-2 text-red-200 text-xs font-light">{cameraError}</p>}
              <p className="mt-1 text-white/90 text-sm font-light">本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}</p>
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-center justify-center gap-2 py-6 px-4 bg-black/30 backdrop-blur-xl border-t border-white/20 landscape:border-t-0 landscape:border-l landscape:border-white/20 landscape:w-44 landscape:py-4">
            <button
              onClick={captureAndDetect}
              disabled={isProcessing}
              className="min-w-[8rem] px-6 py-3 rounded-full bg-white/40 backdrop-blur-sm text-white text-sm font-light border border-white/40 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform hover:bg-white/60"
            >
              {isProcessing ? (
                <Loader2 className="animate-spin text-white" size={28} strokeWidth={2} />
              ) : (
                <span className="font-light text-sm tracking-wide">撮影する</span>
              )}
            </button>
            <p className="text-white/90 text-sm font-light">本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}</p>
          </div>
        </div>
      )}

      {screenMode === 'idle' && (
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] gap-8 px-6">
          <p className="text-gray-600 text-sm font-extralight tracking-wide">カメラを起動して撮影してください</p>
          <button
            onClick={startCamera}
            className="flex items-center gap-3 px-10 py-4 rounded-full bg-white/50 backdrop-blur-xl text-gray-900 font-light text-sm tracking-widest border border-white/40 hover:bg-white/70 transition-colors shadow-lg"
          >
            <Camera size={22} strokeWidth={1.5} />
            カメラを起動
          </button>
          {cameraError && (
            <p className="text-red-600 text-xs font-light max-w-xs text-center">{cameraError}</p>
          )}
          {!isStandalone && (
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/40 backdrop-blur-sm text-gray-700 font-light text-xs tracking-wide border border-white/40 hover:bg-white/60 transition-colors"
            >
              <DownloadIcon size={16} strokeWidth={1.5} />
              {isIOS ? 'ホーム画面に追加（iOS）' : isAndroid ? (deferredPrompt ? 'ホーム画面に追加（Android）' : 'ホーム画面に追加') : deferredPrompt ? 'ホーム画面に追加（Chrome）' : 'アプリをインストール'}
            </button>
          )}
          <p className="text-gray-500 text-sm font-light mt-4">本日{dailyRemaining !== null ? `あと${dailyRemaining}回` : `${API_DAILY_LIMIT}回まで`}</p>
        </main>
      )}

      {showInstallGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/25 backdrop-blur-md">
          <div className="bg-white/70 backdrop-blur-2xl rounded-2xl px-6 py-6 max-w-md w-full shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto border border-white/40">
            <div className="flex items-center justify-between">
              <h2 className="text-gray-900 font-light text-lg">ホーム画面に追加</h2>
              <button onClick={() => setShowInstallGuide(false)} className="text-gray-500 hover:text-gray-900">✕</button>
            </div>
            {isIOS ? (
              <div className="text-gray-700 text-sm space-y-2">
                <p className="font-medium">【iPhone / iPad】</p>
                <p>1. アドレスバー右の「共有」ボタン（□↑）をタップ</p>
                <p>2. 「ホーム画面に追加」を選択 → 「追加」をタップ</p>
              </div>
            ) : isAndroid ? (
              <div className="text-gray-700 text-sm space-y-2">
                <p className="font-medium">【Android】</p>
                <p>1. ブラウザメニュー（⋮）→「ホーム画面に追加」または「アプリをインストール」</p>
                <p>2. 「追加」をタップ</p>
              </div>
            ) : (
              <p className="text-gray-700 text-sm">ブラウザのメニューから「ホーム画面に追加」を選択してください。</p>
            )}
            <button onClick={() => setShowInstallGuide(false)} className="mt-2 px-6 py-3 rounded-full bg-white/60 backdrop-blur-sm text-gray-900 text-sm font-light border border-white/40 hover:bg-white/80">閉じる</button>
          </div>
        </div>
      )}

      {screenMode === 'preview_edit' && previewImageUrl && (
        <div className="fixed inset-0 z-0 flex flex-col landscape:flex-row">
          {toastMessage && (
            <div className="fixed top-4 left-4 right-4 landscape:left-auto landscape:right-4 landscape:max-w-sm z-30 px-4 py-3 rounded-xl bg-white/60 backdrop-blur-2xl text-gray-900 text-sm font-light shadow-lg border border-white/40 animate-scale-in">
              {toastMessage}
            </div>
          )}
          {isBlurWarning && (
            <div className="shrink-0 px-4 py-3 flex flex-col gap-2 bg-amber-500/20 backdrop-blur-xl border-b border-amber-400/30 landscape:border-b-0 landscape:border-r landscape:border-amber-400/30">
              <p className="text-amber-900 text-sm font-light text-center">
                写真がぼやけている可能性があります。撮り直すことをお勧めします。
              </p>
            </div>
          )}
          <div className="flex-1 min-h-0 flex flex-col landscape:flex-row">
            <div
              className="flex-1 min-h-0 relative touch-none"
              onTouchStart={onPreviewTouchStart}
              onTouchMove={onPreviewTouchMove}
              onTouchEnd={onPreviewTouchEnd}
              onTouchCancel={onPreviewTouchEnd}
            >
              <canvas
                ref={previewCanvasRef}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ touchAction: 'none' }}
              />
              {isProcessing && detectedCorners.length === 0 && (
                <div className="absolute inset-0 flex flex-col bg-black/25 backdrop-blur-sm">
                  <div className="flex-1 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="animate-spin text-white" size={40} strokeWidth={2} />
                    <p className="text-white text-sm font-light">解析中...</p>
                  </div>
                </div>
              )}
            </div>
            <div className="shrink-0 bg-white/40 backdrop-blur-2xl border-t border-white/30 landscape:border-t-0 landscape:border-l landscape:border-white/30 landscape:w-56 pt-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] landscape:py-4 landscape:overflow-y-auto">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-gray-800 text-xs font-light w-12">角度</span>
              <input
                type="range"
                min="-30"
                max="30"
                step="1"
                value={editLogoRotation}
                onChange={(e) => setEditLogoRotation(Number(e.target.value))}
                className="flex-1 h-1.5 bg-white/50 rounded-full appearance-none accent-gray-700 max-w-[200px]"
              />
              <span className="text-gray-700 text-xs tabular-nums w-8">{editLogoRotation}°</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-gray-800 text-xs font-light w-12">サイズ</span>
              <input
                type="range"
                min="0.3"
                max="2"
                step="0.05"
                value={editLogoScale}
                onChange={(e) => setEditLogoScale(Number(e.target.value))}
                className="flex-1 h-1.5 bg-white/50 rounded-full appearance-none accent-gray-700 max-w-[200px]"
              />
            </div>
            <div className="flex justify-center items-center gap-2 flex-wrap landscape:justify-start">
              <button
                onClick={retake}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-light bg-white/50 backdrop-blur-sm border border-white/40 text-gray-900 hover:bg-white/70 transition-colors"
              >
                <RotateCcw size={18} strokeWidth={2} />
                撮り直す
              </button>
              <button
                onClick={handleSaveToDevice}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-900 hover:bg-white/70 transition-colors disabled:opacity-50"
                title="端末に保存"
              >
                <Download size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('facebook')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-700 hover:bg-white/70 transition-colors disabled:opacity-50"
                title="Facebook"
              >
                <Facebook size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('twitter')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-700 hover:bg-white/70 transition-colors disabled:opacity-50"
                title="X"
              >
                <Twitter size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('instagram')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-700 hover:bg-white/70 transition-colors disabled:opacity-50"
                title="Instagram"
              >
                <Instagram size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-900 text-sm font-light hover:bg-white/70 transition-colors disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} strokeWidth={2} /> : <Share2 size={18} strokeWidth={2} />}
                その他
              </button>
            </div>
            {showShareMenu && (
              <div className="flex flex-wrap justify-center gap-2 mt-3 pt-3 border-t border-white/30">
                <button onClick={handleShareToNearbyDevice} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-700 text-xs font-light hover:bg-white/70 transition-colors disabled:opacity-50"><Monitor size={14} /> 近くのPC</button>
                <button onClick={handleCopyToClipboard} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/50 backdrop-blur-sm border border-white/40 text-gray-700 text-xs font-light hover:bg-white/70 transition-colors disabled:opacity-50"><Copy size={14} /> コピー</button>
              </div>
            )}
            <div className="mt-3 min-h-[60px] flex items-center justify-center rounded-xl bg-white/30 backdrop-blur-sm border border-white/30">
              <span className="text-gray-500 text-xs">広告枠（ベータ）</span>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
