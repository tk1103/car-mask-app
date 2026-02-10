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
  const [isRateLimited, setIsRateLimited] = useState(false); // レート制限フラグ
  const [autoDetectionEnabled, setAutoDetectionEnabled] = useState(true); // 自動検出の有効/無効

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null); // AR用：オーバーレイCanvas
  const saveCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAttemptCountRef = useRef<number>(0);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null); // AR用：検出ループのタイマー
  const lastDetectionTimeRef = useRef<number>(0); // 最後に検出成功した時刻（永続化用）
  const isDetectingRef = useRef<boolean>(false); // 検出中フラグ（重複実行防止）

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
    // 既に検出中の場合はスキップ（重複実行防止）
    if (isDetectingRef.current) {
      return null;
    }

    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    isDetectingRef.current = true;
    try {
      setIsScanning(true);
      
      // 現在のビデオフレームをキャプチャ（速度向上のため解像度を下げる）
      const tempCanvas = document.createElement('canvas');
      // 最大640x480にリサイズ（API呼び出しを高速化、精度とのバランス）
      const maxWidth = 640;
      const maxHeight = 480;
      const scale = Math.min(maxWidth / video.videoWidth, maxHeight / video.videoHeight, 1);
      tempCanvas.width = Math.round(video.videoWidth * scale);
      tempCanvas.height = Math.round(video.videoHeight * scale);
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        return null;
      }

      // 画像の品質を向上させるため、スムージングを有効化
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';
      tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

      // CanvasをBlobに変換（品質を0.8に調整：速度と精度のバランス）
      const blob = await new Promise<Blob>((resolve, reject) => {
        tempCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('画像の変換に失敗しました'));
        }, 'image/jpeg', 0.8);
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
        let errorData: any;
        try {
          errorData = await response.json();
        } catch (jsonError) {
          // JSONパースに失敗した場合はテキストとして読み取る
          const errorText = await response.text();
          errorData = { error: `APIエラー (${response.status}): ${errorText.substring(0, 200)}` };
        }
        
        // レート制限エラー（429）の場合は特別なメッセージを表示
        if (response.status === 429) {
          const rateLimitMsg = '⚠️ APIレート制限に達しました。無料プランは1日20リクエストまでです。自動検出を停止しました。「手動検出」ボタンで検出できます。';
          setDebugLog(rateLimitMsg);
          setCameraError(rateLimitMsg);
          setIsRateLimited(true); // レート制限フラグを設定
          setAutoDetectionEnabled(false); // 自動検出を無効化
          console.warn('Rate limit exceeded:', errorData);
          // 検出ループを停止
          if (detectionIntervalRef.current) {
            clearInterval(detectionIntervalRef.current);
            detectionIntervalRef.current = null;
          }
          return null;
        }
        
        // エラーメッセージを構築
        const errorMsg = errorData.error 
          ? `APIエラー (${response.status}): ${errorData.error}`
          : `APIエラー (${response.status}): ${JSON.stringify(errorData).substring(0, 200)}`;
        
        setDebugLog(errorMsg);
        if (errorData.rawResponse) {
          console.warn('API error details:', errorData.rawResponse);
        }
        console.warn('Detection API error:', errorData);
        return null;
      }

      const result = await response.json();
      
      // デバッグ情報を常に表示（検出状況を確認するため）
      if (result.found && result.bbox) {
        const logMsg = `✓ 検出成功: x=${Math.round(result.bbox.x)}, y=${Math.round(result.bbox.y)}, w=${Math.round(result.bbox.width)}, h=${Math.round(result.bbox.height)}`;
        setDebugLog(logMsg);
        console.log('Detection success:', result.bbox);
        return result.bbox as PlateBbox;
      } else {
        // found=falseの場合もログに記録（問題特定のため）
        const errorMsg = result.error ? `検出失敗: ${result.error}` : 'ナンバープレートが見つかりませんでした';
        setDebugLog(errorMsg);
        if (result.rawResponse) {
          console.warn('API raw response:', result.rawResponse);
        }
        return null;
      }
    } catch (error) {
      const errorMsg = `検出エラー: ${error instanceof Error ? error.message : String(error)}`;
      setDebugLog(errorMsg);
      console.error('Detection error:', error);
      return null;
    } finally {
      setIsScanning(false);
      isDetectingRef.current = false;
    }
  }, []);

  // AR用：リアルタイム検出ループ（自動検出が有効な場合のみ）
  useEffect(() => {
    // レート制限に達している、または自動検出が無効な場合は停止
    if (!isCameraActive || !videoRef.current || isRateLimited || !autoDetectionEnabled) {
      setDetectedPlate(null);
      lastDetectionTimeRef.current = 0;
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      return;
    }

    // 初回検出（すぐに実行）
    setDebugLog('検出ループ開始...');
    detectPlate().then((bbox) => {
      if (bbox) {
        setDetectedPlate(bbox);
        lastDetectionTimeRef.current = Date.now();
        console.log('First detection success:', bbox);
      } else {
        console.log('First detection: no plate found');
      }
    }).catch((err) => {
      console.error('First detection error:', err);
      setDebugLog(`初回検出エラー: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 10秒おきに自動検出（レート制限対策：無料プランは1日20リクエストまで）
    // 5秒 → 10秒に延長して、より安全に
    detectionIntervalRef.current = setInterval(() => {
      // レート制限チェック
      if (isRateLimited || !autoDetectionEnabled) {
        if (detectionIntervalRef.current) {
          clearInterval(detectionIntervalRef.current);
          detectionIntervalRef.current = null;
        }
        return;
      }
      
      // 検出中でない場合のみ実行
      if (!isDetectingRef.current) {
        detectPlate().then((bbox) => {
          if (bbox) {
            setDetectedPlate(bbox);
            lastDetectionTimeRef.current = Date.now(); // 検出成功時刻を記録
            console.log('Interval detection success:', bbox);
          } else {
            // found=false の場合でも、最後の検出から15秒以内なら前回の結果を保持
            const timeSinceLastDetection = Date.now() - lastDetectionTimeRef.current;
            if (timeSinceLastDetection > 15000) {
              // 15秒以上検出されない場合はクリア
              setDetectedPlate(null);
              console.log('Clearing detectedPlate (15s timeout)');
            }
            // 15秒以内なら setDetectedPlate を呼ばず、前回の値を保持
          }
        }).catch((err) => {
          console.error('Interval detection error:', err);
        });
      } else {
        console.log('Skipping detection (already detecting)');
      }
    }, 10000); // 5秒 → 10秒に延長（レート制限対策）

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
  }, [isCameraActive, detectPlate, isRateLimited, autoDetectionEnabled]);

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

        // デバッグ: マスク描画位置を確認
        console.log(`Drawing mask at: left=${Math.round(left)}, top=${Math.round(top)}, w=${Math.round(maskW)}, h=${Math.round(maskH)}`);

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
      } else {
        // デバッグ: detectedPlateがnullの場合
        console.log('No detectedPlate, skipping mask drawing');
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
    setIsRateLimited(false); // レート制限フラグをリセット
    setAutoDetectionEnabled(true); // 自動検出を再有効化
    playAttemptCountRef.current = 0;
  }, []);

  // 手動検出関数（レート制限時や自動検出無効時に使用）
  const manualDetect = useCallback(async () => {
    if (!isCameraActive || !videoRef.current) {
      setDebugLog('カメラが起動していません');
      return;
    }
    
    setDebugLog('手動検出を実行中...');
    const bbox = await detectPlate();
    if (bbox) {
      setDetectedPlate(bbox);
      lastDetectionTimeRef.current = Date.now();
      setDebugLog(`✓ 検出成功: x=${Math.round(bbox.x)}, y=${Math.round(bbox.y)}`);
    } else {
      setDebugLog('ナンバープレートが見つかりませんでした');
    }
  }, [isCameraActive, detectPlate]);

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

        console.log(`Save: Drawing mask at: left=${Math.round(left)}, top=${Math.round(top)}, w=${Math.round(maskW)}, h=${Math.round(maskH)}`);

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
        setDebugLog(`保存: マスクを描画しました (x=${Math.round(bbox.x)}, y=${Math.round(bbox.y)})`);
      } else {
        setDebugLog('保存: ナンバープレートが見つかりませんでした');
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
          <div className={`mb-4 px-4 py-3 rounded-lg border text-xs font-mono whitespace-pre-wrap ${
            debugLog.includes('レート制限') || debugLog.includes('APIエラー') 
              ? 'bg-red-50 border-red-200 text-red-800' 
              : debugLog.includes('検出成功') || debugLog.includes('マスクを描画')
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-gray-100 border-gray-200 text-gray-700'
          }`}>
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
                <div className="absolute top-2 right-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm animate-pulse">
                  <p className="text-xs text-gray-700 font-medium flex items-center gap-1">
                    <Loader2 className="animate-spin" size={12} />
                    AI Scanning...
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
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
              {/* 手動検出ボタン（レート制限時や自動検出無効時に表示） */}
              {(isRateLimited || !autoDetectionEnabled) && (
                <div className="flex justify-center">
                  <button
                    onClick={manualDetect}
                    disabled={isProcessing || isScanning}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-xl font-medium shadow hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        検出中...
                      </>
                    ) : (
                      '手動検出'
                    )}
                  </button>
                </div>
              )}
              {/* 自動検出の有効/無効切り替え */}
              {!isRateLimited && (
                <div className="flex justify-center">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDetectionEnabled}
                      onChange={(e) => {
                        setAutoDetectionEnabled(e.target.checked);
                        setDebugLog(e.target.checked ? '自動検出を有効にしました' : '自動検出を無効にしました。手動検出ボタンを使用してください。');
                      }}
                      className="w-4 h-4"
                    />
                    <span>自動検出を有効にする</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        <canvas ref={saveCanvasRef} className="hidden" />
      </main>
    </div>
  );
}
