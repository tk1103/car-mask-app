'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { getFeedbackMailto, getShareCaption, site } from '../lib/site';
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

type DetectApiResponse = {
  found?: boolean;
  plates?: Array<{ corners?: Array<{ x: number; y: number }> }>;
  corners?: Array<{ x: number; y: number }>;
  reasoning?: string;
  inferred?: boolean;
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
  const normalize = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value / 1000));
  };
  return plate.corners.map((c) => ({
    x: normalize(c.x),
    y: normalize(c.y),
  })) as Corners;
}

/** 編集用デフォルト四角（正規化座標 0-1）。解析失敗時やAPIエラー時に使用。一般的なナンバープレート位置（画像下部中央） */
function getDefaultCenterCorners(): Corners {
  const cx = 0.5;
  const cy = 0.8;
  const halfW = 0.11;
  const halfH = 0.05;
  return [
    { x: cx - halfW, y: cy - halfH },
    { x: cx + halfW, y: cy - halfH },
    { x: cx + halfW, y: cy + halfH },
    { x: cx - halfW, y: cy + halfH },
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
const imageVisualBoundsCache = new WeakMap<HTMLImageElement, { sx: number; sy: number; sw: number; sh: number }>();

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
const DEFAULT_MANUAL_MASK_SCALE = 0.5;
/** Free プラン書き出し時の最大高さ（px） */
const FREE_EXPORT_MAX_HEIGHT = 1280;
const FREE_EXPORT_JPEG_QUALITY = 0.92;
const PRO_EXPORT_JPEG_QUALITY = 0.99;

// 編集画面のロゴ描画用（quad のアスペクトに合わせて横縮みしない）
const LOGO_CANVAS_WIDTH = 400;

type Lang = 'ja' | 'en';
type Plan = 'free' | 'pro';
type MaskTemplate = 'fit' | 'centered' | 'badge';
type MaskStyle = 'carkus' | 'black' | 'white' | 'custom';

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
    dailyFreeLimitManualOnly: '本日の自動検出枠を使い切りました。手動で枠を調整してください。',
    freeQuotaLabel: '本日の無料自動検出',
    freeWatermarkNote: '無料版の保存画像には Carkus 透かしが入ります。',
    plan: 'プラン',
    free: '無料版',
    pro: '課金版',
    proUnlimitedHint: '課金版は日次無料枠の制限対象外です。',
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
      '著作権・商標権など第三者の権利を侵害しない画像のみアップロードしてください。権利侵害に関する責任は利用者が負います。続行しますか？',
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
    dailyFreeLimitManualOnly: 'Daily auto-detect limit reached. Adjust the frame manually.',
    freeQuotaLabel: 'Daily free auto-detections',
    freeWatermarkNote: 'Saved images on Free plan include a Carkus watermark.',
    plan: 'Plan',
    free: 'Free',
    pro: 'Pro',
    proUnlimitedHint: 'Pro is not limited by the daily free quota.',
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
      'Upload only images that do not infringe copyrights, trademarks, or other third-party rights. You are responsible for rights violations. Continue?',
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
  const [showFlash, setShowFlash] = useState(false); // フラッシュ効果用
  const [showShareMenu, setShowShareMenu] = useState(false); // SNS共有メニュー表示用
  const [isBlurWarning, setIsBlurWarning] = useState(false);
  const [detectionFailed, setDetectionFailed] = useState(false);
  const [manualEditActive, setManualEditActive] = useState(false);
  const [retryStatusText, setRetryStatusText] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoPickerRef = useRef<HTMLInputElement>(null);
  const customLogoPickerRef = useRef<HTMLInputElement>(null);
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
  const upgradeUrl = process.env.NEXT_PUBLIC_UPGRADE_URL || '';

  const trackPlanEvent = useCallback((event: 'upgrade_click' | 'feature_blocked_by_plan') => {
    const deviceId = getDeviceId();
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
    if (dailyRemaining === null) return true;
    return dailyRemaining > 0;
  }, [isFreePlan, dailyRemaining]);

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
      const deviceId = getDeviceId();
      const res = await fetch('/api/plan', {
        cache: 'no-store',
        headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
      });
      if (!res.ok) return;
      const data = await res.json();
      setBillingEnabled(Boolean(data?.billingEnabled));
      if (!data?.billingEnabled) {
        setPlan('free');
      } else if (data?.plan === 'pro' || data?.plan === 'free') {
        setPlan(data.plan);
      }
      if (data?.features && typeof data.features === 'object') {
        setPlanFeatures({
          customLogo: Boolean(data.features.customLogo),
          watermarkOnExport: Boolean(data.features.watermarkOnExport),
          dailyDetectLimit: Number(data.features.dailyDetectLimit) || DEFAULT_PLAN_FEATURES.dailyDetectLimit,
          rateLimitPerMinute: Number(data.features.rateLimitPerMinute) || DEFAULT_PLAN_FEATURES.rateLimitPerMinute,
        });
      }
      if (data?.remainingDetectionsToday === null || typeof data?.remainingDetectionsToday === 'number') {
        setDailyRemaining(data.remainingDetectionsToday);
      }
    } catch (_) {
      // フェイルセーフ: free のまま継続
    } finally {
      setPlanResolved(true);
    }
  }, []);

  useEffect(() => {
    fetchPlan();
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
  }, [ensureDefaultCorners]);

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

  const discardRetakeSnapshot = useCallback(() => {
    setRetakeSnapshot((prev) => {
      if (prev?.previewImageUrl) revokeTrackedObjectUrl(prev.previewImageUrl);
      return null;
    });
  }, [revokeTrackedObjectUrl]);

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
    playAttemptCountRef.current = 0;
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

    setIsProcessing(true);
    setCameraError(null);
    setDetectionFailed(false);
    setManualEditActive(false);
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

      discardRetakeSnapshot();
      setPreviewImageUrl(createTrackedObjectUrl(fullResBlob));
      setScreenMode('preview_edit');
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(DEFAULT_MANUAL_MASK_SCALE);
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

      if (!hasAutoDetectQuota()) {
        setIsProcessing(false);
        setToastMessage(tx('dailyFreeLimitManualOnly'));
        showManualHelpAfterFailure();
        return;
      }

      const controller = new AbortController();
      activeDetectControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 25_000);
      try {
        const deviceId = getDeviceId();
        const res = await fetch('/api/detect', {
          method: 'POST',
          body: createFormData(false),
          signal: controller.signal,
          headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
        });
        let result: DetectApiResponse = {};
        try {
          result = await res.json();
        } catch (_) {
          result = { error: { code: 'INVALID_JSON', message: 'Invalid JSON response' } };
        }

        if (isLatestRequest()) {
          if (typeof result.reasoning === 'string' && result.reasoning.trim()) {
            console.info('Plate detection reasoning:', result.reasoning);
          }
          const remaining = result.remainingToday;
          if (remaining !== undefined) setDailyRemaining(remaining);
          if (!res.ok) {
            const errPayload = result.error;
            const msg = typeof errPayload === 'string' ? errPayload : result.userMessage || tx('autoDetectFailedManual');
            setToastMessage(getMessageByErrorType(result.errorType, msg, result.retryAfterSeconds));
            showManualHelpAfterFailure();
          } else if (result.found && result.plates && Array.isArray(result.plates) && result.plates.length > 0) {
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
              setManualEditActive(false);
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
            setManualEditActive(false);
          } else {
            setToastMessage(tx('autoDetectFailedManual'));
            showManualHelpAfterFailure();
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
      setEditLogoScale(DEFAULT_MANUAL_MASK_SCALE);
      setEditLogoRotation(0);
      setScreenMode('preview_edit');
      setToastMessage(`画像の解析に失敗しました。手動で位置を合わせてください。${err instanceof Error ? ` (${err.message})` : ''}`);
      showManualHelpAfterFailure();
      setIsProcessing(false);
      setRetryStatusText(null);
    }
  }, [createTrackedObjectUrl, discardRetakeSnapshot, getMessageByErrorType, hasAutoDetectQuota, showManualHelpAfterFailure, revokeTrackedObjectUrl, tx]);

  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
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
    setManualEditActive(false);
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
      discardRetakeSnapshot();
      setPreviewImageUrl(createTrackedObjectUrl(fullResBlob));
      setScreenMode('preview_edit');
      const defaultCorners = getDefaultCenterCorners();
      setDetectedCorners([defaultCorners]);
      setDetectedBaseAngles([getPlateBaseAngle(defaultCorners)]);
      setEditLogoOffset({ x: 0, y: 0 });
      setEditLogoScale(DEFAULT_MANUAL_MASK_SCALE);
      setEditLogoRotation(0);
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
          setToastMessage(message);
          showManualHelpAfterFailure();
          return;
        }
        if (typeof result.reasoning === 'string' && result.reasoning.trim()) {
          console.info('Plate detection reasoning:', result.reasoning.trim());
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
            setManualEditActive(false);
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
          setManualEditActive(false);
        } else {
          setToastMessage(tx('autoDetectFailedManual'));
          showManualHelpAfterFailure();
        }
      };

      if (!hasAutoDetectQuota()) {
        setIsProcessing(false);
        setToastMessage(tx('dailyFreeLimitManualOnly'));
        showManualHelpAfterFailure();
        return;
      }

      (async () => {
        const videoTrack = streamRef.current?.getVideoTracks()[0];
        if (videoTrack && 'applyConstraints' in videoTrack) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ torch: false } as any] });
          } catch (_) {}
        }
        const controller = new AbortController();
        activeDetectControllerRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 25_000);
        try {
          const deviceId = getDeviceId();
          const res = await fetch('/api/detect', {
            method: 'POST',
            body: createFormData(false),
            signal: controller.signal,
            headers: deviceId ? { 'X-Device-Id': deviceId } : undefined,
          });

          let result: DetectApiResponse = {};
          try {
            result = await res.json();
          } catch (_) {
            result = { error: { code: 'INVALID_JSON', message: 'Invalid JSON response' } };
          }

          if (isLatestRequest()) {
            applyResult(result, res);
          }
        } catch (fetchErr: unknown) {
          if (!isLatestRequest()) return;
          if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
            setToastMessage(tx('processingSlow'));
            showManualHelpAfterFailure();
            return;
          }
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
      setEditLogoScale(DEFAULT_MANUAL_MASK_SCALE);
      setEditLogoRotation(0);
      setToastMessage(tx('autoDetectFailedManual'));
      showManualHelpAfterFailure();
      setIsProcessing(false);
      setRetryStatusText(null);
    }
  }, [createTrackedObjectUrl, detectBrightness, discardRetakeSnapshot, getMessageByErrorType, hasAutoDetectQuota, showManualHelpAfterFailure, tx]);

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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
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

    if ((manualEditActive || !isProcessing) && detectedCorners.length > 0) {
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

        // マスク種別ごとの描画
        if (maskStyle === 'custom') {
          if (
            customMaskPreparedImage &&
            customMaskPreparedImage.naturalWidth > 0 &&
            customMaskPreparedImage.naturalHeight > 0
          ) {
            drawImageWarpedToQuad(
              ctx,
              customMaskPreparedImage,
              quadPx,
              PLATE_MASK_WIDTH,
              PLATE_MASK_HEIGHT
            );
          } else {
            fillQuad(ctx, quadPx, '#000000');
          }
        } else {
          const plateFillColor = maskStyle === 'white' ? '#ffffff' : '#000000';
          fillQuad(ctx, quadPx, plateFillColor);

          if (maskStyle === 'black' || maskStyle === 'white') {
            // 単色マスクのみ
          } else if (maskStyle === 'carkus') {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const overlayImage = carkusBrandImage;
            const isLogoImageReady = Boolean(
              overlayImage &&
              overlayImage.naturalWidth > 0 &&
              overlayImage.naturalHeight > 0
            );
            if (isLogoImageReady) {
              const logoAspect = overlayImage!.naturalWidth / overlayImage!.naturalHeight;

              const midLeft = { x: (quadPx[0].x + quadPx[3].x) / 2, y: (quadPx[0].y + quadPx[3].y) / 2 };
              const midRight = { x: (quadPx[1].x + quadPx[2].x) / 2, y: (quadPx[1].y + quadPx[2].y) / 2 };
              const midTop = { x: (quadPx[0].x + quadPx[1].x) / 2, y: (quadPx[0].y + quadPx[1].y) / 2 };
              const midBottom = { x: (quadPx[2].x + quadPx[3].x) / 2, y: (quadPx[2].y + quadPx[3].y) / 2 };
              const axisUxRaw = midRight.x - midLeft.x;
              const axisUyRaw = midRight.y - midLeft.y;
              const axisULen = Math.max(1e-6, Math.hypot(axisUxRaw, axisUyRaw));
              const axisUx = axisUxRaw / axisULen;
              const axisUy = axisUyRaw / axisULen;
              let axisVx = -axisUy;
              let axisVy = axisUx;
              const topBottomVecX = midBottom.x - midTop.x;
              const topBottomVecY = midBottom.y - midTop.y;
              if (axisVx * topBottomVecX + axisVy * topBottomVecY < 0) {
                axisVx *= -1;
                axisVy *= -1;
              }

              const plateWidthPx = Math.max(1, Math.hypot(midRight.x - midLeft.x, midRight.y - midLeft.y));
              const plateHeightPx = Math.max(1, Math.abs(topBottomVecX * axisVx + topBottomVecY * axisVy));
              const insetPx = Math.max(1, plateHeightPx * LOGO_INSET_RATIO_BY_PLATE_HEIGHT);
              const availableW = Math.max(1, plateWidthPx - insetPx * 2);
              const availableH = Math.max(1, plateHeightPx - insetPx * 2);

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
                drawCarkusLogoAtOrigin(lctx, Lw * 0.92, Lh * 0.92, undefined, carkusBrandImage);
                lctx.restore();
              }

              const quadCenterX = (quadPx[0].x + quadPx[1].x + quadPx[2].x + quadPx[3].x) / 4;
              const quadCenterY = (quadPx[0].y + quadPx[1].y + quadPx[2].y + quadPx[3].y) / 4;

              const logoCenterX =
                quadCenterX +
                axisUx * templateShiftU +
                axisUx * (LOGO_VISUAL_CENTER_OFFSET.x * logoDrawW) +
                axisVx * (LOGO_VISUAL_CENTER_OFFSET.y * logoDrawH);
              const logoCenterY =
                quadCenterY +
                axisUy * templateShiftU +
                axisUy * (LOGO_VISUAL_CENTER_OFFSET.x * logoDrawW) +
                axisVy * (LOGO_VISUAL_CENTER_OFFSET.y * logoDrawH);
              const logoAngle = Math.atan2(axisUy, axisUx);
              ctx.save();
              ctx.translate(logoCenterX, logoCenterY);
              ctx.rotate(logoAngle);
              ctx.drawImage(logoCanvas, -logoDrawW / 2, -logoDrawH / 2, logoDrawW, logoDrawH);
              ctx.restore();
            }
          }
        }
      });
    }
  }, [screenMode, previewImageLoaded, detectedCorners, carkusBrandImage, customMaskPreparedImage, maskStyle, editLogoOffset, editLogoScale, editLogoRotation, maskTemplate, isProcessing, manualEditActive]);

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

    if (planFeatures.watermarkOnExport) {
      const shortEdge = Math.min(outCanvas.width, outCanvas.height);
      const padding = Math.max(16, Math.round(shortEdge * 0.03));
      const liftY = Math.max(22, Math.round(shortEdge * 0.08));
      const fontSize = Math.max(12, Math.round(shortEdge * 0.036));
      const text = 'Made with Carkus';
      outCtx.save();
      outCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
      outCtx.textAlign = 'right';
      outCtx.textBaseline = 'bottom';
      outCtx.lineWidth = Math.max(2, Math.round(fontSize * 0.12));
      outCtx.strokeStyle = 'rgba(0,0,0,0.26)';
      outCtx.fillStyle = 'rgba(255,255,255,0.34)';
      outCtx.strokeText(text, outCanvas.width - padding, outCanvas.height - padding - liftY);
      outCtx.fillText(text, outCanvas.width - padding, outCanvas.height - padding - liftY);
      outCtx.restore();
    }

    const jpegQuality = isFreePlan ? FREE_EXPORT_JPEG_QUALITY : PRO_EXPORT_JPEG_QUALITY;
    return await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob((b) => resolve(b), 'image/jpeg', jpegQuality);
    });
  }, [isFreePlan, planFeatures.watermarkOnExport]);

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
            <span className="px-3 py-1.5 text-xs bg-white/20 text-white tracking-wide">{text.beta}</span>
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
            <span className="h-6 flex items-center shrink-0 text-white">
              <CarkusLogo className="h-full w-auto text-white" />
            </span>
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
          {showFlash && (
            <div className="absolute inset-0 bg-white z-30 pointer-events-none" style={{ animation: 'flash 0.2s ease-out' }} />
          )}
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
          <p className="text-white/55 text-xs font-light text-center max-w-sm leading-relaxed px-2">
            {text.dailyNote}
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
        <div className="fixed inset-0 z-0 bg-black">
          {toastMessage && (
            <div className="fixed top-3 left-3 right-3 landscape:left-auto landscape:right-3 landscape:max-w-xs z-30 px-3 py-2 rounded-lg bg-black/70 backdrop-blur-xl text-white text-xs font-light border border-white/20">
              {toastMessage}
            </div>
          )}
          <div
            className="absolute inset-0 z-[1] touch-none"
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
                <Loader2 className="animate-spin text-white" size={40} strokeWidth={2.5} />
                <p className="text-white/90 text-sm font-light mt-3">{text.processing}</p>
                <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
                  <div className="h-full bg-white/80 processing-sweep" />
                </div>
              </div>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 z-10 pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))] px-3 pointer-events-none bg-gradient-to-t from-black/85 via-black/60 to-transparent landscape:top-0 landscape:left-auto landscape:right-0 landscape:bottom-0 landscape:w-44 landscape:pt-3 landscape:pb-3 landscape:bg-black/50 landscape:backdrop-blur-2xl landscape:border-l landscape:border-white/20 landscape:overflow-y-auto">
            <div className="pointer-events-auto">
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
