# サーバー起動方法

## 手順

1. ターミナルを開く
2. 以下のコマンドを実行：

```bash
cd /Users/heidegger/Receipt-title
npm run dev
```

3. ターミナルに以下のようなメッセージが表示されます：

```
> receipt-title@0.1.0 dev
> next dev -p 3000

  ▲ Next.js 16.1.1
  - Local:        http://localhost:3000
  - Ready in X.Xs
```

4. ブラウザで `http://localhost:3000` にアクセス

## ログの確認場所

### サーバー側のログ（APIルート）
- **場所**: `npm run dev` を実行したターミナル
- **確認内容**: 
  - `Environment check:` - APIキーの読み込み状況
  - `Trying model: gemini-pro-vision` - モデルの試行ログ
  - `Model gemini-pro-vision failed:` - エラーの詳細

### フロントエンド側のログ
- **場所**: ブラウザの開発者ツール（F12）→ Consoleタブ
- **確認内容**: 
  - `OCR API error:` - フロントエンド側のエラーメッセージ
  - ネットワークエラーなど

## サーバーを停止する方法

ターミナルで `Ctrl + C` を押すとサーバーが停止します。
