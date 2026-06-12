import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getContactLabel, getContactMailto, site } from '../../lib/site';

export const metadata: Metadata = {
  title: `プレスキット | ${site.name}`,
  description: `${site.name}（${site.nameReading}）のプレスキット・メディア向け素材`,
  openGraph: {
    title: `${site.name} プレスキット`,
    description: site.descriptionJa,
    url: `${site.url}/press`,
  },
};

const features = [
  'スマホブラウザのみで動作（インストール不要、PWA 対応）',
  'AI（Google Gemini）によるナンバープレートの自動検出',
  '検出失敗時は手動で枠をドラッグして調整可能',
  'ロゴのサイズ・角度・テンプレート（Fit / Centered / Badge）を変更可能',
  'β版: AI 自動検出は 1 日 3 回まで（手動編集・保存は制限なし）',
];

const betaNotes = [
  '現時点では無料の β 版のみ提供（有料プランは未公開）',
  '保存画像には「Made with Carkus」透かしが入ります',
  '混雑時は自動検出が失敗することがあります（手動編集で対応可能）',
  'ナンバー隠しは SNS 投稿等の正当な用途を想定。不正利用は禁止です',
];

export default function PressPage() {
  const contactMailto = getContactMailto();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-8 pb-16">
        <header className="mb-10">
          <Link href="/" className="text-sm text-sky-400 hover:text-sky-300">
            ← アプリを開く
          </Link>
          <p className="text-xs tracking-[0.2em] text-amber-300/90 mt-6 uppercase">Press Kit</p>
          <h1 className="text-4xl font-light text-white mt-2 tracking-wide">{site.name}</h1>
          <p className="text-zinc-400 text-lg mt-2">{site.taglineJa}</p>
        </header>

        <section className="space-y-4 mb-10">
          <h2 className="text-lg font-medium text-white border-b border-white/10 pb-2">1行紹介</h2>
          <p className="text-zinc-300 leading-relaxed">{site.taglineJa} — {site.descriptionJa}</p>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="text-lg font-medium text-white border-b border-white/10 pb-2">基本情報</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm text-zinc-300">
            <dt className="text-zinc-500">サービス名</dt>
            <dd>{site.name}（{site.nameReading}）</dd>
            <dt className="text-zinc-500">URL</dt>
            <dd>
              <a href={site.url} className="text-sky-400 hover:text-sky-300 break-all">
                {site.url}
              </a>
            </dd>
            <dt className="text-zinc-500">公開形態</dt>
            <dd>Web アプリ（β版・無料）</dd>
            <dt className="text-zinc-500">公開時期</dt>
            <dd>{site.betaLaunchedAt}</dd>
            <dt className="text-zinc-500">運営</dt>
            <dd>{site.operatorName}</dd>
            <dt className="text-zinc-500">問い合わせ</dt>
            <dd>
              {contactMailto ? (
                <a href={contactMailto} className="text-sky-400 hover:text-sky-300">
                  {site.contactEmail}
                </a>
              ) : (
                <span className="text-zinc-500">{getContactLabel()}</span>
              )}
            </dd>
          </dl>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="text-lg font-medium text-white border-b border-white/10 pb-2">特徴</h2>
          <ul className="list-disc pl-5 space-y-2 text-zinc-300 text-sm leading-relaxed">
            {features.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="text-lg font-medium text-white border-b border-white/10 pb-2">β版の注意事項（掲載時に明記推奨）</h2>
          <ul className="list-disc pl-5 space-y-2 text-zinc-400 text-sm leading-relaxed">
            {betaNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-4 mb-10">
          <h2 className="text-lg font-medium text-white border-b border-white/10 pb-2">素材ダウンロード</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href="/icon-512.png"
              download
              className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <Image src="/icon-512.png" alt="App icon 512" width={64} height={64} className="rounded-xl" />
              <div>
                <p className="text-white text-sm">アプリアイコン</p>
                <p className="text-zinc-500 text-xs">icon-512.png</p>
              </div>
            </a>
            <a
              href="/opengraph-image"
              download="carkus-og.png"
              className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="w-16 h-16 rounded-xl bg-zinc-800 flex items-center justify-center text-xs text-zinc-400">
                OG
              </div>
              <div>
                <p className="text-white text-sm">OGP 画像</p>
                <p className="text-zinc-500 text-xs">1200×630（自動生成）</p>
              </div>
            </a>
            <a
              href="/Carkus.svg"
              download
              className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="w-16 h-16 rounded-xl bg-zinc-800 flex items-center justify-center text-white text-sm font-light">
                SVG
              </div>
              <div>
                <p className="text-white text-sm">ロゴ（SVG）</p>
                <p className="text-zinc-500 text-xs">Carkus.svg</p>
              </div>
            </a>
          </div>
          <p className="text-zinc-500 text-xs leading-relaxed">
            スクリーンショットは実機で撮影したものをメディア掲載にご利用ください。掲載前の確認が必要な場合は上記問い合わせ先までご連絡ください。
          </p>
        </section>

        <section className="space-y-3 text-sm">
          <h2 className="text-lg font-medium text-white border-b border-white/10 pb-2">関連ページ</h2>
          <div className="flex flex-wrap gap-4">
            <Link href="/terms" className="text-sky-400 hover:text-sky-300">
              利用規約
            </Link>
            <Link href="/privacy" className="text-sky-400 hover:text-sky-300">
              プライバシーポリシー
            </Link>
            <a href={site.url} className="text-sky-400 hover:text-sky-300">
              アプリを試す
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
