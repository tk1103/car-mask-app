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
  const playAttemptCountRef = useRef<number>(0);

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
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      const errorMsg = 'カメラAPIが利用できません。スマホでは https:// でアクセスする必要があります。';
      setCameraError(errorMsg);
      return;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      
      streamRef.current = s;
      setStream(s);
      setIsCameraActive(true);
    } catch (err) {
      console.error('Camera error:', err);
      
      let errorMessage = 'カメラへのアクセスに失敗しました。';
      
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = 'カメラの権限が拒否されました。ブラウザの設定でカメラへのアクセスを許可してください。';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMessage = 'カメラが見つかりませんでした。デバイスにカメラが接続されているか確認してください。';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMessage = 'カメラが使用中です。他のアプリでカメラを使用していないか確認してください。';
        } else if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
          errorMessage = `カメラの設定がサポートされていません。\nエラー詳細: ${err.message}`;
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
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setIsCameraActive(false);
    setDetectedCars([]);
    setCameraError(null);
    playAttemptCountRef.current = 0;
  }, []);

  // streamの変化を監視してsrcObjectを接続
  useEffect(() => {
    if (!stream || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    
    const timeoutId = setTimeout(() => {
      if (video && stream) {
        video.srcObject = stream;
        video.play().catch((playErr) => {
          const playErrorMsg = `動画の再生に失敗しました: ${playErr instanceof Error ? playErr.message : String(playErr)}`;
          setCameraError(playErrorMsg);
          console.error('Video play error:', playErr);
        });
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [stream]);

  // iOS/Android向けの強制再生タイマー
  useEffect(() => {
    if (!isCameraActive || !videoRef.current) {
      playAttemptCountRef.current = 0;
      return;
    }

    const video = videoRef.current;
    playAttemptCountRef.current = 0;

    const forcePlay = () => {
      if (video && playAttemptCountRef.current < 3) {
        playAttemptCountRef.current += 1;
        video.play().catch((err) => {
          console.warn(`Force play attempt ${playAttemptCountRef.current} failed:`, err);
        });
      }
    };

    forcePlay();

    const interval = setInterval(() => {
      if (playAttemptCountRef.current < 3) {
        forcePlay();
      } else {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCameraActive]);

  // Detection loop: run coco-ssd on video, filter "car/truck/bus", draw masks on overlay
  useEffect(() => {
    if (!model || !isCameraActive || !videoRef.current || !overlayRef.current) return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    const overlayCtx = overlay.getContext('2d');
    if (!overlayCtx) return;

    let lastTime = 0;
    const fpsInterval = 1000 / 10;
    let lastCars: DetectedCar[] = [];
    let frameCount = 0; // フレームカウンター（処理負荷軽減用）

    const detect = async () => {
      if (!video.videoWidth || !video.videoHeight || !streamRef.current) {
        detectionLoopRef.current = requestAnimationFrame(detect);
        return;
      }

      if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }

      frameCount++;
      const now = performance.now();
      
      // 3フレームに1回検知（処理負荷軽減）
      if (now - lastTime >= fpsInterval && frameCount % 3 === 0) {
        lastTime = now;
        try {
          // 感度向上: maxNumBoxes=20, minScore=0.3で低スコアでも検知
          const predictions = await model.detect(video, 20, 0.3);
          const vehicles = predictions
            .filter((p: { class: string }) => p.class === 'car' || p.class === 'truck' || p.class === 'bus')
            .map((p: { bbox: [number, number, number, number]; score: number }) => ({
              bbox: p.bbox,
              score: p.score,
            }));
          lastCars = vehicles;
          setDetectedCars(vehicles);
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

        // デバッグ用: 車全体を囲む赤い枠を描画
        overlayCtx.strokeStyle = '#ff0000';
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(x, y, w, h);

        // マスクを描画
        if (maskImage && maskImage.complete && maskImage.naturalWidth) {
          overlayCtx.drawImage(maskImage, left, top, maskW, maskH);
        } else {
          // ダークグレーのマスク
          overlayCtx.fillStyle = '#1a1a1a';
          overlayCtx.fillRect(left, top, maskW, maskH);
          
          // A_O_Iロゴを白抜きテキストで表示
          overlayCtx.fillStyle = '#FFFFFF';
          overlayCtx.font = `bold ${Math.max(12, maskH * 0.5)}px system-ui, sans-serif`;
          overlayCtx.textAlign = 'center';
          overlayCtx.textBaseline = 'middle';
          overlayCtx.fillText('A_O_I', centerX, top + maskH / 2);
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
        // ダークグレーのマスク
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(left, top, maskW, maskH);
        
        // A_O_Iロゴを白抜きテキストで表示
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${Math.max(12, maskH * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A_O_I', centerX, top + maskH / 2);
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
    <div className="min-h-screen bg-white pb-20" style={{ backgroundColor: '#FFFFFF' }}>
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-light text-gray-900" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '0.05em' }}>
            A_O_I CAMERA
          </h1>
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
            <Loader2 className="animate-spin text-gray-900" size={48} />
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
              className="flex items-center gap-2 px-8 py-4 bg-gray-900 text-white rounded-2xl font-medium shadow-lg hover:bg-gray-800 transition-colors"
              style={{ backgroundColor: '#000000', color: '#FFFFFF' }}
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
            {/* スマホ最適化: 画面からはみ出さないように調整 */}
            <div className="relative w-full bg-gray-900 rounded-2xl overflow-hidden shadow-lg" style={{ maxHeight: 'calc(100vh - 250px)', aspectRatio: '9/16' }}>
              <video
                ref={videoRef}
                autoPlay={true}
                playsInline={true}
                muted={true}
                className="w-full h-full"
                style={{
                  objectFit: 'cover',
                  width: '100%',
                  height: '100%',
                  display: 'block',
                }}
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    videoRef.current.play().catch((err) => {
                      console.warn('Auto-play failed on loadedMetadata:', err);
                    });
                  }
                }}
                onCanPlay={() => {
                  if (videoRef.current) {
                    videoRef.current.play().catch((err) => {
                      console.warn('Auto-play failed on canPlay:', err);
                    });
                  }
                }}
              />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ objectFit: 'cover' }}
              />
            </div>
            <div className="flex justify-center gap-4">
              <button
                onClick={savePhoto}
                className="flex items-center gap-2 px-8 py-3 bg-gray-900 text-white rounded-2xl font-medium shadow hover:bg-gray-800 transition-colors"
                style={{ backgroundColor: '#000000', color: '#FFFFFF' }}
              >
                保存
              </button>
              <button
                onClick={stopCamera}
                className="flex items-center gap-2 px-8 py-3 bg-gray-200 text-gray-900 rounded-2xl font-medium shadow hover:bg-gray-300 transition-colors"
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
