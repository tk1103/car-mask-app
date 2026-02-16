# 該当ソース参照（残り回数・横向きタイムアウト）

## 1. 本日20回 / あとX回 の整合性

### 不整合の原因（修正済み）
- **クライアント**: エラー時（429・504など）に `remainingToday` が無いと「0」で上書きしていた → **修正**: `remainingToday` が返ってきたときだけ更新するように変更。
- **API**: 1分制限の 429 で `remainingToday` を返していなかった → **修正**: 全 429/504 で `remainingToday: getDailyRemaining(clientId)` を返すように変更。

### 該当箇所

| 内容 | ファイル | 行付近 |
|------|----------|--------|
| 表示「本日20回まで」「あとX回」 | `src/app/page.tsx` | 967, 981, 999, 1018 |
| 状態 `dailyRemaining` の定義 | `src/app/page.tsx` | 137 |
| エラー時に残り回数を更新（修正済み） | `src/app/page.tsx` | 396-398 |
| 成功時に残り回数を更新 | `src/app/page.tsx` | 444-445 |
| API が残り回数を返す（成功時） | `src/app/api/detect-plate/route.ts` | 307 |
| API が残り回数を返す（日次制限 429） | `src/app/api/detect-plate/route.ts` | 122 |
| API が残り回数を返す（1分制限 429） | `src/app/api/detect-plate/route.ts` | 127-136 |
| API が残り回数を返す（504 タイムアウト） | `src/app/api/detect-plate/route.ts` | 203-212 |

---

## 2. 横向き撮影でタイムアウトする問題

横向きは解像度が大きくなり、アップロード・Gemini の処理が重くなりやすいです。以下で「画像サイズ」と「タイムアウト」を制御しています。

### 該当箇所

| 内容 | ファイル | 行付近 |
|------|----------|--------|
| API 送信画像のサイズ（長辺 1024px に制限） | `src/app/page.tsx` | 319-323 |
| クライアント側 fetch の 60 秒タイムアウト | `src/app/page.tsx` | 364-382 |
| サーバー側 Gemini 呼び出しの 55 秒タイムアウト | `src/app/api/detect-plate/route.ts` | 172-216 |
| 504 時のユーザー向けメッセージ | `src/app/api/detect-plate/route.ts` | 203-212 |

### メモ
- 横向きでも送信画像は「長辺 1024px」にリサイズしてから送っている（319-323 行目）。それでもタイムアウトする場合は、モバイル回線の遅延や Gemini の負荷が考えられます。
- タイムアウトを延ばす場合は、`page.tsx` の 60_000 と `route.ts` の 55_000 をまとめて変更してください。
