# GitHub Desktopでのクローン手順

GitHubリポジトリ: `https://github.com/tk1103/omakase-receipt`  
ローカルフォルダ: `/Users/heidegger/Receipt-title`

リポジトリ名とローカルフォルダ名が違っても問題ありません！

---

## 📋 GitHub Desktopでの入力方法

### ステップ1: URLを入力

GitHub Desktopの「Clone a Repository」画面で：

1. **「URL」タブが選択されていることを確認**
   - 画面上部のタブで「URL」が青く表示されているはずです

2. **「Repository URL or GitHub username and repository」の下の入力欄に以下を入力**：
   ```
   https://github.com/tk1103/omakase-receipt.git
   ```
   ⚠️ **重要**: 最後に`.git`を付けます

---

### ステップ2: ローカルパスを設定

1. **「Local Path」の右側にある「Choose...」ボタンをクリック**
   - Finderが開きます

2. **以下のいずれかを選択**：

   **オプションA: 既存のフォルダを使う（推奨）**
   - Finderで `/Users/heidegger/Receipt-title` フォルダを選択
   - 「選択」をクリック
   - ⚠️ **注意**: このフォルダが空でない場合、エラーが出る可能性があります

   **オプションB: 新しいフォルダを作成**
   - Finderで `/Users/heidegger/Documents` フォルダを開く
   - 新しいフォルダ「omakase-receipt」を作成（または別の名前でもOK）
   - そのフォルダを選択
   - 「選択」をクリック

   **オプションC: 直接入力**
   - 「Local Path」の入力欄に直接以下を入力：
     ```
     /Users/heidegger/Documents/omakase-receipt
     ```

---

### ステップ3: クローン実行

1. **「Clone」ボタンをクリック**
2. 数秒でクローンが完了します

---

## 🎯 推奨される方法

既存のプロジェクトフォルダ（`/Users/heidegger/Receipt-title`）がある場合：

### 方法1: 既存フォルダをGitリポジトリとして初期化（推奨）

GitHub Desktopを使わず、コマンドラインで：

```bash
# プロジェクトフォルダに移動
cd /Users/heidegger/Receipt-title

# Gitを初期化
git init

# リモートリポジトリを追加
git remote add origin https://github.com/tk1103/omakase-receipt.git

# ファイルを追加
git add .

# コミット
git commit -m "Initial commit"

# GitHubにプッシュ
git push -u origin main
```

### 方法2: 新しいフォルダにクローンしてからファイルをコピー

1. **GitHub Desktopで新しいフォルダにクローン**
   - Local Path: `/Users/heidegger/Documents/omakase-receipt`

2. **既存のプロジェクトファイルをコピー**
   - `/Users/heidegger/Receipt-title` のファイルを
   - `/Users/heidegger/Documents/omakase-receipt` にコピー
   - （`node_modules`フォルダは除く）

3. **GitHub Desktopでコミット＆プッシュ**

---

## 📝 入力例

### GitHub Desktopの画面で：

**入力欄1（Repository URL）**:
```
https://github.com/tk1103/omakase-receipt.git
```

**入力欄2（Local Path）**:
```
/Users/heidegger/Documents/omakase-receipt
```
または
```
/Users/heidegger/Receipt-title
```
（既存フォルダを使う場合、空でないとエラーが出る可能性があります）

---

## ❓ よくある質問

### Q: 既存のフォルダを使いたい
A: フォルダが空でない場合、GitHub Desktopではクローンできません。方法1（コマンドライン）を使うか、新しいフォルダにクローンしてからファイルをコピーしてください。

### Q: フォルダ名を変えたい
A: ローカルのフォルダ名は自由に変更できます。GitHubのリポジトリ名とは関係ありません。

### Q: エラーが出る
A: 
- URLが正しいか確認（`.git`が最後についているか）
- フォルダが空か確認（空でない場合は新しいフォルダを使う）
- 書き込み権限があるか確認

---

## 🎯 最も簡単な方法

1. **GitHub Desktopで新しいフォルダにクローン**
   - URL: `https://github.com/tk1103/omakase-receipt.git`
   - Local Path: `/Users/heidegger/Documents/omakase-receipt`

2. **既存のプロジェクトファイルをコピー**
   - `/Users/heidegger/Receipt-title` のファイルを
   - `/Users/heidegger/Documents/omakase-receipt` にコピー

3. **GitHub Desktopでコミット＆プッシュ**

これが一番簡単です！
