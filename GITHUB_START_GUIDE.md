# GitHub完全初心者ガイド

GitHubを使ったことがない方向けの、ゼロから始めるガイドです。

## 📚 目次

1. GitHubアカウントの作成
2. GitHub Desktopのインストール（簡単）
3. コードをGitHubにアップロード
4. Vercelで公開

---

## ステップ1: GitHubアカウントの作成

### 1-1. GitHubにアクセス

1. ブラウザで https://github.com を開く
2. 右上の「Sign up」をクリック

### 1-2. アカウント情報を入力

- **Username**: 好きなユーザー名（例: `yourname`）
- **Email**: メールアドレス
- **Password**: パスワード（8文字以上）

### 1-3. メール認証

- メールボックスを確認
- GitHubからのメールを開く
- 「Verify email address」をクリック

**これでGitHubアカウントの準備完了！**

---

## ステップ2: GitHub Desktopのインストール（簡単な方法）

コマンドラインが苦手な方は、GitHub Desktopを使うと簡単です。

### 2-1. GitHub Desktopをダウンロード

1. https://desktop.github.com にアクセス
2. 「Download for macOS」または「Download for Windows」をクリック
3. ダウンロードしたファイルを実行してインストール

### 2-2. GitHub Desktopにログイン

1. GitHub Desktopを起動
2. 「Sign in to GitHub.com」をクリック
3. 作成したGitHubアカウントでログイン

---

## ステップ3: コードをGitHubにアップロード

### 方法A: GitHub Desktopを使う（推奨・簡単）

#### 3-1. GitHubでリポジトリを作成

1. https://github.com にアクセスしてログイン
2. 右上の「+」→「New repository」をクリック
3. 以下の情報を入力：
   - **Repository name**: `receipt-title`（好きな名前でOK）
   - **Description**: 「レシート管理アプリ」（任意）
   - **Public** または **Private** を選択
   - **Initialize this repository with a README** は**チェックしない**
4. 「Create repository」をクリック

#### 3-2. GitHub Desktopでリポジトリをクローン

1. GitHub Desktopを開く
2. 「File」→「Clone Repository」をクリック
3. 「URL」タブを選択
4. GitHubで作成したリポジトリのURLを入力：
   ```
   https://github.com/YOUR_USERNAME/receipt-title.git
   ```
   （YOUR_USERNAMEはあなたのGitHubユーザー名）
5. 「Local path」で保存場所を選択（例: `/Users/yourname/Documents/receipt-title`）
6. 「Clone」をクリック

#### 3-3. ファイルをコピー

1. 現在のプロジェクトフォルダ（`/Users/heidegger/Receipt-title`）を開く
2. すべてのファイルを選択（`node_modules`フォルダは除く）
3. クローンしたフォルダにコピー

#### 3-4. GitHubにアップロード

1. GitHub Desktopに戻る
2. 左側に変更されたファイルのリストが表示されます
3. 左下の「Summary」に「Initial commit」と入力
4. 「Commit to main」をクリック
5. 「Push origin」をクリック

**これでGitHubにアップロード完了！**

---

### 方法B: コマンドラインを使う（上級者向け）

ターミナル（コマンドライン）に慣れている方はこちら：

```bash
# 1. プロジェクトフォルダに移動
cd /Users/heidegger/Receipt-title

# 2. Gitを初期化
git init

# 3. すべてのファイルを追加
git add .

# 4. コミット（変更を記録）
git commit -m "Initial commit"

# 5. GitHubでリポジトリを作成してから、以下を実行
git remote add origin https://github.com/YOUR_USERNAME/receipt-title.git
git branch -M main
git push -u origin main
```

---

## ステップ4: Vercelで公開（超簡単）

### 4-1. Vercelに登録

1. https://vercel.com にアクセス
2. 「Sign Up」をクリック
3. 「Continue with GitHub」をクリック
4. GitHubアカウントで認証

### 4-2. プロジェクトをインポート

1. Vercelダッシュボードで「Add New...」→「Project」をクリック
2. GitHubリポジトリのリストから「receipt-title」を選択
3. 「Import」をクリック

### 4-3. 環境変数を設定

1. 「Environment Variables」セクションを開く
2. 「Add New」をクリック
3. 以下を入力：
   - **Name**: `GEMINI_API_KEY`
   - **Value**: あなたのGemini APIキー
   - **Environment**: Production, Preview, Development すべてにチェック
4. 「Add」をクリック

### 4-4. デプロイ

1. 「Deploy」ボタンをクリック
2. 2-3分待つ
3. 「Congratulations!」と表示されたら完了！

**URLが表示されます（例: `https://receipt-title.vercel.app`）**

---

## 🎉 完了！

これでアプリが公開されました！

### 今後の更新方法

コードを変更したら：

1. GitHub Desktopで変更を確認
2. 「Commit to main」をクリック
3. 「Push origin」をクリック
4. Vercelが自動で再デプロイ（数分で完了）

---

## ❓ よくある質問

### Q: GitHub Desktopが見つからない
A: https://desktop.github.com からダウンロードしてください

### Q: リポジトリのURLがわからない
A: GitHubのリポジトリページで、緑色の「Code」ボタンをクリックすると表示されます

### Q: ファイルを間違えてアップロードした
A: GitHub Desktopでファイルを削除して、再度「Commit」→「Push」してください

### Q: Vercelでエラーが出る
A: 環境変数（`GEMINI_API_KEY`）が正しく設定されているか確認してください

---

## 📞 困ったときは

- GitHub Desktopのヘルプ: https://docs.github.com/ja/desktop
- Vercelのヘルプ: https://vercel.com/docs
- このガイドで分からないことがあれば、お知らせください！
