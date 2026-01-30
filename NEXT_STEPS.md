# 🎉 2FA設定完了！次のステップ

2要素認証の設定が完了しました。次はリポジトリを作成してコードをアップロードします。

## 現在の状況

✅ GitHubアカウント作成完了  
✅ 2FA設定完了  
⬜ リポジトリ作成  
⬜ コードをアップロード  
⬜ Vercelで公開  

---

## ステップ3: リポジトリを作成（1分）

### 手順

1. 画面の下部にある「**Return to your work**」ボタンをクリック
   （または、GitHubのトップページに戻る）

2. 右上の「**+**」ボタンをクリック
   - 「**New repository**」を選択

3. リポジトリの情報を入力：
   - **Repository name**: `receipt-title`
     （好きな名前でOK、例: `my-receipt-app`）
   
   - **Description**: 「レシート管理アプリ」（任意、空欄でもOK）
   
   - **Public** または **Private** を選択
     - Public: 誰でもコードを見られる
     - Private: あなただけが見られる（推奨）
   
   - ⚠️ **重要**: 「Add a README file」は**チェックしない**
   - ⚠️ **重要**: 「Add .gitignore」も**チェックしない**
   - ⚠️ **重要**: 「Choose a license」も**選択しない**

4. 「**Create repository**」ボタンをクリック

**✅ リポジトリ作成完了！**

---

## ステップ4: GitHub Desktopをインストール（まだの場合）

### インストール

1. https://desktop.github.com にアクセス
2. 「Download for macOS」または「Download for Windows」をクリック
3. ダウンロードしたファイルを実行してインストール
4. GitHub Desktopを起動
5. GitHubアカウントでログイン（2FAのコードが必要です）

**✅ GitHub Desktop準備完了！**

---

## ステップ5: コードをアップロード（2分）

### 手順

1. **GitHub Desktopでリポジトリをクローン**
   - GitHub Desktopを開く
   - 「File」→「Clone Repository」をクリック
   - 「URL」タブを選択
   - リポジトリのURLを貼り付け：
     ```
     https://github.com/YOUR_USERNAME/receipt-title.git
     ```
     （YOUR_USERNAMEはあなたのGitHubユーザー名、例: `tk1103`）
   - 「Local path」で保存場所を選択（例: `/Users/yourname/Documents/receipt-title`）
   - 「Clone」をクリック

2. **プロジェクトのファイルをコピー**
   - Finder（Mac）またはエクスプローラー（Windows）で、現在のプロジェクトフォルダを開く
     - 場所: `/Users/heidegger/Receipt-title`
   - 以下のファイルとフォルダを**すべて選択**：
     - `src` フォルダ
     - `public` フォルダ
     - `package.json`
     - `package-lock.json`
     - `next.config.ts`
     - `tsconfig.json`
     - `postcss.config.mjs`
     - `eslint.config.mjs`
     - `.gitignore`
     - その他の設定ファイル
   - ⚠️ **`node_modules`フォルダは選択しない**（大きすぎるため）
   - 選択したファイルを、GitHub Desktopでクローンしたフォルダにコピー

3. **GitHubにアップロード**
   - GitHub Desktopに戻る
   - 左側に変更されたファイルのリストが表示されます
   - 左下の「Summary」欄に「Initial commit」と入力
   - 「Commit to main」ボタンをクリック
   - 「Push origin」ボタンをクリック

**✅ コードのアップロード完了！**

---

## ステップ6: Vercelで公開（2分）

1. **Vercelにアクセス**
   - https://vercel.com にアクセス
   - 「Sign Up」をクリック
   - 「Continue with GitHub」をクリック
   - GitHubアカウントで認証（2FAのコードが必要）

2. **プロジェクトをインポート**
   - 「Add New...」→「Project」をクリック
   - GitHubリポジトリのリストから「receipt-title」を選択
   - 「Import」をクリック

3. **環境変数を設定**
   - 「Environment Variables」セクションを開く
   - 「Add New」をクリック
   - 以下を入力：
     - **Name**: `GEMINI_API_KEY`
     - **Value**: あなたのGemini APIキー
       （https://makersuite.google.com/app/apikey で取得）
     - **Environment**: Production, Preview, Development すべてにチェック
   - 「Add」をクリック

4. **デプロイ**
   - 「Deploy」ボタンをクリック
   - 2-3分待つ
   - 「Congratulations!」と表示されたら完了！

**✅ アプリ公開完了！**

---

## 🎉 完了！

表示されたURL（例: `https://receipt-title.vercel.app`）にアクセスして、アプリが動作することを確認してください。

---

## ❓ 困ったとき

### GitHub Desktopでファイルが表示されない
- ファイルをコピーしたフォルダが正しいか確認
- GitHub Desktopで「Repository」→「Show in Finder」（Mac）または「Show in Explorer」（Windows）でフォルダを確認

### プッシュできない
- GitHubにログインしているか確認
- インターネット接続を確認

### Vercelでエラーが出る
- 環境変数（`GEMINI_API_KEY`）が正しく設定されているか確認
- ビルドログを確認（「Deployments」→「View Function Logs」）

---

## 📞 サポート

どのステップで困っても、お知らせください！
具体的な画面の見え方やエラーメッセージを教えていただければ、詳しくサポートします。
