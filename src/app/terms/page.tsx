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
          <p className="text-zinc-500 text-base mt-2">最終更新日: 2026年6月15日</p>
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
              本サービスは、利用者が撮影またはアップロードした画像に対し、ナンバープレート上へのマスク（ロゴ等の重ね合わせ）等の表示を行うための補助機能を提供するものです。本サービスはベータ版の要素を含み、仕様は予告なく変更される場合があります。本サービスは、法令上の義務（ナンバープレートの隠蔽義務の有無、表示方法の適法性等）を満たすこと、または特定の利用目的への適合を保証するものではなく、法的助言を提供するものでもありません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第3条（第三者のAIサービスの利用）</h2>
            <p>
              本サービスは、画像の解析等に、Google 等の第三者が提供する生成AI・機械学習サービス（例: Google Gemini 関連のAPI）を利用する場合があります。当該サービスの提供条件・プライバシーポリシーは、各提供者の定めるところに従います。当社は、当該第三者の内部仕様、学習利用、可用性、応答内容の正確性について保証しません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第4条（利用者提供コンテンツと権利）</h2>
            <ol className="list-decimal pl-5 space-y-3">
              <li>
                利用者は、本サービスにアップロードする画像（車両、人物、背景、ナンバープレート等を含みます）、独自ロゴ・マスク画像、および本サービスを通じて生成・編集・保存・共有する一切の成果物（以下総称して「利用者コンテンツ」）について、第三者の著作権、商標権、肖像権、パブリシティ権、プライバシーその他一切の権利を侵害しないもの、または適法に利用する権利・許諾を有するものに限るものとします。
              </li>
              <li>
                利用者コンテンツの内容、正確性、適法性、権利処理の完備性についての責任は、すべて利用者が単独で負うものとします。当社は、利用者コンテンツについて、事前審査、監視、確認、保存、バックアップ、削除その他の義務を負いません。
              </li>
              <li>
                利用者が、利用者コンテンツを SNS、ブログ、販売サイト、メッセージアプリその他の媒体に掲載、投稿、送信、共有、公開、頒布する行為（以下「外部掲載等」）については、当該行為および当該掲載内容に関する一切の責任を利用者が負うものとします。当社は、外部掲載等の内容、方法、結果、第三者からの問い合わせ・通報・請求・紛争について、一切の責任を負いません。
              </li>
              <li>
                利用者コンテンツに含まれる、または外部掲載等により表示・利用される第三者の肖像、氏名、商標、ロゴ、車両デザイン、ナンバープレートの表示内容その他の識別要素に関し、第三者から当社に対して損害賠償請求、差止請求、名誉毀損、プライバシー侵害、不正競争、商標権侵害、肖像権侵害等の主張がなされた場合でも、当社は利用者に代わって対応する義務を負わず、当該請求・紛争に起因または関連して当社に生じた損害（合理的な弁護士費用を含みます）について、利用者は当社を防御し、補償するものとします。
              </li>
              <li>
                利用者が本サービスに提供した情報を処理するにあたり、当社に付与するライセンスは、本サービスの提供・品質改善・不具合対応・法遵守に必要な範囲に限ります。ただし、前各項のとおり本サービスは第三者APIを用いる場合があり、当社が第三者に委託する範囲内での取り扱いになることがあります。当社は、利用者コンテンツの著作権その他の権利を取得するものではありません。
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第5条（禁止事項）</h2>
            <p>利用者は、以下を行ってはなりません。</p>
            <ol className="list-decimal pl-5 space-y-1 mt-2">
              <li>法令または公序良俗に違反する行為</li>
              <li>
                他者の著作権、商標権、肖像権、パブリシティ権、プライバシーその他の権利を侵害する、または侵害のおそれがある利用者コンテンツの提供、外部掲載等
              </li>
              <li>本人の同意なく撮影された人物の肖像、無断の商標・ロゴ・ブランド要素を含むコンテンツの外部掲載等</li>
              <li>本サービスまたは関係する第三者のシステムへの不正アクセス、過剰負荷、改ざん、リバースエンジニアリング</li>
              <li>本サービスを、虚偽の文脈、誤認を生じさせる目的、違法な活動、または第三者の権利侵害のために利用する行為</li>
              <li>ナンバープレートの隠蔽その他の表示改変を、法令で認められない方法・目的で行う行為</li>
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
              本サービス、および本サービスを通じた画像解析・座標推定・マスク表示等の結果の正確性、完全性、最新性、特定目的への適合性、第三者権利の非侵害性について、当社は明示・黙示を問わずいかなる保証も行いません。手動補正・再撮影・権利確認等の利用者判断を前提とするものとします。本サービスは「現状有姿」で提供されます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第8条（損害賠償の制限）</h2>
            <ol className="list-decimal pl-5 space-y-2">
              <li>
                当社の故意または重過失に起因する場合を除き、本サービスに関して利用者に生じた損害について、当社が負う賠償責任は、当該損害の原因となった事象が発生した日から遡り1か月の間に利用者が当社に実際に支払った金額（無償利用の場合は金銭0円）を上限とし、当社は間接損害、逸失利益、特別損害について一切責任を負いません。
              </li>
              <li>
                前項にかかわらず、利用者コンテンツまたは利用者の外部掲載等に関連して第三者から当社に対して生じた請求・紛争・損害について、当社は利用者に対して一切の賠償責任を負わず、第4条第4項に定める補償義務が適用されます。
              </li>
              <li>
                消費者契約法その他の強行法規の適用がある場合は、当該法規の範囲内で本条的効力が限定的に留保されます。
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-medium text-white mb-2">第9条（本サービスの変更・停止）</h2>
            <p>
              当社は、当社の裁量で、本サービスの内容を変更、中断、終了することがあります。可能な限り周知に努めますが、周知方法・時期の保証は行いません。サービス終了に伴い、利用者に生じた損害について、当社は責任を負いません。
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
              本規約のいずれかの条項が無効または執行不能と判断された場合でも、他条項の有効性には影響しません。本規約の準拠法は日本国法とし、本サービスに関する紛争については、当社本店所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
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
