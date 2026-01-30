# 最も簡単な公開方法

自社サーバーでの設定が難しい場合は、以下の方法がおすすめです。

## 🚀 方法1: Vercel（最も簡単・推奨）

**所要時間: 約10分**

### 手順

1. **GitHubにコードをアップロード**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   # GitHubでリポジトリを作成してから
   git remote add origin https://github.com/YOUR_USERNAME/receipt-title.git
   git push -u origin main
   ```

2. **Vercelに登録**
   - https://vercel.com にアクセス
   - 「Sign Up」→ GitHubアカウントでログイン

3. **プロジェクトをインポート**
   - 「Add New...」→「Project」
   - GitHubリポジトリを選択
   - 「Import」をクリック

4. **環境変数を設定**
   - 「Settings」→「Environment Variables」
   - `GEMINI_API_KEY` を追加（値はあなたのAPIキー）

5. **デプロイ**
   - 「Deploy」をクリック
   - 数分で完了！

**これだけで完了です！** HTTPSも自動で設定されます。

---

## 🐳 方法2: Docker（自社サーバーで簡単に）

Dockerを使えば、サーバー設定が簡単になります。

### 必要なもの
- Dockerがインストールされたサーバー

### 手順

1. **Dockerfileを作成**（既に作成済み）
2. **docker-compose.ymlを作成**
3. **起動**
   ```bash
   docker-compose up -d
   ```

詳細は後述の「Dockerを使った簡単デプロイ」セクションを参照してください。

---

## 📋 方法3: 簡単な自社サーバー設定（最小限）

複雑な設定を避けて、最小限の手順で公開する方法です。

### 必要なもの
- Node.jsがインストールされたサーバー
- ドメイン（オプション）

### 手順

1. **サーバーにファイルをアップロード**
   - FTPやSCPでファイルをアップロード
   - またはGitからクローン

2. **環境変数を設定**
   ```bash
   export GEMINI_API_KEY=your_api_key_here
   export NODE_ENV=production
   ```

3. **ビルドと起動**
   ```bash
   npm install --production
   npm run build
   npm start
   ```

4. **ポート3000でアクセス**
   - `http://your-server-ip:3000`

**注意**: この方法ではHTTPSが設定されていないため、カメラ機能が動作しない可能性があります。

---

## 💡 推奨: Vercelを使う理由

✅ **無料で始められる**（個人利用）  
✅ **HTTPS自動設定**（カメラ機能に必須）  
✅ **自動デプロイ**（GitHubにプッシュするだけで更新）  
✅ **設定が簡単**（10分で完了）  
✅ **スケーラブル**（トラフィック増加に対応）  
✅ **CDN配信**（高速）  

---

## 🤔 どれを選ぶべき？

- **すぐに公開したい** → Vercel
- **自社サーバーを使いたい** → Docker
- **最小限の設定で** → 簡単な自社サーバー設定

---

## 📞 サポートが必要な場合

どの方法を選んでも、設定で困ったらお知らせください。
ステップバイステップでサポートします！
