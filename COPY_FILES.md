# ファイルをコピーする手順

GitHub Desktopでリポジトリのクローンが完了しました！次は既存のプロジェクトファイルをコピーします。

---

## 📋 ステップ1: フォルダを開く

### 方法A: GitHub Desktopから開く（簡単）

1. **GitHub Desktopの画面で「Show in Finder」ボタンをクリック**
   - 画面右側の「View the files of your repository in Finder」セクションにあります
   - または、メニューから「Repository」→「Show in Finder」

2. **Finderが開きます**
   - フォルダの場所: `/Users/heidegger/Documents/omakase-receipt`
   - このフォルダは今は空（またはREADMEだけ）のはずです

---

## 📋 ステップ2: 既存のプロジェクトファイルをコピー

### 1. 既存のプロジェクトフォルダを開く

1. **Finderで `/Users/heidegger/Receipt-title` フォルダを開く**
   - このフォルダにあなたのプロジェクトファイルがあります

### 2. ファイルを選択

以下のファイルとフォルダを**すべて選択**：

- ✅ `src` フォルダ
- ✅ `public` フォルダ
- ✅ `package.json`
- ✅ `package-lock.json`
- ✅ `next.config.ts`
- ✅ `tsconfig.json`
- ✅ `postcss.config.mjs`
- ✅ `eslint.config.mjs`
- ✅ `.gitignore`
- ✅ その他の設定ファイル（`.md`ファイルなど）

⚠️ **`node_modules`フォルダは選択しない**（大きすぎるため、GitHubにアップロードする必要はありません）

### 3. コピー

- 選択したファイルをコピー（コマンド + C）

### 4. 貼り付け

1. **GitHub Desktopで開いたフォルダ（`omakase-receipt`）に戻る**
2. **貼り付け**（コマンド + V）

---

## 📋 ステップ3: GitHub Desktopで確認

1. **GitHub Desktopに戻る**
2. **左側の「Changes」タブを確認**
   - コピーしたファイルのリストが表示されるはずです
   - 「0 changed files」が「XX changed files」に変わります

---

## 📋 ステップ4: コミット＆プッシュ

### 1. コミット

1. **左下の「Summary」欄に以下を入力**：
   ```
   Initial commit
   ```

2. **「Description」欄は空欄でOK**（または説明を追加）

3. **「Commit to main」ボタンをクリック**

### 2. プッシュ

1. **画面上部の「Publish branch」ボタンをクリック**
   - または、「Push origin」ボタンが表示されたらそれをクリック

2. **数秒でアップロード完了！**

---

## 🎯 手順のまとめ

1. ✅ GitHub Desktopで「Show in Finder」をクリック
2. ✅ 既存のプロジェクトフォルダ（`Receipt-title`）を開く
3. ✅ ファイルを選択してコピー（`node_modules`は除く）
4. ✅ クローンしたフォルダ（`omakase-receipt`）に貼り付け
5. ✅ GitHub Desktopで「Commit to main」をクリック
6. ✅ 「Publish branch」または「Push origin」をクリック

---

## ❓ よくある質問

### Q: どのファイルをコピーすればいい？
A: `node_modules`フォルダ以外のすべてのファイルとフォルダです。主に：
- `src`フォルダ
- `public`フォルダ
- `package.json`などの設定ファイル

### Q: 「Changes」タブに何も表示されない
A: ファイルが正しくコピーされたか確認してください。GitHub Desktopを再読み込み（コマンド + R）してみてください。

### Q: エラーが出る
A: 
- ファイルが正しくコピーされたか確認
- GitHub Desktopを再起動してみる
- インターネット接続を確認

---

## 🎉 完了したら

ファイルのアップロードが完了したら、次のステップ（Vercelで公開）に進みます！
