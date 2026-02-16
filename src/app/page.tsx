'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle, RotateCcw, Share2, Facebook, Twitter, Instagram, Copy, Download, Monitor } from 'lucide-react';

type Corner = { x: number; y: number }; // 0-1
type Corners = [Corner, Corner, Corner, Corner]; // topLeft, topRight, bottomRight, bottomLeft

// API座標をクライアント座標に変換（0-1000 → 0-1）。Gemini 3 座標系に完全一致（Y軸反転なし）
function apiCornersToClient(plate: { corners: { x: number; y: number }[] }): Corners {
  return plate.corners.map((c) => ({
    x: c.x / 1000,
    y: c.y / 1000,
  })) as Corners;
}

// 四隅を重心からの角度でソートし、左上（x+y最小）から時計回りに TL→TR→BR→BL で並べる
function normalizeCornersOrder(corners: Corners): Corners {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const withAngle = corners.map((p) => ({
    ...p,
    angle: Math.atan2(p.y - cy, p.x - cx),
  }));
  withAngle.sort((a, b) => a.angle - b.angle);
  const ordered = withAngle.map(({ x, y }) => ({ x, y }));
  const topLeftIdx = ordered.reduce((best, _, i) => (
    ordered[i].x + ordered[i].y < ordered[best].x + ordered[best].y ? i : best
  ), 0);
  const ccw = [ordered[topLeftIdx], ordered[(topLeftIdx + 1) % 4], ordered[(topLeftIdx + 2) % 4], ordered[(topLeftIdx + 3) % 4]];
  return [ccw[0], ccw[3], ccw[2], ccw[1]] as Corners;
}

// 四角形に画像をパース補正して描画（2三角形でアフィン変換・斜め対応強化版）
function drawImageInQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  corners: Corners,
  canvasWidth: number,
  canvasHeight: number
) {
  const [p0, p1, p2, p3] = corners.map((c) => ({
    x: c.x * canvasWidth,
    y: c.y * canvasHeight,
  }));

  // より正確なパース補正のため、透視変換行列を使用
  const drawTriangle = (
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    sx2: number,
    sy2: number,
    dx0: number,
    dy0: number,
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();

    // アフィン変換行列を計算（より正確なパース補正）
    const denom = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (Math.abs(denom) < 1e-10) {
      ctx.restore();
      return;
    }
    
    // アフィン変換パラメータを計算
    const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) / denom;
    const b = ((dx1 - dx0) * (sx0 - sx2) - (dx2 - dx0) * (sx0 - sx1)) / denom;
    const c = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) / denom;
    const d = ((dy1 - dy0) * (sx0 - sx2) - (dy2 - dy0) * (sx0 - sx1)) / denom;
    const e = dx0 - a * sx0 - b * sy0;
    const f = dy0 - c * sx0 - d * sy0;
    
    // 変換を適用
    ctx.setTransform(a, c, b, d, e, f);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 1, 1);
    ctx.restore();
  };

  // 四角形を2つの三角形に分割して描画（斜めのプレートにも対応）
  // 三角形1: 左上、右上、左下
  drawTriangle(0, 0, 1, 0, 0, 1, p0.x, p0.y, p1.x, p1.y, p3.x, p3.y);
  // 三角形2: 右上、右下、左下
  drawTriangle(1, 0, 1, 1, 0, 1, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAttemptCountRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number; startOffset: { x: number; y: number } } | null>(null);
  const scaleStartRef = useRef<{ y: number; startScale: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setMaskImage(img);
    img.onerror = () => setMaskImage(null);
    img.src = '/mask-logo.png';
  }, []);

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
      setCameraError(msg.includes('Permission') ? 'カメラの許可をオンにしてください。' : `カメラエラー: ${msg}`);
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

      // API送信画像は fullResCanvas から作成（プレビューと必ず同一フレームにし、座標ずれを防ぐ）
      const maxApiWidth = 1600;
      const maxApiHeight = 900;
      const apiScale = Math.min(maxApiWidth / originalW, maxApiHeight / originalH, 1);
      const apiW = Math.round(originalW * apiScale);
      const apiH = Math.round(originalH * apiScale);
      const apiCanvas = document.createElement('canvas');
      apiCanvas.width = apiW;
      apiCanvas.height = apiH;
      const apiCtx = apiCanvas.getContext('2d');
      if (!apiCtx) throw new Error('Canvas error');
      apiCtx.imageSmoothingEnabled = true;
      apiCtx.imageSmoothingQuality = 'high';
      apiCtx.drawImage(fullResCanvas, 0, 0, originalW, originalH, 0, 0, apiW, apiH);

      const imageData = apiCtx.getImageData(0, 0, apiW, apiH);
      const data = imageData.data;
      const contrast = 1.15;
      const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
        data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
        data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
      }
      apiCtx.putImageData(imageData, 0, 0);

      const apiBlob = await new Promise<Blob>((resolve, reject) => {
        apiCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.75);
      });

      const formData = new FormData();
      formData.append('image', apiBlob, 'photo.jpg');
      formData.append('width', apiW.toString());
      formData.append('height', apiH.toString());

      // 撮影後すぐプレビュー表示（体感短縮）。ブレ検出は fetch と並列で実行しリクエストを遅らせない
      setPreviewImageUrl(URL.createObjectURL(fullResBlob));
      setScreenMode('preview_edit');
      setDetectedCorners([]);
      setIsProcessing(true);
      setCameraError(null);
      const blurScore = getBlurScore(apiCanvas);
      setIsBlurWarning(blurScore < BLUR_SCORE_THRESHOLD);

      const res = await fetch('/api/detect-plate', { method: 'POST', body: formData });
      const result = await res.json();

      if (!res.ok) {
        const errorVideoTrack = streamRef.current?.getVideoTracks()[0];
        if (errorVideoTrack && 'applyConstraints' in errorVideoTrack) {
          try {
            await errorVideoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
          } catch (_) {}
        }
        const raw = (result.error || '') as string;
        const isQuota = res.status === 429 || /quota|rate limit|exceeded/i.test(raw);
        const message = (result as { userMessage?: string }).userMessage
          ?? (isQuota ? `本日の検出回数（${API_DAILY_LIMIT}回）に達しました。明日またお試しください。` : (result.error || `エラー ${res.status}`));
        setCameraError(message);
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
      setIsProcessing(false);
    } catch (e) {
      const errorVideoTrack = streamRef.current?.getVideoTracks()[0];
      if (errorVideoTrack && 'applyConstraints' in errorVideoTrack) {
        try {
          await errorVideoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
        } catch (_) {}
      }
      setCameraError(e instanceof Error ? e.message : '解析に失敗しました');
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
      const ox = (editLogoOffset.x / 100) * w;
      const oy = (editLogoOffset.y / 100) * h;

      // ロゴCanvasを一度だけ作成（全プレートで共有、最初のプレートのサイズを基準に）
      const firstCorners = detectedCorners[0];
      const centerX = (firstCorners[0].x + firstCorners[1].x + firstCorners[2].x + firstCorners[3].x) / 4;
      const centerY = (firstCorners[0].y + firstCorners[1].y + firstCorners[2].y + firstCorners[3].y) / 4;
      const tempShifted: Corners = firstCorners.map((c) => ({
        x: centerX + (c.x - centerX) * scale,
        y: centerY + (c.y - centerY) * scale,
      })) as Corners;

      // 四隅から実際のプレートサイズを計算（対角線の平均）
      const width1 = Math.hypot(tempShifted[1].x - tempShifted[0].x, tempShifted[1].y - tempShifted[0].y) * w;
      const width2 = Math.hypot(tempShifted[2].x - tempShifted[3].x, tempShifted[2].y - tempShifted[3].y) * w;
      const height1 = Math.hypot(tempShifted[3].x - tempShifted[0].x, tempShifted[3].y - tempShifted[0].y) * h;
      const height2 = Math.hypot(tempShifted[2].x - tempShifted[1].x, tempShifted[2].y - tempShifted[1].y) * h;
      const avgWidth = (width1 + width2) / 2;
      const avgHeight = (height1 + height2) / 2;
      
      // ロゴサイズをプレートよりやや大きく（はみ出し防止・プレート全体を確実に隠す）
      const sizeScale = 1.08;
      const logoWidth = avgWidth * sizeScale;
      const logoHeight = avgHeight * sizeScale;
      
      const logoCanvas = document.createElement('canvas');
      logoCanvas.width = logoWidth;
      logoCanvas.height = logoHeight;
      const lctx = logoCanvas.getContext('2d');
      if (lctx) {
        // 角丸の半径を計算（高さの10%程度）
        const cornerRadius = logoCanvas.height * 0.1;
        
        // 角丸の長方形を描画
        lctx.fillStyle = '#000000'; // 真っ黒でメリハリを強化
        lctx.beginPath();
        lctx.moveTo(cornerRadius, 0);
        lctx.lineTo(logoCanvas.width - cornerRadius, 0);
        lctx.quadraticCurveTo(logoCanvas.width, 0, logoCanvas.width, cornerRadius);
        lctx.lineTo(logoCanvas.width, logoCanvas.height - cornerRadius);
        lctx.quadraticCurveTo(logoCanvas.width, logoCanvas.height, logoCanvas.width - cornerRadius, logoCanvas.height);
        lctx.lineTo(cornerRadius, logoCanvas.height);
        lctx.quadraticCurveTo(0, logoCanvas.height, 0, logoCanvas.height - cornerRadius);
        lctx.lineTo(0, cornerRadius);
        lctx.quadraticCurveTo(0, 0, cornerRadius, 0);
        lctx.closePath();
        lctx.fill();
        
        // Carkusuロゴテキスト（ゴシック体・マスク幅の90%以内に収める）
        const gothicFont = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
        lctx.fillStyle = '#ffffff';
        const testFontSize = logoCanvas.height * 0.5;
        lctx.font = `bold ${testFontSize}px ${gothicFont}`;
        const textMetrics = lctx.measureText('Carkusu');
        const textWidth = textMetrics.width;
        const maxTextWidth = logoCanvas.width * 0.9;
        const fontSize = textWidth > maxTextWidth 
          ? (testFontSize * maxTextWidth / textWidth) 
          : testFontSize;
        lctx.font = `bold ${Math.max(12, fontSize)}px ${gothicFont}`;
        lctx.textAlign = 'center';
        lctx.textBaseline = 'middle';
        lctx.fillStyle = '#ffffff';
        lctx.fillText('Carkusu', logoCanvas.width / 2, logoCanvas.height / 2);
      }

      const degRad = (editLogoRotation * Math.PI) / 180;
      const cosR = Math.cos(degRad);
      const sinR = Math.sin(degRad);

      // すべてのプレートにマスクを描画
      detectedCorners.forEach((corners) => {
        const plateCenterX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        const plateCenterY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        let shifted: Corners = corners.map((c) => ({
          x: plateCenterX + (c.x - plateCenterX) * scale + ox / w,
          y: plateCenterY + (c.y - plateCenterY) * scale + oy / h,
        })) as Corners;

        // マスクの角度をユーザー調整（マスクの中心で回転）
        if (editLogoRotation !== 0) {
          const maskCx = (shifted[0].x + shifted[1].x + shifted[2].x + shifted[3].x) / 4;
          const maskCy = (shifted[0].y + shifted[1].y + shifted[2].y + shifted[3].y) / 4;
          shifted = shifted.map((p) => {
            const dx = p.x - maskCx;
            const dy = p.y - maskCy;
            return {
              x: maskCx + dx * cosR - dy * sinR,
              y: maskCy + dx * sinR + dy * cosR,
            };
          }) as Corners;
        }

        // プレートの端がはみ出さないよう、四隅を外側に1.5%拡張
        const pad = 0.015;
        const c0: Corner = { x: Math.max(0, shifted[0].x - pad), y: Math.max(0, shifted[0].y - pad) };
        const c1: Corner = { x: Math.min(1, shifted[1].x + pad), y: Math.max(0, shifted[1].y - pad) };
        const c2: Corner = { x: Math.min(1, shifted[2].x + pad), y: Math.min(1, shifted[2].y + pad) };
        const c3: Corner = { x: Math.max(0, shifted[3].x - pad), y: Math.min(1, shifted[3].y + pad) };
        const logoCorners: Corners = [c0, c1, c2, c3];

        if (maskImage && maskImage.complete && maskImage.naturalWidth) {
          drawImageInQuad(ctx, maskImage, logoCorners, w, h);
        } else {
          drawImageInQuad(ctx, logoCanvas, logoCorners, w, h);
        }
      });
    }
  }, [screenMode, previewImageLoaded, detectedCorners, maskImage, editLogoOffset, editLogoScale, editLogoRotation]);

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
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-2">
            <h1 className="text-lg font-extralight text-white tracking-[0.2em]">Carkusu</h1>
            <span className="px-2 py-0.5 rounded-md bg-white/20 backdrop-blur-sm border border-white/10 text-white/90 text-[10px] font-medium tracking-widest">BETA</span>
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
              OK
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
          {showFlash && (
            <div className="absolute inset-0 bg-white z-30 pointer-events-none" style={{ animation: 'flash 0.2s ease-out' }} />
          )}
          {isProcessing && (
            <div className="absolute inset-0 bg-black/30 backdrop-blur-md flex flex-col items-center justify-between z-10 px-4 py-8">
              <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin text-white" size={48} strokeWidth={2.5} />
                <p className="text-white font-light text-sm">解析中...</p>
                <p className="text-white/80 text-xs font-extralight text-center max-w-xs">ナンバープレートを検出しています</p>
              </div>
              <div className="w-full min-h-[100px] flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-lg border border-white/10">
                <span className="text-white/40 text-xs">AD SPACE (BETA)</span>
              </div>
            </div>
          )}
          <div className="absolute top-0 left-0 right-0 z-20 pt-[env(safe-area-inset-top)] pb-4 px-4 bg-white/10 backdrop-blur-md border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extralight text-white tracking-widest">Carkusu</h1>
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
            <p className="mt-1 text-white/50 text-[10px] font-extralight">本日の検出は{API_DAILY_LIMIT}回まで</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-20 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12 bg-black/30 backdrop-blur-md border-t border-white/10 flex flex-col items-center gap-2">
            <button
              onClick={captureAndDetect}
              disabled={isProcessing}
              className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md border border-white/10 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {isProcessing ? (
                <Loader2 className="animate-spin text-white" size={28} strokeWidth={2} />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/40" />
              )}
            </button>
            <p className="text-white/40 text-[10px] font-extralight">検出 {API_DAILY_LIMIT}回/日</p>
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
          <p className="text-white/40 text-[10px] font-extralight mt-4">本日の検出は{API_DAILY_LIMIT}回まで</p>
        </main>
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
                  <p className="text-white/70 text-xs font-extralight text-center">
                    本日の検出は1日{API_DAILY_LIMIT}回まで。制限に達した場合は明日お試しください。
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
                  <p className="text-white/90 text-sm font-light">解析中...</p>
                  <p className="text-white/60 text-xs font-extralight">ナンバープレートを検出しています</p>
                </div>
                <div className="w-full min-h-[80px] flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-lg border border-white/10 mx-4 mb-4">
                  <span className="text-white/40 text-xs">AD SPACE (BETA)</span>
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
            <div className="flex items-center gap-3 mb-3">
              <span className="text-white/90 text-xs font-light w-12">位置X</span>
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={editLogoOffset.x}
                onChange={(e) => setEditLogoOffset((p) => ({ ...p, x: Number(e.target.value) }))}
                className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none accent-white max-w-[120px]"
              />
              <span className="text-white/90 text-xs font-light w-12">位置Y</span>
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={editLogoOffset.y}
                onChange={(e) => setEditLogoOffset((p) => ({ ...p, y: Number(e.target.value) }))}
                className="flex-1 h-1.5 bg-white/20 rounded-full appearance-none accent-white max-w-[120px]"
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
              <span className="text-white/40 text-xs">AD SPACE (BETA)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
