// 診断スクリプト - 環境と設定を確認
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('=== Kairo 診断チェック ===\n');

// 1. .envファイルの確認
console.log('1. .envファイルの確認');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('  ✓ .envファイルが存在します');
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('OPENAI_API_KEY')) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && apiKey.length > 20) {
      console.log(`  ✓ APIキーが設定されています (長さ: ${apiKey.length})`);
      console.log(`  ✓ APIキーの先頭: ${apiKey.substring(0, 10)}...`);
    } else {
      console.log('  ✗ APIキーが正しく設定されていません');
    }
  } else {
    console.log('  ✗ .envファイルにOPENAI_API_KEYが含まれていません');
  }
} else {
  console.log('  ✗ .envファイルが存在しません');
}

// 2. package.jsonの確認
console.log('\n2. package.jsonの確認');
const packagePath = path.join(__dirname, 'package.json');
if (fs.existsSync(packagePath)) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  console.log('  ✓ package.jsonが存在します');
  const requiredDeps = ['express', 'cors', 'openai', 'dotenv'];
  const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies[dep]);
  if (missingDeps.length === 0) {
    console.log('  ✓ 必要な依存関係がすべて含まれています');
  } else {
    console.log(`  ✗ 以下の依存関係が不足しています: ${missingDeps.join(', ')}`);
  }
} else {
  console.log('  ✗ package.jsonが存在しません');
}

// 3. ファイル構造の確認
console.log('\n3. ファイル構造の確認');
const requiredFiles = [
  'server.js',
  'public/index.html',
  'public/script.js',
  'public/style.css'
];
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✓ ${file} が存在します`);
  } else {
    console.log(`  ✗ ${file} が存在しません`);
  }
});

// 4. node_modulesの確認
console.log('\n4. node_modulesの確認');
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  console.log('  ✓ node_modulesディレクトリが存在します');
  const requiredModules = ['express', 'cors', 'openai', 'dotenv'];
  requiredModules.forEach(module => {
    const modulePath = path.join(nodeModulesPath, module);
    if (fs.existsSync(modulePath)) {
      console.log(`  ✓ ${module} がインストールされています`);
    } else {
      console.log(`  ✗ ${module} がインストールされていません`);
    }
  });
} else {
  console.log('  ✗ node_modulesディレクトリが存在しません');
  console.log('  → npm install を実行してください');
}

// 5. ポートの確認
console.log('\n5. ポート3000の確認');
const net = require('net');
const server = net.createServer();
server.listen(3000, () => {
  server.close();
  console.log('  ✓ ポート3000は使用可能です');
  console.log('\n=== 診断完了 ===');
  console.log('\n次のステップ:');
  console.log('1. npm start でサーバーを起動');
  console.log('2. ブラウザで http://localhost:3000 を開く');
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('  ⚠ ポート3000は既に使用されています');
    console.log('  → 他のプロセスがサーバーを起動している可能性があります');
  } else {
    console.log(`  ✗ エラー: ${err.message}`);
  }
  console.log('\n=== 診断完了 ===');
});

