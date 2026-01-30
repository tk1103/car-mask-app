# アプリ公開ガイド

このアプリを公開する方法を説明します。

## 推奨方法: Vercel（最も簡単）

VercelはNext.jsの開発元が提供するプラットフォームで、Next.jsアプリの公開に最適です。

### 1. Vercelアカウントの作成

1. [Vercel](https://vercel.com) にアクセス
2. GitHubアカウントでサインアップ（推奨）またはメールアドレスで登録

### 2. プロジェクトをGitHubにプッシュ

```bash
# Gitリポジトリを初期化（まだの場合）
git init

# GitHubにリポジトリを作成し、プッシュ
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/receipt-title.git
git push -u origin main
```

### 3. Vercelでプロジェクトをインポート

1. Vercelダッシュボードにログイン
2. 「Add New...」→「Project」をクリック
3. GitHubリポジトリを選択
4. 「Import」をクリック

### 4. 環境変数の設定

Vercelのプロジェクト設定で以下の環境変数を設定：

- **`GEMINI_API_KEY`**: Google Gemini APIキー
  - [Google AI Studio](https://makersuite.google.com/app/apikey) で取得

設定方法：
1. プロジェクトの「Settings」→「Environment Variables」を開く
2. 環境変数を追加：
   - Name: `GEMINI_API_KEY`
   - Value: あなたのAPIキー
   - Environment: Production, Preview, Development すべてにチェック

### 5. デプロイ

1. 「Deploy」ボタンをクリック
2. ビルドが完了するまで待つ（数分）
3. デプロイが完了すると、URLが表示されます（例: `https://receipt-title.vercel.app`）

### 6. カスタムドメインの設定（オプション）

1. プロジェクトの「Settings」→「Domains」を開く
2. ドメインを追加
3. DNS設定を更新（Vercelの指示に従う）

## その他の公開方法

### Netlify

1. [Netlify](https://www.netlify.com) にサインアップ
2. GitHubリポジトリを接続
3. ビルド設定：
   - Build command: `npm run build`
   - Publish directory: `.next`
4. 環境変数を設定（`GEMINI_API_KEY`）

### 独自サーバー（VPS/クラウド）

#### 必要なもの：
- Node.js 18以上がインストールされたサーバー
- ドメイン（オプション）
- SSL証明書（Let's Encrypt推奨）

#### 手順：

1. **サーバーにコードをデプロイ**
```bash
# サーバーにSSH接続
ssh user@your-server.com

# リポジトリをクローン
git clone https://github.com/YOUR_USERNAME/receipt-title.git
cd receipt-title

# 依存関係をインストール
npm install

# 環境変数を設定
export GEMINI_API_KEY=your_api_key_here
# または .env.local ファイルを作成
```

2. **ビルド**
```bash
npm run build
```

3. **本番サーバーを起動**
```bash
# PM2を使用（推奨）
npm install -g pm2
pm2 start npm --name "receipt-title" -- start
pm2 save
pm2 startup
```

4. **Nginxでリバースプロキシ設定**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

5. **SSL証明書の設定（Let's Encrypt）**
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 重要な注意事項

### 1. HTTPS必須
- カメラアクセスにはHTTPSが必要です
- Vercel/Netlifyは自動でHTTPSを提供します
- 独自サーバーの場合はSSL証明書が必要です

### 2. 環境変数の管理
- APIキーなどの機密情報は環境変数で管理
- `.env.local`ファイルはGitにコミットしない（`.gitignore`に追加）

### 3. ビルドエラーの確認
- デプロイ前にローカルでビルドを確認：
```bash
npm run build
```

### 4. パフォーマンス最適化
- 画像の最適化（Next.jsのImageコンポーネント使用）
- コード分割（自動）
- CDN配信（Vercel/Netlifyは自動）

## トラブルシューティング

### ビルドエラー
- `npm run build`をローカルで実行してエラーを確認
- 環境変数が正しく設定されているか確認

### カメラが動作しない
- HTTPSが有効か確認
- ブラウザの権限設定を確認
- モバイルブラウザでテスト

### APIエラー
- `GEMINI_API_KEY`が正しく設定されているか確認
- APIキーの有効期限を確認
- Vercelのログを確認（「Deployments」→「Functions」→「View Function Logs」）

## 参考リンク

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Google Gemini API](https://ai.google.dev/docs)
