// API endpoint
const API_URL = "/api/chat";
const CLEAR_URL = "/api/clear";

// Conversation history keys
const HISTORY_KEY = "kairo_chat_history";
const CONVERSATION_ID_KEY = "kairo_conversation_id";
const FIRST_QUESTION_KEY = "kairo_first_question";

const SUBJECTIVE_ALERT_WORDS = ["気になります", "引っかかります", "心配です", "注意が必要です"];

const EMPATHY_OPEN_TEMPLATES = {
  TEMPLATE_EMPATHY_1: "それはつらいですよね。体の不調があると、どうしても気になりますよね。",
  TEMPLATE_EMPATHY_2: "教えてくれてありがとうございます。まずは今の状態を一緒に整理していきましょう。",
  TEMPLATE_EMPATHY_3: "不調があると落ち着かないですよね。ここで一つずつ確認していきましょう。",
};

const EMPATHY_NEXT_TEMPLATES = {
  LOW: {
    empathy: [
      "{subject}、安心材料ですね。",
      "{subject}、ひとつ大事な材料ですね。",
      "{subject}、今の整理が進みますね。",
      "{subject}、ここは落ち着ける情報ですね。",
      "{subject}、状況が見えやすくなりますね。",
      "{subject}、判断の助けになりますね。",
      "{subject}、整理が一段進みますね。",
    ],
    progress: [
      "ここまでで大まかな流れはつかめています。",
      "状況の軸がひとつそろいました。",
      "今の状態の輪郭が少し見えてきました。",
      "ポイントが一つ見えてきました。",
      "ここまでの情報で形が少しはっきりしました。",
      "今の様子が少し言葉にできています。",
      "整理の進み方が見えてきました。",
    ],
    purpose: [
      "次に判断の材料を一つだけ確認させてください。",
      "ここは方向を決めるために聞きますね。",
      "いまの状態を分けるためにここだけ見せてください。",
      "次の一歩を決めるために一点だけ伺います。",
      "安全に整理するために、ここを確認します。",
      "この点が判断の要なので聞きます。",
      "迷いを減らすために、ここだけ確認します。",
    ],
  },
  MEDIUM: {
    empathy: [
      "{subject}、ここは見ておきたいです。",
      "{subject}、状況をもう少し整理したいです。",
      "{subject}、今の流れを一度まとめてみましょう。",
      "{subject}、ここは一度押さえておきたいです。",
      "{subject}、状況が分かると安心しやすいですね。",
      "{subject}、整理していくと見えやすくなりますね。",
    ],
    progress: [
      "ここまでで大まかな流れはつかめています。",
      "状況の軸がひとつそろいました。",
      "今の状態の輪郭が少し見えてきました。",
      "ポイントが一つ見えてきました。",
      "ここまでの情報で形が少しはっきりしました。",
      "今の様子が少し言葉にできています。",
      "整理の進み方が見えてきました。",
    ],
    purpose: [
      "次に判断の材料を一つだけ確認させてください。",
      "ここは方向を決めるために聞きますね。",
      "いまの状態を分けるためにここだけ見せてください。",
      "次の一歩を決めるために一点だけ伺います。",
      "安全に整理するために、ここを確認します。",
      "この点が判断の要なので聞きます。",
      "迷いを減らすために、ここだけ確認します。",
    ],
  },
  HIGH: {
    empathy: [
      "{subject}、気になりますよね。",
      "{subject}、引っかかりますよね。",
      "{subject}、心配になりやすいですよね。",
      "{subject}、注意が必要な感じに見えますね。",
      "{subject}、ここは丁寧に見たいです。",
      "{subject}、一度落ち着いて整理したいですね。",
      "{subject}、いったん確認しておきたいです。",
    ],
    progress: [
      "ここまでで大まかな流れはつかめています。",
      "状況の軸がひとつそろいました。",
      "今の状態の輪郭が少し見えてきました。",
      "ポイントが一つ見えてきました。",
      "ここまでの情報で形が少しはっきりしました。",
      "今の様子が少し言葉にできています。",
      "整理の進み方が見えてきました。",
    ],
    purpose: [
      "次に判断の材料を一つだけ確認させてください。",
      "ここは方向を決めるために聞きますね。",
      "いまの状態を分けるためにここだけ見せてください。",
      "次の一歩を決めるために一点だけ伺います。",
      "安全に整理するために、ここを確認します。",
      "この点が判断の要なので聞きます。",
      "迷いを減らすために、ここだけ確認します。",
    ],
  },
};

function buildSubjectFromNormalizedAnswer(normalized) {
  if (!normalized) return "今の状況は";
  const { slotId, riskLevel, rawAnswer } = normalized;
  if (slotId === "associated_symptoms") {
    if (riskLevel === "LOW") return "これ以外の症状は特にないのは";
    if (riskLevel === "MEDIUM") return "これ以外の症状が少しあるのは";
    return "これ以外の症状がいくつかあるのは";
  }
  if (slotId === "daily_impact") {
    if (riskLevel === "LOW") return "普通に動けるのは";
    if (riskLevel === "MEDIUM") return "少しつらいが動けるのは";
    return "動けないほどつらいのは";
  }
  if (slotId === "worsening") {
    if (riskLevel === "LOW") return "さっきより楽なのは";
    if (riskLevel === "MEDIUM") return "変わらないのは";
    return "悪化しているのは";
  }
  if (slotId === "duration") {
    if (riskLevel === "LOW") return "さっきからの感じは";
    if (riskLevel === "MEDIUM") return "数時間前からの感じは";
    return "一日前から続いているのは";
  }
  if (slotId === "cause_category") {
    if ((rawAnswer || "").includes("思い当たる")) return "きっかけがありそうなのは";
    if ((rawAnswer || "").includes("分からない")) return "きっかけがはっきりしないのは";
    return "きっかけが特に思い当たらないのは";
  }
  if (slotId === "pain_score") {
    if (riskLevel === "LOW") return "痛みが軽めの範囲なのは";
    if (riskLevel === "MEDIUM") return "痛みが中くらいの範囲なのは";
    return "痛みが強めの範囲なのは";
  }
  return "今の状況は";
}

function getRiskTemplates(riskLevel) {
  if (riskLevel === "HIGH") return EMPATHY_NEXT_TEMPLATES.HIGH;
  if (riskLevel === "LOW") return EMPATHY_NEXT_TEMPLATES.LOW;
  return EMPATHY_NEXT_TEMPLATES.MEDIUM;
}

function containsSubjectiveAlertWords(text) {
  return SUBJECTIVE_ALERT_WORDS.some((word) => (text || "").includes(word));
}

function buildIntroLines(templateId, empathyTemplateId, normalizedAnswer, questionIndex) {
  if (EMPATHY_OPEN_TEMPLATES[empathyTemplateId]) {
    return [EMPATHY_OPEN_TEMPLATES[empathyTemplateId]];
  }
  const subject = buildSubjectFromNormalizedAnswer(normalizedAnswer);
  const riskLevel = normalizedAnswer?.riskLevel || "MEDIUM";
  const templates = getRiskTemplates(riskLevel);
  const index = Math.max(0, Math.min(6, Number(templateId.split("_").pop()) - 1 || 0));
  let empathy = templates.empathy[index].replace("{subject}", subject);
  const progress = templates.progress[index];
  const purpose = templates.purpose[index];

  if (riskLevel !== "HIGH" && containsSubjectiveAlertWords(empathy)) {
    empathy = RISK_TEMPLATES.LOW.empathy[index].replace("{subject}", subject);
  }

  const omitProgress = typeof questionIndex === "number" && questionIndex < 3;
  const lines =
    templateId.startsWith("EMPATHY_ONLY")
      ? [empathy]
      : templateId.startsWith("EMPATHY_PROGRESS_PURPOSE")
        ? omitProgress
          ? [empathy, purpose]
          : [empathy, progress, purpose]
        : [empathy, purpose];

  if (riskLevel !== "HIGH" && lines.some((line) => containsSubjectiveAlertWords(line))) {
    lines[0] = EMPATHY_NEXT_TEMPLATES.LOW.empathy[index].replace("{subject}", subject);
  }

  return lines;
}

function renderQuestionPayload(payload, normalizedAnswer) {
  if (!payload || !payload.templateId || !payload.question || !payload.empathyTemplateId) {
    return payload?.question || "";
  }
  const lines = buildIntroLines(
    payload.templateId,
    payload.empathyTemplateId,
    normalizedAnswer,
    payload.questionIndex
  );
  lines.push(payload.question);
  return lines.join("\n");
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
      const aiMessage = aiResponse.questionPayload
        ? renderQuestionPayload(aiResponse.questionPayload, aiResponse.normalizedAnswer)
        : aiResponse.message;

      // Remove loading message
      const loadingMsg = document.getElementById(loadingId);
      if (loadingMsg) {
        loadingMsg.remove();
      }

      // Show AI response immediately
      addMessage(aiMessage);

      console.log("[DEBUG] judgeMeta", aiResponse.judgeMeta);
      if (aiResponse.judgeMeta && aiResponse.judgeMeta.shouldJudge === true) {
        console.log("[DEBUG] force summary render");
        updateSummaryCard(aiResponse.judgeMeta);
      } else {
        hideSummaryCard();
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

  // Send button event
  document.getElementById("sendButton").addEventListener("click", handleUserInput);

  // Enter key to send
  document.getElementById("userInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
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

