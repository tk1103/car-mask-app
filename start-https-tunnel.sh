#!/bin/bash

# Cloudflare Tunnelを使用したHTTPSトンネル起動スクリプト
# アカウント登録不要で、すぐに使えます

echo "=========================================="
echo "HTTPSトンネル起動（Cloudflare Tunnel）"
echo "=========================================="
echo ""

# cloudflaredの確認（プロジェクトディレクトリ内のcloudflaredを優先）
CLOUDFLARED_CMD=""
if [ -f "./cloudflared" ]; then
    CLOUDFLARED_CMD="./cloudflared"
elif command -v cloudflared &> /dev/null; then
    CLOUDFLARED_CMD="cloudflared"
else
    echo "⚠️  cloudflaredがインストールされていません"
    echo ""
    echo "インストール方法:"
    echo ""
    echo "方法1: Homebrew（推奨）"
    echo "  brew install cloudflared"
    echo ""
    echo "方法2: 公式サイトからダウンロード"
    echo "  1. https://github.com/cloudflare/cloudflared/releases にアクセス"
    echo "  2. macOS用のファイル（cloudflared-darwin-amd64.tgz）をダウンロード"
    echo "  3. 解凍して、cloudflaredを /usr/local/bin/ に移動"
    echo "     tar -xzf cloudflared-darwin-amd64.tgz"
    echo "     sudo mv cloudflared /usr/local/bin/"
    echo "     sudo chmod +x /usr/local/bin/cloudflared"
    echo ""
    exit 1
fi

# 開発サーバーが起動しているか確認
if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  ポート3000で開発サーバーが起動していません"
    echo ""
    echo "別のターミナルで以下を実行してください:"
    echo "  cd /Users/heidegger/Receipt-title"
    echo "  npm run dev"
    echo ""
    echo "開発サーバーが起動したら、このスクリプトを再度実行してください。"
    echo ""
    exit 1
fi

echo "✓ 開発サーバーが起動しています（ポート3000）"
echo ""
echo "=========================================="
echo "HTTPSトンネルを起動します"
echo "=========================================="
echo ""
echo "以下のようなHTTPSのURLが表示されます:"
echo "  https://xxxx-xxxx.trycloudflare.com"
echo ""
echo "⚠️  このURLをスマートフォンのブラウザで開いてください"
echo "⚠️  このターミナルは開いたままにしてください"
echo "   終了する場合は Ctrl+C を押してください"
echo ""
echo "=========================================="
echo ""

# Cloudflare Tunnelを起動
$CLOUDFLARED_CMD tunnel --url http://localhost:3000
