/**
 * サイト共通設定。@press / 利用規約 / OGP で参照。
 * Vercel では NEXT_PUBLIC_* を本番値に設定してください。
 */
export const site = {
  name: 'Carkus',
  nameReading: 'カーカス',
  taglineJa: '車の写真のナンバーを、ロゴでマスク',
  taglineEn: 'Mask license plates on car photos with a logo',
  descriptionJa:
    'スマホブラウザだけで、車の写真からナンバープレートを検出しロゴで隠して保存できるβ版Webアプリ。SNS用の愛車写真に。',
  descriptionEn:
    'A beta web app to detect license plates on car photos and mask them with a logo—right in your mobile browser.',
  url: process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://auto-mobile-camera.vercel.app',
  operatorName: process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim() || 'Carkus 運営',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || '',
  betaLaunchedAt: '2026年6月',
} as const;

export function getContactMailto(): string | null {
  if (!site.contactEmail) return null;
  return `mailto:${site.contactEmail}`;
}

export function getContactLabel(): string {
  return site.contactEmail || '（NEXT_PUBLIC_CONTACT_EMAIL を設定してください）';
}
