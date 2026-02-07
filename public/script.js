// API endpoint
const API_URL = "/api/chat";
const CLEAR_URL = "/api/clear";

// Conversation history keys
const HISTORY_KEY = "kairo_chat_history";
const CONVERSATION_ID_KEY = "kairo_conversation_id";
const FIRST_QUESTION_KEY = "kairo_first_question";

const SUBJECTIVE_ALERT_WORDS = ["気になります", "引っかかります", "心配です", "注意が必要です"];

const INTRO_TEMPLATE_TEXTS = {
  TEMPLATE_EMPATHY_1: "それはつらいですよね。体の不調があると、どうしても気になりますよね。",
  TEMPLATE_EMPATHY_2: "教えてくれてありがとうございます。ここで一緒に見ていきましょう。",
  TEMPLATE_EMPATHY_3: "不調があると落ち着かないですよね。ここで一緒に見ていきましょう。",
  EMPATHY_NEXT_1: "今の話、ちゃんと受け止めています。",
  EMPATHY_NEXT_2: "ここまでの流れ、大事に見ています。",
  EMPATHY_NEXT_3: "今の状態、丁寧に整理していきましょう。",
  EMPATHY_NEXT_4: "今の感覚、無理なく言葉にしていきましょう。",
  EMPATHY_NEXT_5: "ここまでの内容、落ち着いて受け止めています。",
  PROGRESS_1: "ここまでで、状況が少し見えてきました。",
  PROGRESS_2: "ひとつ大事な材料が分かりました。",
  PROGRESS_3: "今の話で、整理が一段進みました。",
  PROGRESS_4: "ここまでで、ポイントが一つ見えました。",
  FOCUS_1: "次は、判断に関わる部分だけ確認します。",
  FOCUS_2: "ここは今後を分けるポイントなので見ておきます。",
  FOCUS_3: "次に進むために、ここだけ教えてください。",
  FOCUS_4: "今の判断に必要な点だけ見せてください。",
  FOCUS_5: "ここは整理の要なので確認します。",
};

const LOCATION_PROMPT_MESSAGE =
  "より正確な案内のため、現在地を使用できます。\n今回は許可しなくても会話は続けられます。";
const LOCATION_REPROMPT_MESSAGE =
  "より近くて適切な場所をご案内するため、\n現在地の共有をもう一度お願いしてもいいですか？";
const LOCATION_PROMPT_KEY = "kairo_location_prompt_shown";
const LOCATION_RETRY_KEY = "kairo_location_retry_count";
const LOCATION_PENDING_KEY = "kairo_location_pending_start";
const LOCATION_PENDING_NOTICE_KEY = "kairo_location_pending_notice";
const LOCATION_PENDING_TIMEOUT_MS = 5000;
const LOCATION_PENDING_NOTICE =
  "📍 現在地を正確に取得できませんでした（市レベルで案内します）";

function renderQuestionPayload(payload) {
  if (!payload || !payload.question || !Array.isArray(payload.introTemplateIds)) {
    return payload?.question || "";
  }
  const introLines = payload.introTemplateIds
    .map((id) => INTRO_TEMPLATE_TEXTS[id])
    .filter(Boolean);
  return introLines.concat(payload.question).join("\n");
}

// Generate or get conversation ID
function getConversationId() {
  let conversationId = localStorage.getItem(CONVERSATION_ID_KEY);
  if (!conversationId) {
    conversationId =
      "conv_" +
      Date.now() +
      "_" +
      Math.random().toString(36).substr(2, 9);
    localStorage.setItem(CONVERSATION_ID_KEY, conversationId);
  }
  return conversationId;
}

function getStoredLocation() {
  try {
    const raw = sessionStorage.getItem("kairo_location");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function storeLocation(location) {
  try {
    sessionStorage.setItem("kairo_location", JSON.stringify(location));
  } catch (_) {
    // ignore
  }
}

function normalizeLocation(raw) {
  if (!raw) return { status: "idle" };
  if (raw.status === "requesting") return { status: "requesting" };
  if (raw.status === "failed" && raw.reason) return { status: "failed", reason: raw.reason };
  if (raw.status === "usable_fast" && raw.lat && raw.lng && raw.city && raw.country && raw.ts) {
    return { status: "usable_fast", lat: raw.lat, lng: raw.lng, city: raw.city, country: raw.country, ts: raw.ts };
  }
  if (raw.status === "usable" && raw.lat && raw.lng && raw.city && raw.country) {
    return { status: "usable", lat: raw.lat, lng: raw.lng, city: raw.city, country: raw.country, accuracy: raw.accuracy, ts: raw.ts };
  }
  if (raw.status === "city_ok" && raw.lat && raw.lng && raw.city && raw.country) {
    return { status: "city_ok", lat: raw.lat, lng: raw.lng, city: raw.city, country: raw.country, accuracy: raw.accuracy, ts: raw.ts };
  }
  if (raw.lat && raw.lng) {
    return { status: "partial_geo", lat: raw.lat, lng: raw.lng, accuracy: raw.accuracy, ts: raw.ts };
  }
  if (raw.error) {
    return { status: "failed", reason: raw.error };
  }
  return { status: "idle" };
}

function updateLocationStatusIndicator(status) {
  const target = document.getElementById("locationStatus");
  if (!target) return;
  let label = "";
  if (status === "usable" || status === "usable_fast" || status === "city_ok") {
    label = "📍 現在地取得済み";
    target.style.display = "inline-flex";
  } else if (status === "requesting" || status === "partial_geo" || status === "idle") {
    label = "📍 現在地を確認しています…";
    target.style.display = "inline-flex";
  } else {
    label = "📍 現在地を確認できませんでした";
    target.style.display = "inline-flex";
  }
  target.textContent = label;
  const button = document.getElementById("locationButton");
  if (button) {
    const promptShown = sessionStorage.getItem(LOCATION_PROMPT_KEY) === "true";
    button.style.display =
      status === "usable" || status === "usable_fast" || status === "city_ok" || promptShown
        ? "none"
        : "inline-flex";
  }
}

function getLocationPayload() {
  return normalizeLocation(getStoredLocation());
}

function requestLocationOnAction() {
  try {
    if (!navigator.geolocation) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
    storeLocation({ status: "requesting" });
    updateLocationStatusIndicator("requesting");
    sessionStorage.setItem(LOCATION_PENDING_KEY, String(Date.now()));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const payload = {
          status: "partial_geo",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: Date.now(),
        };
        storeLocation(payload);
        updateLocationStatusIndicator("partial_geo");
      },
      (err) => {
        let reason = "error";
        if (err?.code === 1) reason = "denied";
        if (err?.code === 2) reason = "error";
        if (err?.code === 3) reason = "timeout";
        storeLocation({ status: "failed", reason, ts: Date.now() });
        updateLocationStatusIndicator("failed");
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
    );
  } catch (_) {
    // ignore (fallback handled server-side)
  }
}

function requestLocationWithRetry(attempt = 1) {
  const stored = normalizeLocation(getStoredLocation());
  if (stored.status === "failed" && stored.reason === "denied") return;
  if (attempt > 3) return;
  requestLocationOnAction();
  const delay = 500 + Math.floor(Math.random() * 500);
  setTimeout(() => {
    const latest = normalizeLocation(getStoredLocation());
    if (
      latest.status === "partial_geo" ||
      latest.status === "usable" ||
      latest.status === "usable_fast" ||
      latest.status === "city_ok"
    ) {
      return;
    }
    if (latest.status === "failed" && latest.reason === "denied") {
      return;
    }
    requestLocationWithRetry(attempt + 1);
  }, delay);
}

function finalizeLocationPendingIfNeeded() {
  const stored = normalizeLocation(getStoredLocation());
  if (stored.status !== "requesting" && stored.status !== "partial_geo") {
    return;
  }
  const startRaw = sessionStorage.getItem(LOCATION_PENDING_KEY);
  if (!startRaw) return;
  const start = Number(startRaw);
  if (!Number.isFinite(start)) return;
  if (Date.now() - start < LOCATION_PENDING_TIMEOUT_MS) return;
  const noticeShown = sessionStorage.getItem(LOCATION_PENDING_NOTICE_KEY) === "true";
  if (!noticeShown) {
    addMessage(LOCATION_PENDING_NOTICE);
    sessionStorage.setItem(LOCATION_PENDING_NOTICE_KEY, "true");
  }
  const nextState =
    stored.status === "partial_geo"
      ? { ...stored, status: "city_ok" }
      : { status: "failed", reason: "timeout", ts: Date.now() };
  storeLocation(nextState);
  updateLocationStatusIndicator(nextState.status);
}

// Save conversation history
function saveHistory() {
  const messagesContainer = document.getElementById("chatMessages");
  const messages = Array.from(messagesContainer.children).map((msg) => {
    const isUser = msg.classList.contains("user");
    let text = '';
    
    if (isUser) {
      text = msg.textContent;
    } else {
      // AIメッセージの場合、元のテキストがあれば優先
      if (msg.dataset.originalText) {
        text = msg.dataset.originalText;
      } else if (msg.classList.contains("has-blocks")) {
        const blocks = msg.querySelectorAll('.message-block:not(.summary-block)');
        let fullText = '';
        blocks.forEach(block => {
          const header = block.querySelector('.block-header');
          const content = block.querySelector('.block-content');
          if (header) {
            fullText += header.textContent + '\n\n';
          }
          if (content) {
            fullText += content.textContent + '\n\n⸻\n\n';
          }
        });
        text = fullText.trim();
      } else {
        text = msg.textContent;
      }
    }
    
    return { text, isUser };
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
}

// Load conversation history (再描画は行わない)
function loadHistory() {
  return;
}

// Clear conversation history
function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(CONVERSATION_ID_KEY);
  localStorage.removeItem(FIRST_QUESTION_KEY);
  sessionStorage.removeItem("kairo_location");
  sessionStorage.removeItem(LOCATION_PROMPT_KEY);
  sessionStorage.setItem("kairo_force_location_prompt", "true");
  // Clear server-side history, then reload to reset UI without DOM再生成
  fetch(CLEAR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId: getConversationId() }),
  })
    .catch((err) => console.error("履歴クリアエラー:", err))
    .finally(() => {
      hideSummaryCard();
      window.location.reload();
    });
}

// Parse AI message into blocks (cards)
function parseAIMessage(text) {
  // 見出しアイコンのパターン（様子見/市販薬の場合 + 病院をおすすめする場合）
  const headerPatterns = [
    // 様子見/市販薬の場合
    { icon: '🟢', name: 'まず安心してください' },
    { icon: '🤝', name: '今の状態について' },
    { icon: '✅', name: '今すぐやること' },
    { icon: '⏳', name: '今後の見通し' },
    { icon: '🚨', name: 'もし次の症状が出たら' },
    { icon: '💊', name: '一般的な市販薬' },
    { icon: '🌱', name: '最後に' },
    // 病院をおすすめする場合
    { icon: '📝', name: 'いまの状態を整理します（メモ）' },
    { icon: '⚠️', name: 'Kairoが気になっているポイント' },
    { icon: '🏥', name: 'Kairoの判断' },
    { icon: '💬', name: '最後に' }
  ];

  // 見出しアイコンがあるかチェック
  let hasHeader = false;
  for (const pattern of headerPatterns) {
    if (text.includes(pattern.icon)) {
      hasHeader = true;
      break;
    }
  }

  if (!hasHeader) {
    return null;
  }

  // 見出しで分割
  const blocks = [];
  const lines = text.split('\n');
  let currentBlock = null;
  let currentContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 見出しを探す
    let foundHeader = null;
    for (const pattern of headerPatterns) {
      if (line.includes(pattern.icon)) {
        foundHeader = pattern;
        // 見出し名を抽出（絵文字以降のテキスト）
        const nameMatch = line.match(new RegExp(`${pattern.icon}\\s*(.+)`));
        foundHeader.name = nameMatch ? nameMatch[1].trim() : pattern.name;
        break;
      }
    }

    if (foundHeader) {
      // 前のブロックを保存
      if (currentBlock) {
        const content = currentContent.join('\n');
        blocks.push({
          header: currentBlock,
          content: content // trim()を削除して改行を保持
        });
      }
      // 新しいブロック開始
      currentBlock = foundHeader;
      currentContent = [];
    } else if (line.trim() === '⸻') {
      // 区切り線は空行として扱う（改行を保持）
      if (currentContent.length > 0 && currentContent[currentContent.length - 1] !== '') {
        currentContent.push('');
      }
    } else {
      // コンテンツを追加（空行も含めて保持）
      currentContent.push(line);
    }
  }

  // 最後のブロックを保存
  if (currentBlock) {
    const content = currentContent.join('\n');
    blocks.push({
      header: currentBlock,
      content: content // trim()を削除して改行を保持
    });
  }

  // 見出しが見つからない場合は通常表示
  if (blocks.length === 0) {
    return null;
  }

  return blocks;
}

// Check if decision is completed (判断が完了しているかチェック)
function isDecisionCompleted(text) {
  // 判断を示すブロックが含まれているかチェック
  const decisionIndicators = [
    '🟢 まず安心してください',
    '🤝 今の状態について',
    '✅ 今すぐやること',
    '⏳ 今後の見通し',
    '🚨 もし次の症状が出たら',
    '🏥 Kairoの判断',
    '📝 いまの状態を整理します',
    '⚠️ Kairoが気になっているポイント',
    '病院に行くことをおすすめします',
    '病院をおすすめします'
  ];
  
  const decisionPatterns = [
    /今は.*様子見/,
    /市販薬/,
    /病院に行くことをおすすめ/,
    /病院をおすすめ/,
    /判断します/,
    /おすすめします/
  ];
  
  // 判断を示すブロックが含まれているか
  const hasDecisionBlock = decisionIndicators.some(indicator => text.includes(indicator));
  const hasDecisionPattern = decisionPatterns.some(pattern => pattern.test(text));
  
  return hasDecisionBlock || hasDecisionPattern;
}

// Get urgency level from AI message (緊急度を判定)
function getUrgencyLevel(text) {
  // 病院をおすすめする場合
  if (
    text.includes('🏥 Kairoの判断') ||
    text.includes('病院をおすすめします') ||
    text.includes('病院に行くことをおすすめします') ||
    text.includes('今すぐ病院') ||
    text.includes('救急')
  ) {
    return 'high'; // 🔴
  }
  
  // 緊急性が高い場合
  if (text.includes('緊急性が高い') || text.includes('緊急性：高')) {
    return 'high'; // 🔴
  }
  
  // 様子見/市販薬の場合
  if (
    text.includes('🟢 まず安心してください') ||
    text.includes('様子見') ||
    text.includes('市販薬') ||
    text.includes('緊急性は高くなさそう') ||
    text.includes('心配いりません')
  ) {
    return 'low'; // 🟢
  }
  
  // 注意・中程度の表現がある場合は🟡
  if (text.includes('注意') || text.includes('緊急性') || text.includes('受診を検討')) {
    return 'medium'; // 🟡
  }
  
  // デフォルトは中緊急性（🟡を増やす）
  return 'medium';
}

// Create summary block (まとめブロックを作成)
function createSummaryBlock(text) {
  const urgencyLevel = getUrgencyLevel(text);
  
  let headerIcon = '🟢';
  let headerText = 'まず安心してください';
  let summaryContent = '';
  const actionSuffix = '\n👉 これ以上、何かする必要はありません。';
  
  if (urgencyLevel === 'high') {
    headerIcon = '🔴';
    headerText = '今回は病院をおすすめします';
    
    // 判断を抽出（🏥 セクションから）
    const hospitalMatch = text.match(/🏥[^⸻]*?Kairoの判断[^⸻]*?\*\*([^*]+)\*\*/s);
    if (hospitalMatch) {
      summaryContent = hospitalMatch[1].trim() + '\n\n✅ 今やること\n\n専門家の確認が必要です。\n一人で判断しなくて大丈夫です。' + actionSuffix;
    } else {
      // 別のパターンで判断を抽出
      const judgmentMatch = text.match(/\*\*([^*]+)\*\*/);
      if (judgmentMatch && text.includes('病院')) {
        summaryContent = judgmentMatch[1].trim() + '\n\n✅ 今やること\n\n専門家の確認が必要です。\n一人で判断しなくて大丈夫です。' + actionSuffix;
      } else {
        summaryContent = '✅ 今やること\n\n専門家の確認が必要です。\n一人で判断しなくて大丈夫です。' + actionSuffix;
      }
    }
  } else if (urgencyLevel === 'medium') {
    headerIcon = '🟡';
    headerText = 'まず安心してください';
    
    // 🟡は🟢と同じ構成
    const stateMatch = text.match(/🤝[^⸻]*?今の状態について[^⸻]*?\*\*([^*]+)\*\*/s);
    if (stateMatch) {
      summaryContent = stateMatch[1].trim() + '\n\n✅ 今やること\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。' + actionSuffix;
    } else {
      const judgmentMatch = text.match(/\*\*([^*]+)\*\*/);
      if (judgmentMatch) {
        summaryContent = judgmentMatch[1].trim() + '\n\n✅ 今やること\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。' + actionSuffix;
      } else {
        summaryContent = '✅ 今やること\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。' + actionSuffix;
      }
    }
  } else {
    headerIcon = '🟢';
    headerText = 'まず安心してください';
    
    // 判断を抽出（🤝 セクションから）
    const stateMatch = text.match(/🤝[^⸻]*?今の状態について[^⸻]*?\*\*([^*]+)\*\*/s);
    if (stateMatch) {
      summaryContent = stateMatch[1].trim() + '\n\n✅ 今やること\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。' + actionSuffix;
    } else {
      // 別のパターンで判断を抽出
      const judgmentMatch = text.match(/\*\*([^*]+)\*\*/);
      if (judgmentMatch) {
        summaryContent = judgmentMatch[1].trim() + '\n\n✅ 今やること\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。' + actionSuffix;
      } else {
        summaryContent = '✅ 今やること\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。' + actionSuffix;
      }
    }
  }
  
  return {
    header: headerIcon + ' ' + headerText,
    content: summaryContent
  };
}

// Extract summary from AI message (サマリーカード用)
function extractSummary(text) {
  // 病院をおすすめする場合（🏥 セクション）をチェック
  const hospitalMatch = text.match(/🏥[^⸻]*?Kairoの判断[^⸻]*?([^⸻]*?)⸻/s);
  if (hospitalMatch) {
    // 病院をおすすめする場合
    let summary = '🔴 病院をおすすめします\n👉 ';
    
    // 判断を抽出（**太字**で囲まれている部分）
    const judgmentMatch = text.match(/🏥[^⸻]*?\*\*(.+?)\*\*/s);
    if (judgmentMatch) {
      summary += judgmentMatch[1].trim();
    } else {
      summary += '専門家の確認が必要です';
    }
    
    return summary.trim() || null;
  }
  
  // 様子見/市販薬の場合（🟢 セクション）をチェック
  const greenMatch = text.match(/🟢[^⸻]*?([^⸻]*?)⸻/s);
  if (!greenMatch) return null;

  let summary = '';
  
  // 緊急性を抽出
  if (text.includes('緊急性は高くなさそうです') || text.includes('緊急性は低そうです') || text.includes('緊急性は高くなさそう')) {
    summary += '🟢 緊急性：低\n👉 ';
  } else if (text.includes('緊急性が高い') || text.includes('緊急性：高')) {
    summary += '🚨 緊急性：高\n👉 ';
  } else if (text.includes('緊急性')) {
    summary += '🟡 緊急性：中\n👉 ';
  } else {
    summary += '🟢 ';
  }

  // 判断を抽出（**太字**で囲まれている部分）
  const judgmentMatch = text.match(/\*\*(.+?)\*\*/);
  if (judgmentMatch) {
    summary += judgmentMatch[1].trim();
  } else {
    // 太字がない場合は「私は...」の部分を探す
    const iThinkMatch = text.match(/私は(.+?)(?:と|だ|です|と思います|と判断)/);
    if (iThinkMatch) {
      summary += iThinkMatch[1].trim();
    } else {
      // 「様子見」「市販薬」「病院」などのキーワードを探す
      if (text.includes('様子見')) {
        summary += '今は様子見でOK';
      } else if (text.includes('市販薬')) {
        summary += '市販薬で対応できそうです';
      } else if (text.includes('病院')) {
        summary += '病院に行くことをおすすめします';
      } else {
        summary += '今の状態を確認しましょう';
      }
    }
  }

  return summary.trim() || null;
}

// Add message to chat (AIは即時表示)
let isCollecting = true;
function addMessage(text, isUser = false, save = true) {
  const messagesContainer = document.getElementById("chatMessages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${isUser ? "user" : "ai"}`;
  
  if (isUser) {
    // User messages: show immediately
    messageDiv.textContent = text;
    messagesContainer.appendChild(messageDiv);
    if (!localStorage.getItem(FIRST_QUESTION_KEY)) {
      localStorage.setItem(FIRST_QUESTION_KEY, text);
    }
    return;
  }
  
  // AI messages: render line-by-line (no animation, no re-render)
  const blocks = parseAIMessage(text);
  messagesContainer.appendChild(messageDiv);
  
  const appendLinesSequentially = (target, textToAppend, done) => {
    const lines = textToAppend.split("\n");
    let index = 0;
    
    const appendNext = () => {
      const lineSpan = document.createElement("span");
      lineSpan.textContent = lines[index];
      target.appendChild(lineSpan);
      
      if (index < lines.length - 1) {
        target.appendChild(document.createElement("br"));
      }
      
      index += 1;
      if (index < lines.length) {
        setTimeout(appendNext, 24);
      } else if (done) {
        done();
      }
    };
    
    appendNext();
  };
  
  const finalizeMessage = () => {
    // 判断が完了しているかチェック
    const decisionCompleted = isDecisionCompleted(text);
    
    // 判断が完了している場合は、必ずまとめブロックを追加
    if (decisionCompleted) {
      console.log("[DEBUG] isCollecting will be set false");
      isCollecting = false;
      console.log("[Kairo] decision completed, addSummaryBlock", { decisionCompleted });
      addSummaryBlock(messageDiv, text);
    }
    
    // 履歴を保存
    if (save) {
      saveHistory();
    }
    
    // 安心サマリーを抽出して表示
    const summary = extractSummary(text);
    if (summary) {
      console.log("[Kairo] updateSummaryCard called", { summary, isCollecting });
      updateSummaryCard(summary);
    }
  };
  
  if (blocks && blocks.length > 0) {
    messageDiv.classList.add("has-blocks");
    let blockIndex = 0;
    
    const appendNextBlock = () => {
      if (blockIndex >= blocks.length) {
        finalizeMessage();
        return;
      }
      
      const block = blocks[blockIndex];
      const blockDiv = document.createElement("div");
      blockDiv.className = "message-block";
      messageDiv.appendChild(blockDiv);
      
      const headerDiv = document.createElement("div");
      headerDiv.className = "block-header";
      blockDiv.appendChild(headerDiv);
      
      const contentDiv = document.createElement("div");
      contentDiv.className = "block-content";
      blockDiv.appendChild(contentDiv);
      
      const headerText = block.header ? (block.header.icon + " " + block.header.name) : "";
      
      if (headerText) {
        appendLinesSequentially(headerDiv, headerText, () => {
          appendLinesSequentially(contentDiv, block.content || "", () => {
            blockIndex += 1;
            appendNextBlock();
          });
        });
      } else {
        appendLinesSequentially(contentDiv, block.content || "", () => {
          blockIndex += 1;
          appendNextBlock();
        });
      }
    };
    
    appendNextBlock();
  } else {
    appendLinesSequentially(messageDiv, text, finalizeMessage);
  }
}

// Add summary block to message (まとめブロックを追加)
function addSummaryBlock(messageDiv, fullText) {
  const hasSummaryInText =
    fullText.includes('🌱 最後に') ||
    fullText.includes('💬 最後に') ||
    fullText.includes('🟢 まず安心してください') ||
    fullText.includes('🤝 今の状態について') ||
    fullText.includes('✅ 今すぐやること') ||
    fullText.includes('⏳ 今後の見通し') ||
    fullText.includes('🚨 もし次の症状が出たら') ||
    fullText.includes('📝 いまの状態を整理します') ||
    fullText.includes('⚠️ Kairoが気になっているポイント') ||
    fullText.includes('🏥 Kairoの判断');
  if (hasSummaryInText) {
    return;
  }
  if (messageDiv.dataset.summaryAdded === "true") {
    return;
  }
  if (!messageDiv.dataset.originalText) {
    messageDiv.dataset.originalText = fullText;
  }

  const summaryBlock = createSummaryBlock(fullText);
  
  // まとめブロックのdivを作成
  const blockDiv = document.createElement("div");
  blockDiv.className = "message-block summary-block";
  
  const headerDiv = document.createElement("div");
  headerDiv.className = "block-header";
  headerDiv.textContent = summaryBlock.header;
  blockDiv.appendChild(headerDiv);
  
  const contentDiv = document.createElement("div");
  contentDiv.className = "block-content";
  contentDiv.textContent = summaryBlock.content;
  blockDiv.appendChild(contentDiv);
  
  // メッセージdivに追加
  messageDiv.appendChild(blockDiv);
  messageDiv.dataset.summaryAdded = "true";
  
  // 履歴を保存
  saveHistory();
}

// Update summary card (サマリーカードを更新)
function updateSummaryCard(judgeMeta) {
  console.log("[DEBUG] updateSummaryCard entered", judgeMeta);
  const summaryCard = document.getElementById("summaryCard");
  console.log("[DEBUG] summaryCard element", summaryCard);
  let contentDiv = document.getElementById("summaryCardContent");
  if (!contentDiv) {
    contentDiv = document.createElement("div");
    contentDiv.id = "summaryCardContent";
    contentDiv.className = "summary-card-content";
    summaryCard.appendChild(contentDiv);
  }

  const emoji = judgeMeta?.judgement || "🟢";
  let label = "様子を見ましょう";
  if (emoji === "🟡") {
    label = "注意して様子見をしてください";
  } else if (emoji === "🔴") {
    label = "病院を推奨します";
  }
  const rawText = `${emoji} ${label}`;
  contentDiv.textContent = rawText.length > 20 ? `${rawText.slice(0, 20)}` : rawText;

  summaryCard.style.display = "block";
  summaryCard.style.opacity = "1";
  summaryCard.style.visibility = "visible";
}

// Show initial message
function showInitialMessage() {
  const initialMessage = `あなたの不安と体調を一番に、一緒に考えます`;

  addMessage(initialMessage);
}


function hideSummaryCard() {
  const summaryCard = document.getElementById("summaryCard");
  if (summaryCard) {
    summaryCard.style.opacity = "0";
    summaryCard.style.visibility = "hidden";
  }
}

// Call OpenAI API
async function callOpenAI(message) {
  const conversationId = getConversationId();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
          conversationId: conversationId,
          location: getLocationPayload(),
          clientMeta: {
            lang: navigator.language || "",
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            locationPromptShown: sessionStorage.getItem(LOCATION_PROMPT_KEY) === "true",
          },
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
          console.error("サーバーエラー:", errorData);
        } catch (parseError) {
          const text = await response.text();
          console.error("レスポンステキスト:", text);
          errorMessage = `サーバーエラー (${response.status}): ${text.substring(0, 100)}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
    }
  }

  console.error("API呼び出しエラー:", lastError);
  console.error("エラーの詳細:", {
    message: lastError?.message,
    stack: lastError?.stack,
    name: lastError?.name,
  });
  throw lastError;
}

// Handle user input
async function handleUserInput() {
  const input = document.getElementById("userInput");
  const sendButton = document.getElementById("sendButton");
  const userText = input.value.trim();

  if (!userText) return;

  // Disable input
  input.disabled = true;
  sendButton.disabled = true;

  // Show user message
  addMessage(userText, true);
  input.value = "";

    // Show loading message
    const loadingId = "loading-" + Date.now();
    const loadingDiv = document.createElement("div");
    loadingDiv.id = loadingId;
    loadingDiv.className = "message ai loading";
    loadingDiv.textContent = "考え中...";
    const messagesContainer = document.getElementById("chatMessages");
    messagesContainer.appendChild(loadingDiv);

    try {
      // Call OpenAI API
      const data = await callOpenAI(userText);
      console.log("[DEBUG] full aiResponse", data);
      const aiResponse = data;
      if (aiResponse.conversationId) {
        localStorage.setItem(CONVERSATION_ID_KEY, aiResponse.conversationId);
      }
      const aiMessage = aiResponse.questionPayload
        ? renderQuestionPayload(aiResponse.questionPayload)
        : aiResponse.message;

      // Remove loading message
      const loadingMsg = document.getElementById(loadingId);
      if (loadingMsg) {
        loadingMsg.remove();
      }

      // Show AI response immediately
      if (aiResponse.locationPromptMessage) {
        addMessage(aiResponse.locationPromptMessage);
      }
      if (aiResponse.locationRePromptMessage) {
        addMessage(aiResponse.locationRePromptMessage);
      }
      addMessage(aiMessage);
      if (aiResponse.followUpMessage) {
        addMessage(aiResponse.followUpMessage);
      }
      if (aiResponse.followUpQuestion) {
        addMessage(aiResponse.followUpQuestion);
      }

      console.log("[DEBUG] judgeMeta", aiResponse.judgeMeta);
      if (aiResponse.judgeMeta && aiResponse.judgeMeta.shouldJudge === true) {
        console.log("[DEBUG] force summary render");
        updateSummaryCard(aiResponse.judgeMeta);
      } else {
        hideSummaryCard();
      }
      if (aiResponse.locationState) {
        const normalized = normalizeLocation(aiResponse.locationState);
        storeLocation(normalized);
        updateLocationStatusIndicator(normalized.status);
      }
      } catch (error) {
        // Remove loading message
        const loadingMsg = document.getElementById(loadingId);
        if (loadingMsg) {
          loadingMsg.remove();
        }

        // Show error message with more details
        let errorMessage = "すみません。うまくつながらなかったようです。\n少し時間をおいて、もう一度試してみてください。";
        
        // より詳細なエラー情報をコンソールに出力
        console.error("API呼び出しエラー:", error);
        if (error.message) {
          console.error("エラーメッセージ:", error.message);
        }
        
        // Show error message
        addMessage(errorMessage);
      } finally {
    // Re-enable input
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
}

// Initialize
function init() {
  // Start fresh without re-rendering history
  hideSummaryCard();
  showInitialMessage();
  const storedLocation = normalizeLocation(getStoredLocation());
  updateLocationStatusIndicator(storedLocation?.status || "idle");
  const forceLocationPrompt = sessionStorage.getItem("kairo_force_location_prompt") === "true";
  if (
    (storedLocation?.status !== "usable" && !sessionStorage.getItem(LOCATION_PROMPT_KEY)) ||
    forceLocationPrompt
  ) {
    addMessage(LOCATION_PROMPT_MESSAGE);
    sessionStorage.setItem(LOCATION_PROMPT_KEY, "true");
    if (forceLocationPrompt) {
      sessionStorage.removeItem("kairo_force_location_prompt");
    }
  }
  requestLocationWithRetry(1);
  setTimeout(finalizeLocationPendingIfNeeded, LOCATION_PENDING_TIMEOUT_MS);

  // Send button event
  document.getElementById("sendButton").addEventListener("click", () => {
    requestLocationOnAction();
    handleUserInput();
  });

  const locationButton = document.getElementById("locationButton");
  if (locationButton) {
    locationButton.addEventListener("click", () => {
      requestLocationOnAction();
    });
  }

  // Enter key to send
  document.getElementById("userInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      requestLocationOnAction();
      handleUserInput();
    }
  });

  // Clear button event
  const clearButton = document.getElementById("clearButton");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (confirm("新しい会話を始めますか？現在の会話履歴は削除されます。")) {
        clearHistory();
      }
    });
  }
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", init);

