# Kairo 公開・デプロイガイド

## 公開方法の選択肢

### 1. ローカルネットワークでの共有（開発・テスト用）

同じWi-Fiに接続している人にアクセスしてもらう方法です。

#### 手順

1. サーバーのIPアドレスを確認：
```bash
# macOSの場合
ifconfig | grep "inet " | grep -v 127.0.0.1
```

2. サーバーを起動（IPアドレスを指定）：
```bash
# server.jsを修正して、0.0.0.0でリッスンするように変更
# または環境変数で指定
PORT=3000 HOST=0.0.0.0 npm start
```

3. 他のデバイスからアクセス：
```
http://[あなたのIPアドレス]:3000
```

**注意**: ファイアウォールの設定が必要な場合があります。

---

### 2. Railway（推奨・簡単）

無料プランがあり、簡単にデプロイできます。

#### 手順

1. Railwayアカウントを作成：https://railway.app
2. GitHubにリポジトリをプッシュ
3. Railwayで「New Project」→「Deploy from GitHub repo」
4. 環境変数を設定：
   - `OPENAI_API_KEY`: あなたのAPIキー
5. デプロイ完了

**メリット**: 
- 無料プランあり
- 自動デプロイ
- HTTPS対応

---

### 3. Render

無料プランがあり、静的サイトとWebサービスの両方に対応。

#### 手順

1. Renderアカウントを作成：https://render.com
2. 「New Web Service」を選択
3. GitHubリポジトリを接続
4. 設定：
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables: `OPENAI_API_KEY`
5. デプロイ

**メリット**:
- 無料プランあり
- 自動デプロイ
- HTTPS対応

---

### 4. Vercel（Node.js対応）

静的サイトとサーバーレス関数に対応。

#### 手順

1. Vercelアカウントを作成：https://vercel.com
2. `vercel.json`を作成（設定ファイル）
3. GitHubに接続してデプロイ

**注意**: Expressアプリの場合は、Vercel Functionsに変換が必要です。

---

### 5. Heroku

有料プランが中心ですが、安定しています。

#### 手順

1. Herokuアカウントを作成：https://heroku.com
2. Heroku CLIをインストール
3. デプロイ：
```bash
heroku create kairo-app
git push heroku main
heroku config:set OPENAI_API_KEY=your_key
```

---

## デプロイ前の準備

### 1. 環境変数の管理

`.env`ファイルはGitにコミットしないようにしてください（既に`.gitignore`に含まれています）。

デプロイ先のプラットフォームで環境変数を設定します。

### 2. ポート設定

本番環境では、環境変数からポートを読み取るようにします：

```javascript
const PORT = process.env.PORT || 3000;
```

### 3. セキュリティ

- APIキーは絶対に公開しない
- CORS設定を適切に行う
- 必要に応じて認証を追加

---

## 推奨：Railwayでのデプロイ

最も簡単で無料で始められる方法です。

### 詳細手順

1. **GitHubリポジトリを作成**
```bash
cd /Users/shota/kairo
git init
git add .
git commit -m "Initial commit"
# GitHubでリポジトリを作成してから
git remote add origin https://github.com/yourusername/kairo.git
git push -u origin main
```

2. **Railwayでデプロイ**
   - Railwayにログイン
   - 「New Project」→「Deploy from GitHub repo」
   - リポジトリを選択
   - 環境変数 `OPENAI_API_KEY` を設定
   - デプロイ完了

3. **カスタムドメイン（オプション）**
   - Railwayの設定からカスタムドメインを追加可能

---

## トラブルシューティング

### ポートエラー
- 環境変数 `PORT` が正しく設定されているか確認

### APIキーエラー
- 環境変数が正しく設定されているか確認
- APIキーに残高があるか確認

### ビルドエラー
- `package.json`の依存関係が正しいか確認
- Node.jsのバージョンが適切か確認

---

## 次のステップ

デプロイ後は以下を検討：
- カスタムドメインの設定
- アクセスログの確認
- パフォーマンスの監視
- セキュリティの強化


