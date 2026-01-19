# Kairo - AI薬局プロトタイプ

体調が悪いときの不安を受け止めてくれるAI薬局サービスです。

## 📋 セットアップ手順

### Step 1: 依存関係のインストール

```bash
cd /Users/shota/kairo
npm install cors openai dotenv
```

### Step 2: 環境変数の設定

`.env`ファイルを作成し、OpenAI APIキーを設定してください：

```bash
# .envファイルを作成
touch .env
```

`.env`ファイルに以下を記入：

```
OPENAI_API_KEY=your_api_key_here
```

OpenAI APIキーは以下で取得できます：
https://platform.openai.com/api-keys

### Step 3: サーバーの起動

```bash
npm start
```

サーバーが起動すると、以下のメッセージが表示されます：
```
Kairo server is running on http://localhost:3000
✓ OpenAI API key is configured
```

### Step 4: ブラウザでアクセス

ブラウザで以下のURLを開いてください：
```
http://localhost:3000
```

## 📁 プロジェクト構成

```
kairo/
├── server.js          # Expressサーバー（OpenAI API統合）
├── package.json        # 依存関係とスクリプト
├── .env               # 環境変数（APIキー）
├── .gitignore         # Git除外設定
├── README.md          # このファイル
└── public/            # フロントエンドファイル
    ├── index.html     # メインHTML
    ├── style.css      # スタイル
    └── script.js      # フロントエンドJavaScript
```

## 🚀 使い方

1. サーバーを起動：`npm start`
2. ブラウザで `http://localhost:3000` を開く
3. 症状を入力してAIと会話を開始
4. AIが適切なアドバイスを提供します

## 🔧 開発モード（自動リロード）

開発中は`nodemon`を使用すると便利です：

```bash
# nodemonをインストール（初回のみ）
npm install --save-dev nodemon

# 開発モードで起動
npm run dev
```

## ⚠️ 注意事項

- OpenAI APIの使用には料金がかかります（GPT-4o-miniは比較的安価）
- APIキーは絶対に公開しないでください
- `.env`ファイルは`.gitignore`に含まれています

## 🐛 トラブルシューティング

### サーバーに接続できない
- サーバーが起動しているか確認：`npm start`
- ポート3000が使用可能か確認
- ブラウザのコンソールでエラーを確認

### APIキーエラー
- `.env`ファイルに正しいAPIキーが設定されているか確認
- APIキーに残高があるか確認
- サーバーを再起動してください

### モジュールが見つからない
```bash
npm install cors openai dotenv
```

## 📝 次のステップ

- [ ] データベース統合（会話履歴の永続化）
- [ ] 認証機能の追加
- [ ] エラーハンドリングの改善
- [ ] テストの追加
- [ ] デプロイ準備

## 📄 ライセンス

ISC


