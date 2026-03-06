#!/usr/bin/env node
/**
 * Google Places API の動作確認スクリプト
 * 実行: node check-places.js
 */
require("dotenv").config();

const key =
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_API_KEY;

console.log("=== Google Places API 動作確認 ===\n");

if (!key) {
  console.log("✗ APIキーが設定されていません");
  console.log("  .env に以下のいずれかを設定してください:");
  console.log("  - GOOGLE_PLACES_API_KEY");
  console.log("  - GOOGLE_MAPS_API_KEY");
  console.log("  - GOOGLE_API_KEY");
  process.exit(1);
}

console.log("✓ APIキーが読み込まれています (先頭:", key.substring(0, 8) + "...)");
console.log("");

// シンガポール中心でテスト検索
const lat = 1.3521;
const lng = 103.8198;
const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=3000&type=doctor&keyword=clinic&key=${key}`;

console.log("Places API にリクエスト送信中...");
fetch(url)
  .then((res) => res.json())
  .then((data) => {
    if (data.status === "OK") {
      console.log("✓ API は正常に動作しています");
      console.log("  取得件数:", (data.results || []).length);
      if (data.results && data.results.length > 0) {
        console.log("  例:", data.results[0].name);
      }
    } else if (data.status === "ZERO_RESULTS") {
      console.log("✓ API は動作していますが、該当施設がありませんでした");
    } else {
      console.log("✗ API エラー:", data.status);
      if (data.error_message) {
        console.log("  メッセージ:", data.error_message);
      }
      if (data.status === "REQUEST_DENIED") {
        console.log("\n  対処法:");
        console.log("  1. Google Cloud Console で「Places API」を有効にしてください");
        console.log("  2. APIキーの制限（HTTP referrer等）を確認してください");
      }
      process.exit(1);
    }
  })
  .catch((err) => {
    console.log("✗ ネットワークエラー:", err.message);
    process.exit(1);
  });

console.log("\nより正確な位置検索のため、Google Cloud で「Geocoding API」も有効にすると、都市名から座標を取得できます。");
