#!/bin/bash

cd "$(dirname "$0")"

# 既存のトンネルを停止
pkill -f cloudflared 2>/dev/null
sleep 1

# 開発サーバーの確認
if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  開発サーバーが起動していません"
    echo "   別のターミナルで 'npm run dev' を実行してください"
    exit 1
fi

echo "=========================================="
echo "HTTPSトンネルを起動します"
echo "=========================================="
echo ""
echo "以下のHTTPSのURLが表示されたら、"
echo "それをスマートフォンのブラウザで開いてください"
echo ""
echo "⚠️  このターミナルは開いたままにしてください"
echo "   終了する場合は Ctrl+C を押してください"
echo ""
echo "=========================================="
echo ""

# cloudflaredの確認
CLOUDFLARED_CMD=""
if [ -f "./cloudflared" ]; then
    CLOUDFLARED_CMD="./cloudflared"
elif command -v cloudflared &> /dev/null; then
    CLOUDFLARED_CMD="cloudflared"
else
    echo "⚠️  cloudflaredが見つかりません"
    exit 1
fi

# HTTPSトンネルを起動
$CLOUDFLARED_CMD tunnel --url http://localhost:3000
