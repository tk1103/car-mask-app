# Dockerを使った簡単デプロイ

Dockerを使えば、サーバー設定が簡単になります。

## 前提条件

- DockerとDocker Composeがインストールされたサーバー

## 1. Dockerのインストール

### Ubuntu/Debian
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### CentOS/RHEL
```bash
sudo yum install -y docker docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```

## 2. アプリケーションの準備

```bash
# サーバーにSSH接続
ssh user@your-server.com

# アプリケーション用ディレクトリを作成
mkdir -p ~/receipt-title
cd ~/receipt-title

# Gitからクローン（またはファイルをアップロード）
git clone https://github.com/YOUR_USERNAME/receipt-title.git .
```

## 3. 環境変数の設定

```bash
# .env ファイルを作成
nano .env
```

以下の内容を追加：
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

## 4. Docker Composeで起動

```bash
# ビルドと起動
docker-compose up -d

# ログ確認
docker-compose logs -f

# 状態確認
docker-compose ps
```

## 5. Nginxでリバースプロキシ設定（オプション）

`nginx.conf.example`を参考にNginxを設定してください。

## 便利なコマンド

```bash
# 停止
docker-compose stop

# 再起動
docker-compose restart

# 停止して削除
docker-compose down

# ログ確認
docker-compose logs -f receipt-title

# 更新（コードを更新した後）
git pull
docker-compose up -d --build
```

## トラブルシューティング

### ポートが既に使用されている
```bash
# ポート3000を使用しているプロセスを確認
sudo lsof -i :3000

# docker-compose.ymlのポート番号を変更
# ports:
#   - "3001:3000"  # 3001ポートでアクセス
```

### ビルドエラー
```bash
# ログを確認
docker-compose logs

# キャッシュなしで再ビルド
docker-compose build --no-cache
```
