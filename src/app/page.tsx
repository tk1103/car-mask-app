'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle } from 'lucide-react';

type DetectedCar = {
  bbox: [number, number, number, number]; // [x, y, width, height]
  score: number;
};

export default function Home() {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [detectedCars, setDetectedCars] = useState<DetectedCar[]>([]);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [model, setModel] = useState<any>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const saveCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectionLoopRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load COCO-SSD model
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cocoSsd = await import('@tensorflow-models/coco-ssd');
        const m = await cocoSsd.load();
        if (!cancelled) {
          setModel(m);
        }
      } catch (err) {
        console.error('Failed to load coco-ssd:', err);
      } finally {
        if (!cancelled) {
          setIsModelLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load mask image (optional)
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setMaskImage(img);
    img.onerror = () => setMaskImage(null);
    img.src = '/mask-logo.png';
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null); // エラーをクリア

    if (!navigator.mediaDevices?.getUserMedia) {
      const errorMsg = 'カメラAPIが利用できません。スマホでは https:// でアクセスする必要があります。';
      setCameraError(errorMsg);
      return;
    }

    try {
      // 背面カメラ（environment）を強制 + 解像度を1280x720に設定
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: 'environment' }, // 強制（exactで指定）
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      
      streamRef.current = s;
      setStream(s);
      
      if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = s;
        // 一部ブラウザでは明示的な play() 呼び出しが必要
        const playPromise = v.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            const playErrorMsg = `動画の再生に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
            setCameraError(playErrorMsg);
            console.warn('Video play was interrupted:', err);
          });
        }
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error('Camera error:', err);
      
      // エラーの種類に応じて詳細なメッセージを表示
      let errorMessage = 'カメラへのアクセスに失敗しました。';
      
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = 'カメラの権限が拒否されました。ブラウザの設定でカメラへのアクセスを許可してください。';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = 'カメラが見つかりませんでした。デバイスにカメラが接続されているか確認してください。';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = 'カメラが使用中です。他のアプリでカメラを使用していないか確認してください。';
        } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
          errorMessage = `カメラの設定がサポートされていません。背面カメラまたは解像度1280x720が利用できない可能性があります。\nエラー詳細: ${err.message}`;
        } else {
          errorMessage = `カメラエラー: ${err.name} - ${err.message}`;
        }
      } else {
        errorMessage = `カメラエラー: ${String(err)}`;
      }
      
      setCameraError(errorMessage);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (detectionLoopRef.current != null) {
      cancelAnimationFrame(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setIsCameraActive(false);
    setDetectedCars([]);
    setCameraError(null); // カメラ停止時にエラーもクリア
  }, []);

  // Detection loop: run coco-ssd on video, filter "car", draw masks on overlay
  useEffect(() => {
    if (!model || !isCameraActive || !videoRef.current || !overlayRef.current) return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    const overlayCtx = overlay.getContext('2d');
    if (!overlayCtx) return;

    let lastTime = 0;
    const fpsInterval = 1000 / 10;
    let lastCars: DetectedCar[] = [];

    const detect = async () => {
      if (!video.videoWidth || !video.videoHeight || !streamRef.current) {
        detectionLoopRef.current = requestAnimationFrame(detect);
        return;
      }

      if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }

      const now = performance.now();
      if (now - lastTime >= fpsInterval) {
        lastTime = now;
        try {
          const predictions = await model.detect(video);
          const cars = predictions
            .filter((p: { class: string }) => p.class === 'car')
            .map((p: { bbox: [number, number, number, number]; score: number }) => ({
              bbox: p.bbox,
              score: p.score,
            }));
          lastCars = cars;
          setDetectedCars(cars);
        } catch (e) {
          console.warn('Detection error:', e);
        }
      }

      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

      const drawMaskAt = (bbox: [number, number, number, number]) => {
        const [x, y, w, h] = bbox;
        const centerX = x + w / 2;
        const bottomY = y + h;
        const maskW = Math.max(80, w * 0.55);
        const maskH = Math.max(28, h * 0.12);
        const left = centerX - maskW / 2;
        const top = bottomY - maskH * 0.6;

        if (maskImage && maskImage.complete && maskImage.naturalWidth) {
          overlayCtx.drawImage(maskImage, left, top, maskW, maskH);
        } else {
          overlayCtx.fillStyle = '#426aeb';
          overlayCtx.fillRect(left, top, maskW, maskH);
        }
      };

      lastCars.forEach((c) => drawMaskAt(c.bbox));

      detectionLoopRef.current = requestAnimationFrame(detect);
    };

    detectionLoopRef.current = requestAnimationFrame(detect);
    return () => {
      if (detectionLoopRef.current != null) {
        cancelAnimationFrame(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [model, isCameraActive, maskImage]);

  const savePhoto = useCallback(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const saveCanvas = saveCanvasRef.current;
    if (!video || !overlay || !saveCanvas || !video.videoWidth || !video.videoHeight) return;

    const ctx = saveCanvas.getContext('2d');
    if (!ctx) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    saveCanvas.width = w;
    saveCanvas.height = h;

    ctx.drawImage(video, 0, 0, w, h);

    const drawMaskAt = (bbox: [number, number, number, number]) => {
      const [x, y, width, height] = bbox;
      const centerX = x + width / 2;
      const bottomY = y + height;
      const maskW = Math.max(80, width * 0.55);
      const maskH = Math.max(28, height * 0.12);
      const left = centerX - maskW / 2;
      const top = bottomY - maskH * 0.6;

      if (maskImage && maskImage.complete && maskImage.naturalWidth) {
        ctx.drawImage(maskImage, left, top, maskW, maskH);
      } else {
        ctx.fillStyle = '#426aeb';
        ctx.fillRect(left, top, maskW, maskH);
      }
    };

    detectedCars.forEach((c) => drawMaskAt(c.bbox));

    saveCanvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `number-mask-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        setShowSaveSuccess(true);
        setTimeout(() => setShowSaveSuccess(false), 2500);
      },
      'image/jpeg',
      0.92
    );
  }, [detectedCars, maskImage]);

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-300 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Number Mask</h1>
        </div>
      </header>

      {showSaveSuccess && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-lg p-8 flex flex-col items-center gap-4 shadow-2xl animate-scale-in">
            <CheckCircle className="text-green-500" size={64} />
            <p className="text-gray-900 font-bold text-2xl">保存しました</p>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6">
        {isModelLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="animate-spin text-custom-blue" size={48} />
            <p className="text-gray-600">モデルを読み込み中...</p>
          </div>
        )}

        {!isModelLoading && !isCameraActive && (
          <div className="flex flex-col items-center justify-center py-12 gap-6">
            <p className="text-gray-600 text-center">
              カメラを起動して車のナンバーをマスクできます
            </p>
            <button
              onClick={startCamera}
              className="flex items-center gap-2 px-6 py-4 bg-custom-blue text-white rounded-xl font-medium shadow-lg hover:bg-blue-700 transition-colors"
            >
              <Camera size={24} />
              カメラを起動
            </button>
            {cameraError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg max-w-md">
                <p className="text-red-800 text-sm font-medium mb-1">エラー</p>
                <p className="text-red-700 text-sm whitespace-pre-wrap">{cameraError}</p>
              </div>
            )}
          </div>
        )}

        {!isModelLoading && isCameraActive && (
          <div className="space-y-4">
            {cameraError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm font-medium mb-1">エラー</p>
                <p className="text-red-700 text-sm whitespace-pre-wrap">{cameraError}</p>
              </div>
            )}
            <div className="relative rounded-xl overflow-hidden bg-black shadow-lg" style={{ aspectRatio: '9/16' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
            </div>
            <div className="flex justify-center gap-4">
              <button
                onClick={savePhoto}
                className="flex items-center gap-2 px-6 py-3 bg-custom-blue text-white rounded-xl font-medium shadow hover:bg-blue-700 transition-colors"
              >
                保存
              </button>
              <button
                onClick={stopCamera}
                className="flex items-center gap-2 px-6 py-3 bg-gray-500 text-white rounded-xl font-medium shadow hover:bg-gray-600 transition-colors"
              >
                カメラを止める
              </button>
            </div>
          </div>
        )}

        <canvas ref={saveCanvasRef} className="hidden" />
      </main>
    </div>
  );
}
