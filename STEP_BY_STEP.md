# 📝 ステップバイステップ完全ガイド

GitHub Desktopの画面で何を入力すればいいか、一つずつ説明します。

## 🔍 まず確認：GitHubでリポジトリを作成しましたか？

### まだ作成していない場合

1. **ブラウザで https://github.com を開く**
2. **右上の「+」ボタンをクリック**
3. **「New repository」をクリック**
4. **以下の情報を入力**：
   - Repository name: `receipt-title`
   - Description: （空欄でもOK）
   - Public または Private を選択
   - ⚠️ 「Add a README file」は**チェックしない**
5. **「Create repository」をクリック**

**これでリポジトリが作成されます！**

---

## 📋 GitHub Desktopでの入力方法

### ステップ1: リポジトリのURLを取得

1. **GitHubのウェブサイトで、作成したリポジトリのページを開く**
   - https://github.com/YOUR_USERNAME/receipt-title
   - （YOUR_USERNAMEはあなたのGitHubユーザー名）

2. **緑色の「Code」ボタンをクリック**
   - リポジトリページの上部にあります

3. **「HTTPS」タブが選択されていることを確認**
   - URLが表示されます（例: `https://github.com/tk1103/receipt-title.git`）

4. **このURLをコピー**
   - URLを選択してコピー（コマンド + C）

---

### ステップ2: GitHub Desktopに入力

GitHub Desktopの「Clone a Repository」画面で：

1. **「URL」タブが選択されていることを確認**
   - 画面上部のタブで「URL」が青く表示されているはずです

2. **「Repository URL or GitHub username and repository」の下の入力欄にURLを貼り付け**
   - 入力欄をクリック
   - コピーしたURLを貼り付け（コマンド + V）
   - 例: `https://github.com/tk1103/receipt-title.git`

3. **「Local Path」を変更**
   - 「Local Path」の右側にある「**Choose...**」ボタンをクリック
   - Finderが開きます
   - **Documentsフォルダを選択**
   - 「選択」をクリック
   - または、直接入力欄に以下を入力：
     ```
     /Users/kant/Documents/receipt-title
     ```

4. **「Clone」ボタンをクリック**

---

## 🎯 具体的な入力例

### 入力欄1: Repository URL
```
https://github.com/tk1103/receipt-title.git
```
（`tk1103`の部分はあなたのGitHubユーザー名に置き換えてください）

### 入力欄2: Local Path
```
/Users/kant/Documents/receipt-title
```

---

## ❓ よくある質問

### Q: GitHubユーザー名がわからない
A: GitHubの右上に表示されている名前がユーザー名です。または、https://github.com にアクセスして、右上のアイコンをクリックすると表示されます。

### Q: リポジトリのURLがわからない
A: GitHubでリポジトリのページを開いて、緑色の「Code」ボタンをクリックすると表示されます。

### Q: 「Choose...」ボタンでどこを選べばいい？
A: **Documentsフォルダ**を選ぶのが一番簡単です。Finderで「書類」フォルダを開いて選択してください。

### Q: エラーが出る
A: 
- URLが正しいか確認（`.git`が最後についているか）
- Local Pathに書き込み権限があるか確認（Documentsフォルダなら大丈夫）
- インターネット接続を確認

---

## 🎬 動画のように説明すると

1. **GitHubのウェブサイトを開く**
2. **リポジトリページを開く**（右上のアイコン→「Your repositories」→「receipt-title」）
3. **緑色の「Code」ボタンをクリック**
4. **URLをコピー**（例: `https://github.com/tk1103/receipt-title.git`）
5. **GitHub Desktopに戻る**
6. **「URL」タブを確認**
7. **URL入力欄に貼り付け**
8. **「Choose...」をクリック**
9. **Documentsフォルダを選択**
10. **「Clone」をクリック**

---

## 💡 ヒント

- **URLは必ず`.git`で終わる**必要があります
- **Local Pathは書き込み権限がある場所**（Documents、Desktopなど）を選びましょう
- **エラーが出たら、URLとLocal Pathを確認**してください

---

## 📞 まだわからない場合

以下の情報を教えてください：
1. GitHubでリポジトリは作成できましたか？
2. GitHub Desktopの画面で、どの部分がわからないですか？
3. エラーメッセージは表示されていますか？

具体的に教えていただければ、もっと詳しく説明します！
