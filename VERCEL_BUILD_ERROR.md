# Vercelビルドエラーの対処法

## 🔍 エラー箇所を探す方法

### 方法1: ビルドログで検索

1. **Vercelのビルドログ画面で「Find in logs」検索バーを使う**
   - コマンド + F（Mac）または Ctrl + F（Windows）
   - または、検索バーに直接入力

2. **以下のキーワードで検索**：
   - `error`
   - `Error`
   - `failed`
   - `Failed`
   - `TypeError`
   - `SyntaxError`

---

### 方法2: エラーメッセージのパターン

よくあるエラーメッセージ：
- `Type error:` - TypeScriptエラー
- `Module not found:` - モジュールが見つからない
- `Cannot find module:` - モジュールが見つからない
- `SyntaxError:` - 構文エラー
- `ReferenceError:` - 参照エラー

---

## 🔧 よくあるビルドエラーの原因と対処法

### 1. jszipの動的インポートの問題

**問題**: Next.jsのビルド時に動的インポートが正しく処理されない

**対処法**: 動的インポートを条件付きにする

```typescript
// 修正前
const JSZip = (await import('jszip')).default;

// 修正後（クライアントサイドでのみ実行）
if (typeof window !== 'undefined') {
    const JSZip = (await import('jszip')).default;
}
```

---

### 2. TypeScriptエラー

**問題**: 型エラーや構文エラー

**対処法**: ローカルでTypeScriptチェックを実行

```bash
npx tsc --noEmit
```

---

### 3. 環境変数の問題

**問題**: ビルド時に環境変数が参照されている

**対処法**: 環境変数は実行時のみ使用する

---

## 📋 次のステップ

1. **ビルドログで「error」を検索**
2. **エラーメッセージの全文を確認**
3. **エラーの種類に応じて対処**

---

## 💡 ビルドログの見方

- **緑色のチェックマーク**: 成功
- **赤色のアイコン**: エラー
- **黄色のアイコン**: 警告

エラーメッセージの全文を共有していただければ、具体的な対処法を提案できます！
