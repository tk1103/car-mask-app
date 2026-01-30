#!/bin/bash

# デプロイスクリプト
# 使用方法: ./deploy.sh

set -e  # エラーが発生したら停止

echo "=========================================="
echo "Receipt Title デプロイスクリプト"
echo "=========================================="

# カレントディレクトリを取得
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 環境変数の確認
if [ ! -f .env.production ]; then
    echo "⚠️  .env.production ファイルが見つかりません"
    echo "環境変数を設定してください:"
    echo "  GEMINI_API_KEY=your_api_key_here"
    echo "  NODE_ENV=production"
    echo "  PORT=3000"
    exit 1
fi

echo "✓ 環境変数ファイルを確認"

# Gitから最新のコードを取得（Gitリポジトリの場合）
if [ -d .git ]; then
    echo "Gitから最新のコードを取得中..."
    git pull || echo "⚠️  git pullに失敗しました（続行します）"
fi

# 依存関係のインストール
echo "依存関係をインストール中..."
npm install --production

# ビルド
echo "アプリケーションをビルド中..."
npm run build

# PM2で再起動
if command -v pm2 &> /dev/null; then
    echo "PM2でアプリケーションを再起動中..."
    pm2 restart receipt-title || pm2 start ecosystem.config.js
    pm2 save
    echo "✓ PM2で再起動完了"
else
    echo "⚠️  PM2がインストールされていません"
    echo "アプリケーションを手動で再起動してください:"
    echo "  npm start"
fi

echo ""
echo "=========================================="
echo "デプロイが完了しました！"
echo "=========================================="
echo ""
echo "アプリケーションの状態を確認:"
echo "  pm2 status"
echo ""
echo "ログを確認:"
echo "  pm2 logs receipt-title"
echo ""
