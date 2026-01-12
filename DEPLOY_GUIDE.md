# Kairo 一般公開ガイド

## 🚀 公開方法（推奨：Railway）

最も簡単で無料で始められる方法です。

---

## 📋 事前準備

### 1. GitHubアカウントの準備
- GitHubアカウントを持っていない場合は作成: https://github.com

### 2. Railwayアカウントの準備
- Railwayアカウントを作成: https://railway.app
- GitHubアカウントでサインインが可能

---

## 🔧 デプロイ手順

### Step 1: Gitリポジトリの初期化とGitHubへのプッシュ

ターミナルで以下を実行：

```bash
cd /Users/shota/kairo

# Gitリポジトリを初期化
git init

# すべてのファイルを追加（.envは除外されます）
git add .

# 初回コミット
git commit -m "Initial commit: Kairo AI薬局"

# GitHubで新しいリポジトリを作成（ブラウザで操作）
# https://github.com/new にアクセス
# リポジトリ名: kairo
# PublicまたはPrivateを選択
# 「Create repository」をクリック

# リモートリポジトリを追加（YOUR_USERNAMEをあなたのGitHubユーザー名に置き換え）
git remote add origin https://github.com/YOUR_USERNAME/kairo.git

# GitHubにプッシュ
git branch -M main
git push -u origin main
```

### Step 2: Railwayでデプロイ

1. **Railwayにログイン**
   - https://railway.app にアクセス
   - GitHubアカウントでサインイン

2. **新しいプロジェクトを作成**
   - 「New Project」をクリック
   - 「Deploy from GitHub repo」を選択
   - 先ほど作成した `kairo` リポジトリを選択

3. **環境変数を設定**
   - プロジェクトの「Variables」タブを開く
   - 以下の環境変数を追加：
     - **Key**: `OPENAI_API_KEY`
     - **Value**: あなたのOpenAI APIキー（.envファイルからコピー）
   - 「Add」をクリック

4. **デプロイ開始**
   - Railwayが自動的にビルドとデプロイを開始
   - 数分待つとデプロイが完了

5. **公開URLを取得**
   - デプロイ完了後、「Settings」タブを開く
   - 「Generate Domain」をクリック
   - 自動生成されたURL（例: `kairo-production.up.railway.app`）が表示される
   - このURLにアクセスしてKairoが動作することを確認

---

## 🎨 カスタムドメインの設定（オプション）

1. Railwayの「Settings」タブで「Custom Domain」を選択
2. ドメインを入力（例: `kairo.yourdomain.com`）
3. DNSレコードを設定（Railwayが案内を表示）

---

## 🔄 更新方法

コードを更新したら、以下を実行：

```bash
git add .
git commit -m "Update: 変更内容の説明"
git push origin main
```

Railwayが自動的に再デプロイします。

---

## 💰 費用

- **Railway無料プラン**: 
  - $5のクレジットが毎月付与
  - 小規模な使用であれば無料で利用可能
  - 使用量が増えた場合は従量課金

---

## ⚠️ 注意事項

1. **APIキーの管理**
   - `.env`ファイルはGitHubにプッシュされません（.gitignoreに含まれています）
   - Railwayの環境変数で設定してください

2. **セキュリティ**
   - 公開URLは誰でもアクセス可能になります
   - 必要に応じて認証機能を追加することを検討してください

3. **使用量の監視**
   - OpenAI APIの使用量を監視してください
   - Railwayの使用量も確認してください

---

## 🆘 トラブルシューティング

### デプロイが失敗する場合
- Railwayのログを確認（「Deployments」タブ）
- `package.json`の依存関係が正しいか確認
- 環境変数が正しく設定されているか確認

### APIキーエラーが表示される場合
- Railwayの環境変数で`OPENAI_API_KEY`が正しく設定されているか確認
- APIキーに残高があるか確認（OpenAIのダッシュボードで確認）

### サイトが表示されない場合
- Railwayのデプロイが完了しているか確認
- URLが正しいか確認
- ブラウザのキャッシュをクリア

---

## 📚 参考情報

- Railway公式ドキュメント: https://docs.railway.app
- GitHub公式サイト: https://github.com
- OpenAI APIドキュメント: https://platform.openai.com/docs

---

## 🎉 次のステップ

デプロイ完了後は以下を検討：
- カスタムドメインの設定
- アクセスログの監視
- パフォーマンスの最適化
- セキュリティの強化
- ユーザーフィードバックの収集

