import type { Metadata } from 'next';
import Link from 'next/link';
import { SeoOriginContext } from '../../components/SeoOriginContext';
import { getContactLabel, getContactMailto, site } from '../../lib/site';

export const metadata: Metadata = {
  title: `利用規約 | ${site.name}`,
  description: `${site.name}（${site.nameReading}）の利用規約`,
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <header className="mb-8">
          <Link
            href="/"
            className="text-sm text-sky-400 hover:text-sky-300"
          >
            ← トップに戻る
          </Link>
          <h1 className="text-3xl font-light text-white mt-4 tracking-wide">{site.name} 利用規約</h1>
          <p className="text-zinc-500 text-base mt-2">最終更新日: 2026年6月12日</p>
          <p className="text-zinc-500 text-sm mt-1">運営者: {site.operatorName}</p>
        </header>

        <div className="space-y-8 text-base font-light text-zinc-300 leading-relaxed">
          <section>
            <h2 className="text-xl font-medium text-white mb-2">第1条（適用）</h2>
            <p>
              本利用規約（以下「本規約」）は、当社（以下「当社」）が提供するウェブアプリケーション「Carkus」（以下「本サービス」）の利用条件を定めるものです。利用者は、本規約に同意のうえ本サービスを利用するものとします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第2条（本サービスの内容）</h2>
            <p>
              本サービスは、利用者が撮影またはアップロードした画像に対し、ナンバープレート上へのマスク（ロゴ等の重ね合わせ）等の表示を行うための補助機能を提供するものです。本サービスはベータ版の要素を含み、仕様は予告なく変更される場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第3条（第三者のAIサービスの利用）</h2>
            <p>
              本サービスは、画像の解析等に、Google 等の第三者が提供する生成AI・機械学習サービス（例: Google Gemini 関連のAPI）を利用する場合があります。当該サービスの提供条件・プライバシーポリシーは、各提供者の定めるところに従います。当社は、当該第三者の内部仕様、学習利用、可用性、応答内容の正確性について保証しません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第4条（利用者提供情報と権利表示）</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                利用者は、本サービスにアップロードする画像（ナンバープレート等を含む）および独自ロゴ等について、第三者の著作権・商標権・肖像権等を侵害しないもの、または適法に利用する権利を有するものに限るものとします。権利侵害に関する紛争・損害について、当社は責任を負いません。
              </li>
              <li>
                利用者が本サービスに提供した情報を処理するにあたり、当社に付与するライセンスは、本サービスの提供・品質改善・不具合対応・法遵守に必要な範囲に限ります。ただし、前項のとおり本サービスは第三者APIを用いる場合があり、当社が第三者に委託する範囲内での取り扱いになることがあります。
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第5条（禁止事項）</h2>
            <p>利用者は、以下を行ってはなりません。</p>
            <ol className="list-decimal pl-5 space-y-1 mt-2">
              <li>法令または公序良俗に違反する行為</li>
              <li>他者の権利を侵害する、または侵害のおそれがある内容の提供</li>
              <li>本サービスまたは関係する第三者のシステムへの不正アクセス、過剰負荷、改ざん、リバースエンジニアリング</li>
              <li>本サービスを、虚偽の文脈、誤認を生じさせる目的、または違法な活動のために利用する行為</li>
              <li>その他、当社が合理的に不適当と判断する行為</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第6条（有料・無料等）</h2>
            <p>
              本サービスは無償で提供する場合、又は有料のプランを設ける場合があります。料金・制限事項（透かしの有無、回数等）は、アプリ上の表示または当社の別途定める条件に従います。第三者APIの都合により、利用回数等に変動が生じる旨を予め了承するものとします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第7条（保証の否認）</h2>
            <p>
              本サービス、および本サービスを通じた画像解析・座標推定等の結果の正確性、完全性、最新性、特定目的への適合性について、当社はいかなる保証も行いません。手動補正・再撮影等の利用者判断を前提とするものとします。本サービスは「現状有姿」で提供されます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第8条（損害賠償の制限）</h2>
            <p>
              当社の故意または重過失に起因する場合を除き、本サービスに関して利用者に生じた損害について、当社が負う賠償責任は、当該損害の原因となった事象が発生した日から遡り1か月の間に利用者が当社に実際に支払った金額（無償利用の場合は金銭0円）を上限とし、当社は間接損害、逸失利益、特別損害について一切責任を負いません。なお、消費者契約法その他の強行法規の適用がある場合は、当該法規の範囲内で限定的に留保されます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第9条（本サービスの変更・停止）</h2>
            <p>
              当社は、当社の裁量で、本サービスの内容を変更、中断、終了することがあります。可能な限り周知に努めますが、周知方法・時期の保証は行いません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第10条（規約の変更）</h2>
            <p>
              当社は、本規約を改定できます。改定後の規約は、本サービス上の掲示その他当社が妥当と判断する方法をもって、利用者が参照可能な状態に置いた時点で効力を生じ、利用者が改定後に本サービスを利用した時点で同意とみなします。重要な変更の場合、可能な限り分かりやすく表示します。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第11条（分離可能条項・準拠法・合意管轄）</h2>
            <p>
              本規約のいずれかの条項が無効と判断された場合でも、他条項の有効性には影響しません。本規約の準拠法は日本国法とし、本サービスに関する紛争については、当社本店所在地を管轄する裁判所を専属的合意管轄とします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第12条（お問い合わせ）</h2>
            <p>本規約に関するお問い合わせは、下記までご連絡ください。</p>
            <ul className="mt-2 space-y-1">
              <li>運営者: {site.operatorName}</li>
              <li>
                連絡先:{' '}
                {getContactMailto() ? (
                  <a href={getContactMailto()!} className="text-sky-400 hover:text-sky-300 underline underline-offset-2">
                    {site.contactEmail}
                  </a>
                ) : (
                  <span className="text-zinc-500">{getContactLabel()}</span>
                )}
              </li>
            </ul>
            <p className="mt-3 text-sm text-zinc-500">
              <Link href="/privacy" className="text-sky-400 hover:text-sky-300">
                プライバシーポリシー
              </Link>
              {' · '}
              <Link href="/press" className="text-sky-400 hover:text-sky-300">
                プレスキット
              </Link>
            </p>
          </section>
        </div>
        <SeoOriginContext />
      </div>
    </div>
  );
}
