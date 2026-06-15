import type { Metadata } from 'next';
import Link from 'next/link';
import { SeoOriginContext } from '../../components/SeoOriginContext';
import { getContactLabel, getContactMailto, site } from '../../lib/site';

export const metadata: Metadata = {
  title: `プライバシーポリシー | ${site.name}`,
  description: `${site.name}（${site.nameReading}）のプライバシーポリシー`,
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  const contactMailto = getContactMailto();

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <header className="mb-8">
          <Link href="/" className="text-sm text-sky-400 hover:text-sky-300">
            ← トップに戻る
          </Link>
          <h1 className="text-3xl font-light text-white mt-4 tracking-wide">{site.name} プライバシーポリシー</h1>
          <p className="text-zinc-500 text-base mt-2">最終更新日: 2026年6月15日</p>
        </header>

        <div className="space-y-8 text-base font-light text-zinc-300 leading-relaxed">
          <section>
            <p>
              {site.operatorName}（以下「当社」）は、ウェブアプリケーション「{site.name}」（以下「本サービス」）における利用者情報の取扱いについて、本プライバシーポリシー（以下「本ポリシー」）に従います。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">1. 取得する情報</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                <strong className="text-zinc-100">画像データ</strong>
                ：利用者が撮影または選択した車両写真（ナンバープレートを含む場合があります）。自動検出を利用する場合、当社サーバー経由で Google Gemini API 等の第三者サービスに送信されます。
              </li>
              <li>
                <strong className="text-zinc-100">端末識別子</strong>
                ：日次利用回数の管理のため、ブラウザの localStorage に保存したランダムなデバイス ID（UUID）を、API リクエストのヘッダー（X-Device-Id）として送信する場合があります。
              </li>
              <li>
                <strong className="text-zinc-100">利用ログ</strong>
                ：リクエストの成否、エラー種別、国コード、端末種別（モバイル等）など、サービス運用・障害対応に必要な範囲の技術情報。
              </li>
              <li>
                <strong className="text-zinc-100">ローカル保存</strong>
                ：独自ロゴ（将来の有料機能・β版では未提供）、言語設定、ダウンロード連番など、端末内（localStorage）に保存する情報。
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">2. 利用目的</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>ナンバープレート位置の自動検出およびマスク表示の提供</li>
              <li>利用回数制限・不正利用防止・サービス品質の維持</li>
              <li>障害調査、セキュリティ対応、利用状況の統計（匿名化された集計）</li>
              <li>本サービスの改善および β 版の検証</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">3. 第三者への提供</h2>
            <p>
              当社は、画像解析のため <strong className="text-zinc-100">Google LLC が提供する Gemini API</strong>
              （generativelanguage.googleapis.com）を利用します。送信された画像および関連メタデータは、Google の利用規約・プライバシーポリシーに従って処理されます。詳細は{' '}
              <a
                href="https://policies.google.com/privacy"
                className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google プライバシーポリシー
              </a>
              をご確認ください。
            </p>
            <p className="mt-2">
              本サービスは Vercel, Inc. 上でホストされ、利用状況の保存に Vercel KV を使用する場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">4. 保存期間</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>画像データ：自動検出の処理が完了した後、当社サーバー上に永続保存しません（処理の都度送信・破棄）。</li>
              <li>日次利用回数：デバイス ID 単位で最大約 8 日間（KV の TTL に準拠）。</li>
              <li>利用ログ（集計）：運用上必要な期間、匿名化された形で保持する場合があります。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">5. 利用者の選択肢</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>自動検出を使わず、手動で枠を調整してマスクすることもできます。</li>
              <li>ブラウザの localStorage を削除すると、端末 ID やローカル設定はリセットされます。</li>
              <li>カメラ・ファイルへのアクセス許可は、ブラウザまたは OS の設定から取り消せます。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">7. 利用者コンテンツに関する注意</h2>
            <p>
              利用者がアップロードまたは本サービスで編集した画像・ロゴ等の権利処理（著作権、商標権、肖像権等）の確認は、利用者自身の責任で行ってください。当社は、利用者が外部（SNS 等）に掲載・共有した内容について、第三者の権利侵害に関する一切の責任を負いません。詳細は
              <Link href="/terms" className="text-sky-400 hover:text-sky-300 underline underline-offset-2 mx-1">
                利用規約
              </Link>
              をご確認ください。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">8. セキュリティ</h2>
            <p>
              当社は、HTTPS 通信の利用、API キーのサーバー側管理、レート制限等により、合理的な範囲で情報の保護に努めます。ただし、インターネット上の通信において完全な安全性を保証するものではありません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">9. β版について</h2>
            <p>
              本サービスは β 版として提供されています。機能・制限（1 日あたりの自動検出回数等）は予告なく変更される場合があります。現時点では有料プランの販売は行っていません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">10. お問い合わせ</h2>
            <p>
              本ポリシーに関するお問い合わせは、下記までご連絡ください。
            </p>
            <ul className="mt-2 space-y-1">
              <li>運営者: {site.operatorName}</li>
              <li>
                連絡先:{' '}
                {contactMailto ? (
                  <a href={contactMailto} className="text-sky-400 hover:text-sky-300 underline underline-offset-2">
                    {site.contactEmail}
                  </a>
                ) : (
                  <span className="text-zinc-500">{getContactLabel()}</span>
                )}
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">11. 改定</h2>
            <p>
              当社は、必要に応じて本ポリシーを改定できます。改定後の内容は本ページに掲示した時点で効力を生じます。
            </p>
          </section>
        </div>
        <SeoOriginContext />
      </div>
    </div>
  );
}
