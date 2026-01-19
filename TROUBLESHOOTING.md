# トラブルシューティングガイド

## 問題の確認手順

### 1. サーバーが起動しているか確認

ターミナルで以下を実行：
```bash
cd /Users/shota/kairo
npm start
```

正常に起動している場合、以下のメッセージが表示されます：
```
Kairo server is running on http://localhost:3000
✓ OpenAI API key is configured
```

### 2. .envファイルの確認

`.env`ファイルが正しく設定されているか確認：
```bash
cd /Users/shota/kairo
cat .env
```

以下の形式になっている必要があります：
```
OPENAI_API_KEY=sk-proj-...
```

**注意**: `OPENAI_API_KEY=`の後にスペースを入れないでください。

### 3. ブラウザでアクセス

ブラウザで以下を開く：
```
http://localhost:3000
```

### 4. ブラウザのコンソールでエラー確認

1. ブラウザで `http://localhost:3000` を開く
2. F12キー（または右クリック→検証）で開発者ツールを開く
3. 「Console」タブを確認
4. エラーメッセージを確認

### 5. ネットワークタブでAPI呼び出し確認

1. 開発者ツールの「Network」タブを開く
2. メッセージを送信
3. `/api/chat` のリクエストを確認
4. ステータスコードとレスポンスを確認

## よくある問題と解決方法

### 問題1: "OpenAI API key is not configured"

**原因**: `.env`ファイルが存在しない、またはAPIキーが設定されていない

**解決方法**:
1. `/Users/shota/kairo/.env`ファイルを作成
2. 以下を記入：
```
OPENAI_API_KEY=your_api_key_here
```
3. サーバーを再起動

### 問題2: "Cannot GET /"

**原因**: ルートエンドポイントが正しく設定されていない

**解決方法**: `server.js`に以下が含まれているか確認：
```javascript
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});
```

### 問題3: CORSエラー

**原因**: CORS設定が正しくない

**解決方法**: `server.js`に以下が含まれているか確認：
```javascript
app.use(cors());
```

### 問題4: "AIの応答を取得できませんでした"

**原因**: 
- APIキーが無効
- APIキーの残高不足
- ネットワーク接続の問題

**解決方法**:
1. APIキーが正しいか確認
2. OpenAIのアカウントで残高を確認
3. インターネット接続を確認

### 問題5: モジュールが見つからない

**原因**: 依存関係がインストールされていない

**解決方法**:
```bash
cd /Users/shota/kairo
npm install
```

## デバッグ方法

### サーバー側のログ確認

サーバーを起動したターミナルで、エラーメッセージを確認してください。

### クライアント側のログ確認

ブラウザのコンソールで、JavaScriptエラーを確認してください。

### APIエンドポイントのテスト

ターミナルで以下を実行して、APIが動作しているか確認：
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"テスト","conversationId":"test123"}'
```

正常な場合、AIの応答が返ってきます。

## ヘルスチェック

ブラウザで以下を開いて、サーバーの状態を確認：
```
http://localhost:3000/api/health
```

正常な場合、以下のJSONが返ってきます：
```json
{
  "status": "ok",
  "hasApiKey": true
}
```


