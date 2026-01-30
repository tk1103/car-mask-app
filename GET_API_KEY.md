# GEMINI_API_KEYの取得方法

GEMINI_API_KEYはGoogle Gemini APIを使用するために必要なAPIキーです。

## 🔑 APIキーの取得方法

### ステップ1: Google AI Studioにアクセス

1. **ブラウザで以下にアクセス**：
   ```
   https://makersuite.google.com/app/apikey
   ```
   または
   ```
   https://aistudio.google.com/app/apikey
   ```

2. **Googleアカウントでログイン**
   - Gmailアカウントなどでログインしてください

---

### ステップ2: APIキーを作成

1. **「Create API Key」または「APIキーを作成」ボタンをクリック**
2. **プロジェクトを選択**（または新規作成）
3. **APIキーが表示されます**
   - 例: `AIzaSyC...`（長い文字列）

4. **APIキーをコピー**
   - ⚠️ **重要**: このキーは一度しか表示されないので、必ずコピーして保存してください

---

## 📝 APIキーの設定方法

### ローカル開発環境（.env.localファイル）

1. **プロジェクトフォルダに`.env.local`ファイルを作成**
   - 場所: `/Users/heidegger/Receipt-title/.env.local`

2. **以下の内容を追加**：
   ```
   GEMINI_API_KEY=あなたのAPIキーをここに貼り付け
   ```
   例:
   ```
   GEMINI_API_KEY=AIzaSyC1234567890abcdefghijklmnopqrstuvwxyz
   ```

3. **ファイルを保存**

---

### Vercelでの設定（公開時）

1. **Vercelのプロジェクト設定を開く**
2. **「Settings」→「Environment Variables」を開く**
3. **「Add New」をクリック**
4. **以下を入力**：
   - **Name**: `GEMINI_API_KEY`
   - **Value**: あなたのAPIキー
   - **Environment**: Production, Preview, Development すべてにチェック
5. **「Add」をクリック**

---

## ❓ よくある質問

### Q: APIキーは無料ですか？
A: はい、Google Gemini APIには無料枠があります。詳細はGoogle AI Studioで確認してください。

### Q: APIキーを忘れた
A: Google AI Studioに再度アクセスして、新しいAPIキーを作成するか、既存のキーを確認できます。

### Q: APIキーが漏洩した
A: Google AI StudioでAPIキーを削除して、新しいキーを作成してください。

---

## 🔒 セキュリティ注意事項

- ⚠️ **APIキーは絶対にGitHubにアップロードしないでください**
- `.env.local`ファイルは`.gitignore`に含まれているので、自動的に除外されます
- Vercelでは環境変数として安全に管理されます

---

## 📞 次のステップ

APIキーを取得したら：
1. ローカル開発用に`.env.local`ファイルに設定
2. Vercelで公開する際に環境変数として設定

APIキーを取得できたら、Vercelの設定に進みましょう！
