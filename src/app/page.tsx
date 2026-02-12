'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle, RotateCcw, Share2, Facebook, Twitter, Instagram, Copy, Download, Monitor } from 'lucide-react';

type Corner = { x: number; y: number }; // 0-1
type Corners = [Corner, Corner, Corner, Corner]; // topLeft, topRight, bottomRight, bottomLeft

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
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [showFlash, setShowFlash] = useState(false); // フラッシュ効果用
  const [showShareMenu, setShowShareMenu] = useState(false); // SNS共有メニュー表示用

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

      // API送信用にリサイズ（バランス重視：最大1600x900で精度と速度のバランス）
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
      apiCtx.drawImage(video, 0, 0, apiW, apiH);

      // 軽量な画像前処理：コントラスト強化（検出精度向上のため）
      const imageData = apiCtx.getImageData(0, 0, apiW, apiH);
      const data = imageData.data;
      const contrast = 1.15; // 15%のコントラスト強化
      const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
      
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));     // R
        data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128)); // G
        data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128)); // B
      }
      apiCtx.putImageData(imageData, 0, 0);

      const apiBlob = await new Promise<Blob>((resolve, reject) => {
        apiCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.75);
      });

      const formData = new FormData();
      formData.append('image', apiBlob, 'photo.jpg');
      formData.append('width', apiW.toString());
      formData.append('height', apiH.toString());

      const res = await fetch('/api/detect-plate', { method: 'POST', body: formData });
      const result = await res.json();

      if (!res.ok) {
        // エラー時もフラッシュをオフ
        const errorVideoTrack = streamRef.current?.getVideoTracks()[0];
        if (errorVideoTrack && 'applyConstraints' in errorVideoTrack) {
          try {
            await errorVideoTrack.applyConstraints({
              advanced: [{ torch: false } as any],
            });
          } catch (e) {
            // 無視
          }
        }
        setCameraError(result.error || `エラー ${res.status}`);
        setIsProcessing(false);
        return;
      }

      if (result.found && result.plates && Array.isArray(result.plates) && result.plates.length > 0) {
        // 複数プレート対応：すべてのプレートのcornersを変換
        const platesCorners: Corners[] = result.plates
          .filter((plate: any) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4)
          .map((plate: any) =>
            plate.corners.map((c: { x: number; y: number }) => ({
              x: c.x / 1000, // 0-1の比率として保持
              y: c.y / 1000, // 0-1の比率として保持
            })) as Corners
          );
        
        if (platesCorners.length > 0) {
          setDetectedCorners(platesCorners);
          setEditLogoOffset({ x: 0, y: 0 });
          setEditLogoScale(1);
          setPreviewImageUrl(URL.createObjectURL(fullResBlob));
          setScreenMode('preview_edit');
        } else {
          throw new Error('プレートの座標が不正です');
        }
      } else if (result.found && result.corners && Array.isArray(result.corners) && result.corners.length === 4) {
        // 後方互換性：単一corners形式にも対応
        const corners: Corners = result.corners.map((c: { x: number; y: number }) => ({
          x: c.x / 1000,
          y: c.y / 1000,
        }));
        setDetectedCorners([corners]);
        setEditLogoOffset({ x: 0, y: 0 });
        setEditLogoScale(1);
        setPreviewImageUrl(URL.createObjectURL(fullResBlob));
        setScreenMode('preview_edit');
      } else {
        // 感知できなかった場合、画面中央にデフォルトの四隅を設定（保険）
        const defaultCorners: Corners = [
          { x: 0.35, y: 0.45 }, { x: 0.65, y: 0.45 },
          { x: 0.65, y: 0.55 }, { x: 0.35, y: 0.55 }
        ];
        setDetectedCorners([defaultCorners]);
        setEditLogoOffset({ x: 0, y: 0 });
        setEditLogoScale(1);
        setPreviewImageUrl(URL.createObjectURL(fullResBlob));
        setScreenMode('preview_edit');
        setCameraError('AIが自動検出できなかったため、手動で調整してください。');
      }
    } catch (e) {
      // エラー時もフラッシュを確実にオフにする
      const errorVideoTrack = streamRef.current?.getVideoTracks()[0];
      if (errorVideoTrack && 'applyConstraints' in errorVideoTrack) {
        try {
          await errorVideoTrack.applyConstraints({
            advanced: [{ torch: false } as any],
          });
        } catch (flashError) {
          // 無視
        }
      }
      setCameraError(e instanceof Error ? e.message : '解析に失敗しました');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const retake = useCallback(() => {
    if (previewImageUrl) URL.revokeObjectURL(previewImageUrl);
    setPreviewImageUrl(null);
    setDetectedCorners([]);
    setEditLogoOffset({ x: 0, y: 0 });
    setEditLogoScale(1);
    setPreviewImageLoaded(false);
    setCameraError(null);
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
        
        // Automoniロゴテキスト（マスクサイズに合わせて縮小、純白でメリハリを強化）
        lctx.fillStyle = '#ffffff';
        // 文字幅をマスク幅の90%以内に収めるようにフォントサイズを調整
        const testFontSize = logoCanvas.height * 0.5;
        lctx.font = `bold ${testFontSize}px system-ui, sans-serif`;
        const textMetrics = lctx.measureText('Automoni');
        const textWidth = textMetrics.width;
        const maxTextWidth = logoCanvas.width * 0.9; // マスク幅の90%
        const fontSize = textWidth > maxTextWidth 
          ? (testFontSize * maxTextWidth / textWidth) 
          : testFontSize;
        lctx.font = `bold ${Math.max(12, fontSize)}px system-ui, sans-serif`; // 最小12px
        lctx.textAlign = 'center';
        lctx.textBaseline = 'middle';
        // テキストをより鮮明に（純白で描画）
        lctx.fillStyle = '#ffffff';
        lctx.fillText('Automoni', logoCanvas.width / 2, logoCanvas.height / 2);
      }

      // すべてのプレートにマスクを描画
      detectedCorners.forEach((corners) => {
        const plateCenterX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        const plateCenterY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        const shifted: Corners = corners.map((c) => ({
          x: plateCenterX + (c.x - plateCenterX) * scale + ox / w,
          y: plateCenterY + (c.y - plateCenterY) * scale + oy / h,
        })) as Corners;

        // パディングを約2%に拡大（検出枠のわずかなずれや上部「群馬」「580」のはみ出しを確実に隠す）
        const pad = 0.02;
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
  }, [screenMode, previewImageLoaded, detectedCorners, maskImage, editLogoOffset, editLogoScale]);

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
            await navigator.share({ files: [file], title: 'Auto mo Camera' });
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
                facebook: 'Automoniでナンバープレートをマスクしました',
                twitter: 'Automoniでナンバープレートをマスクしました',
                instagram: 'Automoniでナンバープレートをマスクしました',
              };

              await navigator.share({
                files: [file],
                title: 'Auto mo Camera',
                text: shareTexts[platform] || 'Automoniでナンバープレートをマスクしました',
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
                twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent('Automoniでナンバープレートをマスクしました')}&url=${encodeURIComponent(imageUrl)}`,
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
                title: 'Auto mo Camera',
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
                title: 'Auto mo Camera',
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
        <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-sm border-b border-white/10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center">
            <h1 className="text-lg font-extralight text-white tracking-[0.2em]">Auto mo Camera</h1>
          </div>
        </header>
      )}

      {showSaveSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="bg-white/95 backdrop-blur rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            <CheckCircle className="text-emerald-600" size={40} strokeWidth={2} />
            <p className="text-gray-900 font-light">保存しました</p>
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
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 z-10 px-4">
              <Loader2 className="animate-spin text-white" size={48} strokeWidth={2.5} />
              <p className="text-white font-light text-sm">解析中...</p>
              <p className="text-white/80 text-xs font-extralight text-center max-w-xs">ロゴの位置・サイズを調整してから保存できます</p>
            </div>
          )}
          <div className="absolute top-0 left-0 right-0 z-20 pt-[env(safe-area-inset-top)] pb-4 px-4 bg-gradient-to-b from-black/50 to-transparent">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-extralight text-white/95 tracking-widest">Auto mo Camera</h1>
              <button
                onClick={stopCamera}
                className="py-2 px-4 rounded-full bg-white/20 text-white text-sm font-light backdrop-blur-sm hover:bg-white/30 active:bg-white/40 transition-colors"
              >
                終了
              </button>
            </div>
            {cameraError && <p className="mt-2 text-red-300 text-xs font-light">{cameraError}</p>}
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-20 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12 bg-gradient-to-t from-black/40 to-transparent flex justify-center">
            <button
              onClick={captureAndDetect}
              disabled={isProcessing}
              className="w-16 h-16 rounded-full bg-white/95 backdrop-blur-sm border-2 border-white/60 shadow-xl flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {isProcessing ? (
                <Loader2 className="animate-spin text-gray-800" size={28} strokeWidth={2} />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-900/90" />
              )}
            </button>
          </div>
        </div>
      )}

      {screenMode === 'idle' && (
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] gap-8 px-6">
          <p className="text-white/80 text-sm font-extralight tracking-wide">カメラを起動して撮影してください</p>
          <button
            onClick={startCamera}
            className="flex items-center gap-3 px-10 py-4 rounded-full bg-white/20 text-white font-light text-sm tracking-widest backdrop-blur-sm border border-white/30 hover:bg-white/30 active:bg-white/40 transition-colors"
          >
            <Camera size={22} strokeWidth={1.5} />
            カメラを起動
          </button>
          {cameraError && (
            <p className="text-red-400 text-xs font-light max-w-xs text-center">{cameraError}</p>
          )}
        </main>
      )}

      {screenMode === 'preview_edit' && previewImageUrl && (
        <div className="fixed inset-0 z-0 bg-black flex flex-col">
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
          </div>
          <div className="bg-black/40 backdrop-blur-xl border-t border-white/10 pt-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-white/90 text-xs font-light">サイズ</span>
              <input
                type="range"
                min="0.3"
                max="2"
                step="0.05"
                value={editLogoScale}
                onChange={(e) => setEditLogoScale(Number(e.target.value))}
                className="flex-1 h-1.5 bg-white/30 rounded-full appearance-none accent-white max-w-[200px]"
              />
            </div>
            <div className="flex justify-center gap-3">
              <button
                onClick={retake}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/20 text-white text-sm font-light backdrop-blur-sm hover:bg-white/30 active:bg-white/40 transition-colors"
              >
                <RotateCcw size={18} strokeWidth={2} />
                撮り直す
              </button>
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                disabled={isProcessing}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/95 text-gray-900 text-sm font-light hover:bg-white active:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} strokeWidth={2} /> : <Share2 size={18} strokeWidth={2} />}
                共有
              </button>
            </div>
            {showShareMenu && (
              <div className="flex flex-wrap justify-center gap-2 mt-3 pt-3 border-t border-white/10">
                <button onClick={() => handleShareToSNS('facebook')} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-500/90 text-white text-xs font-light hover:bg-blue-500 transition-colors disabled:opacity-50"><Facebook size={14} /> Facebook</button>
                <button onClick={() => handleShareToSNS('twitter')} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/80 text-white text-xs font-light hover:bg-black transition-colors disabled:opacity-50"><Twitter size={14} /> X</button>
                <button onClick={() => handleShareToSNS('instagram')} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-light hover:opacity-90 transition-colors disabled:opacity-50"><Instagram size={14} /> Instagram</button>
                <button onClick={handleSaveToDevice} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-emerald-500/90 text-white text-xs font-light hover:bg-emerald-500 transition-colors disabled:opacity-50"><Download size={14} /> 端末に保存</button>
                <button onClick={handleShareToNearbyDevice} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/25 text-white text-xs font-light hover:bg-white/35 transition-colors disabled:opacity-50"><Monitor size={14} /> 近くのPC</button>
                <button onClick={handleCopyToClipboard} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/25 text-white text-xs font-light hover:bg-white/35 transition-colors disabled:opacity-50"><Copy size={14} /> コピー</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
