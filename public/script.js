// API endpoint
const API_URL = "/api/chat";
const CLEAR_URL = "/api/clear";

// Conversation history keys
const HISTORY_KEY = "kairo_chat_history";
const CONVERSATION_ID_KEY = "kairo_conversation_id";

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
      // AIメッセージの場合、ブロック形式の場合は元のテキストを取得
      if (msg.classList.contains("has-blocks")) {
        const blocks = msg.querySelectorAll('.message-block');
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

// Load conversation history
function loadHistory() {
  const savedHistory = localStorage.getItem(HISTORY_KEY);
  if (savedHistory) {
    const messages = JSON.parse(savedHistory);
    const messagesContainer = document.getElementById("chatMessages");
    messagesContainer.innerHTML = "";
    
    // 最後のAIメッセージからサマリーを抽出
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].isUser) {
        const summary = extractSummary(messages[i].text);
        if (summary) {
          updateSummaryCard(summary);
        }
        break;
      }
    }
    
    // 履歴を復元（タイピングアニメーションなしで即座に表示）
    messages.forEach((msg, index) => {
      if (msg.isUser) {
        // ユーザーメッセージは即座に表示
        const messageDiv = document.createElement("div");
        messageDiv.className = "message user";
        messageDiv.textContent = msg.text;
        messagesContainer.appendChild(messageDiv);
      } else {
        // AIメッセージは履歴なので即座に表示（タイピングアニメーションなし）
        const blocks = parseAIMessage(msg.text);
        const messageDiv = document.createElement("div");
        messageDiv.className = `message ai ${blocks && blocks.length > 0 ? 'has-blocks' : ''}`;
        
        if (blocks && blocks.length > 0) {
          blocks.forEach(block => {
            const blockDiv = document.createElement("div");
            blockDiv.className = "message-block";
            
            if (block.header) {
              const headerDiv = document.createElement("div");
              headerDiv.className = "block-header";
              headerDiv.textContent = block.header.icon + ' ' + block.header.name;
              blockDiv.appendChild(headerDiv);
            }
            
            const contentDiv = document.createElement("div");
            contentDiv.className = "block-content";
            contentDiv.textContent = block.content;
            blockDiv.appendChild(contentDiv);
            
            messageDiv.appendChild(blockDiv);
          });
        } else {
          messageDiv.textContent = msg.text;
        }
        
        messagesContainer.appendChild(messageDiv);
        
        // 判断が完了していて、まだまとめブロックが含まれていない場合は追加
        const decisionCompleted = isDecisionCompleted(msg.text);
        if (decisionCompleted && !msg.text.includes('🌱 最後に') && !msg.text.includes('💬 最後に')) {
          addSummaryBlock(messageDiv, msg.text);
        }
      }
    });
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Clear conversation history
function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(CONVERSATION_ID_KEY);
  const messagesContainer = document.getElementById("chatMessages");
  messagesContainer.innerHTML = "";

  // 安心サマリーを非表示
  const summaryCard = document.getElementById("summaryCard");
  if (summaryCard) {
    summaryCard.style.display = "none";
    summaryCard.innerHTML = "";
  }

  const input = document.getElementById("userInput");
  const button = document.getElementById("sendButton");
  input.disabled = false;
  button.disabled = false;
  input.placeholder = "どんな感じですか？";

  // Clear server-side history
  fetch(CLEAR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId: getConversationId() }),
  }).catch((err) => console.error("履歴クリアエラー:", err));

  // Start new conversation
  showInitialMessage();
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
    '今は[様子見/市販薬/病院に行くこと]だと私は判断します',
    '病院に行くことをおすすめします',
    '病院をおすすめします'
  ];
  
  // 判断を示すブロックが含まれているか
  const hasDecisionBlock = decisionIndicators.some(indicator => text.includes(indicator));
  
  // ただし、最後のまとめセクション（🌱 最後に、💬 最後に）は既に含まれているかチェック
  const hasSummaryBlock = text.includes('🌱 最後に') || text.includes('💬 最後に');
  
  // 判断ブロックが含まれていて、まとめブロックがまだ含まれていない場合、判断完了とみなす
  // または、既にまとめブロックが含まれている場合も判断完了とみなす（重複表示を防ぐ）
  return hasDecisionBlock;
}

// Get urgency level from AI message (緊急度を判定)
function getUrgencyLevel(text) {
  // 病院をおすすめする場合
  if (text.includes('🏥 Kairoの判断') || text.includes('病院をおすすめします') || text.includes('病院に行くことをおすすめします')) {
    return 'high'; // 🔴
  }
  
  // 緊急性が高い場合
  if (text.includes('緊急性が高い') || text.includes('緊急性：高') || text.includes('緊急性：中')) {
    return 'medium'; // 🟡
  }
  
  // 様子見/市販薬の場合
  if (text.includes('🟢 まず安心してください') || text.includes('様子見') || text.includes('市販薬')) {
    return 'low'; // 🟢
  }
  
  // デフォルトは低緊急性
  return 'low';
}

// Create summary block (まとめブロックを作成)
function createSummaryBlock(text) {
  const urgencyLevel = getUrgencyLevel(text);
  
  let headerIcon = '🟢';
  let headerText = 'まず安心してください';
  let summaryContent = '';
  
  if (urgencyLevel === 'high') {
    headerIcon = '🔴';
    headerText = '今回は病院をおすすめします';
    
    // 判断を抽出（🏥 セクションから）
    const hospitalMatch = text.match(/🏥[^⸻]*?Kairoの判断[^⸻]*?\*\*([^*]+)\*\*/s);
    if (hospitalMatch) {
      summaryContent = hospitalMatch[1].trim() + '\n\n専門家の確認が必要です。\n一人で判断しなくて大丈夫です。';
    } else {
      // 別のパターンで判断を抽出
      const judgmentMatch = text.match(/\*\*([^*]+)\*\*/);
      if (judgmentMatch && text.includes('病院')) {
        summaryContent = judgmentMatch[1].trim() + '\n\n専門家の確認が必要です。\n一人で判断しなくて大丈夫です。';
      } else {
        summaryContent = '専門家の確認が必要です。\n一人で判断しなくて大丈夫です。';
      }
    }
  } else if (urgencyLevel === 'medium') {
    headerIcon = '🟡';
    headerText = '今日は注意しながら過ごしましょう';
    
    // 判断を抽出
    const judgmentMatch = text.match(/\*\*([^*]+)\*\*/);
    if (judgmentMatch) {
      summaryContent = judgmentMatch[1].trim() + '\n\n様子を見ながら、必要に応じて専門家に相談しましょう。\nまた不安になったら、いつでもここで聞いてください。';
    } else {
      summaryContent = '様子を見ながら、必要に応じて専門家に相談しましょう。\nまた不安になったら、いつでもここで聞いてください。';
    }
  } else {
    headerIcon = '🟢';
    headerText = 'まず安心してください';
    
    // 判断を抽出（🤝 セクションから）
    const stateMatch = text.match(/🤝[^⸻]*?今の状態について[^⸻]*?\*\*([^*]+)\*\*/s);
    if (stateMatch) {
      summaryContent = stateMatch[1].trim() + '\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。';
    } else {
      // 別のパターンで判断を抽出
      const judgmentMatch = text.match(/\*\*([^*]+)\*\*/);
      if (judgmentMatch) {
        summaryContent = judgmentMatch[1].trim() + '\n\n今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。';
      } else {
        summaryContent = '今の状態を確認しながら、様子を見ていきましょう。\nまた不安になったら、いつでもここで聞いてください。';
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

// Add message to chat with typing animation for AI messages
function addMessage(text, isUser = false, save = true) {
  const messagesContainer = document.getElementById("chatMessages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${isUser ? "user" : "ai"}`;
  
  if (isUser) {
    // User messages: show immediately
    messageDiv.textContent = text;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } else {
    // AI messages: Check if it should be parsed into blocks
    const blocks = parseAIMessage(text);
    
    messageDiv.className += " typing";
    messagesContainer.appendChild(messageDiv);
    
    if (blocks && blocks.length > 0) {
      // ブロック形式のメッセージ: ブロックごとにタイピング
      messageDiv.classList.add("has-blocks");
      messageDiv.innerHTML = '';
      
      let currentBlockIndex = 0;
      let currentCharIndex = 0;
      let isTypingHeader = true; // 見出しをタイピング中かどうか
      
      // 各ブロックの構造を作成（最初は全て空）
      const blockElements = blocks.map((block) => {
        const blockDiv = document.createElement("div");
        blockDiv.className = "message-block";
        blockDiv.style.display = "none"; // 最初は非表示
        
        const headerDiv = document.createElement("div");
        headerDiv.className = "block-header";
        headerDiv.textContent = ''; // 最初は空
        blockDiv.appendChild(headerDiv);
        
        const contentDiv = document.createElement("div");
        contentDiv.className = "block-content";
        contentDiv.textContent = ''; // 最初は空
        blockDiv.appendChild(contentDiv);
        
        messageDiv.appendChild(blockDiv);
        
        // 見出しテキストとコンテンツテキストを準備
        const headerText = block.header ? (block.header.icon + ' ' + block.header.name) : '';
        return { blockDiv, headerDiv, contentDiv, headerText, content: block.content || '' };
      });
      
      // タイピングアニメーション（ブロックごと、1文字ずつ）
      function typeNextChar() {
        if (currentBlockIndex >= blockElements.length) {
          // すべてのブロックが完了
          messageDiv.classList.add("show");
          messageDiv.classList.remove("typing");
          
          // 判断が完了しているかチェック
          const decisionCompleted = isDecisionCompleted(text);
          
          // 判断が完了していて、まだまとめブロックが含まれていない場合
          if (decisionCompleted && !text.includes('🌱 最後に') && !text.includes('💬 最後に')) {
            // まとめブロックを自動的に追加
            setTimeout(() => {
              addSummaryBlock(messageDiv, text);
            }, 500); // 少し遅延させて自然な流れにする
          }
          
          // タイピング完了後に履歴を保存
          if (save) {
            saveHistory();
          }
          
          // 安心サマリーを抽出して表示
          const summary = extractSummary(text);
          if (summary) {
            updateSummaryCard(summary);
          }
          return;
        }
        
        const currentBlock = blockElements[currentBlockIndex];
        
        // 現在のブロックを表示
        if (currentBlock.blockDiv.style.display === "none") {
          currentBlock.blockDiv.style.display = "block";
        }
        
        if (isTypingHeader && currentBlock.headerText) {
          // 見出しをタイピング中
          if (currentCharIndex < currentBlock.headerText.length) {
            currentBlock.headerDiv.textContent = currentBlock.headerText.substring(0, currentCharIndex + 1);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            currentCharIndex++;
            setTimeout(typeNextChar, 40);
          } else {
            // 見出し完了、コンテンツに移行
            isTypingHeader = false;
            currentCharIndex = 0;
            setTimeout(typeNextChar, 100); // 見出しとコンテンツの間の間隔
          }
        } else {
          // コンテンツをタイピング中
          const fullContent = currentBlock.content;
          if (currentCharIndex < fullContent.length) {
            // 1文字ずつ追加（改行（\n）も含めて保持）
            const displayedText = fullContent.substring(0, currentCharIndex + 1);
            currentBlock.contentDiv.textContent = displayedText;
            
            // スクロールを自然に追従
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            currentCharIndex++;
            
            // 40ms/文字の速度で表示（体調が悪い人向けにゆっくりめ）
            setTimeout(typeNextChar, 40);
          } else {
            // 現在のブロックが完了、次のブロックへ
            currentBlockIndex++;
            currentCharIndex = 0;
            isTypingHeader = true;
            // ブロック間の少し長めの間隔（200ms）
            setTimeout(typeNextChar, 200);
          }
        }
      }
      
      // タイピング開始（少し遅延させて見やすく）
      setTimeout(typeNextChar, 100);
    } else {
      // 通常のメッセージ（ブロック形式でない場合）: 1文字ずつタイピング
      let charIndex = 0;
      
      function typeChar() {
        if (charIndex < text.length) {
          // 改行（\n）を保持しながら1文字ずつ追加
          messageDiv.textContent = text.substring(0, charIndex + 1);
          
          // スクロールを自然に追従
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          
          charIndex++;
          
          // 40ms/文字の速度で表示（体調が悪い人向けにゆっくりめ）
          setTimeout(typeChar, 40);
        } else {
          // タイピング完了
          messageDiv.classList.add("show");
          messageDiv.classList.remove("typing");
          
          // 判断が完了しているかチェック
          const decisionCompleted = isDecisionCompleted(text);
          
          // 判断が完了していて、まだまとめブロックが含まれていない場合
          if (decisionCompleted && !text.includes('🌱 最後に') && !text.includes('💬 最後に')) {
            // まとめブロックを自動的に追加
            setTimeout(() => {
              addSummaryBlock(messageDiv, text);
            }, 500); // 少し遅延させて自然な流れにする
          }
          
          // タイピング完了後に履歴を保存
          if (save) {
            saveHistory();
          }
          
          // 安心サマリーを抽出して表示
          const summary = extractSummary(text);
          if (summary) {
            updateSummaryCard(summary);
          }
        }
      }
      
      // タイピング開始
      setTimeout(typeChar, 100);
    }
  }
}

// Add summary block to message (まとめブロックを追加)
function addSummaryBlock(messageDiv, fullText) {
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
  
  // スクロールを自然に追従
  const messagesContainer = document.getElementById("chatMessages");
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  // 履歴を保存
  saveHistory();
}

// Update summary card (サマリーカードを更新)
function updateSummaryCard(summary) {
  const summaryCard = document.getElementById("summaryCard");
  
  if (summary && summaryCard) {
    // 既存のコンテンツをクリア
    summaryCard.innerHTML = '';
    
    // 新しいコンテンツを作成
    const contentDiv = document.createElement("div");
    contentDiv.id = "summaryCardContent";
    contentDiv.className = "summary-card-content";
    contentDiv.textContent = summary;
    summaryCard.appendChild(contentDiv);
    
    // サマリーカードを表示
    summaryCard.style.display = "block";
  } else if (!summary && summaryCard) {
    // サマリーがない場合は非表示
    summaryCard.style.display = "none";
    summaryCard.innerHTML = '';
  }
}

// Show initial message
function showInitialMessage() {
  const initialMessage = `あなたの不安と体調を一番に、一緒に考えます`;

  addMessage(initialMessage);
}

// Call OpenAI API
async function callOpenAI(message) {
  try {
    const conversationId = getConversationId();

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
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error("API呼び出しエラー:", error);
    throw error;
  }
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
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      // Call OpenAI API
      const aiResponse = await callOpenAI(userText);

      // Remove loading message
      const loadingMsg = document.getElementById(loadingId);
      if (loadingMsg) {
        loadingMsg.remove();
      }

      // 少し遅延してからタイピングアニメーションを開始（自然な流れ）
      setTimeout(() => {
        // Show AI response with typing animation (1文字ずつ表示)
        addMessage(aiResponse);
      }, 300);
  } catch (error) {
    // Remove loading message
    const loadingMsg = document.getElementById(loadingId);
    if (loadingMsg) {
      loadingMsg.remove();
    }

    // Show error message
    addMessage(
      "すみません。うまくつながらなかったようです。\n少し時間をおいて、もう一度試してみてください。"
    );
    console.error("エラー:", error);
  } finally {
    // Re-enable input
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
}

// Initialize
function init() {
  // Load saved history
  const savedHistory = localStorage.getItem(HISTORY_KEY);

  if (savedHistory) {
    loadHistory();
  } else {
    showInitialMessage();
  }

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

