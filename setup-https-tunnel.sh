#!/bin/bash

# HTTPSトンネルセットアップスクリプト
# スマートフォンでカメラ機能をテストするためのHTTPSトンネルを作成します

echo "=========================================="
echo "HTTPSトンネルセットアップ"
echo "=========================================="
echo ""

# ngrokのインストール確認
if ! command -v ngrok &> /dev/null; then
    echo "ngrokがインストールされていません。"
    echo ""
    echo "インストール方法:"
    echo "1. https://ngrok.com/download にアクセス"
    echo "2. macOS用のファイルをダウンロード"
    echo "3. ダウンロードしたファイルを解凍"
    echo "4. ターミナルで以下を実行:"
    echo "   sudo mv ngrok /usr/local/bin/"
    echo "   sudo chmod +x /usr/local/bin/ngrok"
    echo ""
    echo "または、Homebrewでインストール:"
    echo "   brew install ngrok/ngrok/ngrok"
    echo ""
    echo "ngrokアカウントが必要です（無料）:"
    echo "https://dashboard.ngrok.com/signup"
    echo ""
    echo "アカウント作成後、認証トークンを設定:"
    echo "   ngrok config add-authtoken YOUR_TOKEN"
    echo ""
    exit 1
fi

echo "✓ ngrokが見つかりました"
echo ""

# 開発サーバーが起動しているか確認
if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  ポート3000で開発サーバーが起動していません"
    echo "   別のターミナルで 'npm run dev' を実行してください"
    echo ""
    read -p "開発サーバーを今起動しますか？ (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "開発サーバーを起動中..."
        npm run dev &
        sleep 5
    else
        exit 1
    fi
fi

echo "✓ 開発サーバーが起動しています"
echo ""
echo "=========================================="
echo "HTTPSトンネルを起動します"
echo "=========================================="
echo ""
echo "以下のURLが表示されたら、それをスマートフォンで開いてください"
echo ""
echo "⚠️  このターミナルは開いたままにしてください"
echo "   終了する場合は Ctrl+C を押してください"
echo ""

# ngrokを起動
ngrok http 3000
