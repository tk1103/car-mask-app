# 直接的な方法：既存のフォルダをGitリポジトリにする

GitHub Desktopがうまく動作しない場合、既存のプロジェクトフォルダ（Receipt-title）を直接Gitリポジトリとして初期化する方法が簡単です。

## 🎯 最も簡単な方法

### ステップ1: GitHub Desktopで既存のフォルダを追加

1. **GitHub Desktopアプリを開く**
2. **「File」→「Add Local Repository」をクリック**
3. **「Choose」ボタンをクリック**
4. **Finderで `/Users/heidegger/Receipt-title` フォルダを選択**
5. **「Add Repository」をクリック**

---

### ステップ2: GitHubリポジトリに接続

1. **GitHub Desktopで「Receipt-title」リポジトリが表示されます**
2. **「Repository」→「Repository Settings」をクリック**
3. **「Remote」タブをクリック**
4. **「Primary remote」に以下を入力**：
   ```
   https://github.com/tk1103/omakase-receipt.git
   ```
5. **「Save」をクリック**

---

### ステップ3: ファイルをコミット＆プッシュ

1. **GitHub Desktopで「Changes」タブを確認**
   - ファイルのリストが表示されます
2. **左下の「Summary」欄に「Initial commit」と入力**
3. **「Commit to main」ボタンをクリック**
4. **「Publish branch」または「Push origin」ボタンをクリック**

---

## ✅ これで完了！

この方法なら、フォルダをコピーする必要がありません。既存のプロジェクトフォルダを直接GitHubにアップロードできます。
