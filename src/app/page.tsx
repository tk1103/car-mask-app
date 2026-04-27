'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Loader2, CheckCircle, RotateCcw, Share2, Facebook, Twitter, Instagram, Copy, Download, Monitor, ImagePlus, Download as DownloadIcon } from 'lucide-react';

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
const CARKUS_DOWNLOAD_COUNT_KEY = 'carkus_download_count';

type DetectErrorType =
  | 'rate_limited'
  | 'bad_request'
  | 'config'
  | 'quota'
  | 'upstream'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'unknown';

type DetectApiResponse = {
  found?: boolean;
  plates?: Array<{ corners?: Array<{ x: number; y: number }> }>;
  corners?: Array<{ x: number; y: number }>;
  error?: unknown;
  userMessage?: string;
  errorType?: DetectErrorType;
  requestId?: string;
  retryAfterSeconds?: number;
  remainingToday?: number;
};

/** ダウンロードファイル名用の連番を取得しインクリメント。Carkus-001.jpg, Carkus-002.jpg ... */
function getNextCarkusFilename(): string {
  if (typeof window === 'undefined' || !window.localStorage) return `Carkus-${Date.now()}.jpg`;
  let n = 1;
  try {
    const s = window.localStorage.getItem(CARKUS_DOWNLOAD_COUNT_KEY);
    if (s) n = Math.max(1, parseInt(s, 10) || 1);
    window.localStorage.setItem(CARKUS_DOWNLOAD_COUNT_KEY, String(n + 1));
  } catch (_) {}
  return `Carkus-${String(n).padStart(3, '0')}.jpg`;
}

/** デバイス単位の識別用。サーバー側の日次ブロックは行わず、あくまで利用状況の参考にのみ使用する。 */
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

/** 編集用デフォルト四角（正規化座標 0-1）。解析失敗時やAPIエラー時に使用。一般的なナンバープレート位置（画像下部中央） */
function getDefaultCenterCorners(): Corners {
  return [
    { x: 0.28, y: 0.70 },
    { x: 0.72, y: 0.70 },
    { x: 0.72, y: 0.90 },
    { x: 0.28, y: 0.90 },
  ];
}

function normalizeCornersOrder(corners: Corners): Corners {
  return corners;
}

function getPlateBaseAngle(corners: Corners): number {
  const topDx = corners[1].x - corners[0].x;
  const topDy = corners[1].y - corners[0].y;
  const bottomDx = corners[2].x - corners[3].x;
  const bottomDy = corners[2].y - corners[3].y;
  const angleTop = Math.atan2(topDy, topDx);
  const angleBottom = Math.atan2(bottomDy, bottomDx);
  let baseAngle = (angleTop + angleBottom) / 2;
  if (Math.abs(angleTop - angleBottom) > Math.PI) {
    baseAngle += Math.PI;
  }
  return baseAngle;
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

function mapUvToQuad(quad: QuadPx, u: number, v: number): { x: number; y: number } {
  const [tl, tr, br, bl] = quad;
  const oneMinusU = 1 - u;
  const oneMinusV = 1 - v;
  return {
    x:
      oneMinusU * oneMinusV * tl.x +
      u * oneMinusV * tr.x +
      u * v * br.x +
      oneMinusU * v * bl.x,
    y:
      oneMinusU * oneMinusV * tl.y +
      u * oneMinusV * tr.y +
      u * v * br.y +
      oneMinusU * v * bl.y,
  };
}

function buildInnerQuadFromRect(quad: QuadPx, x0: number, y0: number, x1: number, y1: number): QuadPx {
  return [
    mapUvToQuad(quad, x0, y0),
    mapUvToQuad(quad, x1, y0),
    mapUvToQuad(quad, x1, y1),
    mapUvToQuad(quad, x0, y1),
  ];
}

// 黒マスクの真ん中に Carkus ロゴを配置（座標系の原点 0,0 が中央）
function drawCarkusLogoAtOrigin(
  ctx: CanvasRenderingContext2D,
  logoWidth: number,
  logoHeight: number,
  _options?: { backgroundAlpha?: number },
  logoImage?: HTMLImageElement | null
) {
  const gothicFont = '-apple-system, "Helvetica Neue", "Hiragino Sans", "Yu Gothic", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (logoImage?.complete && logoImage.naturalWidth && logoImage.naturalHeight) {
    const svgAspect = logoImage.naturalWidth / logoImage.naturalHeight;
    // マスクに対して「約80%」を目標サイズにする
    const targetW = Math.max(1, logoWidth * 0.8);
    const targetH = Math.max(1, logoHeight * 0.8);
    let drawW = targetW;
    let drawH = drawW / svgAspect;
    if (drawH > targetH) {
      drawH = targetH;
      drawW = drawH * svgAspect;
    }
    const offsetX = drawW * 0.1;
    ctx.save();
    ctx.filter = 'brightness(0) invert(1)';
    ctx.drawImage(logoImage, -drawW / 2 + offsetX, -drawH / 2, drawW, drawH);
    ctx.restore();
  } else {
    const trialSize = Math.min(logoWidth * 0.42, logoHeight * 0.84, 44);
    ctx.font = `500 ${trialSize}px ${gothicFont}`;
    const textW = ctx.measureText('Carkus').width;
    const fontSize = textW > logoWidth * 0.95 ? (trialSize * (logoWidth * 0.95) / textW) : trialSize;
    ctx.font = `500 ${Math.max(22, fontSize)}px ${gothicFont}`;
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
const API_DAILY_LIMIT = 20; // UI 上の目安値（Gemini 側の実際の上限とは異なる場合があります）
const LOCAL_DAILY_FREE_LIMIT = 1;
const LOCAL_DAILY_SUCCESS_KEY = 'carkus_daily_success_usage';
const PLAN_STORAGE_KEY = 'carkus_plan';
const FREE_DAILY_LIMIT_DISABLED = true; // 検証期間は無料版の日次回数制限を解除

// 編集画面のロゴ描画用（quad のアスペクトに合わせて横縮みしない）
const LOGO_CANVAS_WIDTH = 400;

type Lang = 'ja' | 'en';
type Plan = 'free' | 'pro';
const t = {
  ja: {
    beta: 'BETA',
    close: '閉じる',
    finish: '終了',
    launchCamera: 'カメラを起動',
    pickPhoto: '写真を選択',
    capture: '撮影する',
    processing: '解析中',
    processingDurationHint: '目安は10〜40秒です。混雑時は1分前後かかることがあります',
    processingElapsed: '経過 {sec} 秒',
    processingWaitMore: 'まだ解析中です。このままお待ちください。',
    processingRetakeIfSlow: '20秒以上かかる場合は、通信混雑の可能性があります。下の「撮り直し」で明るい所・至近距離からやり直せます。',
    processingSidebarHint: '枠の調整は解析の完了後に行えます。今は解析の終了をお待ちください。',
    manualGuideTitle: '手動で枠を合わせる',
    manualGuideWhy:
      '自動でナンバープレート上の枠位置を特定できませんでした（明るさ・距離・反射などの影響で起こり得ます）。次の3ステップで同じ品質に仕上げられます。',
    manualStep1: '「サイズ」で枠（ロゴ）の大きさをプレート幅に合わせる',
    manualStep2: '写真上を指でドラッグして、枠をプレートの上に乗せる',
    manualStep3: '必要なら「角度」で回転を整える',
    guideClose: 'この説明を閉じる',
    serverRetrying: 'サーバー混雑のため {sec} 秒後に再試行します（{cur}/{max}）',
    saveSuccess: '保存しました',
    saveThanks: 'ご利用ありがとうございます',
    retake: '撮り直す',
    angle: '角度',
    size: 'サイズ',
    other: 'その他',
    copy: 'コピー',
    nearbyPc: '近くのPC',
    install: 'アプリをインストール',
    addHomeIOS: 'ホーム画面に追加（iOS）',
    addHomeAndroid: 'ホーム画面に追加（Android）',
    addHome: 'ホーム画面に追加',
    addHomeChrome: 'ホーム画面に追加（Chrome）',
    cameraLaunchHint: 'カメラを起動して撮影してください',
    dailyNote: `BETA: このアプリの想定は 1日あたり約${API_DAILY_LIMIT}回ですが、実際の上限はご利用中の Google アカウントの Gemini API 制限に依存します。`,
    cameraDailyNote: `このアプリの目安は 1日あたり約${API_DAILY_LIMIT}回ですが、実際の上限は Google Gemini API 側の利用制限により前後する場合があります。`,
    cameraDailyNoteShort: '無料版では Google Gemini API の利用制限により、1日にご利用いただける回数が変動する場合があります。',
    autoDetectFailedManual: '自動検出に失敗しました。手動で位置を合わせてください。',
    timeoutManual: '解析がタイムアウトしました。位置を手動で調整してください。',
    imageFileOnly: '画像ファイルを選択してください。',
    imageLoadFailed: '画像の読み込みに失敗しました',
    imageSizeFailed: '画像サイズを取得できませんでした',
    cameraHttpsRequired: 'カメラを利用するには https でアクセスしてください。',
    cameraPermissionError: 'カメラの許可をオンにしてください。',
    cameraStartFailed: 'カメラを起動できませんでした。許可と接続をご確認ください。',
    networkUnstable: '通信が不安定です。再接続後に再試行するか、手動で位置を合わせてください。',
    parseFailed: '自動検出の応答を解釈できませんでした。手動で位置を合わせてください。',
    processingSlow: '解析に時間がかかりすぎました。手動で位置を合わせて保存してください。',
    configIssue: '現在自動検出の設定に問題があります。手動で位置を合わせてください。',
    imageReadFailed: '画像の読み取りに失敗しました。撮り直すか、手動で位置を合わせてください。',
    serverBusyRetry: 'サーバーが混み合っています。少し時間をおいて再試行してください。手動調整はそのまま利用できます。',
    dailyFreeLimitReached: '本日の無料枠を使い切りました。',
    freeQuotaLabel: '本日の無料解析',
    freeWatermarkNote: '無料版の保存画像には Carkus 透かしが入ります。',
    freeQuotaUnlimitedTesting: '検証モード: 無料版の日次回数制限を一時的に解除中です。',
    plan: 'プラン',
    free: '無料版',
    pro: '課金版',
    proUnlimitedHint: '課金版は日次無料枠の制限対象外です。',
  },
  en: {
    beta: 'BETA',
    close: 'Close',
    finish: 'Exit',
    launchCamera: 'Open Camera',
    pickPhoto: 'Pick Photo',
    capture: 'Capture',
    processing: 'Processing',
    processingDurationHint: 'Usually 10–40s; when busy, about a minute is possible.',
    processingElapsed: '{sec}s elapsed',
    processingWaitMore: 'Still analyzing. Please keep waiting.',
    processingRetakeIfSlow: 'If this takes 20+ seconds, the line may be busy. Use Retake for a closer, brighter shot.',
    processingSidebarHint: 'You can move the frame after analysis finishes. Please wait.',
    manualGuideTitle: 'Align the frame yourself',
    manualGuideWhy:
      "We could not find the frame on the license plate (light, distance, or reflections can cause this). Follow these 3 steps for the same result.",
    manualStep1: "Use 'Size' to match the frame (logo) width to the plate",
    manualStep2: "Drag on the photo to place the frame on the plate",
    manualStep3: "Optionally use 'Angle' to fine-tune rotation",
    guideClose: 'Dismiss this help',
    serverRetrying: 'Server busy. Retrying in {sec}s ({cur}/{max})',
    saveSuccess: 'Saved',
    saveThanks: 'Thank you for using Carkus',
    retake: 'Retake',
    angle: 'Angle',
    size: 'Size',
    other: 'More',
    copy: 'Copy',
    nearbyPc: 'Nearby PC',
    install: 'Install App',
    addHomeIOS: 'Add to Home Screen (iOS)',
    addHomeAndroid: 'Add to Home Screen (Android)',
    addHome: 'Add to Home Screen',
    addHomeChrome: 'Add to Home Screen (Chrome)',
    cameraLaunchHint: 'Open camera and take a photo',
    dailyNote: `BETA: This app targets about ${API_DAILY_LIMIT} uses per day, but actual limits depend on your Google Gemini API quota.`,
    cameraDailyNote: `This app targets about ${API_DAILY_LIMIT} uses per day, but actual limits may vary by Google Gemini API quota.`,
    cameraDailyNoteShort: 'On free tier, daily usage may vary due to Google Gemini API limits.',
    autoDetectFailedManual: 'Auto-detection failed. Please adjust position manually.',
    timeoutManual: 'Detection timed out. Please adjust position manually.',
    imageFileOnly: 'Please select an image file.',
    imageLoadFailed: 'Failed to load image.',
    imageSizeFailed: 'Failed to read image dimensions.',
    cameraHttpsRequired: 'Camera access requires HTTPS.',
    cameraPermissionError: 'Please enable camera permission.',
    cameraStartFailed: 'Could not start camera. Check permission and connection.',
    networkUnstable: 'Network looks unstable. Retry or adjust position manually.',
    parseFailed: 'Could not parse detection response. Please adjust manually.',
    processingSlow: 'Detection is taking too long. Please adjust manually and save.',
    configIssue: 'Auto-detection config issue detected. Please adjust manually.',
    imageReadFailed: 'Failed to read image. Retake or adjust manually.',
    serverBusyRetry: 'Server is busy. Please retry in a moment. Manual adjustment is available.',
    dailyFreeLimitReached: 'You have used all free attempts for today.',
    freeQuotaLabel: 'Daily free detections',
    freeWatermarkNote: 'Saved images on Free plan include a Carkus watermark.',
    freeQuotaUnlimitedTesting: 'Testing mode: Daily free limit is temporarily disabled.',
    plan: 'Plan',
    free: 'Free',
    pro: 'Pro',
    proUnlimitedHint: 'Pro is not limited by the daily free quota.',
  },
} as const;

function fillI18nTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}

function getJstDateString(): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const y = jstDate.getUTCFullYear();
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('ja');
  const [screenMode, setScreenMode] = useState<'idle' | 'camera' | 'preview_edit'>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingElapsedSec, setProcessingElapsedSec] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);

  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<Corners[]>([]); // 複数プレート対応
  const [detectedBaseAngles, setDetectedBaseAngles] = useState<number[]>([]); // 各プレートの初期角度（API検出時）
  const [editLogoOffset, setEditLogoOffset] = useState({ x: 0, y: 0 });
  const [editLogoScale, setEditLogoScale] = useState(1);
  const [editLogoRotation, setEditLogoRotation] = useState(0); // 度（-30〜30）
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [showFlash, setShowFlash] = useState(false); // フラッシュ効果用
  const [showShareMenu, setShowShareMenu] = useState(false); // SNS共有メニュー表示用
  const [isBlurWarning, setIsBlurWarning] = useState(false);
  const [detectionFailed, setDetectionFailed] = useState(false); // 編集画面では常に「編集モード」として扱い、トーストのみ表示
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [retryStatusText, setRetryStatusText] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null); // APIから返る本日の残り回数（null=未取得）
  const [localDailySuccessCount, setLocalDailySuccessCount] = useState(0);
  const [carkusLogoImage, setCarkusLogoImage] = useState<HTMLImageElement | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [plan, setPlan] = useState<Plan>('free');
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoPickerRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeDetectControllerRef = useRef<AbortController | null>(null);
  const activeDetectRequestIdRef = useRef(0);
  const objectUrlRegistryRef = useRef<Set<string>>(new Set());
  const playAttemptCountRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number; startOffset: { x: number; y: number } } | null>(null);
  const scaleStartRef = useRef<{ y: number; startScale: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const logoCanvasRef = useRef<HTMLCanvasElement | null>(null); // 編集画面でマスク画像が無いときのロゴ用オフスクリーン
  const langRef = useRef<Lang>('ja');

  const text = t[lang];
  const isFreePlan = plan === 'free';

  const tx = useCallback((key: keyof typeof t.ja): string => t[langRef.current][key], []);

  const loadLocalDailyUsage = useCallback(() => {
    if (typeof window === 'undefined' || !window.localStorage) {
      setLocalDailySuccessCount(0);
      return { date: getJstDateString(), count: 0 };
    }
    const today = getJstDateString();
    try {
      const raw = window.localStorage.getItem(LOCAL_DAILY_SUCCESS_KEY);
      if (!raw) {
        setLocalDailySuccessCount(0);
        return { date: today, count: 0 };
      }
      const parsed = JSON.parse(raw) as { date?: string; count?: number };
      const count = parsed.date === today ? Math.max(0, Number(parsed.count || 0)) : 0;
      setLocalDailySuccessCount(count);
      if (parsed.date !== today) {
        window.localStorage.setItem(LOCAL_DAILY_SUCCESS_KEY, JSON.stringify({ date: today, count: 0 }));
      }
      return { date: today, count };
    } catch (_) {
      setLocalDailySuccessCount(0);
      return { date: today, count: 0 };
    }
  }, []);

  const hasLocalDailyQuota = useCallback(() => {
    if (!isFreePlan) return true;
    if (FREE_DAILY_LIMIT_DISABLED) return true;
    const usage = loadLocalDailyUsage();
    return usage.count < LOCAL_DAILY_FREE_LIMIT;
  }, [isFreePlan, loadLocalDailyUsage]);

  const incrementLocalDailyUsageOnSuccess = useCallback(() => {
    if (!isFreePlan) return;
    if (typeof window === 'undefined' || !window.localStorage) return;
    const today = getJstDateString();
    const usage = loadLocalDailyUsage();
    const nextCount = Math.min(LOCAL_DAILY_FREE_LIMIT, usage.count + 1);
    try {
      window.localStorage.setItem(LOCAL_DAILY_SUCCESS_KEY, JSON.stringify({ date: today, count: nextCount }));
    } catch (_) {}
    setLocalDailySuccessCount(nextCount);
  }, [isFreePlan, loadLocalDailyUsage]);

  const createTrackedObjectUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlRegistryRef.current.add(url);
    return url;
  }, []);

  const revokeTrackedObjectUrl = useCallback((url: string | null | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlRegistryRef.current.delete(url);
  }, []);

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
    return () => {
      activeDetectControllerRef.current?.abort();
      objectUrlRegistryRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlRegistryRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const detectedLang = navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
    setLang(detectedLang);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const saved = window.localStorage.getItem(PLAN_STORAGE_KEY);
      if (saved === 'free' || saved === 'pro') setPlan(saved);
    } catch (_) {}
  }, []);

  const updatePlan = useCallback((next: Plan) => {
    setPlan(next);
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(PLAN_STORAGE_KEY, next);
    } catch (_) {}
  }, []);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

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

  useEffect(() => {
    loadLocalDailyUsage();
  }, [loadLocalDailyUsage]);

  /** 画面表示用に残り回数を取得（APIは消費しない） */
  const fetchRemainingQuota = useCallback(async () => {
    try {
      const deviceId = getDeviceId();
      const res = await fetch('/api/detect', {
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

  const showManualHelpAfterFailure = useCallback(() => {
    setDetectionFailed(true);
    setShowManualGuide(true);
  }, []);

  const getMessageByErrorType = useCallback((errorType?: DetectErrorType, fallbackMessage?: string, retryAfterSeconds?: number) => {
    switch (errorType) {
      case 'quota':
      case 'rate_limited':
        return retryAfterSeconds
          ? `${tx('serverBusyRetry')} (${retryAfterSeconds}s)`
          : tx('serverBusyRetry');
      case 'timeout':
        return tx('processingSlow');
      case 'config':
        return tx('configIssue');
      case 'network':
        return tx('networkUnstable');
      case 'invalid_response':
        return tx('parseFailed');
      case 'bad_request':
        return tx('imageReadFailed');
      default:
        return fallbackMessage || tx('autoDetectFailedManual');
    }
  }, [tx]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(tx('cameraHttpsRequired'));
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
      setCameraError(msg.includes('Permission') ? tx('cameraPermissionError') : tx('cameraStartFailed'));
    }
  }, [tx]);

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
    setDetectedBaseAngles([]);
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

  const handlePickImageFromDevice = useCallback(() => {
    photoPickerRef.current?.click();
  }, []);

  const handleImageFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setCameraError(tx('imageFileOnly'));
      return;
    }
    if (!hasLocalDailyQuota()) {
      setCameraError(tx('dailyFreeLimitReached'));
      return;
    }

    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    const requestId = activeDetectRequestIdRef.current + 1;
    activeDetectRequestIdRef.current = requestId;
    const isLatestRequest = () => activeDetectRequestIdRef.current === requestId;

    setIsProcessing(true);
    setCameraError(null);
    setDetectionFailed(false);
    setShowManualGuide(false);
    setRetryStatusText(null);

    try {
      const pickedUrl = createTrackedObjectUrl(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(tx('imageLoadFailed')));
        img.src = pickedUrl;
      });
      revokeTrackedObjectUrl(pickedUrl);

      const originalW = img.naturalWidth || img.width;
      const originalH = img.naturalHeight || img.height;
      if (!originalW || !originalH) throw new Error(tx('imageSizeFailed'));

      const fullResCanvas = document.createElement('canvas');
      fullResCanvas.width = originalW;
      fullResCanvas.height = originalH;
      const fullResCtx = fullResCanvas.getContext('2d');
      if (!fullResCtx) throw new Error('Canvas error');
      fullResCtx.drawImage(img, 0, 0, originalW, originalH);

      const fullResBlob = await new Promise<Blob>((resolve, reject) => {
        fullResCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.98);
      });

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

      const MAX_VERCEL_BODY_BYTES = Math.floor(4.5 * 1024 * 1024);
      const encodeCanvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', quality);
        });
      const compressCanvasToLimit = async (canvas: HTMLCanvasElement, initialQuality: number, minQuality = 0.45, qualityStep = 0.08): Promise<Blob> => {
        const tryCompress = async (quality: number): Promise<Blob> => {
          const blob = await encodeCanvasToJpeg(canvas, quality);
          if (blob.size <= MAX_VERCEL_BODY_BYTES || quality <= minQuality) return blob;
          return tryCompress(Math.max(minQuality, quality - qualityStep));
        };
        return tryCompress(initialQuality);
      };
      const apiBlob = await compressCanvasToLimit(apiCanvas, 0.88);

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
      const apiBlobSmall = await compressCanvasToLimit(apiCanvasSmall, 0.85);

      setPreviewImageUrl(createTrackedObjectUrl(fullResBlob));
      setScreenMode('preview_edit');
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(1);
      setEditLogoRotation(0);
      setToastMessage(null);
      setIsProcessing(true);

      setTimeout(() => {
        const blurScore = getBlurScore(apiCanvas);
        setIsBlurWarning(blurScore < BLUR_SCORE_THRESHOLD);
      }, 0);

      const createFormData = (useSmallImage = false) => {
        const fd = new FormData();
        if (useSmallImage) {
          fd.append('image', apiBlobSmall, 'photo-small.jpg');
          fd.append('width', apiWSmall.toString());
          fd.append('height', apiHSmall.toString());
        } else {
          fd.append('image', apiBlob, 'photo.jpg');
          fd.append('width', apiW.toString());
          fd.append('height', apiH.toString());
        }
        return fd;
      };

      const controller = new AbortController();
      activeDetectControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 48_000);
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      try {
        const deviceId = getDeviceId();
        const maxRetryCount = 2;
        let lastResponse: Response | null = null;
        let lastResult: DetectApiResponse | null = null;

        for (let attempt = 0; attempt <= maxRetryCount; attempt++) {
          const useSmallImage = attempt > 0;
          const res = await fetch('/api/detect', {
            method: 'POST',
            body: createFormData(useSmallImage),
            signal: controller.signal,
            headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
          });
          let result: DetectApiResponse = {};
          try {
            result = await res.json();
          } catch (_) {
            result = { error: { code: 'INVALID_JSON', message: 'Invalid JSON response' } };
          }
          lastResponse = res;
          lastResult = result;
          if (res.status !== 429 || attempt === maxRetryCount) break;

          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterFromHeader = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
          const retryAfterFromBody = typeof result.retryAfterSeconds === 'number' ? result.retryAfterSeconds : NaN;
          const serverSuggestedSeconds = Number.isFinite(retryAfterFromBody) ? retryAfterFromBody : Number.isFinite(retryAfterFromHeader) ? retryAfterFromHeader : 0;
          const baseBackoffMs = 1500 * Math.pow(2, attempt);
          const jitterMs = Math.floor(Math.random() * 700);
          const backoffMs = Math.max(baseBackoffMs + jitterMs, serverSuggestedSeconds * 1000);
          setRetryStatusText(
            fillI18nTemplate(tx('serverRetrying'), {
              sec: Math.ceil(backoffMs / 1000),
              cur: attempt + 1,
              max: maxRetryCount + 1,
            })
          );
          await wait(backoffMs);
        }

        if (lastResponse && lastResult && isLatestRequest()) {
          const remaining = lastResult.remainingToday;
          if (remaining !== undefined) setDailyRemaining(remaining);
          if (!lastResponse.ok) {
            const errPayload = lastResult.error;
            const msg = typeof errPayload === 'string' ? errPayload : lastResult.userMessage || tx('autoDetectFailedManual');
            setToastMessage(getMessageByErrorType(lastResult.errorType, msg, lastResult.retryAfterSeconds));
            showManualHelpAfterFailure();
          } else if (lastResult.found && lastResult.plates && Array.isArray(lastResult.plates) && lastResult.plates.length > 0) {
            const platesCorners: Corners[] = lastResult.plates
              .filter((plate: any) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4)
              .map((plate: any) => normalizeCornersOrder(apiCornersToClient(plate)));
            if (platesCorners.length > 0) {
              setDetectedCorners(platesCorners);
              setDetectedBaseAngles(platesCorners.map((corners) => getPlateBaseAngle(corners)));
              setEditLogoOffset({ x: 0, y: 0 });
              setEditLogoScale(1);
              setEditLogoRotation(0);
              setDetectionFailed(false);
            } else {
              setToastMessage(tx('autoDetectFailedManual'));
              showManualHelpAfterFailure();
            }
          } else if (lastResult.found && lastResult.corners && Array.isArray(lastResult.corners) && lastResult.corners.length === 4) {
            const single = normalizeCornersOrder(apiCornersToClient({ corners: lastResult.corners }));
            setDetectedCorners([single]);
            setDetectedBaseAngles([getPlateBaseAngle(single)]);
            setEditLogoOffset({ x: 0, y: 0 });
            setEditLogoScale(1);
            setEditLogoRotation(0);
            setDetectionFailed(false);
            incrementLocalDailyUsageOnSuccess();
          } else {
            setToastMessage(tx('autoDetectFailedManual'));
            showManualHelpAfterFailure();
          }
          if (lastResult.found && lastResult.plates && Array.isArray(lastResult.plates) && lastResult.plates.length > 0) {
            const hasAnyValidPlate = lastResult.plates.some((plate: any) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4);
            if (hasAnyValidPlate) incrementLocalDailyUsageOnSuccess();
          }
        }
      } finally {
        clearTimeout(timeoutId);
        if (activeDetectControllerRef.current === controller) {
          activeDetectControllerRef.current = null;
        }
        if (isLatestRequest()) {
          setIsProcessing(false);
          setRetryStatusText(null);
        }
      }
    } catch (err) {
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(1);
      setEditLogoRotation(0);
      setScreenMode('preview_edit');
      setToastMessage(`画像の解析に失敗しました。手動で位置を合わせてください。${err instanceof Error ? ` (${err.message})` : ''}`);
      showManualHelpAfterFailure();
      setIsProcessing(false);
      setRetryStatusText(null);
    }
  }, [createTrackedObjectUrl, getMessageByErrorType, hasLocalDailyQuota, incrementLocalDailyUsageOnSuccess, showManualHelpAfterFailure, revokeTrackedObjectUrl, tx]);

  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    if (!hasLocalDailyQuota()) {
      setCameraError(tx('dailyFreeLimitReached'));
      return;
    }
    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    const requestId = activeDetectRequestIdRef.current + 1;
    activeDetectRequestIdRef.current = requestId;
    const isLatestRequest = () => activeDetectRequestIdRef.current === requestId;

    // 撮影前に残数チェック（UI 上の目安表示用）。サーバー側では日次ブロックは行わない。
    try {
      const deviceId = getDeviceId();
      const quotaRes = await fetch('/api/detect', {
        headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
      });
      if (quotaRes.ok) {
        const quotaData = await quotaRes.json();
        const remaining = quotaData.remainingToday;
        if (typeof remaining === 'number') setDailyRemaining(remaining);
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
    setDetectionFailed(false);
    setShowManualGuide(false);
    setRetryStatusText(null);

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

      // API送信: 長辺は必ず1024px以下に抑える（Gemini無料枠の負荷軽減）
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

      const MAX_VERCEL_BODY_BYTES = Math.floor(4.5 * 1024 * 1024); // 4.5MB
      const encodeCanvasToJpeg = (canvas: HTMLCanvasElement, quality: number) =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', quality);
        });

      const compressCanvasToLimit = async (
        canvas: HTMLCanvasElement,
        initialQuality: number,
        minQuality = 0.45,
        qualityStep = 0.08
      ): Promise<Blob> => {
        const tryCompress = async (quality: number): Promise<Blob> => {
          const blob = await encodeCanvasToJpeg(canvas, quality);
          if (blob.size <= MAX_VERCEL_BODY_BYTES || quality <= minQuality) {
            if (blob.size > MAX_VERCEL_BODY_BYTES) {
              console.warn('Image still exceeds Vercel payload limit at minimum quality.', {
                size: blob.size,
                quality,
                limit: MAX_VERCEL_BODY_BYTES,
              });
            }
            return blob;
          }
          return tryCompress(Math.max(minQuality, quality - qualityStep));
        };
        return tryCompress(initialQuality);
      };

      const apiBlob = await compressCanvasToLimit(apiCanvas, 0.88);

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
      const apiBlobSmall = await compressCanvasToLimit(apiCanvasSmall, 0.85);

      // 投機的実行: 即座に編集画面へ移行し、中央にデフォルトロゴを表示。API はバックグラウンドで実行
      setPreviewImageUrl(createTrackedObjectUrl(fullResBlob));
      setScreenMode('preview_edit');
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
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

      const createFormData = (useSmallImage = false) => {
        const fd = new FormData();
        if (useSmallImage) {
          fd.append('image', apiBlobSmall, 'photo-small.jpg');
          fd.append('width', apiWSmall.toString());
          fd.append('height', apiHSmall.toString());
        } else {
          fd.append('image', apiBlob, 'photo.jpg');
          fd.append('width', apiW.toString());
          fd.append('height', apiH.toString());
        }
        return fd;
      };

      const applyResult = (result: DetectApiResponse, res: Response) => {
        console.group('Carkus API Debug');
        console.log('status:', res.status);
        console.log('statusText:', res.statusText);
        console.log('result:', result);
        console.groupEnd();

        const remaining = result.remainingToday;
        if (remaining !== undefined) setDailyRemaining(remaining);
        if (!res.ok) {
          const errorPayload = result.error;
          const detailedError =
            typeof errorPayload === 'object' && errorPayload !== null
              ? (errorPayload as { code?: string | number; message?: string; details?: unknown })
              : {
                  code: res.status,
                  message: typeof errorPayload === 'string' ? errorPayload : res.statusText || 'Unknown error',
                  details: errorPayload,
                };
          const rawMessage = String(detailedError?.message ?? '');
          const rawCode = detailedError?.code ?? res.status;
          const errorCode = String(rawCode || 'UNKNOWN');
          const backendMessage = result.userMessage;
          const retryAfterSeconds = result.retryAfterSeconds;
          const message = getMessageByErrorType(result.errorType, backendMessage || rawMessage, retryAfterSeconds);
          setToastMessage(`${message} [${errorCode}]`);
          showManualHelpAfterFailure();
          return;
        }
        if (result.found && result.plates && Array.isArray(result.plates) && result.plates.length > 0) {
          const platesCorners: Corners[] = result.plates
            .filter((plate: any) => plate.corners && Array.isArray(plate.corners) && plate.corners.length === 4)
            .map((plate: any) => normalizeCornersOrder(apiCornersToClient(plate)));
          if (platesCorners.length > 0) {
            setDetectedCorners(platesCorners);
            setDetectedBaseAngles(platesCorners.map((corners) => getPlateBaseAngle(corners)));
            setEditLogoOffset({ x: 0, y: 0 });
            setEditLogoScale(1);
            setEditLogoRotation(0);
            setDetectionFailed(false);
            incrementLocalDailyUsageOnSuccess();
          } else {
            setToastMessage(tx('autoDetectFailedManual'));
            showManualHelpAfterFailure();
          }
        } else if (result.found && result.corners && Array.isArray(result.corners) && result.corners.length === 4) {
          const single = normalizeCornersOrder(apiCornersToClient({ corners: result.corners }));
          setDetectedCorners([single]);
          setDetectedBaseAngles([getPlateBaseAngle(single)]);
          setEditLogoOffset({ x: 0, y: 0 });
          setEditLogoScale(1);
          setEditLogoRotation(0);
          setDetectionFailed(false);
          incrementLocalDailyUsageOnSuccess();
        } else {
          setToastMessage(tx('autoDetectFailedManual'));
          showManualHelpAfterFailure();
        }
      };

      (async () => {
        const videoTrack = streamRef.current?.getVideoTracks()[0];
        if (videoTrack && 'applyConstraints' in videoTrack) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
          } catch (_) {}
        }
        const controller = new AbortController();
        activeDetectControllerRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 48_000);
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        try {
          const deviceId = getDeviceId();
          const maxRetryCount = 2; // 初回+2回
          let lastResponse: Response | null = null;
          let lastResult: DetectApiResponse | null = null;

          for (let attempt = 0; attempt <= maxRetryCount; attempt++) {
            const useSmallImage = attempt > 0; // 再試行は軽量画像で負荷を下げる
            const res = await fetch('/api/detect', {
              method: 'POST',
              body: createFormData(useSmallImage),
              signal: controller.signal,
              headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
            });

            let result: DetectApiResponse = {};
            try {
              result = await res.json();
            } catch (_) {
              result = { error: { code: 'INVALID_JSON', message: 'Invalid JSON response' } };
            }

            lastResponse = res;
            lastResult = result;

            if (res.status !== 429 || attempt === maxRetryCount) {
              break;
            }

            const retryAfterHeader = res.headers.get('retry-after');
            const retryAfterFromHeader = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
            const retryAfterFromBody = typeof result.retryAfterSeconds === 'number' ? result.retryAfterSeconds : NaN;
            const serverSuggestedSeconds = Number.isFinite(retryAfterFromBody)
              ? retryAfterFromBody
              : Number.isFinite(retryAfterFromHeader)
                ? retryAfterFromHeader
                : 0;
            const baseBackoffMs = 1500 * Math.pow(2, attempt);
            const jitterMs = Math.floor(Math.random() * 700);
            const backoffMs = Math.max(baseBackoffMs + jitterMs, serverSuggestedSeconds * 1000);
            setRetryStatusText(
              fillI18nTemplate(tx('serverRetrying'), {
                sec: Math.ceil(backoffMs / 1000),
                cur: attempt + 1,
                max: maxRetryCount + 1,
              })
            );
            await wait(backoffMs);
          }

          if (lastResponse && lastResult && isLatestRequest()) {
            applyResult(lastResult, lastResponse);
          } else if (!lastResponse) {
            throw new Error('No response from detect-plate API');
          } else {
            return;
          }
        } catch (fetchErr: unknown) {
          if (!isLatestRequest()) return;
          if (fetchErr instanceof Error && fetchErr.name === 'AbortError') return;
          console.error('detect-plate fetch failed:', fetchErr);
          const fetchErrMessage =
            fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          setToastMessage(
            fetchErr instanceof Error && fetchErr.name === 'AbortError'
              ? `自動検出がタイムアウトしました: ${fetchErrMessage}`
              : `自動検出に失敗しました: ${fetchErrMessage}`
          );
          showManualHelpAfterFailure();
        } finally {
          clearTimeout(timeoutId);
          if (activeDetectControllerRef.current === controller) {
            activeDetectControllerRef.current = null;
          }
          if (isLatestRequest()) {
            setIsProcessing(false);
            setRetryStatusText(null);
          }
        }
      })();
    } catch (e) {
      const videoTrack = streamRef.current?.getVideoTracks()[0];
      if (videoTrack && 'applyConstraints' in videoTrack) {
        try {
          await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
        } catch (_) {}
      }
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(1);
      setEditLogoRotation(0);
      setToastMessage(tx('autoDetectFailedManual'));
      showManualHelpAfterFailure();
      setIsProcessing(false);
      setRetryStatusText(null);
    }
  }, [createTrackedObjectUrl, getMessageByErrorType, hasLocalDailyQuota, incrementLocalDailyUsageOnSuccess, showManualHelpAfterFailure, tx]);

  const retake = useCallback(() => {
    if (previewImageUrl) revokeTrackedObjectUrl(previewImageUrl);
    setPreviewImageUrl(null);
    setDetectedCorners([]);
    setDetectedBaseAngles([]);
    setEditLogoOffset({ x: 0, y: 0 });
    setEditLogoScale(1);
    setEditLogoRotation(0);
    setPreviewImageLoaded(false);
    setCameraError(null);
    setToastMessage(null);
    setRetryStatusText(null);
    setIsBlurWarning(false);
    setDetectionFailed(false);
    setShowManualGuide(false);
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
  }, [previewImageUrl, revokeTrackedObjectUrl]);

  useEffect(() => {
    if (!isProcessing) {
      setProcessingElapsedSec(0);
      return;
    }
    setProcessingElapsedSec(0);
    const id = window.setInterval(() => {
      setProcessingElapsedSec((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isProcessing]);

  useEffect(() => {
    if (!isProcessing || screenMode !== 'preview_edit') return;
    const t = setTimeout(() => {
      setIsProcessing(false);
      setToastMessage(tx('timeoutManual'));
      showManualHelpAfterFailure();
    }, 50_000);
    return () => clearTimeout(t);
  }, [isProcessing, screenMode, showManualHelpAfterFailure]);

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
    // キャンバスを画像実寸に合わせ、API の 0-1000 正規化座標を画像ピクセルに正確にマッピング
    // object-contain で表示するため、表示範囲と画像データが一致し座標ズレが発生しない
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

    if (!isProcessing && detectedCorners.length > 0) {
      const scale = editLogoScale;

      // 複数プレート対応: 各検出座標に対して fillQuad とロゴ描画を一括適用
      detectedCorners.forEach((corners, plateIndex) => {
        // 正規化座標 0-1 をそのまま画像ピクセルにマッピング（portrait/landscape 共通で w,h が画像実寸）
        const centerNx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        const centerNy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        const centerX = centerNx * w;
        const centerY = centerNy * h;

        const scaled: Corners = corners.map((c) => ({
          x: centerNx + (c.x - centerNx) * scale,
          y: centerNy + (c.y - centerNy) * scale,
        })) as Corners;

        // 各プレートの初期角度（API検出時）に対して、UI回転値をオフセットとして適用
        const baseAngle = detectedBaseAngles[plateIndex] ?? getPlateBaseAngle(corners);
        const finalRotation = baseAngle + (editLogoRotation * Math.PI) / 180;
        const cf = Math.cos(finalRotation);
        const sf = Math.sin(finalRotation);

        const plateWidthTop = Math.hypot((scaled[1].x - scaled[0].x) * w, (scaled[1].y - scaled[0].y) * h);
        const plateWidthBottom = Math.hypot((scaled[2].x - scaled[3].x) * w, (scaled[2].y - scaled[3].y) * h);
        const plateWidth = (plateWidthTop + plateWidthBottom) / 2;
        const plateHeightLeft = Math.hypot((scaled[3].x - scaled[0].x) * w, (scaled[3].y - scaled[0].y) * h);
        const plateHeightRight = Math.hypot((scaled[2].x - scaled[1].x) * w, (scaled[2].y - scaled[1].y) * h);
        const plateHeight = (plateHeightLeft + plateHeightRight) / 2;
        const logoWidth = plateWidth * 1.05;
        const logoHeight = plateHeight * 1.05;
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

        // 1段目: プレート全体を黒塗り
        fillQuad(ctx, quadPx, '#000000');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 2段目: ロゴは比率維持 + 中央配置（多形状プレート対応）
        const plateAspect = plateWidth / Math.max(1, plateHeight);
        const isLogoImageReady = Boolean(
          carkusLogoImage &&
          carkusLogoImage.naturalWidth > 0 &&
          carkusLogoImage.naturalHeight > 0
        );
        // naturalWidth が 0 のロード中はフォールバック比率を使い、ゼロ除算を防ぐ。
        const logoAspect = isLogoImageReady
          ? carkusLogoImage!.naturalWidth / carkusLogoImage!.naturalHeight
          : 3.2;
        const insetRatio = Math.min(0.1, Math.max(0.05, plateAspect > 4 ? 0.1 : 0.06));
        const availableW = Math.max(0.1, 1 - insetRatio * 2);
        const availableH = Math.max(0.1, 1 - insetRatio * 2);
        const availableAspect = availableW / availableH;

        let logoNormW = availableW;
        let logoNormH = availableH;
        if (availableAspect > logoAspect) {
          logoNormW = availableH * logoAspect;
        } else {
          logoNormH = availableW / logoAspect;
        }
        const x0 = (1 - logoNormW) / 2;
        const y0 = (1 - logoNormH) / 2;
        const x1 = x0 + logoNormW;
        const y1 = y0 + logoNormH;
        const logoQuad = buildInnerQuadFromRect(quadPx, x0, y0, x1, y1);

        const Lh = 220;
        const Lw = Math.max(120, Math.round(Lh * logoAspect));
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
          drawCarkusLogoAtOrigin(lctx, Lw * 0.92, Lh * 0.92, undefined, carkusLogoImage);
          lctx.restore();
        }
        drawImageWarpedToQuad(ctx, logoCanvas, logoQuad, Lw, Lh);
      });
    }
  }, [screenMode, previewImageLoaded, detectedCorners, detectedBaseAngles, carkusLogoImage, editLogoOffset, editLogoScale, editLogoRotation]);

  const exportPreviewBlob = useCallback(async (): Promise<Blob | null> => {
    const source = previewCanvasRef.current;
    if (!source) return null;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = source.width;
    outCanvas.height = source.height;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;
    outCtx.drawImage(source, 0, 0);

    if (isFreePlan) {
      const shortEdge = Math.min(outCanvas.width, outCanvas.height);
      const padding = Math.max(16, Math.round(shortEdge * 0.03));
      const fontSize = Math.max(12, Math.round(shortEdge * 0.036));
      const text = 'Made with Carkus';
      outCtx.save();
      outCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
      outCtx.textAlign = 'right';
      outCtx.textBaseline = 'bottom';
      outCtx.lineWidth = Math.max(2, Math.round(fontSize * 0.12));
      outCtx.strokeStyle = 'rgba(0,0,0,0.26)';
      outCtx.fillStyle = 'rgba(255,255,255,0.34)';
      outCtx.strokeText(text, outCanvas.width - padding, outCanvas.height - padding);
      outCtx.fillText(text, outCanvas.width - padding, outCanvas.height - padding);
      outCtx.restore();
    }

    return await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.99);
    });
  }, [isFreePlan]);

  const handleSaveFromPreview = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      (async () => {
        const blob = await exportPreviewBlob();
        if (!blob) {
          setIsProcessing(false);
          return;
        }
        const file = new File([blob], getNextCarkusFilename(), { type: 'image/jpeg' });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Carkus' });
          setShowSaveSuccess(true);
          setTimeout(() => setShowSaveSuccess(false), 2500);
        } else {
          const a = document.createElement('a');
          a.href = createTrackedObjectUrl(blob);
          a.download = file.name;
          a.click();
          revokeTrackedObjectUrl(a.href);
          setShowSaveSuccess(true);
          setTimeout(() => setShowSaveSuccess(false), 2500);
        }
        setIsProcessing(false);
      })();
    } catch (e) {
      setIsProcessing(false);
    }
  }, [createTrackedObjectUrl, exportPreviewBlob, revokeTrackedObjectUrl]);

  const handleShareToSNS = useCallback(async (platform: 'facebook' | 'twitter' | 'instagram') => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      (async () => {
        const blob = await exportPreviewBlob();
          if (!blob) {
            setIsProcessing(false);
            return;
          }

          const file = new File([blob], getNextCarkusFilename(), { type: 'image/jpeg' });

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
                a.href = createTrackedObjectUrl(blob);
                a.download = file.name;
                a.click();
                revokeTrackedObjectUrl(a.href);
                setShowShareMenu(false);
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 2500);
                setCameraError('共有に失敗しました。画像をダウンロードしました。');
              }
            }
          }
          setIsProcessing(false);
        })();
    } catch (e) {
      setIsProcessing(false);
      setCameraError('画像の処理に失敗しました');
    }
  }, [createTrackedObjectUrl, exportPreviewBlob, revokeTrackedObjectUrl]);

  /** 端末に保存（ダウンロード or 共有シートで「画像を保存」を選択） */
  const handleSaveToDevice = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      (async () => {
        const blob = await exportPreviewBlob();
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          const file = new File([blob], getNextCarkusFilename(), { type: 'image/jpeg' });
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
                a.href = createTrackedObjectUrl(blob);
                a.download = file.name;
                a.click();
                revokeTrackedObjectUrl(a.href);
                setShowShareMenu(false);
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 2500);
              }
            }
          } else {
            const a = document.createElement('a');
            a.href = createTrackedObjectUrl(blob);
            a.download = file.name;
            a.click();
            revokeTrackedObjectUrl(a.href);
            setShowShareMenu(false);
            setShowSaveSuccess(true);
            setTimeout(() => setShowSaveSuccess(false), 2500);
          }
          setIsProcessing(false);
        })();
    } catch (e) {
      setIsProcessing(false);
    }
  }, [createTrackedObjectUrl, exportPreviewBlob, revokeTrackedObjectUrl]);

  /** 近くのPCなどに共有（共有シートに「近くのデバイス」が出る場合あり） */
  const handleShareToNearbyDevice = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      (async () => {
        const blob = await exportPreviewBlob();
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          const file = new File([blob], getNextCarkusFilename(), { type: 'image/jpeg' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: 'Carkus',
                text: lang === 'ja' ? '近くのPCやデバイスを選択して共有できます。' : 'Choose a nearby PC or device to share.',
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
        })();
    } catch (e) {
      setIsProcessing(false);
    }
  }, [exportPreviewBlob, lang]);

  const handleCopyToClipboard = useCallback(async () => {
    if (!previewCanvasRef.current) return;
    setIsProcessing(true);
    try {
      (async () => {
        const blob = await exportPreviewBlob();
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
            setCameraError(lang === 'ja' ? 'クリップボードへのコピーに失敗しました' : 'Failed to copy image to clipboard.');
          }
          setIsProcessing(false);
        })();
    } catch (e) {
      setIsProcessing(false);
    }
  }, [exportPreviewBlob, lang]);

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
      <input ref={photoPickerRef} type="file" accept="image/*" onChange={handleImageFileSelected} className="hidden" />
      <div className="fixed top-3 right-3 z-[120] flex flex-col items-end gap-2">
        <div className="flex items-center rounded-full bg-black/60 border border-white/20 overflow-hidden">
          <button
            onClick={() => setLang('ja')}
            className={`px-3 py-1.5 text-xs ${lang === 'ja' ? 'bg-white/20 text-white' : 'text-white/70'}`}
          >
            JP
          </button>
          <button
            onClick={() => setLang('en')}
            className={`px-3 py-1.5 text-xs ${lang === 'en' ? 'bg-white/20 text-white' : 'text-white/70'}`}
          >
            EN
          </button>
        </div>
        <div className="flex items-center rounded-full bg-black/60 border border-white/20 overflow-hidden">
          <span className="px-2 text-[10px] text-white/60">{text.plan}</span>
          <button
            onClick={() => updatePlan('free')}
            className={`px-3 py-1.5 text-xs ${plan === 'free' ? 'bg-white/20 text-white' : 'text-white/70'}`}
          >
            {text.free}
          </button>
          <button
            onClick={() => updatePlan('pro')}
            className={`px-3 py-1.5 text-xs ${plan === 'pro' ? 'bg-white/20 text-white' : 'text-white/70'}`}
          >
            {text.pro}
          </button>
        </div>
      </div>
      {screenMode === 'idle' && (
        <header className="sticky top-0 z-10 bg-black/40 backdrop-blur-xl border-b border-white/20">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center gap-2 flex-wrap">
            <span className="h-6 flex items-center shrink-0 text-white">
              <CarkusLogo className="h-full w-auto text-white" />
            </span>
            <span className="px-2 py-0.5 rounded-md bg-white/10 backdrop-blur-sm border border-white/20 text-white/80 text-[10px] font-medium tracking-widest shrink-0">{text.beta}</span>
            <span className="text-white/50 text-xs font-extralight shrink-0">ver0.8</span>
          </div>
        </header>
      )}

      {showSaveSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 backdrop-blur-2xl border border-white/20 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            <CheckCircle className="text-emerald-400" size={40} strokeWidth={2} />
            <p className="text-white font-light">{text.saveSuccess}</p>
            <p className="text-white/70 text-xs font-extralight">{text.saveThanks}</p>
          </div>
        </div>
      )}

      {cameraError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-black/70 backdrop-blur-2xl rounded-2xl px-6 py-5 max-w-sm shadow-2xl flex flex-col items-center gap-4 border border-white/20">
            <p className="text-white font-light text-sm text-center leading-relaxed">{cameraError}</p>
            <button
              type="button"
              onClick={() => setCameraError(null)}
              className="px-6 py-2.5 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-light border border-white/20 hover:bg-white/20 transition-colors"
            >
              {text.close}
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
                <p className="text-white font-light text-sm mt-4">{text.processing}...</p>
                <p className="text-white/90 text-xs font-light text-center max-w-xs mt-2 tabular-nums">
                  {fillI18nTemplate(text.processingElapsed, { sec: Math.max(0, processingElapsedSec) })}
                </p>
                <p className="text-white/65 text-[11px] font-extralight text-center max-w-xs mt-1.5 leading-relaxed">
                  {text.processingDurationHint}
                </p>
                {processingElapsedSec >= 8 && (
                  <p className="text-amber-200/90 text-xs font-light text-center max-w-xs mt-2">{text.processingWaitMore}</p>
                )}
                {processingElapsedSec >= 20 && (
                  <p className="text-white/75 text-[11px] font-extralight text-center max-w-xs mt-1.5 leading-relaxed">
                    {text.processingRetakeIfSlow}
                  </p>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
                  <div className="h-full bg-white/80 processing-sweep" />
                </div>
              </div>
            )}
            <div className="absolute top-0 left-0 right-0 z-20 pt-[env(safe-area-inset-top)] pb-4 px-4 bg-black/30 backdrop-blur-xl border-b border-white/20 landscape:right-0 landscape:border-b-0 landscape:border-r landscape:border-white/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="h-5 flex items-center shrink-0 text-white drop-shadow-md">
                    <CarkusLogo className="h-full w-auto text-white" />
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-[10px] font-medium tracking-widest">{text.beta}</span>
                </div>
                <button
                  onClick={stopCamera}
                  className="py-2 px-4 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-light border border-white/20 hover:bg-white/20 transition-colors"
                >
                  {text.finish}
                </button>
              </div>
              {cameraError && <p className="mt-2 text-red-200 text-xs font-light">{cameraError}</p>}
              <p className="mt-1 text-white/70 text-xs font-light">
                {text.cameraDailyNote}
              </p>
              {isFreePlan ? (
                <>
                  {FREE_DAILY_LIMIT_DISABLED ? (
                    <p className="mt-1 text-emerald-200/80 text-[11px] font-light">
                      {text.freeQuotaUnlimitedTesting}
                    </p>
                  ) : (
                    <p className="mt-1 text-white/60 text-[11px] font-light">
                      {text.freeQuotaLabel}: {localDailySuccessCount}/{LOCAL_DAILY_FREE_LIMIT}
                    </p>
                  )}
                  <p className="mt-1 text-white/50 text-[10px] font-light">
                    {text.freeWatermarkNote}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-emerald-200/80 text-[11px] font-light">
                  {text.proUnlimitedHint}
                </p>
              )}
            </div>
          </div>
            <div className="shrink-0 flex flex-col items-center justify-center gap-2 py-6 px-4 bg-black/30 backdrop-blur-xl border-t border-white/20 landscape:border-t-0 landscape:border-l landscape:border-white/20 landscape:w-44 landscape:py-4">
            <button
              onClick={captureAndDetect}
              disabled={isProcessing}
              className="min-w-[8rem] px-6 py-3 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-light border border-white/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform hover:bg-white/20"
            >
              {isProcessing ? (
                <Loader2 className="animate-spin text-white" size={28} strokeWidth={2} />
              ) : (
                <span className="font-light text-sm tracking-wide">{text.capture}</span>
              )}
            </button>
            <button
              onClick={handlePickImageFromDevice}
              disabled={isProcessing}
              className="min-w-[8rem] px-6 py-3 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-light border border-white/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform hover:bg-white/20"
            >
              <ImagePlus size={20} strokeWidth={1.8} />
              <span className="font-light text-sm tracking-wide">{text.pickPhoto}</span>
            </button>
            <p className="text-white/70 text-xs font-light text-center">
              {text.cameraDailyNoteShort}
            </p>
          </div>
        </div>
      )}

      {screenMode === 'idle' && (
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] gap-8 px-6">
          <p className="text-white/70 text-sm font-extralight tracking-wide">{text.cameraLaunchHint}</p>
          <button
            onClick={startCamera}
            className="flex items-center gap-3 px-10 py-4 rounded-full bg-white/10 backdrop-blur-xl text-white font-light text-sm tracking-widest border border-white/20 hover:bg-white/20 transition-colors shadow-lg"
          >
            <Camera size={22} strokeWidth={1.5} />
            {text.launchCamera}
          </button>
          <button
            onClick={handlePickImageFromDevice}
            className="flex items-center gap-3 px-10 py-4 rounded-full bg-white/10 backdrop-blur-xl text-white font-light text-sm tracking-widest border border-white/20 hover:bg-white/20 transition-colors shadow-lg"
          >
            <ImagePlus size={22} strokeWidth={1.5} />
            {text.pickPhoto}
          </button>
          {cameraError && (
            <p className="text-red-300 text-xs font-light max-w-xs text-center">{cameraError}</p>
          )}
          {!isStandalone && (
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 backdrop-blur-sm text-white/90 font-light text-xs tracking-wide border border-white/20 hover:bg-white/20 transition-colors"
            >
              <DownloadIcon size={16} strokeWidth={1.5} />
              {isIOS ? text.addHomeIOS : isAndroid ? (deferredPrompt ? text.addHomeAndroid : text.addHome) : deferredPrompt ? text.addHomeChrome : text.install}
            </button>
          )}
          <p className="text-white/60 text-xs font-light mt-4 text-center max-w-xs">
            {text.dailyNote}
          </p>
          {isFreePlan ? (
            <>
              {FREE_DAILY_LIMIT_DISABLED ? (
                <p className="text-emerald-200/80 text-[11px] font-light mt-1 text-center max-w-xs">
                  {text.freeQuotaUnlimitedTesting}
                </p>
              ) : (
                <p className="text-white/60 text-xs font-light mt-1 text-center max-w-xs">
                  {text.freeQuotaLabel}: {localDailySuccessCount}/{LOCAL_DAILY_FREE_LIMIT}
                </p>
              )}
              <p className="text-white/50 text-[11px] font-light mt-1 text-center max-w-xs">
                {text.freeWatermarkNote}
              </p>
            </>
          ) : (
            <p className="text-emerald-200/80 text-[11px] font-light mt-1 text-center max-w-xs">
              {text.proUnlimitedHint}
            </p>
          )}
        </main>
      )}

      {showInstallGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-black/70 backdrop-blur-2xl rounded-2xl px-6 py-6 max-w-md w-full shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto border border-white/20">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-light text-lg">{text.addHome}</h2>
              <button onClick={() => setShowInstallGuide(false)} className="text-white/60 hover:text-white">✕</button>
            </div>
            {isIOS ? (
              <div className="text-white/80 text-sm space-y-2">
                <p className="font-medium">【iPhone / iPad】</p>
                <p>1. アドレスバー右の「共有」ボタン（□↑）をタップ</p>
                <p>2. 「ホーム画面に追加」を選択 → 「追加」をタップ</p>
              </div>
            ) : isAndroid ? (
              <div className="text-white/80 text-sm space-y-2">
                <p className="font-medium">【Android】</p>
                <p>1. ブラウザメニュー（⋮）→「ホーム画面に追加」または「アプリをインストール」</p>
                <p>2. 「追加」をタップ</p>
              </div>
            ) : (
              <p className="text-white/80 text-sm">{lang === 'ja' ? 'ブラウザのメニューから「ホーム画面に追加」を選択してください。' : 'Please choose "Add to Home Screen" from your browser menu.'}</p>
            )}
            <button onClick={() => setShowInstallGuide(false)} className="mt-2 px-6 py-3 rounded-full bg-white/10 backdrop-blur-sm text-white text-sm font-light border border-white/20 hover:bg-white/20">{text.close}</button>
          </div>
        </div>
      )}

      {screenMode === 'preview_edit' && previewImageUrl && (
        <div className="fixed inset-0 z-0 flex flex-col landscape:flex-row">
          {toastMessage && (
            <div className="fixed top-4 left-4 right-4 landscape:left-auto landscape:right-4 landscape:max-w-sm z-30 px-4 py-3 rounded-xl bg-black/60 backdrop-blur-2xl text-white text-sm font-light shadow-lg border border-white/20 animate-scale-in">
              {toastMessage}
            </div>
          )}
          {isBlurWarning && (
            <div className="shrink-0 px-4 py-3 flex flex-col gap-2 bg-amber-500/20 backdrop-blur-xl border-b border-amber-400/30 landscape:border-b-0 landscape:border-r landscape:border-amber-400/30">
              <p className="text-amber-200 text-sm font-light text-center">
                {lang === 'ja' ? '写真がぼやけている可能性があります。撮り直すことをお勧めします。' : 'Photo may be blurry. Retaking is recommended.'}
              </p>
            </div>
          )}
          <div className="flex-1 min-h-0 flex flex-col landscape:flex-row">
            <div
              className="flex-1 min-h-0 relative touch-none bg-black"
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
              {isProcessing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-black/25">
                  <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                    <div className="absolute inset-0 rounded-full border border-white/40 border-t-white animate-spin-slow" />
                    <div className="w-16 h-16 rounded-full bg-black/70 flex items-center justify-center animate-pulse-mask">
                      <span className="text-white text-xs font-light tracking-wide">{text.processing}</span>
                    </div>
                  </div>
                  <p className="text-white/90 text-xs font-light mt-4 text-center max-w-[min(100%,20rem)] px-3 tabular-nums">
                    {fillI18nTemplate(text.processingElapsed, { sec: Math.max(0, processingElapsedSec) })}
                  </p>
                  <p className="text-white/65 text-[11px] font-extralight text-center max-w-[min(100%,20rem)] px-3 mt-1.5 leading-relaxed">
                    {text.processingDurationHint}
                  </p>
                  {processingElapsedSec >= 8 && (
                    <p className="text-amber-200/90 text-xs font-light text-center max-w-[min(100%,20rem)] px-3 mt-2">
                      {text.processingWaitMore}
                    </p>
                  )}
                  {processingElapsedSec >= 20 && (
                    <p className="text-white/75 text-[11px] font-extralight text-center max-w-[min(100%,20rem)] px-3 mt-1.5 leading-relaxed">
                      {text.processingRetakeIfSlow}
                    </p>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
                    <div className="h-full bg-white/80 processing-sweep" />
                  </div>
                </div>
              )}
            </div>
            <div className="shrink-0 bg-black/40 backdrop-blur-2xl border-t border-white/20 landscape:border-t-0 landscape:border-l landscape:border-white/20 landscape:w-56 pt-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] landscape:py-4 landscape:overflow-y-auto">
            {isProcessing && (
              <div className="mb-3 space-y-1.5 py-2 px-3 rounded-lg bg-amber-500/20 border border-amber-400/30">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin text-amber-400 shrink-0" size={16} strokeWidth={2} />
                  <span className="text-amber-100 text-xs font-light leading-snug">{text.processingSidebarHint}</span>
                </div>
                <p className="text-amber-200/80 text-[11px] font-extralight text-center leading-relaxed">
                  {fillI18nTemplate(text.processingElapsed, { sec: Math.max(0, processingElapsedSec) })} · {text.processingDurationHint}
                </p>
              </div>
            )}
            {retryStatusText && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-sky-500/15 border border-sky-300/30">
                <span className="text-sky-100 text-xs font-light">{retryStatusText}</span>
              </div>
            )}
            {detectionFailed && showManualGuide && (
              <div className="mb-3 px-3 py-3 rounded-xl bg-gradient-to-b from-white/12 to-white/5 border border-white/25 space-y-2.5">
                <p className="text-white text-base font-medium tracking-wide">{text.manualGuideTitle}</p>
                <p className="text-white/85 text-sm font-light leading-relaxed">{text.manualGuideWhy}</p>
                <ol className="list-decimal pl-5 space-y-2 text-white/95 text-sm font-light leading-relaxed marker:text-amber-300/90">
                  <li>{text.manualStep1}</li>
                  <li>{text.manualStep2}</li>
                  <li>{text.manualStep3}</li>
                </ol>
                <button
                  type="button"
                  onClick={() => setShowManualGuide(false)}
                  className="w-full px-3 py-2.5 rounded-full text-sm bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 transition-colors"
                >
                  {text.guideClose}
                </button>
              </div>
            )}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-white/85 text-sm font-light w-12">{text.angle}</span>
              <input
                type="range"
                min="-30"
                max="30"
                step="1"
                value={editLogoRotation}
                onChange={(e) => setEditLogoRotation(Number(e.target.value))}
                className="slider-large flex-1 h-2 bg-white/20 rounded-full appearance-none accent-white max-w-[200px]"
              />
              <span className="text-white/85 text-sm tabular-nums w-10 text-right">{editLogoRotation}°</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-white/85 text-sm font-light w-12">{text.size}</span>
              <input
                type="range"
                min="0.3"
                max="2"
                step="0.05"
                value={editLogoScale}
                onChange={(e) => setEditLogoScale(Number(e.target.value))}
                className="slider-large flex-1 h-2 bg-white/20 rounded-full appearance-none accent-white max-w-[200px]"
              />
            </div>
            <div className="flex justify-center items-center gap-2 flex-wrap landscape:justify-start">
              <button
                onClick={retake}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-light bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 transition-colors"
              >
                <RotateCcw size={18} strokeWidth={2} />
                {text.retake}
              </button>
              <button
                onClick={handleSaveToDevice}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="端末に保存"
              >
                <Download size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('facebook')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="Facebook"
              >
                <Facebook size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('twitter')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="X"
              >
                <Twitter size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => handleShareToSNS('instagram')}
                disabled={isProcessing}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
                title="Instagram"
              >
                <Instagram size={18} strokeWidth={2} />
              </button>
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-light hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} strokeWidth={2} /> : <Share2 size={18} strokeWidth={2} />}
                {isProcessing ? text.processing : text.other}
              </button>
            </div>
            {showShareMenu && (
              <div className="flex flex-wrap justify-center gap-2 mt-3 pt-3 border-t border-white/20">
                <button onClick={handleShareToNearbyDevice} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-xs font-light hover:bg-white/20 transition-colors disabled:opacity-50"><Monitor size={14} /> {text.nearbyPc}</button>
                <button onClick={handleCopyToClipboard} disabled={isProcessing} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white/90 text-xs font-light hover:bg-white/20 transition-colors disabled:opacity-50"><Copy size={14} /> {text.copy}</button>
              </div>
            )}
            <div className="mt-3 min-h-[60px] flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20">
              <span className="text-white/50 text-xs">広告枠（ベータ）</span>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
