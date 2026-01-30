# 自社サーバーでのデプロイ手順

このアプリを自社サーバーで公開する手順を説明します。

## 前提条件

- Node.js 18以上がインストールされたサーバー
- サーバーへのSSHアクセス権限
- ドメイン（オプション、推奨）
- SSL証明書（HTTPS必須）

## 1. サーバーの準備

### Node.jsのインストール確認

```bash
node --version  # v18以上であることを確認
npm --version
```

Node.jsがインストールされていない場合：

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# macOS (Homebrew)
brew install node@20
```

## 2. アプリケーションのデプロイ

### 方法A: Gitからクローン（推奨）

```bash
# サーバーにSSH接続
ssh user@your-server.com

# アプリケーション用のディレクトリを作成
sudo mkdir -p /var/www/receipt-title
sudo chown $USER:$USER /var/www/receipt-title
cd /var/www/receipt-title

# Gitリポジトリをクローン
git clone https://github.com/YOUR_USERNAME/receipt-title.git .

# 依存関係をインストール
npm install --production
```

### 方法B: ファイルを直接アップロード

```bash
# ローカルでビルド
npm run build

# サーバーにファイルをアップロード（rsync使用例）
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ user@your-server.com:/var/www/receipt-title/

# サーバーで依存関係をインストール
ssh user@your-server.com
cd /var/www/receipt-title
npm install --production
```

## 3. 環境変数の設定

```bash
# .env.production ファイルを作成
cd /var/www/receipt-title
nano .env.production
```

以下の内容を追加：

```env
GEMINI_API_KEY=your_gemini_api_key_here
NODE_ENV=production
PORT=3000
```

ファイルの権限を制限：

```bash
chmod 600 .env.production
```

## 4. ビルド

```bash
cd /var/www/receipt-title
npm run build
```

## 5. プロセス管理（PM2を使用）

### PM2のインストール

```bash
sudo npm install -g pm2
```

### アプリケーションの起動

```bash
cd /var/www/receipt-title

# PM2でアプリを起動
pm2 start npm --name "receipt-title" -- start

# 起動確認
pm2 status

# ログ確認
pm2 logs receipt-title

# 自動起動設定
pm2 save
pm2 startup
# 表示されたコマンドを実行（sudoが必要な場合あり）
```

### PM2の便利なコマンド

```bash
pm2 restart receipt-title    # 再起動
pm2 stop receipt-title        # 停止
pm2 delete receipt-title      # 削除
pm2 monit                     # モニタリング
```

## 6. Nginxの設定（リバースプロキシ）

### Nginxのインストール

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install nginx

# CentOS/RHEL
sudo yum install nginx
```

### Nginx設定ファイルの作成

```bash
sudo nano /etc/nginx/sites-available/receipt-title
```

以下の設定を追加：

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # リダイレクト（HTTPSにリダイレクトする場合）
    # return 301 https://$server_name$request_uri;

    # HTTPの場合（開発環境）
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # タイムアウト設定（大きな画像のアップロードに対応）
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # ファイルサイズ制限（大きな画像のアップロードに対応）
    client_max_body_size 10M;
}
```

### HTTPS設定（推奨）

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL証明書のパス（Let's Encrypt使用時）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL設定
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # タイムアウト設定
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # ファイルサイズ制限
    client_max_body_size 10M;
}

# HTTPからHTTPSにリダイレクト
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### 設定を有効化

```bash
# シンボリックリンクを作成（Ubuntu/Debian）
sudo ln -s /etc/nginx/sites-available/receipt-title /etc/nginx/sites-enabled/

# 設定をテスト
sudo nginx -t

# Nginxを再起動
sudo systemctl restart nginx
```

## 7. SSL証明書の設定（Let's Encrypt）

### Certbotのインストール

```bash
# Ubuntu/Debian
sudo apt-get install certbot python3-certbot-nginx

# CentOS/RHEL
sudo yum install certbot python3-certbot-nginx
```

### SSL証明書の取得

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

証明書の自動更新を設定（既に自動設定されている場合が多い）：

```bash
sudo certbot renew --dry-run
```

## 8. ファイアウォール設定

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 9. システムサービスとして設定（systemd）

PM2の代わりにsystemdを使用する場合：

```bash
sudo nano /etc/systemd/system/receipt-title.service
```

以下の内容を追加：

```ini
[Unit]
Description=Receipt Title Next.js App
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/var/www/receipt-title
Environment="NODE_ENV=production"
Environment="PORT=3000"
EnvironmentFile=/var/www/receipt-title/.env.production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

サービスを有効化：

```bash
sudo systemctl daemon-reload
sudo systemctl enable receipt-title
sudo systemctl start receipt-title
sudo systemctl status receipt-title
```

## 10. ログの確認

### PM2の場合

```bash
pm2 logs receipt-title
pm2 logs receipt-title --lines 100  # 最新100行
```

### systemdの場合

```bash
sudo journalctl -u receipt-title -f
sudo journalctl -u receipt-title --since "1 hour ago"
```

### Nginxのログ

```bash
# アクセスログ
sudo tail -f /var/log/nginx/access.log

# エラーログ
sudo tail -f /var/log/nginx/error.log
```

## 11. パフォーマンス最適化

### Node.jsのメモリ制限

PM2の場合、`ecosystem.config.js`を作成：

```bash
cd /var/www/receipt-title
nano ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'receipt-title',
    script: 'npm',
    args: 'start',
    instances: 1,
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

起動：

```bash
pm2 start ecosystem.config.js
pm2 save
```

## 12. セキュリティ設定

### ファイル権限の設定

```bash
cd /var/www/receipt-title

# 所有者のみ書き込み可能
chmod 755 /var/www/receipt-title
chmod 600 .env.production

# node_modulesは読み取り専用
chmod -R 755 node_modules
```

### 定期的な更新

```bash
# アプリケーションの更新スクリプトを作成
nano /var/www/receipt-title/update.sh
```

```bash
#!/bin/bash
cd /var/www/receipt-title
git pull
npm install --production
npm run build
pm2 restart receipt-title
```

実行権限を付与：

```bash
chmod +x /var/www/receipt-title/update.sh
```

## 13. バックアップ

### データベース（IndexedDB）のバックアップ

IndexedDBはブラウザ側に保存されるため、サーバー側でのバックアップは不要です。

### アプリケーションコードのバックアップ

```bash
# バックアップスクリプト
nano /var/www/backup-receipt-title.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/receipt-title"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/receipt-title-$DATE.tar.gz \
  -C /var/www receipt-title \
  --exclude='node_modules' \
  --exclude='.next'

# 古いバックアップを削除（30日以上）
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

## 14. トラブルシューティング

### アプリが起動しない

```bash
# ログを確認
pm2 logs receipt-title

# ポートが使用中か確認
sudo netstat -tlnp | grep 3000

# 環境変数を確認
cat .env.production
```

### Nginxのエラー

```bash
# 設定をテスト
sudo nginx -t

# エラーログを確認
sudo tail -f /var/log/nginx/error.log
```

### メモリ不足

```bash
# メモリ使用量を確認
free -h
pm2 monit

# Node.jsのメモリ制限を設定（ecosystem.config.js参照）
```

## 15. 監視とメンテナンス

### ヘルスチェックエンドポイントの追加（オプション）

`src/app/api/health/route.ts`を作成：

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
}
```

Nginxでヘルスチェック：

```nginx
location /api/health {
    proxy_pass http://localhost:3000/api/health;
    access_log off;
}
```

## チェックリスト

- [ ] Node.js 18以上がインストールされている
- [ ] アプリケーションがサーバーにデプロイされている
- [ ] `.env.production`に`GEMINI_API_KEY`が設定されている
- [ ] `npm run build`が成功している
- [ ] PM2またはsystemdでアプリが起動している
- [ ] Nginxが設定され、リバースプロキシが動作している
- [ ] SSL証明書が設定されている（HTTPS）
- [ ] ファイアウォールが適切に設定されている
- [ ] ログが確認できる
- [ ] バックアップスクリプトが設定されている

## 参考リンク

- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt](https://letsencrypt.org/)
