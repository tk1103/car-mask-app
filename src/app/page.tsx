'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle } from 'lucide-react';

type PlateBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function Home() {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);
  const [debugLog, setDebugLog] = useState<string | null>(null);
  const [detectedPlate, setDetectedPlate] = useState<PlateBbox | null>(null); // AR用：リアルタイム検出結果
  const [isScanning, setIsScanning] = useState(false); // AR用：スキャン中フラグ

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null); // AR用：オーバーレイCanvas
  const saveCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAttemptCountRef = useRef<number>(0);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null); // AR用：検出ループのタイマー

  // Load mask image (optional)
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setMaskImage(img);
    img.onerror = () => setMaskImage(null);
    img.src = '/mask-logo.png';
  }, []);

  // ナンバープレート検出関数（ARループと保存の両方で使用）
  const detectPlate = useCallback(async (): Promise<PlateBbox | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    try {
      setIsScanning(true);
      
      // 現在のビデオフレームをキャプチャ
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = video.videoWidth;
      tempCanvas.height = video.videoHeight;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return null;

      tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

      // CanvasをBlobに変換
      const blob = await new Promise<Blob>((resolve, reject) => {
        tempCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('画像の変換に失敗しました'));
        }, 'image/jpeg', 0.92);
      });

      // Gemini APIに送信
      const formData = new FormData();
      formData.append('image', blob, 'photo.jpg');
      formData.append('width', tempCanvas.width.toString());
      formData.append('height', tempCanvas.height.toString());

      const response = await fetch('/api/detect-plate', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.warn('Detection API error:', errorData);
        return null;
      }

      const result = await response.json();
      if (result.found && result.bbox) {
        return result.bbox as PlateBbox;
      }
      return null;
    } catch (error) {
      console.error('Detection error:', error);
      return null;
    } finally {
      setIsScanning(false);
    }
  }, []);

  // AR用：リアルタイム検出ループ（2-3秒おき）
  useEffect(() => {
    if (!isCameraActive || !videoRef.current) {
      setDetectedPlate(null);
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      return;
    }

    // 初回検出（すぐに実行）
    detectPlate().then((bbox) => {
      if (bbox) setDetectedPlate(bbox);
    });

    // 2.5秒おきに自動検出
    detectionIntervalRef.current = setInterval(() => {
      detectPlate().then((bbox) => {
        if (bbox) setDetectedPlate(bbox);
        // found=false の場合は前回の検出結果を保持（AR表示が消えないように）
      });
    }, 2500);

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
  }, [isCameraActive, detectPlate]);

  // AR用：オーバーレイCanvasにリアルタイムでA_O_Iロゴを描画
  useEffect(() => {
    if (!isCameraActive || !videoRef.current || !overlayRef.current) {
      return;
    }

    const video = videoRef.current;
    const overlay = overlayRef.current;
    const overlayCtx = overlay.getContext('2d');
    if (!overlayCtx) return;

    const drawOverlay = () => {
      if (!video.videoWidth || !video.videoHeight) {
        requestAnimationFrame(drawOverlay);
        return;
      }

      // Canvasサイズをビデオに合わせる
      if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }

      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

      // 検出されたナンバープレート位置にA_O_Iロゴを描画
      if (detectedPlate) {
        const bbox = detectedPlate;
        const centerX = bbox.x + bbox.width / 2;
        const bottomY = bbox.y + bbox.height;
        const maskW = Math.max(80, bbox.width * 1.2);
        const maskH = Math.max(28, bbox.height * 1.5);
        const left = centerX - maskW / 2;
        const top = bottomY - maskH * 0.8;

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
      }

      requestAnimationFrame(drawOverlay);
    };

    drawOverlay();
  }, [isCameraActive, detectedPlate, maskImage]);

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
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
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
    setDetectedPlate(null);
    setCameraError(null);
    setIsScanning(false);
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

  const savePhoto = useCallback(async () => {
    const video = videoRef.current;
    const saveCanvas = saveCanvasRef.current;
    if (!video || !saveCanvas || !video.videoWidth || !video.videoHeight) return;

    setIsProcessing(true);
    setCameraError(null);

    try {
      // 最新の検出結果を使用（ARループで既に検出済みの場合）
      let bbox: PlateBbox | null = detectedPlate;
      
      // 検出結果がない場合は、今すぐ検出を実行
      if (!bbox) {
        setDebugLog('ナンバープレートを検出中...');
        bbox = await detectPlate();
      }

      const ctx = saveCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('保存用Canvas context取得に失敗しました');
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      saveCanvas.width = w;
      saveCanvas.height = h;

      // ビデオフレームを描画
      ctx.drawImage(video, 0, 0, w, h);

      // ナンバープレートが見つかった場合、マスクを描画
      if (bbox) {
        const centerX = bbox.x + bbox.width / 2;
        const bottomY = bbox.y + bbox.height;
        const maskW = Math.max(80, bbox.width * 1.2);
        const maskH = Math.max(28, bbox.height * 1.5);
        const left = centerX - maskW / 2;
        const top = bottomY - maskH * 0.8;

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
      }

      // Share APIで保存（フォールバック付き）
      saveCanvas.toBlob(
        async (finalBlob) => {
          if (!finalBlob) {
            throw new Error('最終画像の生成に失敗しました');
          }

          // Share APIが使える場合はそれを使用
          if (navigator.share && navigator.canShare) {
            try {
              const file = new File([finalBlob], `number-mask-${Date.now()}.jpg`, {
                type: 'image/jpeg',
              });

              if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                  files: [file],
                  title: 'Number Mask',
                });
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 2500);
                setIsProcessing(false);
                return;
              }
            } catch (shareError) {
              // Share APIが失敗した場合はダウンロードにフォールバック
              console.warn('Share API failed, falling back to download:', shareError);
            }
          }

          // Share APIが使えない、または失敗した場合はダウンロード
          const url = URL.createObjectURL(finalBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `number-mask-${Date.now()}.jpg`;
          a.click();
          URL.revokeObjectURL(url);
          setShowSaveSuccess(true);
          setTimeout(() => setShowSaveSuccess(false), 2500);
          setIsProcessing(false);
        },
        'image/jpeg',
        0.92
      );
    } catch (error) {
      console.error('Save photo error:', error);
      const message = error instanceof Error ? error.message : '画像の保存に失敗しました';
      setCameraError(message);
      setDebugLog((prev) => prev ?? `保存処理エラー: ${message}`);
      setIsProcessing(false);
    }
  }, [detectedPlate, maskImage, detectPlate]);

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
        {debugLog && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700 font-mono whitespace-pre-wrap">
            {debugLog}
          </div>
        )}
        {!isCameraActive && (
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

        {isCameraActive && (
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
              {/* AR用：オーバーレイCanvas（リアルタイムでA_O_Iロゴを描画） */}
              <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ objectFit: 'cover' }}
              />
              {/* AI Scanning... インジケーター（画面の隅に小さく表示） */}
              {isScanning && (
                <div className="absolute top-2 right-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm">
                  <p className="text-xs text-gray-700 font-medium">AI Scanning...</p>
                </div>
              )}
            </div>
            <div className="flex justify-center gap-4">
              <button
                onClick={savePhoto}
                disabled={isProcessing}
                className="flex items-center gap-2 px-8 py-3 bg-gray-900 text-white rounded-2xl font-medium shadow hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#000000', color: '#FFFFFF' }}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    処理中...
                  </>
                ) : (
                  '保存'
                )}
              </button>
              <button
                onClick={stopCamera}
                disabled={isProcessing}
                className="flex items-center gap-2 px-8 py-3 bg-gray-200 text-gray-900 rounded-2xl font-medium shadow hover:bg-gray-300 transition-colors disabled:opacity-50"
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
