# 📋 ファイルをコピーする超簡単な方法

## 🎯 最も簡単な方法

### ステップ1: FinderでReceipt-titleフォルダを開く

**方法A: サイドバーから開く（最も簡単）**

1. **Finderを開く**（DockのFinderアイコンをクリック）
2. **左側のサイドバーで「書類」（Documents）をクリック**
3. **「Receipt-title」フォルダを探してダブルクリック**
   - フォルダが開きます

**方法B: Spotlight検索を使う**

1. **コマンド + スペースキー**を押す（Spotlight検索が開く）
2. **「Receipt-title」と入力**
3. **「Receipt-title」フォルダを選択してEnterキー**
   - フォルダが開きます

---

### ステップ2: ファイルを選択

1. **フォルダが開いたら、コマンド + A を押す**
   - すべてのファイルとフォルダが選択されます

2. **`node_modules`フォルダのチェックを外す**
   - `node_modules`フォルダをクリックして選択解除
   - または、Shiftキーを押しながら`node_modules`をクリック

---

### ステップ3: コピー

1. **コマンド + C を押す**
   - ファイルがコピーされます

---

### ステップ4: omakase-receiptフォルダを開く

**GitHub Desktopから開く（簡単）**

1. **GitHub Desktopに戻る**
2. **右側の「Show in Finder」ボタンをクリック**
   - または、メニューから「Repository」→「Show in Finder」
3. **Finderで`omakase-receipt`フォルダが開きます**

---

### ステップ5: 貼り付け

1. **`omakase-receipt`フォルダが開いたら、コマンド + V を押す**
2. **ファイルが貼り付けられます**

---

## ❓ コピーできない場合の対処法

### 問題1: フォルダが見つからない

**解決方法**:
- Spotlight検索（コマンド + スペース）で「Receipt-title」を検索
- または、ターミナルで以下を実行：
  ```bash
  open /Users/heidegger/Receipt-title
  ```

### 問題2: ファイルが選択できない

**解決方法**:
- Finderの表示を確認（リスト表示またはアイコン表示）
- フォルダ内に入っているか確認（`.git`フォルダの中ではないか確認）

### 問題3: コピーできない

**解決方法**:
- ファイルがロックされていないか確認
- 別のアプリでファイルが開いていないか確認
- Finderを再起動してみる

---

## 🎯 超シンプルな手順まとめ

1. **Finderを開く**
2. **サイドバーで「書類」をクリック**
3. **「Receipt-title」フォルダを開く**
4. **コマンド + A で全選択**
5. **`node_modules`のチェックを外す**
6. **コマンド + C でコピー**
7. **GitHub Desktopで「Show in Finder」をクリック**
8. **コマンド + V で貼り付け**

---

## 💡 もっと簡単な方法（ターミナルを使う）

ターミナルに慣れている場合：

```bash
# Receipt-titleフォルダに移動
cd /Users/heidegger/Receipt-title

# omakase-receiptフォルダにファイルをコピー（node_modulesを除く）
rsync -av --exclude='node_modules' --exclude='.git' . /Users/heidegger/Documents/omakase-receipt/
```

これで一発でコピーできます！

---

## 📞 まだわからない場合

どのステップで困っているか教えてください：
- フォルダが開けない
- ファイルが選択できない
- コピーできない
- 貼り付けできない

具体的に教えていただければ、もっと詳しく説明します！
