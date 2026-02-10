'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle } from 'lucide-react';

// type DetectedCar = {
//   bbox: [number, number, number, number]; // [x, y, width, height]
//   score: number;
// };

export default function Home() {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  // const [detectedCars, setDetectedCars] = useState<DetectedCar[]>([]);
  // const [isModelLoading, setIsModelLoading] = useState(true);
  // const [model, setModel] = useState<any>(null);
  // const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  // const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  // const overlayRef = useRef<HTMLCanvasElement>(null);
  // const saveCanvasRef = useRef<HTMLCanvasElement>(null);
  // const detectionLoopRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load COCO-SSD model - コメントアウト
  // useEffect(() => {
  //   let cancelled = false;
  //   (async () => {
  //     try {
  //       const cocoSsd = await import('@tensorflow-models/coco-ssd');
  //       const m = await cocoSsd.load();
  //       if (!cancelled) {
  //         setModel(m);
  //       }
  //     } catch (err) {
  //       console.error('Failed to load coco-ssd:', err);
  //     } finally {
  //       if (!cancelled) {
  //         setIsModelLoading(false);
  //       }
  //     }
  //   })();
  //   return () => {
  //     cancelled = true;
  //   };
  // }, []);

  // Load mask image (optional) - コメントアウト
  // useEffect(() => {
  //   const img = new Image();
  //   img.crossOrigin = 'anonymous';
  //   img.onload = () => setMaskImage(img);
  //   img.onerror = () => setMaskImage(null);
  //   img.src = '/mask-logo.png';
  // }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null); // エラーをクリア

    if (!navigator.mediaDevices?.getUserMedia) {
      const errorMsg = 'カメラAPIが利用できません。スマホでは https:// でアクセスする必要があります。';
      setCameraError(errorMsg);
      return;
    }

    try {
      // 最もシンプルな設定: video: true だけ
      const s = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      
      streamRef.current = s;
      setStream(s);
      
      if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = s;
        
        // iOS Safari等のブラウザ制限を回避するため、確実にplay()を実行
        try {
          const playPromise = v.play();
          if (playPromise !== undefined) {
            await playPromise;
          }
        } catch (playErr) {
          // play()が失敗した場合のエラーハンドリング
          const playErrorMsg = `動画の再生に失敗しました: ${playErr instanceof Error ? playErr.message : String(playErr)}`;
          setCameraError(playErrorMsg);
          console.error('Video play error:', playErr);
          
          // ストリームを停止してクリーンアップ
          s.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setStream(null);
          return;
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
    // if (detectionLoopRef.current != null) {
    //   cancelAnimationFrame(detectionLoopRef.current);
    //   detectionLoopRef.current = null;
    // }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setIsCameraActive(false);
    // setDetectedCars([]);
    setCameraError(null); // カメラ停止時にエラーもクリア
  }, []);

  // Detection loop - コメントアウト
  // useEffect(() => {
  //   if (!model || !isCameraActive || !videoRef.current || !overlayRef.current) return;
  //   ...
  // }, [model, isCameraActive, maskImage]);

  // Save photo - コメントアウト
  // const savePhoto = useCallback(() => {
  //   ...
  // }, [detectedCars, maskImage]);

  return (
    <div className="min-h-screen bg-white pb-20">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Number Mask</h1>
        </div>
      </header>

      {/* 保存成功メッセージ - コメントアウト */}
      {/* {showSaveSuccess && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-lg p-8 flex flex-col items-center gap-4 shadow-2xl animate-scale-in">
            <CheckCircle className="text-green-500" size={64} />
            <p className="text-gray-900 font-bold text-2xl">保存しました</p>
          </div>
        </div>
      )} */}

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* モデル読み込み中 - コメントアウト */}
        {/* {isModelLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="animate-spin text-gray-900" size={48} />
            <p className="text-gray-600">モデルを読み込み中...</p>
          </div>
        )} */}

        {!isCameraActive && (
          <div className="flex flex-col items-center justify-center py-12 gap-6">
            <p className="text-gray-600 text-center">
              カメラを起動して映像を表示します
            </p>
            <button
              onClick={startCamera}
              className="flex items-center gap-2 px-6 py-4 bg-gray-900 text-white rounded-xl font-medium shadow-lg hover:bg-gray-800 transition-colors"
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
            {/* 画面いっぱいにカメラ映像を表示 */}
            <div className="relative w-full h-screen max-h-[calc(100vh-200px)] bg-gray-900">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full"
                style={{
                  objectFit: 'cover',
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  border: '4px solid red',
                }}
                onLoadedMetadata={() => {
                  // メタデータ読み込み後に確実に再生
                  if (videoRef.current) {
                    videoRef.current.play().catch((err) => {
                      console.warn('Auto-play failed on loadedMetadata:', err);
                    });
                  }
                }}
                onCanPlay={() => {
                  // iOSでの再生成功率を上げるため、onCanPlayでも再生を試行
                  if (videoRef.current) {
                    videoRef.current.play().catch((err) => {
                      console.warn('Auto-play failed on canPlay:', err);
                    });
                  }
                }}
              />
              {/* オーバーレイcanvas - コメントアウト */}
              {/* <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              /> */}
            </div>
            <div className="flex justify-center gap-4">
              {/* 保存ボタン - コメントアウト */}
              {/* <button
                onClick={savePhoto}
                className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl font-medium shadow hover:bg-gray-800 transition-colors"
              >
                保存
              </button> */}
              <button
                onClick={stopCamera}
                className="flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-900 rounded-xl font-medium shadow hover:bg-gray-300 transition-colors"
              >
                カメラを止める
              </button>
            </div>
          </div>
        )}

        {/* 保存用canvas - コメントアウト */}
        {/* <canvas ref={saveCanvasRef} className="hidden" /> */}
      </main>
    </div>
  );
}
