// API endpoint
const API_URL = "/api/chat";
const CLEAR_URL = "/api/clear";
const STATE_PATTERNS_URL = "/api/state-patterns";
const ACTION_DETAILS_URL = "/api/action-details";
const HOSPITAL_DETAILS_URL = "/api/hospital-details";

// Conversation history keys
const HISTORY_KEY = "kairo_chat_history";
const CONVERSATION_ID_KEY = "kairo_conversation_id";
const FIRST_QUESTION_KEY = "kairo_first_question";

const SUBJECTIVE_ALERT_WORDS = ["気になります", "引っかかります", "心配です", "注意が必要です"];
const FEATURE_SHOW_LOCATION_EXPLANATION = false;
const QUESTION_DELAY_MS = 500;
const DEFAULT_FOLLOW_UP_QUESTION = "今は少し休むだけでも良さそうです。\nこのまま休みますか？\nそれとも、もう少し詳しく確認しますか？";

/** フォロー文かどうか判定。未確認経路（履歴復元等）からのフォロー表示をブロックするため */
function isFollowUpContent(text) {
  if (!text || typeof text !== "string") return false;
  const t = String(text).normalize("NFC").trim();
  return (
    (t.includes("このまま休みますか？") && t.includes("それとも、もう少し詳しく確認しますか？")) ||
    (t.includes("ここで整理しますか？") && t.includes("一緒に考えますか？")) ||
    t.includes("伝え方を一緒に考えますか？") ||
    t.startsWith("今は少し休むだけでも良さそうです") ||
    t.startsWith("今の症状から見ると、念のため病院で") ||
    t.startsWith("もしよろしければ、")
  );
}

/** メッセージ末尾のフォロー文を除去（LLM出力に混入した場合の対策） */
function stripFollowUpFromMessage(text) {
  if (!text || typeof text !== "string") return text;
  let t = String(text).normalize("NFC").trim();
  const patterns = [
    /\n\n今は少し休むだけでも良さそうです。\s*\nこのまま休みますか？\s*\nそれとも、もう少し詳しく確認しますか？\s*$/,
    /\n\n今の症状から見ると、念のため病院で[\s\S]*?一緒に考えますか？\s*$/,
    /\n\nもしよろしければ、[\s\S]*?一緒に考えましょうか？[\s\S]*$/,
  ];
  for (const p of patterns) {
    t = t.replace(p, "");
  }
  return t.trim();
}

const appState = {
  riskLevel: null,
  userHasSubmitted: false,
  painScore: null,
  slots: {},
  sectionTimers: [],
  concreteModalBusy: false,
  conversationStep: 0,
  triageCompleted: false,
  triageLevel: null,
  summaryGenerated: false,
  collectedAnswers: {},
  symptomDuration: null,
  painLevel: null,
  location: null,
  redFlagDetected: false,
};

function resetConversation() {
  appState.conversationStep = 0;
  appState.triageCompleted = false;
  appState.triageLevel = null;
  appState.summaryGenerated = false;
  appState.collectedAnswers = {};
  appState.symptomDuration = null;
  appState.painLevel = null;
  appState.location = null;
  appState.redFlagDetected = false;
  appState.riskLevel = null;
  appState.userHasSubmitted = false;
  appState.painScore = null;
  appState.slots = {};
}

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

// DO NOT reintroduce location explanation bubble.
// UX policy: header status only.
const LOCATION_PROMPT_MESSAGE = "";
const LOCATION_REPROMPT_MESSAGE = "";
const LOCATION_PROMPT_KEY = "kairo_location_prompt_shown";
const LOCATION_RETRY_KEY = "kairo_location_retry_count";
const LOCATION_SNAPSHOT_KEY = "kairo_location_snapshot";

function renderQuestionPayload(payload) {
  if (!payload || !payload.question) {
    return payload?.question || "";
  }
  const parts = [];
  if (payload.safetyLine) {
    parts.push(payload.safetyLine);
  }
  if (Array.isArray(payload.introTemplateIds) && payload.introTemplateIds.length > 0) {
    const introLines = payload.introTemplateIds
      .map((id) => INTRO_TEMPLATE_TEXTS[id])
      .filter(Boolean);
    parts.push(...introLines);
  }
  parts.push(payload.question);
  return parts.join("\n");
}

function splitHeaderIconAndName(headerText = "") {
  const raw = String(headerText || "").trim();
  const match = raw.match(/^(\S+)\s*(.*)$/);
  if (!match) return { icon: "", name: raw };
  return {
    icon: match[1] || "",
    name: (match[2] || "").trim(),
  };
}

function appendHeaderTitleWithIcon(headerDiv, iconText, nameText) {
  const titleWrap = document.createElement("div");
  titleWrap.className = "section-title";
  const iconEl = document.createElement("span");
  iconEl.className = "section-icon";
  iconEl.textContent = iconText || "";
  const labelEl = document.createElement("span");
  labelEl.className = "block-header-title";
  titleWrap.appendChild(iconEl);
  titleWrap.appendChild(labelEl);
  headerDiv.appendChild(titleWrap);
  labelEl.textContent = nameText || "";
  return labelEl;
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
  if (!raw) return null;
  if (raw.lat != null && raw.lng != null) {
    return { lat: raw.lat, lng: raw.lng, ts: raw.ts };
  }
  return null;
}

function updateLocationStatusIndicator(status) {
  const target = document.getElementById("locationStatus");
  if (!target) return;
  target.style.display = "inline-flex";
  target.classList.remove("location-status--usable", "location-status--requesting", "location-status--failed");
  if (status === "usable") {
    target.textContent = "📍現在地を確認済み";
    target.classList.add("location-status--usable");
  } else if (status === "requesting") {
    target.textContent = "📍現在地を確認中";
    target.classList.add("location-status--requesting");
  } else {
    target.textContent = "📍現在地を未確認";
    target.classList.add("location-status--failed");
  }
  const button = document.getElementById("locationButton");
  if (button) {
    const promptShown = sessionStorage.getItem(LOCATION_PROMPT_KEY) === "true";
    button.style.display = status === "usable" || promptShown ? "none" : "inline-flex";
  }
}

function getLocationSnapshot() {
  try {
    const raw = sessionStorage.getItem(LOCATION_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function setLocationSnapshot(snapshot) {
  try {
    sessionStorage.setItem(LOCATION_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (_) {
    // ignore
  }
}

function getLocationPayload() {
  return getLocationSnapshot();
}

function requestLocationOnAction() {
  try {
    if (!navigator.geolocation) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;
    if (getLocationSnapshot()) return;
    updateLocationStatusIndicator("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const snapshot = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: Date.now(),
        };
        setLocationSnapshot(snapshot);
        storeLocation(snapshot);
        updateLocationStatusIndicator("usable");
      },
      (err) => {
        storeLocation({ error: err?.code === 1 ? "denied" : err?.code === 3 ? "timeout" : "error" });
        updateLocationStatusIndicator("failed");
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
    );
  } catch (_) {
    // ignore (fallback handled server-side)
  }
}

function requestLocationWithRetry(attempt = 1) {
  if (getLocationSnapshot()) return;
  if (attempt > 3) return;
  requestLocationOnAction();
  const delay = 500 + Math.floor(Math.random() * 500);
  setTimeout(() => {
    if (getLocationSnapshot()) return;
    requestLocationWithRetry(attempt + 1);
  }, delay);
}

function finalizeLocationPendingIfNeeded() {
  if (getLocationSnapshot()) return;
  updateLocationStatusIndicator("failed");
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
            const headerText = header.dataset.headerText || header.textContent;
            fullText += headerText + '\n\n';
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

// Load conversation history (再描画は行わない。将来実装する場合も、addMessageのフォローガードにより未許可経路からのフォロー表示はブロックされる)
function loadHistory() {
  return;
}

// Clear conversation history（完全初期化。部分リセット禁止）
function clearHistory() {
  resetConversation();
  const conversationIdToClear = localStorage.getItem(CONVERSATION_ID_KEY) || getConversationId();
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(CONVERSATION_ID_KEY);
  localStorage.removeItem(FIRST_QUESTION_KEY);
  sessionStorage.removeItem("kairo_location");
  sessionStorage.removeItem(LOCATION_PROMPT_KEY);
  sessionStorage.removeItem(LOCATION_SNAPSHOT_KEY);
  sessionStorage.removeItem(LOCATION_RETRY_KEY);
  sessionStorage.setItem("kairo_force_location_prompt", "true");
  fetch(CLEAR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId: conversationIdToClear }),
  })
    .catch((err) => console.error("履歴クリアエラー:", err))
    .finally(() => {
      hideSummaryCard();
      clearSectionTimers();
      window.location.reload();
    });
}

// Parse AI message into blocks (cards)
function parseAIMessage(text) {
  // 見出しアイコンのパターン（様子見/市販薬の場合 + 病院をおすすめする場合）
  const headerPatterns = [
    // 様子見/市販薬の場合
    { icon: '🟢', name: 'ここまでの情報を整理します' },
    { icon: '🤝', name: '今の状態について' },
    { icon: '✅', name: '今すぐやること' },
    { icon: '⏳', name: '今後の見通し' },
    { icon: '🚨', name: 'もし次の症状が出たら' },
    { icon: '💊', name: '一般的な市販薬' },
    { icon: '🌱', name: '最後に' },
    // 病院をおすすめする場合
    { icon: '📝', name: '今の状態について' },
    { icon: '📝', name: 'いまの状態を整理します（メモ）' },
    { icon: '🏥', name: '受診先の候補' },
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

function extractStateFactsFromBlock(content) {
  const text = String(content || "");
  const bullets = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^・/.test(line))
    .map((line) => line.replace(/^・\s*/, ""))
    .slice(0, 8);
  const boldMatch = text.match(/\*\*([^*]+)\*\*/);
  if (boldMatch && boldMatch[1]) {
    const kw = boldMatch[1].trim();
    if (kw.length >= 2 && kw.length <= 20 && !bullets.includes(kw)) {
      return [kw, ...bullets].slice(0, 8);
    }
  }
  return bullets;
}

function ensureConcreteModal() {
  let overlay = document.getElementById("concreteModalOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "concreteModalOverlay";
  overlay.className = "concrete-modal-overlay";
  overlay.innerHTML = `
    <div class="concrete-modal-card" role="dialog" aria-modal="true" aria-labelledby="concreteModalTitle">
      <div class="concrete-modal-header">
        <div id="concreteModalTitle" class="concrete-modal-title">あなたの状態の理解を深める</div>
        <button id="concreteModalClose" class="concrete-modal-close" type="button" aria-label="閉じる">✕</button>
      </div>
      <div id="concreteModalBody" class="concrete-modal-body">整理中です…</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const closeButton = overlay.querySelector("#concreteModalClose");
  if (closeButton) {
    closeButton.addEventListener("click", () => closeConcreteModal());
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeConcreteModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeConcreteModal();
  });
  return overlay;
}

function openConcreteModal() {
  const overlay = ensureConcreteModal();
  overlay.classList.add("is-open");
}

function closeConcreteModal() {
  const overlay = document.getElementById("concreteModalOverlay");
  if (!overlay) return;
  overlay.classList.remove("is-open");
}

function setConcreteModalBody(textOrStructured) {
  const body = document.getElementById("concreteModalBody");
  if (!body) return;
  body.innerHTML = "";
  if (typeof textOrStructured === "string") {
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.fontFamily = "inherit";
    pre.style.margin = "0";
    pre.textContent = textOrStructured || "";
    body.appendChild(pre);
    return;
  }
  if (textOrStructured && typeof textOrStructured === "object" && textOrStructured.structured) {
    renderStructuredStateModal(body, textOrStructured);
    return;
  }
}

function renderStructuredStateModal(body, { structured, message, triageLevel }) {
  const s = structured;
  if (!s) {
    body.textContent = message || "";
    return;
  }
  const showRareByDefault = triageLevel === "🔴";
  const lines = [];
  lines.push("🟢 よくある原因");
  (s.common || []).forEach((c) => lines.push(c.startsWith("・") ? c : `・${c}`));
  lines.push("");
  lines.push("🟡 状況によっては確認が必要");
  (s.conditional || []).forEach((c) => lines.push(c.startsWith("・") ? c : `・${c}`));
  lines.push("");
  lines.push(s.reassuranceCommon || "");
  if (triageLevel === "🟢" || triageLevel === "🟡") {
    lines.push("");
    lines.push("現時点の安心材料");
    (s.reassuranceBullets || []).forEach((b) => lines.push(b));
    lines.push("");
    lines.push("こんな変化があれば受診を検討");
    (s.consultChangeBullets || []).forEach((b) => lines.push(b));
  } else if (triageLevel === "🔴") {
    lines.push("");
    lines.push("今回受診をおすすめしている理由");
    (s.redVisitReasonsBullets || []).forEach((b) => lines.push(b));
    lines.push("");
    lines.push("これらがあるため、一度医療機関で確認しておくと安心です。");
  }
  const rareItems = s.rare_emergency || [];
  const hasRare = rareItems.length > 0;

  body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.fontFamily = "inherit";
  pre.style.margin = "0";
  pre.textContent = lines.join("\n");

  if (hasRare) {
    const rareSection = document.createElement("div");
    rareSection.style.marginTop = "12px";
    rareSection.style.borderTop = "1px solid #e0e0e0";
    rareSection.style.paddingTop = "12px";
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "block-header-action";
    toggleBtn.style.marginBottom = "8px";
    toggleBtn.textContent = showRareByDefault ? "🔴 すぐ受診が必要なサイン（表示中）" : "強い症状がある場合はこちら";
    const rarePre = document.createElement("pre");
    rarePre.style.whiteSpace = "pre-wrap";
    rarePre.style.fontFamily = "inherit";
    rarePre.style.margin = "0";
    rarePre.textContent = "🔴 すぐ受診が必要なサイン\n" + rareItems.map((r) => (r.startsWith("・") ? r : `・${r}`)).join("\n");
    rarePre.style.display = showRareByDefault ? "block" : "none";
    toggleBtn.addEventListener("click", () => {
      const isHidden = rarePre.style.display === "none";
      rarePre.style.display = isHidden ? "block" : "none";
      toggleBtn.textContent = isHidden ? "🔴 すぐ受診が必要なサイン（表示中）" : "強い症状がある場合はこちら";
    });
    rareSection.appendChild(toggleBtn);
    rareSection.appendChild(rarePre);
    body.appendChild(pre);
    body.appendChild(rareSection);
  } else {
    body.appendChild(pre);
  }
}

async function fetchStatePatterns(blockContent) {
  const conversationId = getConversationId();
  const summaryFacts = extractStateFactsFromBlock(blockContent);
  const response = await fetch(STATE_PATTERNS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId,
      summaryFacts,
      summarySection: String(blockContent || ""),
    }),
  });
  if (!response.ok) {
    throw new Error(`state-patterns status=${response.status}`);
  }
  const data = await response.json();
  return {
    message: data?.message || "このような症状では、情報を追加で整理すると判断の見通しが立てやすくなります。",
    structured: data?.structured || null,
    triageLevel: data?.triageLevel || null,
  };
}

async function showConcreteStateDetails(blockContent) {
  if (appState.concreteModalBusy) return;
  appState.concreteModalBusy = true;
  openConcreteModal();
  setConcreteModalBody("原因を整理しています…");
  try {
    const data = await fetchStatePatterns(blockContent);
    if (data.structured) {
      setConcreteModalBody({ message: data.message, structured: data.structured, triageLevel: data.triageLevel });
    } else {
      setConcreteModalBody(data.message);
    }
  } catch (error) {
    console.error("具体化モーダル生成エラー:", error);
    setConcreteModalBody(
      [
        "あなたの状態の理解を深める",
        "",
        "今の状態は、次のようなパターンと似ています。",
        "",
        "■ 一時的な体調変化のパターン",
        "このような症状では、日内の負荷や睡眠、食事などで一時的に不調が強まることがあります。",
        "",
        "現時点の安心材料",
        "・今わかっている範囲では、強い緊急サインははっきりしていません",
        "",
        "こんな変化があれば受診を検討",
        "・痛みやつらさが急に強くなる",
        "・動きづらさがはっきり増える",
        "・新しい強い症状が加わる",
      ].join("\n")
    );
  } finally {
    appState.concreteModalBusy = false;
  }
}

async function fetchActionDetails(blockContent) {
  const conversationId = getConversationId();
  const response = await fetch(ACTION_DETAILS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId,
      actionSection: String(blockContent || ""),
    }),
  });
  if (!response.ok) {
    throw new Error(`action-details status=${response.status}`);
  }
  const data = await response.json();
  return data?.message || "いまの行動を具体化できませんでした。少し時間をおいてもう一度お試しください。";
}

async function showConcreteActionDetails(blockContent) {
  if (appState.concreteModalBusy) return;
  appState.concreteModalBusy = true;
  openConcreteModal();
  setConcreteModalBody("いまの行動を、検索情報をもとに具体化しています…");
  try {
    const detailText = await fetchActionDetails(blockContent);
    setConcreteModalBody(detailText);
  } catch (error) {
    console.error("行動具体化モーダル生成エラー:", error);
    setConcreteModalBody(
      [
        "いまの経過であれば、少し力を抜いて体の負担を整える時間として受け止められます。",
        "",
        "■今すぐやること",
        "・刺激を1つ減らし、水分を150〜200mlとって4〜6時間の変化を見てください",
        "→ 体への負荷要因を減らすと、症状のぶれを把握しやすくなります。",
        "",
        "■やらないほうがいいこと",
        "・強い刺激を続けたまま無理に作業を続ける",
        "→ 負荷が重なると、回復の見通しを読みづらくすることがあります。",
      ].join("\n")
    );
  } finally {
    appState.concreteModalBusy = false;
  }
}

async function fetchHospitalDetails() {
  const conversationId = getConversationId();
  const response = await fetch(HOSPITAL_DETAILS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId }),
  });
  if (!response.ok) {
    throw new Error(`hospital-details status=${response.status}`);
  }
  const data = await response.json();
  return data?.message || "受診先の詳細を取得できませんでした。";
}

async function showConcreteHospitalDetails() {
  if (appState.concreteModalBusy) return;
  appState.concreteModalBusy = true;
  openConcreteModal();
  setConcreteModalBody("受診先の詳細を取得しています…");
  try {
    const detailText = await fetchHospitalDetails();
    setConcreteModalBody(detailText);
  } catch (error) {
    console.error("受診先モーダル生成エラー:", error);
    setConcreteModalBody("受診先の詳細を取得できませんでした。近くの医療機関を検索してご確認ください。");
  } finally {
    appState.concreteModalBusy = false;
  }
}

// Check if decision is completed (判断が完了しているかチェック)
function isDecisionCompleted(text) {
  // 判断を示すブロックが含まれているかチェック
  const decisionIndicators = [
    '🟢 ここまでの情報を整理します',
    '🤝 今の状態について',
    '✅ 今すぐやること',
    '⏳ 今後の見通し',
    '🚨 もし次の症状が出たら',
    '🏥 受診先の候補',
    '📝 今の状態について',
    '📝 いまの状態を整理します',
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
  // Single source of truth: server judgement -> appState.riskLevel
  if (appState.riskLevel === "RED") return "high";
  if (appState.riskLevel === "YELLOW") return "medium";
  if (appState.riskLevel === "GREEN") return "low";

  // 病院をおすすめする場合
  if (
    text.includes('🏥 受診先の候補') ||
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
    text.includes('🟢 ここまでの情報を整理します') ||
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
  let headerText = 'ここまでの情報を整理します';
  let summaryContent = '';
  const actionSuffix = '\n👉 これ以上、何かする必要はありません。';
  
  if (urgencyLevel === 'high') {
    headerIcon = '🔴';
    headerText = '今回は病院をおすすめします';
    
    // 判断を抽出（🏥 セクションから）
    const hospitalMatch = text.match(/🏥[^⸻]*?(?:受診先の候補|Kairoの判断)[^⸻]*?\*\*([^*]+)\*\*/s);
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
    headerText = 'ここまでの情報を整理します';
    
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
    headerText = 'ここまでの情報を整理します';
    
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
  const hospitalMatch = text.match(/🏥[^⸻]*?(?:受診先の候補|Kairoの判断)[^⸻]*?([^⸻]*?)⸻/s);
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
function addMessage(text, isUser = false, save = true, options = {}) {
  const raw = String(text || "");
  if (!isUser && !raw.trim()) return;
  if (!isUser && isFollowUpContent(raw) && !options.fromFollowUpTrigger) return;
  if (!isUser) {
    if (
      FEATURE_SHOW_LOCATION_EXPLANATION !== true &&
      (raw.includes("より正確な案内のため") ||
        raw.includes("現在地を使用できます") ||
        raw.includes("今回は許可しなくても会話は続けられます"))
    ) {
      return;
    }
  }
  const messagesContainer = document.getElementById("chatMessages");
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${isUser ? "user" : "ai"}`;
  if (options.animateFromTop) {
    messageDiv.classList.add("message--animate-from-top");
  }

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
    // summary card is rendered from appState only
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
      headerDiv.dataset.headerText = headerText;
      const isStateBlock =
        (block?.header?.icon === "🤝" || block?.header?.icon === "📝") &&
        /今の状態について|いまの状態を整理します/.test(block?.header?.name || "");
      const isActionBlock =
        block?.header?.icon === "✅" &&
        /今すぐやること/.test(block?.header?.name || "");
      const isHospitalBlock =
        block?.header?.icon === "🏥" &&
        /受診先の候補|Kairoの判断/.test(block?.header?.name || "");
      const showActionDetailButton = isActionBlock && appState.riskLevel !== "RED";
      let detailButton = null;
      const iconText = block?.header?.icon || splitHeaderIconAndName(headerText).icon;
      const nameText = block?.header?.name || splitHeaderIconAndName(headerText).name;
      const headerTitleEl = appendHeaderTitleWithIcon(headerDiv, iconText, "");
      if (isStateBlock || showActionDetailButton || isHospitalBlock) {
        detailButton = document.createElement("button");
        detailButton.type = "button";
        detailButton.className = "block-header-action";
        detailButton.textContent = "具体的に";
        detailButton.disabled = true;
        detailButton.addEventListener("click", () => {
          if (isHospitalBlock) {
            showConcreteHospitalDetails();
          } else if (isActionBlock) {
            showConcreteActionDetails(block.content || "");
          } else {
            showConcreteStateDetails(block.content || "");
          }
        });
        headerDiv.appendChild(detailButton);
      }
      
      if (headerText) {
        appendLinesSequentially(headerTitleEl, nameText || headerText, () => {
          appendLinesSequentially(contentDiv, block.content || "", () => {
            if (detailButton) detailButton.disabled = false;
            blockIndex += 1;
            appendNextBlock();
          });
        });
      } else {
        appendLinesSequentially(contentDiv, block.content || "", () => {
          if (detailButton) detailButton.disabled = false;
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
    fullText.includes('🟢 ここまでの情報を整理します') ||
    fullText.includes('🤝 今の状態について') ||
    fullText.includes('✅ 今すぐやること') ||
    fullText.includes('⏳ 今後の見通し') ||
    fullText.includes('🚨 もし次の症状が出たら') ||
    fullText.includes('📝 今の状態について') ||
    fullText.includes('📝 いまの状態を整理します') ||
    fullText.includes('🏥 受診先の候補');
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
  const parsedHeader = splitHeaderIconAndName(summaryBlock.header || "");
  appendHeaderTitleWithIcon(headerDiv, parsedHeader.icon, parsedHeader.name);
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

function clearSummaryContainer() {
  const summaryCard = document.getElementById("summaryCard");
  if (!summaryCard) return;
  summaryCard.innerHTML = "";
}

const SUMMARY_CARD_TEMPLATES = {
  green: [
    "今は大きな心配なさそうです",
    "落ち着いて様子を見られそうです",
    "今のところ安心して過ごせそうです",
  ],
  yellow: [
    "今は注意して様子を見てください",
    "少し注意しながら様子を見ましょう",
    "安心しながら様子を見てください",
  ],
  red: [
    "早めの受診をおすすめします",
    "医療機関での確認が必要そうです",
    "今日中の受診を検討してください",
  ],
};

function pickSummaryCardText(level) {
  const templates = SUMMARY_CARD_TEMPLATES[level] || SUMMARY_CARD_TEMPLATES.yellow;
  return templates[Math.floor(Math.random() * templates.length)];
}

function renderSummaryBase(text) {
  const summaryCard = document.getElementById("summaryCard");
  if (!summaryCard) return;
  const contentDiv = document.createElement("div");
  contentDiv.id = "summaryCardContent";
  contentDiv.className = "summary-card-content";
  contentDiv.textContent = text;
  summaryCard.appendChild(contentDiv);
  summaryCard.style.display = "block";
  summaryCard.style.opacity = "1";
  summaryCard.style.visibility = "visible";
}

function renderRedCard() {
  const text = pickSummaryCardText("red");
  renderSummaryBase(`🔴 ${text}`);
}

function renderYellowCard() {
  const text = pickSummaryCardText("yellow");
  renderSummaryBase(`🟡 ${text}`);
}

function renderGreenCard() {
  const text = pickSummaryCardText("green");
  renderSummaryBase(`🟢 ${text}`);
}

function renderSafeFallback() {
  const text = pickSummaryCardText("yellow");
  renderSummaryBase(`🟡 ${text}`);
}

function renderSummary() {
  // 最終防御: ユーザー送信前は判定UIを絶対に描画しない
  if (!appState.userHasSubmitted) {
    hideSummaryCard();
    return;
  }
  console.log("Rendering summary:", appState.riskLevel);
  console.assert(
    ["RED", "YELLOW", "GREEN"].includes(appState.riskLevel),
    "Invalid riskLevel"
  );
  clearSummaryContainer();
  switch (appState.riskLevel) {
    case "RED":
      renderRedCard();
      break;
    case "YELLOW":
      renderYellowCard();
      break;
    case "GREEN":
      renderGreenCard();
      break;
    default:
      renderSafeFallback();
  }
}

// Show initial message
function showInitialMessage() {
  const initialMessage = `体調の不安を、安心に変えます`;
  setTimeout(() => addMessage(initialMessage), QUESTION_DELAY_MS);
}


function hideSummaryCard() {
  const summaryCard = document.getElementById("summaryCard");
  if (summaryCard) {
    summaryCard.style.display = "none";
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
          locationSnapshot: getLocationSnapshot(),
          },
        }),
      });

      if (!response.ok) {
        // UXは止めない。サーバー側が復旧するまでの間も、会話を継続するための固定フォールバックを返す。
        let debug = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          debug = errorData.error || errorData.details || debug;
          console.error("サーバーエラー:", errorData);
        } catch (parseError) {
          const text = await response.text();
          console.error("レスポンステキスト:", text);
          debug = `サーバーエラー (${response.status}): ${text.substring(0, 100)}`;
        }
        console.error("API non-OK (fallback):", debug);
        return {
          conversationId: conversationId || null,
          message:
            "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
          response:
            "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
          judgeMeta: { judgement: "🟡" },
        };
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
  return {
    conversationId: conversationId || null,
    message:
      "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
    response:
      "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
    judgeMeta: { judgement: "🟡" },
  };
}

function clearSectionTimers() {
  (appState.sectionTimers || []).forEach((timerId) => clearTimeout(timerId));
  appState.sectionTimers = [];
}

function renderSection(sectionText) {
  if (!sectionText) return;
  addMessage(sectionText);
}

// Handle user input
async function handleUserInput() {
  const input = document.getElementById("userInput");
  const sendButton = document.getElementById("sendButton");
  const userText = input.value.trim();

  if (!userText) return;
  appState.userHasSubmitted = true;

  // Disable input
  input.disabled = true;
  sendButton.disabled = true;

  // Show user message
  addMessage(userText, true);
  input.value = "";
  clearSectionTimers();

    try {
      // 質問フェーズは従来どおり通常APIで即時応答
      const data = await callOpenAI(userText);
      console.log("[DEBUG] full aiResponse", data);
      const aiResponse = data;
      if (aiResponse.conversationId) {
        localStorage.setItem(CONVERSATION_ID_KEY, aiResponse.conversationId);
      }
      const aiMessage = aiResponse.questionPayload
        ? renderQuestionPayload(aiResponse.questionPayload)
        : aiResponse.message;

      const triageState = aiResponse.triage_state || { is_final: false, triage_level: null, required_fields_filled: 0 };
      const isFirstResponse = appState.conversationStep === 0;
      if (isFirstResponse) {
        hideSummaryCard();
        appState.riskLevel = null;
        appState.conversationStep = 1;
      }
      if (!triageState.is_final) {
        hideSummaryCard();
        appState.riskLevel = null;
      } else if (!isFirstResponse && !aiResponse.isPreSummaryConfirmation) {
        const level = triageState.triage_level || (aiResponse.judgeMeta?.judgement === "🔴" ? "red" : aiResponse.judgeMeta?.judgement === "🟡" ? "yellow" : "green");
        appState.riskLevel = level === "red" ? "RED" : level === "yellow" ? "YELLOW" : "GREEN";
      }

      // フォロー文トリガー: 「最後に」の絵文字（🌱 or 💬）が実際に出力された時のみ。それ以外は絶対に出さない。
      // エンコーディング耐性: Unicode正規化(NFC) + コードポイント(\u{1F331}=\u{1F4AC})で判定
      const isLastSectionEmojiOutput = (sectionText) => {
        if (!sectionText || typeof sectionText !== "string") return false;
        const normalized = String(sectionText).normalize("NFC").trim();
        const firstLine = normalized.split("\n")[0] || "";
        return /^[\u{1F331}\u{1F4AC}]\s*最後に/u.test(firstLine) || /^[🌱💬]\s*最後に/.test(firstLine);
      };

      const sections = Array.isArray(aiResponse.sections) ? aiResponse.sections.filter(Boolean) : [];
      const shouldShowSections = !isFirstResponse && triageState.is_final && sections.length > 0;

      if (shouldShowSections) {
        const firstDelay = QUESTION_DELAY_MS + 600;
        const interval = 800;
        const followUpMessage = aiResponse.followUpMessage;
        const followUpQuestion = aiResponse.followUpQuestion || DEFAULT_FOLLOW_UP_QUESTION;

        const onSectionRendered = (sectionText) => {
          if (!isLastSectionEmojiOutput(sectionText)) return;
          if (followUpMessage) addMessage(followUpMessage, false, true, { fromFollowUpTrigger: true });
          addMessage(followUpQuestion, false, true, { fromFollowUpTrigger: true });
        };

        const timerId0 = setTimeout(() => {
          renderSummary();
          if (sections[0]) {
            renderSection(sections[0]);
            if (sections.length === 1) {
              const t = setTimeout(() => onSectionRendered(sections[0]), 300);
              appState.sectionTimers.push(t);
            }
          }
        }, firstDelay);
        appState.sectionTimers.push(timerId0);

        for (let idx = 1; idx < sections.length; idx++) {
          const isLast = idx === sections.length - 1;
          const timerId = setTimeout(() => {
            renderSection(sections[idx]);
            if (isLast) {
              const t = setTimeout(() => onSectionRendered(sections[idx]), 300);
              appState.sectionTimers.push(t);
            }
          }, firstDelay + idx * interval);
          appState.sectionTimers.push(timerId);
        }
      } else {
        setTimeout(() => {
          if (triageState.is_final && !isFirstResponse && !aiResponse.isPreSummaryConfirmation) {
            renderSummary();
          }
          const msgToShow = stripFollowUpFromMessage(aiMessage);
          addMessage(msgToShow, false, true, { animateFromTop: !!aiResponse.isPreSummaryConfirmation });
          // フォローは出さない（「最後に」の絵文字が出力されていない）
        }, QUESTION_DELAY_MS);
      }
    } catch (error) {
        // Show fallback message and keep conversation moving
        const errorMessage = "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね";
        
        // より詳細なエラー情報をコンソールに出力
        console.error("API呼び出しエラー:", error);
        if (error.message) {
          console.error("エラーメッセージ:", error.message);
        }
        
        // Show fallback message (no retry prompt)
        setTimeout(() => addMessage(errorMessage), QUESTION_DELAY_MS);
      } finally {
    // Re-enable input
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
}

// Initialize
function init() {
  resetConversation();
  clearSectionTimers();
  appState.riskLevel = null;
  appState.userHasSubmitted = false;
  hideSummaryCard();
  clearSummaryContainer();
  showInitialMessage();
  const snapshot = getLocationSnapshot();
  updateLocationStatusIndicator(snapshot ? "usable" : "failed");
  // DO NOT reintroduce location explanation bubble.
  // UX policy: header status only.
  sessionStorage.setItem(LOCATION_PROMPT_KEY, "true");
  sessionStorage.removeItem("kairo_force_location_prompt");
  requestLocationWithRetry(1);
  setTimeout(finalizeLocationPendingIfNeeded, 5000);

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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestLocationOnAction();
    }
  });
  window.addEventListener("pageshow", () => {
    requestLocationOnAction();
  });

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

