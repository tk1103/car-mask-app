# スマートフォンでの検証方法

スマートフォンでカメラ機能をテストするには、HTTPS接続が必要です。以下の方法でセットアップできます。

## 方法1: ngrokを使用（推奨）

### 1. ngrokのインストール

#### macOSの場合:
```bash
# Homebrewでインストール（推奨）
brew install ngrok/ngrok/ngrok

# または、公式サイトからダウンロード
# https://ngrok.com/download
# ダウンロード後、解凍して /usr/local/bin/ に移動
```

### 2. ngrokアカウントの作成と認証

1. https://dashboard.ngrok.com/signup で無料アカウントを作成
2. ダッシュボードから認証トークンを取得
3. ターミナルで認証:
```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

### 3. HTTPSトンネルの起動

開発サーバーが起動している状態で、別のターミナルで実行:

```bash
./setup-https-tunnel.sh
```

または直接:

```bash
ngrok http 3000
```

### 4. スマートフォンでアクセス

ngrokが表示するHTTPSのURL（例: `https://xxxx-xxxx.ngrok.io`）をスマートフォンのブラウザで開いてください。

---

## 方法2: Cloudflare Tunnelを使用（無料、アカウント不要）

### 1. cloudflaredのインストール

```bash
brew install cloudflared
```

### 2. トンネルの起動

開発サーバーが起動している状態で:

```bash
cloudflared tunnel --url http://localhost:3000
```

### 3. スマートフォンでアクセス

cloudflaredが表示するHTTPSのURL（例: `https://xxxx.trycloudflare.com`）をスマートフォンのブラウザで開いてください。

---

## 方法3: ローカルHTTPSサーバー（自己署名証明書）

この方法は複雑で、スマートフォンで証明書を信頼する必要があります。上記の方法を推奨します。

---

## トラブルシューティング

### カメラが動作しない場合

1. **HTTPS接続を確認**: URLが `https://` で始まっているか確認
2. **ブラウザの権限**: ブラウザの設定でカメラへのアクセスを許可
3. **同じネットワーク**: PCとスマートフォンが同じWi-Fiに接続されている必要はありません（HTTPSトンネルを使用しているため）

### ngrokが起動しない場合

- ngrokアカウントが作成されているか確認
- 認証トークンが正しく設定されているか確認: `ngrok config check`

### 開発サーバーが起動していない場合

別のターミナルで以下を実行:

```bash
cd /Users/heidegger/Receipt-title
npm run dev
```

---

## クイックスタート

1. 開発サーバーを起動:
   ```bash
   npm run dev
   ```

2. 別のターミナルでHTTPSトンネルを起動:
   ```bash
   ngrok http 3000
   # または
   ./setup-https-tunnel.sh
   ```

3. 表示されたHTTPSのURLをスマートフォンで開く

4. カメラボタンをタップしてカメラの権限を許可

以上です！
