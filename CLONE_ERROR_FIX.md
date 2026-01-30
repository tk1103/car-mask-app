# GitHub Desktop クローンエラーの解決方法

「Permission denied」エラーが表示されています。これは、選択した保存場所に書き込み権限がないためです。

## 🔧 解決方法

### 方法1: 別の場所を選択（最も簡単・推奨）

1. **エラー画面で「Cancel」をクリック**

2. **再度クローンを試みる**
   - 「File」→「Clone Repository」
   - 「URL」タブを選択
   - リポジトリのURLを貼り付け

3. **「Local path」を変更**
   - デフォルトの `/Users/kant/Documents/GitHub/` ではなく
   - **より簡単な場所を選択**：
     - `/Users/kant/Documents/receipt-title`
     - `/Users/kant/receipt-title`
     - `/Users/kant/Desktop/receipt-title`
   
   ⚠️ **重要**: `GitHub`フォルダではなく、直接`Documents`や`Desktop`に保存することをおすすめします

4. **「Clone」をクリック**

---

### 方法2: フォルダの権限を修正（上級者向け）

ターミナルで以下のコマンドを実行：

```bash
# GitHubフォルダの権限を確認
ls -la /Users/kant/Documents/GitHub

# 権限を修正（書き込み可能にする）
chmod 755 /Users/kant/Documents/GitHub
```

---

## 📝 推奨される保存場所

以下の場所なら、通常は権限エラーが発生しません：

- `/Users/kant/Documents/receipt-title`
- `/Users/kant/Desktop/receipt-title`
- `/Users/kant/receipt-title`

**おすすめ**: `/Users/kant/Documents/receipt-title`

---

## 🎯 手順（やり直し）

1. **エラー画面で「Cancel」をクリック**

2. **GitHub Desktopで再度クローン**
   - 「File」→「Clone Repository」
   - 「URL」タブを選択
   - リポジトリのURL: `https://github.com/YOUR_USERNAME/receipt-title.git`
   - **「Local path」をクリックして場所を変更**
     - `/Users/kant/Documents/receipt-title` を選択
   - 「Clone」をクリック

3. **成功したら**
   - フォルダが作成されます
   - 次のステップ（ファイルのコピー）に進めます

---

## ❓ まだエラーが出る場合

### 別の場所を試す

- `/Users/kant/Desktop/receipt-title`
- `/Users/kant/receipt-title`

### フォルダを手動で作成

1. Finderで `/Users/kant/Documents` を開く
2. 新しいフォルダ「receipt-title」を作成
3. GitHub Desktopで、このフォルダを選択

---

## 💡 ヒント

- **「Local path」の右側にあるフォルダアイコン**をクリックすると、Finderで場所を選択できます
- 書き込み権限がある場所（Documents、Desktop、ホームディレクトリ）を選ぶと安全です

---

## 🎯 次のステップ

クローンが成功したら：
1. プロジェクトのファイルをコピー
2. GitHub Desktopでコミット＆プッシュ

クローンが成功したら、お知らせください！
