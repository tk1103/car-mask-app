'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { getFeedbackMailto, getShareCaption, site } from '../lib/site';
import {
  clearOperatorProPending,
  getStableDeviceId,
  hasOperatorProPending,
  PLAN_REFRESH_EVENT,
} from '../lib/device-id';
import { runPlateDetection, type DetectRunOutcome } from '../lib/detect-client';
import {
  getDefaultCenterCorners,
  getPlateBaseAngle,
} from '../lib/plate-corners';
import { Camera, Loader2, CheckCircle, RotateCcw, Share2, Facebook, Twitter, Instagram, Copy, Download, Monitor, ImagePlus, Download as DownloadIcon, Mail } from 'lucide-react';

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

const CARKUS_DOWNLOAD_COUNT_KEY = 'carkus_download_count';
const OPERATOR_UI_STORAGE_KEY = 'carkus_operator_ui_unlocked';
const OPERATOR_LOGO_TAP_UNLOCK = 5;
const OPERATOR_LOGO_TAP_WINDOW_MS = 2500;

type DetectErrorType =
  | 'rate_limited'
  | 'bad_request'
  | 'config'
  | 'quota'
  | 'upstream'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'daily_limit'
  | 'unknown';

type PlanFeatures = {
  customLogo: boolean;
  watermarkOnExport: boolean;
  dailyDetectLimit: number;
  rateLimitPerMinute: number;
};

const DEFAULT_PLAN_FEATURES: PlanFeatures = {
  customLogo: false,
  watermarkOnExport: true,
  dailyDetectLimit: 3,
  rateLimitPerMinute: 5,
};

type PlanApiSnapshot = {
  plan?: string;
  planSource?: string;
  features?: Partial<PlanFeatures> & Record<string, unknown>;
  remainingDetectionsToday?: number | null;
  remainingToday?: number | null;
  billingEnabled?: boolean;
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

function parsePlanLimit(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type QuadPx = [ { x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number } ];
const imageVisualBoundsCache = new WeakMap<HTMLImageElement, { sx: number; sy: number; sw: number; sh: number }>();

type RigidPlatePlacement = {
  cx: number;
  cy: number;
  angle: number;
  width: number;
  height: number;
};

/** 四隅から中心・回転・2:1固定サイズを算出（非一様スケールによるロゴ潰れを防ぐ） */
function quadToRigidPlacement(quad: QuadPx, aspectRatio = 2): RigidPlatePlacement {
  const [TL, TR, BR, BL] = quad;
  const cx = (TL.x + TR.x + BR.x + BL.x) / 4;
  const cy = (TL.y + TR.y + BR.y + BL.y) / 4;

  const topWidth = Math.hypot(TR.x - TL.x, TR.y - TL.y);
  const bottomWidth = Math.hypot(BR.x - BL.x, BR.y - BL.y);
  const leftHeight = Math.hypot(BL.x - TL.x, BL.y - TL.y);
  const rightHeight = Math.hypot(BR.x - TR.x, BR.y - TR.y);

  const plateWidth = (topWidth + bottomWidth) / 2;
  const plateHeight = (leftHeight + rightHeight) / 2;

  const angleTop = Math.atan2(TR.y - TL.y, TR.x - TL.x);
  const angleBottom = Math.atan2(BR.y - BL.y, BR.x - BL.x);
  let angle = (angleTop + angleBottom) / 2;
  if (Math.abs(angleTop - angleBottom) > Math.PI) {
    angle += Math.PI;
  }

  let width = Math.max(plateWidth, plateHeight * aspectRatio);
  let height = width / aspectRatio;
  if (height < plateHeight) {
    height = plateHeight;
    width = height * aspectRatio;
  }

  return { cx, cy, angle, width, height };
}

function fillRigidPlate(ctx: CanvasRenderingContext2D, quad: QuadPx, fillStyle: string) {
  const { cx, cy, angle, width, height } = quadToRigidPlacement(quad);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = fillStyle;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

/** マスク画像をアスペクト固定のまま回転・等倍スケールのみで配置（ワープなし） */
function drawImageRigidOnPlate(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  quad: QuadPx,
  srcW: number,
  srcH: number
) {
  const { cx, cy, angle, width, height } = quadToRigidPlacement(quad);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, srcW, srcH, -width / 2, -height / 2, width, height);
  ctx.restore();
}

const EXPORT_WATERMARK_TEXT = 'Made with Carkus';

function drawCarkusExportWatermark(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) {
  const shortEdge = Math.min(canvasWidth, canvasHeight);
  const padding = Math.max(12, Math.round(shortEdge * 0.024));
  const fontSize = Math.max(13, Math.round(shortEdge * 0.028));
  const text = EXPORT_WATERMARK_TEXT;

  ctx.save();
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
  const textW = ctx.measureText(text).width;
  const textH = fontSize * 1.2;
  const x = canvasWidth - padding;
  const y = canvasHeight - padding;
  const pillPadX = Math.round(fontSize * 0.45);
  const pillPadY = Math.round(fontSize * 0.28);
  const pillW = textW + pillPadX * 2;
  const pillH = textH + pillPadY * 2;
  const pillX = x - pillW;
  const pillY = y - pillH;
  const radius = Math.min(pillH / 2, 8);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, pillH, radius);
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillText(text, x - pillPadX, y - pillPadY);
  ctx.restore();
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
    let visual = imageVisualBoundsCache.get(logoImage);
    if (!visual) {
      const probeW = Math.min(1024, logoImage.naturalWidth);
      const probeH = Math.max(1, Math.round(probeW * (logoImage.naturalHeight / logoImage.naturalWidth)));
      const probe = document.createElement('canvas');
      probe.width = probeW;
      probe.height = probeH;
      const pctx = probe.getContext('2d', { willReadFrequently: true });
      if (pctx) {
        pctx.clearRect(0, 0, probeW, probeH);
        pctx.drawImage(logoImage, 0, 0, probeW, probeH);
        const data = pctx.getImageData(0, 0, probeW, probeH).data;
        let minX = probeW;
        let minY = probeH;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < probeH; y++) {
          for (let x = 0; x < probeW; x++) {
            const a = data[(y * probeW + x) * 4 + 3];
            if (a < 10) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX >= minX && maxY >= minY) {
          const scaleX = logoImage.naturalWidth / probeW;
          const scaleY = logoImage.naturalHeight / probeH;
          visual = {
            sx: minX * scaleX,
            sy: minY * scaleY,
            sw: Math.max(1, (maxX - minX + 1) * scaleX),
            sh: Math.max(1, (maxY - minY + 1) * scaleY),
          };
        } else {
          visual = { sx: 0, sy: 0, sw: logoImage.naturalWidth, sh: logoImage.naturalHeight };
        }
      } else {
        visual = { sx: 0, sy: 0, sw: logoImage.naturalWidth, sh: logoImage.naturalHeight };
      }
      imageVisualBoundsCache.set(logoImage, visual);
    }

    const visualAspect = visual.sw / Math.max(1, visual.sh);
    // マスクに対して約80%を基準にしつつ、SVG余白を見越して見た目を補正する
    const targetW = Math.max(1, logoWidth * 0.8);
    const targetH = Math.max(1, logoHeight * 0.8);
    let drawW = targetW;
    let drawH = drawW / Math.max(0.01, visualAspect);
    if (drawH > targetH) {
      drawH = targetH;
      drawW = drawH * visualAspect;
    }
    // Carkus.svg は余白が広めなので、見た目サイズを補正
    const opticalCompensation = 1.38;
    drawW *= opticalCompensation;
    drawH *= opticalCompensation;
    const maxW = logoWidth * 0.98;
    const maxH = logoHeight * 0.98;
    if (drawW > maxW || drawH > maxH) {
      const ratio = Math.min(maxW / Math.max(1, drawW), maxH / Math.max(1, drawH));
      drawW *= ratio;
      drawH *= ratio;
    }
    ctx.save();
    ctx.filter = 'brightness(0) invert(1)';
    ctx.drawImage(
      logoImage,
      visual.sx,
      visual.sy,
      visual.sw,
      visual.sh,
      -drawW / 2,
      -drawH / 2,
      drawW,
      drawH
    );
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
const CUSTOM_LOGO_STORAGE_KEY = 'carkus_custom_logo_data_url';
const CUSTOM_MASK_PREPARED_KEY = 'carkus_custom_mask_prepared';
const CUSTOM_MASK_SETUP_KEY = 'carkus_custom_mask_setup';
const MASK_STYLE_STORAGE_KEY = 'carkus_mask_style';
/** 日本のナンバープレート近似アスペクト（幅:高さ = 2:1） */
const PLATE_MASK_WIDTH = 520;
const PLATE_MASK_HEIGHT = 260;
const LOGO_INSET_RATIO_BY_PLATE_HEIGHT = 0.08; // 高さ基準の固定Inset
const LOGO_VISUAL_CENTER_OFFSET = { x: 0, y: 0 }; // ロゴ実体の視覚中心補正（-0.5〜0.5想定）
const LOGO_SCALE_MIN = 0.12;
const LOGO_SCALE_MAX = 2;
/** 手動編集・解析失敗時のマスク初期スケール（検出成功時は 1） */
const DEFAULT_MANUAL_MASK_SCALE = 1;
/** Free プラン書き出し時の最大高さ（px） */
const FREE_EXPORT_MAX_HEIGHT = 1280;
const FREE_EXPORT_JPEG_QUALITY = 0.92;
const PRO_EXPORT_JPEG_QUALITY = 0.99;

type Lang = 'ja' | 'en';
type Plan = 'free' | 'pro';
type MaskTemplate = 'fit' | 'centered' | 'badge';
type MaskStyle = 'carkus' | 'black' | 'white' | 'custom';

/** Carkus マスク（黒地+ロゴ）を 2:1 UV 空間に描画し、剛体配置で貼り付け */
function renderCarkusMaskCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  maskTemplate: MaskTemplate,
  logoImage: HTMLImageElement | null
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  if (!logoImage?.complete || !logoImage.naturalWidth || !logoImage.naturalHeight) return;

  const logoAspect = logoImage.naturalWidth / logoImage.naturalHeight;
  const inset = Math.max(1, height * LOGO_INSET_RATIO_BY_PLATE_HEIGHT);
  const availableW = Math.max(1, width - inset * 2);
  const availableH = Math.max(1, height - inset * 2);

  let logoDrawW = availableW;
  let logoDrawH = logoDrawW / Math.max(0.01, logoAspect);
  if (logoDrawH > availableH) {
    logoDrawH = availableH;
    logoDrawW = logoDrawH * logoAspect;
  }
  const templateScale = maskTemplate === 'fit' ? 1 : maskTemplate === 'centered' ? 0.78 : 0.52;
  logoDrawW *= templateScale;
  logoDrawH *= templateScale;
  const templateShiftU = maskTemplate === 'badge' ? availableW * 0.22 : 0;

  const centerX = width / 2 + templateShiftU + LOGO_VISUAL_CENTER_OFFSET.x * logoDrawW;
  const centerY = height / 2 + LOGO_VISUAL_CENTER_OFFSET.y * logoDrawH;

  ctx.save();
  ctx.translate(centerX, centerY);
  drawCarkusLogoAtOrigin(ctx, logoDrawW, logoDrawH, undefined, logoImage);
  ctx.restore();
}

type RetakeSnapshot = {
  previewImageUrl: string;
  detectedCorners: Corners[];
  detectedBaseAngles: number[];
  editLogoOffset: { x: number; y: number };
  editLogoScale: number;
  editLogoRotation: number;
  detectionFailed: boolean;
  manualEditActive: boolean;
  maskTemplate: MaskTemplate;
};

type CustomMaskSetup = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

function isMaskStyle(value: string | null | undefined): value is MaskStyle {
  return value === 'carkus' || value === 'black' || value === 'white' || value === 'custom';
}

/** 画像共有用 Web Share ペイロード（text / url はアプリによって無視される場合あり） */
function buildImageShareData(file: File, lang: Lang): ShareData {
  const text = getShareCaption(lang);
  const withText: ShareData = { files: [file], title: site.name, text };
  if (typeof navigator === 'undefined' || !navigator.canShare) return withText;
  const withUrl: ShareData = { ...withText, url: site.url };
  if (navigator.canShare(withUrl)) return withUrl;
  if (navigator.canShare(withText)) return withText;
  return { files: [file], title: site.name };
}

function parseCustomMaskSetup(raw: string | null): CustomMaskSetup {
  if (!raw) return { scale: 1, offsetX: 0, offsetY: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<CustomMaskSetup>;
    return {
      scale: typeof parsed.scale === 'number' && Number.isFinite(parsed.scale) ? parsed.scale : 1,
      offsetX: typeof parsed.offsetX === 'number' && Number.isFinite(parsed.offsetX) ? parsed.offsetX : 0,
      offsetY: typeof parsed.offsetY === 'number' && Number.isFinite(parsed.offsetY) ? parsed.offsetY : 0,
    };
  } catch {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
}

/** ユーザー画像をナンバー形状（2:1）にトリミング・配置したマスク bitmap を生成 */
function renderPreparedCustomMask(
  source: HTMLImageElement,
  setup: CustomMaskSetup
): HTMLCanvasElement {
  const W = PLATE_MASK_WIDTH;
  const H = PLATE_MASK_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const iw = source.naturalWidth || source.width;
  const ih = source.naturalHeight || source.height;
  if (!iw || !ih) return canvas;
  const baseScale = Math.max(W / iw, H / ih);
  const s = baseScale * Math.max(0.2, setup.scale);
  const drawW = iw * s;
  const drawH = ih * s;
  const x = (W - drawW) / 2 + setup.offsetX;
  const y = (H - drawH) / 2 + setup.offsetY;
  ctx.drawImage(source, x, y, drawW, drawH);
  return canvas;
}
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
    processingManualHint:
      "It's taking a while. You can also place the logo manually!（解析に時間がかかっています。手動でロゴを配置することも可能です）",
    processingSidebarHint: '枠の調整は解析の完了後に行えます。今は解析の終了をお待ちください。',
    manualGuideTitle: '枠をドラッグして合わせてください',
    serverRetrying: 'サーバー混雑のため {sec} 秒後に再試行します（{cur}/{max}）',
    saveSuccess: '保存しました',
    saveThanks: 'ご利用ありがとうございます',
    retake: '撮り直す',
    backToEdit: '編集に戻る',
    angle: '角度',
    size: 'サイズ',
    template: 'テンプレ',
    templateFit: 'Fit',
    templateCentered: 'Centered',
    templateBadge: 'Badge',
    other: 'その他',
    copy: 'コピー',
    nearbyPc: '近くのPC',
    install: 'アプリをインストール',
    addHomeIOS: 'ホーム画面に追加（iOS）',
    addHomeAndroid: 'ホーム画面に追加（Android）',
    addHome: 'ホーム画面に追加',
    addHomeChrome: 'ホーム画面に追加（Chrome）',
    cameraLaunchHint: 'カメラを起動して撮影してください',
    dailyNote: 'β版: AI 自動検出は 1日3回までです。枠を使い切っても手動編集・保存はできます。',
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
    serverBusyRetry: 'サーバーが混み合っています。手動で位置を合わせてください。',
    quotaManualHint: 'サーバーが混雑しています。再試行せず手動でロゴ位置を合わせてください。',
    dailyFreeLimitManualOnly: '本日の自動検出枠を使い切りました。手動で枠を合わせるか、下のボタンから無制限化してください。',
    dailyFreeLimitProHint: '右上が「Pro」でない場合、この端末は無料枠のままです。ロゴを5回タップして運営者設定から登録してください。',
    operatorSetupLink: '運営者: 無制限にする',
    operatorSetupShort: '無制限にする',
    freeQuotaLabel: '本日の無料自動検出',
    freeWatermarkNote: '無料版の保存画像には Carkus 透かしが入ります。',
    plan: 'プラン',
    free: '無料版',
    pro: '課金版',
    operatorBadge: 'Pro',
    proUnlimitedHint: 'AI 自動検出は無制限枠です（運営者モード）。',
    planLoading: '判定中',
    customLogo: '独自ロゴ',
    resetLogo: '標準ロゴに戻す',
    maskStyleLabel: 'マスク',
    maskStyleCarkus: 'Carkus',
    maskStyleBlack: '黒',
    maskStyleWhite: '白',
    maskStyleCustom: '独自',
    maskStyleCustomChange: '画像を変更',
    maskStyleCustomAdjust: 'マスクを調整',
    maskStyleCustomMissing: '独自マスク用の画像を選択してください',
    customMaskSetupTitle: 'マスク画像をナンバー枠に合わせる',
    customMaskSetupHint: 'ドラッグで位置、スライダーで拡大。枠いっぱいに覆うように調整してください。',
    customMaskSetupSave: 'この設定を保存',
    customMaskSetupScale: '拡大',
    manualEditFrameHint: '手動編集モードの枠線（黄色）',
    resetLogoSuccess: '標準ロゴに戻しました。',
    proOnlyLogo: '独自ロゴは課金版で利用できます。',
    betaCustomLogoUnavailable: 'β版では独自ロゴは利用できません。',
    logoUploadSuccess: '独自マスク画像を保存しました。',
    logoUploadFailed: '独自ロゴの読み込みに失敗しました。',
    logoTypeError: 'PNG / JPEG / WebP / SVG を選択してください。',
    logoTooLarge: 'ロゴ画像は 5MB 以下にしてください。',
    logoCopyrightConfirm:
      '著作権・商標権・肖像権など第三者の権利を侵害しない画像のみアップロードしてください。SNS等への掲載・共有内容に関する責任は利用者にあり、当社は一切負いません。続行しますか？',
    editManually: '手動で編集',
    aiInferenceDetected: 'AI推論で角を補完した可能性があります。必要に応じて手動で微調整してください。',
    upsellTitle: '課金版で使える機能です',
    upsellBody: '無料版ではこの機能は利用できません。課金版で以下が解放されます。',
    upsellLocked1: '独自ロゴのアップロード（PNG / SVG）',
    upsellLocked2: '保存画像から透かしを削除',
    upsellLocked3: 'AI 自動検出の 1日制限なし',
    upgradeNow: 'アップグレード',
    maybeLater: 'あとで',
    upgradeLinkMissing: 'アップグレード導線は準備中です。',
    termsOfService: '利用規約',
    privacyPolicy: 'プライバシーポリシー',
    pressKit: 'プレスキット',
    tagline: '車の写真のナンバーを、ロゴでマスク',
    heroDescription: 'スマホのブラウザだけで、撮影→AI検出→手動調整→保存まで。SNS用の愛車写真に。',
    contactFeedback: '要望・バグ報告',
    contactFeedbackHint: 'β版のご意見・不具合はメールでお知らせください。',
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
    processingManualHint:
      "It's taking a while. You can also place the logo manually!（解析に時間がかかっています。手動でロゴを配置することも可能です）",
    processingSidebarHint: 'You can move the frame after analysis finishes. Please wait.',
    manualGuideTitle: 'Drag the frame to align',
    serverRetrying: 'Server busy. Retrying in {sec}s ({cur}/{max})',
    saveSuccess: 'Saved',
    saveThanks: 'Thank you for using Carkus',
    retake: 'Retake',
    backToEdit: 'Back to edit',
    angle: 'Angle',
    size: 'Size',
    template: 'Template',
    templateFit: 'Fit',
    templateCentered: 'Centered',
    templateBadge: 'Badge',
    other: 'More',
    copy: 'Copy',
    nearbyPc: 'Nearby PC',
    install: 'Install App',
    addHomeIOS: 'Add to Home Screen (iOS)',
    addHomeAndroid: 'Add to Home Screen (Android)',
    addHome: 'Add to Home Screen',
    addHomeChrome: 'Add to Home Screen (Chrome)',
    cameraLaunchHint: 'Open camera and take a photo',
    dailyNote: 'Beta: 3 AI auto-detections per day. Manual edit and save still work after the limit.',
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
    serverBusyRetry: 'Server is busy. Please adjust the logo position manually.',
    quotaManualHint: 'The server is busy. Skip retry and place the logo manually.',
    dailyFreeLimitManualOnly: 'Daily auto-detect limit reached. Adjust manually or use the button below.',
    dailyFreeLimitProHint: 'If the top-right badge is not Pro, this device is still on the free quota. Tap the logo 5 times for operator setup.',
    operatorSetupLink: 'Operator: unlimited',
    operatorSetupShort: 'Go unlimited',
    freeQuotaLabel: 'Daily free auto-detections',
    freeWatermarkNote: 'Saved images on Free plan include a Carkus watermark.',
    plan: 'Plan',
    free: 'Free',
    pro: 'Pro',
    operatorBadge: 'Pro',
    proUnlimitedHint: 'Unlimited AI auto-detections (operator mode).',
    planLoading: 'Loading',
    customLogo: 'Custom logo',
    resetLogo: 'Reset to default',
    maskStyleLabel: 'Mask',
    maskStyleCarkus: 'Carkus',
    maskStyleBlack: 'Black',
    maskStyleWhite: 'White',
    maskStyleCustom: 'Custom',
    maskStyleCustomChange: 'Change image',
    maskStyleCustomAdjust: 'Adjust mask',
    maskStyleCustomMissing: 'Please choose a custom mask image.',
    customMaskSetupTitle: 'Fit mask to license plate frame',
    customMaskSetupHint: 'Drag to move, slider to zoom. Cover the entire plate frame.',
    customMaskSetupSave: 'Save this mask',
    customMaskSetupScale: 'Zoom',
    manualEditFrameHint: 'Manual edit frame (amber)',
    resetLogoSuccess: 'Reset to default logo.',
    proOnlyLogo: 'Custom logo is available on Pro plan.',
    betaCustomLogoUnavailable: 'Custom logo is not available in the beta.',
    logoUploadSuccess: 'Custom mask image saved.',
    logoUploadFailed: 'Failed to load custom logo.',
    logoTypeError: 'Please select PNG, JPEG, WebP, or SVG.',
    logoTooLarge: 'Logo image must be 5MB or smaller.',
    logoCopyrightConfirm:
      'Upload only images that do not infringe copyrights, trademarks, portrait rights, or other third-party rights. You are solely responsible for anything you post or share (including on SNS); we accept no liability. Continue?',
    editManually: 'Edit Manually',
    aiInferenceDetected: 'AI likely inferred hidden/out-of-frame corners. Fine-tune manually if needed.',
    upsellTitle: 'Available on Pro plan',
    upsellBody: 'This feature is not available on Free. Pro unlocks:',
    upsellLocked1: 'Custom logo upload (PNG / SVG)',
    upsellLocked2: 'No watermark on saved images',
    upsellLocked3: 'Unlimited AI auto-detections',
    upgradeNow: 'Upgrade',
    maybeLater: 'Maybe later',
    upgradeLinkMissing: 'Upgrade link is not configured yet.',
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    pressKit: 'Press Kit',
    tagline: 'Mask license plates on car photos with a logo',
    heroDescription: 'Shoot, auto-detect, adjust manually, and save—all in your mobile browser.',
    contactFeedback: 'Feedback & bug reports',
    contactFeedbackHint: 'Send beta feedback or bug reports by email.',
  },
} as const;

function fillI18nTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}

export default function Home() {
  const [lang, setLang] = useState<Lang>('ja');
  const [screenMode, setScreenMode] = useState<'idle' | 'camera' | 'preview_edit'>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<HTMLImageElement | null>(null);

  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<Corners[]>([]); // 複数プレート対応
  const [detectedBaseAngles, setDetectedBaseAngles] = useState<number[]>([]); // 各プレートの初期角度（API検出時）
  const [editLogoOffset, setEditLogoOffset] = useState({ x: 0, y: 0 });
  const [editLogoScale, setEditLogoScale] = useState(1);
  const [editLogoRotation, setEditLogoRotation] = useState(0); // 度（-30〜30）
  const [maskTemplate, setMaskTemplate] = useState<MaskTemplate>('fit');
  const [maskStyle, setMaskStyle] = useState<MaskStyle>('carkus');
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false); // SNS共有メニュー表示用
  const [isBlurWarning, setIsBlurWarning] = useState(false);
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [manualEditActive, setManualEditActive] = useState(false);
  const [retryStatusText, setRetryStatusText] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showDailyLimitOverlay, setShowDailyLimitOverlay] = useState(false);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null);
  const [planFeatures, setPlanFeatures] = useState<PlanFeatures>(DEFAULT_PLAN_FEATURES);
  const [carkusBrandImage, setCarkusBrandImage] = useState<HTMLImageElement | null>(null);
  const [customLogoImage, setCustomLogoImage] = useState<HTMLImageElement | null>(null);
  const [customLogoSrc, setCustomLogoSrc] = useState<string | null>(null);
  const [customMaskPreparedSrc, setCustomMaskPreparedSrc] = useState<string | null>(null);
  const [customMaskPreparedImage, setCustomMaskPreparedImage] = useState<HTMLImageElement | null>(null);
  const [showCustomMaskSetup, setShowCustomMaskSetup] = useState(false);
  const [setupSourceSrc, setSetupSourceSrc] = useState<string | null>(null);
  const [setupSourceImage, setSetupSourceImage] = useState<HTMLImageElement | null>(null);
  const [setupScale, setSetupScale] = useState(1);
  const [setupOffsetX, setSetupOffsetX] = useState(0);
  const [setupOffsetY, setSetupOffsetY] = useState(0);
  const setupCanvasRef = useRef<HTMLCanvasElement>(null);
  const setupDragRef = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [retakeSnapshot, setRetakeSnapshot] = useState<RetakeSnapshot | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  const [plan, setPlan] = useState<Plan>('free');
  const [planResolved, setPlanResolved] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [operatorUiUnlocked, setOperatorUiUnlocked] = useState(false);
  const operatorLogoTapRef = useRef<{ count: number; resetAt: number }>({ count: 0, resetAt: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoPickerRef = useRef<HTMLInputElement>(null);
  const customLogoPickerRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeDetectControllerRef = useRef<AbortController | null>(null);
  const activeDetectRequestIdRef = useRef(0);
  const objectUrlRegistryRef = useRef<Set<string>>(new Set());
  const dragStartRef = useRef<{ x: number; y: number; startOffset: { x: number; y: number } } | null>(null);
  const scaleStartRef = useRef<{ y: number; startScale: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const carkusMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const langRef = useRef<Lang>('ja');

  const text = t[lang];
  const isFreePlan = plan === 'free';
  const showOperatorSetup =
    isFreePlan &&
    (operatorUiUnlocked || process.env.NEXT_PUBLIC_OPERATOR_UI === 'true');

  const tx = useCallback((key: keyof typeof t.ja): string => t[langRef.current][key], []);
  const upgradeUrl = process.env.NEXT_PUBLIC_UPGRADE_URL || '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setOperatorUiUnlocked(window.sessionStorage.getItem(OPERATOR_UI_STORAGE_KEY) === '1');
    } catch (_) {}
  }, []);

  const unlockOperatorUi = useCallback(() => {
    setOperatorUiUnlocked(true);
    try {
      window.sessionStorage.setItem(OPERATOR_UI_STORAGE_KEY, '1');
    } catch (_) {}
  }, []);

  const handleOperatorLogoTap = useCallback(() => {
    const now = Date.now();
    const slot = operatorLogoTapRef.current;
    if (now > slot.resetAt) {
      slot.count = 0;
    }
    slot.count += 1;
    slot.resetAt = now + OPERATOR_LOGO_TAP_WINDOW_MS;
    if (slot.count >= OPERATOR_LOGO_TAP_UNLOCK) {
      slot.count = 0;
      slot.resetAt = 0;
      unlockOperatorUi();
    }
  }, [unlockOperatorUi]);

  const trackPlanEvent = useCallback((event: 'upgrade_click' | 'feature_blocked_by_plan') => {
    const deviceId = getStableDeviceId();
    fetch('/api/metrics-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
      },
      body: JSON.stringify({ event }),
    }).catch(() => {});
  }, []);

  const hasAutoDetectQuota = useCallback(() => {
    if (!isFreePlan) return true;
    if (planFeatures.dailyDetectLimit <= 0) return true;
    if (dailyRemaining === null) return true;
    return dailyRemaining > 0;
  }, [isFreePlan, dailyRemaining, planFeatures.dailyDetectLimit]);

  const applyPlanFromApi = useCallback((data: PlanApiSnapshot) => {
    if (typeof data.billingEnabled === 'boolean') setBillingEnabled(data.billingEnabled);
    if (data.plan === 'pro' || data.plan === 'free') setPlan(data.plan);
    if (data.features && typeof data.features === 'object') {
      setPlanFeatures({
        customLogo: Boolean(data.features.customLogo),
        watermarkOnExport: Boolean(data.features.watermarkOnExport),
        dailyDetectLimit: parsePlanLimit(data.features.dailyDetectLimit, DEFAULT_PLAN_FEATURES.dailyDetectLimit),
        rateLimitPerMinute: parsePlanLimit(data.features.rateLimitPerMinute, DEFAULT_PLAN_FEATURES.rateLimitPerMinute),
      });
    }
    if (data.plan === 'pro') {
      setDailyRemaining(null);
      clearOperatorProPending();
    } else {
      const remaining =
        data.remainingDetectionsToday !== undefined ? data.remainingDetectionsToday : data.remainingToday;
      if (remaining === null || typeof remaining === 'number') {
        setDailyRemaining(remaining);
      }
    }
    setPlanResolved(true);
  }, []);

  const refreshPlanFromServer = useCallback(async (): Promise<PlanApiSnapshot | null> => {
    try {
      const deviceId = getStableDeviceId();
      const res = await fetch('/api/plan', {
        cache: 'no-store',
        headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as PlanApiSnapshot;
      applyPlanFromApi(data);
      return data;
    } catch {
      return null;
    }
  }, [applyPlanFromApi]);

  /** 撮影直前にサーバーでプラン・残枠を再取得（Pro 登録直後の古い「0枚」表示を防ぐ） */
  const canAutoDetectNow = useCallback(async (): Promise<boolean> => {
    const data = await refreshPlanFromServer();
    if (data?.plan === 'pro') return true;
    if (!data && planResolved && plan === 'pro') return true;
    if (!data) return hasAutoDetectQuota();
    const limit = parsePlanLimit(data.features?.dailyDetectLimit, DEFAULT_PLAN_FEATURES.dailyDetectLimit);
    if (limit <= 0) return true;
    const remaining = data.remainingDetectionsToday ?? data.remainingToday;
    if (remaining === null) return true;
    if (typeof remaining === 'number') return remaining > 0;
    return true;
  }, [hasAutoDetectQuota, plan, planResolved, refreshPlanFromServer]);

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
    img.onload = () => setCarkusBrandImage(img);
    img.onerror = () => setCarkusBrandImage(null);
    img.src = '/Carkus.svg';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const savedLogo = window.localStorage.getItem(CUSTOM_LOGO_STORAGE_KEY);
      if (savedLogo) setCustomLogoSrc(savedLogo);
      const savedPrepared = window.localStorage.getItem(CUSTOM_MASK_PREPARED_KEY);
      if (savedPrepared) setCustomMaskPreparedSrc(savedPrepared);
      const savedStyle = window.localStorage.getItem(MASK_STYLE_STORAGE_KEY);
      if (isMaskStyle(savedStyle)) {
        if (savedStyle === 'custom' && !savedPrepared) {
          setMaskStyle('carkus');
        } else {
          setMaskStyle(savedStyle);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!customLogoSrc) {
      setCustomLogoImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setCustomLogoImage(img);
    img.onerror = () => setCustomLogoImage(null);
    img.src = customLogoSrc;
  }, [customLogoSrc]);

  useEffect(() => {
    if (!customMaskPreparedSrc) {
      setCustomMaskPreparedImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => setCustomMaskPreparedImage(img);
    img.onerror = () => setCustomMaskPreparedImage(null);
    img.src = customMaskPreparedSrc;
  }, [customMaskPreparedSrc]);

  useEffect(() => {
    if (!showCustomMaskSetup || !setupSourceImage || !setupCanvasRef.current) return;
    const canvas = setupCanvasRef.current;
    canvas.width = PLATE_MASK_WIDTH;
    canvas.height = PLATE_MASK_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, W, H);
    const prepared = renderPreparedCustomMask(setupSourceImage, {
      scale: setupScale,
      offsetX: setupOffsetX,
      offsetY: setupOffsetY,
    });
    ctx.drawImage(prepared, 0, 0, W, H);
    ctx.strokeStyle = 'rgba(255, 196, 64, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
  }, [showCustomMaskSetup, setupSourceImage, setupScale, setupOffsetX, setupOffsetY]);

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

  const fetchPlan = useCallback(async () => {
    try {
      await refreshPlanFromServer();
    } catch (_) {
      // フェイルセーフ: free のまま継続
    } finally {
      setPlanResolved(true);
    }
  }, [refreshPlanFromServer]);

  useEffect(() => {
    if (hasOperatorProPending()) {
      setPlan('pro');
      setDailyRemaining(null);
      setPlanResolved(true);
    }
    fetchPlan();
  }, [fetchPlan]);

  useEffect(() => {
    const refreshPlan = () => {
      if (document.visibilityState === 'visible') fetchPlan();
    };
    const onPlanRefresh = () => {
      void fetchPlan();
    };
    document.addEventListener('visibilitychange', refreshPlan);
    window.addEventListener('focus', refreshPlan);
    window.addEventListener(PLAN_REFRESH_EVENT, onPlanRefresh);
    return () => {
      document.removeEventListener('visibilitychange', refreshPlan);
      window.removeEventListener('focus', refreshPlan);
      window.removeEventListener(PLAN_REFRESH_EVENT, onPlanRefresh);
    };
  }, [fetchPlan]);

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

  /** 画面表示用に残り回数を取得（APIは消費しない） */
  const fetchRemainingQuota = useCallback(async () => {
    try {
      const deviceId = getStableDeviceId();
      const res = await fetch('/api/detect', {
        cache: 'no-store',
        headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
      });
      if (res.ok) {
        const data = (await res.json()) as PlanApiSnapshot;
        applyPlanFromApi(data);
      }
    } catch (_) {}
  }, [applyPlanFromApi]);

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

  const ensureDefaultCorners = useCallback(() => {
    const defaults = getDefaultCenterCorners();
    setDetectedCorners((prev) => (prev.length > 0 ? prev : [defaults]));
    setDetectedBaseAngles((prev) => (prev.length > 0 ? prev : [getPlateBaseAngle(defaults)]));
  }, []);

  const activateManualEdit = useCallback(() => {
    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    setIsProcessing(false);
    setRetryStatusText(null);
    setDetectionFailed(true);
    setManualEditActive(true);
    setToastMessage(null);
    ensureDefaultCorners();
    setEditLogoOffset({ x: 0, y: 0 });
    setEditLogoScale(DEFAULT_MANUAL_MASK_SCALE);
    setEditLogoRotation(0);
  }, [ensureDefaultCorners]);

  const showManualHelpAfterFailure = useCallback(() => {
    setDetectionFailed(true);
    ensureDefaultCorners();
    setEditLogoScale(1);
    setEditLogoOffset({ x: 0, y: 0 });
    setEditLogoRotation(0);
  }, [ensureDefaultCorners]);

  const showDailyLimitBlocked = useCallback(() => {
    setShowDailyLimitOverlay(true);
    setToastMessage(null);
    showManualHelpAfterFailure();
  }, [showManualHelpAfterFailure]);

  const handleEditManually = useCallback(() => {
    activateManualEdit();
  }, [activateManualEdit]);

  const getMessageByErrorType = useCallback((errorType?: DetectErrorType, fallbackMessage?: string, _retryAfterSeconds?: number) => {
    switch (errorType) {
      case 'daily_limit':
        return tx('dailyFreeLimitManualOnly');
      case 'quota':
      case 'rate_limited':
        return tx('quotaManualHint');
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

  const applyDetectOutcome = useCallback(
    (outcome: DetectRunOutcome) => {
      const { result, corners, status } = outcome;
      const resOk = status >= 200 && status < 300;
      if (typeof result.reasoning === 'string' && result.reasoning.trim()) {
        console.info('Plate detection reasoning:', result.reasoning);
      }
      const remaining = result.remainingToday;
      if (remaining === null || typeof remaining === 'number') setDailyRemaining(remaining);
      if (result.plan === 'pro' || result.plan === 'free') setPlan(result.plan);

      if (!resOk) {
        const errPayload = result.error;
        const msg = typeof errPayload === 'string' ? errPayload : result.userMessage || tx('autoDetectFailedManual');
        if (result.errorType === 'daily_limit') {
          showDailyLimitBlocked();
        } else {
          setToastMessage(
            getMessageByErrorType(result.errorType as DetectErrorType | undefined, msg, result.retryAfterSeconds)
          );
          showManualHelpAfterFailure();
        }
        return;
      }

      if (corners && corners.length > 0) {
        setDetectedCorners(corners);
        setDetectedBaseAngles(corners.map((c) => getPlateBaseAngle(c)));
        setEditLogoOffset({ x: 0, y: 0 });
        setEditLogoScale(1);
        setEditLogoRotation(0);
        setDetectionFailed(false);
        setManualEditActive(false);
        return;
      }

      setToastMessage(
        getMessageByErrorType(
          result.errorType as DetectErrorType | undefined,
          result.userMessage || tx('autoDetectFailedManual'),
          result.retryAfterSeconds
        )
      );
      showManualHelpAfterFailure();
    },
    [getMessageByErrorType, showDailyLimitBlocked, showManualHelpAfterFailure, tx]
  );

  const discardRetakeSnapshot = useCallback(() => {
    setRetakeSnapshot((prev) => {
      if (prev?.previewImageUrl) revokeTrackedObjectUrl(prev.previewImageUrl);
      return null;
    });
  }, [revokeTrackedObjectUrl]);

  const beginDetectFromCanvas = useCallback(
    async (fullResCanvas: HTMLCanvasElement, originalW: number, originalH: number, isLatestRequest: () => boolean) => {
      const fullResBlob = await new Promise<Blob>((resolve, reject) => {
        fullResCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob error'))), 'image/jpeg', 0.98);
      });

      discardRetakeSnapshot();
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
        const blurCanvas = document.createElement('canvas');
        blurCanvas.width = Math.min(480, originalW);
        blurCanvas.height = Math.max(1, Math.round(blurCanvas.width * (originalH / originalW)));
        const blurCtx = blurCanvas.getContext('2d');
        if (blurCtx) {
          blurCtx.drawImage(fullResCanvas, 0, 0, blurCanvas.width, blurCanvas.height);
          setIsBlurWarning(getBlurScore(blurCanvas) < BLUR_SCORE_THRESHOLD);
        }
      }, 0);

      if (!(await canAutoDetectNow())) {
        setIsProcessing(false);
        showDailyLimitBlocked();
        return;
      }

      const controller = new AbortController();
      activeDetectControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 25_000);
      try {
        const deviceId = getStableDeviceId();
        const outcome = await runPlateDetection(fullResCanvas, originalW, originalH, deviceId, controller.signal);
        if (isLatestRequest()) {
          applyDetectOutcome(outcome);
        }
      } catch (fetchErr: unknown) {
        if (!isLatestRequest()) return;
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          setToastMessage(tx('processingSlow'));
        } else {
          setToastMessage(tx('autoDetectFailedManual'));
        }
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
    },
    [
      applyDetectOutcome,
      canAutoDetectNow,
      createTrackedObjectUrl,
      discardRetakeSnapshot,
      showDailyLimitBlocked,
      showManualHelpAfterFailure,
      tx,
    ]
  );

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
    discardRetakeSnapshot();
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
    setManualEditActive(false);
    setDetectionFailed(false);
  }, [discardRetakeSnapshot]);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    const video = videoRef.current;
    const t = setTimeout(() => {
      video.srcObject = stream;
      video.play().catch(() => {});
    }, 100);
    return () => clearTimeout(t);
  }, [stream]);

  useEffect(() => {
    if (screenMode !== 'camera' || !videoRef.current) return;
    const v = videoRef.current;
    const streamToUse = streamRef.current;
    if (streamToUse) v.srcObject = streamToUse;
    const t = setTimeout(() => {
      v.play().catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [screenMode]);

  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) return;
    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    const requestId = activeDetectRequestIdRef.current + 1;
    activeDetectRequestIdRef.current = requestId;
    const isLatestRequest = () => activeDetectRequestIdRef.current === requestId;

    setShowDailyLimitOverlay(false);
    setToastMessage(null);
    setCameraError(null);
    setDetectionFailed(false);
    setManualEditActive(false);
    setRetryStatusText(null);
    setIsProcessing(true);

    try {
      await refreshPlanFromServer();
    } catch (_) {}

    try {
      const originalW = video.videoWidth;
      const originalH = video.videoHeight;
      const fullResCanvas = document.createElement('canvas');
      fullResCanvas.width = originalW;
      fullResCanvas.height = originalH;
      const fullResCtx = fullResCanvas.getContext('2d');
      if (!fullResCtx) throw new Error('Canvas error');
      fullResCtx.drawImage(video, 0, 0, originalW, originalH);
      await beginDetectFromCanvas(fullResCanvas, originalW, originalH, isLatestRequest);
    } catch (err) {
      if (!isLatestRequest()) return;
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(1);
      setEditLogoRotation(0);
      setScreenMode('preview_edit');
      setToastMessage(tx('autoDetectFailedManual'));
      showManualHelpAfterFailure();
      setIsProcessing(false);
    }
  }, [beginDetectFromCanvas, refreshPlanFromServer, showManualHelpAfterFailure, tx]);

  const handlePickImageFromDevice = useCallback(() => {
    photoPickerRef.current?.click();
  }, []);

  const persistMaskStyle = useCallback((style: MaskStyle) => {
    setMaskStyle(style);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(MASK_STYLE_STORAGE_KEY, style);
      } catch (_) {}
    }
  }, []);

  const openCustomLogoPicker = useCallback(() => {
    const accepted = typeof window !== 'undefined' ? window.confirm(tx('logoCopyrightConfirm')) : true;
    if (!accepted) return;
    customLogoPickerRef.current?.click();
  }, [tx]);

  const openCustomMaskSetupModal = useCallback(
    (sourceSrc: string, setup?: CustomMaskSetup) => {
      const img = new Image();
      img.onload = () => {
        setSetupSourceSrc(sourceSrc);
        setSetupSourceImage(img);
        const parsed = setup ?? parseCustomMaskSetup(
          typeof window !== 'undefined' ? window.localStorage.getItem(CUSTOM_MASK_SETUP_KEY) : null
        );
        setSetupScale(parsed.scale);
        setSetupOffsetX(parsed.offsetX);
        setSetupOffsetY(parsed.offsetY);
        setShowCustomMaskSetup(true);
      };
      img.onerror = () => setToastMessage(tx('logoUploadFailed'));
      img.src = sourceSrc;
    },
    [tx]
  );

  const saveCustomMaskSetup = useCallback(() => {
    if (!setupSourceImage) return;
    const setup: CustomMaskSetup = { scale: setupScale, offsetX: setupOffsetX, offsetY: setupOffsetY };
    const prepared = renderPreparedCustomMask(setupSourceImage, setup);
    const dataUrl = prepared.toDataURL('image/jpeg', 0.92);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(CUSTOM_MASK_PREPARED_KEY, dataUrl);
        window.localStorage.setItem(CUSTOM_MASK_SETUP_KEY, JSON.stringify(setup));
        if (setupSourceSrc) window.localStorage.setItem(CUSTOM_LOGO_STORAGE_KEY, setupSourceSrc);
      }
    } catch (_) {
      setToastMessage(tx('logoUploadFailed'));
      return;
    }
    setCustomMaskPreparedSrc(dataUrl);
    if (setupSourceSrc) setCustomLogoSrc(setupSourceSrc);
    persistMaskStyle('custom');
    setShowCustomMaskSetup(false);
    setToastMessage(tx('logoUploadSuccess'));
  }, [persistMaskStyle, setupOffsetX, setupOffsetY, setupScale, setupSourceImage, setupSourceSrc, tx]);

  const handleMaskStyleChange = useCallback(
    (style: MaskStyle) => {
      if (style === 'custom') {
        if (customMaskPreparedSrc) {
          persistMaskStyle('custom');
          return;
        }
        if (customLogoSrc) {
          openCustomMaskSetupModal(customLogoSrc);
          return;
        }
        openCustomLogoPicker();
        return;
      }
      persistMaskStyle(style);
    },
    [customLogoSrc, customMaskPreparedSrc, openCustomLogoPicker, openCustomMaskSetupModal, persistMaskStyle]
  );

  const handlePickCustomLogo = useCallback(() => {
    openCustomLogoPicker();
  }, [openCustomLogoPicker]);

  const handleAdjustCustomMask = useCallback(() => {
    const src = customLogoSrc || setupSourceSrc;
    if (!src) {
      openCustomLogoPicker();
      return;
    }
    openCustomMaskSetupModal(src);
  }, [customLogoSrc, openCustomLogoPicker, openCustomMaskSetupModal, setupSourceSrc]);

  const onSetupPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!setupCanvasRef.current) return;
    setupDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: setupOffsetX,
      offsetY: setupOffsetY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [setupOffsetX, setupOffsetY]);

  const onSetupPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = setupDragRef.current;
    const canvas = setupCanvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = PLATE_MASK_WIDTH / Math.max(1, rect.width);
    const scaleY = PLATE_MASK_HEIGHT / Math.max(1, rect.height);
    setSetupOffsetX(drag.offsetX + (e.clientX - drag.startX) * scaleX);
    setSetupOffsetY(drag.offsetY + (e.clientY - drag.startY) * scaleY);
  }, []);

  const onSetupPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    setupDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleUpgradeClick = useCallback(() => {
    trackPlanEvent('upgrade_click');
    setShowUpsell(false);
    if (!upgradeUrl) {
      setToastMessage(tx('upgradeLinkMissing'));
      return;
    }
    window.open(upgradeUrl, '_blank', 'noopener,noreferrer');
  }, [trackPlanEvent, upgradeUrl, tx]);

  const handleCustomLogoSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    const isJpeg =
      file.type === 'image/jpeg' ||
      file.type === 'image/jpg' ||
      /\.jpe?g$/i.test(file.name);
    const isWebp = file.type === 'image/webp' || file.name.toLowerCase().endsWith('.webp');
    if (!isSvg && !isPng && !isJpeg && !isWebp) {
      setToastMessage(tx('logoTypeError'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToastMessage(tx('logoTooLarge'));
      return;
    }
    try {
      const toDataUrl = () =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('reader_failed'));
          reader.readAsDataURL(file);
        });
      const dataUrl = await toDataUrl();
      const test = new Image();
      await new Promise<void>((resolve, reject) => {
        test.onload = () => resolve();
        test.onerror = () => reject(new Error('image_invalid'));
        test.src = dataUrl;
      });
      if (!test.naturalWidth || !test.naturalHeight) throw new Error('image_invalid');
      openCustomMaskSetupModal(dataUrl, { scale: 1, offsetX: 0, offsetY: 0 });
    } catch (_) {
      setToastMessage(tx('logoUploadFailed'));
    }
  }, [openCustomMaskSetupModal, tx]);

  const handleImageFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setCameraError(tx('imageFileOnly'));
      return;
    }
    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    const requestId = activeDetectRequestIdRef.current + 1;
    activeDetectRequestIdRef.current = requestId;
    const isLatestRequest = () => activeDetectRequestIdRef.current === requestId;

    setShowDailyLimitOverlay(false);
    setCameraError(null);
    setDetectionFailed(false);
    setManualEditActive(false);
    setRetryStatusText(null);
    setToastMessage(null);

    try {
      await refreshPlanFromServer();
    } catch (_) {}

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

      await beginDetectFromCanvas(fullResCanvas, originalW, originalH, isLatestRequest);
    } catch (err) {
      if (!isLatestRequest()) return;
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
  }, [beginDetectFromCanvas, createTrackedObjectUrl, refreshPlanFromServer, revokeTrackedObjectUrl, showManualHelpAfterFailure, tx]);


  const retake = useCallback(async () => {
    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    if (previewImageUrl) {
      setRetakeSnapshot({
        previewImageUrl,
        detectedCorners: detectedCorners.map((corners) => corners.map((p) => ({ ...p })) as Corners),
        detectedBaseAngles: [...detectedBaseAngles],
        editLogoOffset: { ...editLogoOffset },
        editLogoScale: editLogoScale,
        editLogoRotation: editLogoRotation,
        detectionFailed,
        manualEditActive,
        maskTemplate,
      });
    }
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
    setManualEditActive(false);
    setIsProcessing(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    await startCamera();
  }, [
    detectionFailed,
    detectedBaseAngles,
    detectedCorners,
    editLogoOffset,
    editLogoRotation,
    editLogoScale,
    manualEditActive,
    maskTemplate,
    previewImageUrl,
    startCamera,
  ]);

  const cancelRetakeBackToPreview = useCallback(() => {
    if (!retakeSnapshot) return;
    activeDetectControllerRef.current?.abort();
    activeDetectControllerRef.current = null;
    setPreviewImageUrl(retakeSnapshot.previewImageUrl);
    setDetectedCorners(retakeSnapshot.detectedCorners);
    setDetectedBaseAngles(retakeSnapshot.detectedBaseAngles);
    setEditLogoOffset(retakeSnapshot.editLogoOffset);
    setEditLogoScale(retakeSnapshot.editLogoScale);
    setEditLogoRotation(retakeSnapshot.editLogoRotation);
    setDetectionFailed(retakeSnapshot.detectionFailed);
    setManualEditActive(retakeSnapshot.manualEditActive);
    setMaskTemplate(retakeSnapshot.maskTemplate);
    setPreviewImageLoaded(false);
    setCameraError(null);
    setToastMessage(null);
    setRetryStatusText(null);
    setIsProcessing(false);
    setRetakeSnapshot(null);
    setScreenMode('preview_edit');
  }, [retakeSnapshot]);

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
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
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

    if ((manualEditActive || !isProcessing) && detectedCorners.length > 0) {
      const scale = editLogoScale;

      // 複数プレート対応: 各検出座標に対して fillQuad とロゴ描画を一括適用
      detectedCorners.forEach((corners, plateIndex) => {
        const plateCorners = corners;
        // 正規化座標 0-1 をそのまま画像ピクセルにマッピング（portrait/landscape 共通で w,h が画像実寸）
        const centerNx = (plateCorners[0].x + plateCorners[1].x + plateCorners[2].x + plateCorners[3].x) / 4;
        const centerNy = (plateCorners[0].y + plateCorners[1].y + plateCorners[2].y + plateCorners[3].y) / 4;
        const centerX = centerNx * w;
        const centerY = centerNy * h;

        const scaled: Corners = plateCorners.map((c) => ({
          x: centerNx + (c.x - centerNx) * scale,
          y: centerNy + (c.y - centerNy) * scale,
        })) as Corners;

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

        // 各プレートの検出四隅をピクセル座標へ（ユーザー調整のスケール・回転・オフセットのみ適用）
        const userRotRad = (editLogoRotation * Math.PI) / 180;
        const cf = Math.cos(userRotRad);
        const sf = Math.sin(userRotRad);
        const offsetPxX = offsetX * cf - offsetY * sf;
        const offsetPxY = offsetX * sf + offsetY * cf;

        const quadPx: QuadPx = scaled.map((c) => {
          const px = c.x * w - centerX;
          const py = c.y * h - centerY;
          return {
            x: centerX + px * cf - py * sf + offsetPxX,
            y: centerY + px * sf + py * cf + offsetPxY,
          };
        }) as QuadPx;

        // マスク種別ごとの描画（四隅 quadPx に射影ワープ）
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (maskStyle === 'custom') {
          if (
            customMaskPreparedImage &&
            customMaskPreparedImage.naturalWidth > 0 &&
            customMaskPreparedImage.naturalHeight > 0
          ) {
            drawImageRigidOnPlate(
              ctx,
              customMaskPreparedImage,
              quadPx,
              PLATE_MASK_WIDTH,
              PLATE_MASK_HEIGHT
            );
          } else {
            fillRigidPlate(ctx, quadPx, '#000000');
          }
        } else if (maskStyle === 'carkus') {
          let carkusMaskCanvas = carkusMaskCanvasRef.current;
          if (!carkusMaskCanvas) {
            carkusMaskCanvas = document.createElement('canvas');
            carkusMaskCanvasRef.current = carkusMaskCanvas;
          }
          carkusMaskCanvas.width = PLATE_MASK_WIDTH;
          carkusMaskCanvas.height = PLATE_MASK_HEIGHT;
          const mctx = carkusMaskCanvas.getContext('2d');
          if (mctx) {
            renderCarkusMaskCanvas(
              mctx,
              PLATE_MASK_WIDTH,
              PLATE_MASK_HEIGHT,
              maskTemplate,
              carkusBrandImage
            );
            drawImageRigidOnPlate(
              ctx,
              carkusMaskCanvas,
              quadPx,
              PLATE_MASK_WIDTH,
              PLATE_MASK_HEIGHT
            );
          }
        } else {
          const plateFillColor = maskStyle === 'white' ? '#ffffff' : '#000000';
          fillRigidPlate(ctx, quadPx, plateFillColor);
        }
      });
    }

    if (planFeatures.watermarkOnExport) {
      drawCarkusExportWatermark(ctx, w, h);
    }
  }, [screenMode, previewImageLoaded, detectedCorners, carkusBrandImage, customMaskPreparedImage, maskStyle, editLogoOffset, editLogoScale, editLogoRotation, maskTemplate, isProcessing, manualEditActive, planFeatures.watermarkOnExport]);

  const exportPreviewBlob = useCallback(async (): Promise<Blob | null> => {
    const source = previewCanvasRef.current;
    if (!source) return null;
    let exportWidth = source.width;
    let exportHeight = source.height;
    if (isFreePlan && exportHeight > FREE_EXPORT_MAX_HEIGHT) {
      const scale = FREE_EXPORT_MAX_HEIGHT / exportHeight;
      exportWidth = Math.max(1, Math.round(exportWidth * scale));
      exportHeight = FREE_EXPORT_MAX_HEIGHT;
    }
    const outCanvas = document.createElement('canvas');
    outCanvas.width = exportWidth;
    outCanvas.height = exportHeight;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(source, 0, 0, source.width, source.height, 0, 0, exportWidth, exportHeight);

    const jpegQuality = isFreePlan ? FREE_EXPORT_JPEG_QUALITY : PRO_EXPORT_JPEG_QUALITY;
    return await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob((b) => resolve(b), 'image/jpeg', jpegQuality);
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
          await navigator.share(buildImageShareData(file, langRef.current));
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
              await navigator.share(buildImageShareData(file, lang));
              
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
              const shareCaption = getShareCaption(lang);
              const shareUrls: Record<string, string> = {
                facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(site.url)}&quote=${encodeURIComponent(shareCaption)}`,
                twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareCaption)}`,
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
  }, [createTrackedObjectUrl, exportPreviewBlob, lang, revokeTrackedObjectUrl]);

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
      if (isProcessing && !manualEditActive) return;
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
    [editLogoOffset, editLogoScale, isProcessing, manualEditActive]
  );

  const onPreviewTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isProcessing && !manualEditActive) return;
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
        setEditLogoScale(Math.max(LOGO_SCALE_MIN, Math.min(LOGO_SCALE_MAX, scaleStartRef.current.startScale + delta)));
      }
    },
    [isProcessing, manualEditActive]
  );

  const onPreviewTouchEnd = useCallback(() => {
    dragStartRef.current = null;
    scaleStartRef.current = null;
  }, []);

  const fontFamily = '"Helvetica Neue", Helvetica, "Hiragino Sans", "Yu Gothic", sans-serif';

  return (
    <div className="min-h-screen bg-black" style={{ fontFamily }}>
      <input ref={photoPickerRef} type="file" accept="image/*" onChange={handleImageFileSelected} className="hidden" />
      <input ref={customLogoPickerRef} type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleCustomLogoSelected} className="hidden" />
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
          {!billingEnabled ? (
            planResolved && plan === 'pro' ? (
              <span className="px-3 py-1.5 text-xs bg-emerald-500/30 text-emerald-100 tracking-wide">
                {text.operatorBadge}
              </span>
            ) : (
              <span className="px-3 py-1.5 text-xs bg-white/20 text-white tracking-wide">{text.beta}</span>
            )
          ) : !planResolved ? (
            <span className="px-3 py-1.5 text-xs text-white/80">{text.planLoading}</span>
          ) : (
            <>
              <span className={`px-3 py-1.5 text-xs ${plan === 'free' ? 'bg-white/20 text-white' : 'text-white/70'}`}>
                {text.free}
              </span>
              <span className={`px-3 py-1.5 text-xs ${plan === 'pro' ? 'bg-white/20 text-white' : 'text-white/70'}`}>
                {text.pro}
              </span>
            </>
          )}
        </div>
      </div>
      {screenMode === 'idle' && (
        <header className="sticky top-0 z-10 bg-black/40 backdrop-blur-xl border-b border-white/20">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-center">
            <button
              type="button"
              onClick={handleOperatorLogoTap}
              className="h-6 flex items-center shrink-0 text-white bg-transparent border-0 p-0 cursor-default"
              aria-label="Carkus"
            >
              <CarkusLogo className="h-full w-auto text-white" />
            </button>
          </div>
        </header>
      )}

      {showSaveSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 backdrop-blur-2xl border border-white/20 rounded-2xl px-6 py-5 flex items-center justify-center shadow-2xl">
            <CheckCircle className="text-emerald-400" size={40} strokeWidth={2} />
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

      {billingEnabled && showUpsell && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/65 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-black/80 px-5 py-5 shadow-2xl">
            <h3 className="text-white text-base font-medium">{text.upsellTitle}</h3>
            <p className="mt-2 text-white/80 text-sm font-light leading-relaxed">{text.upsellBody}</p>
            <ul className="mt-3 space-y-1.5 text-white/90 text-sm font-light">
              <li>• {text.upsellLocked1}</li>
              <li>• {text.upsellLocked2}</li>
              <li>• {text.upsellLocked3}</li>
            </ul>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleUpgradeClick}
                className="flex-1 px-4 py-2.5 rounded-full bg-amber-300 text-black text-sm font-medium hover:bg-amber-200 transition-colors"
              >
                {text.upgradeNow}
              </button>
              <button
                type="button"
                onClick={() => setShowUpsell(false)}
                className="px-4 py-2.5 rounded-full bg-white/10 border border-white/20 text-white/85 text-sm font-light hover:bg-white/20 transition-colors"
              >
                {text.maybeLater}
              </button>
            </div>
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
          {isProcessing && (
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex flex-col items-center justify-center z-10">
              <Loader2 className="animate-spin text-white" size={44} strokeWidth={2.5} />
              <p className="text-white/90 font-light text-sm mt-3">{text.processing}</p>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
                <div className="h-full bg-white/80 processing-sweep" />
              </div>
            </div>
          )}
          <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <span className="h-5 flex items-center shrink-0 text-white drop-shadow-md">
              <CarkusLogo className="h-full w-auto text-white" />
            </span>
            <div className="flex items-center gap-2">
              {retakeSnapshot && (
                <button
                  type="button"
                  onClick={cancelRetakeBackToPreview}
                  className="py-1.5 px-3 rounded-full bg-black/40 backdrop-blur-sm text-white text-xs font-light border border-white/20 hover:bg-white/20 transition-colors"
                >
                  {text.backToEdit}
                </button>
              )}
              <button
                onClick={stopCamera}
                className="py-1.5 px-3 rounded-full bg-black/40 backdrop-blur-sm text-white text-xs font-light border border-white/20 hover:bg-white/20 transition-colors"
              >
                {text.finish}
              </button>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 px-4 bg-gradient-to-t from-black/50 to-transparent">
            <button
              onClick={handlePickImageFromDevice}
              disabled={isProcessing}
              className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/25 text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
              aria-label={text.pickPhoto}
            >
              <ImagePlus size={20} strokeWidth={1.8} />
            </button>
            <button
              onClick={captureAndDetect}
              disabled={isProcessing}
              className="w-[4.5rem] h-[4.5rem] rounded-full bg-white/15 backdrop-blur-sm border-2 border-white/40 flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
              aria-label={text.capture}
            >
              {isProcessing ? (
                <Loader2 className="animate-spin text-white" size={28} strokeWidth={2} />
              ) : (
                <span className="w-12 h-12 rounded-full bg-white/90" />
              )}
            </button>
            <div className="w-11" aria-hidden />
          </div>
        </div>
      )}

      {screenMode === 'idle' && (
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] gap-6 px-6">
          <div className="text-center max-w-md space-y-3">
            <h1 className="text-white text-lg font-light tracking-wide leading-snug">{text.tagline}</h1>
            <p className="text-white/55 text-sm font-light leading-relaxed">{text.heroDescription}</p>
          </div>
          <div className="w-full max-w-md flex flex-col items-center gap-1.5">
            <span className="text-white/55 text-[11px] font-light">{text.maskStyleLabel}</span>
            <div className="flex w-full items-center rounded-full border border-white/20 bg-white/5 overflow-hidden">
              {(
                [
                  ['carkus', text.maskStyleCarkus],
                  ['black', text.maskStyleBlack],
                  ['white', text.maskStyleWhite],
                  ['custom', text.maskStyleCustom],
                ] as const
              ).map(([style, label]) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => handleMaskStyleChange(style)}
                  className={`flex-1 px-2 py-2 text-xs font-light transition-colors ${
                    maskStyle === style ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {maskStyle === 'custom' && (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handlePickCustomLogo}
                  className="text-white/60 text-[11px] font-light underline underline-offset-2 hover:text-white/85"
                >
                  {text.maskStyleCustomChange}
                </button>
                {customMaskPreparedSrc && (
                  <button
                    type="button"
                    onClick={handleAdjustCustomMask}
                    className="text-white/60 text-[11px] font-light underline underline-offset-2 hover:text-white/85"
                  >
                    {text.maskStyleCustomAdjust}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={startCamera}
              className="flex items-center justify-center gap-2 px-4 py-4 rounded-full bg-white/10 backdrop-blur-xl text-white font-light text-sm tracking-wide border border-white/20 hover:bg-white/20 transition-colors shadow-lg"
            >
              <Camera size={20} strokeWidth={1.5} />
              {text.launchCamera}
            </button>
            <button
              onClick={handlePickImageFromDevice}
              className="flex items-center justify-center gap-2 px-4 py-4 rounded-full bg-white/10 backdrop-blur-xl text-white font-light text-sm tracking-wide border border-white/20 hover:bg-white/20 transition-colors shadow-lg"
            >
              <ImagePlus size={20} strokeWidth={1.5} />
              {text.pickPhoto}
            </button>
          </div>
          {planResolved && showOperatorSetup && (
            <Link
              href="/operator"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-emerald-500/15 border border-emerald-400/35 text-emerald-100/90 text-xs font-light hover:bg-emerald-500/25 transition-colors"
            >
              {text.operatorSetupLink}
            </Link>
          )}
          <p className="text-white/55 text-xs font-light text-center max-w-sm leading-relaxed px-2">
            {plan === 'pro' && !billingEnabled ? text.proUnlimitedHint : text.dailyNote}
          </p>
          <div className="flex flex-col items-center gap-2 max-w-sm text-center">
            <p className="text-white/45 text-[11px] font-light leading-relaxed px-2">{text.contactFeedbackHint}</p>
            <a
              href={getFeedbackMailto(lang)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-sm text-white/85 font-light text-xs tracking-wide border border-white/20 hover:bg-white/20 transition-colors"
            >
              <Mail size={16} strokeWidth={1.5} />
              {text.contactFeedback}
            </a>
          </div>
          {!isStandalone && (
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-sm text-white/80 font-light text-xs tracking-wide border border-white/20 hover:bg-white/20 transition-colors"
              aria-label={text.install}
            >
              <DownloadIcon size={16} strokeWidth={1.5} />
            </button>
          )}
          <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-light">
            <Link href="/terms" className="text-white/40 hover:text-white/60 underline-offset-2 hover:underline">
              {text.termsOfService}
            </Link>
            <span className="text-white/20" aria-hidden>
              ·
            </span>
            <Link href="/privacy" className="text-white/40 hover:text-white/60 underline-offset-2 hover:underline">
              {text.privacyPolicy}
            </Link>
            <span className="text-white/20" aria-hidden>
              ·
            </span>
            <Link href="/press" className="text-white/40 hover:text-white/60 underline-offset-2 hover:underline">
              {text.pressKit}
            </Link>
          </nav>
        </main>
      )}

      {showCustomMaskSetup && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="bg-black/80 backdrop-blur-2xl rounded-2xl px-5 py-5 max-w-lg w-full shadow-2xl flex flex-col gap-4 border border-white/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-white font-light text-base">{text.customMaskSetupTitle}</h2>
                <p className="text-white/60 text-xs font-light mt-1 leading-relaxed">{text.customMaskSetupHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCustomMaskSetup(false)}
                className="text-white/60 hover:text-white shrink-0"
                aria-label={text.close}
              >
                ✕
              </button>
            </div>
            <div className="w-full rounded-lg overflow-hidden border-2 border-amber-400/80 bg-black">
              <canvas
                ref={setupCanvasRef}
                className="w-full aspect-[2/1] touch-none cursor-grab active:cursor-grabbing"
                onPointerDown={onSetupPointerDown}
                onPointerMove={onSetupPointerMove}
                onPointerUp={onSetupPointerUp}
                onPointerCancel={onSetupPointerUp}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/70 text-xs font-light w-12 shrink-0">{text.customMaskSetupScale}</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.05"
                value={setupScale}
                onChange={(e) => setSetupScale(Number(e.target.value))}
                className="slider-large flex-1 h-1.5 bg-white/20 rounded-full appearance-none accent-white"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowCustomMaskSetup(false)}
                className="px-4 py-2 rounded-full text-sm font-light bg-white/10 border border-white/20 text-white/80 hover:bg-white/20"
              >
                {text.close}
              </button>
              <button
                type="button"
                onClick={saveCustomMaskSetup}
                className="px-4 py-2 rounded-full text-sm font-light bg-white text-black hover:bg-white/90"
              >
                {text.customMaskSetupSave}
              </button>
            </div>
          </div>
        </div>
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
        <div className="fixed inset-0 z-0 bg-black flex flex-col landscape:flex-row">
          {showDailyLimitOverlay && (
            <div className="absolute inset-0 z-30 flex items-center justify-center px-6 bg-black/40">
              <div className="max-w-sm w-full px-5 py-5 rounded-2xl bg-black/85 backdrop-blur-xl text-white text-sm font-light text-center leading-relaxed border border-white/20 shadow-2xl space-y-4">
                <p>{tx('dailyFreeLimitManualOnly')}</p>
                {!showOperatorSetup && (
                  <p className="text-xs text-white/55 leading-relaxed">{tx('dailyFreeLimitProHint')}</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowDailyLimitOverlay(false);
                    handleEditManually();
                  }}
                  className="inline-flex w-full items-center justify-center rounded-full bg-amber-400/90 px-4 py-3 text-sm text-black hover:bg-amber-300"
                >
                  {text.editManually}
                </button>
              </div>
            </div>
          )}
          {toastMessage && !showDailyLimitOverlay && (
            <div className="absolute inset-0 z-30 flex items-center justify-center px-6 pointer-events-none">
              <div className="max-w-sm px-5 py-4 rounded-2xl bg-black/75 backdrop-blur-xl text-white text-sm font-light text-center leading-relaxed border border-white/20 shadow-2xl">
                {toastMessage}
              </div>
            </div>
          )}
          <div
            className="relative flex-1 min-h-0 min-w-0"
            onTouchStart={onPreviewTouchStart}
            onTouchMove={onPreviewTouchMove}
            onTouchEnd={onPreviewTouchEnd}
            onTouchCancel={onPreviewTouchEnd}
          >
            <canvas
              ref={previewCanvasRef}
              className="absolute inset-0 w-full h-full object-contain object-top"
              style={{ touchAction: 'none' }}
            />
            {isProcessing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-black/25">
                <Loader2 className="animate-spin text-white" size={40} strokeWidth={2.5} />
                <p className="text-white/90 text-sm font-light mt-3">{text.processing}</p>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
                  <div className="h-full bg-white/80 processing-sweep" />
                </div>
              </div>
            )}
          </div>
          <div className="relative z-10 flex-shrink-0 w-full landscape:w-44 landscape:h-full landscape:overflow-y-auto px-3 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] landscape:pt-3 landscape:pb-3 bg-black/90 backdrop-blur-xl border-t border-white/15 landscape:border-t-0 landscape:border-l landscape:border-white/15">
            <div>
            {detectionFailed && !isProcessing && !manualEditActive && (
              <div className="flex justify-center mb-3">
                <button
                  type="button"
                  onClick={handleEditManually}
                  className="px-4 py-1.5 rounded-full text-xs font-medium bg-amber-400/90 text-black hover:bg-amber-300 transition-colors"
                >
                  {text.editManually}
                </button>
              </div>
            )}
            {!isProcessing && (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-white/70 text-xs font-light w-10">{text.maskStyleLabel}</span>
                  <div className="flex flex-1 items-center rounded-full border border-white/20 bg-white/5 overflow-hidden">
                    {(
                      [
                        ['carkus', text.maskStyleCarkus],
                        ['black', text.maskStyleBlack],
                        ['white', text.maskStyleWhite],
                        ['custom', text.maskStyleCustom],
                      ] as const
                    ).map(([style, label]) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => handleMaskStyleChange(style)}
                        className={`flex-1 px-1.5 py-1.5 text-[10px] font-light ${
                          maskStyle === style ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {maskStyle === 'custom' && (
                  <div className="flex justify-end gap-2 mb-1.5">
                    <button
                      type="button"
                      onClick={handlePickCustomLogo}
                      className="px-2.5 py-1 rounded-full text-[10px] bg-white/10 border border-white/20 text-white/80 hover:bg-white/20"
                    >
                      {text.maskStyleCustomChange}
                    </button>
                    {customMaskPreparedSrc && (
                      <button
                        type="button"
                        onClick={handleAdjustCustomMask}
                        className="px-2.5 py-1 rounded-full text-[10px] bg-white/10 border border-white/20 text-white/80 hover:bg-white/20"
                      >
                        {text.maskStyleCustomAdjust}
                      </button>
                    )}
                  </div>
                )}
                {maskStyle === 'carkus' && (
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-white/70 text-xs font-light w-10">{text.template}</span>
                  <div className="flex items-center rounded-full border border-white/20 bg-white/5 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setMaskTemplate('fit')}
                      className={`px-2.5 py-1.5 text-[11px] ${maskTemplate === 'fit' ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'}`}
                    >
                      {text.templateFit}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskTemplate('centered')}
                      className={`px-2.5 py-1.5 text-[11px] ${maskTemplate === 'centered' ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'}`}
                    >
                      {text.templateCentered}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMaskTemplate('badge')}
                      className={`px-2.5 py-1.5 text-[11px] ${maskTemplate === 'badge' ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'}`}
                    >
                      {text.templateBadge}
                    </button>
                  </div>
                </div>
                )}
                <div className="space-y-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-xs font-light w-10 shrink-0">{text.angle}</span>
                    <input
                      type="range"
                      min="-30"
                      max="30"
                      step="1"
                      value={editLogoRotation}
                      onChange={(e) => setEditLogoRotation(Number(e.target.value))}
                      className="slider-large flex-1 h-2 bg-white/20 rounded-full appearance-none accent-white"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-xs font-light w-10 shrink-0">{text.size}</span>
                    <input
                      type="range"
                      min={LOGO_SCALE_MIN}
                      max={LOGO_SCALE_MAX}
                      step="0.05"
                      value={editLogoScale}
                      onChange={(e) => setEditLogoScale(Number(e.target.value))}
                      className="slider-large flex-1 h-2 bg-white/20 rounded-full appearance-none accent-white"
                    />
                  </div>
                </div>
              </>
            )}
            {planFeatures.watermarkOnExport && !isProcessing && (
              <p className="text-white/45 text-[10px] font-light text-center mb-2 leading-relaxed">
                {text.freeWatermarkNote}
              </p>
            )}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
