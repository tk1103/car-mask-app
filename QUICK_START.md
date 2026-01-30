# 🚀 5分で公開！超簡単ガイド

GitHubもVercelも使ったことがない方向けの、最短手順です。

## 必要なもの

- インターネット接続
- メールアドレス
- Gemini APIキー（https://makersuite.google.com/app/apikey で取得）

---

## ステップ1: GitHubアカウント作成（2分）

1. https://github.com を開く
2. 「Sign up」をクリック
3. ユーザー名、メール、パスワードを入力
4. メール認証を完了

**✅ 完了！**

---

## ステップ2: GitHub Desktopをインストール（1分）

1. https://desktop.github.com を開く
2. 「Download」をクリック
3. ダウンロードしたファイルを実行してインストール
4. GitHub Desktopを起動して、GitHubアカウントでログイン

**✅ 完了！**

---

## ステップ3: リポジトリを作成（1分）

1. https://github.com にアクセスしてログイン
2. 右上の「+」→「New repository」
3. リポジトリ名: `receipt-title`
4. 「Create repository」をクリック

**✅ 完了！**

---

## ステップ4: コードをアップロード（2分）

### GitHub Desktopで：

1. 「File」→「Clone Repository」
2. 「URL」タブを選択
3. リポジトリのURLを貼り付け（GitHubのページに表示されています）
4. 「Clone」をクリック
5. プロジェクトフォルダのファイルを、クローンしたフォルダにコピー（`node_modules`は除く）
6. GitHub Desktopで「Commit to main」→「Push origin」

**✅ 完了！**

---

## ステップ5: Vercelで公開（2分）

1. https://vercel.com にアクセス
2. 「Sign Up」→「Continue with GitHub」
3. 「Add New...」→「Project」
4. 「receipt-title」を選択→「Import」
5. 「Environment Variables」で `GEMINI_API_KEY` を追加
6. 「Deploy」をクリック

**✅ 完了！**

---

## 🎉 おめでとうございます！

数分でアプリが公開されました！

表示されたURL（例: `https://receipt-title.vercel.app`）にアクセスして確認してください。

---

## 📝 詳細が必要な場合

詳しい手順は `GITHUB_START_GUIDE.md` を参照してください。
