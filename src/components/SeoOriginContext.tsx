import { CARKUS_ORIGIN_SEO_LINE } from '../lib/seo-origin';

/** 画面上は非表示。HTML 上に1行だけ残し、クローラーが文脈を拾えるようにする */
export function SeoOriginContext() {
  return <p className="seo-origin-context">{CARKUS_ORIGIN_SEO_LINE}</p>;
}
