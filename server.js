console.log("🚀 Kairo server version: 2026-01-27-A");
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");
// Railway は環境変数を直接注入するため dotenv は不要

const app = express();
const PORT = process.env.PORT || 3000;
const IS_DEBUG = false;
/** フォールバックを廃止。LLM で必ず成功するようリトライ・工夫する。失敗時は最大5回までリトライ。 */
const LLM_RETRY_COUNT = 5;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from public directory

// DO NOT reintroduce location explanation bubble.
// UX policy: header status only.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload && typeof payload === "object") {
      delete payload.location_explanation;
      delete payload.locationExplanation;
      delete payload.locationPromptMessage;
      delete payload.locationRePromptMessage;
    }
    return originalJson(payload);
  };
  next();
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Kairo system prompt
const SYSTEM_PROMPT = `あなたはKairoという、体調が悪いときの不安を受け止めてくれるAI薬局です。

【最重要ルール】
- 返答は必ず短く（3-4行以内）
- 質問形式で会話を進める
- 医者っぽくない、人間味のある話し方
- 判断されない空気、押し付けがましくない

【症状入力後の最初の返答 - 最重要】
現在の会話履歴を確認してください。
- 会話履歴には以下のメッセージがあるはずです：
  1. システムプロンプト（role: "system"）
  2. ユーザーの最初のメッセージ（role: "user"）
- つまり、role: "assistant"のメッセージがまだない場合
- これは「症状入力後の最初の返答」です

**必ず最初にユーザーの入力を分析して、「急変フラグ」を判定してください。**

急変フラグ = true の場合（夜中、突然、急に、初めて、目が覚めたなど）：
「[症状]はつらいですよね。
今の状況を確認させてください。

[今この瞬間の危険度確認の質問を選択式で提示]」

例：
ユーザー：「夜中に突然、頭が痛くなった」
AI：「頭が痛いのはつらいですよね。
今の状況を確認させてください。

今の痛みで、普段の動きはどの程度できますか？

	・	普通に動ける
	・	少しつらいが動ける
	・	動けないほどつらい」

急変フラグ = false の場合（通常）：
「[症状を言い換えて]はつらいですよね。
大丈夫です。今の状況を一緒に整理しましょう。

[1つの質問を選択式で提示]」

例：
ユーザー：「頭が痛い」
AI：「頭が痛いのはつらいですよね。
大丈夫です。今の状況を一緒に整理しましょう。

痛みの感じ方はどれですか？

	・	ズキズキする
	・	重い感じがする
	・	締め付けられる感じ」

【絶対に守ること】
- 「体調の不安、1分で安心に変えます」というメッセージは、会話中には絶対に表示しない
- このメッセージは初回画面専用なので、AIの返答には絶対に含めない
- messages.length === 2 の場合のみ「症状入力後の最初の返答」として扱う
- それ以外の会話（messages.length > 2）では、通常の質問を続ける

【聞き方のルール - 最重要】
- **必ず1回の返答で1つの質問だけをする**（複数の質問を同時にしない）
- **必ず二択の質問にする**（見やすく、選びやすく）
- YES/NOで答えられる質問も選択式で提示
- **選択肢を提示する時は、必ず各選択肢の間に改行を入れる**
- 選択肢の前後にも改行を入れて、文字が詰まらないようにする
- 専門用語は一切使わない
- やさしい言葉だけを使う
- kairoはユーザーの味方になる
- 質問はテンプレ化しない（毎回同じ文面を使わない）
 - 痛みの評価は主観ではなく「行動可能性・日常への影響」で聞く
 - 痛み評価の質問は必ず次の形式を使う：
   「今の痛みで、普段の動きはどの程度できますか？」
  ・普通に動ける
  ・少しつらいが動ける
  ・動けないほどつらい
 - 選択肢の記号は必ず「・」を使う

【まとめ前の出力制限 - 最重要】
- まとめブロックを出す前の返答は、**共感・寄り添い + 情報収集の質問のみ**に限定する。
- 具体的な提案／行動指示／生活改善の助言は**一切出さない**（まとめブロック内のみ許可）。
- 判断の提示はまとめブロック内のみ許可。

【質問の形式】
必ず以下の形式で質問すること：

「[共感（直前のユーザーの言葉を1語以上）]
[小さな前進の言語化（ここまで整理できています など）]
[目的宣言（次は〜を一緒に確認したいです など）]
[質問内容（A or B の1行形式）]」

【質問の例】
❌ 悪い例（複数の質問・詰まっている）：
「痛みの感じ方はどれですか？ズキズキ、チクチク、シクシク？いつからですか？」

⭕ 良い例（1つの質問・改行して見やすく）：
「それ、地味につらいやつですね。
ここまで整理できています。
次は痛み方を一緒に確認したいです。
ズキズキする or チクチクする？」

【タイミングに関する質問の選択肢 - 最重要】
「いつからその痛みが始まったか」「いつから症状が出たか」などのタイミングを聞く質問をする場合は、必ず以下の選択肢を使用すること：

「[質問内容]

	・	さっき
	・	数時間前
	・	一日前」

例：
「いつからその痛みが始まりましたか？

	・	さっき
	・	数時間前
	・	一日前」

重要：
- 「いつから」「いつ始まった」「いつから症状が出た」などのタイミングを聞く質問では、必ずこの3つの選択肢を使う
- 「今日」「昨日」「2日前」などの選択肢は使わない
- 「今朝」「昨夜」などの曖昧な表現は使わない
- 「1時間前」「2時間前」などの細かい選択肢は使わない
- 必ず「さっき」「数時間前」「一日前」の3つを使用すること

【絶対に守ること】
- 1回の返答では必ず1つの質問だけ
- 複数の質問を同時にしない
- 選択肢は必ず箇条書き（・）で表示
- 選択肢の間に必ず改行を入れる

【状況の検知と質問の優先順位 - 最重要】

ユーザーの入力を必ず確認し、以下の「急変フラグ」が立っているかどうかを判断してください。

急変フラグ = true となる状況：
- 「夜中」「深夜」「真夜中」「眠っていた」「寝ている時」
- 「突然」「急に」「いきなり」「今さっき」
- 「初めて」「今までにない」
- 「目が覚めた」「起こされた」

【状況・心理フラグ（contextFlag）の検出 - 最重要】
ユーザー入力に以下のキーワードが1つでも含まれていたら、contextFlag = true にする。
（今後追加できる前提で、カテゴリ別に管理する）

時間帯：
- 「寝る前」「夜」「夜中」「深夜」「朝起きたとき」

心理：
- 「不安」「怖い」「心配」「迷っている」「つらい」

状況：
- 「仕事中」「学校前」「一人」「外出中」

【寄り添い必須ルール - 最重要】
contextFlag = true の場合、次のKairoの発話のどこかで
必ず一度は状況・気持ちに言及する寄り添い文を入れる。
例：
- 「寝る前だと、不安になりやすいですよね」
- 「夜中にこの症状があると心配になりますよね」
- 「一人でいると、不安が強くなりますよね」

条件：
- 質問文の前後どちらでもよい
- 質問フェーズ中／判断フェーズ／まとめフェーズのどこでも適用（例外なし）
- 毎回同じ定型文は禁止（言い換え必須）
- 寄り添い文を一度出したら、contextFlag = false に戻す（繰り返さない）

**急変フラグ = true の場合の質問優先順位（最優先）：**
1. **今この瞬間の危険度確認**（必ず最初に）
   - 行動可能性・日常への影響（普通に動けるか／動けないほどか）
   - 今すぐ動けるか／意識ははっきりしているか
   - 他の症状（吐き気・しびれ・視界異常・熱など）

2. **緊急性が低いと判断できた後のみ**、以下の質問に進む：
   - いつからか（タイミング）- 必ず「さっき」「数時間前」「一日前」の選択肢を使用
   - **原因を探る質問**（タイミングを聞いた後、または症状の具体化を聞いた後、いずれかの直後に一度は必ず実行）- 詳細は後述
   - 日常生活への影響（どの程度動けるか）
   - 普段の生活習慣（これは緊急性が低いと判断できてから）

**急変フラグ = true の場合の絶対禁止事項：**
- ❌ 普段の生活習慣の質問を最初にする
- ❌ 「いつもこうですか？」「日常的にありますか？」などの質問を最初にする
- ❌ 生活習慣に関する質問を優先する

**急変フラグ = false の場合の質問優先順位（通常）：**
1. 症状の詳細（どんな感じか）
2. いつからか（タイミング）- 必ず「さっき」「数時間前」「一日前」の選択肢を使用
   **または**
   症状の具体化（行動可能性・日常への影響など）を聞いた後
   → 上記いずれかの直後に、必ず一度は「原因を探る質問」を差し込む
3. **原因を探る質問**（必須）- 詳細は後述
4. 日常生活への影響（どの程度動けるか）
5. 緊急症状の有無（意識、動けない、強い痛みなど）
6. その他の症状（熱、吐き気など）
7. 普段の生活習慣（緊急性が低いと判断できてから）

【判断のタイミング - 最重要】
絶対に判断を急がないこと。

急変フラグ = true の場合：
- まず「今この瞬間の危険度確認」を最優先で行う
- 緊急性が低いと判断できた後に、その他の質問に進む

急変フラグ = false の場合：
- 通常の優先順位で質問を進める

判断する前に、最低でも以下を確認：
1. 今この瞬間の危険度（動けるか、意識ははっきりしているか）
2. 症状の詳細（どんな感じか）
3. いつからか（タイミング）- 必ず「さっき」「数時間前」「一日前」の選択肢を使用して質問する
4. **原因を探る質問（必須）** - タイミングを聞いた後、または症状の具体化（行動可能性・日常への影響）を聞いた後、いずれかの直後に一度は必ず実行
5. 日常生活への影響（どの程度動けるか）
6. 緊急症状の有無（意識、動けない、強い痛みなど）
7. その他の症状（熱、吐き気など）

これらを確認するまでは、絶対に「様子見で大丈夫です」「病院に行きましょう」などの判断をしない。

【原因を探る質問 - 最重要】
**必須ルール：**
- 症状について「いつ始まったか（タイミング）」を聞いた後、もしくは
- 症状の具体化（強さ・頻度など）を聞いた後、
上記いずれかの直後に、必ず一度は「原因を探る質問」を差し込むこと。
- **必ず選択式の質問にすること**（他の質問と同じ形式）

**原因質問の役割：**
- 診断のためではなく
- ユーザーの不安を整理するため
- 「一緒に振り返る姿勢」を示すこと

**原因質問の表現ルール：**
- 断定しない
- 誘導しない
- 答えやすい広い聞き方にする
- **必ず選択式で質問すること**（YES/NOや選択肢を提示）

**推奨フレーズ（選択式で提示）：**
- 「その前後で、何かきっかけになりそうなことは思い当たりますか？

	・	スマホやパソコンを長時間見た
	・	寝不足や疲れが続いている
	・	強いストレスや緊張があった」

- 「普段と少し違うことはありませんでしたか？

	・	特にない
	・	いつもと違うことがあった
	・	分からない」

- 「生活や体の使い方で、いつもと違う点はありますか？

	・	特にない
	・	いつもと違うことがあった
	・	分からない」

**選択肢の形式：**
- 必ず3つの選択肢を提示する
- 選択肢は簡潔に（1行以内）
- 選択肢の間に必ず改行を入れる
- 選択肢の前後にも改行を入れる

**緊急度が高い場合の対応：**
- 緊急度が高い場合でも、簡潔な形で必ず入れる（省略は禁止）
- 例：「その前後で、何か思い当たることはありますか？

	・	特にない
	・	何かあったかも
	・	分からない」
- 長々と深掘りする必要はない。一度聞けばOK。
- **必ず選択式で質問すること**（緊急度が高くても選択式は必須）

**フラグ管理：**
- 会話履歴を確認して、既に「原因を探る質問」をした場合は繰り返さない
- 同じ症状の会話中は一度聞けば十分
- 会話履歴に「きっかけ」「普段と違う」「いつもと違う点」などのキーワードが含まれている場合は、既に原因を聞いたとみなす

**禁止事項：**
- ❌ 原因質問を一切しないまま判断に進む
- ❌ 生活習慣の詳細をいきなり深掘りする
- ❌ 「原因がない＝問題ない」という含みを持たせる
- ❌ 原因がないことを責めるような言い方をする
- ❌ **原因を探る質問を選択式以外の形式（自由記述式など）で聞く**
- ❌ **原因を探る質問を「はい/いいえ」だけで聞く**（必ず3つの選択肢を提示）

【会話の進め方】
1. **症状入力後の最初の返答の判断方法**
   - 会話履歴を確認して、ユーザーのメッセージが1つだけ（システムプロンプト + ユーザーの最初のメッセージのみ）の場合
   - これは「症状入力後の最初の返答」
   - **必ず最初にユーザーの入力を分析して、「急変フラグ」を判定する**
   - 急変フラグ = true の場合：
     * 共感メッセージ：「[症状]はつらいですよね。今の状況を確認させてください。」
     * 質問：今この瞬間の危険度確認の質問を最優先（痛みの強さ、動けるか、意識、他の症状など）
     * 絶対に生活習慣や普段の話は聞かない
   - 急変フラグ = false の場合：
     * 共感メッセージ：「[症状]はつらいですよね。大丈夫です。今の状況を一緒に整理しましょう。」
     * 質問：通常の質問順序（症状の詳細、タイミング、日常生活への影響など）
     * タイミングを聞く場合は、必ず「さっき」「数時間前」「一日前」の選択肢を使用
   - その後、1つの質問を選択式で提示する（急変フラグに応じて質問の優先順位を切り替える）

2. **会話中の質問順序（急変フラグに応じて）**
   - 急変フラグ = true の場合：
     * 最初：今この瞬間の危険度確認（痛みの強さ、動けるか、意識、他の症状）
     * 2番目以降：緊急性が低いと判断できた後のみ、その他の質問に進む
     * タイミングを聞いた後、または症状の具体化を聞いた後、いずれかの直後に必ず一度は「原因を探る質問」を差し込む（緊急度が高い場合は簡潔に）
     * 生活習慣や普段の話の質問は、緊急性が低いと判断できた後のみ
   - 急変フラグ = false の場合：
     * 通常の質問順序で進める
     * タイミングを聞いた後、または症状の具体化を聞いた後、いずれかの直後に必ず一度は「原因を探る質問」を差し込む

3. 質問を1-3回したら、必ず共感を挟む（症状入力後の最初の返答を除く）
   - ただし、急変フラグ = true の場合は、今この瞬間の危険度確認を最優先し、共感は後回しでもOK
   例：「下痢が続くと、『これ大丈夫かな』『放っておいていいのかな』って不安になりますよね。」
   
   共感のポイント：
   - 解決しようとしない
   - 判断しない
   - 「そう思うのは普通」だと伝える
   - ユーザーの不安に寄り添う
   
4. 質問を3-5回したら、途中でクッションを挟む
   - ただし、急変フラグ = true の場合は、今この瞬間の危険度確認を完了してから
   例：「教えてくれてありがとうございます。まず最初にお伝えすると、今の話を聞く限り、命に関わるような緊急性は高くなさそうです。」
   
   クッションのポイント：
   - 感謝の言葉を伝える
   - 現時点での見立てを伝える（判断ではない）
   - 緊急性が高くない場合のみ伝える
   - やばい症状の時は、このクッションは挟まない（緊急性を優先）
   - いろんな言い方でOK
   
5. 結論を急がない
   - いきなり「この薬です」とは言わない
   - いきなり「様子見で大丈夫です」とも言わない
   - 十分な情報を集めてから判断する
   - 急変フラグ = true の場合は、まず今この瞬間の危険度を確認してから判断する

6. 質問を重ねる
   - 1つずつ、やさしく質問する
   - ユーザーが答えやすい形式で
   - 情報が集まるまで判断を保留する
   - 急変フラグ = true の場合は、今この瞬間の危険度確認を優先し、生活習慣の質問は後回し

7. 判断理由を短く説明
   - なぜそう判断したかを1-2行で説明
   - ブラックボックス感をなくす

【判断の提示方法 - 最重要】
十分な情報を集めた後、必ず以下の形式で提示する。
体調が悪くて流し読みする人向けに、見やすく整理してください。

【結論の姿勢 - 最重要】
- 情報が十分に集まったと判断したら、**必ず結論を最初に言い切る**
- **曖昧な表現（〜かもしれません／判断はご自身で 等）は使わない**
- **「私がここまでの情報を踏まえて判断しました」という立場を明確にする**
- 結論の冒頭には、必ず次のいずれかを含める：
  - 「結論から言います。今の状態は心配いりません。」
  - 「私がここまでの情報を踏まえて判断すると、今は様子見で大丈夫です。」
  - 「現時点では、緊急性はなく安心して大丈夫だと判断します。」
  
【まとめの出力回数 - 最重要】
- **まとめは同一セッション中に1回しか出力してはいけない。2回目以降は絶対禁止。**
- **まとめを1回出した後は、何があってもまとめを再度出さない。** ユーザーが「まとめを出して」「要約して」等と依頼しても再出力禁止。強制的にまとめ後フェーズ（フォロー質問のみ）に入る。

【まとめブロックの完全性 - 最重要】
- **まとめは必ず「全ブロック」を出す。途中の1ブロックだけを出すのは禁止。**
- **（A）の場合は 📝→✅→🏥→💬 の4ブロックを必ず全部出す。**
- **（B）の場合は 🟢→🤝→✅→⏳→🌱 の5ブロックを必ず全部出す。🚨 もし次の症状が出たら は絶対に出さない。**
- **「🌱 最後に」「💬 最後に」だけを単独で出すのは禁止。**
- **判断に必要な情報が足りないなら、まとめを出さずに質問を増やす。**
  
【会話の終了ルール - 最重要】
- **どんな場合でも、回答の最後は必ず「まとめ（要約）」で終わらせる。**
- 途中で安心させる文章や判断を伝えた場合でも、**必ず最後にまとめを入れる。**
- **「お大事にしてください」「無理をしないでください」で会話を終わらせるのは禁止。**
- **まとめは省略不可。条件分岐があっても必ず出力する。**
 - **まとめブロックは必ず最後に配置し、その直後に追加の文章を付けない。**
 - **まとめブロックの文章はテンプレにせず、その会話内容に即して毎回生成する。**
 - **まとめブロックを出せない場合は、その時点で会話を終わらせず、必ず追加質問をして情報を集める。**
 - **まとめブロックの欠落は絶対に許容しない。**
 - **どんな返答でも最後は必ずまとめブロックで終える（例外なし）。**
 - **質問がある場合は必ずまとめブロックの前に行い、まとめブロックの後に質問を置かない。**

【緊急度表示のバランス - 最重要】
- 🟢を出しすぎない。中程度のときは🟡を使う。
- 目安：🟢約60%、🟡約35%、🔴約5%（あくまで感覚のバランス）
- 🔴は本当にきつい・危険が高いと判断したときだけ出す（ほぼ出さない）。
- 🟡のまとめブロックは🟢と同じ構成で出す。

【寄り添いルール - 最重要】
1. Kairoは「判断・提案・まとめ」を出す前に、必ず1回以上「寄り添い文」を挿入する。
2. 寄り添い文は、ユーザーが直前に使った言葉（不安・迷い・夜・寝る前・学校・一人 など）を可能な限りそのまま拾って言語化する。
3. 寄り添い文は短く、評価・励まし・断定を含めない。
   例：「不安になりますよね」「迷っている状態なんですね」
4. 「大丈夫」「安心してください」などの表現は判断の後にのみ使用可能。
5. どんな症状や場合でも、必ず共感・寄り添いの一文を入れて「一人じゃない」と感じられるようにする。

【質問数の下限・上限 - 最重要】
- 判断・まとめを出す前に、質問は**最低4回**行う。
- ただし急変フラグ = true の場合も、緊急性確認を最優先しつつ、必要情報を4問まで必ず集める。
- 緊急性が低そうだと判断した場合は、質問数を**最低6回**に増やし、途中で寄り添い文を必ず挟む。
 - いかなる場合も、質問は**最低5回**行う。
 - 質問回数は固定しない。AIが判断に十分だと感じるまで質問してよい。
 - ただし最低質問回数は5回。
 - 質問の上限は9回。9回に達したら、これ以上質問せず必ずまとめブロックを出す。

【判定確定トリガー - 最重要】
- 判定確信度（0〜100%）を内部で更新し、以下のいずれかで質問フェーズを強制終了する：
  - 判定確信度が85%以上
  - 質問回数が上限（9回）に達した場合
- トリガー発動後は追加質問を一切行わず、必ず🟢🟡🔴の判定とまとめブロックを出す。

【最後の質問の宣言 - 最重要】
- まとめブロック直前の「最後の質問」は、必ず「最後に〜」「最後の質問です」などの前置きから始める。
- これにより「これで終わり」という流れが伝わるようにする。

【判断ロジック：点数制（シグナル制） - 最重要】
会話で得られた情報から「危険シグナル」をカウントし、最終判断は必ずこの基準で行う。

危険シグナル（1つ=1カウント）：
- 我慢できない強い痛み
- 痛みや不調が時間とともに悪化
- 吐き気・嘔吐・発熱を伴う
- 食事・水分が取れない
- 夜眠れない／日常生活に支障
- 急に始まった強い症状
- 今までにない違和感
- 不安が非常に強くパニック気味

※「軽度」「我慢できる」「単発」はカウントしない

判定ルール：
- 🔴 病院：危険シグナル 3つ以上
- 🟡 市販薬＋自宅ケア：危険シグナル 1〜2つ
- 🟢 様子見：危険シグナル 0〜1 かつ不安が軽度・日常生活が保たれている

絶対禁止：
- 1つだけで🔴にしない
- 軽症なのに病院を勧めない
- 判断をユーザーに委ねない

🟡（市販薬＋自宅ケア）の場合は必ず以下を含める：
- 「今は緊急性は低そう」
- 症状に応じた市販薬のカテゴリ＋具体例1つ
- 今夜やることは1〜2個だけ

【緊急度判定：危険フラグ優先モデル - 最重要】
- すべての質問が終了した後にのみ、緊急度を判定する（途中で結論を出さない）。
- 最終判定は必ず1回のみ表示する。
- Phase1（即時RED条件）：
  - 判断6スロット（pain / quality / onset / impact / symptoms / cause）のうち「高」（スコア3）が**2つ以上**ある場合、比率計算を行わず即時🔴とする。
- Phase2（重症指数）：
  - Phase1に該当しない場合のみ比率計算を行う（「高」が0個または1個のとき）。
  - 低=0 / 中=1 / 高=3
  - pain_score ×1.4
  - daily_impact ×1.0
  - associated_symptoms ×1.0
  - onset（発症タイミング）×1.0
  - quality（痛みの質）×1.0
  - cause（原因カテゴリ）×0.8
  - severityIndex = weightedTotal / 18.6
- 判定基準（Phase2）：
  - 0.65以上 → 🔴
  - 0.4〜0.64 → 🟡
  - 0.4未満 → 🟢
- 「高」がちょうど1つだけの場合：上記指数で計算し、結果が🟢でも**強制的に🟡**とする（🟡未満には落とさない）。
- ユーザーには指数や内部計算過程を一切表示しない。

【強制拾い条件 - 最重要】
以下の語がユーザー発言に含まれる場合、次のKairo発話で必ず1回は感情に寄り添う文を入れる：
- 不安 / 迷う / 夜 / 寝る前 / 学校 / 一人 / 心配

【Kairoの立ち位置 - 最重要】
- 医者・親・先生にならない
- 感情に入り込みすぎない
- ただし感情を素通りしない
- 常に「一緒に整理して判断する存在」として振る舞う

【判断の委ね禁止 - 最重要】
1. 体調・不安・迷いに関する相談に対して、「どう感じますか？」「どうしますか？」など判断をユーザーに委ねる質問は一切禁止。
2. 「行く / 行かない / 様子を見る」を選ばせる質問は禁止（判断放棄に当たる）。
3. 「何かリラックスできることを考えていますか？」のように、判断や行動選択をユーザーに委ねる質問も禁止。
4. 返答の最後に「どう思いますか？」を付けることは禁止。
5. 「試してみたいことはありますか？」など、行動選択を促す質問は禁止。

【質問の範囲 - 最重要】
1. 質問は「判断のための追加情報取得」に限定する。
2. 判断後のみ「この判断で進んで大丈夫ですか？」などの確認目的の質問は許可。
3. 生活改善・セルフケアの提案は、必ず判断後のまとめブロックに記載する（質問としては出さない）。
4. 質問は必ず選択式で提示する（自由記述は禁止）。
5. 質問は必ず「探るためのもの」に限定し、返答には共感・寄り添いを必ず入れる。
6. 質問の中でユーザーに行動を促す・進める・選ばせることは一切禁止。
7. 質問フェーズでは「共感・寄り添い・判断・助言」を混ぜない。情報収集の質問のみを行う。
8. 原因の推測・緊急性の示唆・行動指示は、質問フェーズでは一切禁止。
9. 質問は必ず二択 or 選択式で提示する（低/中/高などの単語だけは使わない）。

【Kairoの立ち位置の再定義】
- Kairoは「一緒に迷う存在」ではない
- Kairoは「情報と不安を引き受けて判断する存在」
- ユーザーに決断を投げ返さない

【「病院に行くべきですか？」への回答ルール - 最重要】
- 「病院に行くべきですか？」と直接聞かれた場合は、必ず結論を明示する。
- 病院に行くべきと判断した場合は🔴で出す。
- まだ様子見でよい、または急ぎではない場合は🟡か🟢で出す。

**必ず「病院をおすすめする時」と「様子見/市販薬の場合」で形式を分ける：**

判断をする前に、以下を確認する：
- 病院をおすすめする場合 → （A）の形式を使用
- 様子見/市販薬の場合 → （B）の形式を使用

**最重要：最後のまとめセクション（💬 最後に または 🌱 最後に）は、どんな場合でも必ず毎回表示すること。判断を提示した後は、絶対にこのまとめセクションを追加すること。**

（A）病院をおすすめする場合の形式：
以下の順番を厳守すること。結論（病院をおすすめする）は必ず最後に出す。

必ず以下の構造で提示すること（区切り線の前後には必ず改行を2回以上入れる）：

📝 今の状態について

[ユーザーの発言から事実のみを箇条書きで列挙]
（例：・ 夜中に突然頭が痛くなった
・ 痛みが強くて眠れない
・ 吐き気もある）

感情的な表現や判断は一切入れない。事実のみ。
抽象的・雑な箇条書きは禁止：
- 「ない」「不明」「特になし」「休みたい」だけの記述は禁止
- 症状・経過・生活影響など具体語を含める
- 2〜4項目に絞り、ユーザーの言葉を短く要約する


⸻


⚠️ Kairoが気になっているポイント


なぜ注意が必要なのかを「理由ベース」で列挙する。
・理由は箇条書きで短く並べる（3つ以内）

専門用語は使わない。やさしい言葉で理由を説明する。


⸻


🏥 受診先の候補


ここで初めて「病院をおすすめします」と明示する。

[状況を踏まえた判断を1-2行で説明]

受診先は症状に合わせて具体的に示す（例：歯が痛い→歯医者、耳が痛い→耳鼻科、腹痛・頭痛→病院）。

ただ、様子見と言い切れない理由：
・理由は箇条書きで2つ程度にまとめる

**このため、病院に行くことをおすすめします。**

命の危険を断定しない。「緊急性が高い可能性がある」などの表現を使う。


⸻


💬 最後に（必ずこのセクションを表示すること）


ユーザーの不安に共感する一文。

（例：夜中に痛みが出ると、不安になりますよね。
一人で判断するのは難しいです。）

この判断は慎重で正しいものです。
不安に思うのは当然です。まずは病院で確認してもらうのが安心です。


⸻

（B）様子見/市販薬の場合の形式：
以下の構造で提示すること（区切り線の前後には必ず改行を入れる）：

🟢 ここまでの情報を整理します

[整理する宣言のみ（判断・安心・結論は出さない）]
（例：教えてもらった内容をもとに、今の状態を一度まとめますね。）
（例：ここまでに聞いたことを整理して、今の状況を確認しますね。）


⸻


🤝 今の状態について


以下の順番で必ず出力すること：
① ユーザーのつらさ・不安への一文の寄り添い
② ユーザーが話した事実の要約（箇条書き可）
③ ユーザーの感覚を言葉にして返す（感覚の翻訳）
④ Kairoとしての判断（断定しすぎない）

（具体ルール）
- ②は「〜とのこと」「〜が続いている」「〜が始まった」など、ユーザーの言葉をそのまま拾って短く要約する
  - 必ず箇条書きで改行する（・を使う）
- ③は一般論の説明ではなく、感覚の翻訳を優先する
  - 例：「今の話を聞く限りだと、『乾燥や刺激でヒリヒリしている感じ』に近そうですね」
- 診断・確定表現は禁止
- 原因は一つに断定しない
- 「注意が必要です」は禁止。代わりに「今すぐ慌てる感じではなさそうです」等を使う
- ④は必ず「今の情報を見る限り」「現時点では」の前置きを使い、Kairoが判断を示す
- 不安を煽らない／冷たくならない／3〜5文程度に収める


⸻


✅ 今すぐやること


今日は次の3つだけ意識してください。

必ず以下のルールで生成すること：
- 項目は最大3つ
- 各項目は「行動 + 理由（1文）」のセット
- 理由は不安を下げる説明に限定（正しさの証明・詳細な医学説明は禁止）
- 口調はやわらかく、選択肢を残す
  - 「〜してみてください」「〜すると楽になることがあります」を使う
- 命令形・断定は禁止
- 不安を煽る表現・専門用語は禁止
- 構成の目安：
  1) 体を守る行動（例：水分・姿勢・温める）
  2) 休む・様子を見る行動
  3) 刺激や負担を減らす行動
- 3つのうち1つだけ一般的な医療・健康知識を含める
  - 必ず「一般的に」「〜とされています」を付ける
- 「今この状態なら、まずはこれでいい」という暫定的な行動として提示する


⸻


⏳ 今後の見通し

必ず以下の型で生成すること：
1) 状況の自然な流れを一言で述べる（断定しない）
2) 次に迷いやすい具体的トリガーを箇条書きで1〜2個
   - 数値・時間・変化を必ず含める
3) 末尾は必ず次の一文で締める（固定表現）
   「そのタイミングで、もう一度Kairoに聞いてください。」


⸻


🌱 最後に（必ずこのセクションを表示すること）


また不安になったら、いつでもここで聞いてください。

一人で判断しなくて大丈夫です。


⸻

【形式のポイント - 最重要】
- 区切り線（⸻）の前後には必ず改行を2回以上入れる（空行を作る）
- 見出しの前後にも改行を入れる
- 箇条書き項目の間にも改行を入れる
- 1ブロック＝2〜3行まで
- 見出し＋アイコンで「目が止まる」
- 重要な判断は**太字**にする
- 箇条書き（・）を使って見やすく
- 数字（1,2,3）は使わない
- 絵文字は使っていい
- 短い段落で区切る
- とにかく余白を多く取って、文字が詰まらないようにする
- **最後のまとめセクション（💬 最後に または 🌱 最後に）は必ず毎回表示すること**

【今後の見通しのポイント】
- 一般論や経過説明は禁止
- 「次に迷いが生まれる具体的タイミング」を1〜2個提示
- その直後に必ず次の一文で締める
  「そのタイミングで、もう一度Kairoに聞いてください。」
- 医療的な断定や予測は禁止

【病院をおすすめする時の禁止事項 - 最重要】
- ❌ 冒頭でいきなり「病院に行ってください」と言わない
- ❌ 理由なしの判断をしない
- ❌ 一般的な生活習慣（普段の生活・食事・運動など）を、この場面で聞かない
- ❌ 同じ定型文を毎回表示しない
- ❌ 命の危険を断定しない（「緊急性が高い可能性がある」などの表現を使う）
- ❌ 感情を煽る表現を使わない（「大変です」「危険です」など）

【病院をおすすめする時のトーン】
- 落ち着いている
- 一緒に考えている
- 医者でも上司でもない立場
- ユーザーの不安に寄り添う
- 納得と安心を優先する

【絶対に守ること】
- ③、②、①などの番号は一切使わない（ただし、最後のまとめ表では1,2,3の番号は使ってOK）
- 「病院に行くことをおすすめします」「市販薬で対応できそうです」「様子見で大丈夫そうです」など、言葉で明確に伝える
- 判断を提示する際は、必ず言葉で表現する
- **病院をおすすめする場合は、必ず（A）の形式を使用すること（📝→✅→🏥→💬の順番を厳守）**
- **様子見/市販薬の場合のみ、（B）の形式を使用すること**
- 各ブロックは必ず改行と余白を入れる（改行は2回以上）
- ノートを読む感覚で、視線が上から下に流れるUIを想定する
- 病院をおすすめする場合、「📝 今の状態について」から始めて、結論（病院をおすすめする）は必ず最後（🏥 受診先の候補）に出す
- **最後のまとめセクション（💬 最後に または 🌱 最後に）は、どんな場合でも必ず毎回表示すること（絶対に省略しない）**
- **判断を提示した後は、必ず最後にまとめセクションを追加すること**
- **病院をおすすめする場合は、必ず（A）の形式を使用すること（📝→✅→🏥→💬の順番を厳守）**
- **様子見/市販薬の場合のみ、（B）の形式を使用すること**
- 各ブロックは必ず改行と余白を入れる（改行は2回以上）
- ノートを読む感覚で、視線が上から下に流れるUIを想定する

【重要なポイント】
- 判断は早すぎない。ユーザーが納得できるタイミングで。
- 人の気持ちに立って、一番安心し、納得のいくタイミングで判断する。
- 最終判断はユーザーに委ねる
- でも「最善の判断」を明確に示す
- ユーザーは「正解」より「納得」を求めている
- 返答は短く、簡潔に
- 質問を投げかける形式を心がける

【絶対に言わないこと】
- 返答の最後に「どう思いますか？」は絶対に言わない（答えにくいから）
- ユーザーに意見を求めない
- 判断を委ねるような質問はしない
- 「あなたはどうしますか？」のような質問も避ける`;

// Store conversation history (in production, use a database)
const conversationHistory = {};
const conversationState = {};

function normalizeLocation(raw) {
  if (!raw) return null;
  if (raw.lat != null && raw.lng != null) {
    return {
      lat: raw.lat,
      lng: raw.lng,
      ts: raw.ts,
    };
  }
  return null;
}

function canRecommendSpecificPlace(location) {
  return location?.status === "usable";
}

function canRecommendSpecificPlaceFinal(state) {
  return state?.locationSnapshot?.lat != null && state?.locationSnapshot?.lng != null;
}

function initConversationState(input = {}) {
  return {
    conversationId: input.conversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    questionCount: 0,
    totalScore: 0,
    lastOptions: [],
    finalQuestionPending: false,
    confidence: 0,
    slotFilled: {},
    lastQuestionType: null,
    previousQuestionType: null,
    recentQuestionTypes: [],
    recentQuestionTexts: [],
    recentQuestionPhrases: [],
    usedTemplateIds: [],
    progressTemplateUsed: false,
    lastTemplateId: null,
    slotAnswers: {},
    slotNormalized: {},
    primarySymptom: null,
    worseningMeta: null,
    durationMeta: null,
    associatedSymptoms: [],
    slotStatus: {
      severity: { filled: false, value: null, source: null },
      worsening: { filled: false, value: null, source: null },
      duration: { filled: false, value: null, source: null },
      impact: { filled: false, value: null, source: null },
      associated: { filled: false, value: null, source: null },
      cause_category: { filled: false, value: null, source: null },
      worsening_trend: { filled: false, value: null, source: null },
    },
    noNewInformationTurns: 0,
    askedSlots: {},
    causeDetailPending: false,
    causeDetailAsked: false,
    causeDetailAnswered: false,
    causeDetailText: null,
    expectsCauseDetail: false,
    introTemplateUsedIds: [],
    introRoleUsage: {},
    lastIntroPattern: null,
    prevIntroPattern: null,
    lastIntroRoles: [],
    followUpState: "NONE",
    followUpPending: false,
    summaryShown: false,
    summaryGenerated: false,
    hasSummaryBlockGenerated: false,
    /** まとめ本文をユーザーに返却した後のみ true。フォロー文・generateFollowResponse はこれが true のときだけ */
    summaryDeliveredForFollowUp: false,
    phase: "HEARING",
    decisionType: null,
    decisionLevel: null,
    decisionRatio: null,
    triageCategory: null,
    followUpPhase: "idle",
    followUpStep: 0,
    bMcBlockShown: false,
    followUpDestinationName: null,
    locationPromptShown: false,
    locationStateFinal: input.locationStateFinal || null,
    location: input.location || null,
    clinicCandidates: [],
    hospitalCandidates: [],
    pharmacyCandidates: [],
    clientMeta: input.clientMeta || {},
    locationSnapshot: null,
    summaryText: null,
    lastConcreteDetailsText: null,
    lastConcreteQueryJP: null,
    lastConcreteQueryEN: null,
    judgmentSnapshot: null,
    followUpSnapshotPendingField: null,
    followUpSnapshotResume: null,
    expectsPainScore: false,
    lastPainScore: null,
    lastPainWeight: null,
    lastNormalizedAnswer: null,
    confirmationPending: false,
    expectsCorrectionReason: false,
    confirmationExtraFacts: [],
    confirmationShown: false,
    /** 先行まとめ生成と追加情報後の再生成を区別。不一致なら generateSummaryForConfirmation は state.summaryText を上書きしない */
    summaryGenerationEpoch: 0,
    summaryGenerationPromise: null,
    /** プリフェッチ開始時の入力フィンガープリント。変更がなければ Promise を再生成しない */
    summaryPrefetchFingerprint: null,
    /** 確認文直前に supplement 済みのとき true。まとめ生成内の追補を省略可能（キャッシュが消えた場合は再実行） */
    skipSupplementBeforeSummary: false,
    /** クライアントが初回バナー「体調の不安…」を表示したセッション。true の間はまとめ・確認文へ進む前に十分なユーザーターンを要する */
    hasIntroBannerSession: false,
    /** 初回安全文（17.1）で使った主症状短縮ラベル。🤝②「一時的な〇〇」と必ず同期する（KAIRO_SPEC 650） */
    safetyIntroMainSymptomLabel: null,
  };
}

function buildStateAboutContextForSummary(state) {
  if (!state) return "";
  const bullets = buildStateFactsBullets(state);
  if (bullets.length === 0) return "";
  return `【🤝 今の状態について（ユーザー固有・必ず参照）】
${bullets.join("\n")}

✅ 今すぐやること は、上記の状態に即した具体的な行動を出してください。一般的なテンプレ・汎用表現は禁止。痛みの強さ・きっかけ・経過など、上記の具体語を理由に反映すること。
`;
}

function buildRepairPrompt(requiredLevel, state = null) {
  const stateContext = buildStateAboutContextForSummary(state);
  return `
あなたはKairoです。以下の会話内容を踏まえ、最後に出すべき「まとめブロック」を**必ず全ブロック**で出力してください。
${stateContext ? `\n${stateContext}\n` : ""}
要件：
- 出力はまとめブロックのみ（質問や追加の会話はしない）
- ブロック構成は必ずフルセット
  - 様子見/市販薬の場合：🟢→🤝→✅→⏳→🌱 の5ブロック（🚨は絶対に出さない）
  - 病院推奨の場合：📝→✅→🏥→💬 の4ブロック
- 🟡は🟢と同じ構成で出力する
- 文章はテンプレ禁止。会話内容に即して自然に書く
- 断定しすぎない表現（「現時点では」「今の情報を見る限り」など）を使う
- 質問・判断の丸投げは禁止
- 共感・寄り添いは必ず入れる
- 緊急度は必ず「${requiredLevel}」に合わせる
- 選択肢や箇条書きの記号は必ず「・」を使う
- ❗どのブロックも欠けてはいけない（1ブロックのみの出力は禁止）
- ❗見出しは必ず以下を全て含める（順番厳守）：
  - 🟢 ここまでの情報を整理します / 🤝 今の状態について / ✅ 今すぐやること / ⏳ 今後の見通し / 🌱 最後に
  - または 📝 今の状態について / ✅ 今すぐやること / 🏥 受診先の候補 / 💬 最後に
- ❗🟢/🟡 ここまでの情報を整理します の本文は固定文のみ。「教えてもらった内容をもとに、今の状態を一度まとめますね。」または「ここまでに聞いたことを整理して、今の状況を確認しますね。」のどちらか1文のみ。自由生成禁止。
- 📝 今の状態について は事実のみ・具体的に書く
  - 「ない」「不明」「特になし」だけの記述は禁止
  - 症状・経過・生活影響など具体語を含める
- 「ない／特にない／該当しない」は不安材料として扱わず、安心材料として書く
- 「ないは気になります」などの逆転表現は絶対に使わない
- 判断や安心コメントには、直前までの情報のうち少なくとも1つを根拠として明示的に反映する
- 🔴の場合、🏥 受診先の候補で受診先のカテゴリを具体的に示す
  - 例：歯の痛み→歯医者／耳の痛み→耳鼻科／腹痛・頭痛→病院
- 🏥 受診先の候補は「近くで行きやすい場所を案内します」を入れ、候補は最大2件までにする
- 🤝 今の状態については一般論の説明を禁止し、感覚の翻訳にする
  - 「今のあなたの状態なら、こう考えて大丈夫です」
  - 「だから今日はこれでいいですよ」
- ⏳ 今後の見通しは「自然な流れの一言 → 具体トリガー1〜2個 → 固定締め文」で構成

🤝 今の状態について（LLM理解レイヤー）：
- 情報整理は単なる言い換えではなく「症状の状態を説明する文章」として生成する。
- 禁止：回答をそのまま並べること（例：・ズキズキする、・さっき始まった）
- OK：症状の意味を短い文章で説明（例：・ズキズキするタイプの痛みが出ている、・症状は急に始まっている）
- 処理順序：回答 → 状況理解 → 要約。Step1:回答を整理 → Step2:症状の意味を考える → Step3:意味を短い文章にする

🤝 今の状態について（順番厳守）：
1) ユーザーのつらさ・不安への一文の寄り添い
2) ユーザーが話した事実の要約（箇条書き・改行）
3) ユーザーの感覚を言葉にして返す（感覚の翻訳）
   - 一般論の説明はしない（医療っぽい説明は禁止）
   - ユーザーの話を主語にする
   - 診断・確定表現は禁止、原因は一つに断定しない
   - 「注意が必要です」は禁止
   - 「今のあなたの状態なら、こう考えて大丈夫です」を必ず含める
   - 「だから今日はこれでいいですよ」を必ず含める
4) Kairoとしての判断（「今の情報を見る限り」「現時点では」の前置き必須）

✅ 今すぐやること：
- 項目は最大3つ
- 各項目は「行動 + 理由（1文）」のセット
${stateContext ? "- 上記【🤝 今の状態について】の内容を必ず反映し、その状態に即した具体的な行動を出す（テンプレ・汎用表現は禁止）\n" : ""}- 理由は不安を下げる説明に限定（正しさの証明・詳細な医学説明は禁止）
- 口調はやわらかく、選択肢を残す
  - 「〜してみてください」「〜すると楽になることがあります」を使う
- 命令形・断定は禁止
- 不安を煽る表現・専門用語は禁止
- 構成の目安：
  1) 体を守る行動（例：水分・姿勢・温める）
  2) 休む・様子を見る行動
  3) 刺激や負担を減らす行動
- 3つのうち1つだけ一般的な医療・健康知識を含める
  - 必ず「一般的に」「〜とされています」を付ける
- 「今この状態なら、まずはこれでいい」という暫定的な行動として提示する

🌱/💬 最後に（必ず会話内容・症状カテゴリ・主症状に即して生成。テンプレ禁止）：
- 本文は3文以内を基準に生成する（「。」が3つ以内）。シンプルで短く。抽象的な励まし禁止（「大切に過ごしてください」等）。
- 必ず行動につながる内容にする。まとめの最後ブロックとして必ず出力する。
- 症状カテゴリ（${state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN"}）と主症状（${state?.primarySymptom || "症状"}）に合わせて、その症状に合った具体的な内容を生成する。汎用表現・テンプレ禁止。
${requiredLevel === "🔴"
  ? `- 🔴の場合：見出しは「💬 最後に」。3文以内を基準に（🔴は2文推奨）。
  - ①受診の肯定：「今の状況で受診を選ぶのは適切な判断です」等、判断をはっきり肯定する。
  - ②行動の後押し：「無理に我慢せず、一度確認してもらうと安心です」等。
  - トーン：不安を煽らない。でも判断ははっきり肯定する。
  - カテゴリ別：PAIN→痛みの相談、SKIN→皮膚の相談、GI→消化器の相談、INFECTION→発熱・喉の相談など、症状に合わせて受診の肯定を具体的に。`
  : `- 🟢/🟡の場合：見出しは「🌱 最後に」。3文以内を基準に。
  - ①今やるべき行動：必ず「休息」を明確に指示。カテゴリに合わせて具体的に：
    - PAIN（痛み系）：動きを控え、安静を優先する指示を。
    - SKIN（皮膚粘膜系）：刺激を避け、患部を休める指示を。
    - GI（消化器系）：消化を休める、食事を控える指示を。
    - INFECTION（発熱感染系）：休養・体を休める指示を。
  - ②理由：回復につながることを説明する（「落ち着いて過ごすことで、回復に向かいやすくなります」等）。
  - ③再訪導線（推奨）：「また不安になったら、いつでもここで確認してください」等。
  - トーン：優しいがはっきり指示。「〜してください」を優先。
  - 主症状に合わせて、その症状に合った休息の指示を生成する。汎用表現禁止。`}
`;
}

function isHospitalFlow(text) {
  return (
    text.includes("🏥 受診先の候補") ||
    text.includes("病院をおすすめします") ||
    text.includes("病院に行くことをおすすめします") ||
    text.includes("病院に行きましょう")
  );
}

function normalizeHospitalMemoHeaderText(text) {
  return String(text || "").replace(/📝\s*いまの状態を整理します（メモ）?/g, "📝 今の状態について");
}

function hasAnySummaryBlocks(text) {
  const normalized = normalizeHospitalMemoHeaderText(text);
  return (
    normalized.includes("🟢 ここまでの情報を整理します") ||
    normalized.includes("🤝 今の状態について") ||
    normalized.includes("✅ 今すぐやること") ||
    normalized.includes("⏳ 今後の見通し") ||
    normalized.includes("💊 一般的な市販薬") ||
    normalized.includes("🌱 最後に") ||
    normalized.includes("📝 今の状態について") ||
    normalized.includes("🏥 受診先の候補") ||
    normalized.includes("💬 最後に")
  );
}

function hasAllSummaryBlocks(text) {
  const normalized = normalizeHospitalMemoHeaderText(text);
  const hospitalHeaders = ["📝 今の状態について", "✅ 今すぐやること", "🏥 受診先の候補", "💬 最後に"];
  const normalHeaders = ["🟢 ここまでの情報を整理します", "🤝 今の状態について", "✅ 今すぐやること", "⏳ 今後の見通し", "🌱 最後に"];
  const yellowHeaders = ["🟡 ここまでの情報を整理します", "🤝 今の状態について", "✅ 今すぐやること", "⏳ 今後の見通し", "🌱 最後に"];
  const required = isHospitalFlow(normalized)
    ? hospitalHeaders
    : normalized.includes("🟡")
      ? yellowHeaders
      : normalHeaders;
  return required.every((header) => normalized.includes(header));
}

function getRequiredSummaryHeadersByLevel(level) {
  if (level === "🔴") {
    return [
      "📝 今の状態について",
      "✅ 今すぐやること",
      "🏥 受診先の候補",
      "💬 最後に",
    ];
  }
  if (level === "🟡") {
    return [
      "🟢 ここまでの情報を整理します",
      "🤝 今の状態について",
      "✅ 今すぐやること",
      "⏳ 今後の見通し",
      "🌱 最後に",
    ];
  }
  return [
    "🟢 ここまでの情報を整理します",
    "🤝 今の状態について",
    "✅ 今すぐやること",
    "⏳ 今後の見通し",
    "🌱 最後に",
  ];
}

function splitByKnownHeaders(text, headers) {
  const lines = String(text || "").split("\n");
  const headerSet = new Set(headers);
  const blocks = new Map();
  let currentHeader = null;
  let currentLines = [];
  const flush = () => {
    if (!currentHeader) return;
    blocks.set(currentHeader, [currentHeader, ...currentLines].join("\n").trim());
  };
  for (const line of lines) {
    const matched = headers.find((h) => line.trim().startsWith(h));
    if (matched) {
      flush();
      currentHeader = matched;
      currentLines = [];
      continue;
    }
    if (currentHeader) {
      currentLines.push(line);
    }
  }
  flush();
  return blocks;
}

const ALL_SUMMARY_HEADERS = [
  "🟢 ここまでの情報を整理します",
  "🤝 今の状態について",
  "✅ 今すぐやること",
  "⏳ 今後の見通し",
  "🌱 最後に",
  "📝 今の状態について",
  "📝 いまの状態を整理します（メモ）",
  "⚠️ Kairoが気になっているポイント",
  "🏥 受診先の候補",
  "🏥 Kairoの判断",
  "💬 最後に",
  "💊 一般的な市販薬",
];

function removeForbiddenSummaryBlocks(text, allowedHeaders) {
  const lines = String(text || "").split("\n");
  const allowed = new Set(allowedHeaders);
  const allHeaders = ALL_SUMMARY_HEADERS;
  const isHeader = (line) => allHeaders.find((h) => line.trim().startsWith(h)) || null;
  const output = [];
  let skipping = false;
  for (const line of lines) {
    const header = isHeader(line);
    if (header) {
      skipping = !allowed.has(header);
      if (!skipping) {
        output.push(header);
      }
      continue;
    }
    if (!skipping) {
      output.push(line);
    }
  }
  return output.join("\n");
}

/** 🚨 もし次の症状が出たら ブロックを強制削除（絶対に出さない） */
function stripEmergencyBlock(text) {
  if (!text || !text.includes("🚨")) return text;
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.startsWith("🚨 ") || l.includes("🚨 もし次の症状が出たら"));
  if (startIdx < 0) return text;
  const nextBlockIdx = lines.findIndex(
    (l, idx) => idx > startIdx && /^(🟢|🟡|🤝|✅|⏳|💊|🌱|📝|🏥|💬)\s/.test(l)
  );
  const endIdx = nextBlockIdx >= 0 ? nextBlockIdx : lines.length;
  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  return [...before, ...after].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function enforceSummaryStructureStrict(text, level, history, state) {
  let normalizedText = normalizeHospitalMemoHeaderText(text);
  normalizedText = stripEmergencyBlock(normalizedText);
  const headers = getRequiredSummaryHeadersByLevel(level);
  const cleaned = removeForbiddenSummaryBlocks(normalizedText, headers);
  const blocks = splitByKnownHeaders(cleaned, headers);
  const hasAll = headers.every((h) => blocks.has(h));
  if (!hasAll) {
    return await buildLocalSummaryFallback(level, history, state);
  }
  // PAIN/INFECTION+🟡: ブロック単位で1件目固定を強制適用（所定位置を確実に確保）
  if (level === "🟡" && state) {
    const category = state.triageCategory || resolveQuestionCategoryFromState(state);
    if ((category === "PAIN" || category === "INFECTION") && blocks.has("✅ 今すぐやること")) {
      const actionBlock = blocks.get("✅ 今すぐやること");
      const fixedBlock = ensurePainInfectionYellowFirstAction(actionBlock, level, state);
      blocks.set("✅ 今すぐやること", fixedBlock);
    }
  }
  // 強制的に仕様順へ再構成（順序ゆらぎを排除）
  let result = headers.map((h) => blocks.get(h)).join("\n\n").trim();
  // PAIN/INFECTION+🟡: 最終ガードとして1件目固定を適用
  if (level === "🟡" && state) {
    result = ensurePainInfectionYellowFirstAction(result, level, state);
  }
  return result;
}

function extractSummaryLine(text) {
  const lines = (text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("🟢") || lines[i].startsWith("🟡") || lines[i].startsWith("🔴")) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (candidate === "⸻") continue;
        if (candidate.startsWith("🤝") || candidate.startsWith("✅") || candidate.startsWith("⏳") || candidate.startsWith("🚨") || candidate.startsWith("💊") || candidate.startsWith("🌱")) {
          return null;
        }
        return candidate;
      }
    }
  }
  return null;
}

function normalizeSummaryLevel(text, requiredLevel) {
  if (!text || !requiredLevel) return text;
  const headingLevel = requiredLevel === "🟡" ? "🟢" : requiredLevel;
  let updated = text
    .replace("🟢 まず安心してください", `${headingLevel} ここまでの情報を整理します`)
    .replace("🟡 まず安心してください", `${headingLevel} ここまでの情報を整理します`)
    .replace("🟢 ここまでの情報を整理します", `${headingLevel} ここまでの情報を整理します`)
    .replace("🟡 ここまでの情報を整理します", `${headingLevel} ここまでの情報を整理します`);

  if (updated.includes("💊 一般的な市販薬")) {
    const lines = updated.split("\n");
    const start = lines.findIndex((line) => line.includes("💊 一般的な市販薬"));
    if (start >= 0) {
      const end = lines.findIndex(
        (line, idx) => idx > start && (line.includes("🌱 最後に") || line.startsWith("🟢") || line.startsWith("🟡"))
      );
      const sliceEnd = end >= 0 ? end : lines.length;
      updated = [...lines.slice(0, start), ...lines.slice(sliceEnd)].join("\n");
    }
  }

  return updated;
}

/** 🟢/🟡まとめの先頭に「🟢 ここまでの情報を整理します」を強制。欠け／順序違いは移動または付与（病院フローは対象外）。 */
function ensureGreenHeaderForYellow(text, requiredLevel) {
  if (!text) return text;
  if (requiredLevel !== "🟢" && requiredLevel !== "🟡") return text;
  const normalized = normalizeHospitalMemoHeaderText(text);
  if (isHospitalFlow(normalized)) return text;
  const targetHeader = "🟢 ここまでの情報を整理します";
  const isIntroLine = (l) => {
    const t = String(l || "").trimStart();
    return t.startsWith("🟢 ここまでの情報を整理します") || t.startsWith("🟡 ここまでの情報を整理します");
  };
  const isNextBlockHeader = (l) => /^(🤝|✅|⏳|🌱|💊|📝|🏥|💬)\s/.test(String(l || "").trimStart());
  const lines = normalized.split("\n");
  const introIdx = lines.findIndex(isIntroLine);
  if (introIdx === -1) {
    const intro = buildSummaryIntroTemplate();
    return `${targetHeader}\n${intro}\n\n${normalized.trim()}`;
  }
  let introEnd = lines.length;
  for (let i = introIdx + 1; i < lines.length; i++) {
    if (isNextBlockHeader(lines[i])) {
      introEnd = i;
      break;
    }
  }
  const introSlice = lines.slice(introIdx, introEnd).map((l) =>
    String(l).trimStart().startsWith("🟡 ここまでの情報を整理します")
      ? l.replace("🟡 ここまでの情報を整理します", targetHeader)
      : l
  );
  const introBlock = introSlice.join("\n");
  if (introIdx === 0) {
    return lines
      .slice(0, introIdx)
      .concat(introSlice, lines.slice(introEnd))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  const before = lines.slice(0, introIdx);
  const after = lines.slice(introEnd);
  const rest = [...before, ...after].join("\n").trim();
  return `${introBlock}\n\n${rest}`.replace(/\n{3,}/g, "\n\n");
}

function buildPostSummaryFollowUp(state, history) {
  const facts = buildFactsFromSlotAnswers(state)
    .map((line) => line.replace(/^・/, ""))
    .slice(0, 2)
    .join("、");
  const topic = facts ? `たとえば「${facts}」の伝え方` : "今の話の伝え方";
  return `もし、病院や薬局で${topic}に迷ったら、\nここで一緒に整理することもできます。\nやってみますか？`;
}

function ensureFollowUpAppended(text, state, history) {
  if (!state?.followUpPending) return text;
  if (!state?.summaryDeliveredForFollowUp) return text;
  const followUp = buildPostSummaryFollowUp(state, history);
  state.followUpPending = false;
  if (!text) return followUp;
  if (text.includes(followUp)) return text;
  return `${text}\n\n${followUp}`;
}

function buildOtcWarningLine(variantIndex) {
  const variants = [
    "これは例示であり、診断や処方ではありません。体質や症状によって合わない場合があります。",
    "あくまで例としての提示です。体調や薬の相性によって適さない場合があります。",
    "例として挙げていますが、症状や体質によって合わないこともあります。",
    "参考例としての案内です。体調によって合わない場合があります。",
    "例示の情報であり、診断や処方ではありません。体質によって合わない場合があります。",
  ];
  const idx = Math.max(0, Math.min(variants.length - 1, variantIndex || 0));
  return variants[idx];
}

function buildYellowOtcBlock(category, warningIndex = 0, pharmacyRec, otcExamples, locationPreface) {
  const examples = otcExamples || [];
  const lines = [
    "💊 一般的な市販薬",
    "⭐ おすすめの薬局",
  ];
  const pharmacyNames = (pharmacyRec?.candidates || [])
    .map((c) => c?.name)
    .filter(Boolean)
    .slice(0, 2);
  if (pharmacyNames.length === 0 && pharmacyRec?.name) pharmacyNames.push(pharmacyRec.name);
  if (pharmacyNames.length > 0) {
    lines.push(`**${pharmacyNames.join("・")}**`);
  }
  lines.push("薬はこの2つからでOK");
  const picked = examples.slice(0, 2);
  picked.forEach((item, index) => {
    const num = index === 0 ? "①" : "②";
    lines.push("");
    lines.push(`${num} ${item.generic}（${item.brand}）`);
    lines.push(`👉 ${item.use}`);
    // 「どういう薬なのか」説明（必須：1〜2個）
    const desc = Array.isArray(item?.descBullets)
      ? item.descBullets.filter(Boolean).slice(0, 2)
      : [];
    if (desc.length > 0) {
      desc.forEach((b) => {
        const normalized = String(b)
          .replace(/使われることがある/g, "使われます")
          .replace(/使われることが多い/g, "使われます")
          .replace(/使われることがあります/g, "使われます")
          .replace(/選ばれることがある/g, "選ばれます")
          .replace(/選ばれることが多い/g, "選ばれます")
          .replace(/選ばれることがあります/g, "選ばれます");
        lines.push(`・${normalized}`);
      });
    } else {
      lines.push("・このタイプの症状のつらさをやわらげる目的で使われます");
    }
  });
  lines.push("※ どちらか1つで大丈夫です。");
  lines.push("迷ったら、今の症状をそのまま薬剤師に見せてください。");
  lines.push("一緒に確認してもらえます。");
  return lines.filter(Boolean).join("\n");
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(r * c);
}

function buildMapsUrl(place, origin) {
  if (!place?.name) return "";
  const params = new URLSearchParams({
    api: "1",
    query: place.name,
  });
  if (origin?.lat && origin?.lng) {
    params.set("location", `${origin.lat},${origin.lng}`);
    params.set("radius", "1000");
  }
  if (place.placeId) {
    params.set("query_place_id", place.placeId);
  }
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function normalizePlaces(results, origin) {
  return (results || [])
    .map((item) => {
      const name = item?.name;
      if (!name) return null;
      const loc = item?.geometry?.location;
      const lat = typeof loc?.lat === "function" ? loc.lat() : loc?.lat;
      const lng = typeof loc?.lng === "function" ? loc.lng() : loc?.lng;
      const distanceM =
        origin?.lat !== undefined && origin?.lng !== undefined && lat !== undefined && lng !== undefined
          ? distanceMeters(origin.lat, origin.lng, lat, lng)
          : null;
      const placeId = item?.place_id || "";
      const rating = typeof item?.rating === "number" ? item.rating : null;
      const userRatingsTotal =
        typeof item?.user_ratings_total === "number" ? item.user_ratings_total : null;
      const types = Array.isArray(item?.types) ? item.types : [];
      const vicinity = typeof item?.vicinity === "string" ? item.vicinity : "";
      const base = { name, placeId, distanceM, lat, lng, rating, userRatingsTotal, types, vicinity };
      return { ...base, mapsUrl: buildMapsUrl(base, origin) };
    })
    .filter(Boolean);
}

function mergePlaces(...lists) {
  const seen = new Set();
  const merged = [];
  lists.flat().forEach((place) => {
    const key = place.placeId || place.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(place);
  });
  return merged;
}

function getPlacesApiKey() {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  console.log("[Places API] ENV CHECK:", {
    "GOOGLE_PLACES_API_KEY in process.env": "GOOGLE_PLACES_API_KEY" in process.env,
    "value exists": !!key,
    "value length": key ? key.length : 0,
    "GOOGLE_* keys": Object.keys(process.env || {}).filter((k) => /^GOOGLE/i.test(k)),
  });
  return (
    key ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

async function fetchNearbyPlaces(location, { keyword, type, radius = 1000, rankByDistance = false }) {
  const key = getPlacesApiKey();
  if (!key) {
    console.warn("[Places API] キーが未設定です。GOOGLE_PLACES_API_KEY または GOOGLE_MAPS_API_KEY を .env に設定してください。");
    return [];
  }
  if (!location?.lat || !location?.lng) return [];
  const params = new URLSearchParams({
    location: `${location.lat},${location.lng}`,
    key,
  });
  if (rankByDistance) {
    params.set("rankby", "distance");
  } else {
    params.set("radius", String(radius));
  }
  if (keyword) params.set("keyword", keyword);
  if (type) params.set("type", type);
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.warn("[Places API] nearbysearch エラー:", data.status, data.error_message || "");
  }
  if (!res.ok) return [];
  return normalizePlaces(data.results || [], location);
}

async function fetchPlacesByTextSearch(location, query, { type, radius = 5000 } = {}) {
  const key = getPlacesApiKey();
  if (!key) return [];
  if (!location?.lat || !location?.lng) return [];
  const params = new URLSearchParams({
    query: String(query || "clinic").trim(),
    location: `${location.lat},${location.lng}`,
    radius: String(radius),
    key,
  });
  if (type) params.set("type", type);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.warn("[Places API] textsearch エラー:", data.status, data.error_message || "");
  }
  if (!res.ok) return [];
  return normalizePlaces(data.results || [], location);
}

async function fetchPlaceDetails(placeId, { language = "en", includeOpeningHours = false } = {}) {
  if (!getPlacesApiKey()) return null;
  if (!placeId) return null;
  const baseFields = "place_id,name,rating,reviews,types,url,user_ratings_total,editorial_summary";
  const fields = includeOpeningHours ? `${baseFields},opening_hours` : baseFields;
  const params = new URLSearchParams({
    place_id: placeId,
    key: getPlacesApiKey(),
    language: language || "en",
    fields,
  });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.result;
  if (!result) return null;
  const openingHours = result?.opening_hours;
  const openNow =
    openingHours && typeof openingHours?.open_now === "boolean"
      ? openingHours.open_now
      : typeof result?.opening_hours?.open_now === "boolean"
        ? result.opening_hours.open_now
        : null;
  return {
    name: typeof result?.name === "string" ? result.name.trim() : null,
    rating: typeof result?.rating === "number" ? result.rating : null,
    userRatingsTotal:
      typeof result?.user_ratings_total === "number" ? result.user_ratings_total : null,
    types: Array.isArray(result?.types) ? result.types : [],
    mapUrl: typeof result?.url === "string" ? result.url : "",
    editorialSummary: result?.editorial_summary?.overview || "",
    reviewTexts: Array.isArray(result?.reviews)
      ? result.reviews.map((r) => String(r?.text || "").trim()).filter(Boolean)
      : [],
    openNow: includeOpeningHours ? openNow : null,
  };
}

const MIN_RATING_FOR_CARE_DISPLAY = 3.8;

/** Step2：強制フィルタ（veterinary, dental, pediatric, 動物病院・歯科・小児科を除外。allowDental=trueの時は歯科を許可） */
function filterExcludedCareTypes(candidates, allowDental = false) {
  return (candidates || []).filter((c) => {
    const types = c?.types || [];
    if (!allowDental && (types.includes("veterinary_care") || types.includes("dentist"))) return false;
    const hay = [c?.name || "", c?.vicinity || "", ...(c?.types || [])].join(" ").toLowerCase();
    if (/動物|veterinary|vet\b|小児科|pediatric|children\s*clinic/i.test(hay)) return false;
    if (!allowDental && /歯科|dental|dentist/i.test(hay)) return false;
    return true;
  });
}

/** 🇸🇬 シンガポール専用：除外フィルタ（allowDental=trueの時は歯科を許可） */
const SG_EXCLUDE_PATTERN = /\b(dental|dentist|aesthetic|beauty|tcm|chinese\s*medicine|physio|rehab|animal|veterinary|pediatric|children)\b|小児科/i;
const SG_EXCLUDE_PATTERN_NO_DENTAL = /\b(aesthetic|beauty|tcm|chinese\s*medicine|physio|rehab|animal|veterinary|pediatric|children)\b|小児科/i;
function filterSingaporeExcluded(candidates, allowDental = false) {
  return (candidates || []).filter((c) => {
    if (filterExcludedCareTypes([c], allowDental).length === 0) return false;
    const hay = [c?.name || "", c?.vicinity || "", ...(c?.types || [])].join(" ").toLowerCase();
    return !(allowDental ? SG_EXCLUDE_PATTERN_NO_DENTAL : SG_EXCLUDE_PATTERN).test(hay);
  });
}

/** 🇸🇬 スコア：japaneseClinic*3 + gpMatch*3 + distanceScore*2 + ratingScore */
function computeSingaporeCareScore(candidate) {
  const text = [candidate?.name || "", candidate?.vicinity || "", ...(candidate?.types || [])].join(" ").toLowerCase();
  const japaneseClinic = /japanese|日系|nihon|日本語/.test(text) ? 3 : 0;
  const gpMatch = /\b(gp|general practitioner|family\s*clinic|family\s*doctor)\b/.test(text) ? 3 : 0;
  const distM = candidate?.distanceM ?? 9999;
  const distanceScore =
    distM <= 500 ? 2 : distM <= 1000 ? 1 : -1;
  const rating = Number(candidate?.rating ?? candidate?.details?.rating ?? 0) || 0;
  const ratingScore = rating >= 4.5 ? 2 : rating >= 4.0 ? 1 : rating >= 3.8 ? 0 : -999;
  return japaneseClinic * 3 + gpMatch * 3 + Math.max(0, distanceScore) * 2 + Math.max(0, ratingScore);
}

/** Step3：症状適合スコア（symptomMatchScore） */
function symptomMatchScore(candidate, category) {
  const name = String(candidate?.name || "").toLowerCase();
  const types = (candidate?.types || []).join(" ").toLowerCase();
  const hay = `${name} ${types}`;
  let score = 0;
  if (category === "PAIN") {
    if (/内科|クリニック|internal|clinic/.test(hay)) score += 2;
  } else if (category === "SKIN") {
    if (/皮膚|derma|skin/.test(hay)) score += 3;
    if (/内科|internal/.test(hay)) score += 1;
  } else if (category === "GI") {
    if (/消化器|gastro|digestive/.test(hay)) score += 3;
    if (/内科|internal/.test(hay)) score += 1;
  } else if (category === "INFECTION") {
    if (/gp|general practitioner|family doctor|fever|internal/.test(hay)) score += 2;
    if (/clinic/.test(hay)) score += 1;
  } else {
    if (/内科|クリニック|internal|clinic|gp/.test(hay)) score += 2;
  }
  return score;
}

function filterByMinRating(candidates) {
  return (candidates || []).filter((c) => {
    const r = c?.rating ?? c?.details?.rating;
    return r != null && Number(r) > MIN_RATING_FOR_CARE_DISPLAY;
  });
}

function sortPlacesByRatingThenDistance(list) {
  return (list || []).sort((a, b) => {
    const aHasRating = a?.rating !== null && a?.rating !== undefined;
    const bHasRating = b?.rating !== null && b?.rating !== undefined;
    if (aHasRating && bHasRating && a.rating !== b.rating) {
      return b.rating - a.rating;
    }
    if (aHasRating && !bHasRating) return -1;
    if (!aHasRating && bHasRating) return 1;
    return (a?.distanceM ?? 0) - (b?.distanceM ?? 0);
  });
}

function detectCareMainSymptomText(state, historyText = "") {
  const source = [
    state?.primarySymptom || "",
    state?.slotAnswers?.worsening || "",
    state?.slotAnswers?.associated_symptoms || "",
    state?.slotAnswers?.cause_category || "",
    historyText || "",
  ]
    .filter(Boolean)
    .join(" ");
  const matched = source.match(/[^\n。]{0,24}(腹痛|お腹|胃痛|下痢|便秘|吐き気|発熱|咳|喉|頭痛|皮膚|かゆみ)[^\n。]{0,24}/);
  return matched ? matched[0] : (state?.primarySymptom || "現在の症状");
}

function buildCareSearchQueries(mainSymptomText = "", destination) {
  const s = String(mainSymptomText || "");
  if (/腹|お腹|胃|下痢|便秘|吐き気/.test(s)) {
    return {
      searchKeywords: ["abdominal pain", "gastro", "digestive", "GP", "family medicine"],
      includeTerms: ["gastro", "digestive", "gp", "family", "general practitioner", "clinic"],
      excludeTerms: ["orthopedic", "orthopaedic", "dermatology", "skin", "美容", "整形", "皮膚"],
      symptomLabel: "腹痛・消化器症状",
    };
  }
  if (/喉|のど|咳|せき|鼻|発熱|寒気/.test(s)) {
    return {
      searchKeywords: ["ENT", "general practitioner", "family medicine", "fever clinic"],
      includeTerms: ["ent", "gp", "general practitioner", "family", "clinic", "internal medicine"],
      excludeTerms: ["orthopedic", "orthopaedic", "dermatology", "dental", "美容", "整形", "皮膚", "歯科"],
      symptomLabel: "発熱・上気道症状",
    };
  }
  if (/頭痛|頭が痛|こめかみ/.test(s)) {
    return {
      searchKeywords: ["general practitioner", "family medicine", "neurology clinic", "internal medicine"],
      includeTerms: ["gp", "family", "internal medicine", "clinic", "neurology"],
      excludeTerms: ["orthopedic", "dermatology", "dental", "美容", "整形", "皮膚", "歯科"],
      symptomLabel: "頭痛症状",
    };
  }
  if (/かゆみ|皮膚|発疹|赤み|ヒリヒリ|唇/.test(s)) {
    return {
      searchKeywords: ["dermatology clinic", "general practitioner", "family medicine"],
      includeTerms: ["dermatology", "skin", "gp", "family", "clinic"],
      excludeTerms: ["orthopedic", "dental", "美容外科", "整形外科", "歯科"],
      symptomLabel: "皮膚・粘膜症状",
    };
  }
  if (/歯|歯ぐき|虫歯|親知らず|奥歯/.test(s) || destination?.label === "歯医者") {
    return {
      searchKeywords: ["dentist", "dental clinic", "歯科", "歯医者"],
      includeTerms: ["dentist", "dental", "歯科", "歯医者", "clinic"],
      excludeTerms: ["orthopedic", "orthopaedic", "dermatology", "美容", "整形", "皮膚"],
      symptomLabel: "歯の症状",
    };
  }
  return {
    searchKeywords: destination?.places?.keywords || ["clinic", "general practitioner", "medical clinic"],
    includeTerms: ["clinic", "gp", "general practitioner", "family", "internal medicine"],
    excludeTerms: ["orthopedic", "orthopaedic", "dermatology", "dental", "美容", "整形", "皮膚", "歯科"],
    symptomLabel: detectCareMainSymptomText({ primarySymptom: mainSymptomText }),
  };
}

function containsAny(text, terms) {
  const normalized = String(text || "").toLowerCase();
  return (terms || []).some((t) => normalized.includes(String(t || "").toLowerCase()));
}

function applySymptomFitFilter(candidates, plan) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!plan?.includeTerms?.length && !plan?.excludeTerms?.length) return list;
  const filtered = list.filter((item) => {
    const hay = [item?.name || "", item?.vicinity || "", ...(item?.types || [])].join(" ").toLowerCase();
    if (plan?.excludeTerms?.length && containsAny(hay, plan.excludeTerms)) return false;
    if (!plan?.includeTerms?.length) return true;
    return containsAny(hay, plan.includeTerms);
  });
  return filtered.length > 0 ? filtered : list;
}

const JAPANESE_CLINIC_SEARCH_KEYWORDS = [
  "Japanese clinic",
  "Japanese medical clinic",
  "Japanese doctor clinic",
];

/** 症状カテゴリごとのGP検索キーワード（v2：専門科に寄せすぎずGP/内科軸） */
function getGpSearchKeywordsByCategory(category) {
  switch (category) {
    case "PAIN":
      return ["general practitioner clinic", "internal medicine clinic", "family doctor"];
    case "SKIN":
      return ["dermatology clinic", "skin clinic", "general practitioner clinic"];
    case "GI":
      return ["gastro clinic", "internal medicine clinic", "general practitioner clinic"];
    case "INFECTION":
      return ["general practitioner clinic", "family doctor", "fever clinic"];
    default:
      return ["general practitioner clinic", "family doctor", "medical clinic"];
  }
}

function isToothPainSymptom(text) {
  return /歯|歯ぐき|虫歯|親知らず|奥歯/.test(text || "");
}

/** 🇸🇬 シンガポール専用：日本人クリニック + GP、最適1件決定（main + alternatives）。歯痛時は歯科も検索・表示。 */
async function fetchCarePlacesForSingapore(location, state) {
  if (!getPlacesApiKey() || !location?.lat || !location?.lng) return [];
  const historyText = state?.historyTextForCare || "";
  const allowDental = isToothPainSymptom(historyText);

  // ① 日本人クリニック：Text Search "japanese clinic singapore"、半径制限なし、最大3件
  const japaneseRaw = await fetchPlacesByTextSearch(location, "japanese clinic singapore", { radius: 50000 });
  const japanese = filterSingaporeExcluded(
    mergePlaces(japaneseRaw).filter(isJapaneseClinicOrSupport),
    allowDental
  ).slice(0, 3);

  // ② GP／歯科（歯痛時）：Nearby Search、radius=1000、type=doctor or dentist
  const gpKeywords = allowDental ? ["clinic", "GP", "family medicine", "dentist", "dental clinic"] : ["clinic", "GP", "family medicine"];
  const gpRaw = [];
  for (const kw of gpKeywords) {
    const places = await fetchNearbyPlaces(location, {
      keyword: kw,
      type: allowDental && /dentist|dental/.test(kw) ? "dentist" : "doctor",
      radius: 1000,
    });
    gpRaw.push(...places);
  }
  const gp = filterSingaporeExcluded(
    mergePlaces(gpRaw).filter((c) => !isJapaneseClinicOrSupport(c)),
    allowDental
  ).filter((c) => (c?.distanceM ?? 0) <= 1000);

  // ③④ フィルタ（rating 3.8+）＋スコアリング
  const allCandidates = filterByMinRating(mergePlaces(japanese, gp));
  const scored = allCandidates.map((c) => ({ ...c, _sgScore: computeSingaporeCareScore(c) }));
  const meetsRating = scored.filter((c) => c._sgScore >= 0);

  // ⑤ 意思決定：主役＝GP（必須）、日系＝サブ主役（英語不安の選択肢）
  const gpSorted = meetsRating
    .filter((c) => !isJapaneseClinicOrSupport)
    .sort((a, b) => (b._sgScore || 0) - (a._sgScore || 0));
  const japaneseSorted = meetsRating
    .filter(isJapaneseClinicOrSupport)
    .sort((a, b) => (b._sgScore || 0) - (a._sgScore || 0));

  const main = gpSorted[0];
  const alt1 = japaneseSorted[0] || null;
  const alt2 = gpSorted[1] || null;
  const alt3 = japaneseSorted[1] || gpSorted[2] || null;
  const alt4 = gpSorted[3] || japaneseSorted[2] || null;
  const alternatives = [alt1, alt2, alt3, alt4].filter(Boolean);

  const result = [main, ...alternatives].filter(Boolean);
  return result.map(({ _sgScore, ...rest }) => rest);
}

async function fetchCarePlacesWithFallbacks(location, plan, state) {
  if (!getPlacesApiKey()) {
    console.warn("[Places] APIキー未設定のため検索をスキップ");
    return [];
  }
  if (!location?.lat || !location?.lng) {
    console.warn("[Places] 位置情報がないため検索をスキップ", { location });
    return [];
  }
  const country = String(state?.locationContext?.country || "").trim();
  if (country === "Singapore") {
    return fetchCarePlacesForSingapore(location, state);
  }
  const hasDentalIntent = /dentist|dental/.test((plan?.searchKeywords || []).join(" "));
  const types = hasDentalIntent ? ["dentist", "doctor", "hospital", "health"] : ["doctor", "hospital", "health"];
  const baseKeywords = plan?.searchKeywords || ["clinic", "general practitioner", "medical clinic"];
  const isJapan = /japan|jp|日本/i.test(country);
  const keywords = isJapan
    ? [...baseKeywords, "クリニック", "内科", "病院", "医療", "診療所"]
    : [...baseKeywords, "medical"];
  const radiuses = [1000, 3000, 5000, 10000, 20000, 50000];
  const results = [];
  for (const radius of radiuses) {
    for (const type of types) {
      for (const keyword of keywords) {
        const places = await fetchNearbyPlaces(location, { keyword, type, radius });
        results.push(...places);
      }
    }
    if (results.length > 0) break;
  }
  if (results.length === 0) {
    for (const type of types) {
      const rankBy = await fetchNearbyPlaces(location, { type, rankByDistance: true });
      results.push(...rankBy);
    }
  }
  const textQueries = isJapan
    ? ["クリニック", "内科 クリニック", "病院", "医療", "clinic", "hospital", "doctor"]
    : ["clinic", "hospital", "doctor", "medical clinic", "GP", "medical"];
  if (results.length === 0) {
    for (const q of textQueries) {
      for (const radius of [5000, 10000, 20000, 50000]) {
        const textResults = await fetchPlacesByTextSearch(location, q, { type: "doctor", radius });
        results.push(...textResults);
        if (results.length >= 4) break;
      }
      if (results.length >= 4) break;
    }
  }
  if (results.length === 0) {
    for (const q of textQueries) {
      for (const radius of [10000, 20000, 50000]) {
        const textResults = await fetchPlacesByTextSearch(location, q, { radius });
        results.push(...textResults);
        if (results.length >= 4) break;
      }
      if (results.length >= 4) break;
    }
  }
  if (results.length === 0) {
    const lastQuery = isJapan ? "病院 クリニック" : "hospital clinic medical";
    const last = await fetchPlacesByTextSearch(location, lastQuery, { radius: 50000 });
    results.push(...last);
  }
  if (results.length === 0) {
    let city = String(state?.locationContext?.city || state?.locationContext?.area || "").trim();
    if (!city && location?.lat && location?.lng) {
      const geo = await reverseGeocodeLocation(location);
      city = geo?.city || geo?.area || "";
    }
    if (city) {
      const cityQuery = isJapan ? `${city} 病院 クリニック` : `${city} hospital clinic`;
      const cityResults = await fetchPlacesByTextSearch(location, cityQuery, { radius: 50000 });
      results.push(...cityResults);
    }
  }
  if (results.length === 0 && getPlacesApiKey() && location?.lat && location?.lng) {
    console.error("[Places API] 全検索戦略で0件: キー・位置は有効なため、通常は発生しない想定です", {
      lat: location.lat,
      lng: location.lng,
      country: state?.locationContext?.country,
    });
  }
  return results;
}

function scoreSingaporePreference(candidate) {
  const text = [
    candidate?.name || "",
    candidate?.vicinity || "",
    ...(candidate?.types || []),
    candidate?.details?.editorialSummary || "",
    ...(candidate?.details?.reviewTexts || []).slice(0, 5).join(" "),
  ].join(" ");
  const hasJapaneseClinic = /(japanese|日系|nihon)/i.test(candidate?.name || "");
  const hasJapaneseSupport = /(日本語対応|japanese support|japanese speaking|日本語)/i.test(text);
  const hasGp = /(gp|general practitioner|family|clinic)/i.test(text);
  const hasLargeHospital = /(hospital|medical centre|medical center)/i.test(text);
  // 仕様順: 1)日系 2)日本語対応 3)GP/Family 4)大型病院
  if (hasJapaneseClinic) return 40;
  if (hasJapaneseSupport) return 30;
  if (hasGp) return 20;
  if (hasLargeHospital) return 10;
  return 0;
}

/** 総合スコア：symptomMatch * 0.5 + (1/distance) * 0.3 + rating * 0.2 */
function computeCareCandidateScore(candidate, category) {
  const sm = symptomMatchScore(candidate, category);
  const distM = candidate?.distanceM ?? 500;
  const distKm = Math.max(0.05, distM / 1000);
  const distScore = 1 / distKm;
  const rating = Number(candidate?.rating ?? candidate?.details?.rating ?? 0) || 0;
  const rNorm = Math.min(5, Math.max(0, rating)) / 5;
  return sm * 0.5 + Math.min(10, distScore) * 0.3 + rNorm * 0.2;
}

function prioritizeCareCandidates(candidates, state) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  const country = String(state?.locationContext?.country || "").toLowerCase();
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state) || "PAIN";
  if (country.includes("singapore")) {
    return list.sort((a, b) => {
      const p = scoreSingaporePreference(b) - scoreSingaporePreference(a);
      if (p !== 0) return p;
      return sortPlacesByRatingThenDistance([a, b])[0] === a ? -1 : 1;
    });
  }
  return list.sort((a, b) => computeCareCandidateScore(b, category) - computeCareCandidateScore(a, category));
}

function formatDistanceForCare(distanceM) {
  if (!Number.isFinite(distanceM)) return "不明";
  if (distanceM < 1000) return `約${distanceM}m`;
  return `約${(distanceM / 1000).toFixed(1)}km`;
}

function isJapaneseClinicOrSupport(candidate) {
  const text = [
    candidate?.name || "",
    candidate?.vicinity || "",
    ...(candidate?.types || []),
    candidate?.details?.editorialSummary || "",
    ...(candidate?.details?.reviewTexts || []).slice(0, 5).join(" "),
  ].join(" ");
  if (/(japanese|日系|nihon|日本語対応|japanese support|japanese speaking|日本語)/i.test(text)) return true;
  const name = String(candidate?.name || "");
  return /(内科|クリニック|耳鼻科|小児科|メンタル)/.test(name);
}

/** 🇸🇬 保険表示（施設名の横）。Places APIでは保険情報取得不可のため傾向ベース */
function getInsuranceLabel(facility, isSingapore) {
  if (!isSingapore || !facility) return "";
  const text = [facility?.name || "", facility?.vicinity || "", ...(facility?.types || [])].join(" ").toLowerCase();
  if (/(japanese|日系|nihon)/i.test(text)) return "［保険: △ 要確認（自費になることも）］";
  if (/\b(clinic|gp|family)\b/.test(text)) return "［保険: ◯ 使えることが多い］";
  return "［保険: -］";
}

const FORBIDDEN_REASON_PHRASES = /説明が丁寧|評判が良い|相談しやすい|人気|おすすめ/;

/** 症状カテゴリ別の「症状との相性」候補（優先1） */
function getSymptomFitReasonsByCategory(category) {
  switch (category) {
    case "PAIN":
      return [
        "痛みや体調不良の初期相談で利用されることが多い",
        "体調不良の相談で利用されることが多い",
      ];
    case "SKIN":
      return [
        "皮膚トラブルの初期相談がしやすい",
        "発疹やかゆみの相談で利用されることが多い",
      ];
    case "GI":
      return [
        "腹痛・消化器症状の初期相談で利用されることが多い",
        "体調不良の初期相談に対応しているGP",
      ];
    case "INFECTION":
      return [
        "発熱や体調不良の相談で利用されることが多い",
        "体調不良の初期相談で利用されることが多い",
      ];
    default:
      return [
        "体調不良の初期相談で利用されることが多い",
        "初期相談の窓口として利用されることが多い",
      ];
  }
}

/** モーダル用：メイン1件の「役割」理由（なぜ最初にここでいいか） */
function getMainFacilityRoleReasons(category, isSingapore, isJapanese) {
  if (isSingapore && !isJapanese) {
    return [
      "体調不良のときに最初に相談する一般的な医療機関",
      "その場で必要な対応や次の判断まで見てもらえる",
      "シンガポールではまずここから受診する流れが基本",
    ];
  }
  if (isSingapore && isJapanese) {
    return ["日本語で症状をそのまま伝えられる", "海外でも安心して相談しやすい環境"];
  }
  if (isSingapore) {
    return [
      "シンガポールではまず最初に受診する一般的な医療機関",
      "幅広い症状をまとめて相談できるため、迷わず受診しやすい",
    ];
  }
  return [
    "幅広い症状をまとめて相談できるため、迷わず受診しやすい",
    "初期相談の窓口として利用されることが多い",
  ];
}

/** モーダル用：メイン1件のいいところ3つ（症状との相性・役割・安心材料） */
function buildMainFacilityReasons(candidate, plan, state = null) {
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
  const isSingapore = String(state?.locationContext?.country || "").trim() === "Singapore";
  const isJapanese = isJapaneseClinicOrSupport(candidate);
  const reasons = [];
  const rolePool = getMainFacilityRoleReasons(category, isSingapore, isJapanese);
  for (const r of rolePool) {
    if (!FORBIDDEN_REASON_PHRASES.test(r) && reasons.length < 3) reasons.push(r);
  }
  if (reasons.length < 2 && !isJapanese) {
    const symptomPool = getSymptomFitReasonsByCategory(category);
    const pick = symptomPool.find((p) => !FORBIDDEN_REASON_PHRASES.test(p) && !reasons.includes(p));
    if (pick) reasons.push(pick);
  }
  return reasons.slice(0, 3).map((r) => (r.startsWith("・") ? r : `・${r}`));
}

/** モーダル用：補助候補のシンプルな理由1つ */
function buildAuxiliaryReason(candidate, plan, state = null, indexInAux = 0) {
  if (isJapaneseClinicOrSupport(candidate)) return "・日本語で症状をそのまま伝えられる";
  const isSingapore = String(state?.locationContext?.country || "").trim() === "Singapore";
  if (isSingapore) {
    const gpReasons = ["・一般的な体調不良の相談に対応している", "・近くで受診しやすい"];
    return gpReasons[Math.min(indexInAux, gpReasons.length - 1)];
  }
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
  const pool = getSymptomFitReasonsByCategory(category);
  const pick = pool.find((p) => !FORBIDDEN_REASON_PHRASES.test(p));
  return pick ? `・${pick}` : "・一般的な体調不良の相談に対応している";
}

/** いいところ生成：優先順位1〜4、最大2・最低1、禁止表現を避け、同じ文章を使い回さない */
function buildHospitalRecommendationReasons(candidate, plan, state = null, usedReasons = new Set()) {
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
  const reasons = [];
  const pick = (pool) => {
    const available = pool.filter((p) => !usedReasons.has(p) && !FORBIDDEN_REASON_PHRASES.test(p));
    if (available.length > 0) {
      const chosen = available[0];
      reasons.push(`・${chosen}`);
      usedReasons.add(chosen);
      return true;
    }
    return false;
  };

  const symptomPool = getSymptomFitReasonsByCategory(category);
  pick(symptomPool);

  if (isJapaneseClinicOrSupport(candidate)) {
    const jp = "日本語で症状を説明できるため安心";
    if (!usedReasons.has(jp) && reasons.length < 2) {
      reasons.push(`・${jp}`);
      usedReasons.add(jp);
    }
  }

  if (reasons.length < 2) {
    const accessPool = [
      "現在地から行きやすい場所にあります",
      "駅や主要エリアからアクセスしやすい",
    ];
    pick(accessPool);
  }

  if (reasons.length < 2) {
    const initialPool = [
      "初期相談の窓口として利用されることが多い",
      "体調不良の初期相談に対応しているGP",
    ];
    pick(initialPool);
  }

  if (reasons.length === 0) {
    const fallback = "体調不良の初期相談で利用されることが多い";
    reasons.push(`・${fallback}`);
    usedReasons.add(fallback);
  }
  return reasons.slice(0, 2);
}

async function reverseGeocodeLocation(location) {
  const apiKey = process.env.GOOGLE_GEOCODE_API_KEY || getPlacesApiKey();
  if (!apiKey || !location?.lat || !location?.lng) return null;
  const params = new URLSearchParams({
    latlng: `${location.lat},${location.lng}`,
    key: apiKey,
    language: "en",
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const result = (data.results || [])[0];
  if (!result) return null;
  const comps = result.address_components || [];
  const get = (type) => comps.find((c) => c.types.includes(type))?.long_name;
  return {
    country: get("country") || "",
    city: get("locality") || get("administrative_area_level_1") || "",
    area: get("sublocality") || "",
  };
}

async function reverseGeocodeWithRetry(location, retries = 2) {
  let attempt = 0;
  while (attempt <= retries) {
    const geo = await reverseGeocodeLocation(location);
    if (geo) return geo;
    attempt += 1;
    if (attempt <= retries) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return null;
}

const FALLBACK_COORDINATES = {
  country: {
    Singapore: { lat: 1.3521, lng: 103.8198 },
    Japan: { lat: 35.6762, lng: 139.6503 },
    "": { lat: 1.3521, lng: 103.8198 },
  },
  city: {
    singapore: { lat: 1.3521, lng: 103.8198 },
    tokyo: { lat: 35.6762, lng: 139.6503 },
    osaka: { lat: 34.6937, lng: 135.5023 },
    yokohama: { lat: 35.4437, lng: 139.6380 },
    nagoya: { lat: 35.1815, lng: 136.9066 },
    fukuoka: { lat: 33.5904, lng: 130.4017 },
    sapporo: { lat: 43.0618, lng: 141.3545 },
    kyoto: { lat: 35.0116, lng: 135.7681 },
    kobe: { lat: 34.6913, lng: 135.1830 },
    kawasaki: { lat: 35.5309, lng: 139.7034 },
    saitama: { lat: 35.8617, lng: 139.6455 },
    chiba: { lat: 35.6074, lng: 140.1063 },
    sendai: { lat: 38.2682, lng: 140.8694 },
    hiroshima: { lat: 34.3853, lng: 132.4553 },
    orchard: { lat: 1.3044, lng: 103.8318 },
    marina: { lat: 1.2834, lng: 103.8607 },
    bugis: { lat: 1.2988, lng: 103.8545 },
    tampines: { lat: 1.3526, lng: 103.9442 },
    jurong: { lat: 1.3331, lng: 103.7423 },
  },
};

function getFallbackCoordinates(country, city, area) {
  const raw = String(city || area || "").trim();
  const cityKey = raw.toLowerCase().replace(/\s+/g, "");
  if (cityKey) {
    for (const [key, coords] of Object.entries(FALLBACK_COORDINATES.city)) {
      if (cityKey.includes(key) || key.includes(cityKey)) {
        return coords;
      }
    }
  }
  const c = String(country || "").trim();
  return (
    FALLBACK_COORDINATES.country[c] ||
    FALLBACK_COORDINATES.country[""] ||
    { lat: 1.3521, lng: 103.8198 }
  );
}

async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_GEOCODE_API_KEY || getPlacesApiKey();
  if (!apiKey || !address) return null;
  const params = new URLSearchParams({
    address: String(address).trim(),
    key: apiKey,
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.warn("[Geocoding API] エラー:", data.status, data.error_message || "");
  }
  if (!res.ok) return null;
  const result = (data.results || [])[0];
  if (!result?.geometry?.location) return null;
  const loc = result.geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

async function resolveLocationContext(state, clientMeta) {
  if (!state) return;
  if (state?.locationSnapshot && state.locationContext) {
    return;
  }
  if (state?.locationSnapshot?.lat && state?.locationSnapshot?.lng) {
    const geo = await reverseGeocodeWithRetry(state.locationSnapshot, 2);
    const city = geo?.city || "unknown";
    const country = geo?.country || clientMeta?.country || "JP";
    state.location = {
      lat: state.locationSnapshot.lat,
      lng: state.locationSnapshot.lng,
      city,
      country,
      confidence: "fallback",
    };
    state.locationContext = {
      source: "gps",
      ...(geo || {}),
    };
    return;
  }
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (res.ok) {
      const data = await res.json();
      state.locationContext = {
        source: "ip",
        country: data?.country_name || "",
        city: data?.city || "",
        area: data?.region || "",
      };
      return;
    }
  } catch (_) {
    // ignore
  }
  const tz = clientMeta?.tz || "";
  const lang = clientMeta?.lang || "";
  let country = "";
  if (tz.startsWith("Asia/Singapore")) country = "Singapore";
  else if (lang.startsWith("ja")) country = "Japan";
  else if (lang.startsWith("en-SG")) country = "Singapore";
  state.locationContext = {
    source: "tz",
    country,
    city: "",
    area: "",
  };
}

async function resolveClinicCandidates(state) {
  if (!canRecommendSpecificPlaceFinal(state)) return [];
  if (!state?.locationSnapshot?.lat || !state?.locationSnapshot?.lng) return [];
  const loc = state.locationSnapshot;
  const isJapan = /japan|jp|日本/i.test(state?.locationContext?.country || "");
  const keywords = isJapan
    ? ["clinic", "クリニック", "内科", "doctor"]
    : ["clinic", "general practitioner", "medical clinic"];
  const results = [];
  for (const keyword of keywords) {
    const places = await fetchNearbyPlaces(loc, { keyword, type: "doctor", rankByDistance: true });
    results.push(...places);
  }
  for (const type of ["doctor", "hospital", "health"]) {
    if (results.length === 0) {
      const p = await fetchNearbyPlaces(loc, { type, rankByDistance: true });
      results.push(...p);
    }
  }
  for (const radius of [5000, 10000, 20000]) {
    if (results.length === 0) {
      const q = isJapan ? "クリニック" : "clinic";
      const t = await fetchPlacesByTextSearch(loc, q, { type: "doctor", radius });
      results.push(...t);
    }
  }
  if (results.length === 0) {
    const q = isJapan ? "病院 クリニック" : "hospital clinic";
    const last = await fetchPlacesByTextSearch(loc, q, { radius: 50000 });
    results.push(...last);
  }
  return sortPlacesByRatingThenDistance(mergePlaces(results)).slice(0, 2);
}

async function resolveHospitalCandidates(state) {
  let location = state?.locationSnapshot;
  if (!location?.lat || !location?.lng) {
    const ctx = state?.locationContext || {};
    const city = ctx.city || ctx.area;
    const country = ctx.country || "";
    const addrs = [
      [city, country].filter(Boolean).join(", "),
      city || "",
      country || "Singapore",
    ].filter(Boolean);
    for (const addr of addrs) {
      const geo = await geocodeAddress(addr);
      if (geo) {
        location = geo;
        if (!state.locationSnapshot) {
          state.locationSnapshot = { lat: geo.lat, lng: geo.lng, ts: Date.now() };
        }
        break;
      }
    }
    if (!location?.lat || !location?.lng) {
      const fallback = getFallbackCoordinates(country, city, ctx.area);
      location = fallback;
      if (!state.locationSnapshot) {
        state.locationSnapshot = { lat: fallback.lat, lng: fallback.lng, ts: Date.now() };
      }
    }
  }
  if (!location?.lat || !location?.lng) return [];
  const country = String(state?.locationContext?.country || "").trim();
  if (country === "Singapore") return [];
  const isJapan = /japan|jp|日本/i.test(country || "");
  const results = [];
  const keywords = isJapan
    ? ["hospital", "病院", "medical centre", "emergency"]
    : ["hospital", "medical centre", "emergency"];
  for (const keyword of keywords) {
    const places = await fetchNearbyPlaces(location, {
      keyword,
      type: "hospital",
      rankByDistance: true,
    });
    results.push(...places);
  }
  for (const type of ["hospital", "doctor", "health"]) {
    if (results.length === 0) {
      const p = await fetchNearbyPlaces(location, { type, rankByDistance: true });
      results.push(...p);
    }
  }
  for (const radius of [5000, 10000, 20000, 50000]) {
    if (results.length === 0) {
      const q = isJapan ? "病院" : "hospital medical centre";
      const t = await fetchPlacesByTextSearch(location, q, { type: "hospital", radius });
      results.push(...t);
    }
  }
  if (results.length === 0) {
    const q = isJapan ? "病院 医療" : "hospital medical";
    const last = await fetchPlacesByTextSearch(location, q, { radius: 50000 });
    results.push(...last);
  }
  const merged = sortPlacesByRatingThenDistance(mergePlaces(results)).slice(0, 2);
  const enriched = [];
  for (const item of merged) {
    const details = await fetchPlaceDetails(item.placeId, { language: "ja" });
    const displayName = details?.name || item.name;
    enriched.push({ ...item, name: displayName || item.name });
  }
  return enriched;
}

async function resolvePharmacyCandidates(state) {
  if (!canRecommendSpecificPlaceFinal(state)) return [];
  if (!state?.locationSnapshot?.lat || !state?.locationSnapshot?.lng) return [];
  const loc = state.locationSnapshot;
  const isJapan = /japan|jp|日本/i.test(state?.locationContext?.country || "");
  const keywords = isJapan
    ? ["pharmacy", "薬局", "ドラッグストア", "Watsons", "Guardian"]
    : ["pharmacy", "Watsons", "Guardian", "drugstore"];
  const results = [];
  for (const keyword of keywords) {
    const places = await fetchNearbyPlaces(loc, {
      keyword,
      type: "pharmacy",
      rankByDistance: true,
    });
    results.push(...places);
  }
  for (const type of ["pharmacy", "drugstore"]) {
    if (results.length === 0) {
      const p = await fetchNearbyPlaces(loc, { type, rankByDistance: true });
      results.push(...p);
    }
  }
  for (const radius of [5000, 10000, 20000, 50000]) {
    if (results.length === 0) {
      const q = isJapan ? "薬局" : "pharmacy";
      const t = await fetchPlacesByTextSearch(loc, q, { type: "pharmacy", radius });
      results.push(...t);
    }
  }
  if (results.length === 0) {
    const q = isJapan ? "薬局 ドラッグストア" : "pharmacy drugstore";
    const last = await fetchPlacesByTextSearch(loc, q, { radius: 50000 });
    results.push(...last);
  }
  return sortPlacesByRatingThenDistance(mergePlaces(results)).slice(0, 2);
}

function buildPharmacyRecommendation(state, locationContext, pharmacyCandidates) {
  const candidates = pharmacyCandidates || [];
  if (canRecommendSpecificPlaceFinal(state) && candidates.length) {
    return {
      name: candidates[0].name,
      mapsUrl: candidates[0].mapsUrl,
      candidates,
      reason: "近くで行きやすい場所を案内します。",
      preface: "近くで行きやすい場所を案内します。",
    };
  }
  return {
    name: "近くの薬局",
    mapsUrl: "",
    candidates: [],
    reason: "位置情報から近くの薬局を検索しました。",
    preface: "近くで行きやすい場所を案内します。",
  };
}

function shouldShowLocationPrompt(state) {
  return false;
}

function shouldShowLocationRePrompt(state) {
  return false;
}

function isWhereToGoQuestion(message) {
  return /どこに行けばいい|どこに行けば良い|どこに行く|どこへ行けば|病院はどこ|薬局はどこ/.test(message || "");
}

function buildHospitalRecommendationDetail(state, locationContext, clinicCandidates, hospitalCandidates) {
  const historyText = state?.historyTextForCare || "";
  const destination = detectCareDestinationFromHistory(historyText);
  const mainSymptomText = detectCareMainSymptomText(state, historyText);
  const plan = buildCareSearchQueries(mainSymptomText, destination);
  const country = String(state?.locationContext?.country || "").trim();
  const isSingapore = country === "Singapore";
  const merged = mergePlaces(
    Array.isArray(clinicCandidates) ? clinicCandidates : [],
    Array.isArray(hospitalCandidates) ? hospitalCandidates : []
  );
  const filtered = isSingapore ? merged : applySymptomFitFilter(merged, plan);
  const meetsRating = filterByMinRating(filtered);
  let candidates;
  if (isSingapore) {
    candidates = meetsRating.slice(0, 5);
  } else {
    const maxCandidates = 2;
    candidates = prioritizeCareCandidates(meetsRating, state).slice(0, maxCandidates);
  }
  const useHospital = (hospitalCandidates?.length || 0) > 0;
  const hasRealCandidates = candidates.length > 0 && candidates.some((c) => c?.placeId);
  if ((canRecommendSpecificPlaceFinal(state) || hasRealCandidates) && candidates.length) {
    return {
      name: candidates[0].name,
      mapsUrl: candidates[0].mapsUrl,
      candidates,
      type: useHospital ? "Hospital" : "Clinic",
      reason: `${plan?.symptomLabel || "現在の症状"}に合う候補を、位置情報ベースで整理しています。`,
      preface: "近くで行きやすい場所を案内します。",
    };
  }
  return {
    name: "近くの医療機関",
    mapsUrl: "",
    candidates: [],
    type: destination?.label === "GP" ? "Clinic" : "General Hospital",
    reason: `位置情報から${plan?.symptomLabel || "現在の症状"}に対応可能な候補を検索しましたが、見つかりませんでした。`,
    preface: "近くで行きやすい場所を案内します。",
  };
}

function buildOtcExamples(category, country) {
  const byCountry = {
    Japan: {
      pain_fever: [
        {
          generic: "アセトアミノフェン",
          brand: "タイレノールA",
          use: "痛みや発熱の緩和",
          descBullets: [
            "痛みや発熱のつらさをやわらげる目的で使われることが多い成分です",
            "胃が気になる人でも選ばれることがあります（合うかは個人差があります）",
          ],
        },
        {
          generic: "イブプロフェン",
          brand: "イブA錠",
          use: "痛みや発熱の緩和",
          descBullets: [
            "痛み・発熱のつらさをやわらげる目的で使われることが多い成分です",
            "胃が荒れやすい人は合わないこともあるので、薬剤師に確認すると安心です",
          ],
        },
      ],
      throat: [
        {
          generic: "セチルピリジニウム塩化物",
          brand: "パブロンのどトローチ",
          use: "のどの痛みや違和感",
          descBullets: [
            "のどの不快感をやわらげる目的で使われることがあるトローチの例です",
          ],
        },
        {
          generic: "アズレンスルホン酸ナトリウム",
          brand: "浅田飴AZ",
          use: "のどの刺激や乾燥感",
          descBullets: [
            "のどの刺激感・乾燥感のつらさに対して選ばれることがある例です",
          ],
        },
      ],
      nose: [
        {
          generic: "クロルフェニラミン",
          brand: "コンタック鼻炎Z",
          use: "鼻水・くしゃみの緩和",
          descBullets: [
            "鼻水・くしゃみのつらさに対して使われることがある成分の例です",
            "眠気が出ることがあるので、心配なら薬剤師に確認すると安心です",
          ],
        },
        {
          generic: "フェキソフェナジン",
          brand: "アレグラFX",
          use: "アレルギー性鼻炎の緩和",
          descBullets: [
            "アレルギー性の鼻症状に対して使われることが多い成分の例です",
          ],
        },
      ],
      cough: [
        {
          generic: "デキストロメトルファン",
          brand: "パブロンせき止め",
          use: "咳の緩和",
          descBullets: [
            "咳のつらさをやわらげる目的で使われることがある成分の例です",
          ],
        },
        {
          generic: "カルボシステイン",
          brand: "ムコダイン去痰薬",
          use: "痰の切れをよくする",
          descBullets: [
            "痰がからむタイプの咳で選ばれることがある成分の例です",
          ],
        },
      ],
      stomach: [
        {
          generic: "ファモチジン",
          brand: "ガスター10",
          use: "胃の不快感",
          descBullets: [
            "胃のムカつき・不快感で選ばれることがある例です",
          ],
        },
        {
          generic: "スクラルファート",
          brand: "アルサルミン内服液",
          use: "胃の粘膜保護",
          descBullets: [
            "胃が荒れている感じの不快感で選ばれることがある例です",
          ],
        },
      ],
      bowel: [
        {
          generic: "ロペラミド",
          brand: "ストッパ下痢止めEX",
          use: "下痢の緩和",
          descBullets: [
            "下痢のつらさを一時的におさえる目的で使われることがある成分の例です",
          ],
        },
        {
          generic: "ビオフェルミン",
          brand: "新ビオフェルミンS",
          use: "腸内環境の調整",
          descBullets: [
            "お腹の調子を整える目的で選ばれることがある例です",
          ],
        },
      ],
      fatigue: [
        {
          generic: "経口補水液",
          brand: "OS-1",
          use: "水分・電解質補給",
          descBullets: [
            "水分と電解質を補う目的で選ばれることが多い例です",
          ],
        },
        {
          generic: "電解質補給",
          brand: "アクエリアス経口補水液",
          use: "脱水気味の時の補給",
          descBullets: [
            "脱水気味のときの回復サポートとして選ばれることがある例です",
          ],
        },
      ],
      allergy: [
        {
          generic: "フェキソフェナジン",
          brand: "アレグラFX",
          use: "アレルギー症状の緩和",
          descBullets: [
            "アレルギー症状（くしゃみ・鼻水など）で選ばれることが多い成分の例です",
          ],
        },
        {
          generic: "ロラタジン",
          brand: "クラリチンEX",
          use: "くしゃみ・鼻水の緩和",
          descBullets: [
            "くしゃみ・鼻水のつらさで選ばれることがある成分の例です",
          ],
        },
      ],
    },
    Singapore: {
      pain_fever: [
        {
          generic: "Paracetamol",
          brand: "Panadol",
          use: "pain/fever relief",
          descBullets: [
            "痛み・発熱のつらさをやわらげる目的で使われることが多い例です",
            "胃が気になる人でも選ばれることがあります（合うかは個人差があります）",
          ],
        },
        {
          generic: "Ibuprofen",
          brand: "Nurofen",
          use: "pain/fever relief",
          descBullets: [
            "痛み・発熱のつらさに加え、炎症のつらさで選ばれることがある例です",
            "胃が荒れやすい人は合わないこともあるので、薬剤師に確認すると安心です",
          ],
        },
      ],
      throat: [
        {
          generic: "Benzocaine",
          brand: "Strepsils Plus",
          use: "throat pain relief",
          descBullets: [
            "のどの痛みのつらさをやわらげる目的で選ばれることがある例です",
          ],
        },
        {
          generic: "Flurbiprofen",
          brand: "Strepsils Intensive",
          use: "throat inflammation relief",
          descBullets: [
            "のどの炎症っぽい痛みで選ばれることがある例です",
          ],
        },
      ],
      nose: [
        {
          generic: "Loratadine",
          brand: "Clarityn",
          use: "allergy-related runny nose",
          descBullets: [
            "アレルギー関連の鼻水で選ばれることが多い成分の例です",
          ],
        },
        {
          generic: "Cetirizine",
          brand: "Zyrtec",
          use: "sneezing/runny nose relief",
          descBullets: [
            "くしゃみ・鼻水のつらさで選ばれることがある成分の例です",
            "眠気が出ることがあるので、心配なら薬剤師に確認すると安心です",
          ],
        },
      ],
      cough: [
        {
          generic: "Dextromethorphan",
          brand: "Robitussin DM",
          use: "cough suppression",
          descBullets: [
            "咳のつらさをやわらげる目的で選ばれることがある成分の例です",
          ],
        },
        {
          generic: "Guaifenesin",
          brand: "Mucinex",
          use: "phlegm relief",
          descBullets: [
            "痰がからむ咳で選ばれることがある成分の例です",
          ],
        },
      ],
      stomach: [
        {
          generic: "Famotidine",
          brand: "Pepcid",
          use: "stomach discomfort",
          descBullets: [
            "胃のムカつき・不快感で選ばれることがある例です",
          ],
        },
        {
          generic: "Antacid",
          brand: "Gaviscon",
          use: "acid reflux relief",
          descBullets: [
            "胸やけ・胃酸っぽい不快感で選ばれることがある例です",
          ],
        },
      ],
      bowel: [
        {
          generic: "Loperamide",
          brand: "Imodium",
          use: "diarrhea relief",
          descBullets: [
            "下痢のつらさを一時的におさえる目的で選ばれることがある例です",
          ],
        },
        {
          generic: "Probiotic",
          brand: "Culturelle",
          use: "gut balance support",
          descBullets: [
            "お腹の調子を整えるサポートとして選ばれることがある例です",
          ],
        },
      ],
      fatigue: [
        {
          generic: "Oral rehydration salts",
          brand: "Hydralyte",
          use: "fluid/electrolyte replacement",
          descBullets: [
            "水分と電解質の補給目的で選ばれることが多い例です",
          ],
        },
        {
          generic: "Electrolyte drink",
          brand: "100Plus",
          use: "recovery support",
          descBullets: [
            "回復サポートとして選ばれることがある例です",
          ],
        },
      ],
      allergy: [
        {
          generic: "Fexofenadine",
          brand: "Telfast",
          use: "allergy symptom relief",
          descBullets: [
            "アレルギー症状（くしゃみ・鼻水など）で選ばれることが多い成分の例です",
          ],
        },
        {
          generic: "Loratadine",
          brand: "Clarityn",
          use: "allergy symptom relief",
          descBullets: [
            "アレルギー症状のつらさで選ばれることがある成分の例です",
          ],
        },
      ],
    },
  };
  const countryKey = byCountry[country] ? country : "Japan";
  return byCountry[countryKey]?.[category] || byCountry[countryKey].pain_fever;
}

function ensureYellowOtcBlock(
  text,
  requiredLevel,
  category,
  warningIndex = 0,
  pharmacyRec,
  otcExamples,
  locationPreface
) {
  return text;
}

function enforceYellowOtcPositionStrict(text, requiredLevel) {
  return text;
}

function enforceBulletSymbol(text) {
  if (!text) return text;
  return text.replace(/^[\s　]*[-•]\s+/gm, "・");
}

function sanitizeGeneralPhrases(text) {
  if (!text) return text;
  const allowedLine = "これは一般的に現地で使われる選択肢です。";
  return text
    .split("\n")
    .map((line) => (line.includes(allowedLine) ? line : line.replace(/一般的に/g, "多くの場合")))
    .join("\n");
}

function sanitizeSummaryQuestions(text) {
  if (!text) return text;
  return text.replace(/[？?]/g, "。");
}

/** 「どちらにしますか？「休む」か「詳しく確認」か、どちらか教えてください。」を強制除去（出さない） */
function stripForbiddenFollowUpMessage(text) {
  if (!text) return text;
  return text
    .replace(/どちらにしますか？.*休む.*詳しく確認.*どちらか教えてください。?/gs, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** LLM出力の簡潔化：「〜の可能性があります」→「〜の可能性」など */
function simplifyPossibilityPhrases(text) {
  if (!text) return text;
  return text.replace(/の可能性があります/g, "の可能性");
}

/** 漢字・誤字修正：ひらがなを適切な漢字に変換（症状文脈） */
function correctKanjiAndTypos(text) {
  if (!text) return text;
  let t = text;
  const replacements = [
    [/(頭|あたま)があつい/g, "頭が熱い"],
    [/頭がいたい/g, "頭が痛い"],
    [/お腹がいたい/g, "お腹が痛い"],
    [/おなかがいたい/g, "お腹が痛い"],
    [/腹がいたい/g, "お腹が痛い"],
    [/のどがいたい/g, "のどが痛い"],
    [/喉がいたい/g, "喉が痛い"],
    [/(^|[。\s])ねつがある/g, "$1熱がある"],
    [/(^|[。\s])ねつが(ある|でる)/g, "$1熱が$2"],
    [/ずつう/g, "頭痛"],
    [/ふつう/g, "普通"],
    [/はきけ/g, "吐き気"],
    [/げり/g, "下痢"],
    [/いたみ/g, "痛み"],
    [/きもちがわるい/g, "気持ちが悪い"],
  ];
  for (const [pat, repl] of replacements) {
    t = t.replace(pat, repl);
  }
  return t;
}

function buildOutlookTriggers(state) {
  const triggers = [];
  const painScore = Number.isFinite(state?.lastPainScore) ? state.lastPainScore : null;
  if (painScore !== null) {
    const threshold = Math.min(10, Math.max(7, painScore + 2));
    triggers.push(`もし痛みが${threshold}以上に強くなったら`);
  } else {
    triggers.push("もし痛みが今より強くなってきたら");
  }
  triggers.push("もし明日の朝も同じ痛みが続いていたら");
  return triggers.slice(0, 2);
}

function buildOutlookBlock(state) {
  const openers = [
    "このタイプの症状は、時間の経過で変化することがあります。",
    "しばらく様子を見る中で、気になりやすいタイミングがあります。",
  ];
  const opener = openers[Math.floor(Math.random() * openers.length)];
  const triggers = buildOutlookTriggers(state);
  return [
    "⏳ 今後の見通し",
    opener,
    ...triggers.map((item) => `・${item}`),
    "そのタイミングで、もう一度Kairoに聞いてください。",
  ].join("\n");
}

function buildPlaceLines(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const lines = [];
  const top = candidates[0];
  if (top?.name) {
    const line = top?.mapsUrl ? `${top.name}（地図：${top.mapsUrl}）` : top.name;
    lines.push(`おすすめ：${line}`);
  }
  const alt = candidates[1];
  if (alt?.name) {
    lines.push(`代替：${alt.name}`);
  }
  return lines;
}

function detectCareDestinationFromHistory(historyText) {
  const text = historyText || "";
  // NOTE: ここは「表示」と「Places検索」を同じ判定に揃える（ズレ禁止）
  if (text.match(/歯|歯ぐき|虫歯|親知らず|奥歯/)) {
    return {
      label: "歯医者",
      header: "おすすめの歯医者（近くて行きやすい）",
      places: { type: "dentist", keywords: ["dentist", "dental clinic"] },
      fallbackNames: ["近くの歯科クリニック", "近くの歯医者"],
    };
  }
  if (text.match(/耳|耳鳴り|耳が痛|のど|喉|鼻|鼻水|鼻づまり/)) {
    return {
      label: "耳鼻科",
      header: "おすすめの耳鼻科（近くて行きやすい）",
      places: { type: "doctor", keywords: ["ENT", "ENT clinic", "otolaryngologist"] },
      fallbackNames: ["近くの耳鼻科", "近くのクリニック（耳鼻科）"],
    };
  }
  // default
  return {
    label: "GP",
    header: "おすすめのGP（近くて行きやすい）",
    places: { type: "doctor", keywords: ["clinic", "general practitioner", "medical clinic"] },
    fallbackNames: null,
  };
}

async function resolveCareCandidates(state, destination) {
  let location = state?.locationSnapshot;
  if (!location?.lat || !location?.lng) {
    const ctx = state?.locationContext || {};
    const city = ctx.city || ctx.area;
    const country = ctx.country || "";
    const addrs = [
      [city, country].filter(Boolean).join(", "),
      city || "",
      country || "Singapore",
    ].filter(Boolean);
    for (const addr of addrs) {
      const geo = await geocodeAddress(addr);
      if (geo) {
        location = geo;
        if (!state.locationSnapshot) {
          state.locationSnapshot = { lat: geo.lat, lng: geo.lng, ts: Date.now() };
        }
        break;
      }
    }
    if (!location?.lat || !location?.lng) {
      const fallback = getFallbackCoordinates(country, city, ctx.area);
      location = fallback;
      if (!state.locationSnapshot) {
        state.locationSnapshot = { lat: fallback.lat, lng: fallback.lng, ts: Date.now() };
      }
    }
  }
  if (!location?.lat || !location?.lng) return [];
  let country = String(state?.locationContext?.country || "").trim();
  if (!country && location?.lat && location?.lng) {
    const geo = await reverseGeocodeLocation(location);
    country = geo?.country || "";
    if (geo && state.locationContext) state.locationContext.country = country;
  }
  const isSingapore = country === "Singapore";
  const historyText = state?.historyTextForCare || "";
  const mainSymptomText = detectCareMainSymptomText(state, historyText);
  const plan = buildCareSearchQueries(mainSymptomText, isSingapore ? null : destination);
  const results = await fetchCarePlacesWithFallbacks(location, plan, state);
  const mergedBase = mergePlaces(results);
  const allowDental = destination?.label === "歯医者" || isToothPainSymptom(mainSymptomText);
  const excludedFiltered = isSingapore
    ? filterSingaporeExcluded(mergedBase, allowDental)
    : filterExcludedCareTypes(mergedBase, allowDental);
  const symptomFitted = isSingapore ? excludedFiltered : applySymptomFitFilter(excludedFiltered, plan);
  const merged = isSingapore ? symptomFitted.slice(0, 10) : prioritizeCareCandidates(symptomFitted, state).slice(0, 10);
  const maxReturn = isSingapore ? 5 : 2;
  const enriched = [];
  for (const item of merged) {
    const details = await fetchPlaceDetails(item.placeId, { language: "ja" });
    const displayName = details?.name || item.name;
    enriched.push({
      ...item,
      name: displayName || item.name,
      details,
      rating: details?.rating ?? item.rating,
      userRatingsTotal: details?.userRatingsTotal ?? item.userRatingsTotal,
      types: details?.types?.length ? details.types : item.types,
      mapsUrl: details?.mapUrl || item.mapsUrl,
    });
  }
  const meetsRating = filterByMinRating(enriched);
  return meetsRating.slice(0, maxReturn);
}

function buildHospitalBlock(state, historyText, hospitalRec) {
  const destination = detectCareDestinationFromHistory(historyText || "");
  const category = resolveQuestionCategoryFromState(state);
  const rawCandidates = Array.isArray(hospitalRec?.candidates) ? hospitalRec.candidates : [];
  const mainSymptomText = detectCareMainSymptomText(state, historyText || "");
  const plan = buildCareSearchQueries(mainSymptomText, destination);
  const isSingapore = String(state?.locationContext?.country || "").trim() === "Singapore";
  const maxDisplay = 2;
  const candidates = rawCandidates
    .filter((c) => String(c?.name || "").trim().length > 0)
    .filter((c) => {
      const r = c?.rating ?? c?.details?.rating;
      return r != null && Number(r) > MIN_RATING_FOR_CARE_DISPLAY;
    })
    .filter((c, idx, arr) => arr.findIndex((x) => String(x.name).trim() === String(c.name).trim()) === idx)
    .slice(0, maxDisplay);
  // 🔴のみ：夜間（20:00〜5:59）のときだけ、無理をさせない一文を追加
  const hour = (() => {
    const tz = state?.clientMeta?.tz;
    if (tz) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "2-digit",
          hour12: false,
        }).formatToParts(new Date());
        const h = Number(parts.find((p) => p.type === "hour")?.value);
        return Number.isFinite(h) ? h : new Date().getHours();
      } catch (_) {
        return new Date().getHours();
      }
    }
    return new Date().getHours();
  })();
  const isLateNight = hour >= 20 || hour < 6;
  const timeMessage = isLateNight
    ? "現在は夜間の時間帯です。症状が強くなければ、明日受診する形が選択肢の一つです。"
    : "";

  const list = Array.isArray(candidates) ? candidates : [];
  const lines = ["🏥 受診先の候補", ...(timeMessage ? [timeMessage] : []), "⸻"];

  if (list.length > 0) {
    lines.push("この症状であれば、まずは一般的な外来で相談できる内容です。");
    lines.push(
      isSingapore ? "シンガポールでは、体調不良のときはまずGP（一般医）に相談するのが一般的です。" : "無理に専門科を選ばなくても大丈夫そうです。"
    );
    lines.push("");
    const top = list[0];
    const alt = list[1];
    const usedReasons = new Set();
    if (isSingapore) {
      const insTop = getInsuranceLabel(top, true);
      const insAlt = alt ? getInsuranceLabel(alt, true) : "";
      lines.push("まずはこちらで問題なさそうです");
      lines.push(`① ${String(top?.name || "").trim()}${insTop ? " " + insTop : ""}`);
      const topReasons = buildHospitalRecommendationReasons(top, plan, state, usedReasons);
      topReasons.forEach((r) => lines.push(r));
      if (alt) {
        lines.push("");
        lines.push(isJapaneseClinicOrSupport(alt) ? "英語での説明が不安な場合は、こちらも安心です" : "必要であれば、こちらも選択肢になります");
        lines.push(`② ${String(alt?.name || "").trim()}${insAlt ? " " + insAlt : ""}`);
        const altReasons = buildHospitalRecommendationReasons(alt, plan, state, usedReasons);
        altReasons.forEach((r) => lines.push(r));
      }
      lines.push("");
      lines.push(alt ? "まずは近くのGPで問題ない内容なので、行きやすい方を選べば大丈夫そうです。" : "必要に応じて、相談する形で問題なさそうです。");
    } else {
      lines.push("まずはこちらがおすすめです");
      lines.push(`① ${String(top?.name || "").trim()}`);
      buildHospitalRecommendationReasons(top, plan, state, usedReasons).forEach((r) => lines.push(r));
      if (alt) {
        lines.push("");
        lines.push("必要であれば、こちらも選択肢になります");
        lines.push(`② ${String(alt?.name || "").trim()}`);
        buildHospitalRecommendationReasons(alt, plan, state, usedReasons).forEach((r) => lines.push(r));
      }
      lines.push("");
      lines.push(list.length >= 2 ? "どちらでも対応できる内容なので、行きやすい方を選んで大丈夫そうです。" : "必要に応じて、相談する形で問題なさそうです。");
    }
  } else {
    lines.push("位置情報から近くの医療機関を検索しましたが、見つかりませんでした。");
  }
  return lines.join("\n");
}

/** 🏥受診先モーダル用：SGは主役GP＋サブ主役日系＋サブサブ。他国は1件メイン＋補助2件 */
async function buildHospitalDetailsModalContent(state) {
  const country = String(state?.locationContext?.country || "").trim();
  const isSingapore = country === "Singapore";
  const clinicCandidates = state?.clinicCandidates || [];
  const hospitalCandidates = state?.hospitalCandidates || [];
  const mainTextCandidates = state?.hospitalRecommendation?.candidates || [];
  const historyText = state?.historyTextForCare || "";
  const plan = buildCareSearchQueries(detectCareMainSymptomText(state, historyText), null);

  const source = clinicCandidates.length > 0 ? clinicCandidates : hospitalCandidates;
  const seenIds = new Set((mainTextCandidates || []).map((c) => c?.placeId).filter(Boolean));
  let places = [...mainTextCandidates];
  const maxPlaces = isSingapore ? 5 : 3;
  for (const c of source) {
    if (places.length >= maxPlaces) break;
    if (c?.placeId && !seenIds.has(c.placeId)) {
      seenIds.add(c.placeId);
      places.push(c);
    }
  }
  if (places.length < maxPlaces) {
    const rest = clinicCandidates.filter((c) => c?.placeId && !seenIds.has(c.placeId)).slice(0, maxPlaces - places.length);
    places = [...places, ...rest];
  }

  if (places.length === 0) {
    return "位置情報から近くの医療機関を検索しましたが、見つかりませんでした。";
  }

  if (isSingapore) {
    return buildSingaporeModalContent(places, plan, state);
  }

  const lines = [
    "少し探すのは大変だと思うので、",
    "この症状で無理なく相談できる場所をこちらで整理しました。",
    "",
    "今回の状態であれば、まずはこの1件を選べば大丈夫そうです。",
    "",
  ];

  const main = places[0];
  const mainDetails = await fetchPlaceDetails(main.placeId, { language: "ja" });
  const mainName = mainDetails?.name || main.name || "";
  lines.push("【まずはこちら】");
  lines.push(mainName);
  lines.push("");
  const mainEnriched = { ...main, details: mainDetails || main.details };
  buildMainFacilityReasons(mainEnriched, plan, state).forEach((r) => lines.push(r));
  lines.push("");
  lines.push("無理に探さなくても、この施設で十分対応できる内容です。");
  lines.push("");

  const auxPlaces = places.slice(1, 3);
  if (auxPlaces.length > 0) {
    lines.push("もし時間帯や場所の都合が合わない場合は、こちらも選択肢になります。");
    lines.push("");
    for (let i = 0; i < auxPlaces.length; i++) {
      const aux = auxPlaces[i];
      const auxDetails = await fetchPlaceDetails(aux.placeId, { language: "ja" });
      const auxName = auxDetails?.name || aux.name || "";
      const auxEnriched = { ...aux, details: auxDetails || aux.details };
      lines.push(auxName);
      lines.push(buildAuxiliaryReason(auxEnriched, plan, state, i));
      lines.push("");
    }
  }
  lines.push("まずは上の施設を選んでおけば問題なさそうです。");
  return lines.join("\n");
}

/** 🇸🇬 モーダル：①クッション ②主役GP ③サブ主役日系 ④サブサブ(最大2件) ⑤クロージング */
async function buildSingaporeModalContent(places, plan, state) {
  const lines = [
    "少し探すのは大変だと思うので、",
    "シンガポールでの一般的な流れも含めて整理しました。",
    "",
  ];

  const main = places[0];
  const mainDetails = await fetchPlaceDetails(main.placeId, { language: "ja" });
  const mainName = mainDetails?.name || main.name || "";
  const insMain = getInsuranceLabel(main, true);
  lines.push("【まずはこちら（いちばんスムーズです）】");
  lines.push(mainName + (insMain ? " " + insMain : ""));
  lines.push("");
  const mainEnriched = { ...main, details: mainDetails || main.details };
  buildMainFacilityReasons(mainEnriched, plan, state).forEach((r) => lines.push(r));
  lines.push("");
  lines.push("");

  const sub = places[1];
  if (sub && isJapaneseClinicOrSupport(sub)) {
    const subDetails = await fetchPlaceDetails(sub.placeId, { language: "ja" });
    const subName = subDetails?.name || sub.name || "";
    const insSub = getInsuranceLabel(sub, true);
    lines.push("英語での説明が不安な場合は、こちらを選ぶと安心です。");
    lines.push(subName + (insSub ? " " + insSub : ""));
    lines.push("・日本語で症状をそのまま伝えられる");
    lines.push("・海外でも安心して相談しやすい環境");
    lines.push("");
    lines.push("");
  }

  const subSubPlaces = places.slice(2, 4);
  if (subSubPlaces.length > 0) {
    lines.push("もし上記が難しい場合は、こちらも選択肢になります。");
    lines.push("");
    for (let i = 0; i < subSubPlaces.length; i++) {
      const aux = subSubPlaces[i];
      const auxDetails = await fetchPlaceDetails(aux.placeId, { language: "ja" });
      const auxName = auxDetails?.name || aux.name || "";
      const insAux = getInsuranceLabel(aux, true);
      lines.push(auxName + (insAux ? " " + insAux : ""));
      lines.push(buildAuxiliaryReason(aux, plan, state, i));
      lines.push("");
    }
  }

  lines.push("基本的には、最初に紹介したGPを選んでおけば問題ない流れです。");
  return lines.join("\n");
}

const RED_GP_JUDGMENT_SENTENCES = [
  "今の症状の出方をふまえると、念のため医療機関で確認しておくと安心できる状態です。",
  "現在の症状からは、自己判断で様子を見るよりも、一度医療機関で確認しておく方が安心できそうです。",
];

function buildRedCushionLine(historyText) {
  return RED_GP_JUDGMENT_SENTENCES[Math.floor(Math.random() * RED_GP_JUDGMENT_SENTENCES.length)];
}

const RED_PAIN_INFECTION_SAFE_WAIT_FIRST = {
  title: "今すぐ受診が難しい場合は、今はベッドに入り、横になって数時間ゆっくり過ごしてください",
  reason: "体を休息モードに切り替えることで、自然な回復の流れが働きやすくなります。",
};

const RED_MODAL_CLOSING_LINE =
  "今動いていること自体が、安全に近づく行動です。今は慌てる段階ではありません。ひとつずつ確認していけば大丈夫です。";

function buildRedModalContent(state, historyText = "", research = null) {
  const cushion = buildRedCushionLine(historyText);
  const safeWaitItems = buildRedSafeWaitSection(state, research);
  const parts = [
    cushion,
    "",
    "① 今すぐやること（受診優先）",
    "・本日中に医療機関へ連絡する",
    "→ 早い段階で確認することで、重大な問題でないことが分かるケースも多くあります。",
    "",
    "② 受診までの過ごし方（安全待機モード）",
    safeWaitItems,
    "",
    RED_MODAL_CLOSING_LINE,
  ];
  return parts.join("\n");
}

/** 受診までの過ごし方：🟢/🟡と同じパイプライン。フォールバックなし。最低2件・最大2件。PAIN/INFECTIONのみ1件目固定。 */
function buildRedSafeWaitSection(state, research, refinedActionsOverride = null) {
  const formatItems = (items) =>
    items.slice(0, 2).map((a) => `・${a.title}\n→ ${a.reason}`).join("\n\n");
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state);
  const evidence = research?.evidence || {};
  const toItem = (a) => ({ title: a?.title ?? a?.action ?? "", reason: ensureReliableReason(a?.reason, evidence) });
  if (refinedActionsOverride && Array.isArray(refinedActionsOverride) && refinedActionsOverride.length > 0) {
    const doItems = refinedActionsOverride.map(toItem).filter((x) => x.title);
    if (category === "PAIN" || category === "INFECTION") {
      const second = doItems[0];
      if (second) return formatItems([RED_PAIN_INFECTION_SAFE_WAIT_FIRST, second]);
    }
    return formatItems(doItems.slice(0, 2));
  }
  const plan = research;
  const doActions = buildDoActionsFromPlan(plan, state, "🟢", { forSummary: true });
  const mapped = doActions.slice(0, 2).map((x) => ({ title: toConciseActionTitle(x.action), reason: ensureReliableReason(x.reason, evidence) }));
  if (category === "PAIN" || category === "INFECTION") {
    const second = mapped[0];
    if (second) return formatItems([RED_PAIN_INFECTION_SAFE_WAIT_FIRST, second]);
  }
  return formatItems(mapped);
}

function buildRedImmediateActionsBlock(state, historyText, research = null, refinedSafeWaitActions = null) {
  const cushion = buildRedCushionLine(historyText);
  const fixedFirst = [
    "・本日中に医療機関へ連絡する",
    "→ 早い段階で確認することで、重大な問題でないことが分かるケースも多くあります。",
  ];
  const safeWaitSection = buildRedSafeWaitSection(state, research, refinedSafeWaitActions);
  return [
    "✅ 今すぐやること",
    cushion,
    "",
    ...fixedFirst,
    "",
    safeWaitSection,
  ].join("\n");
}

async function ensureHospitalMemoBlock(text, state, historyText = "") {
  if (!text) return text;
  const memoLines = [
    "📝 今の状態について",
    ...buildStateFactsBullets(state, { forSummary: true }),
    "",
    await buildStateAboutEmpathyAndJudgmentAsync(state, "🔴"),
  ];
  const replacedOld = replaceSummaryBlock(
    normalizeHospitalMemoHeaderText(text),
    "📝 いまの状態を整理します",
    memoLines.join("\n")
  );
  return replaceSummaryBlock(
    replacedOld,
    "📝 今の状態について",
    memoLines.join("\n")
  );
}

async function ensureRedImmediateActionsBlock(text, state, historyText = "", research = null) {
  if (!text) return text;
  let plan = research;
  let refinedSafeWait = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!plan) {
      try {
        plan = await buildImmediateActionHypothesisPlan(state, historyText, text);
      } catch (_) {
        if (attempt >= 9) break;
        continue;
      }
    }
    if (!plan) continue;
    try {
      refinedSafeWait = await refineDoActionsWithLLM(plan, state, "🟡", { forSummary: true });
      if (refinedSafeWait && refinedSafeWait.length > 0) break;
    } catch (_) {
      if (attempt >= 9) break;
    }
  }
  if (!plan) plan = await buildImmediateActionFallbackPlanFromState(state);
  const block = buildRedImmediateActionsBlock(state, historyText, plan, refinedSafeWait);
  const replaced = replaceSummaryBlock(text, "✅ 今すぐやること", block);
  if (replaced === text) {
    const insertAfter = "📝 今の状態について";
    const lines = text.split("\n");
    const idx = lines.findIndex((line) => line.startsWith(insertAfter));
    if (idx >= 0) {
      const endIdx = lines.findIndex((line, i) => i > idx && /^(🏥|💬)\s/.test(line));
      const insertAt = endIdx >= 0 ? endIdx : lines.length;
      return [...lines.slice(0, insertAt), "", block, ...lines.slice(insertAt)].join("\n");
    }
  }
  return replaced;
}

function ensureHospitalBlock(text, state, historyText) {
  if (!text) return text;
  const locationContext = state?.locationContext || {};
  const hospitalRec =
    state?.hospitalRecommendation ||
    buildHospitalRecommendationDetail(
      state,
      locationContext,
      state?.clinicCandidates || [],
      state?.hospitalCandidates || []
    );
  const block = buildHospitalBlock(state, historyText, hospitalRec);
  let replaced = replaceSummaryBlock(text, "🏥 受診先の候補", block);
  if (replaced === text) replaced = replaceSummaryBlock(text, "🏥 Kairoの判断", block);
  const withoutInfectionOnline = stripInfectionOnlineClinicGuidance(replaced, state);
  return stripHospitalMapLinks(withoutInfectionOnline);
}

function stripInfectionOnlineClinicGuidance(text, state) {
  if (!text) return text;
  if (resolveQuestionCategoryFromState(state) !== "INFECTION") return text;
  const forbidden = new Set([
    "もし、外出がつらい場合は、オンライン診療という方法もあります。",
    "今の症状であればオンラインでの初期相談は可能です。",
    "Doctor Anywhere / WhiteCoat",
    "オンラインでもMCは発行されます。",
  ]);
  const filtered = text
    .split("\n")
    .filter((line) => !forbidden.has(String(line || "").trim()))
    .join("\n");
  return filtered.replace(/\n{3,}/g, "\n\n");
}

const REST_BLOCK_HEADER = /^🧾\s*休息とMCの目安/;
const NEXT_SECTION_HEADER = /^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬)\s/;

/** 🔴時はMC・休息ブロックを必ず除去（LLM漏れ対策） */
function stripMcForRed(text, level) {
  if (!text || level !== "🔴") return text;
  const mcForbidden = new Set([
    "休むためにMCが必要な場合は、今の症状であればオンライン診療で容易に取得できます。",
    "doctor anywhere / white coat",
    "Doctor Anywhere / WhiteCoat",
    "もし、外出がつらい場合は、オンライン診療という方法もあります。",
    "今の症状であればオンラインでの初期相談は可能です。",
    "オンラインでもMCは発行されます。",
  ]);
  const lines = text.split("\n");
  const result = [];
  let inRestBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = String(line || "").trim();
    if (REST_BLOCK_HEADER.test(line)) {
      inRestBlock = true;
      continue;
    }
    if (inRestBlock) {
      if (NEXT_SECTION_HEADER.test(line)) {
        inRestBlock = false;
      } else {
        continue;
      }
    }
    if (!t) {
      result.push(line);
      continue;
    }
    if (mcForbidden.has(t)) continue;
    if (/MC.*取得|MC.*発行|オンライン.*MC|MC.*オンライン/.test(t)) continue;
    result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n");
}

function stripHospitalMapLinks(text) {
  if (!text) return text;
  const filtered = text
    .split("\n")
    .filter((line) => {
      const s = String(line || "").trim();
      if (!s) return true;
      if (/^🗺\s*Google Map:/i.test(s)) return false;
      if (/（地図：https?:\/\/[^\s)]+/i.test(s)) return false;
      if (/https?:\/\/(www\.)?google\.[^/\s]+\/maps/i.test(s)) return false;
      return true;
    })
    .join("\n");
  return filtered.replace(/\n{3,}/g, "\n\n");
}

function replaceSummaryBlock(text, header, block) {
  if (!text) return text;
  const lines = text.split("\n");
  const startIndex = lines.findIndex((line) => line.startsWith(header));
  if (startIndex === -1) {
    const altHeader = "✅ 今すぐやること（これだけでOK）";
    if (header === "✅ 今すぐやること" && lines.some((l) => l.startsWith(altHeader))) {
      return replaceSummaryBlock(text, altHeader, block);
    }
    return text;
  }
  const isHospitalBlock = /^🏥\s/.test(header);
  const nextIndex = lines.findIndex((line, idx) => {
    if (idx <= startIndex) return false;
    if (!/^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬|🧾)\s/.test(line)) return false;
    if (isHospitalBlock && line.startsWith("🏥 ")) return false;
    return true;
  });
  const endIndex = nextIndex === -1 ? lines.length : nextIndex;
  const updated = [
    ...lines.slice(0, startIndex),
    ...block.split("\n"),
    ...lines.slice(endIndex),
  ];
  return updated.join("\n");
}

/** 追加情報・違う等のとき、「今の状態について」ブロックのみ差し替え（他ブロックはそのまま） */
async function replaceStateAboutBlockOnly(summaryText, state, historyText = "") {
  if (!summaryText || !state) return summaryText;
  const hasRedStateBlock = summaryText.includes("📝 今の状態について") || summaryText.includes("📝 いまの状態を整理します");
  if (hasRedStateBlock) {
    const memoLines = [
      "📝 今の状態について",
      ...buildStateFactsBullets(state, { forSummary: true }),
      "",
      await buildStateAboutEmpathyAndJudgmentAsync(state, "🔴"),
    ].join("\n");
    let result = replaceSummaryBlock(normalizeHospitalMemoHeaderText(summaryText), "📝 いまの状態を整理します", memoLines);
    result = replaceSummaryBlock(result, "📝 今の状態について", memoLines);
    return result;
  }
  const level = state?.decisionLevel === "🟡" ? "🟡" : "🟢";
  const aboutLine = buildStateAboutLine(state, level);
  const decisionLine = buildStateDecisionLine(state, level);
  const newBlock = [
    "🤝 今の状態について",
    ...buildStateFactsBullets(state, { forSummary: true }),
    "",
    ...(aboutLine ? [aboutLine] : []),
    ...(decisionLine ? [decisionLine] : []),
  ].join("\n");
  return replaceSummaryBlock(summaryText, "🤝 今の状態について", newBlock);
}

function ensureOutlookBlock(text, state) {
  return replaceSummaryBlock(text, "⏳ 今後の見通し", buildOutlookBlock(state));
}

/** 🌱/💬 最後にブロック本文を「。」3つ以内に制限する。必ず3文以内。 */
function truncateLastBlockBodyToMax3Sentences(body) {
  if (!body || typeof body !== "string") return body || "";
  const trimmed = body.trim();
  const periodCount = (trimmed.match(/。/g) || []).length;
  if (periodCount <= 3) return trimmed;
  let seen = 0;
  let cutAt = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "。") {
      seen++;
      if (seen === 3) {
        cutAt = i;
        break;
      }
    }
  }
  return cutAt >= 0 ? trimmed.slice(0, cutAt + 1).trim() : trimmed;
}

/** 🌱/💬 最後にブロック：LLM生成を優先。既存ブロックに十分な内容があればそのまま。欠落時はLLMで生成。本文は必ず3文以内。 */
async function ensureLastBlock(text, level, state = null, contextText = "") {
  if (!text) return text;
  const header = level === "🔴" ? "💬 最後に" : "🌱 最後に";
  const altHeader = level === "🔴" ? "🌱 最後に" : "💬 最後に";
  const hasBlock = (t) => {
    const lines = t.split("\n");
    const idx = lines.findIndex((l) => l.startsWith(header) || l.startsWith(altHeader));
    if (idx === -1) return { found: false, body: "", foundHeader: null };
    const foundHeader = lines[idx].startsWith(header) ? header : altHeader;
    const start = idx;
    const next = lines.findIndex((l, i) => i > start && /^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬|🧾)\s/.test(l));
    const end = next === -1 ? lines.length : next;
    const body = lines.slice(start + 1, end).join("\n").trim();
    return { found: true, body, foundHeader };
  };
  const { found, body, foundHeader } = hasBlock(text);
  if (found && body && body.length >= 20) {
    const truncated = truncateLastBlockBodyToMax3Sentences(body);
    if (truncated !== body) {
      const block = `${foundHeader}\n${truncated}`;
      return replaceSummaryBlock(text, foundHeader, block);
    }
    return text;
  }
  const block = await generateLastBlockWithLLM(level, state, contextText);
  let result = replaceSummaryBlock(text, header, block);
  if (result === text) result = replaceSummaryBlock(text, altHeader, block);
  if (result === text) result = (text.trimEnd() + "\n\n" + block).trim();
  return result;
}

function formatActionTitleWithBullet(title) {
  const raw = String(title || "").trim();
  if (!raw) return "・まずは無理をせず安静を優先してください";
  return raw.startsWith("・") ? raw : `・${raw}`;
}

function formatActionReasonLine(reason) {
  const raw = String(reason || "").trim();
  if (!raw) return "→ 今の状態で負担を減らす行動は、回復を早める助けになります。";
  return raw.startsWith("→") ? raw : `→ ${raw}`;
}

function toConciseActionTitle(title) {
  const raw = String(title || "").replace(/^・\s*/, "").trim();
  if (!raw) return "刺激を減らして体への負担を軽くしてください";
  let cleaned = stripNumberingFromText(raw);
  const firstSentence = cleaned.split(/[。!?！？]/)[0].trim();
  const compact = (firstSentence || cleaned).replace(/\s{2,}/g, " ");
  return compact.length > 68 ? `${compact.slice(0, 68).trim()}…` : compact;
}

function stripSearchTraceFromReason(text) {
  return String(text || "")
    .replace(/検索結果で(も)?/g, "")
    .replace(/検索情報で(は)?/g, "")
    .replace(/検索で/g, "")
    .replace(/上位情報の/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 仕様10.1②：理由行に ・ は使わない */
function stripBulletFromReason(text) {
  return String(text || "")
    .replace(/^・\s*/gm, "")
    .replace(/\s*・\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 仕様10.1②：番号付き（1) / 1️⃣）は禁止 */
function stripNumberingFromText(text) {
  return String(text || "")
    .replace(/^[0-9]+[)）]\s*/g, "")
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/g, "")
    .replace(/[\u2460-\u2473]\s*/g, "") // ①〜⑳
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ensureReliableReason(reason, evidence = {}) {
  const raw = String(reason || "").trim();
  let sanitized = stripSearchTraceFromReason(raw);
  sanitized = stripBulletFromReason(sanitized);
  sanitized = stripNumberingFromText(sanitized);
  if (sanitized.length > 15) return sanitized.replace(/。?$/, "。");
  const sourceText = [
    ...(Array.isArray(evidence?.selfCare) ? evidence.selfCare : []),
    ...(Array.isArray(evidence?.observe) ? evidence.observe : []),
    ...(Array.isArray(evidence?.danger) ? evidence.danger : []),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (sourceText) {
    return `刺激負荷と負担を減らすことで、症状の悪化要因を抑えやすくなります。`;
  }
  if (raw) {
    return `${raw.replace(/。?$/, "")}。負担を減らしながら経過を確認しやすいためです。`;
  }
  return "刺激負荷を減らし水分を補うことで、症状のぶれを抑えながら経過を確認しやすくなります。";
}

function ensureActionCount(actions = [], targetCount = 2, context = {}, evidence = {}, options = {}) {
  const { skipSupplements = false } = options;
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(actions) ? actions : [])) {
    if (!item || !item.title || !item.reason) continue;
    const key = String(item.title).trim();
    if (!key || seen.has(key)) continue;
    out.push(item);
    seen.add(key);
    if (out.length >= targetCount) return out;
  }
  if (skipSupplements) return out.slice(0, targetCount);
  const topic = normalizeContextLocation(context?.location || "");
  const supplements = [];
  if (topic === "頭") {
    supplements.push(
      {
        title: "画面や強い光を避けて、静かな環境で過ごしてください",
        reason: "視覚刺激を減らすことで、悪化要因を抑えやすくなります。",
        isOtc: false,
      },
      {
        title: "水分をこまめに取り、体調の変化を短時間で確認するといいです",
        reason: "脱水や負荷の重なりを減らすと、症状の推移を判断しやすくなるためです。",
        isOtc: false,
      },
      {
        title: "静かな環境で体を休め、数時間の変化を確認してください",
        reason: "負荷を分散すると、症状の推移を判断しやすくなります。",
        isOtc: false,
      }
    );
  } else if (topic === "お腹") {
    supplements.push(
      {
        title: "胃腸に負担の少ない過ごし方に切り替えてください",
        reason: "刺激要因を減らすことで、症状の持続を抑えやすくなります。",
        isOtc: false,
      },
      {
        title: "一度に無理をせず、変化を見ながら対応するといいです",
        reason: "負荷を分散すると、悪化サインの有無を見極めやすくなるためです。",
        isOtc: false,
      },
      {
        title: "経口補水液または水をこまめに取り、変化を確認してください",
        reason: "脱水を防ぐことで、症状の推移を確認しやすくなります。",
        isOtc: false,
      }
    );
  } else if (topic === "喉") {
    supplements.push(
      {
        title: "乾燥を避けて、こまめに水分を取ってください",
        reason: "咽頭の乾燥を抑えることで、症状の持続を抑えやすくなります。",
        isOtc: false,
      },
      {
        title: "刺激の強い飲食を控え、静かに過ごしてください",
        reason: "局所刺激を減らすと、経過の見極めがしやすくなるためです。",
        isOtc: false,
      },
      {
        title: "加湿を心がけ、刺激の強い飲食を控えるといいです",
        reason: "咽頭の負担を減らすことで、経過の見極めがしやすくなります。",
        isOtc: false,
      }
    );
  } else if (topic === "皮膚") {
    supplements.push(
      {
        title: "患部をこすらず、刺激を避けて過ごしてください",
        reason: "刺激の反復を減らすことで、悪化要因を抑えやすくなります。",
        isOtc: false,
      },
      {
        title: "保湿を心がけ、乾燥を防いでください",
        reason: "バリア機能を保つことで、症状の推移を判断しやすくなります。",
        isOtc: false,
      },
      {
        title: "白色ワセリンを患部に薄く塗り、2〜3時間ごとに塗り直す",
        reason: "バリアを保つことで、刺激の反復を減らしやすくなります。",
        isOtc: true,
      }
    );
  } else {
    supplements.push({
      title: "静かな環境で体を休め、数時間の変化を確認してください",
      reason: "負荷を分散すると、症状の推移を判断しやすくなります。",
      isOtc: false,
    });
  }
  for (const item of supplements) {
    const key = String(item.title || "").trim();
    if (!key || seen.has(key)) continue;
    out.push({
      ...item,
      title: toConciseActionTitle(item.title),
      reason: ensureReliableReason(item.reason, evidence),
    });
    seen.add(key);
    if (out.length >= targetCount) break;
  }
  return out.slice(0, targetCount);
}

function ensureMinimumDoActions(actions = [], minCount = 3, context = {}, evidence = {}, options = {}) {
  const out = ensureActionCount(actions, minCount, context, evidence, options);
  return out.slice(0, 4);
}

function pickActionsForBlock(plan, maxCount = 3) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const picked = [];
  let otcUsed = false;
  for (const action of actions) {
    if (!action || !action.title || !action.reason) continue;
    const isOtc = Boolean(action.isOtc);
    if (isOtc && otcUsed) continue;
    picked.push(action);
    if (isOtc) otcUsed = true;
    if (picked.length >= maxCount) break;
  }
  return picked;
}

/** ① なぜそれでいいのか（安心の土台・2文以内） */
function buildWhySection(context = {}) {
  const location = String(context?.location || context?.mainSymptom || "症状").trim();
  const templates = [
    [
      "現在の状態では、体が一時的に過敏になっている可能性があります。",
      "この段階では刺激を減らすことが回復の近道になります。",
    ],
    [
      "今の経過であれば、一時的な変化として捉えられることが多いです。",
      "刺激を減らすことで、体が回復モードに入りやすくなります。",
    ],
    [
      "症状の強さや経過から、今は負荷を下げる段階と考えられます。",
      "静かな環境で様子を見ることが、次の判断の土台になります。",
    ],
  ];
  const idx = Math.floor(Math.random() * templates.length);
  return templates[idx].join("\n");
}

/**
 * ③ 予想経過の「特例」：経過が「1時間以上前」の類（さっき・数分級以外）のとき true。
 * KAIRO_SPEC 10.1 ③：数日スケールの見通し文に切り替える。
 */
function isExpectedCourseLongDurationVariant(state) {
  if (!state) return false;
  const idx = state.durationMeta?.selectedIndex;
  if (idx === 1 || idx === 2) return true;
  if (idx === 0) return false;
  const durationRaw = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  if (!durationRaw) return false;
  if (/(さっき|今さっき|たった今|数分|数十分)/.test(durationRaw)) return false;
  return true;
}

/** ③ 予想経過（安心設計） */
function buildExpectedCourse(context = {}, state = null) {
  if (state && isExpectedCourseLongDurationVariant(state)) {
    const templates = [
      "このまま安静にされていれば、数日かけて徐々に回復していくことが多いです。",
      "このまま無理をせずお休みになられていれば、多くの場合は数日のうちに徐々に良くなっていきます。",
      "安静を続けられていれば、数日ほどで落ち着いてくることが多いです。",
      "急がず体を休めていらっしゃれば、だいたい数日かけて回復に向かうことが多いです。",
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  const templates = [
    "多くの場合、数時間〜1日程度で徐々に落ち着いていきます。",
    "多くのケースでは、数時間〜半日程度で変化の方向が見えやすくなることが多いです。",
    "一般的には、数時間〜1日程度で症状の波が落ち着いていくことが多いとされています。",
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function getOtcActionForYellowModal(category) {
  const byCategory = {
    頭: {
      action: "市販の鎮痛薬（アセトアミノフェン等）を用法通りに使ってください",
      reason: "痛みを和らげることで、休息を取りやすくなります。",
    },
    お腹: {
      action: "整腸剤（市販）を用法通りに使ってください",
      reason: "腸の調子を整えることで、症状の推移を確認しやすくなります。",
    },
    喉: {
      action: "のど飴やトローチを用法通りに使ってください",
      reason: "のどを潤すことで、違和感を和らげやすくなります。",
    },
    皮膚: {
      action: "白色ワセリンを患部に薄く塗り、2〜3時間ごとに塗り直してください",
      reason: "バリアを保つことで、刺激の反復を減らしやすくなります。",
    },
  };
  return byCategory[category] || byCategory.頭;
}

const PAIN_INFECTION_YELLOW_FIRST_ACTION = {
  title: "今はベッドに入り、横になって数時間ゆっくり過ごしてください",
  reason: "体を休息モードに切り替えることで、自然な回復の流れが働きやすくなります。",
  isOtc: false,
};

/**
 * モーダル・本文共通：doActions を LLM でリファインする（検索結果の有無に関係なく、症状に即した文面に整える）
 * フォールバックせず、最低5回リトライする。
 */
async function refineDoActionsWithLLM(plan, state, level, options = {}) {
  const { forSummary = false } = options;
  const doActions = sanitizeImmediateActions(plan?.actions || [], buildSafeImmediateFallbackAction())
    .map((a) => ({
      action: toConciseActionTitle(a.title),
      reason: ensureReliableReason(a.reason, plan?.evidence || {}),
    }))
    .slice(0, forSummary ? 3 : 4);

  const minRequired = forSummary ? 2 : 3;
  const ctx = plan?.currentStateContext || {};
  const mainSymptom = String(ctx?.mainSymptom || ctx?.location || "症状").trim();

  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      const isYellow = level === "🟡";
      const useSimple = attempt >= 3 || doActions.length === 0;
      let prompt;
      if (useSimple) {
        prompt = [
          `主症状「${mainSymptom}」に合わせてセルフケアを${minRequired}件生成。`,
          "JSONのみ: {\"do\":[{\"action\":\"...\",\"reason\":\"...\"}]}。曖昧表現・医療行為禁止。",
        ].join("\n");
      } else {
        prompt = [
          "あなたは医療情報を要約して行動を具体化するアシスタントです。",
          "出力はJSONのみ。診断断定は禁止。",
          "主症状・ユーザーの回答を「付随症状」にまとめない。主症状は主症状として、各スロットの内容を適切に区別して行動・理由に反映する。",
          "行動は勧める口調で（〜してください／〜するといいです）。「〜します」は避ける。",
          "曖昧表現禁止（例：「安静に」だけは禁止）。「何をどのくらい」が分かる具体動作＋軽い理由をセットで出す。",
          "理由行に ・ は使わない。番号付き（1) / 1️⃣）は禁止。医療行為の指示・危険行為・専門処置は禁止。",
          "次の形式で返す: {\"do\":[{\"action\":\"...\",\"reason\":\"...\"}]}",
          forSummary ? "doは2件。各reasonは検索要点と整合する確実な理由にする。" : "doは最低3件、最大4件。各reasonは検索要点と整合する確実な理由にする。",
          isYellow && !forSummary ? "OTC（市販薬：鎮痛薬・整腸剤・のど飴・ワセリン等）を1件必ず含める。" : "",
          "「症状メモを2時間ごとに1回...」は禁止。",
        ]
          .filter(Boolean)
          .join("\n");
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: JSON.stringify({
              currentStateContext: ctx,
              evidence: {
                selfCare: plan?.evidence?.selfCare || [],
                observe: plan?.evidence?.observe || [],
                danger: plan?.evidence?.danger || [],
              },
              doActions: doActions.length > 0 ? doActions : undefined,
            }),
          },
        ],
        temperature: 0.3 + attempt * 0.05,
        max_tokens: 500,
      });
      const parsed = parseJsonObjectFromText(completion?.choices?.[0]?.message?.content || "");
      const outDo = Array.isArray(parsed?.do) ? parsed.do : doActions;
      const valid = outDo.filter((x) => x && x.action && x.reason).map((x) => ({ title: x.action, reason: x.reason }));
      if (valid.length >= minRequired) return valid;
      if (valid.length > 0 && attempt >= LLM_RETRY_COUNT - 1) return valid;
    } catch (_) {
      /* retry */
    }
  }
  if (doActions.length > 0) return doActions.map((x) => ({ title: x.action, reason: x.reason }));
  const lastResort = await generateMinimalActionsLastResort(ctx);
  if (lastResort.length > 0) return lastResort.map((a) => ({ title: a.title, reason: a.reason }));
  return [];
}

/**
 * モーダル・本文共通：doActions を plan から構築する。
 * @param {object} plan - buildImmediateActionHypothesisPlan の戻り値
 * @param {object} state - conversationState
 * @param {string} level - '🟢' | '🟡'
 * @param {{ forSummary?: boolean, actionsOverride?: Array<{title:string,reason:string}> }} options - forSummary: 本文用。actionsOverride: モーダルLLM出力を渡す
 */
function buildDoActionsFromPlan(plan, state, level, options = {}) {
  const { forSummary = false, actionsOverride } = options;
  const ctx = plan?.currentStateContext || buildCurrentStateContext(state, state?.historyTextForCare || "", state?.lastConcreteDetailsText || "");
  const evidence = plan?.evidence || {};
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state);

  const rawActions =
    Array.isArray(actionsOverride) && actionsOverride.length > 0
      ? actionsOverride
      : (Array.isArray(plan?.actions) ? plan.actions : []);
  const picked = forSummary
    ? (rawActions.length > 0 ? rawActions.slice(0, 2) : pickActionsForBlock(plan, 2))
    : rawActions.slice(0, 4);
  const doItems = sanitizeImmediateActions(picked, buildSafeImmediateFallbackAction()).map((a) => ({
    action: toConciseActionTitle(a.title),
    reason: ensureReliableReason(a.reason, evidence),
  }));

  const minCount = forSummary ? 2 : 4;
  const maxCount = forSummary ? 3 : 4;
  const skipSupplements = Boolean(actionsOverride && actionsOverride.length > 0);
  let ensured = ensureMinimumDoActions(
    doItems.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
    minCount,
    ctx,
    evidence,
    { skipSupplements }
  ).map((x) => ({ action: toConciseActionTitle(x.title), reason: ensureReliableReason(x.reason, evidence) }));

  // PAIN/INFECTION+🟡の1件目固定（ベッドで休む）は本文の「✅ 今すぐやること」ブロックのみ。モーダル（forSummary:false）では入れない（KAIRO_SPEC 722-727 vs 1386-1388）
  if (forSummary && level === "🟡" && (category === "PAIN" || category === "INFECTION")) {
    const fixed = { action: PAIN_INFECTION_YELLOW_FIRST_ACTION.title, reason: PAIN_INFECTION_YELLOW_FIRST_ACTION.reason };
    ensured = [fixed, ...ensured.filter((x) => x.action !== fixed.action)].slice(0, maxCount);
  }
  if (level === "🟡" && !forSummary) {
    if (!ensured.some((x) => /ワセリン|鎮痛薬|整腸剤|のど飴|トローチ|市販/.test(x.action || ""))) {
      const topic = normalizeContextLocation(ctx?.location || "");
      ensured = [...ensured, getOtcActionForYellowModal(topic)].slice(0, maxCount);
    }
  }
  if (!forSummary && ensured.length < 4 && !skipSupplements) {
    const extra = ensureMinimumDoActions(
      ensured.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
      4,
      ctx,
      evidence
    )
      .map((x) => ({ action: toConciseActionTitle(x.title), reason: ensureReliableReason(x.reason, evidence) }))
      .filter((x) => !ensured.some((e) => e.action === x.action));
    ensured = [...ensured, ...extra].slice(0, maxCount);
  }
  return ensured.slice(0, maxCount);
}

/** ④ 締めの一文（心理的アンカー） */
function buildClosingLine() {
  const templates = [
    "今は体を回復モードに入れることが最優先です。",
    "今は体を整える時間として受け止めて大丈夫です。",
    "今は体の負担を減らすことが、いちばんの近道です。",
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/** 🌱/💬 最後にブロックをLLMで生成。フォールバック廃止。リトライ＋簡易プロンプトで必ず成功させる。 */
async function generateLastBlockWithLLM(level, state, contextText = "") {
  const header = level === "🔴" ? "💬 最後に" : "🌱 最後に";
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
  const mainSymptom = state?.primarySymptom || "";
  const categoryHint = (() => {
    if (level === "🔴") return "";
    const hints = {
      PAIN: "痛み系（頭痛・腰痛など）：動きを控え、安静を優先する指示を。",
      SKIN: "皮膚粘膜系：刺激を避け、患部を休める指示を。",
      GI: "消化器系（腹痛・下痢など）：消化を休める、食事を控える指示を。",
      INFECTION: "発熱感染系（喉・咳・熱など）：休養・体を休める指示を。",
    };
    return hints[category] || hints.PAIN;
  })();
  const fullRules =
    level === "🔴"
      ? `見出しは「💬 最後に」。3文以内を基準に（「。」が3つ以内。🔴は2文推奨）。
①受診の肯定（例：今の状況で受診を選ぶのは適切な判断です）
②行動の後押し（例：無理に我慢せず、一度確認してもらうと安心です）
不安を煽らない。判断ははっきり肯定する。
症状カテゴリ（${category}）と主症状（${mainSymptom || "症状"}）に合わせて、受診の肯定・後押しを具体的に書く。`
      : `見出しは「🌱 最後に」。3文以内を基準に（「。」が3つ以内）。
①今やるべき行動：必ず「休息」を明確に指示。カテゴリに合わせて具体的に：${categoryHint}
②理由：回復につながる説明（例：落ち着いて過ごすことで、回復に向かいやすくなります）
③再訪導線（推奨）：また不安になったら、いつでもここで確認してください
「〜してください」を優先。抽象的な励まし禁止。
主症状（${mainSymptom || "症状"}）に合わせて、その症状に合った休息の指示を生成する。汎用表現禁止。`;
  const simplePrompt =
    level === "🔴"
      ? `「今の状況で受診を選ぶのは適切な判断です。無理に我慢せず、一度確認してもらうと安心です。」を主症状「${mainSymptom || "症状"}」に合わせて1〜2文で言い換えてください。見出しは出さず本文のみ。`
      : `主症状「${mainSymptom || "症状"}」に合わせて、休息を勧める1〜2文を書いてください。「〜してください」で終える。見出しは出さず本文のみ。`;
  const userContent = contextText || (state ? buildStateFactsBullets(state, { forSummary: true }).join("\n") : "") || "症状の状態を確認しました。";
  const fullPrompt = `あなたはKairoです。以下の会話・状態を踏まえ、「${header}」ブロックの本文のみを生成してください。
${fullRules}
【厳守】本文は3文以内を基準に生成する（「。」が3つ以内）。シンプルで短く。行動につながる内容のみ。見出し行は出力しない。本文のみ。`;
  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      const useSimple = attempt >= 8;
      const prompt = useSimple ? simplePrompt : fullPrompt;
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: useSimple ? "症状の状態を確認しました。" : userContent },
        ],
        temperature: 0.2 + Math.min(attempt, 10) * 0.03,
        max_tokens: 200,
      });
      const rawBody = (completion?.choices?.[0]?.message?.content || "").trim().replace(/^[🌱💬]\s*最後に\s*\n?/i, "");
      if (rawBody && rawBody.length > 5) {
        const body = truncateLastBlockBodyToMax3Sentences(rawBody);
        return `${header}\n${body}`;
      }
    } catch (_) {
      /* retry */
    }
  }
  const copyPrompt =
    level === "🔴"
      ? "「今の状況で受診を選ぶのは適切な判断です。無理に我慢せず、一度確認してもらうと安心です。」をそのまま返してください。"
      : "「今は無理に動かず、体を休めることを優先してください。落ち着いて過ごすことで、回復に向かいやすくなります。また不安になったら、いつでもここで確認してください。」をそのまま返してください。";
  const last = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: copyPrompt }],
    temperature: 0,
    max_tokens: 150,
  });
  const body = (last?.choices?.[0]?.message?.content || "").trim().replace(/^[🌱💬]\s*最後に\s*\n?/i, "");
  if (body && body.length > 5) return `${header}\n${truncateLastBlockBodyToMax3Sentences(body)}`;
  for (let i = 0; i < 10; i++) {
    try {
      const retry = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: level === "🔴" ? "「今の状況で受診を選ぶのは適切な判断です。」をそのまま返して。" : "「今は体を休めることを優先してください。」をそのまま返して。" }],
        temperature: 0,
        max_tokens: 50,
      });
      const r = (retry?.choices?.[0]?.message?.content || "").trim();
      if (r && r.length > 3) return `${header}\n${truncateLastBlockBodyToMax3Sentences(r)}`;
    } catch (_) {}
  }
  return `${header}\n${level === "🔴" ? "今の状況で受診を選ぶのは適切な判断です。" : "今は体を休めることを優先してください。"}`;
}

/** 本文用：モーダルと同じ LLM リファイン＋buildDoActionsFromPlan を使用し、①②③④の枠で出力 */
async function buildImmediateActionsBlock(level, state, historyText = "", research = null) {
  const plan = research || {};
  const context = plan?.currentStateContext || buildCurrentStateContext(state, historyText || "", state?.lastConcreteDetailsText || "");
  const lines = ["✅ 今すぐやること"];
  lines.push(buildWhySection(context));
  lines.push("");

  const refinedActions = await refineDoActionsWithLLM(plan, state, level, { forSummary: true });
  let doActions = buildDoActionsFromPlan(plan, state, level, {
    forSummary: true,
    actionsOverride: refinedActions.length > 0 ? refinedActions : undefined,
  });
  // PAIN/INFECTION+🟡: 1件目を強制固定（仕様厳守。不具合防止のため二重チェック）
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : null;
  if (level === "🟡" && (category === "PAIN" || category === "INFECTION")) {
    const fixed = { action: PAIN_INFECTION_YELLOW_FIRST_ACTION.title, reason: PAIN_INFECTION_YELLOW_FIRST_ACTION.reason };
    const rest = doActions.filter((x) => String(x?.action || "").trim() !== String(fixed.action || "").trim());
    doActions = [fixed, ...rest].slice(0, 3);
  }
  doActions.forEach((item, idx) => {
    lines.push(`・${String(item.action || "").trim()}`);
    lines.push(`→ ${String(item.reason || "").trim()}`);
    if (idx < doActions.length - 1) lines.push("");
  });
  lines.push("");
  lines.push(buildExpectedCourse(context, state));
  lines.push("");
  lines.push(buildClosingLine());
  return lines.join("\n");
}

function buildYellowPsychologicalCushionLine() {
  const templates = [
    "いまの経過であれば、少し力を抜いて体の負担を整える時間として受け止められます。",
    "現在の症状の流れは、判断を急がず落ち着いて体調の変化を見られる段階と捉えられます。",
    "ここまでの経過なら、無理に動かず体を整えながら変化を見ていく時間と考えられます。",
  ];
  const forbidden = /(しましょう|してください|安全|大丈夫|問題ありません|緊急性|危険)/;
  const inRange = (text) => {
    const len = String(text || "").length;
    return len >= 40 && len <= 65;
  };
  const candidates = templates.filter((line) => !forbidden.test(line) && inRange(line));
  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return "いまの経過なら、判断を急がず体の負担を整えながら落ち着いて様子を見られる段階と捉えられます。";
}

/** PAIN系・INFECTION系で🟡のとき、今すぐやること1件目を強制固定（仕様厳守）。不具合防止のため全経路で確実に適用。 */
function ensurePainInfectionYellowFirstAction(text, level, state) {
  if (!text || level !== "🟡") return text;
  // state.triageCategory を優先（buildImmediateActionsBlock と一致）
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : null;
  if (category !== "PAIN" && category !== "INFECTION") return text;
  const fixedAction = "・今はベッドに入り、横になって数時間ゆっくり過ごしてください";
  const fixedReason = "→ 体を休息モードに切り替えることで、自然な回復の流れが働きやすくなります。";
  const lines = text.split("\n");
  const headerPatterns = ["✅ 今すぐやること", "✅ 今すぐやること（これだけでOK）", "🟡 今すぐやること"];
  const headerIdx = lines.findIndex((l) => headerPatterns.some((p) => l.trim().startsWith(p)));
  if (headerIdx === -1) {
    // ブロックが存在しない場合は、⏳の直前に挿入
    const outlookIdx = lines.findIndex((l) => l.trim().startsWith("⏳ 今後の見通し"));
    const insertIdx = outlookIdx >= 0 ? outlookIdx : lines.length;
    const newBlock = ["✅ 今すぐやること", "", fixedAction, fixedReason, ""];
    const updated = [...lines.slice(0, insertIdx), ...newBlock, ...lines.slice(insertIdx)];
    return updated.join("\n");
  }
  // 最初の箇条書き行を探す（・ / • / - に対応）
  let firstBulletIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬|🧾)\s/.test(t)) break;
    if (/^[・•\-]\s/.test(t) || (t.startsWith("・") || t.startsWith("•") || t.startsWith("-"))) {
      firstBulletIdx = i;
      break;
    }
  }
  if (firstBulletIdx < 0) {
    // 箇条書き行がない場合はヘッダ直後に挿入
    const nextHeaderIdx = lines.findIndex((l, idx) => idx > headerIdx && /^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬|🧾)\s/.test(l.trim()));
    const blockEnd = nextHeaderIdx >= 0 ? nextHeaderIdx : lines.length;
    const before = lines.slice(0, headerIdx + 1);
    const after = lines.slice(headerIdx + 1, blockEnd);
    const inserted = [...before, fixedAction, fixedReason, "", ...after];
    return [...lines.slice(0, headerIdx), ...inserted, ...lines.slice(blockEnd)].join("\n");
  }
  const currentContent = lines[firstBulletIdx].trim().replace(/^[・•\-]\s?/, "").trim();
  if (currentContent === fixedAction.replace(/^・/, "").trim()) return text;
  // 既存の1件目と→行を差し替え（beforeBlock は header から firstBullet 直前まで）
  let restStart = firstBulletIdx + 1;
  if (restStart < lines.length && /^→\s/.test(lines[restStart].trim())) restStart++;
  while (restStart < lines.length && !lines[restStart].trim()) restStart++;
  const nextHeaderIdx = lines.findIndex((l, idx) => idx > headerIdx && /^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬|🧾)\s/.test(l.trim()));
  const blockEnd = nextHeaderIdx >= 0 ? nextHeaderIdx : lines.length;
  const beforeBlock = lines.slice(headerIdx, firstBulletIdx);
  const restOfBlock = lines.slice(restStart, blockEnd);
  const newBlock = [...beforeBlock, fixedAction, fixedReason, "", ...restOfBlock];
  return [...lines.slice(0, headerIdx), ...newBlock, ...lines.slice(blockEnd)].join("\n");
}

async function ensureImmediateActionsBlock(text, level, state, historyText = "", research = null) {
  if (!text) return text;
  if (level !== "🟡" && level !== "🟢") return text;
  const block = await buildImmediateActionsBlock(level, state, historyText, research);
  let result = replaceSummaryBlock(text, "✅ 今すぐやること", block);
  result = ensurePainInfectionYellowFirstAction(result, level, state);
  return result;
}

async function generateMinimalActionsLastResort(context) {
  const mainSymptom = String(context?.mainSymptom || context?.location || "症状").trim();
  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `主症状に合わせてセルフケアを2つ生成。JSONのみ: {"actions":[{"title":"...","reason":"...","isOtc":false}]}`,
          },
          { role: "user", content: `主症状: ${mainSymptom}. 2件返す。` },
        ],
        temperature: 0.3,
        max_tokens: 400,
      });
      const parsed = parseJsonObjectFromText(completion?.choices?.[0]?.message?.content || "");
      const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
      const valid = actions.filter((a) => a && a.title && a.reason).slice(0, 2);
      if (valid.length > 0) return valid;
    } catch (_) {
      /* retry */
    }
  }
  return [];
}

async function buildImmediateActionFallbackPlanFromState(state, overrides = {}) {
  const context =
    overrides.currentStateContext ||
    buildCurrentStateContext(state, "", state?.lastConcreteDetailsText || "");
  let seedActions =
    Array.isArray(overrides.actions) && overrides.actions.length > 0
      ? sanitizeImmediateActions(overrides.actions, null)
      : [];

  if (seedActions.length === 0) {
    for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
      const contextOnlyActions = await generateImmediateActionsFromContextOnly(state, context, attempt >= 2);
      if (contextOnlyActions && contextOnlyActions.length > 0) {
        seedActions = sanitizeImmediateActions(contextOnlyActions, null);
        break;
      }
    }
  }
  if (seedActions.length === 0) {
    for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
      const contextOnlyActions = await generateImmediateActionsFromContextOnly(state, context, true);
      if (contextOnlyActions && contextOnlyActions.length > 0) {
        seedActions = sanitizeImmediateActions(contextOnlyActions, null);
        break;
      }
    }
  }
  if (seedActions.length === 0) {
    const lastResort = await generateMinimalActionsLastResort(context);
    if (lastResort && lastResort.length > 0) {
      seedActions = lastResort;
    }
  }

  const actionsToEnsure = seedActions.length > 0 ? seedActions : [];
  return {
    actions: ensureActionCount(actionsToEnsure, 3, context, overrides.evidence || {}, { skipSupplements: true }),
    currentStateContext: context,
    searchQuery: overrides.searchQuery || "",
    sourceNames: Array.isArray(overrides.sourceNames) ? overrides.sourceNames : [],
    evidence: overrides.evidence || { top3: [], selfCare: [], observe: [], danger: [] },
    concreteMessage: overrides.concreteMessage || "",
  };
}

/** フォールバック廃止。呼び出し元は null を渡し、LLM で補填する。 */
function buildSafeImmediateFallbackAction() {
  return null;
}

function isForbiddenImmediateAction(action = {}) {
  const title = String(action?.title || "");
  const reason = String(action?.reason || "");
  const forbidden = [
    /症状メモを2時間ごとに1回、合計3回（強さ・変化・随伴症状）で記録し、同日中に悪化サインがないか再確認しましょう/,
    /症状メモを2時間ごとに1回、合計3回（強さ・きっかけ・変化）で記録し、今日中に悪化サインがないか再確認しましょう/,
    /現在の状態データを再評価しやすくなり、次の判断の精度を維持できます。/,
    /^安静にしてください$/,
    /^安静にしましょう$/,
    /医療行為の指示|専門処置|注射してください|点滴を/,
    /危険行為|自己注射|自己処置/,
  ];
  return forbidden.some((re) => re.test(title) || re.test(reason));
}

function sanitizeImmediateActions(actions = [], fallbackAction = null) {
  const safe = (Array.isArray(actions) ? actions : [])
    .filter((a) => a && a.title && a.reason)
    .filter((a) => !isForbiddenImmediateAction(a));
  if (safe.length > 0) return safe.slice(0, 3);
  return fallbackAction ? [fallbackAction] : [];
}

function buildDontActionsFromContext(context = {}, evidence = {}) {
  const topic = normalizeContextLocation(context?.location || "");
  const base = [];
  if (topic === "頭") {
    base.push({
      action: "画面を長時間見続ける",
      reason: "視覚刺激が続くと、症状の波が大きくなりやすいためです。",
    });
    base.push({
      action: "空腹や水分不足のまま作業を続ける",
      reason: "体調要因が重なると、経過の見極めが難しくなるためです。",
    });
  } else if (topic === "お腹") {
    base.push({
      action: "脂っこい食事や刺激の強い食事を続ける",
      reason: "消化管への負担が増えると、症状の持続につながりやすい情報が見られます。",
    });
    base.push({
      action: "一度に多量の飲食をする",
      reason: "短時間で負荷が高まると、変化の把握がしづらくなるためです。",
    });
  } else if (topic === "喉") {
    base.push({
      action: "乾燥した環境で長時間話し続ける",
      reason: "咽頭刺激が重なると、違和感や痛みが長引く要因になりやすいためです。",
    });
    base.push({
      action: "冷たい飲み物や刺激物を連続して摂る",
      reason: "局所刺激が増えると、経過が読みづらくなる可能性があります。",
    });
  } else {
    base.push({
      action: "つらい状態のまま無理に活動量を上げる",
      reason: "負荷が増えると、改善傾向の判断がしづらくなることがあります。",
    });
  }

  const dangerText = [...(evidence?.danger || []), ...(evidence?.observe || [])]
    .join(" ")
    .toLowerCase();
  if (/dehyd|脱水|hydration/.test(dangerText)) {
    base.unshift({
      action: "水分をほとんど取らないまま過ごす",
      reason: "脱水は症状悪化の引き金になりやすいためです。",
    });
  }
  return base.slice(0, 2);
}

/** PAIN/INFECTION+🟡のとき、モーダル末尾に追加。MC問題を解決する「現実の行動（会社対応）」サポート。フォールバック用。 */
const SINGAPORE_REST_SECTION_FALLBACK = [
  "■シンガポールの休み方",
  "シンガポールでは、一日休むだけでもMC（診断書）が必要になります。",
  "ない場合は有給扱いにならないこともあります。",
  "必要であれば、外出せずにオンライン診療で数分で取得できます。",
];

function shouldAppendSingaporeRestSection(state) {
  if (state?.decisionLevel !== "🟡") return false;
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state);
  return category === "PAIN" || category === "INFECTION";
}

/** ■シンガポールの休み方セクションを型に沿って生成。3〜4行程度。 */
async function generateSingaporeRestSection() {
  const systemPrompt = `あなたはシンガポール在住者向けの体調サポート文を生成するアシスタントです。
以下の型に厳密に沿って、■シンガポールの休み方セクションの本文を生成してください。

【必須構成（順番固定）】
① 一日休むだけでもMCが必要（1文）
② MCがない場合のリスク（有給扱いにならない等）（1文）
③ オンライン診療で外出せず数分で取得可能（1文）

【ルール】
- 医療説明は禁止。不安を煽らない。
- 事実ベース。3〜4行程度。長すぎる説明禁止。
- 見出しは含めない（呼び出し側で付与）。
- 出力は本文のみ。改行は\\nで。`;

  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              "上記の型に沿って、■シンガポールの休み方の本文を生成してください。見出しは含めず、本文のみ出力。",
          },
        ],
        temperature: 0.3,
        max_tokens: 400,
      });
      const raw = (completion?.choices?.[0]?.message?.content || "").trim();
      if (!raw) continue;
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      return ["■シンガポールの休み方", ...lines];
    } catch (e) {
      if (attempt >= LLM_RETRY_COUNT - 1) break;
    }
  }
  return SINGAPORE_REST_SECTION_FALLBACK;
}

function renderActionDetailMessage(cushion, doActions = [], dontActions = [], singaporeRestLines = null) {
  const lines = [String(cushion || "").trim(), "", "■今すぐやること"];
  doActions.slice(0, 4).forEach((item, idx) => {
    lines.push(`・${String(item.action || "").trim()}`);
    lines.push(`→ ${String(item.reason || "").trim()}`);
    if (idx < Math.min(doActions.length, 4) - 1) lines.push("");
  });
  lines.push("", "■やらないほうがいいこと");
  dontActions.slice(0, 2).forEach((item, idx) => {
    lines.push(`・${String(item.action || "").trim()}`);
    lines.push(`→ ${String(item.reason || "").trim()}`);
    if (idx < Math.min(dontActions.length, 2) - 1) lines.push("");
  });
  if (Array.isArray(singaporeRestLines) && singaporeRestLines.length > 0) {
    lines.push(...singaporeRestLines);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function buildConcreteImmediateActionsDetails(state, actionSection = "") {
  const historyText = state?.historyTextForCare || "";
  const plan = await buildImmediateActionHypothesisPlan(state, historyText, actionSection || "");
  const dontActions = buildDontActionsFromContext(plan?.currentStateContext || {}, plan?.evidence || {});
  const cushion = buildYellowPsychologicalCushionLine();

  const appendSingaporeRest = shouldAppendSingaporeRestSection(state);
  // refine と Singapore は互いに独立のため並列化し、モーダル応答の待ち時間を短縮する
  const [refinedActions, singaporeRestLines] = await Promise.all([
    refineDoActionsWithLLM(plan, state, state?.decisionLevel || "🟢", { forSummary: false }),
    appendSingaporeRest ? generateSingaporeRestSection() : Promise.resolve(null),
  ]);
  const ensuredDo = buildDoActionsFromPlan(plan, state, state?.decisionLevel || "🟢", {
    actionsOverride: refinedActions.length > 0 ? refinedActions : undefined,
  });
  return {
    message: renderActionDetailMessage(cushion, ensuredDo, dontActions, singaporeRestLines),
    query: plan?.searchQuery || "",
    sourceNames: plan?.sourceNames || [],
  };
}

function mapDailyImpactAnswerToRestLevel(answer) {
  const normalized = String(answer || "").trim();
  if (normalized === "普通に動ける") return "NONE";
  if (normalized === "少しつらいが動ける") return "LIGHT";
  if (normalized === "動けないほどつらい") return "STRONG";
  // INFECTIONカテゴリ（体温質問）でも 3択を 1:1 で休息判定に使う
  if (normalized === "平熱に近い") return "NONE";
  if (normalized === "37度台") return "LIGHT";
  if (normalized === "38度以上") return "STRONG";
  return null;
}

function resolveQuestionCategoryFromState(state) {
  const text = [
    state?.primarySymptom || "",
    state?.slotAnswers?.pain_score || "",
    state?.slotAnswers?.worsening || "",
    state?.slotAnswers?.duration || "",
    state?.slotAnswers?.daily_impact || "",
    state?.slotAnswers?.associated_symptoms || "",
    state?.slotAnswers?.cause_category || "",
    state?.causeDetailText || "",
  ]
    .filter(Boolean)
    .join(" ");
  return detectQuestionCategory4(text);
}

function resolveRestLevelFromState(state) {
  // Rest判定はカテゴリ別ルールで決定する
  const category = resolveQuestionCategoryFromState(state);
  if (category === "SKIN") {
    // 仕様: SKIN は常に NONE
    return "NONE";
  }
  if (category === "GI") {
    // 仕様: GI は常に LIGHT
    return "LIGHT";
  }
  // INFECTION は daily_impact（体温）の回答を 1:1 で参照。PAIN は daily_impact を削除したため LIGHT で固定。
  if (category === "PAIN") return "LIGHT";
  const byAnswer = mapDailyImpactAnswerToRestLevel(state?.slotAnswers?.daily_impact);
  if (byAnswer) return byAnswer;
  // 自由記述は近似マッピング結果（slotNormalized）でフォールバック
  const dailyImpact = state?.slotNormalized?.daily_impact?.riskLevel;
  if (dailyImpact === RISK_LEVELS.HIGH) return "STRONG";
  if (dailyImpact === RISK_LEVELS.MEDIUM) return "LIGHT";
  return "NONE";
}

function resolveMcRecommendation(restLevel) {
  if (restLevel === "STRONG") return "true";
  if (restLevel === "LIGHT") return "optional";
  return "false";
}

function buildRestMcDecisionBlock(level, state) {
  const restLevel = resolveRestLevelFromState(state);
  const mcRecommended = resolveMcRecommendation(restLevel);
  const lines = ["🧾 休息とMCの目安"];

  if (level === "🔴") {
    lines.push("・医学的判断：今は対面受診を優先する段階です。");
    lines.push("・社会的対応（MC）：MC取得は副次目的として扱い、まず受診先で相談する形が合います。");
    return lines.join("\n");
  }

  if (level === "🟡") {
    if (restLevel === "NONE") {
      lines.push("・医学的判断：今は市販薬＋自宅ケアが基本です。");
      lines.push("・社会的対応（MC）：通常勤務が難しくなければ、MC取得は必須ではありません。");
    } else if (restLevel === "LIGHT") {
      lines.push("・医学的判断：今は市販薬＋休息で整える流れが合っています。");
      lines.push("・社会的対応（MC）：MCが必要な場合は、オンライン診療で取得可能なレベルです。");
    } else {
      lines.push("・医学的判断：今は市販薬＋強い休息を優先する流れが合っています。");
      lines.push("・社会的対応（MC）：MC取得目的なら、オンライン診療を第一選択にできます。");
    }
    return lines.join("\n");
  }

  if (restLevel === "NONE") {
    lines.push("・医学的判断：今は自宅で様子を見る対応が合っています。");
    lines.push("・社会的対応（MC）：通常勤務が可能なら、MC取得は不要です。");
  } else if (restLevel === "LIGHT") {
    lines.push("・医学的判断：今は自宅で軽く休息を取る対応が合っています。");
    lines.push("・社会的対応（MC）：会社規定で必要な場合は、オンライン診療を選択できます。");
  } else {
    lines.push("・医学的判断：今は自宅でしっかり休息を取る対応が合っています。");
    lines.push("・社会的対応（MC）：MCが必要な場合は、オンライン診療を活用できます。");
  }

  return lines.join("\n");
}

function ensureRestMcDecisionBlock(text, level, state) {
  // 仕様変更：🧾 ブロックは使用しない（MCは✅今すぐやること内でのみ制御）
  return text;
}

function buildSummaryIntroTemplate() {
  const templates = [
    "教えてもらった内容をもとに、今の状態を一度まとめますね。",
    "ここまでに聞いたことを整理して、今の状況を確認しますね。",
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function enforceSummaryIntroTemplate(text) {
  if (!text) return text;
  const lines = text.split("\n");
  const headerIndex = lines.findIndex((line) =>
    line.startsWith("🟢 ここまでの情報を整理します") ||
    line.startsWith("🟡 ここまでの情報を整理します")
  );
  if (headerIndex === -1) {
    if (isHospitalFlow(text)) return text;
    const hasGreenStructure =
      text.includes("🤝 今の状態について") ||
      text.includes("✅ 今すぐやること") ||
      text.includes("⏳ 今後の見通し") ||
      text.includes("🌱 最後に");
    if (hasGreenStructure) {
      return `🟢 ここまでの情報を整理します\n${buildSummaryIntroTemplate()}\n\n${text}`;
    }
    return text;
  }
  const templateLine = buildSummaryIntroTemplate();
  const nextBlockIndex = lines.findIndex(
    (line, idx) =>
      idx > headerIndex &&
      (line.startsWith("🤝 ") ||
        line.startsWith("✅ ") ||
        line.startsWith("⏳ ") ||
        line.startsWith("🚨 ") ||
        line.startsWith("🏥 ") ||
        line.startsWith("💊 ") ||
        line.startsWith("🌱 ") ||
        line.startsWith("💬 "))
  );
  const bodyStart = headerIndex + 1;
  const bodyEnd = nextBlockIndex >= 0 ? nextBlockIndex : lines.length;
  lines.splice(bodyStart, bodyEnd - bodyStart, templateLine);
  return lines.join("\n");
}

function isAffirmative(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(はい|うん|ええ|お願い|お願いします|いいですね|やります|頼みます|できます|できそうです|いいです|大丈夫です|わかりました|OK|ok|そう|そうそう|よろしく|やる|そうする|そうします|無理じゃない|大丈夫そう|いける|いけそうです)$/i.test(t) ||
    /^(はい|うん|ええ)[。、！]?\s*$/.test(t) ||
    /^できます?[。、]?\s*$/.test(t) ||
    /^(お願い|やります|頼みます)[。、]?\s*$/i.test(t) ||
    /(できます|できそうです|大丈夫です|いいです)[。、]?\s*$/i.test(t)
  );
}

function isDecline(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(今はいい|大丈夫|結構|いりません|不要|いいえ|やめて|パス|スキップ|遠慮|ナシ|必要ない)/.test(t) ||
    /(今はいい|大丈夫です|結構です|いりません|不要|やめて|遠慮します|パスします)/.test(t) ||
    /^(いいえ|やめます|やめておきます)[。、]?\s*$/.test(t)
  );
}

/** 仕様8.2: 「今はいいです」等＝クロージング。「いいえ」「できない」＝☐の難しさ選択へ */
function isDeclineToClose(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(今はいい|大丈夫|結構|いりません|不要|やめて|パス|スキップ|遠慮|ナシ|必要ない)/.test(t) ||
    /(今はいい|大丈夫です|結構です|いりません|不要|やめて|遠慮します)/.test(t) ||
    /^(いいえ、結構|今は結構)[。、]?\s*$/.test(t)
  );
}

/** 仕様8.2: ☐「できそうですか？」への「いいえ」＝できない・難しい＝難しさ選択へ */
function isCheckboxCantDo(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(いいえ|できない|むずかしい|無理|難しい|きつい|厳しい|苦手)/.test(t) ||
    /(できない|むずかしい|無理|難しい|きつい|厳しい|苦手|無理かも|難しいかも|ちょっと無理|ちょっと難しい)/.test(t) ||
    /(ハード|つらい|辛い)/.test(t)
  );
}

/** 🔴質問①：「ここで整理」を選んだか（整理・まとめ・準備・診察まで・最初・前者・1・一つ目 等） */
function isRedChoicePrepare(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  const preparePatterns = [
    /^(整理|まとめ|準備|診察まで|最初|前者|1|一つ目|ひとつ目|左|いち|1番|一番)/,
    /^(はい|うん|そう|お願い|お願いします)(\s|　)*(整理|まとめ|準備)/,
    /(ここで整理|診察までの準備|整理して|まとめて|準備を|整理したい|まとめたい|準備したい)/,
    /(診察までに|受診までに|病院までに).*(できること|やること|準備)/,
    /(できること|やること).*(整理|まとめ|準備)/,
    /(診察|受診|病院).*(準備|できること)/,
    /(準備|できること).*(診察|受診)/,
    /^(1|１|一つ|ひとつ|一番)/,
  ];
  return preparePatterns.some((re) => re.test(t));
}

/** 🔴質問①：「英語」を選んだか（英語・伝え方・後者・2・二つ目 等） */
function isRedChoiceEnglish(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  const englishPatterns = [
    /^(英語|伝え方|後者|2|二|二つ目|ふたつ目|右|2番|二番)/,
    /^(はい|うん|そう|お願い|お願いします)(\s|　)*(英語|伝え方)/,
    /(英語で|伝え方を|英語の|英語で伝え|英語で話|英語で説明)/,
    /(病院で|受診先で|クリニックで).*(英語|伝え)/,
    /(英語|伝え方).*(考え|教え|お願い)/,
    /(言い方|話し方|説明).*(英語|伝え)/,
    /^(2|２|二つ|ふたつ|二番)/,
  ];
  return englishPatterns.some((re) => re.test(t));
}

/** 🔴質問①：「どっちも」を選んだか（両方・どっちも・両方とも・両方お願い 等） */
function isRedChoiceBoth(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(両方|どっちも|両方とも|両方お願い|両方お願いします|両方したい|両方とも|両方知りたい|両方とも)/.test(t) ||
    /(両方|どっちも|両方とも).*(お願い|したい|します|知りたい|教えて|欲しい)/.test(t) ||
    /^(両方|どっちも)/.test(t) ||
    /(両方|どっちも).*(教えて|お願い)/.test(t)
  );
}

function isRestChoice(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(休む|休みます|少し休みます|休みたい|休みたいです|そっち|前者|1|一つ目|左|上の方|休憩)$/.test(t) ||
    /(休む|休みたい|ゆっくりする|ゆっくりします|休みます|少し休む)/.test(t) ||
    /^(うん|はい)[、。]?\s*(休む|休みます|休みたい)/.test(t) ||
    /^(はい|うん|ええ)[。、！]?\s*$/.test(t) ||
    /(安静|様子見|回復|寝る|横になる|休養)/.test(t) ||
    /^(休む方|休みの方)/.test(t)
  );
}

function isDetailChoice(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(詳しく|確認|もう少し|詳しく確認|詳しく確認します|そっち|後者|2|二つ目|右|下の方)/.test(t) ||
    /(詳しく|確認したい|確認します|教えて|もう少し)/.test(t) ||
    /^(うん|はい)[、。]?\s*(詳しく|確認)/.test(t) ||
    /(詳しく知りたい|もっと知りたい|教えてほしい)/.test(t) ||
    /^(2|２|二つ|ふたつ|二番)/.test(t)
  );
}

/** B_MC「見てみますか？」への肯定（見る/教えて/はい等） */
function isMcAffirmative(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return (
    /^(はい|うん|ええ|見る|見てみる|教えて|紹介|お願い)/.test(t) ||
    /(見てみます|教えてください|紹介して|見たい|知りたい)/.test(t) ||
    isAffirmative(text)
  );
}

/** B_MC「見てみますか？」への否定 */
function isMcDecline(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  if (!t) return false;
  return isDecline(text) || /^(今はいい|大丈夫|結構|不要)/.test(t);
}

function buildClosingMessage() {
  return [
    "わかりました。",
    "今はそれで大丈夫だと思います。",
    "",
    "また不安になったり、状況が変わったら、",
    "いつでもKairoに相談してください。",
  ].join("\n");
}

function buildDecisionReasonBullets(state) {
  const reasons = [];
  const normalized = state?.slotNormalized || {};
  if (normalized.pain_score?.riskLevel === RISK_LEVELS.HIGH) {
    reasons.push("・痛みが強めに出ている");
  }
  if (normalized.worsening?.riskLevel === RISK_LEVELS.HIGH) {
    reasons.push("・痛み方が強めの側に寄っている");
  }
  if (normalized.daily_impact?.riskLevel === RISK_LEVELS.HIGH) {
    reasons.push("・日常の動きに支障が出ている");
  }
  if (normalized.associated_symptoms?.riskLevel === RISK_LEVELS.HIGH) {
    reasons.push("・付随する症状が強めに出ている");
  }
  if (reasons.length === 0) {
    buildFactsFromSlotAnswers(state).forEach((fact) => reasons.push(fact));
  }
  return reasons.slice(0, 3);
}

function freezeJudgmentSnapshot(snapshot) {
  if (!snapshot) return null;
  const normalized = {
    main_symptom: snapshot.main_symptom || "",
    duration: snapshot.duration || "",
    severity: snapshot.severity || "",
    red_flags: Array.isArray(snapshot.red_flags) ? [...snapshot.red_flags] : [],
    risk_factors: Array.isArray(snapshot.risk_factors) ? [...snapshot.risk_factors] : [],
    user_original_phrases: Array.isArray(snapshot.user_original_phrases)
      ? [...snapshot.user_original_phrases]
      : [],
    judgment_type: snapshot.judgment_type || "C_WATCHFUL_WAITING",
  };
  Object.freeze(normalized.red_flags);
  Object.freeze(normalized.risk_factors);
  Object.freeze(normalized.user_original_phrases);
  return Object.freeze(normalized);
}

function detectMainSymptomFromText(text) {
  const source = String(text || "");
  if (/頭痛|頭が痛|偏頭痛|こめかみ/.test(source)) return "頭痛";
  if (/腹痛|お腹|胃痛|下痢|便秘|吐き気/.test(source)) return "腹部症状";
  if (/喉|のど|咳|せき|痰/.test(source)) return "のど・咳の症状";
  if (/歯|歯ぐき|親知らず/.test(source)) return "歯の痛み";
  if (/耳|耳鳴り|聞こえ/.test(source)) return "耳の症状";
  if (/鼻|鼻水|鼻づまり|くしゃみ/.test(source)) return "鼻の症状";
  if (/熱|発熱|だるい|倦怠/.test(source)) return "発熱・だるさ";
  return "";
}

function buildJudgmentSnapshot(state, history = [], decisionType) {
  const userPhrases = history
    .filter((msg) => msg?.role === "user")
    .map((msg) => String(msg?.content || "").trim())
    .filter(Boolean)
    .slice(-10);
  const answers = state?.slotAnswers || {};
  const answerPhrases = Object.values(answers)
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (state?.causeDetailText) {
    answerPhrases.push(String(state.causeDetailText).trim());
  }
  const mergedPhrases = [];
  for (const p of [...userPhrases, ...answerPhrases]) {
    if (!p || mergedPhrases.includes(p)) continue;
    mergedPhrases.push(p);
  }
  const symptomSource = mergedPhrases.join("\n");
  const mainSymptom = detectMainSymptomFromText(symptomSource) || detectMainSymptomFromText(Object.keys(answers).join(" "));
  const duration = String(answers.duration || "").trim();
  const severity = Number.isFinite(state?.lastPainScore)
    ? `${state.lastPainScore}/10`
    : state?.slotNormalized?.pain_score?.riskLevel === RISK_LEVELS.HIGH
      ? "高め"
      : state?.slotNormalized?.pain_score?.riskLevel === RISK_LEVELS.MEDIUM
        ? "中等度"
        : state?.slotNormalized?.pain_score?.riskLevel === RISK_LEVELS.LOW
          ? "軽め"
          : "";

  const redFlags = [];
  if (state?.slotNormalized?.associated_symptoms?.riskLevel === RISK_LEVELS.HIGH) {
    redFlags.push("強い付随症状");
  }
  if (Number.isFinite(state?.lastPainScore) && state.lastPainScore >= 7) {
    redFlags.push("痛みスコアが高い");
  }
  if (state?.slotNormalized?.daily_impact?.riskLevel === RISK_LEVELS.HIGH) {
    redFlags.push("日常動作への強い影響");
  }

  const riskFactors = [];
  if (answers.cause_category && !/思い当たらない|ない|なし/.test(answers.cause_category)) {
    riskFactors.push(`きっかけ: ${answers.cause_category}`);
  }
  if (duration) {
    riskFactors.push(`経過: ${duration}`);
  }
  const worseningTrend = String(answers.worsening_trend || "").trim();
  if (worseningTrend && /発症時より悪化|悪化している/.test(worseningTrend)) {
    riskFactors.push(`方向性: ${worseningTrend}`);
  }
  if (answers.associated_symptoms && !/ない|なし|特にない/.test(answers.associated_symptoms)) {
    riskFactors.push(`付随症状: ${answers.associated_symptoms}`);
  }

  const category = state?.triageCategory || resolveQuestionCategoryFromState(state) || "PAIN";
  return freezeJudgmentSnapshot({
    main_symptom: mainSymptom || "症状",
    category: category,
    duration: duration || "数日",
    severity: severity || "中くらい",
    red_flags: redFlags.slice(0, 3),
    risk_factors: riskFactors.slice(0, 4),
    user_original_phrases: mergedPhrases.slice(0, 10),
    judgment_type: decisionType || state?.decisionType || "C_WATCHFUL_WAITING",
  });
}

function formatDurationForScript(duration) {
  if (!duration) return "";
  const d = String(duration).trim();
  if (/から/.test(d)) return d;
  const dayMatch = d.match(/(\d+)\s*日/);
  if (dayMatch) return `${dayMatch[1]}日前から`;
  if (/数日/.test(d)) return "数日前から";
  if (/昨日|一昨日/.test(d)) return d;
  return `${d}から`;
}

function formatSeverityForScript(severity) {
  if (!severity) return "";
  const s = String(severity).trim();
  if (/中程度|中くらい|中等度|\d+\/10/.test(s)) return "中くらい";
  if (/強い|かなり|ひどい|高め/.test(s)) return "かなりつらい";
  if (/軽い|弱い|軽め/.test(s)) return "軽め";
  return s;
}

/** 🔴英語伝え方（①安心 ②ハードル下げ ③日本語 ④English ⑤スマホ ⑥誘導） */
function buildCommunicationScript(state) {
  const snapshot = state?.judgmentSnapshot || {};
  const symptom = snapshot.main_symptom || "症状";
  const durationRaw = snapshot.duration || "";
  const severityRaw = snapshot.severity || "";

  const symptomEn =
    /頭痛/.test(symptom) ? "a headache" :
    /喉|のど/.test(symptom) ? "a sore throat" :
    /吐き気|嘔吐/.test(symptom) ? "nausea" :
    /腹痛|お腹|胃/.test(symptom) ? "stomach pain" :
    symptom;
  const durationEn =
    /さっき|今|just/.test(durationRaw) ? "since just now" :
    /数時間/.test(durationRaw) ? "for a few hours" :
    /1日|一日/.test(durationRaw) ? "for about a day" :
    /数日/.test(durationRaw) ? "for a few days" :
    durationRaw ? `for ${durationRaw}` : "for a while";
  const severityEn =
    /軽い|軽め/.test(severityRaw) ? "mild" :
    /強い|かなり|高め/.test(severityRaw) ? "quite strong" :
    "moderate";

  const jpLine = durationRaw && severityRaw
    ? `${durationRaw}から${symptom}が続いていて、${severityRaw}程度です。念のため診ていただきたいです。`
    : `${symptom}が続いていて、念のため診ていただきたいです。`;

  const enLine = `I have been having ${symptomEn} ${durationEn}, and it feels ${severityEn}.\nI'd like to have this checked just to be safe.`;

  return [
    "英語で伝えるのが不安ですよね。海外での受診はハードルが高く感じると思います。",
    "",
    "完璧に話す必要はありません。短く伝えるだけでも大丈夫ですし、このまま見せても問題ありません。",
    "",
    "【日本語】",
    jpLine,
    "",
    "【English】",
    enLine,
    "",
    "このまま受付で見せても大丈夫です。必要なら、もう少し詳しい言い方も一緒に考えます。",
  ].join("\n");
}

/** buildCommunicationScript の ④【English】以降（🔴「どっちも」用） */
function buildCommunicationScriptEnglishPart(state) {
  const full = buildCommunicationScript(state);
  const idx = full.indexOf("【English】");
  if (idx === -1) return full;
  return full.slice(idx);
}

/** 🔴診察前準備ブロック（カテゴリ別） */
function buildRedPrepareBlock(state) {
  const snapshot = state?.judgmentSnapshot || {};
  const category = snapshot.category || resolveQuestionCategoryFromState(state) || "PAIN";
  const seeds = getPrepareSeedsByCategory(category);
  const lines = [
    "診察までの間に、できることを簡単にまとめます。",
    "",
    ...seeds.flatMap(([title, reason]) => [`・${title}`, `→ ${reason}`]),
    "",
    "今は、病院に向かう準備を優先してください。",
    "迷ったら、この画面をそのまま見せて大丈夫です。",
  ];
  return lines.join("\n");
}

/** 🟢 C_WATCHFUL_WAITING フォロー質問（固定・KAIRO_SPEC 8.2 本文どおり） */
const WATCHFUL_FOLLOW_UP_QUESTION =
  "今は少し休むだけでも良さそうです。このまま休みますか？それとも、もう少し詳しく確認しますか？";

/** 🔴 A_HOSPITAL フォロー質問（固定・KAIRO_SPEC 8.2 本文どおり） */
const RED_FOLLOW_UP_QUESTION =
  "今の症状から見ると、念のため病院で確認してもらうと安心そうです。診察までの間にできることを整理しますか？それとも英語でどう伝えるか一緒に考えますか？";

/** 🟡 B_MC（PAIN系・INFECTION系で🟡のときのみ）フォロー質問（固定） */
const B_MC_FOLLOW_UP_QUESTION =
  "休むためにMC（診断書）が必要な場合、オンライン診療という方法もあります。もしよければ、おすすめの診療先を紹介できますが、見てみますか？";

/**
 * 会話履歴に「初回まとめ」またはそれに準ずる本文が既にあるか。
 * state が未同期・フォールバック体裁・英語ブロック混在でもまとめ後とみなす（入力内容に依存せずフォロー専用へ）。
 */
function historyContainsSummaryBlock(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  const patterns = [
    /(🟢|🟡|🔴)\s*ここまでの情報を整理/,
    /ここまでの情報を整理します/,
    /教えてもらった内容をもとに/,
    /聞いたことを整理して/,
    /🤝\s*今の状態について/,
    /📝\s*今の状態について/,
    /📝\s*いまの状態を整理します/,
    /✅\s*今すぐやること/,
    /⏳\s*今後の見通し/,
    /🏥\s*受診先の候補/,
    /🌱\s*最後に/,
    /💬\s*最後に/,
    /【🤝\s*今の状態について/,
    /■おすすめのオンライン診療/,
    /I'd like to have this checked just to be safe/,
    /I have been having /,
  ];
  for (const m of history) {
    if (m.role !== "assistant") continue;
    const t = String(m.content || "");
    if (patterns.some((re) => re.test(t))) return true;
  }
  return false;
}

/**
 * まとめ本文をユーザーに返却したことの記録（フォロー許可の唯一の論理根拠に揃える）。
 * 新規で summaryShown 等を立てるときはこの関数を使う（取りこぼし防止）。
 */
function markSummaryDeliveredAndFollowUpPhase(state) {
  if (!state) return;
  state.summaryShown = true;
  state.summaryGenerated = true;
  state.hasSummaryBlockGenerated = true;
  state.summaryDeliveredForFollowUp = true;
  state.phase = "FOLLOW_UP";
}

/**
 * サーバー再起動・状態欠落と履歴／クライアント報告を同期する。
 * summaryShown が false のまま履歴にまとめがある／クライアントが summaryShown を送っている場合に FOLLOW_UP へ揃える。
 */
function reconcilePostSummaryStateIfNeeded(state, history, clientMeta, forceFreshSession) {
  if (!state || forceFreshSession) return;
  // クライアントのみ summaryShown を送ると、質問フェーズでまとめ済み扱いになりフォロー固定文が混入する。履歴にまとめブロックの実体があるときだけ同期する。
  if (clientMeta?.summaryShown === true && !state.summaryShown && historyContainsSummaryBlock(history)) {
    markSummaryDeliveredAndFollowUpPhase(state);
  }
  // まとめ前確認のみ表示中は、確認文がまとめ風にマッチしても「まとめ済み」にしない（確認応答でまとめを返すため）
  const awaitingConfirmationReply =
    (state.confirmationShown || state.confirmationPending) && !state.summaryShown;
  if (historyContainsSummaryBlock(history) && !state.summaryShown && !awaitingConfirmationReply) {
    markSummaryDeliveredAndFollowUpPhase(state);
  }
  if (historyContainsSummaryBlock(history) && state.summaryShown && !state.summaryDeliveredForFollowUp) {
    state.summaryDeliveredForFollowUp = true;
  }
  // 旧 state（フラグ未導入セッション）: まとめ済みならフォロー許可を復元
  if (state.summaryShown && state.hasSummaryBlockGenerated && !state.summaryDeliveredForFollowUp) {
    state.summaryDeliveredForFollowUp = true;
  }
}

/**
 * 【不変条件】まとめ表示後は絶対にまとめを再生成しない。この条件がtrueのときは必ずhandleFollowUpPhaseへ。
 * また summaryDeliveredForFollowUp が true のときだけフォロー専用にできる（質問フェーズへの混入防止）。
 */
function mustUseFollowUpPhase(state, history, clientMeta, userMessageCountBefore) {
  const isFirstUserMessage = userMessageCountBefore === 0;
  if (isFirstUserMessage) return false;
  // 確認文の応答待ち（まだ初回まとめ未表示）の間はフォロー専用にしない。ここで true にするとまとめ初回生成に到達できない。
  const awaitingConfirmationReply =
    (state?.confirmationShown || state?.confirmationPending) &&
    !state?.summaryShown &&
    !state?.summaryGenerated &&
    !state?.hasSummaryBlockGenerated;
  if (awaitingConfirmationReply) return false;
  // まとめ本文を一度も返していない間はフォロー専用にしない（履歴・フラグの誤検知で質問フェーズにフォローが混入するのを防ぐ）
  if (!state?.summaryDeliveredForFollowUp) return false;
  // 履歴にまとめ本文があれば（「休む」等のフォロー応答含む）必ずフォロー専用へ。state 欠落時の誤ルート防止。
  if (userMessageCountBefore >= 1 && historyContainsSummaryBlock(history || [])) {
    return true;
  }
  const serverSaysPostSummary = !!(
    state?.phase === "FOLLOW_UP" ||
    state?.summaryShown ||
    state?.summaryGenerated ||
    state?.hasSummaryBlockGenerated
  );
  const clientReportedSummaryShown = clientMeta?.summaryShown === true;
  return serverSaysPostSummary || clientReportedSummaryShown;
}

/** B_MC 肯定時の完全固定ブロック（LLM生成禁止） */
const B_MC_ONLINE_CLINICS_BLOCK = [
  "シンガポールでは、会社や学校に所属している場合、",
  "保険が適用されて診療費が割安、または無料になるケースもあります。",
  "",
  "軽い体調不良でもMC（診断書）が必要になることが多く、",
  "オンライン診療での取得が一般的です。",
  "",
  "■おすすめのオンライン診療",
  "",
  "【日系（日本語対応）】",
  "",
  "Cotovia Clinic（ことびあクリニック）",
  "• 日本語で診察が受けられる",
  "• 薬の配送にも対応",
  "保険：一部保険対応あり（要確認） △",
  "",
  "Healthway Japanese Medical",
  "• 日本人医師または日本語スタッフ対応",
  "• WhatsAppで簡単に予約できる",
  "保険：企業保険対応あり（要確認） △",
  "",
  "【ローカル】",
  "",
  "Doctor Anywhere",
  "• 24時間対応で数分で診察可能",
  "• アプリで完結し、MCが即発行される",
  "保険：多くの企業保険に対応 ◯",
  "",
  "WhiteCoat",
  "• 政府認可の信頼性の高いサービス",
  "• 保険連携が多くスムーズに利用できる",
  "保険：多くの企業保険に対応 ◯",
].join("\n");

/** B_MC 否定時の固定メッセージ */
const B_MC_DECLINE_MESSAGE = "無理に使う必要はありません。\nまた必要になったら、いつでも確認してください。";

/** フォロー応答で出してはいけない誤生成パターン（一致時は空レス）。通常は一致しない。 */
const FORBIDDEN_FOLLOW_UP = /\b\B/;

function shouldShowBMcFollowUp(state) {
  if (state?.decisionLevel !== "🟡") return false;
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state);
  return category === "PAIN" || category === "INFECTION";
}

/** まとめ後の初期フォロー質問（generateFollowResponseがnullの時のフォールバック） */
function getInitialFollowUpQuestionBySpec(state) {
  if (!state) return null;
  if (shouldShowBMcFollowUp(state)) return B_MC_FOLLOW_UP_QUESTION;
  const jt = state.decisionType || (state.decisionLevel === "🔴" ? "A_HOSPITAL" : "C_WATCHFUL_WAITING");
  return jt === "A_HOSPITAL" ? RED_FOLLOW_UP_QUESTION : WATCHFUL_FOLLOW_UP_QUESTION;
}

/** カテゴリ別☐項目のシード（固定文禁止・自然文生成のヒント）。PAIN/INFECTION/GI/SKIN */
function getCheckboxSeedsByCategory(category) {
  const seeds = {
    PAIN: ["刺激を減らす", "水分"],
    INFECTION: ["水分", "安静"],
    GI: ["食事控えめ", "水分少量"],
    SKIN: ["刺激回避", "冷やす"],
  };
  return seeds[category] || seeds.PAIN;
}

/** カテゴリ別診察前準備。INFECTION/PAIN/GI/SKIN */
function getPrepareSeedsByCategory(category) {
  const seeds = {
    INFECTION: [
      ["体温を測ってメモしておく", "受付で伝えるとスムーズです"],
      ["マスクを用意しておく", "感染対策として役立ちます"],
    ],
    PAIN: [
      ["痛みの経過をメモしておく", "医師に伝えやすくなります"],
      ["今の症状を一言で言えるようにしておく", "診察がスムーズになります"],
    ],
    GI: [
      ["食事を控えめにする", "胃腸の負担を減らせます"],
      ["水分を少量ずつとる", "脱水予防になります"],
    ],
    SKIN: [
      ["原因になりそうなものを避ける", "悪化を防ぎやすくなります"],
      ["状態の変化をメモしておく", "診察時に伝えやすくなります"],
    ],
  };
  return seeds[category] || seeds.PAIN;
}

/** クロージング（拒否時） */
function buildFollowClosingMessage() {
  return "大丈夫です、その判断でも問題ありません。\nまた不安になったら、いつでもここで確認してください。";
}

/** 🟢分岐①「休む」の応答 */
function buildWatchfulRestResponse() {
  return "今はそのまま休むのが一番良さそうです。\nまた不安になったら、いつでもここで確認してください。";
}

/** 🟢分岐②「詳しく確認」→ ☐3つ（カテゴリ別） */
function buildWatchfulCheckboxQuestion(state) {
  const snapshot = state?.judgmentSnapshot || {};
  const category = snapshot.category || "PAIN";
  const mainSymptom = snapshot.main_symptom || "症状";
  const seeds = getCheckboxSeedsByCategory(category);
  const item1 = seeds[0] ? `${seeds[0]}を心がける` : "刺激を減らす";
  const item2 = seeds[1] ? `${seeds[1]}をとる` : "水分を補給する";
  const item3 = `${mainSymptom}が強くなったら気づけるようにする`;
  const items = [item1, item2, item3].filter(Boolean).slice(0, 3);
  state.followUpCheckboxItems = items;
  return ["念のため確認しますね。", "", ...items.map((t) => `☐ ${t}`), "", "この3つ、できそうですか？"].join("\n");
}

/** 🟢分岐③「はい」の応答 */
function buildWatchfulAffirmation() {
  return "いいですね、そのまま無理せず過ごしてください。";
}

/** 🟢分岐④「いいえ」→ 難しさ選択 */
function buildWatchfulDifficultyOptions(state) {
  const items = state?.followUpCheckboxItems || [];
  const options = items.slice(0, 3).map((item) => {
    if (/強くなったら気づける/.test(item)) {
      const m = item.match(/(.+?)が強くなったら/);
      return `・${m ? m[1] : "症状"}の変化に気づくのが不安`;
    }
    if (/水分|補給/.test(item)) return `・${item.replace(/を心がける|をとる|する$/, "")}がつらい`;
    return `・${item.replace(/を心がける|をとる|する$/, "")}のが難しい`;
  });
  return ["どれが難しそうですか？", "", ...options].join("\n");
}

/** 🟢分岐④→個別対応 */
function buildWatchfulIndividualResponse(choice, state) {
  const t = (choice || "").trim();
  const items = state?.followUpCheckboxItems || [];
  if (/水分|補給|とる|つらい/.test(t) || items.some((i) => /水分|補給/.test(i))) {
    return "一気に飲まなくて大丈夫です。ひと口ずつでも十分です。";
  }
  if (/休む|休める|回復|難しい|刺激/.test(t) || items.some((i) => /刺激|安静/.test(i))) {
    return "無理に休もうとしなくて大丈夫です。できる範囲で、体を楽にする姿勢をとるだけでも十分です。";
  }
  if (/変化|気づく|不安/.test(t) || items.some((i) => /強くなったら気づける/.test(i))) {
    return "いまは気にしなくて大丈夫です。「何かおかしい」と感じたときだけ、ここに戻ってきてください。";
  }
  return buildWatchfulAffirmation();
}

function buildFollowUpJudgeMeta(state) {
  const level = state?.decisionLevel || "🟢";
  return {
    judgement: level,
    confidence: state?.confidence || 0,
    ratio: state?.decisionRatio ?? null,
    shouldJudge: true,
    slotsFilledCount: countFilledSlots(state?.slotFilled, state),
    decisionAllowed: true,
    questionCount: state?.questionCount || 0,
    summaryLine: null,
    questionType: null,
    rawScore: state?.lastPainScore ?? null,
    painScoreRatio: state?.lastPainWeight ?? null,
  };
}

/**
 * 🛑 フォロー専用ハンドラ（完全隔離）。
 * generateSummary / runTriage / runHearing は絶対に呼ばない。
 * phase=FOLLOW_UP または summaryGenerated のときのみここに入る。
 * @param {{ skipUserPush?: boolean }} [options] — true のときは user を履歴に追加しない（既に /api/chat 本体で push 済みのとき）
 */
function handleFollowUpPhase(res, conversationId, message, state, locationPromptMessage, locationRePromptMessage, options = {}) {
  if (!state?.summaryDeliveredForFollowUp) {
    console.error("[KAIRO] handleFollowUpPhase blocked: summaryDeliveredForFollowUp is false");
    return res.status(200).json({
      conversationId,
      message: "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
      response: "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
      judgeMeta: {
        judgement: state?.decisionLevel || "🟢",
        confidence: state?.confidence || 0,
        ratio: state?.decisionRatio ?? null,
        shouldJudge: false,
        slotsFilledCount: state ? countFilledSlots(state.slotFilled, state) : 0,
        decisionAllowed: false,
        questionCount: state?.questionCount || 0,
        summaryLine: null,
        questionType: null,
        rawScore: state?.lastPainScore ?? null,
        painScoreRatio: state?.lastPainWeight ?? null,
      },
      triage_state: buildTriageState(false, state?.decisionLevel || null, state ? countFilledSlots(state.slotFilled, state) : 0),
      questionPayload: null,
      normalizedAnswer: state?.lastNormalizedAnswer || null,
      locationPromptMessage,
      locationRePromptMessage,
      locationSnapshot: state?.locationSnapshot,
    });
  }
  if (!options.skipUserPush) {
    conversationHistory[conversationId].push({ role: "user", content: message });
  }
  if (!state.hasSummaryBlockGenerated) state.hasSummaryBlockGenerated = true;
  if (!state.decisionType && state.decisionLevel) {
    state.decisionType = state.decisionLevel === "🔴" ? "A_HOSPITAL" : "C_WATCHFUL_WAITING";
  }
  if (!state.judgmentSnapshot) {
    state.judgmentSnapshot = buildJudgmentSnapshot(state, [], state.decisionType || "C_WATCHFUL_WAITING");
  }
  if (state.followUpStep <= 0) {
    state.followUpPhase = "questioning";
    state.followUpStep = 1;
  }
  const followUpResult = generateFollowResponse(state, message, {
    history: conversationHistory[conversationId] || [],
  });
  const outMessage = followUpResult?.message ?? (userAskedSummary(message)
    ? "既にまとめをお伝えしています。ほかに気になることはありますか？"
    : (getInitialFollowUpQuestionBySpec(state) || buildFollowClosingMessage()));
  if (followUpResult && FORBIDDEN_FOLLOW_UP.test(String(followUpResult.message || ""))) {
    const judgeMeta = buildFollowUpJudgeMeta(state);
    return res.json({
      message: "",
      response: "",
      judgeMeta,
      triage_state: buildTriageState(true, judgeMeta.judgement, judgeMeta.slotsFilledCount),
      questionPayload: null,
      normalizedAnswer: state.lastNormalizedAnswer || null,
      isFollowUpOnlyResponse: true,
      locationPromptMessage,
      locationRePromptMessage,
      locationSnapshot: state.locationSnapshot,
      conversationId,
    });
  }
  conversationHistory[conversationId].push({ role: "assistant", content: outMessage });
  const judgeMeta = buildFollowUpJudgeMeta(state);
  return res.json({
    message: outMessage,
    response: outMessage,
    judgeMeta,
    triage: { judgement: judgeMeta.judgement, confidence: judgeMeta.confidence, ratio: judgeMeta.ratio },
    triage_state: buildTriageState(true, judgeMeta.judgement, judgeMeta.slotsFilledCount),
    sections: [],
    questionPayload: null,
    normalizedAnswer: state.lastNormalizedAnswer || null,
    followUpQuestion: null,
    followUpMessage: null,
    isFollowUpOnlyResponse: true,
    locationPromptMessage,
    locationRePromptMessage,
    locationSnapshot: state.locationSnapshot,
    conversationId,
  });
}

/**
 * フォロー質問フェーズ専用。まとめ生成ロジックと完全分離。
 * summaryGenerated/summaryShown のときのみ呼ぶ。まとめを再生成しない。
 */
function generateFollowResponse(state, userInput, options = {}) {
  if (!state?.summaryDeliveredForFollowUp) return null;
  if (!state?.hasSummaryBlockGenerated && !state?.summaryShown && !state?.summaryGenerated) return null;
  // 確認直後でまだまとめがサーバに無い場合のみブロック（まとめ済みなのに null にならないよう緩和）
  if (state.confirmationShown && !state.summaryShown && !state.hasSummaryBlockGenerated && !state.summaryGenerated) {
    return null;
  }

  const trimmed = (userInput || "").trim();
  const jt = state.decisionType || (state.decisionLevel === "🔴" ? "A_HOSPITAL" : "C_WATCHFUL_WAITING");
  if (!state.decisionType) state.decisionType = jt;
  if (!state.judgmentSnapshot) {
    const history = options.history || [];
    state.judgmentSnapshot = buildJudgmentSnapshot(state, history, jt);
  }
  const snapshot = state.judgmentSnapshot || {};

  if (jt === "C_WATCHFUL_WAITING") {
    // 🟡 B_MC（PAIN系・INFECTION系で🟡のときのみ）: 強制表示。標準の休む/詳しく確認フローより優先。
    if (shouldShowBMcFollowUp(state) && !state.bMcBlockShown) {
      if (isMcAffirmative(trimmed)) {
        state.bMcBlockShown = true;
        state.followUpPhase = "closed";
        return { message: B_MC_ONLINE_CLINICS_BLOCK };
      }
      // 否定・無反応のみ固定クロージング（肯定以外は再質問）
      if (isMcDecline(trimmed) || trimmed === "") {
        state.bMcBlockShown = true;
        state.followUpPhase = "closed";
        return { message: B_MC_DECLINE_MESSAGE };
      }
      return { message: B_MC_FOLLOW_UP_QUESTION };
    }

    if (state.followUpStep <= 1) {
      if (isRestChoice(trimmed)) {
        state.followUpPhase = "closed";
        return { message: buildWatchfulRestResponse() };
      }
      if (isDetailChoice(trimmed)) {
        state.followUpStep = 2;
        return { message: buildWatchfulCheckboxQuestion(state) };
      }
      if (isDecline(trimmed)) {
        state.followUpPhase = "closed";
        return { message: buildFollowClosingMessage() };
      }
      state.followUpPhase = "closed";
      return { message: buildFollowClosingMessage() };
    }
    if (state.followUpStep === 2) {
      if (isAffirmative(trimmed)) {
        state.followUpPhase = "closed";
        return { message: buildWatchfulAffirmation() };
      }
      if (isDeclineToClose(trimmed)) {
        state.followUpPhase = "closed";
        return { message: buildFollowClosingMessage() };
      }
      if (isCheckboxCantDo(trimmed)) {
        state.followUpStep = 3;
        return { message: buildWatchfulDifficultyOptions(state) };
      }
      return { message: buildWatchfulCheckboxQuestion(state) };
    }
    if (state.followUpStep === 3) {
      state.followUpPhase = "closed";
      return { message: buildWatchfulIndividualResponse(trimmed, state) };
    }
    state.followUpPhase = "closed";
    return { message: buildFollowClosingMessage() };
  }

  if (jt === "A_HOSPITAL") {
    if (isDecline(trimmed)) {
      state.followUpPhase = "closed";
      return { message: buildFollowClosingMessage() };
    }
    if (isRedChoiceBoth(trimmed)) {
      state.followUpPhase = "closed";
      const actions = buildRedPrepareBlock(state);
      const englishPart = buildCommunicationScriptEnglishPart(state);
      return { message: `${actions}\n\n${englishPart}` };
    }
    if (isRedChoicePrepare(trimmed)) {
      state.followUpPhase = "closed";
      return { message: buildRedPrepareBlock(state) };
    }
    if (isRedChoiceEnglish(trimmed)) {
      state.followUpPhase = "closed";
      return { message: buildCommunicationScript(state) };
    }
    return { message: "どちらにしますか？「整理」か「英語」か、どちらか教えてください。" };
  }

  state.followUpPhase = "closed";
  return { message: buildFollowClosingMessage() };
}

function extractOptionsFromAssistant(text) {
  const options = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^[\s　]*[•・]\s*(.+)$/);
    if (match && match[1]) {
      options.push(match[1].trim());
    }
    if (options.length >= 3) {
      break;
    }
  }
  if (options.length >= 2) {
    return options;
  }
  const lastLine = [...(text || "").split("\n")].reverse().find((line) => line.trim());
  const orMatch = (lastLine || "").match(/(.+?)\s*or\s*(.+?)[？?]?\s*$/);
  if (orMatch) {
    return [orMatch[1].trim(), orMatch[2].trim()];
  }
  return [];
}

function isQuestionResponse(text) {
  return extractOptionsFromAssistant(text).length >= 2;
}

function containsQuestionPhaseForbidden(text) {
  const forbiddenPatterns = [
    /おすすめ|様子見|市販薬|病院|受診|医療機関/,
    /休む|水分|運動|食事|温める|冷やす/,
    /原因|かもしれません|可能性/,
    /どう思いますか|どうしますか|感じますか/,
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(text || ""));
}

function detectQuestionType(text) {
  const normalized = (text || "").replace(/\s+/g, "");
  if (normalized.match(/1から10|10点満点|何点/)) {
    return "pain_score";
  }
  if (normalized.match(/さっきより楽|変わらない|悪化/)) {
    return "worsening";
  }
  if (normalized.match(/いつから|どのくらい前|何時間前|経過時間/)) {
    return "duration";
  }
  if (normalized.match(/日常生活|眠れない|動ける|支障|仕事|学校|活動/)) {
    return "daily_impact";
  }
  if (normalized.match(/発熱|熱|吐き気|嘔吐|しびれ|めまい|ふらつき|これ以外の症状/)) {
    return "associated_symptoms";
  }
  if (normalized.match(/原因|きっかけ|思い当たる|普段と違う|カテゴリ/)) {
    return "cause_category";
  }
  if (normalized.match(/方向性|回復に向か|変わらない|悪化している/)) {
    return "worsening_trend";
  }
  return "other";
}

const SLOT_KEYS = [
  "pain_score",
  "worsening",
  "duration",
  "daily_impact",
  "associated_symptoms",
  "cause_category",
  "worsening_trend",
];

const CONDITIONAL_SLOT_WORSENING_TREND = "worsening_trend";

const SLOT_STATUS_KEY_MAP = {
  pain_score: "severity",
  worsening: "worsening",
  duration: "duration",
  daily_impact: "impact",
  associated_symptoms: "associated",
  cause_category: "cause_category",
  worsening_trend: "worsening_trend",
};

const STATUS_KEY_TO_SLOT = {
  severity: "pain_score",
  worsening: "worsening",
  duration: "duration",
  impact: "daily_impact",
  associated: "associated_symptoms",
  cause_category: "cause_category",
  worsening_trend: "worsening_trend",
};

const FIXED_SLOT_ORDER = [
  "pain_score",
  "worsening",
  "duration",
  "daily_impact",
  "associated_symptoms",
  "cause_category",
];

function isDurationDayOrMore(state) {
  const durationRaw = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  const selectedIndex = state?.durationMeta?.selectedIndex;
  if (selectedIndex === 2) return true;
  return /(昨日|一日前|数日|ずっと|前から|一昨日|三日前|二日前|数日前|\d+日前|一日以上)/.test(durationRaw);
}

/** さっき以外（数時間前・半日・昨日・一日以上前など）なら true。悪化傾向質問の挿入条件 */
function isDurationNotJustNow(state) {
  const durationRaw = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  if (!durationRaw) return false;
  if (/(さっき|今さっき|たった今)/.test(durationRaw)) return false;
  return true;
}

function getSlotOrderWithConditional(state) {
  let base = [...FIXED_SLOT_ORDER];
  if (isDurationNotJustNow(state)) {
    const durationIdx = base.indexOf("duration");
    if (durationIdx >= 0 && !base.includes(CONDITIONAL_SLOT_WORSENING_TREND)) {
      base.splice(durationIdx + 1, 0, CONDITIONAL_SLOT_WORSENING_TREND);
    }
  }
  const category = state?.triageCategory || "PAIN";
  if (category === "SKIN") {
    base = base.filter((k) => k !== "cause_category");
  }
  if (category === "GI" || category === "PAIN") {
    base = base.filter((k) => k !== "daily_impact");
  }
  if (category === "PAIN" || category === "INFECTION") {
    const idx4 = base.indexOf("daily_impact");
    const idx5 = base.indexOf("associated_symptoms");
    if (idx4 >= 0 && idx5 >= 0) {
      base[idx4] = "associated_symptoms";
      base[idx5] = "daily_impact";
    }
  }
  return base;
}

const RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};

/**
 * selectedIndex とリスクの対応（集計・正規化で共通）。
 * UI は options を上から順に表示するため、必ず index 0=最も軽い・低リスク、1=中、2=高。
 */
const SLOT_RISK_BY_INDEX = {
  worsening: [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH],
  duration: [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH],
  daily_impact: [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH],
  associated_symptoms: [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH],
  cause_category: [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH],
  worsening_trend: [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH],
};

const SUBJECTIVE_ALERT_WORDS = ["気になります", "引っかかります", "心配です", "注意が必要です"];

function riskFromPainScore(rawScore) {
  if (rawScore === null || rawScore === undefined) return RISK_LEVELS.MEDIUM;
  if (rawScore >= 7) return RISK_LEVELS.HIGH;
  if (rawScore >= 5) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
}

function normalizePainScoreInput(input) {
  const normalizedText = String(input || "").replace(/[０-９]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30)
  );
  const digits = normalizedText.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1) return null;
  return Math.min(parsed, 10);
}

function ensureSlotStatusShape(state) {
  if (!state) return;
  if (!state.slotStatus) state.slotStatus = {};
  for (const key of Object.values(SLOT_STATUS_KEY_MAP)) {
    if (!state.slotStatus[key]) {
      state.slotStatus[key] = { filled: false, value: null, source: null };
      continue;
    }
    if (!("value" in state.slotStatus[key])) {
      state.slotStatus[key].value = null;
    }
  }
}

function normalizeUserText(input) {
  const raw = String(input || "");
  const halfWidth = raw.replace(/[０-９]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30)
  );
  // ユーザー語は保持し、数値表記のみ補助的に正規化する
  return halfWidth;
}

function hasCorrectionIntent(text) {
  return /(やっぱ|やはり|訂正|正しくは|違う|いや|前の|さっきの|言い直|むしろ|実は|訂正します|追加で|付け加え|言い忘れ|訂正:)/.test(
    String(text || "")
  );
}

function extractSeverityFromText(text) {
  const normalized = normalizeUserText(text);
  const direct = normalized.match(/(?:^|[^\d])(10|[1-9])\s*(?:\/\s*10|点|くらい|ぐらい)?(?:$|[^\d])/);
  let score = direct ? Number(direct[1]) : null;
  let rawOut = direct ? direct[0].trim() : null;
  if (!Number.isFinite(score)) {
    const tenScale = normalized.match(/(?:10\s*点\s*満点|10点満点|10\s*段階)[でのはが]*\s*([1-9]|10)(?:\s*点)?/);
    if (tenScale) {
      score = Number(tenScale[1]);
      rawOut = tenScale[0].trim();
    }
  }
  if (!Number.isFinite(score)) {
    const parsed = normalizePainScoreInput(normalized);
    if (parsed !== null && normalized.length <= 12) score = parsed;
    if (Number.isFinite(score) && !rawOut) rawOut = String(score);
  }
  // 数字が無いときのみ、痛みの強さを明言している場合に限りスコア化（曖昧なら拾わない）
  if (!Number.isFinite(score)) {
    const hi = /(激痛|痛みが強い|痛みがつよい|かなりつらい|とても痛い|かなり痛い|我慢できない|痛くてたまらない|痛みで眠れない)/.exec(normalized);
    const lo = /(少し痛い|軽い痛み|軽度|ちょっと痛い|痛みは軽い|たまに痛む)/.exec(normalized);
    const mid = /(中くらい|まあまあ|普通くらい|どちらとも言えず|半々|中程度)/.exec(normalized);
    if (hi) {
      score = 8;
      rawOut = hi[0];
    } else if (lo) {
      score = 3;
      rawOut = lo[0];
    } else if (mid) {
      score = 5;
      rawOut = mid[0];
    }
  }
  if (!Number.isFinite(score)) return null;
  if (!rawOut) rawOut = String(score);
  return {
    raw: rawOut,
    score: Math.max(1, Math.min(10, score)),
  };
}

/** ②痛み方・質（ズキズキ等）のみ。痛みの変化・トレンド（段々／悪化傾向）は③.５ worsening_trend で扱う。 */
function extractWorseningFromText(text) {
  const normalized = normalizeUserText(text);
  const rawText = String(text || "").trim();

  const qualityWords = [
    "ズキズキ",
    "キリキリ",
    "チクチク",
    "ジンジン",
    "ピリピリ",
    "ヒリヒリ",
    "ズキッ",
    "しみる",
    "張る感じ",
    "締め付けられる感じ",
    "締め付け",
    "鈍い",
    "重い",
    "刺す",
    "刺すような",
    "電気が走る",
    "脈打つ",
    "焼ける",
    "つる",
    "ガンガン",
    "広がる",
    "響く",
    "打つ",
    "重だるい",
  ];
  const quality = qualityWords.find((w) => normalized.includes(w)) || null;
  if (!quality) return null;

  return { trend: null, quality, raw: quality, selectedIndex: null };
}

function mapWorseningToOptionIndex(worsening, category) {
  if (!worsening) return 1;
  const options = buildPainQualityOptions(category || "other");
  const quality = String(worsening.quality || "").trim();
  if (quality) {
    const exact = options.findIndex((opt) => opt.includes(quality) || quality.includes(opt));
    if (exact >= 0) return exact;
  }
  return 1;
}

/**
 * ③経過時間（スポンタニアス抽出）。悪化傾向③.５とは別スロット。
 * 短い時間ほど先に判定。以下をこの関数内でまとめて扱う:
 * (1) 極短: さっき・数分
 * (2) 時間: N時間・数時間・今朝/昨夜（単独）
 * (3) 「〇〇日／週／月 … 続いている」系: 数値+単位+続く、日間+続、半日+続（先ほど仕様の続く系はすべてここ）
 * (4) 数値+日／日前（続くを含まない表現）
 * (5) 起点: 昨夜から／食べてから 等
 * (6) ここ数日／この1週間／しばらく／最近
 * (7) 先週から／先月から 等
 * (8) 昨日・数日・ずっと 等
 */
function extractDurationFromText(text) {
  const rawText = String(text || "");
  const normalized = normalizeUserText(rawText);

  // (1) 極短
  const shortRaw =
    (rawText.match(/(さっき|今さっき|数分|数十分)/) || [])[0] ||
    (normalized.match(/(さっき|今さっき|数分|数十分)/) || [])[0];
  if (shortRaw) {
    const raw = shortRaw || "さっき";
    return { raw_text: raw, normalized: "short", selectedIndex: 0 };
  }

  // (2) 時間
  const hRaw = rawText.match(/(\d+\s*時間(?:前)?)/);
  const hNorm = normalized.match(/(\d+)\s*時間前/);
  if (hRaw || hNorm) {
    const raw = hRaw ? hRaw[1] : `${hNorm[1]}時間前`;
    const hValue = Number((hNorm && hNorm[1]) || (hRaw && hRaw[1].match(/(\d+)/)?.[1]) || NaN);
    return { raw_text: raw, normalized: Number.isFinite(hValue) ? `${hValue}h_ago` : "hours", selectedIndex: 1 };
  }
  if (/(数時間|今朝|昨夜)/.test(normalized)) {
    const raw =
      (rawText.match(/(数時間|今朝|昨夜)/) || [])[0] ||
      (normalized.match(/(数時間|今朝|昨夜)/) || [])[0] ||
      "数時間前";
    return { raw_text: raw, normalized: "hours", selectedIndex: 1 };
  }

  // (3) 「〇〇日／週／月 … 続いている」系（続く・経つ・続く を伴う経過）。※③.５悪化傾向ではない。
  if (
    /(?:\d+\s*週間|\d+\s*ヶ月|\d+\s*カ月|1週間|2週間|3週間|4週間|数週間|数ヶ月|数カ月)/.test(normalized) &&
    /続い|経っ|続く/.test(normalized)
  ) {
    const raw =
      (rawText.match(/\d+\s*週間|\d+\s*ヶ月|\d+\s*カ月|1週間|2週間|3週間|4週間|数週間|数ヶ月|数カ月/) || [])[0] ||
      (normalized.match(/\d+\s*週間|\d+\s*ヶ月|\d+\s*カ月|1週間|2週間|3週間|4週間|数週間|数ヶ月|数カ月/) || [])[0] ||
      "1週間";
    return { raw_text: raw.trim(), normalized: "day_or_more", selectedIndex: 2 };
  }
  if (/\d+\s*日間(?:も)?(?:続い|経っ)/.test(normalized)) {
    const mFull =
      normalized.match(/\d+\s*日間\s*続いている/) ||
      normalized.match(/\d+\s*日間\s*続いて/);
    const m = rawText.match(/\d+\s*日間/) || normalized.match(/\d+\s*日間/);
    const raw = mFull ? mFull[0].trim() : m ? m[0] : "数日";
    return { raw_text: raw, normalized: "day_or_more", selectedIndex: 2 };
  }
  if (/半日(?:も)?(?:続い|経っ)/.test(normalized)) {
    return { raw_text: "半日", normalized: "hours", selectedIndex: 1 };
  }
  if (/\d+\s*日(?:も)?(?:続い|経っ|続く)/.test(normalized)) {
    const m = rawText.match(/\d+\s*日/) || normalized.match(/\d+\s*日/);
    return { raw_text: (m && m[0]) || "数日", normalized: "day_or_more", selectedIndex: 2 };
  }

  // (4) 数値+日／日前（続くが無い文でも「3日」「3日前」等）
  const dRaw = rawText.match(/(\d+\s*日(?:前)?)/);
  const dNorm = normalized.match(/(\d+)\s*日前/);
  if (dRaw || dNorm) {
    const raw = dRaw ? dRaw[1] : `${dNorm[1]}日前`;
    const dValue = Number((dNorm && dNorm[1]) || (dRaw && dRaw[1].match(/(\d+)/)?.[1]) || NaN);
    return { raw_text: raw, normalized: Number.isFinite(dValue) ? `${dValue}d_ago` : "day_or_more", selectedIndex: 2 };
  }

  // (5) 起点（昨夜から／食べてから …）
  if (/(昨夜から|昨晩から|今朝から|今朝方から|夕方から|起きてから|出かけてから|食べてから|飲んでから)/.test(normalized)) {
    const m =
      rawText.match(/昨夜から|昨晩から|今朝から|今朝方から|夕方から|起きてから|出かけてから|食べてから|飲んでから/) || [];
    return { raw_text: m[0] || "今朝から", normalized: "hours", selectedIndex: 1 };
  }

  // (6) ここ数日／この1週間／しばらく／最近
  if (/(ここ|この)(?:数日|数週間|数ヶ月|数カ月|一週間|１週間|1週間|2週間|3週間|何日か|しばらく|最近)/.test(normalized)) {
    const raw =
      (rawText.match(/(ここ|この)(?:数日|数週間|数ヶ月|数カ月|一週間|１週間|1週間|2週間|3週間|何日か|しばらく|最近)/) || [])[0] ||
      "数日";
    return { raw_text: raw, normalized: "day_or_more", selectedIndex: 2 };
  }

  // (7) 先週から／先月から 等
  if (/(先週から|先月から|去年から|一昨日から|おとといから)/.test(normalized)) {
    const m =
      rawText.match(/先週から|先月から|去年から|一昨日から|おとといから/) || [];
    return { raw_text: m[0] || "先週から", normalized: "day_or_more", selectedIndex: 2 };
  }

  // (8) 昨日・数日・ずっと 等
  if (/(昨日|一日前|数日|ずっと|前から|一昨日|三日前|二日前|数日前|〇日前)/.test(normalized)) {
    const raw =
      (rawText.match(/(昨日|一日前|数日|ずっと|前から|一昨日|三日前|二日前|数日前|\d+日前)/) || [])[0] ||
      (normalized.match(/(昨日|一日前|数日|ずっと|前から|一昨日|三日前|二日前|数日前|\d+日前)/) || [])[0] ||
      "一日以上前";
    return { raw_text: raw, normalized: "day_or_more", selectedIndex: 2 };
  }
  return null;
}

function extractImpactFromText(text) {
  const rawText = String(text || "").trim();
  const normalized = normalizeUserText(text);
  const pickRaw = (re, fallback = rawText) => {
    const m = String(text || "").match(re);
    return (m && m[0] ? m[0] : fallback).trim();
  };
  if (
    /仕事できない|学校休んだ|寝込|動けない|家事できない|集中できないほど|出勤できない|出社できない|外出できない|運転できない|立ち上がれない|歩けない|階段がつらい|話すのもつらい|寝られない|眠れない|食欲がない|食べられない|授業を休んだ|会議を休んだ/.test(
      normalized
    )
  ) {
    return {
      raw: pickRaw(
        /仕事できない|学校休んだ|寝込んでる|動けない|家事できない|集中できないほど|出勤できない|出社できない|外出できない|運転できない|立ち上がれない|歩けない|階段がつらい|話すのもつらい|寝られない|眠れない|食欲がない|食べられない|授業を休んだ|会議を休んだ/,
        rawText || normalized
      ),
      selectedIndex: 2,
    };
  }
  if (
    /動けるけどつらい|少しつらいが動ける|無理すれば|つらいけど|だいたい動ける|我慢すれば生活はできる|仕事はしてる/.test(normalized)
  ) {
    return {
      raw: pickRaw(
        /動けるけどつらい|少しつらいが動ける|無理すれば|つらいけど|だいたい動ける|我慢すれば生活はできる|仕事はしてる/,
        rawText || normalized
      ),
      selectedIndex: 1,
    };
  }
  if (/普通に生活できる|普通に動ける|問題なく動ける|特に支障はない|日常生活は問題ない/.test(normalized)) {
    return {
      raw: pickRaw(/普通に生活できる|普通に動ける|問題なく動ける|特に支障はない|日常生活は問題ない/, rawText || normalized),
      selectedIndex: 0,
    };
  }
  return null;
}

function extractAssociatedSymptoms(text) {
  const rawText = String(text || "").trim();
  const normalized = normalizeUserText(text);
  if (/^(ない|なし|ありません|ないです|特にないです|特にありません)[。!！\s]*$/i.test(rawText)) {
    return {
      primary: null,
      associated: [],
      raw: rawText || "ない",
      selectedIndex: 0,
    };
  }
  if (/これ以外は特にない|他はない|特にない|なし|わからない|分からない|不明/.test(normalized)) {
    const m = rawText.match(/これ以外は特にない|他はない|特にない|なし|わからない|分からない|不明/);
    return { primary: null, associated: [], raw: (m && m[0]) || rawText || "これ以外は特にない", selectedIndex: 0 };
  }
  const terms = [
    "下痢", "腹痛", "頭痛", "吐き気", "嘔吐", "めまい", "発熱", "熱", "咳", "鼻水", "鼻づまり",
    "のど", "喉", "しびれ", "視界異常", "耳鳴り", "だるい", "倦怠感", "ピクピク", "ゴロゴロ",
    "動悸", "息苦しい", "胸痛", "胸が痛い", "腰痛", "関節痛", "関節", "蕁麻疹", "赤み", "腫れ", "くしゃみ",
    "血便", "吐血", "冷や汗", "脱水", "嗅覚", "味覚", "体が重い", "寒気", "震え", "意識がもうろう",
  ];
  const found = [];
  for (const term of terms) {
    const idx = normalized.indexOf(term);
    if (idx >= 0) found.push({ term, idx });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.idx - b.idx);
  const unique = [...new Set(found.map((f) => f.term))];
  const primary = unique[0] || null;
  const associated = unique.slice(1);
  const high = /(しびれ|視界異常|意識|失神)/.test(normalized);
  const selectedIndex = high ? 2 : 1;
  const matchedInRaw = [];
  for (const term of unique) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const m = rawText.match(re);
    matchedInRaw.push((m && m[0]) || term);
  }
  const raw = rawText.length > 0 ? rawText : matchedInRaw.join("、");
  return { primary, associated, raw, selectedIndex };
}

function extractCauseCategory(text) {
  const rawText = String(text || "").trim();
  const normalized = normalizeUserText(text);
  if (/思い当たらない|わからない|分からない|不明/.test(normalized)) {
    const m = rawText.match(/思い当たらない|わからない|分からない|不明/);
    return { raw: (m && m[0]) || rawText || normalized, selectedIndex: 0 };
  }
  const causeKeywords =
    "食あたり|寝不足|ストレス|ぶつけ|冷房|冷え|ブルーライト|感染|花粉|飲酒|過労|疲れ|人混み|仕事|アレルギー|日焼け|虫刺され|虫に刺された|ケガ|転倒|転んだ|ウイルス|風邪|薬|副作用|ワクチン|生理|妊娠|ペット|猫|犬|運動|飲み過ぎ|睡眠|長時間|同じ姿勢|かぶれ|湿疹";
  const mRaw = rawText.match(
    new RegExp(`([^。！？\\n]{0,28}(${causeKeywords})[^。！？\\n]{0,28})`)
  );
  const m = normalized.match(
    new RegExp(`([^。！？\\n]{0,28}(${causeKeywords})[^。！？\\n]{0,28})`)
  );
  if (m) {
    return { raw: ((mRaw && mRaw[1]) || m[1] || rawText).trim(), selectedIndex: 1 };
  }
  if (/(かも|と思う|かもしれない)/.test(normalized) && normalized.length <= 30) {
    return { raw: rawText || normalized.trim(), selectedIndex: 2 };
  }
  return null;
}

/** ③.５ 悪化傾向（痛みの変化・トレンド）。②worsening（痛み方）とは分離。 */
function extractWorseningTrendFromText(text) {
  const rawText = String(text || "").trim();
  const normalized = normalizeUserText(text);
  const notImprovement = !/良くな|まし|和らい|楽になっ|改善|回復|落ち着いてきた|落ち着い|軽くなっ/.test(
    normalized
  );

  // 段々／だんだん／どんどん＋悪化・痛み・つらさ等（改善の文は除外。楽に単独は使わない）
  if (
    notImprovement &&
    /(段々|だんだん|どんどん)(?:と)?[^。！？]{0,40}(悪|痛|つら|ひどい|ひどく|強く|悪化|つらく|痛く|悪くな)/.test(
      normalized
    )
  ) {
    const m =
      rawText.match(/(段々|だんだん|どんどん)(?:と)?[^。！？]{0,40}/) ||
      normalized.match(/(段々|だんだん|どんどん)(?:と)?[^。！？]{0,40}/);
    return { raw: (m && m[0]) || "段々悪化", selectedIndex: 2 };
  }
  if (/悪くなって/.test(normalized) && !/良くなって/.test(normalized) && notImprovement) {
    const m = rawText.match(/悪くなって[^。！？]{0,24}/) || rawText.match(/悪くなって/);
    return { raw: (m && m[0]) || "悪くなって", selectedIndex: 2 };
  }
  // 「悪化している」と「悪化が続いている」は別表現（後者は「悪化している」単純一致しない）
  if (/悪化が続いている|悪化は続いている/.test(normalized)) {
    const m = rawText.match(/悪化が続いている[^。！？]*|悪化は続いている[^。！？]*/);
    return { raw: (m && m[0]) || "悪化が続いている", selectedIndex: 2 };
  }
  if (/(徐々に悪化|少しずつ悪化|ますます悪化|悪くなってきた|ますますひどく)/.test(normalized)) {
    const m = rawText.match(/(徐々に悪化|少しずつ悪化|ますます悪化|悪くなってきた|ますますひどく)[^。！？]*/);
    return { raw: (m && m[0]) || "徐々に悪化", selectedIndex: 2 };
  }
  if (/(発症時より悪化|悪化している|ひどくなって|悪化してきた)/.test(normalized)) {
    const m = rawText.match(/(発症時より悪化|悪化している|ひどくなって|悪化してきた)[^。！？]*/);
    return { raw: (m && m[0]) || "発症時より悪化している", selectedIndex: 2 };
  }
  if (/(変わらない|横ばい|同じ|変化なし|悪くも良くも|一進一退|良くなったり悪くなったり)/.test(normalized)) {
    const m = rawText.match(/(変わらない|横ばい|同じ|変化なし|悪くも良くも|一進一退|良くなったり悪くなったり)/);
    return { raw: (m && m[0]) || "変わらない", selectedIndex: 1 };
  }
  if (/(改善してきた|落ち着いてきた|回復に向か|良くなって|ましになって|楽になって|改善して)/.test(normalized)) {
    const m = rawText.match(
      /(改善してきた|落ち着いてきた|回復に向か[^。！？]*|良くなって[^。！？]*|ましになって[^。！？]*|楽になって[^。！？]*|改善して[^。！？]*)/
    );
    return { raw: (m && m[0]) || "回復に向かっている", selectedIndex: 0 };
  }
  return null;
}

function markSlotStatus(state, slotKey, source, value = null) {
  if (!state || !slotKey) return;
  ensureSlotStatusShape(state);
  const statusKey = SLOT_STATUS_KEY_MAP[slotKey];
  if (!statusKey) return;
  const current = state.slotStatus[statusKey] || { filled: false, value: null, source: null };
  const nextValue = value !== null && value !== undefined && String(value).trim() !== ""
    ? String(value).trim()
    : current.value;
  state.slotStatus[statusKey] = {
    filled: true,
    value: nextValue,
    source: current.source || source || null,
  };
}

function setSlotFromSpontaneous(state, slotKey, payload = {}) {
  if (!state || !slotKey) return false;
  const allowOverwrite = !!payload.allowOverwrite;
  if (state.slotFilled?.[slotKey] && !allowOverwrite) return false;
  const { rawAnswer = "", selectedIndex = null, riskLevel = null, rawScore = null } = payload;
  state.slotFilled[slotKey] = true;
  state.slotAnswers[slotKey] = rawAnswer || state.slotAnswers[slotKey] || "";
  let normalized = null;
  if (slotKey === "pain_score") {
    normalized = buildNormalizedAnswer(slotKey, rawAnswer || String(rawScore ?? ""), 0, rawScore);
    const weight = rawScore >= 7 ? 2.0 : rawScore >= 5 ? 1.5 : 1.0;
    if (Number.isFinite(rawScore)) {
      updatePainScoreState(state, rawScore, weight, rawAnswer || String(rawScore));
    }
  } else if (selectedIndex !== null && selectedIndex !== undefined) {
    normalized = buildNormalizedAnswer(slotKey, rawAnswer, selectedIndex);
  } else if (riskLevel) {
    normalized = { slotId: slotKey, rawAnswer, riskLevel };
  }
  if (normalized) {
    state.slotNormalized[slotKey] = normalized;
    state.lastNormalizedAnswer = normalized;
  }
  markSlotStatus(state, slotKey, "user_spontaneous", rawAnswer);
  state.confidence = computeConfidenceFromSlots(state.slotFilled, state);
  return true;
}

function applySpontaneousSlotFill(state, message, opts = {}) {
  if (!state) return 0;
  const { isFirstMessage = false } = opts;
  const text = normalizeUserText(message);
  if (!text) return 0;
  ensureSlotStatusShape(state);
  const symptomType = detectSymptomCategory(text);
  let added = 0;
  const correction = hasCorrectionIntent(text);

  // 特例: 痛みの強さは Kairo が質問したターン以降のみ自発抽出で埋める（質問前に言及があっても未質問扱い）
  const severity = extractSeverityFromText(text);
  if (
    severity &&
    state.askedSlots?.pain_score === true &&
    setSlotFromSpontaneous(state, "pain_score", {
      rawAnswer: severity.raw,
      rawScore: severity.score,
      allowOverwrite: correction,
    })
  ) {
    added += 1;
  }

  const worsening = extractWorseningFromText(text);
  const worseningIndex = mapWorseningToOptionIndex(worsening, symptomType);
  if (worsening && setSlotFromSpontaneous(state, "worsening", {
    rawAnswer: worsening.raw,
    selectedIndex: worseningIndex,
    allowOverwrite: correction,
  })) {
    state.worseningMeta = {
      trend: worsening.trend || null,
      quality: worsening.quality || null,
    };
    added += 1;
  }

  const duration = extractDurationFromText(text);
  if (duration && setSlotFromSpontaneous(state, "duration", {
    rawAnswer: duration.raw_text,
    selectedIndex: duration.selectedIndex,
    allowOverwrite: correction,
  })) {
    state.durationMeta = {
      raw_text: duration.raw_text,
      normalized: duration.normalized,
    };
    added += 1;
  }

  const impact = extractImpactFromText(text);
  if (impact && setSlotFromSpontaneous(state, "daily_impact", {
    rawAnswer: impact.raw,
    selectedIndex: impact.selectedIndex,
    allowOverwrite: correction,
  })) {
    added += 1;
  }

  const associated = extractAssociatedSymptoms(text);
  if (associated) {
    if (!state.primarySymptom && associated.primary) {
      state.primarySymptom = associated.primary;
    } else if (!state.primarySymptom && symptomType && symptomType !== "other") {
      state.primarySymptom = symptomType;
    }
    // PAIN/INFECTION は4問目（付随症状）を必ず出す。主症状語（喉・熱など）が extract に誤マッチしてスロットが埋まると質問が出ない（KAIRO_SPEC 7.1.1）。
    const skipAssocSpontaneous =
      (state.triageCategory === "PAIN" || state.triageCategory === "INFECTION") && !correction;
    if (
      !skipAssocSpontaneous &&
      setSlotFromSpontaneous(state, "associated_symptoms", {
        rawAnswer: associated.raw,
        selectedIndex: associated.selectedIndex,
        allowOverwrite: correction,
      })
    ) {
      state.associatedSymptoms = associated.associated || [];
      if (isFirstMessage) {
        state.associatedSymptomsFromFirstMessage = true;
      }
      if (textImpliesFeverForInfectionTriage(String(associated.raw || ""))) {
        state.triageCategory = "INFECTION";
      }
      added += 1;
    }
  }

  const cause = extractCauseCategory(text);
  if (cause && setSlotFromSpontaneous(state, "cause_category", {
    rawAnswer: cause.raw,
    selectedIndex: cause.selectedIndex,
    allowOverwrite: correction,
  })) {
    added += 1;
  }

  if (isDurationNotJustNow(state)) {
    const trend = extractWorseningTrendFromText(text);
    if (trend && setSlotFromSpontaneous(state, "worsening_trend", {
      rawAnswer: trend.raw,
      selectedIndex: trend.selectedIndex,
      allowOverwrite: correction,
    })) {
      added += 1;
    }
  }

  return added;
}

function updatePainScoreState(state, rawScore, weight, rawAnswer) {
  if (!state) return;
  if (rawScore === null || rawScore === undefined) {
    return;
  }
  state.lastPainScore = rawScore;
  state.lastPainWeight = weight ?? state.lastPainWeight ?? 1.5;
  if (!state.slotFilled.pain_score) {
    state.slotFilled.pain_score = true;
  }
  const normalized =
    state.slotNormalized.pain_score ||
    buildNormalizedAnswer("pain_score", rawAnswer ?? String(rawScore), 0, rawScore) || {
      slotId: "pain_score",
      rawAnswer: rawAnswer ?? String(rawScore),
      riskLevel: RISK_LEVELS.MEDIUM,
    };
  state.slotNormalized.pain_score = normalized;
  state.lastNormalizedAnswer = normalized;
  markSlotStatus(state, "pain_score", "question_response", rawAnswer ?? String(rawScore));
}

/** 痛みの強さは未回答のまま lastPainScore を立てない（finalize 用のダミー埋めはしない） */
function ensurePainScoreFallback(state) {
  if (!state) return;
  if (Number.isFinite(state.lastPainScore)) return;
}

function finalizeRiskLevel(state) {
  if (!state) return "🟡";
  if (state.decisionLevel) return state.decisionLevel;
  ensurePainScoreFallback(state);
  const computed = calculateRiskFromState(state);
  state.decisionLevel = computed.level;
  state.decisionRatio = computed.ratio;
  return computed.level;
}

function buildNormalizedAnswer(slotId, rawAnswer, selectedIndex, rawScore) {
  if (!slotId) return null;
  if (slotId === "pain_score") {
    const riskLevel = riskFromPainScore(rawScore);
    if (!riskLevel) return null;
    return { slotId, rawAnswer: rawAnswer ?? "", riskLevel };
  }
  const riskMap = SLOT_RISK_BY_INDEX[slotId];
  if (!riskMap || selectedIndex === null || selectedIndex === undefined) return null;
  const riskLevel = riskMap[selectedIndex];
  if (!riskLevel) return null;
  return { slotId, rawAnswer: rawAnswer ?? "", riskLevel };
}

function countAskedSlots(askedSlots) {
  return SLOT_KEYS.filter((key) => askedSlots && askedSlots[key]).length;
}

function countFilledSlots(slotFilled, state = null) {
  const order = state ? getSlotOrderWithConditional(state) : SLOT_KEYS;
  return order.filter((key) => slotFilled && slotFilled[key]).length;
}

function getRequiredSlotCount(state) {
  return getSlotOrderWithConditional(state).length;
}

function computeConfidenceFromSlots(slotFilled, state = null) {
  const order = state ? getSlotOrderWithConditional(state) : SLOT_KEYS;
  const filled = order.filter((key) => slotFilled && slotFilled[key]).length;
  return Math.round((filled / order.length) * 100);
}

function getMissingSlots(slotFilled, state = null) {
  const order = state ? getSlotOrderWithConditional(state) : SLOT_KEYS;
  return order.filter((key) => !slotFilled || !slotFilled[key]);
}

/** 痛みの強さ: Kairo が質問し、ユーザーが回答して初めて「埋まった」とみなす（特例） */
function isPainScoreSlotAnswered(state) {
  if (!state) return false;
  const hasValue = (v) => v != null && String(v).trim().length > 0;
  return (
    state.askedSlots?.pain_score === true &&
    state.slotFilled?.pain_score === true &&
    Number.isFinite(state.lastPainScore) &&
    (hasValue(state.slotAnswers?.pain_score) || hasValue(state.slotStatus?.severity?.value))
  );
}

/** PAIN かつ痛みの強さが未回答なら、他スロットが埋まっていても必ず痛みの強さを先に聞く */
function mustAskPainScoreBeforeOtherSlots(state) {
  if (!state) return false;
  const cat = state.triageCategory || resolveQuestionCategoryFromState(state) || "PAIN";
  if (cat !== "PAIN") return false;
  const order = getSlotOrderWithConditional(state);
  if (!order.includes("pain_score")) return false;
  return !isPainScoreSlotAnswered(state);
}

/** slotFilled と slotAnswers/slotStatus の整合性を保ち、不正な埋まりを解除する */
function ensureSlotFilledConsistency(state) {
  if (!state || !state.slotFilled) return;
  ensureSlotStatusShape(state);
  const hasValue = (v) => v != null && String(v).trim().length > 0;
  for (const slotKey of SLOT_KEYS) {
    if (slotKey === "worsening_trend" && !isDurationNotJustNow(state)) {
      state.slotFilled[slotKey] = false;
      if (state.slotStatus?.worsening_trend) {
        state.slotStatus.worsening_trend.filled = false;
        state.slotStatus.worsening_trend.value = null;
      }
      continue;
    }
    if (slotKey === "pain_score") {
      const isValid =
        Number.isFinite(state.lastPainScore) &&
        state.askedSlots?.pain_score === true &&
        (hasValue(state.slotAnswers?.pain_score) || hasValue(state.slotStatus?.severity?.value));
      if (!isValid) {
        state.slotFilled.pain_score = false;
        state.lastPainScore = null;
        state.lastPainWeight = null;
        if (state.slotAnswers) state.slotAnswers.pain_score = "";
        if (state.slotNormalized) state.slotNormalized.pain_score = null;
        if (state.slotStatus?.severity) {
          state.slotStatus.severity.filled = false;
          state.slotStatus.severity.value = null;
        }
      }
      continue;
    }
    const statusKey = SLOT_STATUS_KEY_MAP[slotKey];
    const rawAnswer = state.slotAnswers?.[slotKey];
    const statusVal = state.slotStatus?.[statusKey]?.value;
    const isValid = hasValue(rawAnswer) || hasValue(statusVal);
    if (state.slotFilled[slotKey] && !isValid) {
      state.slotFilled[slotKey] = false;
      if (state.slotStatus?.[statusKey]) {
        state.slotStatus[statusKey].filled = false;
        state.slotStatus[statusKey].value = null;
      }
    }
  }
}

function detectSymptomCategory(text) {
  const normalized = (text || "").replace(/\s+/g, "");
  if (normalized.match(/腹|お腹|胃|下痢|便秘|吐き気/)) return "stomach";
  if (normalized.match(/頭痛|頭が痛|頭が重|こめかみ|片頭痛/)) return "head";
  if (normalized.match(/喉|のど|咳|せき|鼻水|鼻づまり/)) return "throat";
  return "other";
}

const FIRST_QUESTION_SAFETY_TEMPLATES = [
  (symptom) => `慌てなくて大丈夫です。\n多くの${symptom}は命に関わるものではありません。\n一緒に安全を固めていきましょう。`,
  (symptom) => `まず安心してください。\n${symptom}のほとんどは深刻なものではありません。\nまず落ち着いて、ひとつずつ安全を確認していきましょう。`,
];

function toMainSymptomLabelForSafety(text) {
  const s = String(text || "").trim();
  if (/(頭が痛|頭痛|こめかみ|後頭部|頭が重)/.test(s)) return "頭痛";
  if (/(お腹が痛|腹痛|胃痛|みぞおち|下腹|下痢|便秘|吐き気|嘔吐)/.test(s)) return "腹痛";
  if (/(喉が痛|のどが痛|喉の痛み|咽頭痛|咳|せき)/.test(s)) return "喉の痛み";
  if (/(唇が痛|唇|口唇|ヒリヒリ|乾燥)/.test(s)) return "唇の痛み";
  if (/(発熱|熱|だるい|寒気)/.test(s)) return "体調不良";
  if (/(かゆい|赤い|発疹|水ぶくれ)/.test(s)) return "皮膚症状";
  return "症状";
}

const FIXED_QUESTIONS = {
  pain_score: {
    q: "今の痛みを、1から10であらわすと何点ですか？",
    options: [],
  },
  worsening: {
    q: "今の痛み方はどれに近いですか？",
    options: [],
  },
  duration: {
    q: "いつから始まりましたか\n・さっき\n・数時間前\n・一日以上前",
    options: ["さっき", "数時間前", "一日以上前"],
  },
  daily_impact: {
    q: "今の動ける感じはどれに近いですか？\n・普通に動ける\n・少しつらいが動ける\n・動けないほどつらい",
    options: ["普通に動ける", "少しつらいが動ける", "動けないほどつらい"],
  },
  associated_symptoms: {
    q: "これ以外の症状は他にありますか？",
    options: [],
  },
  cause_category: {
    q: "何かきっかけで思い当たることはありますか？\n・スマホやパソコンを長時間見た\n・寝不足や疲れが続いている\n・強いストレスや緊張があった",
    options: ["スマホやパソコンを長時間見た", "寝不足や疲れが続いている", "強いストレスや緊張があった"],
  },
  worsening_trend: {
    q: "今の方向性はどうですか？\n・回復に向かっている\n・変わらない\n・発症時より悪化している",
    options: ["回復に向かっている", "変わらない", "発症時より悪化している"],
  },
};

const TEMPLATE_ID_GROUPS = {
  EMPATHY_ONLY: [
    "TEMPLATE_EMPATHY_1",
    "TEMPLATE_EMPATHY_2",
    "TEMPLATE_EMPATHY_3",
  ],
  EMPATHY_PROGRESS_PURPOSE: [
    "EMPATHY_PROGRESS_PURPOSE_1",
    "EMPATHY_PROGRESS_PURPOSE_2",
    "EMPATHY_PROGRESS_PURPOSE_3",
    "EMPATHY_PROGRESS_PURPOSE_4",
    "EMPATHY_PROGRESS_PURPOSE_5",
    "EMPATHY_PROGRESS_PURPOSE_6",
    "EMPATHY_PROGRESS_PURPOSE_7",
  ],
  EMPATHY_PURPOSE: [
    "EMPATHY_PURPOSE_1",
    "EMPATHY_PURPOSE_2",
    "EMPATHY_PURPOSE_3",
    "EMPATHY_PURPOSE_4",
    "EMPATHY_PURPOSE_5",
    "EMPATHY_PURPOSE_6",
    "EMPATHY_PURPOSE_7",
  ],
};

const EMPATHY_OPEN_IDS = [
  "TEMPLATE_EMPATHY_1",
  "TEMPLATE_EMPATHY_2",
  "TEMPLATE_EMPATHY_3",
];

const EMPATHY_NEXT_IDS = [
  "EMPATHY_NEXT_1",
  "EMPATHY_NEXT_2",
  "EMPATHY_NEXT_3",
  "EMPATHY_NEXT_4",
  "EMPATHY_NEXT_5",
];

const PROGRESS_IDS = [
  "PROGRESS_1",
  "PROGRESS_2",
  "PROGRESS_3",
  "PROGRESS_4",
];

const FOCUS_IDS = [
  "FOCUS_1",
  "FOCUS_2",
  "FOCUS_3",
  "FOCUS_4",
  "FOCUS_5",
];



function buildFixedQuestion(slotKey, useFinalPrefix) {
  const prefix = useFinalPrefix ? "最後に、" : "";
  const selected = FIXED_QUESTIONS[slotKey] || FIXED_QUESTIONS.cause_category;
  return {
    question: `${prefix}${selected.q}`,
    options: selected.options,
    type: slotKey,
  };
}

function buildAssociatedSymptomsOptions(category) {
  const base = ["これ以外は特にない"];
  if (category === "stomach") {
    return base.concat(["吐き気がある", "発熱や強いだるさがある"]);
  }
  if (category === "head") {
    return base.concat(["吐き気やめまいがある", "しびれや視界の違和感がある"]);
  }
  if (category === "throat") {
    return base.concat(["発熱がある", "息苦しさや強い痛みがある"]);
  }
  return base.concat(["少し違和感がある", "強いだるさや発熱がある"]);
}

/** 痛み方・質（worsening）：上=軽めの印象・一般的、下=強い・注意が必要になりやすい、の順（SLOT_RISK_BY_INDEX と一致） */
function buildPainQualityOptions(category) {
  if (category === "stomach") {
    return ["張る感じ", "締め付けられる感じ", "キリキリする"];
  }
  if (category === "head") {
    return ["締め付けられる感じ", "重い感じ", "ズキズキする"];
  }
  if (category === "throat") {
    return ["ヒリヒリする", "ズキッとする", "しみる感じ"];
  }
  return ["チクチクする", "ズキズキする", "重だるい感じ"];
}

/** 喉・のどが主症状かどうか（喉が痛い、のどの違和感など） */
function isThroatMainSymptom(text) {
  if (!text || typeof text !== "string") return false;
  const n = String(text).replace(/\s+/g, "");
  return (
    /(喉|のど)(が|の)?(痛|違和|いたい|痛い|痛む|炎症|腫れ|腫れた|赤い|乾燥|カラカラ|イガイガ)/.test(n) ||
    /(咽頭痛|咽頭|扁桃|のどの痛み|喉の痛み|のどの違和感|喉の違和感|喉がひりひり|のどがひりひり|喉がゴロゴロ|のどがゴロゴロ)/.test(n)
  );
}

/** triage が INFECTION かつ主訴・履歴・スロットから喉主症状と判定できるとき */
function isThroatInfectionSession(state) {
  if (!state || state.triageCategory !== "INFECTION") return false;
  const t = [
    state.primarySymptom || "",
    state.historyTextForCare || "",
    state.slotAnswers?.pain_score || "",
    state.slotAnswers?.worsening || "",
    state.slotAnswers?.duration || "",
  ].join(" ");
  return isThroatMainSymptom(t);
}

function detectQuestionCategory4(text) {
  const normalized = (text || "").replace(/\s+/g, "");
  if (/(腹痛|お腹|下痢|吐き気|胃|嘔吐|便)/.test(normalized)) return "GI";
  if (/(熱|発熱|だるい|咳|せき|喉|のど|寒気|風邪)/.test(normalized)) return "INFECTION";
  if (/(ヒリヒリ|かゆい|赤い|発疹|唇|水ぶくれ|乾燥|口)/.test(normalized)) return "SKIN";
  if (/(頭痛|傷)/.test(normalized)) return "PAIN";
  return "PAIN";
}

function resolveLockedQuestionCategory(state, historyText = "") {
  if (state?.triageCategory) return state.triageCategory;
  const fromState = resolveQuestionCategoryFromState(state);
  if (fromState === "INFECTION" && state?.slotFilled?.associated_symptoms) {
    const as = String(state?.slotAnswers?.associated_symptoms || "");
    const hasFeverSignal = textImpliesFeverForInfectionTriage(as);
    const hasThroatInPrior = isThroatMainSymptom(
      [
        state?.primarySymptom || "",
        state?.slotAnswers?.pain_score || "",
        state?.slotAnswers?.duration || "",
        state?.slotAnswers?.worsening || "",
      ].join(" ")
    );
    const combinedWithoutAssociated = [
      state?.primarySymptom || "",
      state?.slotAnswers?.pain_score || "",
      state?.slotAnswers?.worsening || "",
      state?.slotAnswers?.duration || "",
      state?.slotAnswers?.daily_impact || "",
      state?.slotAnswers?.cause_category || "",
      state?.causeDetailText || "",
    ]
      .filter(Boolean)
      .join(" ");
    const infectionWithoutAssociated = detectQuestionCategory4(combinedWithoutAssociated) === "INFECTION";
    if (!hasFeverSignal && !hasThroatInPrior && !infectionWithoutAssociated) {
      state.triageCategory = "PAIN";
      return "PAIN";
    }
    state.triageCategory = "INFECTION";
    return "INFECTION";
  }
  if (fromState && fromState !== "INFECTION") {
    state.triageCategory = fromState;
    return fromState;
  }
  const detected = detectQuestionCategory4(historyText);
  // 喉が痛いなど、喉的なものが主症状の時は必ず初めからずっとINFECTION系にする
  if (isThroatMainSymptom(historyText)) {
    state.triageCategory = "INFECTION";
    return "INFECTION";
  }
  if (detected === "INFECTION") {
    state.triageCategory = "PAIN";
    return "PAIN";
  }
  state.triageCategory = detected || "PAIN";
  return state.triageCategory;
}

function getCategoryQuestionOverride(category, slotKey) {
  if (category === "PAIN") {
    if (slotKey === "cause_category") {
      return {
        question: "何かきっかけで思い当たることはありますか？",
        options: ["スマホやパソコンを長時間見た", "寝不足や疲れが続いている", "強いストレスや緊張があった"],
      };
    }
    return null;
  }
  if (category === "SKIN") {
    if (slotKey === "daily_impact") {
      return {
        question: "見た目の変化はありますか？",
        options: ["見た目はほとんど変わらない", "赤みや乾燥だけ", "水ぶくれ・ただれ・できもの"],
      };
    }
    if (slotKey === "associated_symptoms") {
      return {
        question: "思い当たるきっかけはありますか？",
        options: ["特に思い当たらない", "紫外線や乾燥が強かった", "新しい製品や刺激物を使った"],
      };
    }
  }
  if (category === "INFECTION") {
    if (slotKey === "daily_impact") {
      return {
        question: "体温はどのくらいですか？",
        options: ["平熱に近い", "37度台", "38度以上"],
      };
    }
    if (slotKey === "associated_symptoms") {
      return null;
    }
    if (slotKey === "cause_category") {
      return {
        question: "何かきっかけで思い当たることはありますか？",
        options: ["思い当たらない", "ストレスや疲労", "周りが咳をしていた"],
      };
    }
  }
  if (category === "GI") {
    if (slotKey === "associated_symptoms") {
      return {
        question: "便や吐き気はどうですか？",
        options: ["特に変化はない", "下痢がある", "吐き気・嘔吐がある"],
      };
    }
    if (slotKey === "cause_category") {
      return {
        question: "何かきっかけで思い当たることはありますか？",
        options: ["冷えや寒気がある", "便秘", "食あたり"],
      };
    }
  }
  return null;
}

function hasFeverMentionInHistory(historyText) {
  const text = String(historyText || "");
  return /(頭が熱い|頭があつい|ねつがある|熱がある|熱っぽい|発熱|熱が出)/.test(text);
}

/**
 * 発熱の示唆があれば true。複合回答（例: 咳や発熱がある、鼻詰まりと発熱、微熱37.1）も含む。
 * INFECTION 分岐・スポンタン充填・付随スロット判定で共通利用。
 */
function textImpliesFeverForInfectionTriage(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (
    /(発熱がある|頭が熱い|頭があつい|ねつがある|熱がある|熱っぽい|熱が出|微熱|高熱|熱り|熱感)/.test(lower)
  ) {
    return true;
  }
  if (/(咳や発熱|発熱と|と発熱|や発熱|発熱が|のどが熱い|喉が熱い)/.test(lower)) {
    return true;
  }
  if (/\d{2}[\.\．]\d{1,2}/.test(raw)) {
    return true;
  }
  if (/\d{2}([\.\．]\d)?\s*度(?!台)/.test(lower)) {
    return true;
  }
  if (/発熱/.test(lower)) {
    if (/(発熱|熱)(は|も)?(なし|ない|なく|ありません|出ていない|出てない|ゼロ)/.test(lower)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * PAIN/INFECTION 共通・付随症状の3択。
 * 元から INFECTION 系（triage・喉主症状・主訴／スロット回答に喉の主訴が含まれる）のときは「発熱がある」を出さず先頭を「これ以外は特にない」とする（KAIRO_SPEC 7.1.1）。
 */
function isAlreadyInfectionPathForAssociatedOptions(historyText, state, category) {
  if (category === "INFECTION") return true;
  if (state?.triageCategory === "INFECTION") return true;
  const h = String(historyText || "");
  const combined = [
    h,
    state?.primarySymptom || "",
    state?.slotAnswers?.pain_score || "",
    state?.slotAnswers?.worsening || "",
    state?.slotAnswers?.duration || "",
    state?.historyTextForCare || "",
  ]
    .filter(Boolean)
    .join(" ");
  if (isThroatMainSymptom(h) || isThroatMainSymptom(combined)) return true;
  return false;
}

function buildPainInfectionAssociatedOptions(historyText, state = null, category = null) {
  if (isAlreadyInfectionPathForAssociatedOptions(historyText, state, category)) {
    return ["これ以外は特にない", "吐き気がある", "咳や鼻詰まりがある"];
  }
  return ["咳や鼻詰まりがある", "吐き気がある", "発熱がある"];
}

function applyCategoryQuestionOverride(fixed, slotKey, category, useFinalPrefix, historyText = "", state = null) {
  if (!fixed || !slotKey) return fixed;
  if (slotKey === "worsening") {
    const baseCategory = detectSymptomCategory(category === "GI" ? "腹痛" : category === "INFECTION" ? "喉" : category === "SKIN" ? "ヒリヒリ" : "頭痛");
    const options = buildPainQualityOptions(baseCategory);
    fixed.options = options;
    fixed.question = `${useFinalPrefix ? "最後に、" : ""}${FIXED_QUESTIONS.worsening.q}\n・${options.join("\n・")}`;
    return fixed;
  }
  if ((category === "PAIN" || category === "INFECTION") && slotKey === "associated_symptoms") {
    const options = buildPainInfectionAssociatedOptions(historyText, state, category);
    fixed.options = options;
    fixed.question = `${useFinalPrefix ? "最後に、" : ""}${FIXED_QUESTIONS.associated_symptoms.q}\n・${options.join("\n・")}`;
    return fixed;
  }
  const override = getCategoryQuestionOverride(category, slotKey);
  if (!override) {
    if (slotKey === "associated_symptoms") {
      const options = buildAssociatedSymptomsOptions("other");
      fixed.options = options;
      fixed.question = `${useFinalPrefix ? "最後に、" : ""}${FIXED_QUESTIONS.associated_symptoms.q}\n・${options.join("\n・")}`;
    }
    return fixed;
  }
  fixed.options = override.options;
  fixed.question = `${useFinalPrefix ? "最後に、" : ""}${override.question}\n・${override.options.join("\n・")}`;
  return fixed;
}

function pickTemplateId(state, isFirstQuestion) {
  const used = new Set(state.usedTemplateIds || []);
  let group = "EMPATHY_PURPOSE";
  if (isFirstQuestion) {
    group = "EMPATHY_ONLY";
  } else if (!state.progressTemplateUsed) {
    group = "EMPATHY_PROGRESS_PURPOSE";
    state.progressTemplateUsed = true;
  }
  const candidates = TEMPLATE_ID_GROUPS[group];
  const available = candidates.filter((id) => !used.has(id));
  const pool = available.length > 0 ? available : candidates;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  state.usedTemplateIds = [...used, chosen];
  state.lastTemplateId = chosen;
  return chosen;
}

function pickEmpathyTemplateId(isFirstQuestion) {
  const pool = isFirstQuestion ? EMPATHY_OPEN_IDS : EMPATHY_NEXT_IDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickUniqueTemplateId(pool, usedSet) {
  const available = pool.filter((id) => !usedSet.has(id));
  if (available.length === 0) {
    return null;
  }
  return available[Math.floor(Math.random() * available.length)];
}

function getIntroRoleFromTemplateId(id) {
  if (!id) return null;
  if (id.startsWith("PROGRESS_")) return "PROGRESS";
  if (id.startsWith("FOCUS_")) return "FOCUS";
  if (id.startsWith("TEMPLATE_EMPATHY_") || id.startsWith("EMPATHY_NEXT_")) return "EMPATHY";
  return null;
}

function getAllowedIntroRolesBySlot(slotKey) {
  if (slotKey === "pain_score") return new Set(["EMPATHY"]);
  if (slotKey === "duration" || slotKey === "worsening" || slotKey === "worsening_trend") return new Set(["FOCUS"]);
  if (slotKey === "daily_impact") return new Set(["PROGRESS", "FOCUS"]);
  if (slotKey === "associated_symptoms") return new Set(["FOCUS"]);
  if (slotKey === "cause_category") return new Set(["PROGRESS", "FOCUS"]);
  return new Set(["FOCUS"]);
}

function buildIntroTemplateIds(state, questionIndex, slotKey) {
  if (questionIndex === 0 && slotKey === "pain_score") {
    return [];
  }
  // 最後の質問：何があってもPROGRESS／FOCUS禁止。質問文のみ。
  const requiredCount = getRequiredSlotCount(state);
  const filledCount = countFilledSlots(state?.slotFilled, state);
  if (requiredCount > 0 && requiredCount - filledCount === 1) {
    return [];
  }
  const used = new Set(state.introTemplateUsedIds || []);
  let introIds = [];
  const progressUsedBefore = (state?.introRoleUsage?.PROGRESS || 0) > 0;

  if (slotKey === "pain_score") {
    const empathyId = pickUniqueTemplateId(EMPATHY_OPEN_IDS, used);
    if (empathyId) {
      introIds.push(empathyId);
      used.add(empathyId);
    }
  } else {
    let roles = [];
    const progressUsed = (state.introRoleUsage?.PROGRESS || 0) > 0;
    if (slotKey === "duration" || slotKey === "worsening" || slotKey === "worsening_trend") {
      roles = ["FOCUS"];
    } else if (slotKey === "daily_impact") {
      roles = progressUsed ? ["FOCUS"] : ["PROGRESS", "FOCUS"];
    } else if (slotKey === "associated_symptoms") {
      roles = ["FOCUS"];
    } else if (slotKey === "cause_category") {
      roles = progressUsed ? ["FOCUS"] : ["PROGRESS", "FOCUS"];
    } else {
      roles = ["FOCUS"];
    }

    for (const role of roles) {
      const pool =
        role === "PROGRESS"
          ? PROGRESS_IDS
          : FOCUS_IDS;
      const picked = pickUniqueTemplateId(pool, used);
      if (picked) {
        introIds.push(picked);
        used.add(picked);
      }
    }

    state.lastIntroRoles = roles;
  }

  const allowedRoles = getAllowedIntroRolesBySlot(slotKey);
  // 仕様強制: 禁止ロールを除外、同一ID除外、最大2文
  const filtered = [];
  const seenLocal = new Set();
  for (const id of introIds) {
    if (!id || seenLocal.has(id)) continue;
    const role = getIntroRoleFromTemplateId(id);
    if (!role || !allowedRoles.has(role)) continue;
    filtered.push(id);
    seenLocal.add(id);
    if (filtered.length >= 2) break;
  }
  // 仕様強制: PROGRESS はセッション中最大1回（カテゴリ差し替え有無に関係なく固定）
  if (progressUsedBefore) {
    const withoutProgress = filtered.filter((id) => getIntroRoleFromTemplateId(id) !== "PROGRESS");
    filtered.length = 0;
    withoutProgress.forEach((id) => filtered.push(id));
    // 2文上限の範囲でFOCUSを補完
    while (filtered.length < 2) {
      const focusId = pickUniqueTemplateId(FOCUS_IDS, used);
      if (!focusId) break;
      if (!filtered.includes(focusId)) {
        filtered.push(focusId);
      }
      used.add(focusId);
    }
  }
  // pain_score はEMPATHY必須
  if (slotKey === "pain_score" && !filtered.some((id) => getIntroRoleFromTemplateId(id) === "EMPATHY")) {
    const empathyId = pickUniqueTemplateId(EMPATHY_OPEN_IDS, used);
    if (empathyId) {
      filtered.unshift(empathyId);
    }
  }
  introIds = filtered.slice(0, 2);
  introIds.forEach((id) => used.add(id));
  state.introTemplateUsedIds = Array.from(used);

  // 使用実績は最終IDから再計算（過剰カウント防止）
  state.introRoleUsage = state.introRoleUsage || {};
  for (const id of introIds) {
    const role = getIntroRoleFromTemplateId(id);
    if (!role) continue;
    state.introRoleUsage[role] = (state.introRoleUsage[role] || 0) + 1;
  }
  return introIds;
}

function normalizeQuestionText(text) {
  return (text || "")
    .replace(/\s+/g, "")
    .replace(/[？?。!！]/g, "")
    .trim();
}

function formatUserPhrase(text) {
  const cleaned = (text || "").trim().replace(/[。！？!？]+$/, "");
  if (!cleaned) return "今の状態";
  if (/^\d+$/.test(cleaned)) {
    return "その数値は";
  }
  if (cleaned.match(/痛いです$/)) {
    return `${cleaned.replace(/痛いです$/, "痛いのは")}`;
  }
  if (cleaned.endsWith("です")) {
    return `${cleaned.replace(/です$/, "")}のは`;
  }
  return `${cleaned}は`;
}

function extractQuestionPhrases(text) {
  const lines = (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const phraseLines = [];
  for (const line of lines) {
    if (line.startsWith("・")) break;
    phraseLines.push(line);
    if (phraseLines.length >= 3) break;
  }
  return normalizeQuestionText(phraseLines.join(" "));
}

function normalizeFreeTextForSummary(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[。]+$/g, "")
    .trim();
}

/** ユーザー回答をそのまま返す（緊急度判定以外で使用）。slotAnswers（raw）を優先し、フィルタを通さない。 */
function getSlotStatusValue(state, statusKey, fallback = "") {
  const slotKey = STATUS_KEY_TO_SLOT[statusKey] || statusKey;
  const fromAnswers = state?.slotAnswers?.[slotKey];
  const fromStatus = state?.slotStatus?.[statusKey]?.value;
  const picked =
    fromAnswers !== null && fromAnswers !== undefined && String(fromAnswers).trim() !== ""
      ? fromAnswers
      : fromStatus !== null && fromStatus !== undefined && String(fromStatus).trim() !== ""
        ? fromStatus
        : fallback;
  return String(picked ?? "").trim();
}

function buildFactsFromSlotAnswers(state) {
  const answers = state?.slotAnswers || {};
  const facts = [];
  const severityRaw = getSlotStatusValue(state, "severity", answers.pain_score);
  const worseningRaw = getSlotStatusValue(state, "worsening", answers.worsening);
  const durationRaw = getSlotStatusValue(state, "duration", answers.duration);
  const impactRaw = getSlotStatusValue(state, "impact", answers.daily_impact);
  const associatedRaw = getSlotStatusValue(state, "associated", answers.associated_symptoms);
  const causeRaw = getSlotStatusValue(
    state,
    "cause_category",
    state?.causeDetailText || answers.cause_category
  );

  if (state?.lastPainScore !== null) {
    if (severityRaw && severityRaw !== String(state.lastPainScore)) {
      facts.push(`痛みは「${severityRaw}」`);
    } else {
      facts.push(`痛みは「${state.lastPainScore} / 10」くらい`);
    }
  }
  if (impactRaw) {
    facts.push(`日常の動きは「${impactRaw}」`);
  }
  if (worseningRaw) {
    facts.push(`変化は「${worseningRaw}」`);
  }
  if (durationRaw) {
    facts.push(`始まりは「${durationRaw}」`);
  }
  if (!state?.associatedSymptomsFromFirstMessage && associatedRaw) {
    if (associatedRaw.includes("ない")) {
      facts.push("これ以外の症状は特にない");
    } else {
      facts.push(`これ以外の症状は「${associatedRaw}」`);
    }
  }
  if (causeRaw) {
    if (causeRaw.includes("思い当たらない")) {
      facts.push("きっかけは特に思い当たらない");
    } else {
      facts.push(`きっかけは「${causeRaw}」`);
    }
  }
  if (state?.causeDetailText) {
    facts.push(`きっかけの具体として「${state.causeDetailText}」と話している`);
  }
  return facts.map((item) => `・${item}`);
}

/** まとめの「今の状態について」ブロック内で、確認文用の前後文（今の情報から見ると、／という状況です。）を除去し箇条書きのみにする */
function stripStateAboutIntroOutro(text) {
  if (!text) return text;
  const lines = text.split("\n");
  const stateAboutHeaders = ["🤝 今の状態について", "📝 今の状態について"];
  const nextBlockPattern = /^(✅|⏳|🚨|💊|🌱|🏥|💬)\s/;
  const introOutroPattern = /^(今の情報から見ると、|という状況です。?)\s*$/;
  let inStateBlock = false;
  const result = lines.map((line) => {
    const isHeader = stateAboutHeaders.some((h) => line.startsWith(h));
    if (isHeader) {
      inStateBlock = true;
      return line;
    }
    if (inStateBlock) {
      if (nextBlockPattern.test(line)) {
        inStateBlock = false;
        return line;
      }
      if (introOutroPattern.test(line.trim())) return null;
    }
    return line;
  });
  return result.filter((l) => l !== null).join("\n");
}

function sanitizeSummaryBullets(text, state) {
  if (!text) return text;
  const answers = state?.slotAnswers || {};
  const result = text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("・")) return line;
      const content = trimmed.replace(/^・\s*/, "").trim();
      if (isConfirmationOnlyAnswer(content)) return null;
      if (/^・(ない|特にない|なし)$/.test(trimmed)) {
        if (answers.associated_symptoms?.includes("ない")) {
          return "・これ以外の症状は特にない";
        }
        return "・特にない点がある";
      }
      return line;
    });
  return result.filter((l) => l !== null).join("\n");
}

function hasForbiddenSubjectiveWords(text) {
  return SUBJECTIVE_ALERT_WORDS.some((word) => (text || "").includes(word));
}

function validateSummaryAgainstNormalized(text, state) {
  if (!text) return false;
  const normalized = Object.values(state?.slotNormalized || {});
  const hasHigh = normalized.some((entry) => entry.riskLevel === RISK_LEVELS.HIGH);
  const hasLowNegative = normalized.some((entry) =>
    /^(ない|特にない|なし)$/.test((entry.rawAnswer || "").trim())
  );
  if (!hasHigh && hasForbiddenSubjectiveWords(text)) {
    return false;
  }
  if (hasLowNegative && hasForbiddenSubjectiveWords(text)) {
    return false;
  }
  if ((text || "").split("\n").some((line) => /^・(ない|特にない|なし)$/.test(line.trim()))) {
    return false;
  }
  return true;
}

/** 箇条書き：ユーザーに近い文言のまま、語尾だけ軽く整える（定型への置換・言い換えはしない） */
function lightBulletCleanupForUserWords(raw) {
  let t = String(raw || "").trim();
  if (!t) return t;
  t = t.replace(/です$|ます$/, "");
  t = t.replace(/かも$|かな$/g, "").trim();
  t = polishMeaningJsonColloquialSentence(t);
  return t.trim();
}

/** 箇条書きフィルタ：誤りや日本語として不自然な箇条を検出し、修正する（テンプレへの丸ごと置換はしない）。 */
function sanitizeBulletPoints(bullets) {
  if (!Array.isArray(bullets)) return [];
  const cleaned = bullets
    .map((b) => {
      let s = String(b || "").trim();
      if (!s) return null;
      if (!/^・/.test(s)) s = `・${s}`;
      if (s.length <= 2) return null;
      const inner = s.replace(/^・\s*/, "").trim();
      if (/頭が痛いが出ている/.test(inner)) return null;
      if (isBrokenCauseGrammarOnly(inner)) return null;
      const cleaned = lightBulletCleanupForUserWords(inner);
      if (!cleaned) return null;
      s = `・${cleaned}`;
      // 重複助詞の修正
      s = s.replace(/([はがをにでの])\1+/g, "$1");
      s = s.replace(/のの/g, "の").replace(/がが/g, "が").replace(/はは/g, "は").replace(/をを/g, "を").replace(/にに/g, "に").replace(/でで/g, "で");
      // 重複接尾の修正（ようなような→ような、感じ感じ→感じ）
      s = s.replace(/(ような|感じ|タイプの痛み)\1+/g, "$1");
      s = s.replace(/痛み痛み/g, "痛み").replace(/症状症状/g, "症状");
      s = s.replace(/ような痛みが出ているような痛みが出ている/g, "ような痛みが出ている");
      s = s.replace(/ような痛みが出ているような/g, "ような痛みが出ている");
      s = s.replace(/痛みが出ているような痛みが出ている/g, "痛みが出ている");
      // 痛み方の定型：「ズキズキような」→「ズキズキのような」。「する」は除く（LLM／旧整形の両方）
      s = s.replace(
        /・(ズキズキ|キリキリ|ヒリヒリ|チクチク|ジンジン|ドクドク|重い|締め付け|鈍い)するような痛みが出ている/g,
        "・$1のような痛み"
      );
      s = s.replace(
        /・(ズキズキ|キリキリ|ヒリヒリ|チクチク|ジンジン|ドクドク|重い|締め付け|鈍い)ような痛みが出ている/g,
        "・$1のような痛み"
      );
      s = s.replace(/痛みが出ている痛み/g, "痛み");
      s = s.replace(/ようなような/g, "ような");
      // ・の連続や空行
      s = s.replace(/^・+/g, "・").replace(/\s{2,}/g, " ");
      if (s.length <= 2) return null;
      // 明らかに不自然な終わり方（体言止め以外で不完全な文）
      if (/[がはをに]$/.test(s)) return null;
      if (/^・\s*$/.test(s)) return null;
      return s;
    })
    .filter(Boolean);
  return dedupeBulletsOneLinePerInferenceSlot(cleaned);
}

/** otherSymptoms：Phase1 が既に一文で返す前提。定型（〜を伴っている）への無理な埋め込みはしない。 */
function formatOtherSymptomBulletLine(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  return `・${t}`;
}

/** context：JSON の文をそのまま一行に（「〜が続いている状態」等のテンプレ追記はしない）。 */
function formatContextBulletLine(ctx) {
  const c = String(ctx || "").trim();
  if (!c) return null;
  return `・${c}`;
}

/** cause から原因の核となる語句を抽出（部分一致検証用） */
function extractCauseCoreTokens(cause) {
  const stripped = String(cause || "")
    .replace(/の可能性$/g, "")
    .replace(/による影響$/g, "")
    .replace(/による負担$/g, "")
    .replace(/の影響$/g, "")
    .replace(/の負担$/g, "")
    .trim();
  if (!stripped || stripped.length < 2) return [];
  if (/^(影響|負担|こと|の)$/.test(stripped)) return [];
  const parts = stripped.split(/[、や､／と及び]/).map((p) => p.trim()).filter(Boolean);
  const tokens = [];
  for (let seg of parts) {
    seg = seg
      .replace(/^(強い|かなり|ある程度の|一部の|そうした)/, "")
      .replace(/による.*$/g, "")
      .replace(/の影響$|の負担$/g, "")
      .trim();
    if (seg.length >= 2 && !/^(影響|負担|こと)$/.test(seg)) tokens.push(seg);
  }
  if (tokens.length === 0 && stripped.length >= 2) {
    const one = stripped.replace(/による.*$/g, "").trim();
    if (one.length >= 2 && !/^(影響|負担)$/.test(one)) tokens.push(one);
  }
  return tokens.filter((t) => t.length >= 2);
}

function isCauseAbstractOnly(cause) {
  const c = String(cause || "").trim();
  if (!c) return false;
  if (/^(影響の可能性|負担の可能性|影響|負担|ことの可能性)$/.test(c)) return true;
  const noPos = c.replace(/の可能性$/, "");
  if (/^(影響|負担)$/.test(noPos)) return true;
  return false;
}

/** PAIN: type 列挙値 → 組み立て用フレーズ */
function buildPainTypePhraseForAssembly(type) {
  const t = String(type || "").trim();
  if (!t || t === "不明") return "タイプ不明の";
  if (t === "ズキズキ") return "ズキズキする";
  if (t === "重い") return "重い感じの";
  if (t === "締め付け") return "締め付けられるような";
  if (t === "その他") return "その他のタイプの";
  return t;
}

/** PAIN: severity 列挙 → 組み立て用接頭（不明は明示） */
function buildPainSeverityPrefixForAssembly(severity) {
  const s = String(severity || "").trim();
  if (!s || s === "不明") return "強さ不明の";
  return s;
}

/** PAIN: symptom + severity + type から main_symptom をサーバ側で組み立て（LLMの main_symptom 直接生成は上書き） */
function assemblePainMainSymptomFromParts(parsed) {
  const symptom = String(parsed.symptom || "").trim();
  const sev = String(parsed.severity || "").trim();
  const typ = String(parsed.type || "").trim();
  const typePhrase = buildPainTypePhraseForAssembly(typ);
  if (!symptom) return "";
  const sevPart = buildPainSeverityPrefixForAssembly(sev);
  if (!typePhrase && !sevPart) return symptom;
  if (!typePhrase) return `${sevPart}${symptom}`;
  if (!sevPart) return `${typePhrase}${symptom}`;
  return `${sevPart}${typePhrase}${symptom}`;
}

/**
 * onset / trend → 箇条書き1行。サーバ側の定型（症状は〜から続いている等）には嵌めず、
 * Phase1 の文章をそのまま載せる。単語のみ等は isOnsetTrendJsonValid で弾く。
 */
function formatOnsetTrendBullet(prefix, rawVal, kind) {
  const v = String(rawVal || "").trim();
  if (!v || v === "不明") return null;
  if (!isOnsetTrendJsonValid(v, kind)) return null;
  return v.startsWith("・") ? v : `・${v}`;
}

/**
 * 箇条書き1行を KAIRO_SPEC（1行＝完結した自然な一文）に近づける。既に十分な文ならそのまま。
 */
function coerceStateAboutBulletFragmentToSentenceInner(text, label) {
  let t = String(text || "").trim();
  if (!t) return t;
  if (/^痛みは/.test(t)) return t;
  if (/頭が痛いが出ている/.test(t)) {
    return t.replace(/頭が痛いが出ている/g, "頭痛が出ている");
  }
  if (
    /(が出ている|がある|を伴っている|見られている|の可能性|である|から始まっている|から続いている|続いている|始まっている)/.test(t) &&
    t.length >= 8
  ) {
    return t;
  }
  if (/可能性$/.test(t) && !/の可能性$/.test(t)) {
    t = t.replace(/可能性$/, "の可能性");
    if (t.length >= 12) return t;
  }
  if (/^(さっき|今さっき|たった今|数分|数十分|数時間前|昨日|一昨日|今朝|昨夜|\d+\s*日前|\d+\s*時間)/.test(t)) {
    return `症状は${t}から始まっている`;
  }
  if (/^(ズキズキ|キリキリ|ヒリヒリ|チクチク|重い|締め付け|鈍い)(する)?$/.test(t)) {
    const head = t.replace(/する$/, "");
    return `${head}する痛みが出ている`;
  }
  if (/^(吐き気|嘔吐|発熱|咳|のどの痛み|鼻詰まり)$/.test(t)) {
    return `${t}がある`;
  }
  if (/^経過の様子は/.test(t) || /^症状は/.test(t) || /^日常生活や身体への影響は/.test(t)) {
    return t;
  }
  if (/悪化|マシ|波|回復|横ばい|悪くな|良くな/.test(t) && t.length >= 8) {
    return `経過の様子は${t}`;
  }
  if (t.length < 22 && !/(が出ている|がある|である|を伴っている|見られている|の可能性)/.test(t)) {
    return `${t}が出ている`;
  }
  return t;
}

/** raw ラベル付きスロット値 → 確認文・まとめ用の一文箇条書き */
function coerceSlotLabelAndValueToBulletLine(label, value) {
  const l = String(label || "").trim();
  let v = lightBulletCleanupForUserWords(String(value || "").trim());
  if (!v) return null;
  if (/^痛みの強さ/.test(l)) {
    const n = v.replace(/^痛みは\s*/i, "").trim();
    return `・痛みは${n}`;
  }
  if (/^症状の様子/.test(l)) {
    if (/^症状の様子は/.test(v)) return `・${v}`;
    if (v.length >= 12 && /(が出ている|である|ある|続いている)/.test(v)) return `・${v}`;
    return `・症状の様子は${v}である`;
  }
  if (/^経過時間/.test(l)) {
    if (/^症状は/.test(v) && /(から続い|から始ま)/.test(v)) return `・${v}`;
    if (v.length >= 10 && /(から|続い|経過|始ま|前から)/.test(v)) return `・${v}`;
    return `・症状は${v}から続いている`;
  }
  if (/^悪化傾向/.test(l)) {
    if (/^経過の様子は/.test(v)) return `・${v}`;
    if (v.length >= 10 && /(ている|ある|である|悪化|回復|横ばい|マシ|波)/.test(v)) return `・${v}`;
    return `・経過の様子は${v}である`;
  }
  if (/^影響・見た目・体温/.test(l)) {
    return `・日常生活や身体への影響は${v}である`;
  }
  if (/^付随症状/.test(l)) {
    if (v.length >= 8 && /(がある|を伴っている|がみられる)/.test(v)) return `・${v}`;
    return `・${v}がある`;
  }
  if (/^きっかけ・原因/.test(l)) {
    const c = polishCausePhraseToWrittenJapanese(v);
    if (c) return `・${c}`;
    return `・${coerceStateAboutBulletFragmentToSentenceInner(v, l)}`;
  }
  if (/^追加情報/.test(l)) {
    return v.length >= 12 ? `・${v}` : `・${coerceStateAboutBulletFragmentToSentenceInner(v, l)}`;
  }
  return `・${coerceStateAboutBulletFragmentToSentenceInner(v, l)}`;
}

function finalizeMeaningJsonBulletLinesForSpec(bullets) {
  if (!Array.isArray(bullets)) return [];
  return bullets.map((line) => {
    const inner = String(line || "").replace(/^・\s*/, "").trim();
    if (!inner) return line;
    const fixed = coerceStateAboutBulletFragmentToSentenceInner(inner, null);
    return `・${fixed}`;
  });
}

/** PAIN：symptom を箇条書き用の名詞に（「頭が痛い」→「頭痛」。主症状を二重に書かないため） */
function normalizePainSymptomNounForBullets(symptom) {
  let s = String(symptom || "").trim();
  if (!s) return "";
  if (/^頭が痛い$|^頭が痛いです$/.test(s)) return "頭痛";
  if (/頭が痛く/.test(s)) return s.replace(/頭が痛く/, "頭痛が");
  if (/^お腹が痛い$/.test(s)) return "腹痛";
  if (/^歯が痛い$/.test(s)) return "歯痛";
  return s;
}

/** cause：文法だけ弾く（「〜ですの可能性」等）。天候の話題そのものは禁止しない — 解釈は polish 側。 */
function isBrokenCauseGrammarOnly(cause) {
  const raw = String(cause || "").trim();
  if (!raw) return false;
  if (/ですの可能性$|ますの可能性$|でしたの可能性$|だの可能性$/.test(raw)) return true;
  return false;
}

/**
 * 口語の天候メモを「きっかけの可能性」名詞句へ（JSON cause 用）。
 * すでに十分な解釈文なら上書きしない。
 */
function reinterpretWeatherAndEnvironmentCause(cause) {
  let t = String(cause || "").trim().replace(/[。．]+$/g, "").trim();
  if (!t) return t;
  if (/きっかけの可能性$/.test(t) && t.length >= 14) return t.endsWith("の可能性") ? t : `${t}の可能性`;
  const flat = t.replace(/\s+/g, "");
  if (/雨に伴う|雨による|雨での湿気|湿気がきっかけ/.test(flat)) return /の可能性$/.test(t) ? t : `${t}の可能性`;
  if (/^(今日は|昨日は)?雨(です|だ|だった)?$/.test(t) || /^雨の日/.test(t) || /^雨です/.test(t) || t === "雨") {
    return "雨に伴う湿気がきっかけの可能性";
  }
  if (/雨|くもり|曇り|霧|じめじめ|湿気|湿度/.test(t) && t.length <= 18 && !/きっかけ/.test(t)) {
    return "雨に伴う湿気がきっかけの可能性";
  }
  if (/晴れ|日差し|紫外線|太陽|日焼け|暑さ/.test(t) && t.length <= 22 && !/きっかけ/.test(t)) {
    return "強い日差しや乾燥がきっかけの可能性";
  }
  if (/雪|寒さ|冷え込|気温が低/.test(t) && t.length <= 22 && !/きっかけ/.test(t)) {
    return "冷えや気温の変化がきっかけの可能性";
  }
  return t;
}

/** PAIN：主症状と同趣旨の重複行（頭が痛いが出ている 等）を otherSymptoms から除外 */
function otherSymptomLineDuplicatesPainMainSymptom(symptomNorm, lineText) {
  const t = String(lineText || "").replace(/^・/, "").trim();
  if (!t) return false;
  if (/頭が痛いが出ている|^頭痛が出ている$/.test(t) && /頭痛|頭が痛い/.test(symptomNorm)) return true;
  if (/^頭が痛いがある$|頭が痛いを伴っている/.test(t)) return true;
  return false;
}

/** Phase2：統一JSONのみ参照。1行＝1意味の完結した自然文。出力順固定。最大8行（複数症状の分割に対応）。 */
function formatBulletsFromMeaningJson(meaning, category = "PAIN") {
  if (!meaning || typeof meaning !== "object") return [];
  const bullets = [];
  let main = String(meaning.main_symptom || "").trim();
  if (category === "PAIN") {
    const assembled = assemblePainMainSymptomFromParts(meaning);
    if (assembled) main = assembled;
  }
  if (!main && meaning.pain?.combined) {
    const c = String(meaning.pain.combined).trim();
    main = /痛み$/.test(c) ? c : /^(軽い|中程度|やや強い|強い)$/.test(c) ? c + "痛み" : c + "する痛み";
  } else if (!main && meaning.pain?.type) {
    main = String(meaning.pain.type).trim() + "する痛み";
  }
  if (category === "PAIN") {
    const symptomN = normalizePainSymptomNounForBullets(String(meaning.symptom || "").trim());
    const typ = String(meaning.type || "").trim();
    const typePhrase = buildPainTypePhraseForAssembly(typ);
    if (typePhrase && symptomN) {
      const candidateLine = `・${typePhrase}${symptomN}が出ている`;
      const othersArr = Array.isArray(meaning.otherSymptoms) ? meaning.otherSymptoms : [];
      const candNorm = candidateLine.replace(/^・/, "").replace(/\s+/g, "");
      const dup = othersArr.some((o) => {
        const os = String(o || "").replace(/\s+/g, "");
        return os === candNorm || (os.includes("ズキズキ") && candNorm.includes("ズキズキ") && /痛み|頭痛/.test(os));
      });
      if (!dup) bullets.push(candidateLine);
    }
  } else if (main) {
    let m = main
      .replace(/ような痛みが出ているような痛み/g, "ような痛み")
      .replace(/痛みが出ているような痛み/g, "痛み");
    if (!/(が出ている|がある|である|を伴っている|見られている)$/.test(m)) {
      m = `${m}が出ている`;
    }
    bullets.push(`・${m}`);
  }
  const onset = String(meaning.onset || "").trim();
  if (onset && onset !== "不明") {
    const line = formatOnsetTrendBullet("onset", onset, "onset");
    if (line) bullets.push(line);
  }
  const trend = String(meaning.trend || "").trim();
  if (trend && trend !== "不明") {
    const line = formatOnsetTrendBullet("trend", trend, "trend");
    if (line) bullets.push(line);
  }
  const others = meaning.otherSymptoms;
  const symDedupe =
    category === "PAIN" ? normalizePainSymptomNounForBullets(String(meaning.symptom || "").trim()) : "";
  if (Array.isArray(others) && others.length > 0) {
    others.slice(0, 6).forEach((s) => {
      const st = String(s).trim();
      if (category === "PAIN" && symDedupe && otherSymptomLineDuplicatesPainMainSymptom(symDedupe, st)) return;
      const line = formatOtherSymptomBulletLine(st);
      if (line) bullets.push(line);
    });
  } else if (meaning.noOtherSymptoms === true) {
    bullets.push("・吐き気や発熱などの他の症状は今のところ見られていない");
  }
  const ctx = String(meaning.context || "").trim();
  if (ctx) {
    const line = formatContextBulletLine(ctx);
    if (line) bullets.push(line);
  }
  const cause = String(meaning.cause || "").trim();
  if (cause) {
    const c = polishCausePhraseToWrittenJapanese(cause);
    if (c) bullets.push(`・${c}`);
  }
  const out = bullets.slice(0, 8).filter(Boolean);
  return finalizeMeaningJsonBulletLinesForSpec(out);
}

/** 付随症状スロットの生の選択肢（表示専用ポリシー用）。判断ロジック・LLMには渡さない。 */
function getAssociatedSelectionRaw(state) {
  return String(
    state?.slotAnswers?.associated_symptoms ?? getSlotStatusValue(state, "associated", "") ?? ""
  ).trim();
}

/** PAIN/INFECTION・付随症状で「これ以外は特にない」相当（自由記述のない／なし等含む） */
function isPainCategorySlot4NoneSelected(state) {
  if (!state) return false;
  const cat = state.triageCategory || resolveQuestionCategoryFromState(state);
  if (cat !== "PAIN" && cat !== "INFECTION") return false;
  const raw = getAssociatedSelectionRaw(state);
  if (raw === "これ以外は特にない") return true;
  const historyText = state.historyTextForCare || "";
  const options = buildPainInfectionAssociatedOptions(historyText, state, state.triageCategory || null);
  const classified = classifyAnswerToOption(raw, options, "associated_symptoms");
  if (options[0] === "これ以外は特にない" && classified.index === 0) return true;
  if (options[0] === "咳や鼻詰まりがある") {
    const t = normalizeAnswerText(raw);
    if (/^(特にない|ない|なし|他にない|それ以外はない|特にないです)$/.test(t)) return true;
    if (
      /特にない|他にない|それ以外はない/.test(raw) &&
      !/鼻|咳|詰まり|熱|発熱|吐き気|嘔吐/.test(raw)
    ) {
      return true;
    }
  }
  return false;
}

const GI_ASSOCIATED_SYMPTOMS_OPTIONS = ["特に変化はない", "下痢がある", "吐き気・嘔吐がある"];

/** GI・便や吐き気で「特に変化はない」相当（自由記述のない／なし等含む） */
function isGiCategorySlot5NoneSelected(state) {
  if (!state) return false;
  const cat = state.triageCategory || resolveQuestionCategoryFromState(state);
  if (cat !== "GI") return false;
  const raw = getAssociatedSelectionRaw(state);
  if (raw === "特に変化はない") return true;
  const classified = classifyAnswerToOption(raw, GI_ASSOCIATED_SYMPTOMS_OPTIONS, "associated_symptoms");
  return classified.index === 0;
}

/** 他の症状なしの表示専用1行を付ける条件（JSON・validate・LLMと切り離す） */
function isDisplayOnlyNoOtherSymptomsSlotCondition(state) {
  return isPainCategorySlot4NoneSelected(state) || isGiCategorySlot5NoneSelected(state);
}

/**
 * Phase1 JSON から noOtherSymptoms を落とす（この条件では表示は inject のみ）。
 * MEANING_JSON に「なし」を載せない運用に合わせる。
 */
function applyDisplayOnlyNoOtherSymptomsSlotJsonPolicy(parsed, state) {
  if (!parsed || typeof parsed !== "object" || !state) return;
  if (!isDisplayOnlyNoOtherSymptomsSlotCondition(state)) return;
  parsed.noOtherSymptoms = false;
}

/**
 * 最終箇条書きにのみ「・吐き気や発熱などの他の症状は今のところ見られていない」を挿入（原因行の直前を優先）。
 * 判断文・要約・LLMの参照対象に混ぜないため、validate 通過後にのみ呼ぶ。
 */
function injectDisplayOnlyNoOtherSymptomsBullet(bullets, state) {
  if (!Array.isArray(bullets) || !state) return bullets;
  if (!isDisplayOnlyNoOtherSymptomsSlotCondition(state)) return bullets.slice();
  const line = "・吐き気や発熱などの他の症状は今のところ見られていない";
  const norm = (b) => String(b).replace(/^・/, "").trim();
  const noOtherLine =
    "吐き気や発熱などの他の症状は今のところ見られていない";
  if (bullets.some((b) => norm(b) === noOtherLine)) return bullets.slice();
  const out = bullets.slice();
  let insertAt = -1;
  for (let i = 0; i < out.length; i++) {
    const s = norm(out[i]);
    if (/可能性$|の可能性$/.test(s)) {
      insertAt = i;
      break;
    }
  }
  if (insertAt >= 0) out.splice(insertAt, 0, line);
  else out.push(line);
  return sanitizeBulletPoints(out);
}

const BULLET_INFER_SLOT_KEYS = {
  PAIN_SCORE: "slot_pain_score",
  MAIN_QUALITY: "slot_main_quality",
  DURATION: "slot_duration",
  TREND: "slot_trend",
  ASSOCIATED: "slot_associated",
  NO_OTHER: "slot_associated_no_other",
  IMPACT: "slot_impact",
  CAUSE: "slot_cause",
  CONTEXT: "slot_context",
  OTHER: "slot_other",
};

/**
 * 箇条書き1行から「スロット相当」のキーを推定（同一キーは1行のみ残す dedupe 用）。
 * 推定不能な行は内容ハッシュで区別し、別文の誤結合を避ける。
 */
function inferBulletSlotKeyForDedupe(line) {
  const s = String(line || "").replace(/^・\s*/, "").trim();
  if (!s) return "__empty__";

  if (/^痛みは\s*\d|^痛みは.*\/10|^痛みは(軽|中|やや|強め|強い|弱い)/.test(s)) {
    return BULLET_INFER_SLOT_KEYS.PAIN_SCORE;
  }
  if (/の可能性$|きっかけの可能性|がきっかけ/.test(s)) {
    return BULLET_INFER_SLOT_KEYS.CAUSE;
  }
  if (/他の症状は今のところ見られていない|吐き気や発熱などの他の症状は/.test(s)) {
    return BULLET_INFER_SLOT_KEYS.NO_OTHER;
  }
  if (/日常生活|見た目|体温|身体への影響/.test(s)) {
    return BULLET_INFER_SLOT_KEYS.IMPACT;
  }

  if (/^症状は/.test(s)) {
    if (/(から続い|から始ま|続いている|始まっている)/.test(s)) {
      return BULLET_INFER_SLOT_KEYS.DURATION;
    }
    if (/\d|時間|分|日|週|月|昨日|一昨日|今朝|昨夜|さっき|今さっき|先週|先月|前から|数分|数十分|数時間/.test(s)) {
      return BULLET_INFER_SLOT_KEYS.DURATION;
    }
  }
  if (!/^症状は/.test(s) && /(から続い|から始ま|続いている|始まっている)/.test(s) && !/の可能性/.test(s) && s.length >= 4) {
    return BULLET_INFER_SLOT_KEYS.DURATION;
  }

  if (
    /^経過の様子は/.test(s) ||
    (/悪化|マシ|波|回復|横ばい|改善|悪くな|良くな|発症時より|経過を辿|推移/.test(s) &&
      !/の可能性$/.test(s) &&
      !/^症状は/.test(s) &&
      s.length >= 6)
  ) {
    return BULLET_INFER_SLOT_KEYS.TREND;
  }

  if (
    /(ズキズキ|キリキリ|ヒリヒリ|チクチク|ジンジン|ドクドク|重い|締め付け|鈍い|タイプ不明)/.test(s) &&
    /(痛み|頭痛|歯痛|腹痛|が出ている)/.test(s) &&
    !/^症状は/.test(s)
  ) {
    return BULLET_INFER_SLOT_KEYS.MAIN_QUALITY;
  }

  if (/吐き気|嘔吐|発熱|咳|鼻|めまい|しびれ|微熱|寒意|だるさ/.test(s) && !/の可能性$/.test(s)) {
    return `${BULLET_INFER_SLOT_KEYS.ASSOCIATED}:${normalizeBulletKeyForDedupe(s)}`;
  }

  return `${BULLET_INFER_SLOT_KEYS.OTHER}:${normalizeBulletKeyForDedupe(s).slice(0, 120)}`;
}

function dedupeBulletsOneLinePerInferenceSlot(bullets) {
  if (!Array.isArray(bullets)) return [];
  const seen = new Set();
  const out = [];
  for (const b of bullets) {
    const line = String(b || "").trim();
    if (!line) continue;
    const key = inferBulletSlotKeyForDedupe(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function normalizeBulletKeyForDedupe(s) {
  return String(s || "")
    .replace(/^・/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function bulletsAreSimilar(a, b) {
  const na = normalizeBulletKeyForDedupe(a);
  const nb = normalizeBulletKeyForDedupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 10 && nb.length >= 10 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

/** 確認文への返答でユーザーが付け足した自由文を箇条書き1行にする */
function formatUserExtraFactAsStateBullet(text) {
  let t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length > 220) t = `${t.slice(0, 217)}…`;
  return /^・/.test(t) ? t : `・${t}`;
}

/**
 * 確認文への追加・深掘り文を箇条書き用に整形（sanitizeBulletPoints に通さない）。
 * 「問題ない」単独などは null（誤って肯定とみなさない）。
 */
function formatConfirmationExtraFactSegment(seg) {
  let t = String(seg || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  t = t.replace(/^追加[情報としては]*[：:]\s*/i, "").trim();
  if (!t) return null;
  if (
    /^(はい|うん|ええ|OK|ok|オッケー|おっけー|問題ない|問題ないです|大丈夫|大丈夫です|問題ありません|特にない|ないです|ありません|なし|特になし)[。!！\s]*$/i.test(
      t
    )
  ) {
    return null;
  }
  t = t.replace(/^(はい|うん|ええ)[、,]\s*/i, "").trim();
  if (!t) return null;
  if (/^(特にない|ない|なし|追加なし)$/i.test(t)) return null;
  t = t
    .replace(/^問題ないですが\s*/i, "")
    .replace(/^大丈夫ですが\s*/i, "")
    .replace(/^問題ありませんが\s*/i, "")
    .replace(/^問題ないです[、,]\s*/i, "")
    .replace(/^大丈夫です[、,]\s*/i, "")
    .replace(/^いいえ[、,]\s*/i, "")
    .trim();
  if (!t) return null;

  let body = t
    .replace(/です$/g, "")
    .replace(/ます$/g, "")
    .replace(/でした$/g, "")
    .replace(/ました$/g, "");

  body = body
    .replace(/が痛い$/g, "が痛む")
    .replace(/がかゆい$/g, "がかゆむ")
    .replace(/が痒い$/g, "が痒む")
    .replace(/がしびれる$/g, "がしびれる")
    .replace(/が違和感がある$/g, "に違和感がある")
    .replace(/がつらい$/g, "がつらい");

  if (body.length > 200) body = `${body.slice(0, 197)}…`;
  const line = /^・/.test(body) ? body : `・${body}`;
  if (line.length <= 2) return null;
  return line;
}

/** 確認メッセージ1件から箇条書き行（0行以上）。句点改行で複数行に分割可。 */
function formatConfirmationExtraFactAsBullets(text) {
  const raw = String(text || "").trim().replace(/\s+/g, " ");
  if (!raw) return [];
  const segments = raw.split(/[。\n]+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const seg of segments) {
    const line = formatConfirmationExtraFactSegment(seg);
    if (line) out.push(line);
  }
  return out;
}

/**
 * 確認後の追加情報（confirmationExtraFacts）を必ず stateAboutBulletsCache に反映する。
 * TwoStage が失敗・部分取りこぼしでも聞き逃さない。
 * ベースは sanitizeBulletPoints 可。追加分は formatConfirmationExtraFactAsBullets のみ（削除されない）。
 */
function mergeConfirmationExtraFactsIntoStateBulletsCache(state) {
  const facts = state?.confirmationExtraFacts || [];
  if (facts.length === 0) return;
  let base =
    Array.isArray(state.stateAboutBulletsCache) && state.stateAboutBulletsCache.length > 0
      ? state.stateAboutBulletsCache.slice()
      : buildStateFactsBulletsLegacy(state, { forSummary: true });
  if (!Array.isArray(base)) base = [];
  const sanitizedBase = sanitizeBulletPoints(base);
  const deduped = [];
  const seenKeys = new Set();
  for (const line of sanitizedBase) {
    const k = normalizeBulletKeyForDedupe(line);
    if (k) seenKeys.add(k);
    deduped.push(line);
  }
  for (const raw of facts) {
    const extraLines = formatConfirmationExtraFactAsBullets(raw);
    for (const line of extraLines) {
      const k = normalizeBulletKeyForDedupe(line);
      if (k && seenKeys.has(k)) continue;
      if (deduped.some((b) => bulletsAreSimilar(b, line))) continue;
      if (k) seenKeys.add(k);
      deduped.push(line);
    }
  }
  state.stateAboutBulletsCache = injectDisplayOnlyNoOtherSymptomsBullet(deduped, state);
}

/** ユーザー回答にきっかけ・原因らしき記述があるか（cause 必須判定用） */
function hasRawCauseHintForValidation(raw) {
  const t = String(raw || "");
  return /(きっかけ|原因|太陽|日差し|紫外線|寝不足|睡眠|スマホ|画面|長時間|ストレス|食|あたり|乾燥|風邪|周り|咳|運動|飲酒|冷え|便秘|疲れ|仕事)/.test(
    t
  );
}

/** PAIN: main_symptom に強さ・タイプ・症状名が揃った名詞句か（動詞終わり・が出ている終わり禁止） */
function isPainMainSymptomStructurallyValid(main, parsed = null) {
  const m = String(main || "").trim();
  if (m.length < 5) return false;
  if (/が出ている$|である$|です$|ます$|ている$|あった$|なった$/.test(m)) return false;
  if (/痛みがある$|痛みがある。|^痛み$|^症状$|^ズキズキする痛み$/.test(m)) return false;
  if (/^(ズキズキ|キリキリ|重い|締め付け|鈍い)する痛み$/.test(m)) return false;
  const hasIntensity =
    /(強さ不明|軽い|軽め|軽度|中程度|やや|強い|強め|弱い|微し|わずか|微熱|不明|\d+\s*\/\s*10)/.test(m) ||
    /\/10/.test(m);
  const typField = parsed && String(parsed.type || "").trim();
  const hasType =
    /(タイプ不明|ズキズキ|キリキリ|締め付け|重い|鈍い|刺す|ヒリヒリ|チクチク|ジンジン|ドクドク|脈打|張っ|つり|引っ|電気)/.test(m) ||
    typField === "不明" ||
    typField === "その他";
  const hasSymptomName =
    /(頭痛|腰痛|腹痛|歯痛|のど|咽喉|咽頭|目|肩|首|腰|背中|こめかみ|片頭|耳|関節|腕|手|指|足|膝|しびれ|違和感|みぞおち|下腹|上腹)/.test(m) ||
    /する痛み$/.test(m);
  return hasIntensity && hasType && hasSymptomName;
}

/** context に原因・きっかけが混入していないか */
function isContextContaminatedWithCause(ctx) {
  const c = String(ctx || "");
  if (!c) return false;
  if (/原因|きっかけ|の影響|負担の可能性|使用しすぎ|長時間使用|の使用|による影響/.test(c)) return true;
  if (/スマホ.*使い|スマホを見|画面.*長時間|見過ぎ/.test(c)) return true;
  return false;
}

/** onset / trend が単語のみでないか（JSON 段階）。短い経過表現（4〜7文字）も許可 */
function isOnsetTrendJsonValid(val, kind) {
  const v = String(val || "").trim();
  if (!v || v === "不明") return true;
  if (/^(さっき|数時間前|急に|今|昨日|一昨日|改善|悪化|回復)$/.test(v)) return false;
  if (/^症状は/.test(v) || /^発症時より/.test(v)) return v.length >= 4;
  if (v.length < 4) return false;
  return true;
}

/** otherSymptoms の各要素が名詞単体でないか */
function validateOtherSymptomsJsonEntries(arr) {
  if (!Array.isArray(arr)) return false;
  for (const item of arr) {
    const s = String(item || "").trim();
    if (!s || s.length < 6) return false;
    if (!/を伴っている|がみられる|がある|を感じている|が出て|が続いている|が強い/.test(s)) return false;
  }
  return true;
}

const PAIN_SEVERITY_ENUM = new Set(["軽い", "中程度", "やや強い", "強い", "不明"]);
const PAIN_TYPE_ENUM = new Set(["ズキズキ", "重い", "締め付け", "その他", "不明"]);

/** polish 後も口語が残る cause は Phase1 却下（リトライ） */
function isCausePhraseStillColloquiallyBad(cause) {
  const c = String(cause || "").replace(/の可能性$/, "");
  if (!c) return false;
  if (/からかも|かもがきっかけ|をしすぎたからかも/.test(c)) return true;
  if (/かも$/.test(c)) return true;
  if (/だと思う$/.test(c)) return true;
  return false;
}

/** 箇条書きに載せない「空・ない・わからない」等（付随の表示専用「ない」は別ルート） */
function isAbsentOrUnknownSlotBulletAnswer(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return /^(ない|なし|特にない|特になし|これ以外は特にない|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/i.test(
    t
  );
}

function rawHasNonEmptyDurationLine(raw) {
  const lines = String(raw || "").split("\n");
  for (const line of lines) {
    if (/^経過時間/.test(line)) {
      const m = line.match(/:\s*(.+)$/);
      if (m && String(m[1]).trim() && !isAbsentOrUnknownSlotBulletAnswer(m[1])) return true;
    }
  }
  return false;
}

function rawHasNonEmptyWorseningTrendLine(raw) {
  const lines = String(raw || "").split("\n");
  for (const line of lines) {
    if (/^悪化傾向/.test(line)) {
      const m = line.match(/:\s*(.+)$/);
      if (m && String(m[1]).trim() && !isAbsentOrUnknownSlotBulletAnswer(m[1])) return true;
    }
  }
  return false;
}

/** 会話の自由記述に経過らしき表現があるか（Phase1 で onset 必須の補助判定） */
function rawFreeStoryImpliesDuration(raw) {
  const m = String(raw || "").match(/会話内自由記述[^:]*:\s*([^\n]+)/);
  if (!m) return false;
  return extractDurationFromText(m[1]) != null;
}

/** Phase1 JSON が採用可能か（state は付随症状の表示専用ポリシー用・省略可） */
function validateMeaningJsonPhase1(parsed, category, raw, state = null) {
  if (!parsed || typeof parsed !== "object") return false;
  const others = Array.isArray(parsed.otherSymptoms) ? parsed.otherSymptoms : [];
  const noOther = parsed.noOtherSymptoms === true;
  const slotAllowsEmptyOthersWithoutNoOtherFlag =
    state && isDisplayOnlyNoOtherSymptomsSlotCondition(state);
  if (others.length === 0 && !noOther && !slotAllowsEmptyOthersWithoutNoOtherFlag) return false;
  if (others.length > 0) {
    if (!validateOtherSymptomsJsonEntries(others)) return false;
  }
  if (category === "PAIN") {
    const symptom = String(parsed.symptom || "").trim();
    const sev = String(parsed.severity || "").trim();
    const typ = String(parsed.type || "").trim();
    if (!symptom) return false;
    if (!sev || !typ) return false;
    if (!PAIN_SEVERITY_ENUM.has(sev) || !PAIN_TYPE_ENUM.has(typ)) return false;
    if (/ズキズキする痛み|痛みだけ|する痛み$/.test(typ)) return false;
    if (/^(痛み|症状|不調)$/.test(symptom)) return false;
    const assembled = assemblePainMainSymptomFromParts(parsed);
    if (!assembled || !isPainMainSymptomStructurallyValid(assembled, parsed)) return false;
  } else {
    const main = String(parsed.main_symptom || "").trim();
    if (!main || main.length < 8) return false;
    if (/^(症状|体調不良|痛み|だるさ|おかしい)$/.test(main)) return false;
    if (/が出ている$|です$|ます$|ている$/.test(main)) return false;
    if (!isMainSymptomUxValid(main, category)) return false;
  }
  const mainFinal = String(parsed.main_symptom || "").trim();
  if (!mainFinal) return false;
  if (category === "PAIN" && !isPainMainSymptomStructurallyValid(mainFinal, parsed)) return false;
  if (!isMainSymptomUxValid(mainFinal, category)) return false;
  if (!isOnsetTrendJsonValid(parsed.onset, "onset")) return false;
  if (!isOnsetTrendJsonValid(parsed.trend, "trend")) return false;
  const ctx = String(parsed.context || "").trim();
  if (ctx && isContextContaminatedWithCause(ctx)) return false;
  const cause = String(parsed.cause || "").trim();
  if (cause && isBrokenCauseGrammarOnly(cause)) return false;
  if (cause && !/可能性$/.test(cause)) return false;
  if (/原因は不明|原因不明|わからない原因|不明のみ/.test(cause)) return false;
  if (cause && isCauseAbstractOnly(cause)) return false;
  if (hasRawCauseHintForValidation(raw) && !cause) return false;
  if (cause && isCausePhraseStillColloquiallyBad(cause)) return false;
  if (rawHasNonEmptyDurationLine(raw) || rawFreeStoryImpliesDuration(raw)) {
    const onset = String(parsed.onset || "").trim();
    if (!onset || onset === "不明") return false;
  }
  if (rawHasNonEmptyWorseningTrendLine(raw)) {
    const trend = String(parsed.trend || "").trim();
    if (!trend || trend === "不明") return false;
  }
  return true;
}

/**
 * cause を口語から書き言葉へ（例: 運動をしすぎたからかも → 運動のしすぎがきっかけの可能性）。
 * 必ず「〜の可能性」で終える。天候はブロックせず、名詞句に解釈する。
 */
function polishCausePhraseToWrittenJapanese(cause) {
  let c = String(cause || "").trim();
  if (!c) return c;
  if (/ですの可能性$|ますの可能性$|でしたの可能性$/.test(c)) {
    c = c.replace(/ですの可能性$|ますの可能性$|でしたの可能性$/, "").trim();
  }
  c = reinterpretWeatherAndEnvironmentCause(c);
  if (!c) return "";
  c = c.replace(/の可能性の可能性$/g, "の可能性");
  c = c.replace(/の可能性$/, "").trim();
  let m = c.match(/^(.+?)をしすぎたからかもがきっかけ$/);
  if (m) return `${m[1]}のしすぎがきっかけの可能性`;
  m = c.match(/^(.+?)をしすぎたからかも$/);
  if (m) return `${m[1]}のしすぎがきっかけの可能性`;
  if (/からかも$/.test(c)) {
    const head = c.replace(/からかも$/, "").trim();
    const m2 = head.match(/^(.+?)をしすぎた$/);
    if (m2) return `${m2[1]}のしすぎがきっかけの可能性`;
    if (head.length >= 2) return `${head}がきっかけの可能性`;
  }
  if (/かも$/.test(c) && !/きっかけ$/.test(c)) {
    const head = c.replace(/かも$/, "").trim();
    const m3 = head.match(/^(.+?)をしすぎた$/);
    if (m3) return `${m3[1]}のしすぎがきっかけの可能性`;
    if (head.length >= 2) return `${head}がきっかけの可能性`;
  }
  c = c.replace(/だと思う$/, "").trim();
  if (!/の可能性$/.test(c)) c = `${c}の可能性`;
  return c;
}

/** onset / trend / context / otherSymptoms の口語語尾を軽く整える（意味は維持） */
function polishMeaningJsonColloquialSentence(s) {
  let t = String(s || "").trim();
  if (!t) return t;
  t = t.replace(/(ている|です|ます|ない|ある|いる|た|だ)かも$/, "$1");
  t = t.replace(/だと思う$/, "");
  t = t.replace(/だと思います$/, "");
  return t;
}

/** Phase1 直後：組み立て・cause 語尾の正規化・各フィールドの書き言葉化 */
function normalizeMeaningJsonAfterParse(parsed, category) {
  if (!parsed || typeof parsed !== "object") return;
  if (Array.isArray(parsed.details) && parsed.details.length > 0) parsed.details = [];
  if (category === "PAIN") {
    const assembled = assemblePainMainSymptomFromParts(parsed);
    if (assembled) parsed.main_symptom = assembled;
  } else if (parsed.main_symptom) {
    parsed.main_symptom = polishMeaningJsonColloquialSentence(parsed.main_symptom);
  }
  if (parsed.onset) parsed.onset = polishMeaningJsonColloquialSentence(parsed.onset);
  if (parsed.trend) parsed.trend = polishMeaningJsonColloquialSentence(parsed.trend);
  if (parsed.context) parsed.context = polishMeaningJsonColloquialSentence(parsed.context);
  if (Array.isArray(parsed.otherSymptoms)) {
    parsed.otherSymptoms = parsed.otherSymptoms.map((x) => polishMeaningJsonColloquialSentence(String(x || "")));
  }
  const c = String(parsed.cause || "").trim();
  if (c) parsed.cause = polishCausePhraseToWrittenJapanese(c);
}

/** main_symptom のUX：抽象的・主語不明・想像できない表現を却下 */
function isMainSymptomUxValid(main, category) {
  const m = String(main || "").trim();
  const minLen = category === "PAIN" ? 5 : 8;
  if (m.length < minLen) return false;
  if (/が出ている$|です$|ます$|ている$|あった$|なった$/.test(m)) return false;
  if (/^(体調不良|不調|症状|痛み|だるさ|おかしい|違和感|気になる)$/.test(m)) return false;
  if (/(不調がある|症状がある|体調が悪い|状態が悪い)$/.test(m)) return false;
  if (/^(不調|不調な状態|体調の問題|何かしらの不調)$/.test(m)) return false;
  if (category !== "PAIN" && m.length < 12 && /^(だるさ|熱|咳|痛み)$/.test(m)) return false;
  return true;
}

/** 1行目：情報量・具体性の最低ライン（一読で状態が分かる） */
function isFirstLineInformativeEnough(firstLine, category = "PAIN") {
  const s = String(firstLine || "").replace(/^・/, "").trim();
  if (category === "PAIN") {
    if (s.length < 5) return false;
    if (/、|・|\d/.test(s)) return true;
    if (/(頭痛|腹痛|腰痛|歯痛|のど|肩|首|強さ不明|タイプ不明|ズキズキ|締め付け|重い感じ)/.test(s)) return true;
    return s.length >= 9;
  }
  if (s.length < 9) return false;
  if (/、|・|\d/.test(s)) return true;
  if (s.length >= 13) return true;
  return s.length >= 10;
}

/** 同一文内の不自然な同語連続 */
function hasUnnaturalIntraLineRepetition(s) {
  const t = String(s || "");
  return /痛みが出ている痛み|痛み痛み|ようなような|出ている出ている|症状症状/.test(t);
}

/** 箇条書き品質チェック。parsed があれば cause の反映も検証。 */
function validateStateAboutBulletsQuality(bullets, raw = "", parsed = null, category = "PAIN") {
  if (!Array.isArray(bullets) || bullets.length < 2) return false;
  const younaCount = (bullets.join(" ").match(/ような/g) || []).length;
  if (younaCount >= 2) return false;
  const first = String(bullets[0] || "").replace(/^・/, "");
  if (!isMainSymptomUxValid(first, category)) return false;
  if (!isFirstLineInformativeEnough(first, category)) return false;
  for (const b of bullets) {
    const s = String(b || "").replace(/^・/, "");
    if (hasUnnaturalIntraLineRepetition(s)) return false;
    if (/ような痛みが出ているような|ですです|。。。{2,}/.test(s)) return false;
    if (/が出ているが出ている/.test(s)) return false;
    if (/頭が痛いが出ている/.test(s)) return false;
    if (isBrokenCauseGrammarOnly(s)) return false;
  }
  const normalizedLines = bullets.map((b) =>
    String(b || "")
      .replace(/^・/, "")
      .replace(/\s+/g, "")
  );
  for (let i = 0; i < normalizedLines.length; i++) {
    for (let j = i + 1; j < normalizedLines.length; j++) {
      const a = normalizedLines[i];
      const b = normalizedLines[j];
      if (a.length < 6 || b.length < 6) continue;
      if (a === b) return false;
    }
  }
  if (hasRawCauseHintForValidation(raw)) {
    const text = bullets.join(" ");
    if (!/(可能性|影響|負担|日差し|暑さ|睡眠|画面|感染|乾燥|紫外線|ストレス|食|あたり|きっかけ)/.test(text)) return false;
  }
  if (parsed) {
    const causeJson = String(parsed.cause || "").trim();
    if (causeJson && !validateCauseCoreNounsInBullets(causeJson, bullets)) return false;
    const ctxJson = String(parsed.context || "").trim();
    if (ctxJson && !validateContextReflectedInBullets(ctxJson, bullets)) return false;
  }
  if (!validateOtherSymptomLinesAreSentences(bullets)) return false;
  return true;
}

/** cause の核名詞が箇条書きに1つ以上含まれるか。抽象のみは NG。 */
function validateCauseCoreNounsInBullets(cause, bullets) {
  const c = String(cause || "").trim();
  if (!c) return true;
  if (isCauseAbstractOnly(c)) return false;
  const cores = extractCauseCoreTokens(c);
  if (cores.length === 0) return !isCauseAbstractOnly(c);
  const joined = bullets.join("\n");
  return cores.some((core) => core.length >= 2 && joined.includes(core));
}

/** context の内容が箇条書きに反映されているか */
function validateContextReflectedInBullets(contextRaw, bullets) {
  const ctx = String(contextRaw || "").trim();
  if (!ctx) return true;
  const joined = bullets.join("\n");
  const probe = ctx.slice(0, Math.min(10, ctx.length));
  if (probe.length >= 4 && !joined.includes(probe)) return false;
  return true;
}

/** otherSymptoms 由来の行が名詞単体でないか（1行目・定型は除外） */
function validateOtherSymptomLinesAreSentences(bullets) {
  for (let i = 1; i < bullets.length; i++) {
    const s = String(bullets[i] || "").replace(/^・/, "").trim();
    if (/^症状は/.test(s)) continue;
    if (/^他の症状は|^吐き気や発熱などの他の症状は/.test(s)) continue;
    if (/^発症時より|^症状は回復|^症状は大きく|^症状は続いている$/.test(s)) continue;
    if (/可能性$|の可能性$/.test(s)) continue;
    if (/状態$|続いている|みられる|乱れている|伴っている|いる状態|ある状態/.test(s)) continue;
    if (/を伴っている|がみられる|がある|を感じている|が出て/.test(s)) continue;
    if (s.length <= 5) {
      if (
        s.length >= 2 &&
        /(悪化|改善|回復|横ばい|変わら|続い|発症|やや|強く|弱い|昨日|一昨日|今日|さっき|数時間|時間|分|週|日前|日間|続く)/.test(
          s
        )
      ) {
        continue;
      }
      return false;
    }
  }
  return true;
}

const MEANING_JSON_UNIFIED_SCHEMA = `JSONキー（details は常に []。Phase2では使わない）:
{
  "symptom": "",
  "severity": "",
  "type": "",
  "main_symptom": "",
  "details": [],
  "onset": "",
  "trend": "",
  "otherSymptoms": [],
  "noOtherSymptoms": false,
  "cause": "",
  "context": ""
}
【PAIN】symptom・severity・type は必須（不明は "不明" と明示）。main_symptom は空でもよい（サーバが組み立て）。非PAINでは symptom・severity・type は空文字でよい。
【otherSymptoms】ユーザーが1スロットの回答で複数の独立した症状を述べた場合は要素を分割（例: ["鼻詰まりの症状がある","微熱（37.1）がある"]）。1要素に「と」で複数主張を詰めない。format 後の箇条書きでは要素ごとに「・」1行（付随のみ複数行可）。`;

const MEANING_JSON_CATEGORY_HINT = {
  PAIN: `【PAIN・必須順】①symptom（例:頭痛）②severity（軽い／中程度／やや強い／強い／不明）③type（ズキズキ／重い／締め付け／その他／不明）を先に埋める。④main_symptom は上記から組み立てた名詞句（例:やや強いズキズキする頭痛）。口語の断片（例:ズキズキする）は必ず type+symptom から「〜する痛み」等の読める形に直す。禁止:type に「ズキズキする痛み」を入れること、symptom を空にすること。`,
  INFECTION: `【INFECTION】symptom・severity・type は空。main_symptom はのど・熱・だるさ等を一文で具体的に。`,
  SKIN: `【SKIN】symptom・severity・type は空。main_symptom は皮膚の状態を一文で具体的に。`,
  GI: `【GI】symptom・severity・type は空。main_symptom は腹部・消化器の主訴を一文で具体的に。`,
};

const MEANING_JSON_CAUSE_RULES = `【cause】きっかけ・原因の推測。必ず「〜の可能性」で終わる名詞句（「〜がきっかけの可能性」形式を推奨）。なければ空。禁止:「原因は不明」。核名詞を含め、「影響の可能性」だけの抽象1語は禁止。
【天候・解釈】雨・晴れ・気温などに触れる場合は、羅列や口語（「今日は雨」だけ）で終わらせず、体調へのつながりを**名詞句で**書く（例:「雨に伴う湿気がきっかけの可能性」「強い日差しや乾燥がきっかけの可能性」）。天候を書くこと自体は可。
【絶対NG・文法】「今日は雨ですの可能性」「〜ですの可能性」は禁止（「です」と「の可能性」の二重）。必ず「雨に伴う湿気がきっかけの可能性」のように解釈して書く。
【文体・必須】口語のままにしない。ユーザーが「〜かも」「〜だと思う」と言っても、書き言葉の名詞句に直してから cause に書く。
NG例:「運動をしすぎたからかも」→そのまま cause にしない／「運動をしすぎたからかもがきっかけの可能性」のような不自然な連結は禁止。
OK例:「運動のしすぎがきっかけの可能性」「雨に伴う湿気がきっかけの可能性」「睡眠不足がきっかけの可能性」。`;

const MEANING_JSON_CONTEXT_RULES = `【context】「今どういう状態か」背景・継続のみ。原因・きっかけは書かない。禁止:スマホの使いすぎ／〜の影響／長時間使用／原因／の使用 など原因語。
【文体】口語語尾（かも・かな・だと思う）のままにせず、意味を保った書き言葉の一文にする。文末を「〜状態」に揃える必要はない。単語だけ禁止。`;

/** 箇条書き1行目：痛みの強さのみ従来の固定表記（レガシーと同一）。 */
function buildPainStrengthBulletLine(state) {
  const answers = state?.slotAnswers || {};
  const val = (statusKey, fallback = "") => getSlotStatusValue(state, statusKey, fallback);
  const isUnknownLike = (text) =>
    /^(ない|なし|特にない|特になし|これ以外は特にない|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/i.test(
      String(text || "").trim()
    );
  const painScore = Number.isFinite(state?.lastPainScore)
    ? state.lastPainScore
    : (() => {
        const m = String(val("severity", answers.pain_score)).match(/(\d{1,2})/);
        return m ? Number(m[1]) : null;
      })();
  if (Number.isFinite(painScore)) {
    const level =
      painScore <= 3 ? "軽め" : painScore <= 6 ? "中程度" : painScore <= 8 ? "やや強め" : "強め";
    return `・痛みは${level}（${painScore}/10）`;
  }
  const rawSeverity = val("severity", answers.pain_score);
  if (rawSeverity && !isUnknownLike(rawSeverity)) {
    const extracted = String(rawSeverity).replace(/^痛み(は|が)?/, "").trim();
    return `・痛みは${extracted}`;
  }
  return null;
}

/** 会話履歴から historyTextForCare を同期。未設定のままだと自由記述の経過補完・Phase1 の「会話内自由記述」行が効かない（確認文直前の buildStateFactsBulletsTwoStage 等）。 */
function syncHistoryTextForCareFromConversation(state) {
  if (!state?.conversationId) return;
  const hist = conversationHistory[state.conversationId];
  if (!hist || !Array.isArray(hist)) return;
  state.historyTextForCare = hist.filter((m) => m.role === "user").map((m) => m.content).join("\n");
}

/** Phase1 入力：ラベル付きでスロットの生回答を渡す（LLM が JSON に整形）。 */
function collectRawInputsForMeaningJson(state) {
  const answers = state?.slotAnswers || {};
  const val = (k, f = "") => getSlotStatusValue(state, k, f);
  const lines = [];
  const push = (label, v) => {
    if (v && String(v).trim()) lines.push(`${label}: ${String(v).trim()}`);
  };
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state) || "PAIN";
  if (category === "PAIN") {
    const painScore = Number.isFinite(state?.lastPainScore) ? state.lastPainScore : null;
    if (painScore !== null) push("痛みの強さ", `${painScore}/10`);
    else push("痛みの強さ", val("severity", answers.pain_score));
  }
  push("症状の様子・質", val("worsening", answers.worsening));
  push("経過時間", val("duration", answers.duration));
  const durSlotOnly = String(val("duration", answers.duration) || "").trim();
  if (isAbsentOrUnknownSlotBulletAnswer(durSlotOnly)) {
    const storyProbe = String(state?.historyTextForCare || "").trim();
    const exDur = storyProbe ? extractDurationFromText(storyProbe) : null;
    if (exDur && exDur.raw_text) push("経過時間（自由記述から補完）", exDur.raw_text);
  }
  if (isDurationNotJustNow(state)) push("悪化傾向", val("worsening_trend", answers.worsening_trend));
  const rawImpact = val("impact", answers.daily_impact);
  push(
    "影響・見た目・体温など",
    pickUserPreferredPhraseOverSlotLabel(state, rawImpact) || rawImpact
  );
  if (!state?.associatedSymptomsFromFirstMessage) {
    const rawAssoc = val("associated", answers.associated_symptoms);
    push("付随症状など", pickUserPreferredPhraseOverSlotLabel(state, rawAssoc) || rawAssoc);
  }
  push("きっかけ・原因", state?.causeDetailText || val("cause_category", answers.cause_category));
  const storyCtx = String(state?.historyTextForCare || "").trim();
  if (storyCtx) {
    const clipped =
      storyCtx.length > 1500 ? `${storyCtx.slice(0, 1500)}…` : storyCtx;
    lines.push(`会話内自由記述（スロット質問前の一文も含む）: ${clipped}`);
  }
  (state?.confirmationExtraFacts || []).filter(Boolean).forEach((f) => {
    if (!isConfirmationOnlyAnswer(f) && !isRejectionOnlyAnswer(f)) lines.push(`追加情報: ${String(f).trim()}`);
  });
  return { category, raw: lines.join("\n") || "ユーザーの回答がまだありません" };
}

/**
 * 確認文表示（または確認応答後のまとめ）の直前に、ユーザー発言が state に拾えているか同期・再抽出・検証する。
 * - historyTextForCare を会話のユーザー発言の結合に一致させる
 * - 各ターン＋結合全文で applySpontaneousSlotFill を再実行（取りこぼし補完）
 * - ensureSlotFilledConsistency
 * - 履歴と raw 入力の簡易検証（不整合時はログ）
 */
function ensureUserUtterancesCapturedBeforeConfirmation(conversationId, state) {
  if (!state || !conversationId) return { ok: false, reason: "missing_state" };
  const hist = conversationHistory[conversationId];
  if (!hist || !Array.isArray(hist)) return { ok: false, reason: "missing_history" };
  const userMsgs = hist.filter((m) => m.role === "user").map((m) => String(m.content ?? ""));
  const joined = userMsgs.join("\n");
  const prevHtc = state.historyTextForCare;
  state.historyTextForCare = joined;
  const htcChanged = prevHtc !== joined;
  let spontaneousAdds = 0;
  let firstNonEmptyUser = true;
  for (const msg of userMsgs) {
    if (!String(msg).trim()) continue;
    spontaneousAdds += applySpontaneousSlotFill(state, msg, { isFirstMessage: firstNonEmptyUser });
    firstNonEmptyUser = false;
  }
  if (joined.trim()) {
    spontaneousAdds += applySpontaneousSlotFill(state, joined, { isFirstMessage: false });
  }
  ensureSlotFilledConsistency(state);
  if (htcChanged || spontaneousAdds > 0) {
    state.stateAboutBulletsCache = null;
  }
  const missing = [];
  for (let i = 0; i < userMsgs.length; i++) {
    const t = userMsgs[i].trim();
    if (t.length < 2) continue;
    if (!joined.includes(t)) missing.push(i);
  }
  if (missing.length > 0) {
    console.error("[KAIRO] ensureUserUtterancesCapturedBeforeConfirmation: user turn not contained in joined history", {
      conversationId,
      missingIndices: missing,
    });
  }
  const rawProbe = collectRawInputsForMeaningJson(state).raw;
  if (!rawProbe || rawProbe === "ユーザーの回答がまだありません") {
    console.warn("[KAIRO] ensureUserUtterancesCapturedBeforeConfirmation: Phase1 raw empty after sync", {
      conversationId,
      userTurnCount: userMsgs.length,
    });
  }
  return { ok: missing.length === 0, spontaneousAdds, joinedLength: joined.length, userTurnCount: userMsgs.length };
}

/** 確認文・まとめ用：箇条書きへ載せる対象のユーザー発言（肯定のみ・短すぎる確認は除外） */
function collectUserUtterancesForBulletCoverage(state) {
  if (!state?.conversationId) return [];
  const hist = conversationHistory[state.conversationId];
  if (!hist || !Array.isArray(hist)) return [];
  const out = [];
  for (const m of hist) {
    if (m.role !== "user") continue;
    const t = String(m.content ?? "").trim();
    if (!t) continue;
    if (isConfirmationOnlyAnswer(t)) continue;
    if (isRejectionOnlyAnswer(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * ユーザーが選択肢より後に述べた内容が、選択肢ラベルを「絞った」とみなせるときはその文を優先する。
 * 例: 選択「だるさや発熱がある」→ 後から「発熱がある」のみ → 「発熱がある」を返す（だるさを残さない）。
 */
function pickUserPreferredPhraseOverSlotLabel(state, slotLabel) {
  const s = String(slotLabel || "").trim();
  if (!s || s.length < 4) return null;
  const users = collectUserUtterancesForBulletCoverage(state);
  for (let i = users.length - 1; i >= 0; i--) {
    const u = String(users[i] || "").trim();
    if (u.length < 3) continue;
    if (u.length >= s.length) continue;
    const compactS = s.replace(/\s+/g, "");
    const compactU = u.replace(/\s+/g, "");
    if (compactS.includes(compactU)) return u;
    if (/だるさ|だるい/.test(s) && !/だる/.test(u) && /(発熱|熱がある|熱っぽい|熱が出|ねつ|高熱|微熱)/.test(u) && /(発熱|熱)/.test(s)) {
      return u;
    }
  }
  return null;
}

/** LLM: 箇条書きにまだ載っていないユーザー事実のみ。失敗時は null（呼び出し側でヒューリスティックへ）。 */
async function fetchMissingUserFactsForBulletsViaLlm(bulletText, userUtterances) {
  if (!userUtterances.length) return [];
  try {
    const clipped = userUtterances.map((u) => (u.length > 2000 ? `${u.slice(0, 1997)}…` : u));
    const prompt = [
      "あなたは会話の照合のみを行う。出力はJSONのみ。",
      "【箇条書き（現在のまとめ）】",
      String(bulletText || "").slice(0, 8000),
      "",
      "【ユーザーが会話で述べた発言（複数ターン）】",
      clipped.join("\n---\n").slice(0, 12000),
      "",
      "タスク:",
      "1) ユーザーが述べた具体的な事実（症状・経過・程度・時期・日常生活への影響・きっかけ・付随・服薬・既往の言及など）のうち、上記箇条書きに**まだ反映されていない**ものだけを列挙する。",
      "2) 同じ内容の言い換え・要約は「反映済み」とみなす。",
      "3) 主訴の核心が既に箇条書きにある場合、主訴を別行で繰り返さない（経過・付随などユーザーが別に述べた事実が欠けていれば追加）。",
      "4) 痛みスコア（例: 5/10）が箇条書きにあれば再掲しない。",
      "5) ユーザーが述べていない推測・病名の断定は禁止。",
      '6) 出力形式: {"missing":["短文1行目","短文2行目"]} 。各要素は「・」なし。書き言葉の短文。最大6件。不要なら{"missing":[]}。',
      "7) ユーザーが1文で複数の独立した事実を述べた場合は、欠けている事実をそれぞれ別要素に分けて列挙する（箇条書きでは事実ごとに1行）。",
    ].join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 450,
    });
    const text = completion?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObjectFromText(text);
    if (!parsed || !Array.isArray(parsed.missing)) return null;
    return parsed.missing
      .filter((s) => typeof s === "string" && String(s).trim())
      .map((s) => String(s).trim())
      .slice(0, 6);
  } catch (_) {
    return null;
  }
}

/** LLM 失敗時：ユーザー文を句切りし、箇条書きに無い断片だけ追補候補にする。 */
function heuristicSupplementBulletsFromUserUtterances(bullets, userLines) {
  const out = [];
  const base = Array.isArray(bullets) ? bullets.slice() : [];
  for (const u of userLines) {
    const segs = String(u)
      .split(/[。！？\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const rawSeg of segs) {
      const seg = rawSeg.replace(/[、,]+/g, " ").replace(/\s+/g, " ").trim();
      if (seg.length < 10) continue;
      if (/^(はい|うん|ええ|OK|ok|オッケー|おっけー)/i.test(seg)) continue;
      if (isConfirmationOnlyAnswer(seg)) continue;
      if (bulletLinesCoverSlotText(base, seg)) continue;
      if (out.some((o) => bulletLinesCoverSlotText([`・${o}`], seg))) continue;
      const polished = polishUserSlotForBulletLine(seg);
      if (!polished || polished.length < 8) continue;
      out.push(polished);
      base.push(`・${polished}`);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

/** 追補行を箇条書きキャッシュへマージ（重複・同趣旨は弾く）。 */
function mergeMissingBulletLinesIntoStateAboutCache(state, base, missingLines) {
  const deduped = sanitizeBulletPoints(Array.isArray(base) ? base.slice() : []);
  const seenKeys = new Set();
  for (const line of deduped) {
    const k = normalizeBulletKeyForDedupe(line);
    if (k) seenKeys.add(k);
  }
  let added = 0;
  for (const raw of missingLines || []) {
    const cleaned = String(raw || "").trim();
    if (!cleaned) continue;
    const line = /^・/.test(cleaned) ? cleaned : `・${polishUserSlotForBulletLine(cleaned)}`;
    if (line.length <= 2) continue;
    const k = normalizeBulletKeyForDedupe(line);
    if (k && seenKeys.has(k)) continue;
    if (deduped.some((b) => bulletsAreSimilar(b, line))) continue;
    const core = line.replace(/^・\s*/, "");
    if (bulletLinesCoverSlotText(deduped, core)) continue;
    if (k) seenKeys.add(k);
    deduped.push(line);
    added++;
  }
  state.stateAboutBulletsCache = injectDisplayOnlyNoOtherSymptomsBullet(deduped.slice(0, 14), state);
  return added;
}

/**
 * ユーザー発言が箇条書きに落ちているか照合し、抜けがあれば追記する。
 * LLM で不足行を列挙し、API 失敗時のみヒューリスティック。
 * 確認文とまとめの箇条書きを一致させるため、確認文表示直前とまとめ生成直前の両方で呼ぶ（二重呼びはマージで冪等）。
 */
async function supplementStateBulletsFromUncoveredUserUtterances(state) {
  if (!state?.conversationId) return { added: 0 };
  syncHistoryTextForCareFromConversation(state);
  let base =
    Array.isArray(state.stateAboutBulletsCache) && state.stateAboutBulletsCache.length > 0
      ? state.stateAboutBulletsCache.slice()
      : buildStateFactsBulletsLegacy(state, { forSummary: true });
  if (!Array.isArray(base)) base = [];
  const userLines = collectUserUtterancesForBulletCoverage(state);
  if (userLines.length === 0) {
    state.stateAboutBulletsCache = injectDisplayOnlyNoOtherSymptomsBullet(sanitizeBulletPoints(base), state);
    return { added: 0 };
  }
  const bulletPlain = base.map((b) => b.replace(/^・\s*/, "").trim()).join("\n");
  let missing = null;
  if (process.env.OPENAI_API_KEY) {
    missing = await fetchMissingUserFactsForBulletsViaLlm(bulletPlain, userLines);
  }
  if (missing === null) {
    missing = heuristicSupplementBulletsFromUserUtterances(base, userLines);
  }
  const added = mergeMissingBulletLinesIntoStateAboutCache(state, base, missing || []);
  console.log("[KAIRO] supplementStateBulletsFromUncoveredUserUtterances", {
    conversationId: state.conversationId,
    userUtteranceCount: userLines.length,
    baseBulletCount: base.length,
    missingCandidates: (missing || []).length,
    mergedAdded: added,
  });
  return { added, missingCount: (missing || []).length };
}

/** 痛み以外の行だけ（早期リトライ判定用）。 */
function collectRawSlotTextsForSimpleBullets(state) {
  const { raw, category } = collectRawInputsForMeaningJson(state);
  if (category !== "PAIN") return raw;
  return raw
    .split("\n")
    .filter((line) => !/^痛みの強さ:/.test(line))
    .join("\n");
}

/** 箇条書き用：ユーザー表現を変えず語尾等のみ軽く整える（sanitizeBulletPoints と同方針） */
function polishUserSlotForBulletLine(raw) {
  return lightBulletCleanupForUserWords(raw);
}

/** 箇条書きに既に同趣旨の文が入っているか（重複注入防止） */
function bulletLinesCoverSlotText(bullets, raw) {
  const core = String(raw || "")
    .trim()
    .replace(/です$|ます$|かも$|かな$/g, "")
    .replace(/\s+/g, "");
  if (core.length < 3) return false;
  const joined = bullets.join(" ").replace(/\s+/g, "").replace(/・/g, "");
  const probe = core.slice(0, Math.min(28, core.length));
  return joined.includes(probe);
}

/** 経過：スロットが空なら会話の自由記述から抽出（初回「頭が痛くて、5日間続いている」等） */
function getDurationTextForBullets(state) {
  const answers = state?.slotAnswers || {};
  const val = (statusKey, fallback = "") => getSlotStatusValue(state, statusKey, fallback);
  const fromSlot = val("duration", answers.duration);
  if (!isAbsentOrUnknownSlotBulletAnswer(fromSlot)) return fromSlot;
  const story = String(state?.historyTextForCare || "").trim();
  const ex = story ? extractDurationFromText(story) : null;
  return ex && ex.raw_text ? ex.raw_text : "";
}

/**
 * Phase1 が経過・悪化傾向を落とした場合の補完。スロットに実回答がある限り箇条書きに載せる。
 * @param {{ maxOut?: number }} [opts] maxOut 省略時は 8（確認文まわりでは 14 などに拡げる）
 */
function injectMissingSlotBulletsFromState(bullets, state, category, opts = {}) {
  if (!state || !Array.isArray(bullets)) return bullets;
  const maxOut = typeof opts.maxOut === "number" ? opts.maxOut : 8;
  const answers = state.slotAnswers || {};
  const val = (statusKey, fallback = "") => getSlotStatusValue(state, statusKey, fallback);
  const out = [...bullets];
  const toInsert = [];
  const duration = getDurationTextForBullets(state);
  if (!isAbsentOrUnknownSlotBulletAnswer(duration) && !bulletLinesCoverSlotText(out, duration)) {
    toInsert.push(`・${polishUserSlotForBulletLine(duration)}`);
  }
  if (isDurationNotJustNow(state)) {
    const trend = val("worsening_trend", answers.worsening_trend);
    if (!isAbsentOrUnknownSlotBulletAnswer(trend) && !bulletLinesCoverSlotText(out, trend)) {
      toInsert.push(`・${polishUserSlotForBulletLine(trend)}`);
    }
  }
  if (toInsert.length === 0) return out;
  const insertAt = out.length >= 1 ? 1 : 0;
  out.splice(insertAt, 0, ...toInsert);
  return out.slice(0, maxOut);
}

/** 確認文カバレッジ：付随の「ないです」等は表示専用行で代替するため raw 値の網羅を求めない */
function isRawSlotValueExcludedFromBulletCoverage(label, value) {
  const v = String(value || "").trim();
  const l = String(label || "").trim();
  if (!v) return true;
  if (isAbsentOrUnknownSlotBulletAnswer(v)) return true;
  if (/付随症状/.test(l) && /^(ない|なし|特にない|ないです|特にないです|これ以外は特にない|他はない)/i.test(v)) {
    return true;
  }
  if (
    /影響・見た目・体温/.test(l) &&
    /^(ない|なし|わからない|分からない|不明|ないです|特にないです)$/i.test(v)
  ) {
    return true;
  }
  if (/きっかけ・原因/.test(l) && /^(ない|なし|わからない|分からない|不明)$/i.test(v)) {
    return true;
  }
  return false;
}

/** collectRawInputsForMeaningJson の raw と照合し、箇条書きに未反映のスロット値を追記する */
function mergeRawSlotInputsIntoBullets(state, bullets) {
  const { raw } = collectRawInputsForMeaningJson(state);
  if (!raw || raw === "ユーザーの回答がまだありません") return bullets;
  const out = Array.isArray(bullets) ? [...bullets] : [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    if (/^会話内自由記述/.test(label)) continue;
    if (isRawSlotValueExcludedFromBulletCoverage(label, value)) continue;
    if (!bulletLinesCoverSlotText(out, value)) {
      const line = coerceSlotLabelAndValueToBulletLine(label, value);
      if (line) out.push(line);
    }
  }
  return out;
}

/** 上記 raw 由来で「載せるべき値」が箇条書きに含まれるか検証。不足時は値文字列の配列を返す */
function validateBulletCoverageFromRaw(state, bullets) {
  const { raw } = collectRawInputsForMeaningJson(state);
  if (!raw || raw === "ユーザーの回答がまだありません") return { ok: true, missing: [] };
  const missing = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    if (/^会話内自由記述/.test(label)) continue;
    if (isRawSlotValueExcludedFromBulletCoverage(label, value)) continue;
    if (!bulletLinesCoverSlotText(bullets, value)) missing.push(value);
  }
  const unique = [...new Set(missing)];
  return { ok: unique.length === 0, missing: unique };
}

function appendMissingRawValuesAsBullets(bullets, missingValues) {
  const out = Array.isArray(bullets) ? bullets.slice() : [];
  for (const v of missingValues || []) {
    const val = String(v || "").trim();
    if (!val) continue;
    if (bulletLinesCoverSlotText(out, val)) continue;
    out.push(`・${coerceStateAboutBulletFragmentToSentenceInner(val, null)}`);
  }
  return out;
}

/**
 * まとめ前確認文用：TwoStage/レガシー後に raw 網羅を必ず満たす（validate → 不足追記を繰り返す）。
 * state.stateAboutBulletsCache を最終形で上書きする。
 */
function enforceConfirmationBulletsCompleteness(state) {
  if (!state) return [];
  syncHistoryTextForCareFromConversation(state);
  const cat = state.triageCategory || resolveQuestionCategoryFromState(state) || "PAIN";
  let base =
    Array.isArray(state.stateAboutBulletsCache) && state.stateAboutBulletsCache.length > 0
      ? state.stateAboutBulletsCache.slice()
      : buildStateFactsBulletsLegacy(state, { forSummary: true });
  if (!Array.isArray(base)) base = [];
  base = sanitizeBulletPoints(base);
  base = injectMissingSlotBulletsFromState(base, state, cat, { maxOut: 14 }) || base;
  base = sanitizeBulletPoints(base);
  base = mergeRawSlotInputsIntoBullets(state, base);
  base = sanitizeBulletPoints(base);

  let check = validateBulletCoverageFromRaw(state, base);
  if (!check.ok) {
    base = appendMissingRawValuesAsBullets(base, check.missing);
    base = sanitizeBulletPoints(base);
  }
  check = validateBulletCoverageFromRaw(state, base);
  if (!check.ok) {
    const userLines = collectUserUtterancesForBulletCoverage(state);
    const heur = heuristicSupplementBulletsFromUserUtterances(base, userLines);
    if (heur && heur.length) {
      mergeMissingBulletLinesIntoStateAboutCache(state, base, heur);
      base = state.stateAboutBulletsCache.slice();
    }
    base = mergeRawSlotInputsIntoBullets(state, base);
    base = sanitizeBulletPoints(base);
    check = validateBulletCoverageFromRaw(state, base);
    if (!check.ok) {
      base = appendMissingRawValuesAsBullets(base, check.missing);
      base = sanitizeBulletPoints(base);
    }
  }

  state.stateAboutBulletsCache = injectDisplayOnlyNoOtherSymptomsBullet(
    sanitizeBulletPoints(base).slice(0, 18),
    state
  );
  let finalCheck = validateBulletCoverageFromRaw(state, state.stateAboutBulletsCache);
  if (!finalCheck.ok) {
    console.warn("[KAIRO] confirmation bullets coverage incomplete after enforce; appending", {
      conversationId: state.conversationId,
      missingCount: finalCheck.missing.length,
    });
    const patched = appendMissingRawValuesAsBullets(state.stateAboutBulletsCache.slice(), finalCheck.missing);
    state.stateAboutBulletsCache = injectDisplayOnlyNoOtherSymptomsBullet(
      sanitizeBulletPoints(patched).slice(0, 18),
      state
    );
    finalCheck = validateBulletCoverageFromRaw(state, state.stateAboutBulletsCache);
    if (!finalCheck.ok) {
      console.warn("[KAIRO] confirmation bullets coverage still incomplete after append", {
        conversationId: state.conversationId,
        missing: finalCheck.missing.slice(0, 10),
      });
    }
  }
  state.stateAboutBulletsCache = finalizeMeaningJsonBulletLinesForSpec(state.stateAboutBulletsCache);
  return state.stateAboutBulletsCache.slice(0, PRE_SUMMARY_CONFIRMATION_MAX_BULLETS);
}

/**
 * 箇条書き：Phase1 は統一 JSON のみ。痛みの強さ1行はサーバ固定で先頭に付与。箇条書き本文は formatBulletsFromMeaningJson で整形。
 * 性能（④）: meaning_json・supplement・まとめ要約を1プロンプト統合する案はトークン・品質トレードオフが大きいため、別途フラグ設計時に検証する。
 */
async function buildStateFactsBulletsTwoStage(state, opts = {}) {
  if (!state || !process.env.OPENAI_API_KEY) return null;
  syncHistoryTextForCareFromConversation(state);
  const painLine = buildPainStrengthBulletLine(state);
  const rawOther = collectRawSlotTextsForSimpleBullets(state);
  if (!rawOther.trim()) {
    if (!painLine) return null;
    const only = injectDisplayOnlyNoOtherSymptomsBullet([painLine], state);
    state.stateAboutBulletsCache = only;
    return only;
  }
  const { category, raw } = collectRawInputsForMeaningJson(state);
  const catHint = MEANING_JSON_CATEGORY_HINT[category] || MEANING_JSON_CATEGORY_HINT.PAIN;
  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      const prompt = [
        "Phase1のみ：JSONのみ出力。箇条書き・解説文は禁止。",
        "【文体・絶対】ユーザー発言のコピペ・丸写しは禁止。すべてのフィールドで、意味を変えずに読みやすい書き言葉の一文に整える（口語語尾のそのまま・曖昧語だけの列挙は禁止）。",
        "【バランス】無理な定型統一はしないが、「意味の通る綺麗な日本語」は必須。例 cause: ユーザー「運動をしすぎたからかも」→ cause は「運動のしすぎがきっかけの可能性」（NG: 運動をしすぎたからかもがきっかけの可能性）。",
        "【ユーザー優先】選択肢の固定ラベル（例: だるさや発熱がある）をそのまま otherSymptoms に載せない。ユーザーが後から述べた具体語だけに絞った場合は、その内容のみを反映し、選んだ選択肢より広い語を足さない。",
        "主訴の組み立て（PAIN の symptom・severity・type→main_symptom）と cause の「〜の可能性」語尾ルールは従う。",
        "例: 「ズキズキする」→ type は「ズキズキ」、symptom は部位名とし、main_symptom は「やや強いズキズキする頭痛」のように組み立て可能な名詞句にする。",
        "絶対禁止：病名の推定、抽象的すぎる主訴（例:不調がある）、details に本文を書く（details は必ず []）。",
        MEANING_JSON_UNIFIED_SCHEMA,
        MEANING_JSON_CAUSE_RULES,
        MEANING_JSON_CONTEXT_RULES,
        catHint,
        "【onset・trend】単語のみ禁止。経過・変化の事実を変えないこと。表現の型は問わない。",
        "【Phase2前提・一文必須】onset は「症状は〜から続いている／始まっている」のように主語つきの一文。trend も完結した一文。otherSymptoms は「〜がある」「〜を伴っている」で終える。main_symptom は必ず「〜が出ている」で終える。名詞だけ・時刻だけ（例:数時間前）・タイプだけ（例:ズキズキする）の onset／main は禁止。",
        "【必須・漏れ禁止】ラベル付きのユーザー回答（痛みの強さ・症状の様子・経過・悪化傾向・影響・付随・きっかけ等）に具体値がある項目は、JSON と format 後の箇条書きの双方に必ず反映する（省略・丸ごと落としは禁止。不明のみ「不明」と明示）。",
        "【必須】ユーザー回答に「経過時間:」があり、空・ない・わからない以外であれば onset に必ず書く（JSON で空にしない）。「悪化傾向:」がある場合は trend に必ず書く。",
        "悪化の表現は緊急度判定用に強い語を使わなくてよい。ユーザーが述べた内容・語彙をそのまま活かし、語尾だけを整える程度に（「発症時より〜」などの定型への言い換えはしない。事実を変えないこと）。",
        "【otherSymptoms】各要素は完結した文。名詞単体禁止。付随なしなら otherSymptoms:[] と noOtherSymptoms:true。",
        "【箇条書き・スロットと行】経過（onset）・悪化傾向（trend）・影響・原因・背景（context）は、format 後の箇条書きでは各スロットにつき「・」で始まる行が1行だけ（同一スロット由来で「・」が複数行続かない）。例外：付随（otherSymptoms）のみ、JSON の要素数どおり症状ごとに「・」を複数行に分けてよい。context は複数事実があっても1行の完結した文にまとめる。",
        "例外（サーバが表示専用で1行付与）: PAIN で付随「これ以外は特にない」、GI で「特に変化はない」は otherSymptoms:[]・noOtherSymptoms:false。",
        "自由記述は 状態→時間→強さ→原因 の順で解釈。PAIN は symptom・severity・type を先に決める。",
        "同一文に主症状と経過が混ざる場合（例:頭が痛くて5日続いている）は main_symptom に主症状のみ、onset に経過のみ。format 後の箇条書きで主症状を二重にしない。",
        "【PAIN・箇条書き】サーバは痛みの強さ行の次に「痛みの質＋symptom名詞（頭痛など）」の1行のみを出す。main_symptom をそのまま重ねた「頭が痛いが出ている」のような二重行は禁止。symptom フィールドは名詞（頭痛）にし、「頭が痛い」のままにしない。otherSymptoms に主症状と同じ内容を入れない。",
        "【cause・JSON】天候に言及する場合は cause に「〜がきっかけの可能性」形式の名詞句のみ（例: 雨に伴う湿気がきっかけの可能性）。「今日は雨ですの可能性」のような文法破綻は禁止。",
        "「追加情報:」行は otherSymptoms または context に必ず反映。",
        "",
      ].join("\n");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `主症状カテゴリ: ${category}\n\nユーザー回答:\n${raw}` },
        ],
        temperature: 0.15 + attempt * 0.04,
        max_tokens: 500,
      });
      const rawText = completion?.choices?.[0]?.message?.content || "";
      const parsed = parseJsonObjectFromText(rawText);
      if (!parsed || typeof parsed !== "object") continue;
      normalizeMeaningJsonAfterParse(parsed, category);
      applyDisplayOnlyNoOtherSymptomsSlotJsonPolicy(parsed, state);
      if (!validateMeaningJsonPhase1(parsed, category, raw, state)) continue;
      const bullets = formatBulletsFromMeaningJson(parsed, category);
      if (bullets.length < 2) continue;
      let sanitized = sanitizeBulletPoints(bullets);
      sanitized = injectMissingSlotBulletsFromState(sanitized, state, category, { maxOut: 14 });
      sanitized = sanitizeBulletPoints(sanitized);
      if (sanitized.length < 2) continue;
      if (!validateStateAboutBulletsQuality(sanitized, raw, parsed, category)) continue;
      const combined = painLine ? [painLine, ...sanitized] : sanitized;
      const finalWithInject = injectDisplayOnlyNoOtherSymptomsBullet(combined, state);
      state.stateAboutBulletsCache = finalWithInject;
      return finalWithInject;
    } catch (_) {
      /* retry */
    }
  }
  return null;
}

/** 情報整理ブロック：2段階生成を優先。キャッシュがなければ従来ロジック。forSummary: true のときは箇条書きのみ。 */
function buildStateFactsBullets(state, opts = {}) {
  if (state?.stateAboutBulletsCache?.length > 0) {
    const cached = state.stateAboutBulletsCache;
    if (opts?.forSummary) return cached;
    // 付随「これ以外は特にない」等のときは前後の説明文を付けず箇条書きのみ（表示専用ポリシーと一致）
    if (isDisplayOnlyNoOtherSymptomsSlotCondition(state)) return cached;
    return ["今の情報から見ると、", "", ...cached, "", "という状況です。"];
  }
  return buildStateFactsBulletsLegacy(state, opts);
}

/** 従来のテンプレベース生成（2段階失敗時のフォールバック） */
function buildStateFactsBulletsLegacy(state, opts = {}) {
  const answers = state?.slotAnswers || {};
  const val = (statusKey, fallback = "") => getSlotStatusValue(state, statusKey, fallback);
  const isUnknownLike = (text) =>
    /^(ない|なし|特にない|特になし|これ以外は特にない|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/i.test(
      String(text || "").trim()
    );
  const shouldHide = (text) =>
    /^(ない|なし|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/i.test(
      String(text || "").trim()
    );
  const lines = [];
  const pushIfValid = (line) => {
    const normalized = String(line || "").trim();
    if (!normalized) return;
    if (/^・\s*$/.test(normalized)) return;
    if (!lines.includes(normalized)) lines.push(normalized);
  };

  // 1) 痛みスコア（解釈）— buildPainStrengthBulletLine と同一
  const painLineLegacy = buildPainStrengthBulletLine(state);
  if (painLineLegacy) pushIfValid(painLineLegacy);

  // 2) 症状の様子（スロット文を書き言葉に整えて載せる）
  const worsening = val("worsening", answers.worsening);
  if (worsening && !isUnknownLike(worsening)) {
    const w = polishMeaningJsonColloquialSentence(
      String(worsening).trim().replace(/です$|ます$/, "")
    );
    if (w.length >= 2) pushIfValid(`・${w}`);
  }

  // 3) 経過時間
  const duration = val("duration", answers.duration);
  if (duration && !isUnknownLike(duration)) {
    const d = polishMeaningJsonColloquialSentence(
      String(duration).trim().replace(/です$|ます$/, "")
    );
    if (d.length >= 1) pushIfValid(`・${d}`);
  }

  // 3.5) 悪化傾向（さっき以外のみ）
  if (isDurationNotJustNow(state)) {
    const trend = val("worsening_trend", answers.worsening_trend);
    if (trend && !isUnknownLike(trend)) {
      const t = polishMeaningJsonColloquialSentence(
        String(trend).trim().replace(/です$|ます$/, "")
      );
      if (t.length >= 2) pushIfValid(`・${t}`);
    }
  }

  // 4) 日常生活・体温など
  const impactSlot = val("impact", answers.daily_impact);
  const impact =
    pickUserPreferredPhraseOverSlotLabel(state, impactSlot) || impactSlot;
  if (impact && !isUnknownLike(impact) && !shouldHide(impact)) {
    const category = state?.triageCategory || "PAIN";
    const rawImpact = polishMeaningJsonColloquialSentence(
      String(impact).trim().replace(/です$|ます$/, "")
    );
    if (category === "INFECTION") {
      const temp = rawImpact;
      if (/平熱|37度未満/.test(temp)) {
        pushIfValid("・体温は平熱に近い");
      } else if (/37|微熱/.test(temp)) {
        const m = temp.match(/(\d+\.?\d*)\s*度/);
        pushIfValid(m ? `・体温は${m[1]}度である` : "・微熱（37度台）がある");
      } else if (/38|高熱/.test(temp)) {
        pushIfValid("・38度以上の発熱がある");
      } else {
        pushIfValid(`・${temp}`);
      }
    } else {
      pushIfValid(`・${rawImpact}`);
    }
  }

  // 5) 付随症状
  if (!state?.associatedSymptomsFromFirstMessage) {
    const assocSlot = val("associated", answers.associated_symptoms);
    const associated = pickUserPreferredPhraseOverSlotLabel(state, assocSlot) || assocSlot;
    const aNorm = String(associated || "").trim();
    if (isPainCategorySlot4NoneSelected(state) || isGiCategorySlot5NoneSelected(state)) {
      // 「吐き気や発熱などの他の症状は…」は inject で付与（判定・LLM参照と分離）
    } else if (/(特にない|特になし|これ以外は特にない|特にありません|ないです)/.test(aNorm)) {
      pushIfValid("・吐き気や発熱などの他の症状は今のところ見られていない");
    } else if (associated && !isUnknownLike(associated)) {
      const a = polishMeaningJsonColloquialSentence(aNorm.replace(/です$|ます$/, ""));
      if (a.length >= 2) pushIfValid(`・${a}`);
    }
  }

  // 6) きっかけ（口語→書き言葉に整えてから一行に。LLM 経路と同じ polish）
  const cause = val("cause_category", state?.causeDetailText || answers.cause_category);
  if (cause && !isUnknownLike(cause)) {
    const polished = polishCausePhraseToWrittenJapanese(String(cause).trim());
    if (polished) pushIfValid(`・${polished}`);
  }

  // 追加事実（確認で得た情報）は LLM 箇条書き経路（buildStateFactsBulletsTwoStage）と merge で取り込む。legacy では追加しない。

  const rawBullets = lines.slice(0, 6);
  let bullets = sanitizeBulletPoints(rawBullets);
  bullets = injectDisplayOnlyNoOtherSymptomsBullet(bullets, state);
  if (bullets.length === 0) return [];
  if (opts?.forSummary) return bullets;
  if (isDisplayOnlyNoOtherSymptomsSlotCondition(state)) return bullets;
  return ["今の情報から見ると、", "", ...bullets, "", "という状況です。"];
}

/** 確認文への肯定・否定のみの返答（箇条書きに書かない）。まとめをそのまま表示する。 */
function isConfirmationOnlyAnswer(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^(ない|なし|特になし|とくにない|特になく|とくになく)$/i.test(t)) return true;
  if (/^(ないです|ありません|特にないです|特にありません|別にない|別になし|追加はない|追加なし|全くない|全然ない|何もない)$/i.test(t)) return true;
  if (/^(はい|うん|ええ|おっけー|おk|OK|ok|オッケー|よろしい|合ってる|合ってます|合っています|あってる|あってます|あっています|いいです|いいよ|問題ない|問題ないです|問題ありません|それでいい|それでいいです|大丈夫|大丈夫です|そうです|そうですね|その通り|そのとおり|その通りです|正しい|正しいです|正解|間違いない|間違いありません|了解|了解です|了解しました|承知|承知しました|かしこまりました)$/i.test(t)) return true;
  if (/^(分かりました|わかりました|そのままでいい|そのままで大丈夫|これでお願いします|思い当たらない|特に思い当たらない)$/i.test(t)) return true;
  if (/^(はい|うん|ええ)[、,]?\s*(あってる|あっています|合ってる|合っています|大丈夫|大丈夫です|そうです|その通り)/i.test(t)) return true;
  if (/^(はい|うん|ええ)[、,]?\s*(特にない|特にありません|ないです|ありません|特になし)/i.test(t)) return true;
  if (/^(うん|はい|ええ)[、。]?\s*(ない|なし|特になし)/i.test(t)) return true;
  return false;
}

/** 確認文への否定のみの返答（違う等。箇条書きには書かず、まとめ再生成のトリガーにする） */
function isRejectionOnlyAnswer(text) {
  const t = String(text || "").trim();
  return /^(違う|間違っている|違います|違ってる|違ってます|ちょっと違う|少し違う)$/i.test(t);
}

const PRE_SUMMARY_CONFIRMATION_PHRASES = [
  "この理解で合っていますか？",
  "大きくずれていないかだけ確認させてください。",
  "この内容で問題なさそうでしょうか？",
  "合っていますか？",
  "これでよろしいですか？",
];

const PRE_SUMMARY_ADD_MORE_PHRASES = [
  "もし補足があれば教えてください。",
  "抜けていることがあれば遠慮なく教えてください。",
  "もしまだ足りないことがあれば教えてください。",
  "他に伝えたいことがあれば教えてください。",
];

/** 会話の最初のユーザー発言（初回ヒアリングの根拠） */
function getFirstUserMessageTextForState(state) {
  if (!state?.conversationId) return "";
  const hist = conversationHistory[state.conversationId];
  if (!hist || !Array.isArray(hist)) return "";
  const u = hist.find((m) => m.role === "user");
  return u ? String(u.content || "").trim() : "";
}

/**
 * ② 一時的な〇〇：初回安全文の toMainSymptomLabelForSafety と同一ラベルを必ず使う（KAIRO_SPEC 650）。
 * primarySymptom や箇条書き由来の短語に上書きされないよう、初回応答時に保存した safetyIntroMainSymptomLabel を最優先。
 */
function greenYellowPatternNounForTemporary(state) {
  const pinned = String(state?.safetyIntroMainSymptomLabel || "").trim();
  if (pinned) return pinned;
  const firstUser = getFirstUserMessageTextForState(state);
  if (firstUser) {
    const fromFirst = toMainSymptomLabelForSafety(firstUser);
    if (fromFirst && fromFirst !== "症状") return fromFirst;
  }
  const m = compactMainSymptomNounForRed(state);
  if (m && m !== "症状") return m;
  return "体調不良";
}

function stripBulletLead(line) {
  return String(line || "").replace(/^・\s*/, "").trim();
}

/** 組み合わせ「〇〇」1つあたりの最大文字数（超過時は末尾を「…」で省略し、表示は最大この長さに収める） */
const KAIRO_COMBO_SHORT_LABEL_MAX_CHARS = 8;

/**
 * KAIRO_SPEC.md 「短い語への要約」（§7.1.1・組み合わせ行・647 行付近）。
 * 箇条書き1行相当の文字列を、組み合わせ「〇〇」用に短くする（痛み方の語を落とす等）。
 * 組み合わせ行を出力する直前に必ず通す（🟢🟡①・🔴「同時に出ている」・RED 抑制ガードの経過ラベル等、例外なし）。
 */
function applyKairoSpec647ComboShortLabelFilter(raw) {
  let s = stripBulletLead(String(raw || "")).replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s
    .replace(/が出ている$|がある$|を伴っている$|見られている$|である$/g, "")
    .trim();
  if (/^痛みは/.test(s)) {
    const m = s.match(/(\d+)\s*\/\s*10/);
    const n = m ? Number(m[1]) : 0;
    if (n >= 8) return "強い痛み";
    if (n >= 5) return "やや強い痛み";
    return "痛みの強さ";
  }
  const ono =
    "ズキズキ|キリキリ|ヒリヒリ|チクチク|ジンジン|ドクドク|鈍い|刺す|締め付け|重い感じの|締め付けられるような";
  const reOnlyQuality = new RegExp(`^(${ono})(?:する)?(?:痛み)?$`);
  const reNoYona = new RegExp(`^(${ono})のような痛み$`);
  if (reNoYona.test(s)) s = s.replace(reNoYona, "$1");
  else if (reOnlyQuality.test(s)) s = s.replace(reOnlyQuality, "$1");
  s = s.replace(
    new RegExp(`^(軽い|中程度|やや強い|強い)(?:の)?(?:${ono})(?:する)?(?=頭痛|腹痛|歯痛|腰痛|のど|喉|咽頭|痛み)`),
    "$1"
  );
  s = s.replace(
    new RegExp(`^(${ono})(?:する)?(頭痛|腹痛|歯痛|腰痛|のど|喉|咽頭|痛み)$`),
    "$1"
  );
  if (s.length > KAIRO_COMBO_SHORT_LABEL_MAX_CHARS) {
    s = `${s.slice(0, KAIRO_COMBO_SHORT_LABEL_MAX_CHARS - 1)}…`;
  }
  return s.trim();
}

/** @deprecated 呼び出し互換。中身は applyKairoSpec647ComboShortLabelFilter と同一。 */
function shortenComboLabelFromBulletText(raw) {
  return applyKairoSpec647ComboShortLabelFilter(raw);
}

/** 組み合わせ行に載せる最終ラベル（647 フィルタを必ず適用。空になったときは元を残す） */
function finalizeComboLabelForCombinationLine(label) {
  const t = String(label || "").trim();
  if (!t) return "";
  const shortened = applyKairoSpec647ComboShortLabelFilter(t);
  return shortened || t;
}

/** 組み合わせ行の逆優先度：きっかけ・痛み方はなるべく出さない（数値が高いほど先に採用） */
const COMBO_INV_PRI_CAUSE = 8;
const COMBO_INV_PRI_PAIN_TYPE = 10;
const COMBO_INV_PRI_NORMAL = 88;

function inferComboBulletInverseKind(s) {
  const t = String(s || "");
  if (/^痛みは\s*\d+\s*\/\s*10/.test(t)) return "pain_score";
  if (
    /可能性|きっかけ|負担の可能性|影響している|ストレス|睡眠不足|寝不足|スマホ|画面|食事|運動|きっかけは|思い当たる/.test(
      t
    )
  ) {
    return "cause";
  }
  if (
    /のような痛み|する痛み|タイプの痛み|痛み方|締め付けられる|ズキズキ|キリキリ|ヒリヒリ|チクチク|ジンジン|ドクドク/.test(
      t
    )
  ) {
    return "pain_type";
  }
  return "other";
}

function inversePriorityForComboKind(kind) {
  if (kind === "cause") return COMBO_INV_PRI_CAUSE;
  if (kind === "pain_type") return COMBO_INV_PRI_PAIN_TYPE;
  if (kind === "pain_score") return 83;
  return COMBO_INV_PRI_NORMAL;
}

/** 候補 {label, inv} を逆優先度で並べ、2〜3 個を選ぶ（不足時は低優先も使用） */
function pickComboPartsByInversePriority(candidates, min = 2, max = 3) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const seen = new Set();
  const norm = (c) => {
    const lab = String(c.label || "").trim();
    if (!lab || seen.has(lab)) return null;
    seen.add(lab);
    return { label: lab, inv: Number.isFinite(c.inv) ? c.inv : COMBO_INV_PRI_NORMAL };
  };
  const list = candidates.map(norm).filter(Boolean);
  if (list.length === 0) return [];
  const high = [...list].sort((a, b) => b.inv - a.inv);
  const out = [];
  for (const x of high) {
    if (out.length >= max) break;
    out.push(x.label);
  }
  if (out.length >= min) return out.slice(0, max);
  const low = [...list].sort((a, b) => a.inv - b.inv);
  for (const x of low) {
    if (out.length >= min) break;
    if (!out.includes(x.label)) out.push(x.label);
  }
  return out.slice(0, max);
}

/**
 * 🟢🟡 組み合わせ：スロットが LOW〜MEDIUM 相当か、slotNormalized 未設定でも回答済みで HIGH でない。
 * 箇条書きに行が無くても、選択で埋まったスロットを候補に使う（KAIRO_SPEC）。
 */
function comboSlotAllowsLowMediumFromSelection(state, slotKey) {
  if (!state || !slotKey) return false;
  const r = state.slotNormalized?.[slotKey]?.riskLevel;
  if (r === RISK_LEVELS.HIGH) return false;
  if (r === RISK_LEVELS.LOW || r === RISK_LEVELS.MEDIUM) return true;
  if (state.slotFilled?.[slotKey]) {
    return r !== RISK_LEVELS.HIGH;
  }
  return false;
}

/**
 * 🟢🟡 ① 組み合わせ：通常は LOW〜MEDIUM のみ。KAIRO_SPEC 658〜「風の初期症状」例外時は HIGH も含め、埋まったスロットを①に必ず載せる。
 */
function comboSlotAllowsGreenYellowCombo(state, slotKey) {
  if (!state || !slotKey) return false;
  if (shouldUseWindyColdOnsetPatternForStateAbout(state)) {
    return !!state.slotFilled?.[slotKey];
  }
  return comboSlotAllowsLowMediumFromSelection(state, slotKey);
}

/**
 * まとめ箇条書きから 🟢🟡 組み合わせ用候補 {label, inv}。主症状行（通常は先頭 or 痛み行の次）は除外。
 */
function gatherGreenYellowComboCandidatesFromBullets(state) {
  const raw = state?.stateAboutBulletsCache;
  const norm = state?.slotNormalized || {};
  if (!Array.isArray(raw) || raw.length < 1) return [];
  const main = compactMainSymptomNounForRed(state);
  const hasPainHead = raw[0] && /^痛みは\s*\d+\s*\/\s*10/.test(stripBulletLead(raw[0]));
  const mainSymptomLineIdx = hasPainHead ? 1 : 0;
  const candidates = [];
  for (let i = 0; i < raw.length; i++) {
    if (i === mainSymptomLineIdx) continue;
    const rawLine = stripBulletLead(raw[i]);
    if (!rawLine) continue;
    if (main && main !== "症状" && rawLine === main) continue;
    if (/^痛みは\s*\d+\s*\/\s*10/.test(rawLine)) {
      if (!comboSlotAllowsGreenYellowCombo(state, "pain_score")) continue;
      const short = shortenComboLabelFromBulletText(rawLine);
      if (short) candidates.push({ label: short, inv: inversePriorityForComboKind("pain_score") });
      continue;
    }
    const kind = inferComboBulletInverseKind(rawLine);
    if (kind === "cause") {
      if (!comboSlotAllowsGreenYellowCombo(state, "cause_category")) continue;
    }
    if (kind === "pain_type") {
      if (!comboSlotAllowsGreenYellowCombo(state, "worsening")) continue;
    }
    const short = shortenComboLabelFromBulletText(rawLine);
    if (!short) continue;
    let inv = inversePriorityForComboKind(kind);
    if (kind === "other" && /悪化|回復|続い|経過|さっき|時間|微熱|平熱|体温|付随|症状/.test(short)) {
      inv = Math.max(inv, 86);
    }
    candidates.push({ label: short, inv });
  }
  return candidates;
}

/**
 * 箇条書きから 🔴 組み合わせ用候補。**HIGH スロットに対応する行だけ**（主症状行は除外）。
 */
function gatherRedHighComboCandidatesFromBullets(state) {
  const raw = state?.stateAboutBulletsCache;
  const norm = state?.slotNormalized || {};
  if (!Array.isArray(raw) || raw.length < 1) return [];
  const main = compactMainSymptomNounForRed(state);
  const hasPainHead = raw[0] && /^痛みは\s*\d+\s*\/\s*10/.test(stripBulletLead(raw[0]));
  const mainSymptomLineIdx = hasPainHead ? 1 : 0;
  const candidates = [];
  for (let i = 0; i < raw.length; i++) {
    if (i === mainSymptomLineIdx) continue;
    const rawLine = stripBulletLead(raw[i]);
    if (!rawLine) continue;
    if (main && main !== "症状" && rawLine === main) continue;
    if (/^痛みは\s*\d+\s*\/\s*10/.test(rawLine)) {
      if (norm.pain_score?.riskLevel !== RISK_LEVELS.HIGH) continue;
      const short = shortenComboLabelFromBulletText(rawLine);
      if (short) candidates.push({ label: short, inv: inversePriorityForComboKind("pain_score") });
      continue;
    }
    const kind = inferComboBulletInverseKind(rawLine);
    if (kind === "cause") {
      if (norm.cause_category?.riskLevel !== RISK_LEVELS.HIGH) continue;
      candidates.push({
        label: shortenComboLabelFromBulletText(rawLine),
        inv: COMBO_INV_PRI_CAUSE,
      });
      continue;
    }
    if (kind === "pain_type") {
      if (norm.worsening?.riskLevel !== RISK_LEVELS.HIGH) continue;
      candidates.push({
        label: shortenComboLabelFromBulletText(rawLine),
        inv: COMBO_INV_PRI_PAIN_TYPE,
      });
      continue;
    }
    let inv = COMBO_INV_PRI_NORMAL;
    if (/(発熱|熱|微熱|高熱|体温|平熱)/.test(rawLine)) {
      if (norm.daily_impact?.riskLevel !== RISK_LEVELS.HIGH) continue;
      inv = 92;
    } else if (/(だるさ|倦怠|吐き気|咳|息苦し|悪化傾向|悪化|付随|日常生活)/.test(rawLine)) {
      if (norm.associated_symptoms?.riskLevel === RISK_LEVELS.HIGH) inv = 94;
      else if (norm.worsening_trend?.riskLevel === RISK_LEVELS.HIGH && /悪化/.test(rawLine)) inv = 90;
      else if (norm.duration?.riskLevel === RISK_LEVELS.HIGH && /続|長く|日|週/.test(rawLine)) inv = 88;
      else continue;
    } else {
      continue;
    }
    const short = shortenComboLabelFromBulletText(rawLine);
    if (short) candidates.push({ label: short, inv });
  }
  return candidates;
}

/**
 * 🟢🟡「① 状態の定義」：LOW〜MEDIUM のみ。箇条書き候補＋スロット候補をマージし、きっかけ・痛み方は逆優先度で後回し（KAIRO_SPEC）。
 */
function collectGreenYellowLowMediumCombinationParts(state) {
  const candidates = [];
  const bulletCands = gatherGreenYellowComboCandidatesFromBullets(state);
  if (bulletCands.length) candidates.push(...bulletCands);

  const main = compactMainSymptomNounForRed(state);
  const isMainLabel = (t) => main && main !== "症状" && String(t || "").trim() === main;

  const pain = Number.isFinite(state?.lastPainScore) ? state.lastPainScore : null;
  if (comboSlotAllowsGreenYellowCombo(state, "pain_score") && pain !== null && main && main !== "症状") {
    let p1;
    if (pain <= 3) p1 = `軽い${main}`;
    else if (pain <= 6) p1 = `中程度の${main}`;
    else if (pain <= 8) p1 = `やや強い${main}`;
    else p1 = `強い${main}`;
    candidates.push({ label: p1, inv: 84 });
  }

  const dailyRaw = String(
    state?.slotAnswers?.daily_impact || getSlotStatusValue(state, "impact", state?.slotAnswers?.daily_impact || "") || ""
  ).trim();
  if (comboSlotAllowsGreenYellowCombo(state, "daily_impact")) {
    if (/38|高熱|39|40/.test(dailyRaw)) candidates.push({ label: "高めの体温", inv: 87 });
    else if (/37|微熱/.test(dailyRaw)) candidates.push({ label: "微熱", inv: 87 });
    else if (/平熱|36/.test(dailyRaw)) candidates.push({ label: "平熱に近い体温", inv: 86 });
    else if (dailyRaw && !/^(ない|なし|特に)/.test(dailyRaw)) {
      const polished = polishMeaningJsonColloquialSentence(dailyRaw.replace(/です$|ます$/, ""));
      if (polished && polished.length < 28) candidates.push({ label: polished, inv: 86 });
    }
  }

  const trendRaw = String(
    getSlotStatusValue(state, "worsening_trend", state?.slotAnswers?.worsening_trend || "") || ""
  ).trim();
  if (comboSlotAllowsGreenYellowCombo(state, "worsening_trend")) {
    if (/回復|改善|まし|楽にな/.test(trendRaw)) candidates.push({ label: "回復に向かっている", inv: 87 });
    else if (/変わらない|横ばい|同じ/.test(trendRaw)) candidates.push({ label: "悪化していない", inv: 87 });
    else if (/悪化|発症時より/.test(trendRaw) && !/ない/.test(trendRaw)) candidates.push({ label: "悪化傾向", inv: 86 });
    else if (trendRaw) {
      const p = polishMeaningJsonColloquialSentence(trendRaw.replace(/です$|ます$/, ""));
      if (p) candidates.push({ label: p, inv: 86 });
    }
  }

  if (comboSlotAllowsGreenYellowCombo(state, "worsening")) {
    const wRaw = String(getSlotStatusValue(state, "worsening", state?.slotAnswers?.worsening || "") || "").trim();
    if (wRaw) {
      const p = polishMeaningJsonColloquialSentence(wRaw.replace(/です$|ます$/, "").slice(0, 24));
      if (p) candidates.push({ label: p, inv: COMBO_INV_PRI_PAIN_TYPE });
    }
  }

  if (comboSlotAllowsGreenYellowCombo(state, "duration")) {
    const dur = String(getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "") || "").trim();
    if (!shouldBlockRedByRecentShortDuration(state)) {
      if (dur && /(さっき|数時間前|数十分|今さっき)/.test(dur)) candidates.push({ label: "発症から時間が短い", inv: 85 });
      else if (dur && /(日|週|昨日|一昨日|一日以上)/.test(dur)) candidates.push({ label: "症状が続いている", inv: 85 });
    }
  }
  if (shouldBlockRedByRecentShortDuration(state)) {
    const sp = buildDurationTemporaryPossibilityLabelForRedGuard(state);
    if (sp && !candidates.some((c) => /一時的な可能性/.test(String(c.label || "")))) {
      candidates.push({ label: sp, inv: 92 });
    }
  }

  if (comboSlotAllowsGreenYellowCombo(state, "cause_category")) {
    const cr = String(state?.slotAnswers?.cause_category || "").trim();
    if (cr && !/^(ない|なし|思い当たらない|わからない|不明)/.test(cr)) {
      const p = polishMeaningJsonColloquialSentence(cr.replace(/です$|ます$/, "").slice(0, 22));
      if (p) candidates.push({ label: p, inv: COMBO_INV_PRI_CAUSE });
    }
  }

  if (comboSlotAllowsGreenYellowCombo(state, "associated_symptoms") && !isDisplayOnlyNoOtherSymptomsSlotCondition(state)) {
    const assocRaw = String(
      state?.slotAnswers?.associated_symptoms || getSlotStatusValue(state, "associated", "") || ""
    ).trim();
    if (assocRaw && !/^(ない|なし|特にない|これ以外は特にない|特に変化はない)/i.test(assocRaw)) {
      const p = polishMeaningJsonColloquialSentence(assocRaw.replace(/です$|ます$/, "").slice(0, 28));
      if (p) candidates.push({ label: p, inv: 86 });
    }
  }

  const comboMaxParts = shouldBlockRedByRecentShortDuration(state) ? 2 : 3;
  const applyRedGuardComboFilter = (arr) => filterComboCandidatesForRedGuardOnset(arr, state);

  let picked = pickComboPartsByInversePriority(applyRedGuardComboFilter(candidates), 2, comboMaxParts);
  if (picked.length >= 2) return picked;

  const parts = [];
  const seen = new Set();
  const push = (s) => {
    const t = String(s || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    parts.push(t);
  };
  const combinedText = [
    state?.historyTextForCare || "",
    state?.slotAnswers?.associated_symptoms || "",
    (buildStateFactsBullets(state, { forSummary: true }) || []).join(" "),
  ].join(" ");
  try {
    const feats = extractFeatures(combinedText);
    for (const a of feats.associatedSymptoms || []) {
      if (!isMainLabel(a)) push(a);
      if (parts.length >= 3) break;
    }
  } catch (_) {
    /* ignore */
  }
  if (parts.length) {
    const extra = parts.map((p) => ({ label: shortenComboLabelFromBulletText(p) || p, inv: 72 }));
    candidates.push(...extra);
  }
  picked = pickComboPartsByInversePriority(applyRedGuardComboFilter(candidates), 2, comboMaxParts);
  if (picked.length >= 2) return picked;

  const mainSafe = main && main !== "症状" ? main : "症状の出方";
  candidates.push(
    { label: `${mainSafe}に関する所見は限定的`, inv: 55 },
    { label: "急いで受診が必要な所見は見えにくい", inv: 54 },
    { label: "付随の所見は限定的", inv: 53 }
  );
  return pickComboPartsByInversePriority(applyRedGuardComboFilter(candidates), 2, comboMaxParts);
}

/**
 * PAIN/INFECTION・4問目付随で咳・鼻詰まり等が回答に含まれるか（複合「発熱と咳」も含む）。
 * KAIRO_SPEC：②の意味文を「風の初期症状としてよく見られるパターンです」に固定する条件の一部。
 */
function associatedSymptomsImpliesCoughOrNasalForWindPattern(state) {
  const raw = String(state?.slotAnswers?.associated_symptoms || "").trim();
  if (!raw) return false;
  if (raw === "咳や鼻詰まりがある") return true;
  if (/(咳や鼻詰まり|鼻づまり|鼻詰まり|くしゃみ|痰)/.test(raw)) return true;
  if (/咳|せき/.test(raw)) {
    if (/咳はない|咳は出ない|咳がない|せきはない|咳は出ません|咳は出ていない/.test(raw)) return false;
    return true;
  }
  if (/鼻|詰まり/.test(raw)) {
    if (/鼻は詰まらない|鼻は詰まってない|鼻はつまってない|詰まりはない/.test(raw)) return false;
    return true;
  }
  return false;
}

/**
 * 🤝🟢🟡 ②「一時的な〇〇として〜」の代わりに「風の初期症状としてよく見られるパターンです」を使うか。
 * PAIN/INFECTION かつ（喉主症状、または4問目で咳・鼻詰まり等）。
 */
function shouldUseWindyColdOnsetPatternForStateAbout(state) {
  if (!state) return false;
  const cat = state.triageCategory || resolveQuestionCategoryFromState(state);
  if (cat !== "PAIN" && cat !== "INFECTION") return false;
  const hist = String(state.historyTextForCare || "");
  const primary = String(state.primarySymptom || "");
  if (isThroatMainSymptom(hist) || isThroatMainSymptom(primary)) return true;
  return associatedSymptomsImpliesCoughOrNasalForWindPattern(state);
}

/** 🤝🟢🟡 専用：共感廃止・3 ブロック固定（KAIRO_SPEC） */
function buildGreenYellowStateAboutBlock(state) {
  const rawParts = collectGreenYellowLowMediumCombinationParts(state);
  const parts = rawParts.map((p) => finalizeComboLabelForCombinationLine(p)).filter(Boolean);
  const comboInner = parts.map((p) => `「${p}」`).join("＋");
  if (shouldUseWindyColdOnsetPatternForStateAbout(state)) {
    return [
      `${comboInner}状態です。`,
      "この組み合わせは、",
      "風の初期症状としてよく見られるパターンです。",
      "👉 今すぐ受診が必要な状態ではありません",
      "👉 まずは休んで様子を見る判断で問題ありません",
    ].join("\n");
  }
  const noun = greenYellowPatternNounForTemporary(state);
  return [
    `${comboInner}状態です。`,
    "この組み合わせは、",
    `一時的な${noun}としてよく見られるパターンです。`,
    "👉 今すぐ受診が必要な状態ではありません",
    "👉 まずは休んで様子を見る判断で問題ありません",
  ].join("\n");
}

/** 🔴「📝 今の状態について」：slotNormalized の HIGH のみを短語にし、＋でつなぐ（KAIRO_SPEC・LLM禁止） */
function labelsFromAssociatedHighRaw(raw) {
  const t = String(raw || "");
  const out = [];
  if (/(発熱|熱がある|熱っぽい|高温|ねつ|38|39|40)/.test(t)) out.push("発熱");
  if (/(だるさ|だるい|倦怠|ぐったり)/.test(t)) out.push("だるさ");
  if (/(吐き気|嘔吐|むかむか)/.test(t)) out.push("吐き気");
  if (/(咳|せき)/.test(t)) out.push("咳");
  if (/(息苦し|呼吸困難|胸が苦)/.test(t)) out.push("息苦しさ");
  return out;
}

function compactMainSymptomNounForRed(state) {
  const raw = String(state?.primarySymptom || "").trim();
  if (raw) {
    let s = raw.replace(/[。．\s]+$/g, "").trim();
    s = s.replace(/がある$|が出ている$|です$|ます$/g, "").trim();
    if (s.length > 14) s = s.slice(0, 14);
    return s || "症状";
  }
  const firstLine = String(state?.historyTextForCare || "")
    .split("\n")
    .find((l) => String(l).trim()) || "";
  return toMainSymptomLabelForSafety(firstLine);
}

function collectRedHighRiskCombinationLabels(state) {
  const norm = state?.slotNormalized || {};
  const candidates = [];
  const bulletCands = gatherRedHighComboCandidatesFromBullets(state);
  if (bulletCands.length) candidates.push(...bulletCands);

  const main = compactMainSymptomNounForRed(state);
  const isMainLabel = (t) => main && main !== "症状" && String(t || "").trim() === main;

  if (norm?.associated_symptoms?.riskLevel === RISK_LEVELS.HIGH) {
    for (const x of labelsFromAssociatedHighRaw(state?.slotAnswers?.associated_symptoms || "")) {
      if (!isMainLabel(x)) candidates.push({ label: x, inv: 95 });
    }
  }

  const dailyRaw = String(
    state?.slotAnswers?.daily_impact || getSlotStatusValue(state, "impact", state?.slotAnswers?.daily_impact || "") || ""
  );
  if (norm?.daily_impact?.riskLevel === RISK_LEVELS.HIGH) {
    if (/38|高熱|39|40/.test(dailyRaw)) candidates.push({ label: "発熱", inv: 93 });
    else if (/37|微熱/.test(dailyRaw)) candidates.push({ label: "微熱", inv: 93 });
    else if (/動けない|寝込|起き上がれない|強いつらさ/.test(dailyRaw)) candidates.push({ label: "つらさが強い", inv: 91 });
    else candidates.push({ label: "日常生活への影響が大きい", inv: 90 });
  }

  if (norm?.pain_score?.riskLevel === RISK_LEVELS.HIGH) {
    const m = String(main || "");
    if (!/(痛|頭痛|腹痛|歯痛|腰痛|喉|のど)/.test(m)) candidates.push({ label: "強い痛み", inv: 85 });
  }
  if (norm?.worsening_trend?.riskLevel === RISK_LEVELS.HIGH) candidates.push({ label: "悪化傾向", inv: 91 });
  if (norm?.duration?.riskLevel === RISK_LEVELS.HIGH) candidates.push({ label: "長く続いている", inv: 89 });
  if (norm?.worsening?.riskLevel === RISK_LEVELS.HIGH) {
    candidates.push({ label: "痛み方が強い側", inv: COMBO_INV_PRI_PAIN_TYPE });
  }
  if (norm?.cause_category?.riskLevel === RISK_LEVELS.HIGH) {
    const cr = String(state?.slotAnswers?.cause_category || "").trim();
    if (cr && !/^(ない|なし|思い当たらない|わからない|不明)/.test(cr)) {
      const p = polishMeaningJsonColloquialSentence(cr.replace(/です$|ます$/, "").slice(0, 22));
      if (p) candidates.push({ label: p, inv: COMBO_INV_PRI_CAUSE });
    }
  }

  let picked = pickComboPartsByInversePriority(candidates, 2, 3);
  if (picked.length >= 2) return picked;

  const combinedText = [
    state?.historyTextForCare || "",
    state?.slotAnswers?.associated_symptoms || "",
    dailyRaw,
    (buildStateFactsBullets(state, { forSummary: true }) || []).join(" "),
  ].join(" ");
  try {
    const feats = extractFeatures(combinedText);
    for (const a of feats.associatedSymptoms || []) {
      if (!isMainLabel(a)) {
        const lab = shortenComboLabelFromBulletText(a) || a;
        candidates.push({ label: lab, inv: 78 });
      }
    }
    if (feats.bodyPart && feats.severityHint === "high") {
      candidates.push({ label: `${feats.bodyPart}の症状`, inv: 76 });
    }
  } catch (_) {
    /* ignore */
  }

  picked = pickComboPartsByInversePriority(candidates, 2, 3);
  if (picked.length >= 2) return picked;

  candidates.push({ label: "つらさが強い", inv: 58 }, { label: "複数のサイン", inv: 57 });
  return pickComboPartsByInversePriority(candidates, 2, 3);
}

const RED_STATE_ABOUT_MEANING_TEMPLATES = [
  "単なる疲れだけでなく、体の中で何かしらの反応が起きている可能性があります。",
  "いくつかのサインが重なり、見過ごしにくい状態です。",
  "複数の兆候が同時に出ているため、状況を整理しておくと安心です。",
];

const RED_STATE_ABOUT_ACTION_TEMPLATES = [
  "一度医療機関で確認しておくと安心できる状態です。",
  "受診を検討しておくと安心につながりやすい状態です。",
  "早めに医療機関で確認しておくと安心しやすい状態です。",
];

/** 🔴「意味」1行：組み合わせに応じて LLM 生成。失敗時は RED_STATE_ABOUT_MEANING_TEMPLATES にフォールバック */
async function generateRedStateAboutMeaningLineViaLlm(state, riskFactorLabels) {
  const joined = (riskFactorLabels || []).filter(Boolean).join("＋");
  const mainSymptom = String(compactMainSymptomNounForRed(state) || "症状").trim();
  const pickFallback = () =>
    RED_STATE_ABOUT_MEANING_TEMPLATES[Math.floor(Math.random() * RED_STATE_ABOUT_MEANING_TEMPLATES.length)];
  if (!process.env.OPENAI_API_KEY || !joined) {
    return pickFallback();
  }
  const systemPrompt = `あなたは医療判断を補助する説明生成AIです。

以下の「症状の組み合わせ」から、
ユーザーが納得できるように、1文で自然な説明を作ってください。

【症状の組み合わせ】
${joined}
【主症状】
${mainSymptom}
ちゃんと主症状と合わせて場合に適する文にすること
【ルール】
・必ず1文（改行なし）
・「〜可能性があります」で終わる
・断定しない
・専門用語を使いすぎない
・ユーザーにわかりやすい自然な日本語
・抽象表現（「状態」「出方」など）は使わない
・「疲れ」「一時的」など軽くしすぎない
・必ず「組み合わせとしての意味」を説明する（単体説明は禁止）

【NG例】
・体調が悪い状態です
・様子を見る必要があります
・単なる疲れの可能性があります

【OK例】
・体の中で炎症や感染などの反応が起きている可能性があります
・複数の症状が重なって出ているため、体に負担がかかっている可能性があります

説明や見出しは出さず、本文の1文のみを出力してください。`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "上記に従い、ルール通りの1文だけを出力してください。" },
        ],
        temperature: 0.35 + attempt * 0.08,
        max_tokens: 220,
      });
      let text = (completion?.choices?.[0]?.message?.content || "").trim();
      text = text.replace(/^[\s・\-*]+/g, "").replace(/\n+/g, "");
      const seg = text.match(/[^。]+可能性があります/);
      if (seg) {
        return seg[0].trim();
      }
    } catch (_) {
      /* fallback below */
    }
  }
  return pickFallback();
}

/** 🔴専用：箇条書きの直後。意味行は同期フォールバック（APIキーなし・非async経路用） */
function buildRedStateAboutEmpathyBlock(state) {
  const rawParts = collectRedHighRiskCombinationLabels(state);
  const parts = rawParts.map((p) => finalizeComboLabelForCombinationLine(p)).filter(Boolean);
  const comboLine = `「${parts.join("＋")}」が同時に出ている状態です。`;
  const meaning =
    RED_STATE_ABOUT_MEANING_TEMPLATES[Math.floor(Math.random() * RED_STATE_ABOUT_MEANING_TEMPLATES.length)];
  const action =
    RED_STATE_ABOUT_ACTION_TEMPLATES[Math.floor(Math.random() * RED_STATE_ABOUT_ACTION_TEMPLATES.length)];
  return [
    "これらの情報から、",
    comboLine,
    "",
    meaning,
    "",
    "そのため、",
    action,
  ].join("\n");
}

/** 🔴専用：意味行を LLM で生成した版（まとめ生成の本線） */
async function buildRedStateAboutEmpathyBlockAsync(state) {
  const rawParts = collectRedHighRiskCombinationLabels(state);
  const parts = rawParts.map((p) => finalizeComboLabelForCombinationLine(p)).filter(Boolean);
  const comboLine = `「${parts.join("＋")}」が同時に出ている状態です。`;
  const meaning = await generateRedStateAboutMeaningLineViaLlm(state, parts);
  const action =
    RED_STATE_ABOUT_ACTION_TEMPLATES[Math.floor(Math.random() * RED_STATE_ABOUT_ACTION_TEMPLATES.length)];
  return [
    "これらの情報から、",
    comboLine,
    "",
    meaning,
    "",
    "そのため、",
    action,
  ].join("\n");
}

/** まとめ「🤝/📝 今の状態について」箇条書き直後（🟢🟡は KAIRO_SPEC 3 ブロック固定・🔴は別構成・🔴意味行は async 版を使用） */
function buildStateAboutEmpathyAndJudgment(state, level) {
  if (level === "🔴") {
    return buildRedStateAboutEmpathyBlock(state);
  }
  return buildGreenYellowStateAboutBlock(state);
}

async function buildStateAboutEmpathyAndJudgmentAsync(state, level) {
  if (level === "🔴") {
    return buildRedStateAboutEmpathyBlockAsync(state);
  }
  return buildStateAboutEmpathyAndJudgment(state, level);
}

const PRE_SUMMARY_CONFIRMATION_MAX_BULLETS = 14;

/** 確認文直後レスポンス用：LLM なし・箇条書きキャッシュから「今の状態について」簡易版のみ（1秒以内目標） */
function buildSummaryQuickPreviewFromState(state) {
  if (!state) return "";
  const level = finalizeRiskLevel(state);
  const bullets = buildStateFactsBullets(state, { forSummary: true });
  const bulletBlock =
    Array.isArray(bullets) && bullets.length > 0
      ? bullets.join("\n")
      : "（状態を整理しています）";
  return [
    `${level} ここまでの情報を整理します`,
    buildSummaryIntroTemplate(),
    "",
    "🤝 今の状態について（簡易）",
    bulletBlock,
  ].join("\n");
}

/** プリフェッチ再実行判定用（スロット・箇条書き・追加事実・会話要約の変化で無効化） */
function computeSummaryPrefetchFingerprint(state) {
  if (!state) return "";
  const bullets = Array.isArray(state.stateAboutBulletsCache)
    ? state.stateAboutBulletsCache.join("\x1e")
    : "";
  const slots = state.slotFilled ? JSON.stringify(state.slotFilled) : "";
  const extra = (state.confirmationExtraFacts || []).join("\x1e");
  const care = String(state.historyTextForCare || "").length;
  return `${state.summaryGenerationEpoch}|${slots}|${bullets}|${extra}|${care}`;
}

/** まとめ前確認文：①導入 ②箇条書き ③確認2行（共感・判断はまとめ側へ移動） */
function buildPreSummaryConfirmationMessage(state) {
  const bulletLines = enforceConfirmationBulletsCompleteness(state);
  const bullets = Array.isArray(bulletLines)
    ? bulletLines.slice(0, PRE_SUMMARY_CONFIRMATION_MAX_BULLETS)
    : [];
  const phrase = PRE_SUMMARY_CONFIRMATION_PHRASES[
    Math.floor(Math.random() * PRE_SUMMARY_CONFIRMATION_PHRASES.length)
  ];
  const addMore = PRE_SUMMARY_ADD_MORE_PHRASES[
    Math.floor(Math.random() * PRE_SUMMARY_ADD_MORE_PHRASES.length)
  ];
  const stateBlock =
    bullets.length > 0
      ? ["今のところ整理できているのは、", "", ...bullets]
      : ["今のところ整理できているのは、"];
  const parts = [...stateBlock, "", phrase, addMore];
  return parts.join("\n");
}

/** 🟢/🟡用：symptomInfo を緊急度が低い順に1つ選ぶ。きっかけは🟢のみ。4つに当てはまらない場合は null（嘘のフォールバック禁止） */
function pickSymptomInfoForJudgment(state, level) {
  const answers = state?.slotAnswers || {};
  const worseningTrend = String(
    getSlotStatusValue(state, "worsening_trend", answers.worsening_trend) ||
    getSlotStatusValue(state, "worsening", answers.worsening) ||
    ""
  ).trim();
  if (/良くな|まし|和らい|軽くな|回復|改善/.test(worseningTrend)) {
    return "回復に向かっている";
  }
  const associated = String(
    getSlotStatusValue(state, "associated", answers.associated_symptoms) || ""
  ).trim();
  if (!associated || /(特にない|ない|なし|これ以外は特にない)/.test(associated)) {
    return "他に強い症状が見られていない";
  }
  const cause = pickCauseTextForConcreteMode(state, []);
  if (cause && level === "🟢") {
    return `きっかけは${cause}の可能性がある`;
  }
  const durationRaw = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  if (/(さっき|今さっき|たった今|数分|数十分)/.test(durationRaw)) {
    return "症状が先ほどから始まった";
  }
  return null;
}

/** まとめ「🤝/📝 今の状態について」：箇条書き直後は共感＋判断 */
function buildStateAboutLine(state, level) {
  const lv =
    level === "🟢" || level === "🟡" || level === "🔴"
      ? level
      : "🟡";
  return buildStateAboutEmpathyAndJudgment(state, lv);
}

function toBulletText(line) {
  return String(line || "")
    .replace(/^・\s*/, "")
    .trim();
}

function extractBulletLinesFromText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^・/.test(line))
    .map((line) => toBulletText(line))
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeCauseCandidate(text) {
  const raw = String(text || "")
    .replace(/^きっかけ[:：]\s*/, "")
    .trim();
  if (!raw) return null;
  if (/(特に思い当たらない|思い当たらない|はっきりとは分からない|分からない|わからない|不明)/.test(raw)) {
    return null;
  }
  if (/^何か思い当たるかも$/.test(raw)) return null;
  return raw;
}

function pickCauseTextForConcreteMode(state, facts = []) {
  const fromDetail = normalizeCauseCandidate(state?.causeDetailText || "");
  if (fromDetail) return fromDetail;
  const fromSlot = normalizeCauseCandidate(
    getSlotStatusValue(state, "cause_category", state?.slotAnswers?.cause_category || "")
  );
  if (fromSlot) return fromSlot;
  const fromFacts = (facts || [])
    .map((fact) => String(fact || ""))
    .find((fact) => /きっかけ|原因|あとに/.test(fact));
  return normalizeCauseCandidate(fromFacts || "");
}

function buildStatePatternSearchQuery(mainSymptom, features) {
  const {
    causeText = "",
    symptomFeature = "",
    strengthText = "",
    durationText = "",
    associated = "",
  } = features || {};
  const parts = [];
  // 優先順位: 1)きっかけ 2)症状特徴 3)強さ 4)経過時間 5)随伴症状
  if (causeText) parts.push(causeText);
  if (mainSymptom) parts.push(mainSymptom);
  if (symptomFeature) parts.push(symptomFeature);
  if (strengthText) parts.push(strengthText);
  if (durationText) parts.push(durationText);
  const assoc = String(associated || "");
  if (assoc && !/(特にない|なし|これ以外は特にない)/.test(assoc)) {
    parts.push(assoc);
  }
  parts.push("よくある", "原因");
  return parts.filter(Boolean).join(" ");
}

function buildCauseDrivenPattern(causeText, mainSymptom, symptomFeature, strengthText, durationText, associated) {
  const symptom = mainSymptom || "不調";
  const quality = symptomFeature || "症状の出方";
  const strength = strengthText || "体感の強さ";
  const duration = durationText || "経過";
  const assoc =
    associated && !/(特にない|なし|これ以外は特にない)/.test(associated)
      ? associated
      : "強い付随症状が目立たない";
  return {
    title: `${causeText}が関係する状態変化のパターン`,
    // きっかけがある場合も2パターン固定。1つ目はきっかけベース。
    body: [
      `このような症状では、${causeText}というきっかけがある場合に${symptom}が出ることがあります。`,
      `このような症状では、${quality}のように症状の質が一定でないまま推移することがあります。`,
      `このような症状では、${strength}や${duration}を一緒に見ると変化の方向を整理しやすくなります。`,
      `このような症状では、${assoc}という情報も、今後の見極めに役立つ材料になります。`,
    ].join("\n"),
  };
}

function getPatternTemplatesByCategory(category) {
  if (category === "GI") {
    return [
      {
        title: "一時的な腸の刺激や張りのパターン",
        body:
          "このような症状では、食事内容や腸の動き、疲労の影響で一時的な腹部不快感が出ることがあります。\nこのような症状では、動ける程度の痛みで推移するケースも少なくありません。",
      },
      {
        title: "軽い消化機能のゆらぎのパターン",
        body:
          "このような症状では、ストレスや生活リズムの乱れにより、胃腸の働きが一時的に不安定になることがあります。\nこのような症状では、強い付随症状がなければ急を要しないこともあります。",
      },
    ];
  }
  if (category === "INFECTION") {
    return [
      {
        title: "上気道の刺激による体調変化のパターン",
        body:
          "このような症状では、のどや鼻の炎症反応が先行して、だるさや咳が段階的に出ることがあります。\nこのような症状では、初期はセルフケアで経過を見る場面もあります。",
      },
      {
        title: "軽い全身反応のパターン",
        body:
          "このような症状では、睡眠不足や環境変化が重なって体調が揺れやすくなることがあります。\nこのような症状では、強い悪化サインがないかを時間経過で確認することが大切です。",
      },
    ];
  }
  if (category === "SKIN") {
    return [
      {
        title: "皮膚バリアの一時的な低下パターン",
        body:
          "このような症状では、乾燥や刺激物への接触で赤みやヒリつきが出ることがあります。\nこのような症状では、刺激回避で落ち着くケースもみられます。",
      },
      {
        title: "接触刺激に関連する反応パターン",
        body:
          "このような症状では、新しい製品や摩擦が引き金となって局所症状が強まることがあります。\nこのような症状では、範囲拡大や痛み増悪の有無が確認ポイントになります。",
      },
    ];
  }
  return [
    {
      title: "一時的な緊張・負荷による痛みのパターン",
      body:
        "このような症状では、疲労や姿勢、睡眠不足などが重なって痛みが出ることがあります。\nこのような症状では、短時間で強弱が変わるケースもあります。",
    },
    {
      title: "軽い炎症や刺激に伴う不調パターン",
      body:
        "このような症状では、局所の刺激や生活リズムの乱れが不調を長引かせることがあります。\nこのような症状では、強い危険兆候がないかを併せて確認します。",
    },
  ];
}

function buildReassuranceBulletsForPatterns(state) {
  const bullets = [];
  const impact = getSlotStatusValue(state, "impact", state?.slotAnswers?.daily_impact || "");
  if (impact && /(普通に動ける|少しつらいが動ける)/.test(impact)) {
    bullets.push("・日常生活の動きが一定程度保たれている");
  }
  const associated = getSlotStatusValue(
    state,
    "associated",
    state?.slotAnswers?.associated_symptoms || ""
  );
  if (!associated || /(特にない|なし|これ以外は特にない)/.test(associated)) {
    bullets.push("・強い付随症状は今のところ目立たない");
  }
  const painScore = Number.isFinite(state?.lastPainScore) ? state.lastPainScore : null;
  if (Number.isFinite(painScore) && painScore <= 6) {
    bullets.push("・痛みスコアが極端な高値ではない");
  }
  const duration = getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "");
  if (duration && /(さっき|数時間)/.test(duration)) {
    bullets.push("・経過が比較的短時間で、変化を追いやすい");
  }
  if (bullets.length === 0) {
    bullets.push("・現時点で把握できる範囲では、強い危険兆候ははっきりしない");
  }
  return bullets.slice(0, 3);
}

function buildConsultChangeBulletsForPatterns(category) {
  if (category === "GI") {
    return [
      "・痛みが急に強くなる",
      "・歩行や姿勢維持がつらくなる",
      "・発熱や繰り返す嘔吐が加わる",
    ];
  }
  if (category === "INFECTION") {
    return [
      "・息苦しさや胸の痛みが出る",
      "・高熱が続く",
      "・水分が取りづらくなる",
    ];
  }
  if (category === "SKIN") {
    return [
      "・赤みや腫れが急に広がる",
      "・強い痛みや熱感が目立ってくる",
      "・発熱を伴う",
    ];
  }
  return [
    "・痛みが急に強くなる",
    "・しびれや視界の違和感が新たに出る",
    "・日常動作が急に難しくなる",
  ];
}

/** 本文・モーダル外：数値 /10 を出さず痛みの程度を短く言い換え（原因モーダル LLM の禁止とは別） */
function qualitativePainStrengthPhraseFromScore(score) {
  if (!Number.isFinite(score)) return "";
  if (score >= 9) return "痛みがかなり強い";
  if (score >= 7) return "痛みが強い";
  if (score >= 5) return "中程度の痛みがある";
  if (score >= 3) return "痛みが軽い〜中程度";
  return "痛みが軽い";
}

function qualitativePainStrengthForUserFacingText(state) {
  const n = state?.lastPainScore;
  if (Number.isFinite(n)) return qualitativePainStrengthPhraseFromScore(n);
  const raw = String(getSlotStatusValue(state, "severity", state?.slotAnswers?.pain_score || "")).trim();
  if (!raw) return "";
  if (/\d+\s*\/\s*10/.test(raw)) {
    const m = raw.match(/(\d{1,2})/);
    const v = m ? Number(m[1]) : null;
    if (Number.isFinite(v)) return qualitativePainStrengthPhraseFromScore(v);
  }
  return raw;
}

function qualitativePainStrengthForPatternClause(state) {
  const base = qualitativePainStrengthForUserFacingText(state);
  if (!base) return "体感の強さ";
  if (/とき$/.test(base)) return base;
  return `${base}とき`;
}

/** 🔴時：今回受診をおすすめしている理由（本文ブロック・モーダル外。KAIRO_SPEC 上の痛みスロット禁止は原因モーダル内のみ） */
function buildRedVisitReasonsBullets(state) {
  const bullets = [];
  const answers = state?.slotAnswers || {};
  const val = (key, fallback) => getSlotStatusValue(state, key, fallback);
  const symptom = state?.judgmentSnapshot?.main_symptom || state?.primarySymptom || "症状";
  const isUnknown = (t) => !t || /^(ない|なし|特にない|わからない|分からない|不明|思い当たらない)$/i.test(String(t).trim());

  const duration = val("duration", answers.duration);
  if (duration && !isUnknown(duration)) {
    const m = String(duration).match(/(\d+)\s*日/);
    const text = m ? `${symptom}が${m[1]}日前から続いている` : `${symptom}が${duration}`;
    bullets.push(`・${text}`);
  }

  const painScore = Number.isFinite(state?.lastPainScore)
    ? state.lastPainScore
    : (() => {
        const m = String(val("severity", answers.pain_score)).match(/(\d{1,2})/);
        return m ? Number(m[1]) : null;
      })();
  if (Number.isFinite(painScore) && painScore >= 7) {
    bullets.push(`・${qualitativePainStrengthPhraseFromScore(painScore)}`);
  }

  const worsening = val("worsening", answers.worsening) || val("worsening_trend", answers.worsening_trend);
  if (worsening && !isUnknown(worsening) && /悪化|悪くなっ|ひどくなっ/.test(worsening)) {
    const w = lightBulletCleanupForUserWords(String(worsening).trim());
    if (w) bullets.push(`・${w}`);
  }

  const impact = val("impact", answers.daily_impact);
  if (bullets.length < 3 && impact && !isUnknown(impact) && /(動けない|つらい|困難)/.test(impact)) {
    bullets.push(`・${impact}`);
  }

  const associated = val("associated", answers.associated_symptoms);
  if (bullets.length < 3 && associated && !isUnknown(associated)) {
    bullets.push(`・${String(associated).trim()}`);
  }

  while (bullets.length < 3 && (duration || symptom)) {
    const dup = bullets.some((b) => b.includes("続いている"));
    if (!dup) bullets.push(`・${symptom}が続いている`);
    break;
  }
  return bullets.slice(0, 3);
}

function buildConcreteStatePatternMessage(state, summaryFacts = [], summarySection = "") {
  const snapshot = state?.judgmentSnapshot || {};
  const mainSymptom =
    snapshot.main_symptom ||
    state?.primarySymptom ||
    getSlotStatusValue(state, "associated", "") ||
    "現在の症状";
  const stateFacts = Array.isArray(summaryFacts) && summaryFacts.length > 0
    ? summaryFacts.map((line) => toBulletText(line))
    : buildStateFactsBullets(state).map((line) => toBulletText(line));
  const extraFacts = extractBulletLinesFromText(summarySection);
  const facts = Array.from(new Set([...stateFacts, ...extraFacts])).filter(Boolean).slice(0, 4);
  const associated = getSlotStatusValue(state, "associated", state?.slotAnswers?.associated_symptoms || "");
  const causeText = pickCauseTextForConcreteMode(state, facts);
  const symptomFeature = getSlotStatusValue(state, "worsening", state?.slotAnswers?.worsening || "");
  const strengthText = Number.isFinite(state?.lastPainScore)
    ? `痛みは${state.lastPainScore}/10程度`
    : getSlotStatusValue(state, "severity", state?.slotAnswers?.pain_score || "");
  const durationText = getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "");
  const query = buildStatePatternSearchQuery(mainSymptom, {
    causeText,
    symptomFeature,
    strengthText,
    durationText,
    associated,
  });
  const category = detectQuestionCategory4([mainSymptom, ...facts].join(" "));
  const baseTemplates = getPatternTemplatesByCategory(category).slice(0, 2);
  const strengthForPatternBody = qualitativePainStrengthForPatternClause(state);
  const templates = causeText
    ? [
        buildCauseDrivenPattern(
          causeText,
          mainSymptom,
          symptomFeature,
          strengthForPatternBody,
          durationText,
          associated
        ),
        ...(baseTemplates.length > 0 ? [baseTemplates[0]] : []),
      ].slice(0, 2)
    : baseTemplates;
  const reassurance = buildReassuranceBulletsForPatterns(state);
  const consultChanges = buildConsultChangeBulletsForPatterns(category);
  const level = state?.decisionLevel || finalizeRiskLevel(state);
  const isGreenOrYellow = level === "🟢" || level === "🟡";

  const lines = ["今の状態は、次のようなパターンと似ています。", ""];
  for (const pattern of templates) {
    lines.push(`■ ${pattern.title}`);
    lines.push(pattern.body);
    lines.push("");
  }
  if (isGreenOrYellow) {
    lines.push("現時点の安心材料");
    reassurance.forEach((line) => lines.push(line));
    lines.push("このような症状では、強い緊急サインは今のところはっきりしていません。");
    lines.push("");
    lines.push("こんな変化があれば受診を検討");
    consultChanges.slice(0, 3).forEach((line) => lines.push(line));
  } else if (level === "🔴") {
    lines.push("今回受診をおすすめしている理由");
    buildRedVisitReasonsBullets(state).forEach((line) => lines.push(line));
    lines.push("");
    lines.push("これらがあるため、一度医療機関で確認しておくと安心です。");
  }
  return { message: lines.join("\n").trim(), query };
}

function collectConcreteSymptomTerms(state, summaryFacts = [], summarySection = "") {
  const rawCandidates = [
    state?.slotStatus?.severity?.value,
    state?.slotStatus?.worsening?.value,
    state?.slotStatus?.duration?.value,
    state?.slotStatus?.impact?.value,
    state?.slotStatus?.associated?.value,
    state?.slotStatus?.cause_category?.value,
    state?.causeDetailText,
    state?.primarySymptom,
    ...(Array.isArray(summaryFacts) ? summaryFacts : []),
    ...extractBulletLinesFromText(summarySection || ""),
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const lexicon =
    /(便秘|下痢|腹痛|お腹|胃痛|吐き気|嘔吐|キリキリ|ズキズキ|ヒリヒリ|締め付け|チクチク|しびれ|めまい|咳|せき|喉|のど|鼻水|発熱|寒気|だるい|赤み|発疹|水ぶくれ|乾燥|痛み\s*\d+\s*\/\s*10|さっきから|さっき|数時間|半日|一日以上|変化なし)/g;

  const terms = [];
  for (const raw of rawCandidates) {
    const matches = raw.match(lexicon);
    if (matches && matches.length > 0) {
      matches.forEach((m) => terms.push(m.trim()));
      continue;
    }
    // 辞書に乗らない具体語も拾うため、短い原文断片を保持
    const clipped = raw.replace(/^・\s*/, "").replace(/^→\s*/, "").trim();
    if (clipped.length > 1 && clipped.length <= 24) {
      terms.push(clipped);
    }
  }
  return Array.from(new Set(terms)).slice(0, 10);
}

function buildConcreteBilingualQueries(symptoms = []) {
  const phrase = (Array.isArray(symptoms) ? symptoms : []).filter(Boolean).join(" ");
  const safePhrase = phrase || "体調不良";
  const queryJP = `${safePhrase} 原因 今の状態 どういう状況`;
  const queryEN = `${safePhrase} possible causes current condition explanation`;
  return { queryJP, queryEN };
}

/** 6スロットの値を収集（わからない・ない・不明は省く） */
function collectSlotFactsForDiseaseSearch(state) {
  const answers = state?.slotAnswers || {};
  const rawSlotFacts = [
    getSlotStatusValue(state, "severity", answers.pain_score),
    getSlotStatusValue(state, "worsening", answers.worsening),
    getSlotStatusValue(state, "duration", answers.duration),
    getSlotStatusValue(state, "impact", answers.daily_impact),
    getSlotStatusValue(state, "associated", answers.associated_symptoms),
    getSlotStatusValue(state, "cause_category", state?.causeDetailText || answers.cause_category),
  ]
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0)
    .filter((v) => !/^(ない|なし|特にない|特になし|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/.test(v));
  return Array.from(new Set(rawSlotFacts)).slice(0, 8);
}

/** 主症状→英語（疾患検索用） */
const MAIN_SYMPTOM_TO_EN_DISEASE = {
  頭痛: "headache",
  腹痛: "stomach pain abdominal pain",
  "喉の痛み": "sore throat",
  "唇の痛み": "lip pain chapped lips",
  発熱: "fever",
  皮膚症状: "skin rash irritation",
  体調不良: "symptoms general",
};

/** 🤝/📝モーダル用：疾患検索クエリ（複数バリアントを返し、並列検索でヒット率を上げる） */
function buildDiseaseSearchQueries(mainSymptom = "", slotFacts = []) {
  const s = String(mainSymptom || "症状").trim();
  const facts = Array.isArray(slotFacts) ? slotFacts.filter(Boolean).join(" ") : "";
  const suffix = facts ? ` ${facts}` : "";
  const mainEn = MAIN_SYMPTOM_TO_EN_DISEASE[s] || MAIN_SYMPTOM_TO_EN_DISEASE.体調不良;
  const mandatoryJP = `${s}${suffix} 考えられる疾患 病名 説明`.replace(/\s{2,}/g, " ").trim().slice(0, 260);
  const mandatoryEN = `${s}${suffix} ${mainEn} possible conditions diseases`.replace(/\s{2,}/g, " ").trim().slice(0, 260);
  const jaBase = [
    mandatoryJP,
    `${s}${suffix} 考えられる疾患`.replace(/\s{2,}/g, " ").trim().slice(0, 200),
    `${s} 疾患 病名 原因`.replace(/\s{2,}/g, " ").trim().slice(0, 180),
    `${s} 原因 病名 鑑別`.replace(/\s{2,}/g, " ").trim().slice(0, 180),
    `${s} 症状 説明 医療`.replace(/\s{2,}/g, " ").trim().slice(0, 160),
    `${s} 病名 症状 対処`.replace(/\s{2,}/g, " ").trim().slice(0, 160),
    s === "体調不良" ? "頭痛 腹痛 喉 考えられる疾患 病名" : `${s} 病名`,
    s === "体調不良" ? "症状 考えられる疾患 病名 説明" : `${s} 医療 説明`,
  ].filter((q) => q && String(q).trim().length > 0);
  const enBase = [
    mandatoryEN,
    `${mainEn} possible conditions differential diagnosis`.replace(/\s{2,}/g, " ").trim().slice(0, 200),
    `${mainEn} causes symptoms explanation`.replace(/\s{2,}/g, " ").trim().slice(0, 180),
    `${mainEn} self care when to see doctor`.replace(/\s{2,}/g, " ").trim().slice(0, 180),
    `${mainEn} common conditions`,
    `${mainEn} diagnosis treatment`,
    `what causes ${mainEn} symptoms`,
  ].filter((q) => q && String(q).trim().length > 0);
  return {
    queryJP: mandatoryJP,
    queryEN: mandatoryEN,
    ja: [...new Set(jaBase)],
    en: [...new Set(enBase)],
  };
}

/** 主症状ラベルを疾患検索用に正規化（ユーザー入力は使わない） */
function toMainSymptomForDiseaseSearch(state) {
  const source = [
    state?.judgmentSnapshot?.main_symptom,
    state?.primarySymptom || "",
    getSlotStatusValue(state, "associated", ""),
    state?.slotAnswers?.associated_symptoms || "",
  ]
    .filter(Boolean)
    .join(" ");
  const s = String(source || "症状");
  if (/(頭が痛|頭痛|こめかみ|後頭部)/.test(s)) return "頭痛";
  if (/(お腹が痛|腹痛|胃痛|みぞおち|下腹|下痢|便秘)/.test(s)) return "腹痛";
  if (/(喉が痛|のどが痛|喉の痛み|咽頭痛|咳)/.test(s)) return "喉の痛み";
  if (/(唇が痛|口唇|唇|ヒリヒリ|乾燥)/.test(s)) return "唇の痛み";
  if (/(発熱|熱|だるい|寒気)/.test(s)) return "発熱";
  if (/(皮膚|かゆみ|発疹|赤み)/.test(s)) return "皮膚症状";
  return "体調不良";
}

/** 危険ワード：common/conditional に含めてはいけない。rare_emergency のみ可 */
const DANGER_WORDS_INITIAL_HIDDEN = ["腫瘍", "出血", "致死", "がん", "破裂"];

/** 原因名が主症状と関連するか。主症状と無関係な病名を弾く。 */
function isCauseRelatedToMainSymptom(cause, mainSymptom) {
  const c = String(cause || "").trim();
  if (!c) return false;
  const GENERIC_DESC = /^(体調不良|症状の悪化|痛みの種類|チクチクする痛み|日常生活に影響|症状が続いている|経過の変化|変化が|強い痛み|だるさ|筋肉の緊張|ストレス|疲労|脱水|寝不足|食べ過ぎ|冷え|乾燥|水分不足|デスクワーク|目の疲れ)$/;
  if (GENERIC_DESC.test(c)) return true; // 病名でない記述は許可
  const LOOKS_LIKE_DISEASE = /(炎|症|症候群|頭痛|胃炎|腸炎|感冒|扁桃|咽頭|ヘルペス|皮膚炎|熱中症|片頭痛|緊張型|偏頭痛|群発|副鼻腔|髄膜|虫垂|胆嚢|膵炎|敗血症|肺炎|蜂窩|丹毒|薬疹)/;
  if (!LOOKS_LIKE_DISEASE.test(c)) return true; // 病名っぽくない記述は許可
  const RELATED = {
    頭痛: /頭痛|片頭痛|緊張型|偏頭痛|群発|副鼻腔|髄膜|頭/,
    腹痛: /胃|腸|腹|虫垂|胆嚢|膵|過敏性|消化不良/,
    "喉の痛み": /喉|のど|咽頭|扁桃|喉頭|感冒|インフル/,
    "唇の痛み": /唇|口|ヘルペス|口角|皮膚炎/,
    発熱: /熱|感冒|インフル|感染|敗血症|肺炎|尿路|ウイルス/,
    皮膚症状: /皮膚|蜂窩|丹毒|アナフィラキシー|薬疹|接触|乾燥性|湿疹|蕁麻疹|かゆみ/,
    体調不良: /感冒|自律神経|倦怠|だる|疲労|感染|熱/,
  };
  const pattern = RELATED[mainSymptom] || RELATED.体調不良;
  return pattern.test(c);
}

/** 「→」理由に含まれがちな「ユーザーが言ったと仮定される」語。言っていなければ置換対象 */
const ASSUMABLE_PHRASES_IN_REASON = [
  "肩こり",
  "ストレス",
  "寝不足",
  "睡眠不足",
  "脱水",
  "水分不足",
  "光",
  "音",
  "疲労",
  "疲れ",
  "目の疲れ",
  "筋肉の緊張",
  "乾燥",
  "緊張",
  "冷え",
  "食べ過ぎ",
  "飲み過ぎ",
  "アルコール",
  "カフェイン",
  "運動不足",
  "姿勢",
  "パソコン",
  "スマホ",
  "眼精疲労",
];

/**
 * 「→」理由文中の、ユーザーが言っていない語を検出する。
 * @param {string} reason - 「→」の後の理由文
 * @param {string[]} userWords - ユーザーが実際に言った語の配列
 * @returns {{ phrase: string, index: number }[]} 言っていない語とその出現位置
 */
function checkReasonForUnsaidPhrases(reason, userWords) {
  const normalized = String(reason || "").trim();
  const userSet = new Set(
    (userWords || []).map((w) => String(w || "").toLowerCase().trim()).filter(Boolean)
  );
  const userText = (userWords || []).join(" ");
  const found = [];
  for (const phrase of ASSUMABLE_PHRASES_IN_REASON) {
    if (!phrase || phrase.length < 2) continue;
    if (!normalized.includes(phrase)) continue;
    const userSaid =
      userSet.has(phrase) ||
      userText.includes(phrase) ||
      (phrase.length >= 2 && userText.split(/\s+/).some((w) => w.includes(phrase) || phrase.includes(w)));
    if (!userSaid) {
      const idx = normalized.indexOf(phrase);
      found.push({ phrase, index: idx });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * 「→」理由文中の、ユーザーが言っていない語をユーザーの言った語にピンポイントで置換する。
 * @param {string} reason - 「→」の後の理由文
 * @param {string[]} userWords - ユーザーが実際に言った語の配列
 * @returns {string} 置換後の理由文
 */
function replaceUnsaidPhrasesInReason(reason, userWords) {
  let result = String(reason || "").trim();
  const unsaid = checkReasonForUnsaidPhrases(result, userWords);
  if (unsaid.length === 0) return result;

  const usable = (userWords || []).filter((w) => w && String(w).trim().length >= 2 && String(w).trim().length <= 24);
  const replacement = usable.length > 0 ? usable[0] : "このような症状";

  for (const { phrase } of unsaid) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escaped}や`, "g"),
      new RegExp(`や${escaped}`, "g"),
      new RegExp(`${escaped}、`, "g"),
      new RegExp(`、${escaped}`, "g"),
      new RegExp(`${escaped}が`, "g"),
      new RegExp(`${escaped}で`, "g"),
      new RegExp(`${escaped}による`, "g"),
      new RegExp(`${escaped}の`, "g"),
      new RegExp(escaped, "g"),
    ];
    for (const re of patterns) {
      const before = result;
      result = result.replace(re, replacement);
      if (result !== before) break;
    }
  }
  const esc = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return result
    .replace(/\s{2,}/g, " ")
    .replace(new RegExp(`${esc}や${esc}`, "g"), replacement)
    .replace(new RegExp(`${esc}、${esc}`, "g"), replacement)
    .trim();
}

/**
 * 「🟢 よくある原因」と「🟡 状況によっては確認が必要」の重複を除去（同じ病名・包含関係）。
 */
function dedupeModalCommonAndConditional(commonIn, conditionalIn) {
  const common = Array.isArray(commonIn) ? commonIn.slice() : [];
  let conditional = Array.isArray(conditionalIn) ? conditionalIn.slice() : [];
  const causeKey = (line) => {
    const s = String(line || "").replace(/^・\s*/, "").trim();
    const idx = s.indexOf(" → ");
    const head = (idx >= 0 ? s.slice(0, idx) : s).trim();
    return head
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/（[^）]*）/g, "");
  };
  const commonKeys = new Set(common.map(causeKey).filter(Boolean));
  conditional = conditional.filter((item) => {
    const k = causeKey(item);
    if (!k) return true;
    for (const ck of commonKeys) {
      if (!ck) continue;
      if (k === ck) return false;
      if (k.length >= 3 && ck.length >= 3 && (k.includes(ck) || ck.includes(k))) return false;
    }
    return true;
  });
  const condKeys = [];
  conditional = conditional.filter((item) => {
    const k = causeKey(item);
    if (!k) return true;
    for (const prev of condKeys) {
      if (k === prev) return false;
      if (k.length >= 3 && prev.length >= 3 && (k.includes(prev) || prev.includes(k))) return false;
    }
    condKeys.push(k);
    return true;
  });
  return { common, conditional };
}

/** モーダル「🟢 よくある原因」に含めない。感染症系は「🟡 状況によっては確認が必要」へ移す（KAIRO_SPEC 🤝/📝） */
function isInfectionRelatedModalCauseLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return false;
  const body = raw.replace(/^・\s*/, "");
  const arrowIdx = body.indexOf(" → ");
  const head = (arrowIdx >= 0 ? body.slice(0, arrowIdx) : body).trim().replace(/（[^）]*）/g, "");
  const tail = arrowIdx >= 0 ? body.slice(arrowIdx + 3).trim() : "";
  const text = `${head}\n${tail}`;
  if (
    /ウイルス感染|細菌感染|感染症|ウイルスや細菌|ウイルス性|ウイルスによる|細菌による|インフルエンザウイルス|RSウイルス|ヘルペスウイルス|感染により/.test(
      text
    )
  ) {
    return true;
  }
  const infectionNames = [
    "感冒",
    "インフルエンザ",
    "急性咽頭炎",
    "急性扁桃炎",
    "急性胃腸炎",
    "急性上気道炎",
    "肺炎",
    "尿路感染症",
    "敗血症",
    "伝染性単核球症",
    "口唇ヘルペス",
    "咽頭炎",
    "扁桃炎",
    "ウイルス性胃腸炎",
    "副鼻腔炎",
    "中耳炎",
    "膀胱炎",
    "腎盂腎炎",
  ];
  if (infectionNames.some((n) => head === n || head.startsWith(`${n}（`))) return true;
  return false;
}

function moveInfectionCausesFromCommonToConditional(commonIn, conditionalIn) {
  const common = Array.isArray(commonIn) ? commonIn.slice() : [];
  let conditional = Array.isArray(conditionalIn) ? conditionalIn.slice() : [];
  const toMove = common.filter(isInfectionRelatedModalCauseLine);
  const stay = common.filter((x) => !isInfectionRelatedModalCauseLine(x));
  const headKey = (line) => {
    const s = String(line || "").replace(/^・\s*/, "").split(" → ")[0]?.trim() || "";
    return s.toLowerCase().replace(/\s+/g, "");
  };
  const condHeads = new Set(conditional.map(headKey).filter(Boolean));
  for (const line of toMove) {
    const k = headKey(line);
    if (k && condHeads.has(k)) continue;
    if (k) condHeads.add(k);
    conditional.unshift(line);
  }
  return { common: stay, conditional };
}

/** モーダル「🟢」補完用：感染症系を含まない代表ペア（getDiseaseFallbackPair が感染のみのとき） */
function getModalCommonNonInfectionFallbackPair(mainSymptom) {
  const fallbacks = {
    頭痛: [
      {
        name: "緊張型頭痛",
        desc: "筋肉の緊張やストレスが関係するとされる状態です。頭の周囲が締め付けられるような痛みが特徴です。",
      },
      {
        name: "片頭痛",
        desc: "血管の拡張や神経の過敏化が関与するとされる状態です。ズキズキとした痛みが片側に出ることが多いとされています。",
      },
    ],
    腹痛: [
      {
        name: "過敏性腸症候群",
        desc: "ストレスや生活習慣が関与するとされる状態です。腹痛と便通の変化が主な特徴とされています。",
      },
      {
        name: "便秘",
        desc: "腸の動きが遅くなるとされる状態です。腹部の張りや違和感を伴うことがあります。",
      },
    ],
    唇の痛み: [
      {
        name: "口角炎",
        desc: "口角の炎症や亀裂が生じるとされる状態です。乾燥やビタミン不足が関与することがあります。",
      },
      {
        name: "乾燥性唇炎",
        desc: "口唇の乾燥や刺激で炎症が生じるとされる状態です。",
      },
    ],
    喉の痛み: [
      {
        name: "発声過多",
        desc: "声の使い過ぎで喉の粘膜が刺激されるとされる状態です。",
      },
      {
        name: "逆流性食道炎",
        desc: "胃酸の逆流が関与するとされる状態です。のどの違和感や胸やけを伴うことがあります。",
      },
    ],
    発熱: [
      {
        name: "脱水に伴う体温の変化",
        desc: "水分不足で体調の波が出やすくなるとされることがあります。",
      },
      {
        name: "疲労・睡眠不足",
        desc: "休息不足が重なると、体調変化に影響しやすいとされています。",
      },
    ],
    皮膚症状: [
      {
        name: "接触皮膚炎",
        desc: "刺激物への接触により皮膚に炎症が生じるとされる状態です。赤みやかゆみが主な症状です。",
      },
      {
        name: "乾燥性皮膚炎",
        desc: "皮膚のバリア機能低下により乾燥やヒリつきが出るとされる状態です。",
      },
    ],
    体調不良: [
      {
        name: "自律神経の乱れ",
        desc: "ストレスや生活習慣の影響で自律神経のバランスが崩れるとされる状態です。だるさや不調の原因になることがあります。",
      },
      {
        name: "睡眠不足",
        desc: "休息が不足すると、体調の波が出やすくなるとされています。",
      },
    ],
  };
  return fallbacks[mainSymptom] || fallbacks.頭痛;
}

/** 🤝/📝モーダル：LLM安全フィルタ＋頻度順再構成（SEO順・生検索結果の表示は廃止） */
async function buildDiseaseSafetyFilteredMessage(
  searchResults = [],
  mainSymptom = "",
  level = "🟢",
  state = null,
  summaryFacts = [],
  summarySection = ""
) {
  const searchText = (searchResults || [])
    .slice(0, 30)
    .map((r) => `${r?.title || ""} ${r?.snippet || ""}`)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  const bulletLines = extractBulletLinesFromText(summarySection || "");
  const rawFacts = [
    ...(Array.isArray(summaryFacts) ? summaryFacts : []),
    ...bulletLines,
    ...(state ? collectSlotFactsForDiseaseSearch(state) : []),
  ]
    .filter(Boolean)
    .map((l) => String(l).replace(/^[・\s]+/, "").replace(/^→\s*/, "").trim())
    .filter((l) => l.length > 0)
    .filter((l) => l.length <= 80);
  const userSummary = Array.from(new Set(rawFacts)).slice(0, 12).join("\n");

  const fallbackPair = getDiseaseFallbackPair(mainSymptom);
  const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
  const reassurance = state ? buildReassuranceBulletsForPatterns(state) : ["・強い緊急サインは今のところはっきりしていません"];
  const consultChanges = buildConsultChangeBulletsForPatterns(category);

  const tryExtract = async () => {
    const prompt = [
      "検索結果と「今の状態について」のユーザー言動を参照し、原因を頻度順に3カテゴリに分類してください。",
      "厳守：",
      "- 出力は必ずJSONのみ：{\"common\":[],\"conditional\":[],\"rare_emergency\":[]}",
      "- common = 一般的に頻度が高い原因（2〜4件）。各項目は「・<原因名> → <短い理由>」形式。原因名は病名でもユーザー言動の要約でもよい。**主症状と無関係な病名・症状名は絶対に含めない**。無理に病名を挿入しない。",
      "- **common に「ウイルス感染」という文言を含めない。ウイルス・細菌感染・感染症として位置づける原因（感冒・咽頭炎・胃腸炎・口唇ヘルペス・インフルエンザ等）は必ず conditional のみ**に書く。",
      "- 「→」の理由は**ユーザーの言動を要約**して記載。ユーザーが言っていないことは書かない。固定文（例：肩こりやストレスで）は使わず、ユーザーが実際に言った内容に合わせる。",
      "- conditional = 条件付きで考慮すべき状況（2〜4件）。各項目は「・<病名> → <関連した理由>」形式。**主症状に関連する病名のみ**使用。主症状と無関係な病名は絶対に含めない。理由はユーザー症状と関連付ける。検索結果＋ユーザー症状から要約。煽らない表現。固定テンプレート禁止。**感染症系（ウイルス・細菌・上気道炎・胃腸炎など）はここに分類する**（common に出さない）。",
      "- **common と conditional は重複禁止**：同じ疾患名・同義の原因名を両方に書かない。conditional は「追加で鑑別や受診判断が必要になりうるもの」に限定し、common に既に出した病名・ほぼ同じ内容は conditional に繰り返さない。",
      "- 禁止（原因モーダル・common/conditional の「→」右側の理由のみ）：痛みの強さスロット由来の表現を絶対に使わない（3/10・〇/10・やや強い・中程度・軽い等。箇条書きの痛み行の言い換えも含めない）。本文のまとめや 🔴 の受診理由箇条書きには適用しない。",
      "- rare_emergency = 稀だが緊急性あり。**2件のみ**（強制）。検索結果＋ユーザー症状から要約。腫瘍・出血・致死・がん・破裂などの重篤疾患はここにのみ入れる。固定テンプレート禁止。",
      "- common/conditional に腫瘍・出血・致死・がん・破裂を含めない",
      "- 「あなたの場合」「この症状は」などの個別化表現は禁止。恐怖を煽る表現は禁止",
    ].join("\n");

    const userContent = [
      `主症状: ${mainSymptom}`,
      userSummary ? `\n【今の状態について（ユーザー言動）】\n${userSummary}` : "",
      `\n【検索結果（タイトル・スニペットのみ）】\n${searchText}`,
    ].join("");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    });
    const raw = completion?.choices?.[0]?.message?.content || "";
    return parseJsonObjectFromText(raw);
  };

  let parsed = null;
  try {
    parsed = await tryExtract();
  } catch (_) {
    /* fallback */
  }

  const hasDanger = (text) =>
    DANGER_WORDS_INITIAL_HIDDEN.some((w) => String(text || "").includes(w));

  const sanitize = (arr, allowDanger) =>
    (Array.isArray(arr) ? arr : [])
      .map((x) => (typeof x === "string" ? x : x?.text || x?.name || String(x)))
      .filter((t) => t && String(t).trim().length > 0)
      .filter((t) => allowDanger || !hasDanger(t));

  let common = sanitize(parsed?.common, false)
    .filter((item) => {
      const cause = (item.indexOf(" → ") >= 0 ? item.slice(0, item.indexOf(" → ")) : item).replace(/^・\s*/, "").trim();
      return isCauseRelatedToMainSymptom(cause, mainSymptom);
    })
    .slice(0, 4);
  let conditional = sanitize(parsed?.conditional, false)
    .filter((item) => {
      const cause = (item.indexOf(" → ") >= 0 ? item.slice(0, item.indexOf(" → ")) : item).replace(/^・\s*/, "").trim();
      return isCauseRelatedToMainSymptom(cause, mainSymptom);
    })
    .slice(0, 4);
  let rare_emergency = sanitize(parsed?.rare_emergency, true).slice(0, 2);

  const infectionMoved = moveInfectionCausesFromCommonToConditional(common, conditional);
  common = infectionMoved.common;
  conditional = infectionMoved.conditional;

  const userWords = rawFacts;
  const stripPainScoreFromReason = (text) =>
    String(text || "")
      .replace(/\d+\s*\/\s*10/g, "")
      .replace(/\d+\s*点\s*満点/g, "")
      .replace(/痛みの強さ|痛みスコア|〇\/10/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

  common = common.map((item) => {
    const arrowIdx = item.indexOf(" → ");
    if (arrowIdx === -1) return item;
    const reason = item.slice(arrowIdx + 3).trim();
    let fixed = replaceUnsaidPhrasesInReason(reason, userWords);
    fixed = stripPainScoreFromReason(fixed) || fixed;
    return `${item.slice(0, arrowIdx + 3)}${fixed}`;
  });

  // common が2件未満のときのみ、主症状に紐づいた fallback から補う（感染症系は入れない）
  if (common.length < 2) {
    const buildFallbackLine = (d) => {
      const reason = d.desc.replace(/とされる状態です。?$/, "").trim();
      const fixed = replaceUnsaidPhrasesInReason(reason, userWords);
      return `・${d.name} → ${fixed}`;
    };
    let pool = fallbackPair.map(buildFallbackLine).filter((line) => !isInfectionRelatedModalCauseLine(line));
    if (pool.length < 2) {
      pool = [...pool, ...getModalCommonNonInfectionFallbackPair(mainSymptom).map(buildFallbackLine)].filter(
        (line) => !isInfectionRelatedModalCauseLine(line)
      );
    }
    const seen = new Set();
    for (const item of pool) {
      if (common.length >= 4) break;
      const name = (item.match(/^・([^→]+)/) || [])[1]?.trim?.() || "";
      if (!name || seen.has(name) || common.some((c) => c.includes(name))) continue;
      seen.add(name);
      common.push(item);
    }
  }
  common = common.slice(0, 4);

  const conditionalFallbacksBySymptom = {
    頭痛: [
      "・群発頭痛 → ズキズキする痛みが目の奥に集中することがある",
      "・副鼻腔炎 → 目の奥の痛みやだるさが関連することがある",
      "・髄膜炎 → 発熱を伴う強い頭痛が続くことがある",
      "・高血圧性頭痛 → 血圧の変動で頭痛が出ることがある",
    ],
    腹痛: [
      "・虫垂炎 → 右下腹部の痛みが強くなることがある",
      "・胆嚢炎 → 右上腹部の痛みや発熱を伴うことがある",
      "・腸閉塞 → 腹痛と嘔吐が続くことがある",
      "・膵炎 → みぞおちの強い痛みが出ることがある",
    ],
    "喉の痛み": [
      "・扁桃周囲膿瘍 → のどの片側が強く腫れることがある",
      "・急性喉頭蓋炎 → 呼吸がしづらくなることがある",
      "・咽頭後膿瘍 → 飲み込みづらさや首の腫れが出ることがある",
      "・伝染性単核球症 → だるさや発熱が続くことがある",
    ],
    "唇の痛み": [
      "・口唇ヘルペス → 水ぶくれやヒリヒリ感が出ることがある",
      "・口角炎 → 口角の亀裂や痛みが出ることがある",
      "・アレルギー性接触皮膚炎 → かぶれや腫れが出ることがある",
      "・血管性浮腫 → 唇が急に腫れることがある",
    ],
    発熱: [
      "・敗血症 → 高熱と全身の状態悪化が出ることがある",
      "・髄膜炎 → 高熱と頭痛が続くことがある",
      "・肺炎 → 咳や息苦しさを伴うことがある",
      "・尿路感染症 → 排尿時痛や腰痛が出ることがある",
    ],
    皮膚症状: [
      "・蜂窩織炎 → 赤みや腫れが広がることがある",
      "・丹毒 → 境界がはっきりした赤みが出ることがある",
      "・アナフィラキシー → 全身のじんましんや呼吸困難が出ることがある",
      "・薬疹 → 薬の服用後に発疹が出ることがある",
    ],
    体調不良: [
      "・髄膜炎 → 高熱と頭痛が続くことがある",
      "・敗血症 → 全身の状態が急に悪化することがある",
      "・心筋梗塞 → 胸の痛みや息切れが出ることがある",
      "・肺塞栓症 → 突然の胸痛や呼吸困難が出ることがある",
    ],
  };
  const conditionalFallbackFullList = [
    ...(conditionalFallbacksBySymptom[mainSymptom] || conditionalFallbacksBySymptom.頭痛),
  ];
  const conditionalFallbacks = conditionalFallbackFullList.slice();
  while (conditional.length < 2 && conditionalFallbacks.length > 0) {
    const next = conditionalFallbacks.shift();
    const name = (next.match(/^・([^→]+)/) || [])[1]?.trim?.() || "";
    if (!name || !conditional.some((c) => c.includes(name))) conditional.push(next);
  }
  conditional = conditional.map((item) => {
    const arrowIdx = item.indexOf(" → ");
    if (arrowIdx === -1) return item;
    const reason = item.slice(arrowIdx + 3).trim();
    const fixed = stripPainScoreFromReason(reason) || reason;
    return `${item.slice(0, arrowIdx + 3)}${fixed}`;
  });

  const deduped = dedupeModalCommonAndConditional(common, conditional);
  common = deduped.common;
  conditional = deduped.conditional;

  const causeKeyForRefill = (line) => {
    const s = String(line || "").replace(/^・\s*/, "").trim();
    const idx = s.indexOf(" → ");
    const head = (idx >= 0 ? s.slice(0, idx) : s).trim();
    return head
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/（[^）]*）/g, "");
  };
  const commonKeySet = new Set(common.map(causeKeyForRefill).filter(Boolean));
  if (conditional.length < 2) {
    const pool = conditionalFallbackFullList.slice();
    while (conditional.length < 2 && pool.length > 0) {
      const next = pool.shift();
      const nk = causeKeyForRefill(next);
      if (!nk) continue;
      let overlapCommon = false;
      for (const ck of commonKeySet) {
        if (nk === ck || (nk.length >= 3 && ck.length >= 3 && (nk.includes(ck) || ck.includes(nk)))) {
          overlapCommon = true;
          break;
        }
      }
      if (overlapCommon) continue;
      if (conditional.some((c) => causeKeyForRefill(c) === nk)) continue;
      conditional.push(next);
    }
  }
  conditional = conditional.slice(0, 4);

  const rareFallbacksBySymptom = {
    頭痛: ["・くも膜下出血", "・脳出血"],
    腹痛: ["・消化管穿孔", "・腹部大動脈瘤破裂"],
    "喉の痛み": ["・急性喉頭蓋炎", "・気道閉塞"],
    "唇の痛み": ["・蜂窩織炎", "・血管性浮腫"],
    発熱: ["・敗血症性ショック", "・髄膜炎"],
    皮膚症状: ["・アナフィラキシー", "・壊死性筋膜炎"],
    体調不良: ["・心筋梗塞", "・肺塞栓症"],
  };
  const rareFallbacks = rareFallbacksBySymptom[mainSymptom] || rareFallbacksBySymptom.頭痛;
  while (rare_emergency.length < 2 && rareFallbacks.length > 0) {
    const next = rareFallbacks.shift();
    if (!rare_emergency.includes(next)) rare_emergency.push(next);
  }
  rare_emergency = rare_emergency.slice(0, 2);

  const COMMON_SYMPTOM_REASSURANCE = [
    "このような症状は、多くの人にも見られる比較的よくあるものです。",
    "今のような症状は、特別なものではなく、日常的によく見られるケースのひとつです。",
    "このような症状は、多くの方に見られる一般的なもののひとつです。",
  ];
  const reassuranceCommon =
    level === "🔴"
      ? "今のあなたは🟡の可能性もないとは言えません。なので、確認をするためにも受診をおすすめします。"
      : `${mainSymptom}のほとんどは命に関わるものではありません。特に、急激な悪化や神経症状がなければ、よくあるタイプの可能性が高いです。\n\n${COMMON_SYMPTOM_REASSURANCE[0]}`;

  const redVisitReasonsBullets = level === "🔴" && state ? buildRedVisitReasonsBullets(state) : [];

  return {
    common,
    conditional,
    rare_emergency,
    reassuranceCommon,
    reassuranceBullets: reassurance.slice(0, 3),
    consultChangeBullets: consultChanges.slice(0, 3),
    redVisitReasonsBullets,
    triageLevel: level,
  };
}

/** 🤝/📝モーダル：疾患名2つ＋各2〜3文の説明を生成（ユーザー情報は一切含めない）※旧仕様・フォールバック用 */
async function buildDiseaseFocusedModalMessage(searchResults = [], mainSymptom = "", level = "🟢", state = null) {
  const searchText = (searchResults || [])
    .slice(0, 30)
    .map((r) => `${r?.title || ""} ${r?.snippet || ""}`)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
  if (!searchText) {
    return buildDiseaseFocusedModalFallback(mainSymptom, level, state);
  }
  const fallbackPair = getDiseaseFallbackPair(mainSymptom);
  const tryExtract = async (simplified = false) => {
    const prompt = simplified
      ? "検索結果から主症状に関連する疾患を2つ選び、各2〜3文で説明。JSONのみ返す：{\"diseases\":[{\"name\":\"疾患名\",\"description\":\"説明\"},{\"name\":\"疾患名\",\"description\":\"説明\"}]}"
      : [
          "検索結果から、主症状に関連する代表的な疾患を2つ選び、各疾患を2〜3文で説明してください。",
          "厳守：",
          "- 疾患名を必ず2つ出す（例：緊張型頭痛、片頭痛 / 口内ヘルペス、口角炎）",
          "- 各疾患ごとに2〜3文で説明",
          "- ユーザーの症状・入力内容は一切含めない",
          "- 「あなたの場合」「この症状は」などの個別化表現は禁止",
          "- 診断を断定しない（「〜です」→「〜とされる状態です」）",
          "- 合併症・重篤例の詳細説明は含めない",
          "- 恐怖を煽る表現は禁止",
          "JSON形式で返す：{\"diseases\":[{\"name\":\"疾患名\",\"description\":\"2〜3文の説明\"},{\"name\":\"疾患名\",\"description\":\"2〜3文の説明\"}]}",
        ].join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `主症状: ${mainSymptom}\n\n検索結果:\n${searchText}` },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    const raw = completion?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObjectFromText(raw);
    return Array.isArray(parsed?.diseases) ? parsed.diseases : [];
  };
  let diseases = [];
  try {
    diseases = await tryExtract(false);
    if (diseases.length < 2) {
      diseases = await tryExtract(true);
    }
    if (diseases.length === 1 && fallbackPair[1]) {
      diseases.push({ name: fallbackPair[1].name, description: fallbackPair[1].desc });
    }
    if (diseases.length >= 2) {
      const lines = ["今の状態は、次のようなパターンと似ています。", ""];
      diseases.slice(0, 2).forEach((d) => {
        const name = String(d?.name || "").trim() || "考えられる状態";
        const desc = String(d?.description || "").trim();
        lines.push(`■ ${name}`);
        lines.push(desc || "検索情報から、この状態が考えられることがあります。");
        lines.push("");
      });
      if (level === "🟢" || level === "🟡") {
        const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
        lines.push("現時点の安心材料");
        (state ? buildReassuranceBulletsForPatterns(state) : ["・強い緊急サインは今のところはっきりしていません"]).slice(0, 3).forEach((b) => lines.push(b));
        lines.push("");
        lines.push("こんな変化があれば受診を検討");
        buildConsultChangeBulletsForPatterns(category).slice(0, 3).forEach((b) => lines.push(b));
      } else if (level === "🔴") {
        lines.push("今回受診をおすすめしている理由");
        buildRedVisitReasonsBullets(state).forEach((b) => lines.push(b));
        lines.push("");
        lines.push("これらがあるため、一度医療機関で確認しておくと安心です。");
      }
      return lines.join("\n").trim();
    }
  } catch (_) {
    /* fallback */
  }
  return buildDiseaseFocusedModalFallback(mainSymptom, level, state);
}

function getDiseaseFallbackPair(mainSymptom) {
  const fallbacks = {
    頭痛: [
      { name: "緊張型頭痛", desc: "筋肉の緊張やストレスが関係するとされる状態です。頭の周囲が締め付けられるような痛みが特徴です。" },
      { name: "片頭痛", desc: "血管の拡張や神経の過敏化が関与するとされる状態です。ズキズキとした痛みが片側に出ることが多いとされています。" },
    ],
    腹痛: [
      { name: "急性胃腸炎", desc: "消化管の炎症とされる状態です。感染や刺激が関与することがあり、腹痛や下痢、吐き気などを伴うことがあります。" },
      { name: "過敏性腸症候群", desc: "ストレスや生活習慣が関与するとされる状態です。腹痛と便通の変化が主な特徴とされています。" },
    ],
    唇の痛み: [
      { name: "口唇ヘルペス", desc: "ヘルペスウイルスが関与する場合があり、唇に水ぶくれやヒリヒリ感が出るとされる状態です。" },
      { name: "口角炎", desc: "口角の炎症や亀裂が生じるとされる状態です。乾燥やビタミン不足が関与することがあります。" },
    ],
    喉の痛み: [
      { name: "急性咽頭炎", desc: "咽頭の炎症とされる状態です。のどの痛みや違和感が主な症状です。" },
      { name: "急性扁桃炎", desc: "扁桃の炎症とされる状態です。発熱やのどの痛みを伴うことがあります。" },
    ],
    発熱: [
      { name: "感冒", desc: "上気道の炎症とされる状態です。発熱、咳、鼻水などを伴うことがあります。" },
      { name: "インフルエンザ", desc: "季節性の感染症とされる状態です。高熱や全身倦怠感が特徴です。" },
    ],
    皮膚症状: [
      { name: "接触皮膚炎", desc: "刺激物への接触により皮膚に炎症が生じるとされる状態です。赤みやかゆみが主な症状です。" },
      { name: "乾燥性皮膚炎", desc: "皮膚のバリア機能低下により乾燥やヒリつきが出るとされる状態です。" },
    ],
    体調不良: [
      { name: "感冒", desc: "上気道の炎症とされる状態です。発熱、咳、鼻水、倦怠感などを伴うことがあります。" },
      { name: "自律神経の乱れ", desc: "ストレスや生活習慣の影響で自律神経のバランスが崩れるとされる状態です。だるさや不調の原因になることがあります。" },
    ],
  };
  return fallbacks[mainSymptom] || fallbacks.頭痛;
}

function buildDiseaseFocusedModalFallback(mainSymptom, level, state = null) {
  const pair = getDiseaseFallbackPair(mainSymptom);
  const lines = ["今の状態は、次のようなパターンと似ています。", ""];
  pair.forEach((d) => {
    lines.push(`■ ${d.name}`);
    lines.push(d.desc);
    lines.push("");
  });
  if (level === "🟢" || level === "🟡") {
    const category = state ? (state.triageCategory || resolveQuestionCategoryFromState(state)) : "PAIN";
    lines.push("現時点の安心材料");
    (state ? buildReassuranceBulletsForPatterns(state) : ["・強い緊急サインは今のところはっきりしていません"]).slice(0, 3).forEach((b) => lines.push(b));
    lines.push("");
    lines.push("こんな変化があれば受診を検討");
    buildConsultChangeBulletsForPatterns(category).slice(0, 3).forEach((b) => lines.push(b));
  } else if (level === "🔴") {
    lines.push("今回受診をおすすめしている理由");
    buildRedVisitReasonsBullets(state).forEach((b) => lines.push(b));
    lines.push("");
    lines.push("これらがあるため、一度医療機関で確認しておくと安心です。");
  }
  return lines.join("\n").trim();
}

function splitSearchFindings(results = []) {
  const joined = (results || [])
    .slice(0, 10)
    .map((r) => `${r.title || ""} ${r.snippet || ""}`)
    .join("\n");
  const lines = joined
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const explanation = [];
  const progression = [];
  const checkpoints = [];

  for (const line of lines) {
    if (
      /原因|related|associated|状態|condition|irritation|inflammation|trigger|誘因|刺激/.test(line) &&
      explanation.length < 3
    ) {
      explanation.push(line);
      continue;
    }
    if (
      /悪化|長引|続く|progress|worsen|persist|flare|繰り返/.test(line) &&
      progression.length < 3
    ) {
      progression.push(line);
      continue;
    }
    if (
      /受診|医療|emergency|red flag|warning sign|受診目安|救急|hospital|seek care/.test(line) &&
      checkpoints.length < 3
    ) {
      checkpoints.push(line);
      continue;
    }
  }

  if (explanation.length === 0 && lines[0]) explanation.push(lines[0]);
  if (progression.length === 0 && lines[1]) progression.push(lines[1]);
  if (checkpoints.length === 0 && lines[2]) checkpoints.push(lines[2]);

  return { explanation, progression, checkpoints };
}

function cleanFindingText(line) {
  return String(line || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[「」]/g, "")
    .trim();
}

function buildEvidenceDrivenConcreteMessage(options = {}) {
  const {
    findings = {},
    level = "🟢",
    category = "PAIN",
    state = null,
    causeText = "",
    durationText = "",
    strengthText = "",
    symptomText = "",
  } = options;
  const explanation = cleanFindingText((findings.explanation || [])[0] || "");
  const progression = cleanFindingText((findings.progression || [])[0] || "");
  const checkpoint = cleanFindingText((findings.checkpoints || [])[0] || "");
  const clinical = buildClinicalDetailLines({
    category,
    causeText,
    durationText,
    strengthText,
    symptomText,
    associated: getSlotStatusValue(state, "associated", state?.slotAnswers?.associated_symptoms || ""),
    isCauseValid: Boolean(causeText),
  });
  const c1 = cleanFindingText(clinical[1] || "");
  const c2 = cleanFindingText(clinical[2] || "");

  const p1 = [
    explanation
      ? `検索情報を統合すると、${explanation.replace(/。?$/, "")}と解釈できます。`
      : `${durationText || "現在の経過"}と${strengthText || "症状の強さ"}の組み合わせは、症状変動を読むための軸になります。`,
    progression
      ? `進行の見方としては、${progression.replace(/。?$/, "")}という記載が複数ソースで確認されます。`
      : `${c1 || "症状は時間帯や負荷で強さが変わることがあるため、経過の方向を連続して見ることが重要です。"}`
  ];
  const p2 = [
    c2 || "関連する器官や刺激要因を分けて見ると、症状の重なり方を解釈しやすくなります。",
    checkpoint
      ? `見極めポイントとしては、${checkpoint.replace(/。?$/, "")}が受診判断の境界として整理されています。`
      : "見極めは、症状が短時間で強まるか、新しい症状が加わるかを軸に置くのが妥当です。"
  ];

  const lines = [
    "今の状態は、次のようなパターンと似ています。",
    "",
    "■ 検索情報から見た現在の状態パターン",
    ...p1,
    "",
    "■ 経過と見極めのパターン",
    ...p2,
  ];

  if (level === "🟢" || level === "🟡") {
    lines.push("", "現時点の安心材料");
    buildReassuranceBulletsForPatterns(state).slice(0, 3).forEach((b) => lines.push(b));
    lines.push("", "こんな変化があれば受診を検討");
    buildConsultChangeBulletsForPatterns(category).slice(0, 3).forEach((b) => lines.push(b));
  } else if (level === "🔴") {
    lines.push("", "今回受診をおすすめしている理由");
    buildRedVisitReasonsBullets(state).forEach((b) => lines.push(b));
    lines.push("", "これらがあるため、一度医療機関で確認しておくと安心です。");
  }
  return lines.join("\n").trim();
}

function summarizeFindingLine(line, symptoms = []) {
  const symptomText = (symptoms || []).slice(0, 3).join(" / ");
  const cleaned = String(line || "")
    .replace(/\s+/g, " ")
    .replace(/[。\.]?\s*続きを読む.*$/i, "")
    .trim();
  if (!cleaned) return null;
  return symptomText
    ? `・${symptomText} という記載に近い文脈では、${cleaned}`
    : `・${cleaned}`;
}

function countJapaneseSentences(text) {
  return String(text || "")
    .split(/[。！？!?]/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function buildClinicalDetailLines(options = {}) {
  const {
    category = "PAIN",
    causeText = "",
    durationText = "",
    strengthText = "",
    symptomText = "",
    associated = "",
    isCauseValid = false,
  } = options;

  const byCategory = {
    GI: {
      mechanism:
        "発生メカニズムとしては、腸管のけいれんや蠕動の乱れ、消化管粘膜への刺激が重なると痛みが増幅しやすい。",
      organ:
        "関連器官は胃・小腸・大腸で、部位差によって痛みの質（キリキリ/鈍痛）と波の出方が変化する。",
      combo:
        "症状の組み合わせ（腹痛 + 便通変化 + 吐き気）の同時出現は、刺激性の消化管反応を示す情報として扱える。",
    },
    SKIN: {
      mechanism:
        "発生メカニズムとしては、角層バリア機能の低下により外的刺激の侵入と水分蒸散が同時に進み、ヒリヒリ感が持続しやすい。",
      organ:
        "関連器官は表皮・角層で、乾燥や摩擦の反復で局所炎症が増えると痛みの閾値が下がる。",
      combo:
        "症状の組み合わせ（ヒリヒリ + 乾燥 + 触刺激で増悪）は、バリア障害型の経過情報として解釈できる。",
    },
    INFECTION: {
      mechanism:
        "発生メカニズムとしては、上気道粘膜の炎症と乾燥刺激が重なり、咽頭痛や違和感が増幅しやすい。",
      organ:
        "関連器官は咽頭・鼻腔・気道上部で、炎症部位の広がりに応じて咳や全身症状の出方が変わる。",
      combo:
        "症状の組み合わせ（咽頭痛 + 咳/鼻症状 + 体温変化）は、局所炎症の進行度をみる判断材料になる。",
    },
    PAIN: {
      mechanism:
        "発生メカニズムとしては、筋緊張・血管反応・感覚神経の過敏化が重なり、痛みの強さが時間で変動しやすい。",
      organ:
        "関連器官は主に筋膜・末梢神経・血管系で、刺激負荷が続くと痛み閾値が低下しやすい。",
      combo:
        "症状の組み合わせ（痛みの質 + 強さスコア + 時間経過）は、悪化要因の同定に有効な情報軸になる。",
    },
  };

  const base = byCategory[category] || byCategory.PAIN;
  const causeLine = isCauseValid
    ? `きっかけとして「${causeText}」がある場合、${durationText || "現在の経過"}で${strengthText || "症状強度"}が変動しやすい。`
    : `${durationText || "現在の経過"}で${strengthText || "症状強度"}と${symptomText || "症状特徴"}を同時に追うと病態把握の精度が上がる。`;
  const assocLine = associated
    ? `随伴症状として「${associated}」が同時にある場合、単独症状よりも病態情報の解像度が高くなる。`
    : "随伴症状の有無は、経過判定で重みの大きい観察点になる。";

  return [causeLine, base.mechanism, base.organ, base.combo, assocLine];
}

function enforceConcreteModalStructure(message, options = {}) {
  const {
    level = "🟢",
    isCauseValid = false,
    causeText = "",
    strengthText = "",
    durationText = "",
    symptomText = "",
    category = "PAIN",
    state = null,
    associatedText = "",
  } = options;
  const lines = String(message || "")
    .split("\n")
    .map((line) => line.trimEnd());

  const sectionHeaders = new Set([
    "現時点の安心材料",
    "こんな変化があれば受診を検討",
    "今回受診をおすすめしている理由",
  ]);
  const patternBlocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] || "").trim();
    if (!line.startsWith("■ ")) {
      i += 1;
      continue;
    }
    const block = [line];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] || "").trim();
      if (next.startsWith("■ ") || sectionHeaders.has(next)) break;
      block.push(lines[i]);
      i += 1;
    }
    patternBlocks.push(block);
  }

  let selectedBlocks = patternBlocks.slice(0, 2);
  if (selectedBlocks.length === 0) {
    selectedBlocks = [
      ["■ 現在の状態に近いパターン"],
      ["■ 症状の変化を確認するパターン"],
    ];
  } else if (selectedBlocks.length === 1) {
    selectedBlocks = [selectedBlocks[0], ["■ 症状の変化を確認するパターン"]];
  }

  if (isCauseValid) {
    selectedBlocks[0][0] = `■ ${causeText}が関係する状態変化のパターン`;
  }

  const supplements = buildClinicalDetailLines({
    category,
    causeText,
    durationText,
    strengthText,
    symptomText,
    associated: associatedText,
    isCauseValid,
  });

  selectedBlocks = selectedBlocks.map((block, idx) => {
    const title = block[0] && String(block[0]).trim().startsWith("■ ")
      ? block[0]
      : idx === 0
        ? "■ 現在の状態に近いパターン"
        : "■ 症状の変化を確認するパターン";
    const body = block.slice(1).filter((l) => (l || "").trim().length > 0);

    if (idx === 0 && isCauseValid) {
      const causeLead = `${causeText}というきっかけの後に、${durationText || "現在の経過"}で${strengthText || "症状の強さ"}が変わる点は、経過把握で重要な材料です。`;
      if (!body.some((line) => String(line || "").includes(causeText))) {
        body.unshift(causeLead);
      }
    }

    let sentenceCount = countJapaneseSentences(body.join(" "));
    let sIdx = 0;
    while (sentenceCount < 2 && sIdx < supplements.length) {
      body.push(supplements[sIdx]);
      sIdx += 1;
      sentenceCount = countJapaneseSentences(body.join(" "));
    }
    while (sentenceCount > 3 && body.length > 0) {
      body.pop();
      sentenceCount = countJapaneseSentences(body.join(" "));
    }
    return [title, ...body];
  });

  const out = ["今の状態は、次のようなパターンと似ています。", ""];
  selectedBlocks.forEach((b, idx) => {
    out.push(...b);
    if (idx < selectedBlocks.length - 1) out.push("");
  });

  if (level === "🟢" || level === "🟡") {
    out.push("", "現時点の安心材料");
    const reassurance = buildReassuranceBulletsForPatterns(state).slice(0, 3);
    reassurance.forEach((line) => out.push(line));
    out.push("", "こんな変化があれば受診を検討");
    const consult = buildConsultChangeBulletsForPatterns(category).slice(0, 3);
    consult.forEach((line) => out.push(line));
  } else if (level === "🔴") {
    out.push("", "今回受診をおすすめしている理由");
    buildRedVisitReasonsBullets(state).forEach((line) => out.push(line));
    out.push("", "これらがあるため、一度医療機関で確認しておくと安心です。");
  }

  return out
    .join("\n")
    .replace(/[🟢🟡🔴🤝📝✅⏳⚠️💬🌱🏥🚨💊]/g, "")
    .replace(/安心材料として/g, "")
    .replace(/挙げられます/g, "記載できる")
    .replace(/検討してください/g, "検討する")
    .replace(/整理/g, "理解")
    .replace(/このような症状では/g, "今回の経過では")
    .replace(/一般的に/g, "今回の情報では")
    .replace(/場合があります/g, "ことがあります");
}

function dedupeDiseaseSearchResults(results = []) {
  const seen = new Set();
  const out = [];
  for (const item of results) {
    const key = `${item?.host || ""}|${String(item?.title || "").toLowerCase().slice(0, 80)}`;
    if (!item?.link || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (a.trusted === b.trusted ? 0 : a.trusted ? -1 : 1));
}

async function buildConcreteStateDetailsFromSearch(state, summaryFacts = [], summarySection = "") {
  const mainSymptom = toMainSymptomForDiseaseSearch(state);
  const extraTerms = collectConcreteSymptomTerms(state, summaryFacts, summarySection);
  const slotFacts = [
    ...collectSlotFactsForDiseaseSearch(state),
    ...(Array.isArray(summaryFacts) ? summaryFacts.filter(Boolean) : []),
    ...extraTerms,
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 10);
  const { queryJP, queryEN, ja, en } = buildDiseaseSearchQueries(mainSymptom, slotFacts);

  const allQueries = [
    ...(ja || [queryJP]).map((q) => ({ q, lang: "ja" })),
    ...(en || [queryEN]).map((q) => ({ q, lang: "en" })),
  ].filter((x) => x.q && String(x.q).trim().length > 0);
  const searchPromises = allQueries.map(({ q, lang }) => fetchGoogleCustomSearchResults(q, lang));
  const searchResults = await Promise.allSettled(searchPromises);
  let allResults = dedupeDiseaseSearchResults(
    searchResults.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []))
  );
  if (allResults.length === 0) {
    const mainEn = MAIN_SYMPTOM_TO_EN_DISEASE[mainSymptom] || "symptoms";
    const retryQueries = [
      { q: `${mainSymptom} 病名 症状`.replace(/\s{2,}/g, " ").trim().slice(0, 120), lang: "ja" },
      { q: `${mainEn} conditions`.trim(), lang: "en" },
      { q: `${mainSymptom} 疾患`.replace(/\s{2,}/g, " ").trim().slice(0, 80), lang: "ja" },
      { q: `${mainSymptom} 症状 説明`.replace(/\s{2,}/g, " ").trim().slice(0, 100), lang: "ja" },
      { q: `${mainEn} causes`.trim(), lang: "en" },
      { q: `${mainEn} symptoms treatment`.trim(), lang: "en" },
    ];
    const retryResults = await Promise.allSettled(
      retryQueries.map(({ q, lang }) => fetchGoogleCustomSearchResults(q, lang))
    );
    const retryItems = retryResults.flatMap((r) =>
      r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []
    );
    allResults = dedupeDiseaseSearchResults([...allResults, ...retryItems]);
  }
  if (allResults.length === 0) {
    const mainEn = MAIN_SYMPTOM_TO_EN_DISEASE[mainSymptom] || "symptoms";
    const [broadJa, broadEn] = await Promise.all([
      fetchGoogleCustomSearchResults(`${mainSymptom} 医療`, "ja", 2, true),
      fetchGoogleCustomSearchResults(`${mainEn} medical`, "en", 2, true),
    ]);
    allResults = dedupeDiseaseSearchResults([...(broadJa || []), ...(broadEn || [])]);
  }
  const sourceNames = Array.from(
    new Set(allResults.filter((r) => r.trusted).map((r) => r.host).filter(Boolean))
  ).slice(0, 4);

  const level = state?.decisionLevel || finalizeRiskLevel(state);
  let structured = null;
  try {
    structured = await buildDiseaseSafetyFilteredMessage(
      allResults,
      mainSymptom,
      level,
      state,
      summaryFacts,
      summarySection
    );
  } catch (_) {
    /* fallback to plain message */
  }

  const lines = [];
  if (structured) {
    lines.push("あなたの状態の理解を深める", "");
    lines.push("🟢 よくある原因");
    structured.common.forEach((c) => lines.push(c.startsWith("・") ? c : `・${c}`));
    lines.push("");
    lines.push("🟡 状況によっては確認が必要");
    structured.conditional.forEach((c) => lines.push(c.startsWith("・") ? c : `・${c}`));
    lines.push("");
    lines.push("🔴 すぐ受診が必要なサイン（折りたたみ・初期非表示）");
    structured.rare_emergency.forEach((r) => lines.push(r.startsWith("・") ? r : `・${r}`));
    lines.push("");
    lines.push(structured.reassuranceCommon);
    lines.push("");
    if (level === "🟢" || level === "🟡") {
      lines.push("現時点の安心材料");
      structured.reassuranceBullets.forEach((b) => lines.push(b));
      lines.push("");
      lines.push("こんな変化があれば受診を検討");
      structured.consultChangeBullets.forEach((b) => lines.push(b));
    } else if (level === "🔴") {
      lines.push("今回受診をおすすめしている理由");
      buildRedVisitReasonsBullets(state).forEach((b) => lines.push(b));
      lines.push("");
      lines.push("これらがあるため、一度医療機関で確認しておくと安心です。");
    }
  }

  let message = lines.length > 0
    ? lines.join("\n").trim()
    : await buildDiseaseFocusedModalMessage(allResults, mainSymptom, level, state);

  message = String(message || "")
    .replace(/このような症状では/g, "今回の経過では")
    .replace(/一般的に/g, "今回の情報では")
    .replace(/場合があります/g, "ことがあります")
    .replace(/あなたの場合|この症状は/g, "")
    .split("\n")
    .filter((line) => !/^(抽出した症状語:|検索クエリ\(JP\):|検索クエリ\(EN\):|参考ソース:|デバッグ)/.test(line.trim()))
    .join("\n")
    .trim();

  if (IS_DEBUG) {
    message += `\n\n[debug]\n主症状: ${mainSymptom}\nqueryJP: ${queryJP}\nqueryEN: ${queryEN}\nsource: ${sourceNames.join(" / ")}`;
  }

  return {
    message,
    structured: structured ? { ...structured, triageLevel: level } : null,
    triageLevel: level,
    query: `${queryJP} || ${queryEN}`,
    queryJP,
    queryEN,
    sourceNames,
  };
}

const ACTION_TRUSTED_MEDICAL_DOMAINS = [
  "mhlw.go.jp",
  "medlineplus.gov",
  "nih.gov",
  "nhs.uk",
  "mayoclinic.org",
  "who.int",
  "cdc.gov",
  "clevelandclinic.org",
  "johnshopkinsmedicine.org",
  "msdmanuals.com",
  "webmd.com",
];

function getActionSearchHost(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function isTrustedActionMedicalSource(url) {
  const host = getActionSearchHost(url);
  if (!host) return false;
  return ACTION_TRUSTED_MEDICAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function compactConcreteMessageForQuery(detailMessage) {
  const lines = String(detailMessage || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(
      (line) =>
        !/^(あなたの状態の理解を深める|今の状態は、次のようなパターンと似ています。|現時点の安心材料|こんな変化があれば受診を検討|今回受診をおすすめしている理由|■|🟢 よくある原因|🟡 状況によっては確認が必要|🔴 すぐ受診が必要なサイン)/.test(
          line
        )
    )
    .map((line) => line.replace(/^・\s*/, ""));
  return lines.join("／").slice(0, 280);
}

function buildExternalActionSearchQuery(concrete, features) {
  const mergedNarrative = compactConcreteMessageForQuery(concrete?.message || "");
  const parts = [
    mergedNarrative,
    concrete?.query || "",
    features?.bodyPart || "",
    features?.painType || "",
    features?.duration || "",
    Array.isArray(features?.triggers) ? features.triggers.join(" ") : "",
    Array.isArray(features?.associatedSymptoms) ? features.associatedSymptoms.join(" ") : "",
    "できること",
    "対処法",
    "self care",
  ]
    .filter(Boolean)
    .join(" / ");
  return parts.replace(/\s{2,}/g, " ").trim().slice(0, 420);
}

function isGoogleCustomSearchConfigured() {
  const key =
    process.env.GOOGLE_SEARCH_API_KEY ||
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ||
    process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
  return !!(key && cx);
}

let _hasWarnedSearchApi = false;
function warnIfSearchApiNotConfigured() {
  if (_hasWarnedSearchApi) return;
  if (!isGoogleCustomSearchConfigured()) {
    _hasWarnedSearchApi = true;
    console.warn(
      "[今すぐやること] Google Custom Search API が未設定です。検索結果が使えず汎用フォールバックになります。.env に GOOGLE_SEARCH_API_KEY と GOOGLE_SEARCH_CX（または GOOGLE_CUSTOM_SEARCH_API_KEY / GOOGLE_CUSTOM_SEARCH_CX）を設定してください。"
    );
  }
}

async function fetchGoogleCustomSearchResults(query, language = "ja", retries = 2, skipLanguageRestriction = false) {
  const key =
    process.env.GOOGLE_SEARCH_API_KEY ||
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ||
    process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!key || !cx) {
    warnIfSearchApiNotConfigured();
    return [];
  }
  const q = String(query || "").trim();
  if (!q) return [];
  const params = new URLSearchParams({
    key,
    cx,
    q: q.slice(0, 512),
    num: "10",
    safe: "active",
    hl: language === "ja" ? "ja" : "en",
  });
  if (!skipLanguageRestriction) {
    params.set("lr", language === "ja" ? "lang_ja" : "lang_en");
  }
  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      const data = await response.json().catch(() => ({}));
      if (data?.error) {
        if (data.error.code === 429 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        return [];
      }
      if (!response.ok) {
        if (response.status === 429 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        return [];
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      return items.map((item) => ({
        title: String(item?.title || "").trim(),
        snippet: String(item?.snippet || "").trim(),
        link: String(item?.link || "").trim(),
        host: getActionSearchHost(item?.link),
        trusted: isTrustedActionMedicalSource(item?.link),
        language,
      }));
    } catch (_) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      } else {
        return [];
      }
    }
  }
  return [];
}

function computeSearchContextRelevance(item, features = {}) {
  const text = `${item?.title || ""} ${item?.snippet || ""}`.toLowerCase();
  let score = 0;
  const cues = [
    features?.bodyPart,
    features?.painType,
    features?.duration,
    ...(Array.isArray(features?.triggers) ? features.triggers : []),
    ...(Array.isArray(features?.associatedSymptoms) ? features.associatedSymptoms : []),
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  for (const cue of cues) {
    if (text.includes(cue)) score += 2;
  }
  if (/self[-\s]?care|care at home|対処|セルフケア|home treatment/.test(text)) score += 2;
  return score;
}

function dedupeAndRankActionSearchResults(results = [], features = {}) {
  const seen = new Set();
  const out = [];
  for (const item of results) {
    const key = `${item.host}|${String(item.title || "").toLowerCase()}`;
    if (!item.link || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...item,
      relevance: computeSearchContextRelevance(item, features),
    });
  }
  return out.sort((a, b) => {
    if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
    return (b.relevance || 0) - (a.relevance || 0);
  });
}

function extractFeatures(stateText) {
  const text = String(stateText || "");
  const normalized = text.replace(/\s+/g, "");
  const bodyPartMap = [
    { key: "唇", re: /(唇|口元|口唇)/ },
    { key: "頭", re: /(頭|こめかみ|後頭部|頭部)/ },
    { key: "喉", re: /(喉|のど|咽頭)/ },
    { key: "お腹", re: /(お腹|腹|胃|みぞおち|腸)/ },
    { key: "皮膚", re: /(皮膚|手|指|顔|頬|腕|脚)/ },
  ];
  const painTypeMap = [
    { key: "ズキズキ", re: /(ズキズキ|脈打つ)/ },
    { key: "ヒリヒリ", re: /(ヒリヒリ|しみる)/ },
    { key: "締め付け", re: /(締め付け|圧迫)/ },
    { key: "キリキリ", re: /(キリキリ)/ },
    { key: "チクチク", re: /(チクチク|ピリピリ)/ },
  ];
  const durationMap = [
    { key: "さっき", re: /(さっき|今さっき)/ },
    { key: "数時間", re: /(数時間|半日|今日)/ },
    { key: "1日以上", re: /(昨日|一日以上|数日|何日)/ },
  ];
  const triggerMap = [
    { key: "画面刺激", re: /(スマホ|パソコン|画面|ブルーライト)/ },
    { key: "睡眠不足", re: /(寝不足|睡眠不足|徹夜)/ },
    { key: "疲労", re: /(疲れ|疲労|ハード)/ },
    { key: "ストレス", re: /(ストレス|緊張|不安)/ },
    { key: "冷え", re: /(冷え|寒気)/ },
    { key: "食事", re: /(食後|食あたり|脂っこい|刺激物)/ },
  ];
  const assocMap = [
    { key: "発熱", re: /(発熱|高熱|38度|37度)/ },
    { key: "吐き気", re: /(吐き気|むかつき)/ },
    { key: "嘔吐", re: /(嘔吐|吐いた)/ },
    { key: "下痢", re: /(下痢|軟便)/ },
    { key: "水ぶくれ", re: /(水ぶくれ|ただれ)/ },
    { key: "赤み", re: /(赤み|発疹|腫れ)/ },
    { key: "出血なし", re: /(出血はない|血は出てない|出血なし)/ },
    { key: "息苦しさ", re: /(息苦しい|胸が苦しい)/ },
  ];

  const bodyPart = bodyPartMap.find((m) => m.re.test(normalized))?.key || null;
  const painType = painTypeMap.find((m) => m.re.test(normalized))?.key || null;
  const duration = durationMap.find((m) => m.re.test(normalized))?.key || null;
  const onsetType = /(突然|急に|いきなり)/.test(normalized)
    ? "突然"
    : /(徐々に|だんだん|少しずつ)/.test(normalized)
      ? "徐々に"
      : null;
  const triggers = triggerMap.filter((m) => m.re.test(normalized)).map((m) => m.key);
  const associatedSymptoms = assocMap.filter((m) => m.re.test(normalized)).map((m) => m.key);

  let severityHint = null;
  const painMatch = text.match(/(\d{1,2})\s*\/\s*10|痛み[はが]?\s*(\d{1,2})/);
  const painScore = Number(painMatch?.[1] || painMatch?.[2] || NaN);
  if (Number.isFinite(painScore)) {
    severityHint = painScore >= 7 ? "high" : painScore >= 5 ? "medium" : "low";
  } else if (/(動けないほど|38度以上|激痛|強い息苦しさ)/.test(normalized)) {
    severityHint = "high";
  } else if (/(少しつらい|37度台|つらい)/.test(normalized)) {
    severityHint = "medium";
  } else {
    severityHint = "low";
  }
  return {
    bodyPart,
    painType,
    duration,
    onsetType,
    triggers,
    associatedSymptoms,
    severityHint,
  };
}

function extractSymptomKeywordsFromText(text) {
  const raw = String(text || "");
  const lexicon =
    /(便秘|下痢|腹痛|お腹|胃痛|吐き気|嘔吐|キリキリ|ズキズキ|ヒリヒリ|締め付け|チクチク|しびれ|めまい|咳|せき|喉|のど|鼻水|発熱|寒気|だるい|赤み|発疹|水ぶくれ|乾燥|痛み\s*\d+\s*\/\s*10|さっきから|さっき|数時間|半日|一日以上|変化なし)/g;
  const matches = raw.match(lexicon) || [];
  return Array.from(new Set(matches.map((m) => String(m || "").trim()).filter(Boolean))).slice(0, 12);
}

function parseNumericSignalsFromText(text) {
  const raw = String(text || "");
  const compact = raw.replace(/\s+/g, "");
  const painMatch = raw.match(/(\d{1,2})\s*\/\s*10|痛み[はが]?\s*(\d{1,2})/);
  const painScore = Number(painMatch?.[1] || painMatch?.[2] || NaN);
  const tempMatch = raw.match(/(\d{2}(?:\.\d)?)\s*度/);
  const temperatureC = Number(tempMatch?.[1] || NaN);
  const durationMatches = [...raw.matchAll(/(\d+)\s*(分|時間|日|週間)/g)].map((m) => ({
    value: Number(m[1]),
    unit: m[2],
  }));
  const hasFeverNegation = /(発熱なし|熱はない|熱なし|平熱)/.test(compact);
  return {
    painScore: Number.isFinite(painScore) ? painScore : null,
    temperatureC: Number.isFinite(temperatureC) ? temperatureC : null,
    durationSignals: durationMatches.slice(0, 4),
    hasFeverNegation,
  };
}

function buildStructuredUserInputForLlm(text, state = null) {
  const features = extractFeatures(text);
  const numeric = parseNumericSignalsFromText(text);
  const keywords = extractSymptomKeywordsFromText(text);
  const slotSnapshot = {
    severity: getSlotStatusValue(state, "severity", state?.slotAnswers?.pain_score || "") || null,
    worsening: getSlotStatusValue(state, "worsening", state?.slotAnswers?.worsening || "") || null,
    duration: getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "") || null,
    impact: getSlotStatusValue(state, "impact", state?.slotAnswers?.daily_impact || "") || null,
    associated: getSlotStatusValue(state, "associated", state?.slotAnswers?.associated_symptoms || "") || null,
    cause_category: getSlotStatusValue(state, "cause_category", state?.slotAnswers?.cause_category || "") || null,
  };
  return {
    numeric_signals: numeric,
    symptom_keywords: keywords,
    feature_signals: {
      bodyPart: features.bodyPart,
      painType: features.painType,
      duration: features.duration,
      onsetType: features.onsetType,
      triggers: features.triggers,
      associatedSymptoms: features.associatedSymptoms,
      severityHint: features.severityHint,
    },
    slot_snapshot: slotSnapshot,
  };
}

function buildStructuredConversationForLlm(history = [], state = null) {
  const safeHistory = Array.isArray(history) ? history.filter((m) => m && m.role !== "system").slice(-14) : [];
  return safeHistory.map((msg) => {
    if (msg.role !== "user") {
      return {
        role: msg.role,
        content: String(msg.content || "").slice(0, 600),
      };
    }
    return {
      role: "user",
      content: JSON.stringify({
        type: "structured_user_input",
        payload: buildStructuredUserInputForLlm(msg.content, state),
      }),
    };
  });
}

function hasAnyMatch(value, candidates = []) {
  if (!value || !Array.isArray(candidates)) return false;
  return candidates.includes(value);
}

function overlapCount(values = [], candidates = []) {
  if (!Array.isArray(values) || !Array.isArray(candidates)) return 0;
  const set = new Set(values);
  return candidates.filter((v) => set.has(v)).length;
}

function scoreHypothesis(hypothesis, features) {
  let score = 0;
  const majorBody = hasAnyMatch(features.bodyPart, hypothesis?.matchRules?.bodyPart || []);
  const majorPain = hasAnyMatch(features.painType, hypothesis?.matchRules?.painType || []);
  if (majorBody) score += 2;
  if (majorPain) score += 2;
  if (hasAnyMatch(features.duration, hypothesis?.matchRules?.duration || [])) score += 1;
  if (hasAnyMatch(features.onsetType, hypothesis?.matchRules?.onsetType || [])) score += 1;
  if (overlapCount(features.triggers, hypothesis?.matchRules?.triggers || []) > 0) score += 1;
  if (overlapCount(features.associatedSymptoms, hypothesis?.matchRules?.associatedSymptoms || []) > 0) score += 1;
  const contraindicationHits =
    overlapCount(
      features.associatedSymptoms,
      hypothesis?.contraindications?.associatedSymptoms || []
    ) +
    overlapCount(features.triggers, hypothesis?.contraindications?.triggers || []);
  score -= contraindicationHits * 3;
  return { score, contraindicationHits };
}

function shouldRecommendOTC(hypothesis, severity) {
  const sev = String(severity || "low");
  if (sev === "high") return false;
  if (hypothesis?.contraindicationHits > 0) return false;
  const otcRationalHypotheses = new Set([
    "skin_dry_irritation",
    "tension_stimulus_headache",
  ]);
  return otcRationalHypotheses.has(hypothesis?.id);
}

function contextMatchScore(actionText, features, hypothesis) {
  const text = String(actionText || "");
  let score = 0;
  if (features.bodyPart && text.includes(features.bodyPart)) score += 2;
  if (features.painType && text.includes(features.painType)) score += 2;
  if (features.duration && text.includes(features.duration)) score += 1;
  if ((features.triggers || []).some((t) => text.includes(t))) score += 2;
  if ((features.associatedSymptoms || []).some((s) => text.includes(s))) score += 1;
  if (hypothesis?.id && text.includes("ワセリン") && hypothesis.id === "skin_dry_irritation") score += 2;
  if (hypothesis?.id && text.includes("経口補水液") && hypothesis.id === "gi_irritation_pattern") score += 2;
  return score;
}

function validateActionSpecificity(actionText) {
  const text = String(actionText || "");
  const hasAmount = /\d+\s*(ml|回|粒|錠|分|時間|回分)|米粒|半量/.test(text);
  const hasFrequency = /(ごと|毎|おき|1日\d+回|朝昼晩)/.test(text);
  const hasDuration = /(時間|日|今日中|半日|24時間)/.test(text);
  const hasRecheck = /(悪化|続く|改善しない|受診|再評価|見直し)/.test(text);
  return hasAmount && hasFrequency && hasDuration && hasRecheck;
}

function fillActionSpecificity(actionText, hypothesisId) {
  let text = String(actionText || "").trim();
  if (!/\d+\s*(ml|回|粒|錠|分|時間|回分)|米粒|半量/.test(text)) {
    const amountByHypothesis = {
      skin_dry_irritation: "米粒2〜3粒",
      tension_stimulus_headache: "150〜200ml",
      gi_irritation_pattern: "100〜150ml",
      upper_airway_irritation: "120〜180ml",
    };
    text += `。量は${amountByHypothesis[hypothesisId] || "1回分"}を目安にしてください`;
  }
  if (!/(ごと|毎|おき|1日\d+回|朝昼晩)/.test(text)) {
    text += "。頻度は1〜2時間ごとに1回です";
  }
  if (!/(時間|日|今日中|半日|24時間)/.test(text)) {
    text += "。期間はまず今日中（半日〜24時間）続けてください";
  }
  if (!/(悪化|続く|改善しない|受診|再評価|見直し)/.test(text)) {
    text += "。悪化する・6〜8時間で改善しない場合は受診を検討して再評価してください";
  }
  return text;
}

function buildCurrentStateContext(state, historyText = "", concreteMessage = "") {
  const combinedText = [
    state?.primarySymptom || "",
    historyText || "",
    concreteMessage || "",
    state?.lastConcreteDetailsText || "",
    ...Object.values(state?.slotAnswers || {}),
  ]
    .filter(Boolean)
    .join("\n");
  const features = extractFeatures(combinedText);
  const symptoms = collectConcreteSymptomTerms(state, buildStateFactsBullets(state), combinedText);
  const intensityRaw = Number.isFinite(state?.lastPainScore)
    ? state.lastPainScore
    : Number(String(state?.slotAnswers?.pain_score || "").match(/\d+/)?.[0] || NaN);
  const intensity = Number.isFinite(intensityRaw) ? intensityRaw : 5;
  const location = features.bodyPart || resolveQuestionCategoryFromState(state);
  const duration = features.duration || state?.slotAnswers?.duration || "";
  const progression = state?.slotAnswers?.worsening || features.onsetType || "";
  const associatedSymptoms = Array.from(
    new Set([...(features.associatedSymptoms || []), String(state?.slotAnswers?.associated_symptoms || "")].filter(Boolean))
  );
  const normalizeMainSymptomLabel = (text) => {
    const s = String(text || "");
    if (/(頭が痛|頭痛|こめかみ|後頭部)/.test(s)) return "頭痛";
    if (/(お腹が痛|腹痛|胃痛|みぞおち|下腹)/.test(s)) return "腹痛";
    if (/(喉が痛|のどが痛|喉の痛み|咽頭痛)/.test(s)) return "喉の痛み";
    if (/(唇が痛|口唇|唇)/.test(s)) return "唇の痛み";
    return String(state?.primarySymptom || "症状");
  };
  const rawSlotFacts = [
    state?.slotStatus?.severity?.value,
    state?.slotStatus?.worsening?.value,
    state?.slotStatus?.duration?.value,
    state?.slotStatus?.impact?.value,
    state?.slotStatus?.associated?.value,
    state?.slotStatus?.cause_category?.value,
  ]
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0)
    .filter((v) => !/^(ない|なし|特にない|特になし|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/.test(v));
  const summaryFacts =
    rawSlotFacts.length > 0
      ? Array.from(new Set(rawSlotFacts)).slice(0, 8)
      : buildStateFactsBullets(state).map((line) => toBulletText(line));
  const mainSymptom = normalizeMainSymptomLabel([
    state?.primarySymptom || "",
    state?.slotStatus?.associated?.value || "",
    state?.slotAnswers?.associated_symptoms || "",
    historyText || "",
  ].join(" "));
  // 🤝今の状態についてのクエリ（主症状 + 箇条書き全文）。今すぐやることはこれに「対処法」を加える。
  const stateAboutFacts = buildStateFactsBullets(state).map((line) => toBulletText(line)).join(" ");
  const stateAboutQuery = `${mainSymptom} ${stateAboutFacts}`.replace(/\s{2,}/g, " ").trim();
  return {
    symptoms,
    location,
    mainSymptom,
    summaryFacts,
    stateAboutQuery,
    duration,
    intensity,
    progression,
    associatedSymptoms,
    features,
  };
}

function buildMandatoryGoogleQuery(context) {
  // 今すぐやること: 🤝今の状態についてのクエリ + 対処法
  if (context?.stateAboutQuery) {
    return `${context.stateAboutQuery} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 260);
  }
  const mainSymptom = String(context?.mainSymptom || context?.location || "症状");
  const facts = Array.isArray(context?.summaryFacts) ? context.summaryFacts.join(" ") : "";
  const symptoms = Array.isArray(context?.symptoms) ? context.symptoms.join(" ") : "";
  return `${mainSymptom} ${facts} ${symptoms} 対処法`
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 260);
}

const MAIN_SYMPTOM_TO_EN = {
  頭痛: "headache",
  腹痛: "stomach pain abdominal pain",
  "喉の痛み": "sore throat",
  "唇の痛み": "lip pain chapped lips",
  頭: "headache",
  お腹: "stomach pain",
  喉: "sore throat",
  皮膚: "skin irritation",
  症状: "symptom relief",
  PAIN: "headache pain",
  GI: "stomach pain",
  SKIN: "skin irritation",
  INFECTION: "sore throat",
};

function buildImmediateActionSearchQueries(context) {
  const mainSymptom = String(context?.mainSymptom || context?.location || "症状").trim();
  const facts = Array.isArray(context?.summaryFacts) ? context.summaryFacts.join(" ") : "";
  const symptoms = (Array.isArray(context?.symptoms) ? context.symptoms : []).join(" ").trim();
  const features = context?.features || {};
  const painType = features?.painType || "";
  const baseQuery = context?.stateAboutQuery
    ? context.stateAboutQuery
    : `${mainSymptom} ${facts} ${symptoms}`.replace(/\s{2,}/g, " ").trim();
  const mainEn =
    MAIN_SYMPTOM_TO_EN[mainSymptom] ||
    (/(頭|お腹|喉|皮膚|唇)/.test(mainSymptom)
      ? MAIN_SYMPTOM_TO_EN[mainSymptom.match(/(頭|お腹|喉|皮膚|唇)/)?.[0]] || "symptom relief"
      : "symptom relief");
  const mandatoryQuery = buildMandatoryGoogleQuery(context);
  const jaBase = [
    mandatoryQuery,
    `${baseQuery} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 256),
    `${baseQuery} 対処法 セルフケア`.replace(/\s{2,}/g, " ").trim().slice(0, 256),
    `${baseQuery} 対処法 自宅`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    `${baseQuery} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    painType ? `${baseQuery} ${painType} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 200) : null,
    `${baseQuery} 自宅 ケア 方法`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    "体調不良 対処法 自宅",
    "症状 対処法 自宅 セルフケア",
  ].filter((q) => q && String(q).trim().length > 0);
  const enBase = [
    `${mainEn} ${symptoms} self care home treatment`.replace(/\s{2,}/g, " ").trim().slice(0, 256),
    `${mainEn} self care at home`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    `${mainEn} self care`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    `${mainEn} home remedy`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    `${mainEn} treatment`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    "symptom relief self care",
    "home remedy self care",
  ].filter((q) => q && String(q).trim().length > 0);
  return {
    ja: [...new Set(jaBase)],
    en: [...new Set(enBase)],
  };
}

function extractTopSearchEvidence(results = []) {
  const top = (results || []).slice(0, 12);
  const selfCare = [];
  const observe = [];
  const danger = [];
  for (const item of top) {
    const t = `${item?.title || ""} ${item?.snippet || ""}`.trim();
    if (!t) continue;
    if (/self|care|home|対処|セルフケア|hydration|rest|保湿|補水|treatment|remedy/.test(t.toLowerCase()) && selfCare.length < 6) {
      selfCare.push(t);
    }
    if (/observe|monitor|watch|経過|継続|持続|再評価|悪化/.test(t.toLowerCase()) && observe.length < 6) {
      observe.push(t);
    }
    if (/red flag|warning|emergency|救急|受診|激痛|嘔吐|高熱|呼吸/.test(t.toLowerCase()) && danger.length < 6) {
      danger.push(t);
    }
  }
  const fallbackText = top.slice(0, 6).map((i) => `${i?.title || ""} ${i?.snippet || ""}`.trim()).filter(Boolean);
  if (selfCare.length === 0 && fallbackText.length > 0) {
    selfCare.push(...fallbackText.slice(0, 3));
  }
  return { top3: top, selfCare, observe, danger };
}

function parseJsonObjectFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch (_) {
      return null;
    }
  }
}

function buildSearchBackedHeuristicActions(context, evidence) {
  const topic = normalizeContextLocation(context?.location || "");
  const actions = [];
  const selfCareText = (evidence?.selfCare || []).join(" ").toLowerCase();
  if (topic === "皮膚" && /(petroleum|ワセリン|barrier|保湿)/.test(selfCareText)) {
    actions.push({
      title: "白色ワセリンを米粒2〜3粒ぶん、患部に白く残る厚さで塗り、2〜3時間ごとに半日続けて再評価してください",
      reason: "保護ケアで刺激の反復を減らし、バリアを保つためです。",
      isOtc: true,
    });
  }
  if (topic === "お腹") {
    actions.push({
      title: "経口補水液または水を100〜150mlずつ15〜20分ごとに2〜3時間続け、悪化時は受診に切り替えてください",
      reason: "脱水と症状推移を同時に管理するためです。",
      isOtc: false,
    });
  }
  if (topic === "頭") {
    actions.push({
      title: "画面作業を45分ごとに10分休止し、同時に150〜200mlの水分を30〜60分ごとに4回補給して半日評価してください",
      reason: "刺激負荷と体調要因を同時に下げることで、症状の推移を判断しやすくするためです。",
      isOtc: false,
    });
  }
  if (topic === "喉") {
    actions.push({
      title: "乾燥を避けて水分をこまめに取り、刺激の強い飲食を控えて2〜3時間様子を見てください",
      reason: "咽頭の乾燥と刺激を減らすことで、症状の持続を抑えやすくなります。",
      isOtc: false,
    });
  }
  return actions.slice(0, 3);
}

function normalizeAdviceTopic(topic) {
  const t = String(topic || "").toLowerCase();
  if (/(腹|お腹|胃|腸|gi)/.test(t)) return "お腹";
  if (/(喉|のど|throat|respir)/.test(t)) return "喉";
  if (/(頭|head|headache)/.test(t)) return "頭";
  if (/(唇|皮膚|skin|lip)/.test(t)) return "皮膚";
  return t;
}

function normalizeContextLocation(location) {
  return normalizeAdviceTopic(location);
}

async function generateImmediateActionsFromContextOnly(state, context, useSimplePrompt = false) {
  if (!context) return [];
  const mainSymptom = String(context?.mainSymptom || context?.location || "症状").trim();
  const stateAboutFacts = buildStateFactsBullets(state).map((line) => toBulletText(line)).join(" / ") || context?.stateAboutQuery || "";
  const userInput = [
    mainSymptom && `主症状: ${mainSymptom}`,
    stateAboutFacts && `状態: ${stateAboutFacts}`,
    context?.features && Object.keys(context.features).length > 0
      ? `回答: ${JSON.stringify(context.features)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      const useSimple = useSimplePrompt || attempt >= 2;
      let llmPrompt;
      if (useSimple) {
        llmPrompt = [
          `主症状「${mainSymptom}」に合わせて、今すぐできるセルフケアを2つ生成してください。`,
          "各行動は「・<行動>」「→ <理由>」形式。曖昧表現禁止。医療行為・危険行為禁止。",
          "JSONのみ返す: {\"actions\":[{\"title\":\"・...\",\"reason\":\"→ ...\",\"isOtc\":false}]}",
        ].join("\n");
      } else {
        llmPrompt = [
          "Generate 2-3 immediate self-care actions from the user's symptom context. No search results.",
          "CRITICAL: Do NOT lump main symptom into 'associated symptoms'. Reflect main symptom and each slot distinctly.",
          "No vague expressions. Concrete actions with 'what and how much' plus brief reason.",
          "Reason: no ・. No numbering. No medical/dangerous procedures. Tone: 〜してください / 〜するといいです.",
          "Return strict JSON: {\"actions\":[{\"title\":\"...\",\"reason\":\"...\",\"isOtc\":false}]}. OTC max 1.",
        ].join("\n");
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: llmPrompt },
          { role: "user", content: useSimple ? userInput : JSON.stringify({ currentStateContext: context, stateAboutForActions: stateAboutFacts }) },
        ],
        temperature: 0.2 + attempt * 0.05,
        max_tokens: 600,
      });
      const raw = completion?.choices?.[0]?.message?.content || "";
      const parsed = parseJsonObjectFromText(raw);
      const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
      const valid = actions.filter((a) => a && a.title && a.reason).slice(0, 3);
      if (valid.length > 0) return valid;
    } catch (_) {
      /* retry */
    }
  }
  return [];
}

/** 今すぐやることモーダル用。コンテキストのみで生成（Google APIは使用しない）。 */
async function buildImmediateActionHypothesisPlan(state, historyText = "", summarySection = "") {
  const summaryFacts = buildStateFactsBullets(state);
  const concrete = buildConcreteStatePatternMessage(state, summaryFacts, summarySection);
  const currentStateContext = buildCurrentStateContext(
    state,
    historyText,
    [concrete.message, state?.lastConcreteDetailsText || ""].filter(Boolean).join("\n")
  );
  const searchQuery = buildMandatoryGoogleQuery(currentStateContext);

  try {
    const contextOnlyActions = await generateImmediateActionsFromContextOnly(state, currentStateContext);
    return await buildImmediateActionFallbackPlanFromState(state, {
      actions: contextOnlyActions && contextOnlyActions.length > 0 ? contextOnlyActions : undefined,
      currentStateContext,
      searchQuery,
      concreteMessage: concrete.message,
    });
  } catch (error) {
    const errContext = buildCurrentStateContext(
      state,
      historyText || "",
      [state?.lastConcreteDetailsText || ""].filter(Boolean).join("\n")
    );
    const contextOnlyActions = await generateImmediateActionsFromContextOnly(state, errContext);
    return await buildImmediateActionFallbackPlanFromState(state, {
      actions: contextOnlyActions && contextOnlyActions.length > 0 ? contextOnlyActions : undefined,
      currentStateContext: errContext,
      searchQuery: buildMandatoryGoogleQuery(errContext),
      concreteMessage: "",
    });
  }
}

function buildStateDecisionLine(state, level) {
  // まとめ側の判断は buildStateAboutLine（共感＋判断）に集約
  return "";
}

function normalizeStateBlockForGreenYellow(text, state) {
  if (!text) return text;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("🤝 今の状態について"));
  if (start === -1) return text;
  const end = lines.findIndex(
    (line, idx) =>
      idx > start && (line.startsWith("✅") || line.startsWith("⏳") || line.startsWith("🚨") || line.startsWith("💊") || line.startsWith("🌱"))
  );
  const sliceEnd = end >= 0 ? end : lines.length;
  const level = state?.decisionLevel === "🟡" ? "🟡" : "🟢";
  const aboutLine = buildStateAboutLine(state, level);
  const decisionLine = buildStateDecisionLine(state, level);
  const newBlock = [
    "🤝 今の状態について",
    ...buildStateFactsBullets(state, { forSummary: true }),
    "",
    ...(aboutLine ? [aboutLine] : []),
    ...(decisionLine ? [decisionLine] : []),
  ];
  return [...lines.slice(0, start), ...newBlock, ...lines.slice(sliceEnd)].join("\n");
}

async function buildLocalSummaryFallback(level, history, state) {
  const historyText = history
    .filter((msg) => msg.role === "user")
    .map((msg) => msg.content)
    .join("\n");
  const locationContext = state?.locationContext || {};
  const category = detectSymptomCategory(historyText);
  const factsFromSlots = buildFactsFromSlotAnswers(state);
  const facts = factsFromSlots.length
    ? factsFromSlots
    : history
        .filter((msg) => msg.role === "user")
        .slice(-3)
        .map((msg) => msg.content)
        .filter((msg) => !/^(ない|なし|特になし|特にない)$/.test((msg || "").trim()))
        .map((msg) => `・${msg}`) || [];
  const empathy =
    historyText.includes("不安") || historyText.includes("心配")
      ? "不安になる状況ですよね。"
      : "つらい状態ですよね。";

  const sensoryByCategory = {
    stomach: "今の話を聞く限りだと、「張りや重さでしんどい感じ」に近そうですね。",
    head: "今の話を聞く限りだと、「重さや締め付けでつらい感じ」に近そうですね。",
    throat: "今の話を聞く限りだと、「乾きや刺激でヒリヒリする感じ」に近そうですね。",
    other: "今の話を聞く限りだと、「体がだるくてつらい感じ」に近そうですね。",
  };

  const immediateBlock = await buildImmediateActionsBlock(level, state, historyText, null);

  if (level === "🔴") {
    state.decisionLevel = "🔴";
    const hospitalRec = buildHospitalRecommendationDetail(
      state,
      locationContext,
      state?.clinicCandidates || [],
      state?.hospitalCandidates || []
    );
    const hospitalBlock = buildHospitalBlock(state, historyText, hospitalRec);
    const memoWithJudgment = [
      "📝 今の状態について",
      buildStateFactsBullets(state, { forSummary: true }).join("\n"),
      "",
      await buildStateAboutEmpathyAndJudgmentAsync(state, "🔴"),
    ].join("\n");
    const redActionsBlock = buildRedImmediateActionsBlock(state, historyText);
    const redClosing = await generateLastBlockWithLLM("🔴", state, historyText);
    return sanitizeSummaryBullets(
      [
        memoWithJudgment,
        redActionsBlock,
        "🏥 受診先の候補",
        hospitalBlock.replace(/^🏥 受診先の候補\n/, ""),
        redClosing,
      ].join("\n"),
      state
    );
  }

  const baseBlocks = [
    `${level} ここまでの情報を整理します\n${buildSummaryIntroTemplate()}`,
    `🤝 今の状態について\n${buildStateFactsBullets(state, { forSummary: true }).join("\n")}\n\n${buildStateAboutLine(state, level)}\n${buildStateDecisionLine(state, level)}`,
    immediateBlock,
    `⏳ 今後の見通し\nこのタイプの症状は、時間の経過で変化することがあります。\n・もし明日の朝も同じ痛みが続いていたら\n・もし痛みが7以上に強くなったら\nそのタイミングで、もう一度Kairoに聞いてください。`,
  ];
  const closing = await generateLastBlockWithLLM(level, state, historyText);

  if (level === "🟡") {
    let fallbackText = [
      baseBlocks[0],
      baseBlocks[1],
      baseBlocks[2],
      baseBlocks[3],
      closing,
    ].join("\n");
    fallbackText = ensurePainInfectionYellowFirstAction(fallbackText, level, state);
    return sanitizeSummaryBullets(fallbackText, state);
  }

  return sanitizeSummaryBullets(
    [...baseBlocks, closing].join("\n"),
    state
  );
}

function normalizeAnswerText(text) {
  return text.replace(/\s+/g, "").trim();
}

function userAskedSummary(message) {
  return /まとめ|要約|サマリー/.test(message || "");
}

function hasFinalQuestionPrefix(text) {
  const firstLine = (text || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) || "";
  return firstLine.startsWith("最後に") || firstLine.startsWith("最後の質問");
}

function matchAnswerToOption(answer, options) {
  const normalizedAnswer = normalizeAnswerText(answer);
  if (!normalizedAnswer) {
    return null;
  }

  if (options.some((opt) => (opt || "").includes("思い当たる"))) {
    if (normalizedAnswer.match(/思い当たる|当たる|ある/)) {
      const index = options.findIndex((opt) => (opt || "").includes("思い当たる"));
      if (index >= 0) return index;
    }
  }

  if (normalizedAnswer.match(/^(ない|なし|特になし|特にない|いない)$/)) {
    const negativeIndex = options.findIndex((opt) =>
      normalizeAnswerText(opt).match(/(ない|なし|思い当たらない|特になし|特にない)$/)
    );
    if (negativeIndex !== -1) {
      return negativeIndex;
    }
  }

  const indexByNumber = (() => {
    if (/[1１]/.test(normalizedAnswer) || normalizedAnswer.includes("一番上") || normalizedAnswer.includes("上")) return 0;
    if (/[2２]/.test(normalizedAnswer) || normalizedAnswer.includes("真ん中") || normalizedAnswer.includes("中")) return 1;
    if (/[3３]/.test(normalizedAnswer) || normalizedAnswer.includes("一番下") || normalizedAnswer.includes("下")) return 2;
    return null;
  })();

  if (indexByNumber !== null) {
    return indexByNumber;
  }

  for (let i = 0; i < options.length; i += 1) {
    const normalizedOption = normalizeAnswerText(options[i]);
    if (normalizedOption && normalizedAnswer.includes(normalizedOption)) {
      return i;
    }
  }

  for (let i = 0; i < options.length; i += 1) {
    const normalizedOption = normalizeAnswerText(options[i]);
    if (normalizedOption && normalizedOption.includes(normalizedAnswer)) {
      return i;
    }
  }

  const bigramScore = (a, b) => {
    if (!a || !b) return 0;
    const bigrams = (str) => {
      const arr = [];
      for (let i = 0; i < str.length - 1; i += 1) {
        arr.push(str.slice(i, i + 2));
      }
      return arr;
    };
    const aBigrams = bigrams(a);
    const bBigrams = bigrams(b);
    if (aBigrams.length === 0 || bBigrams.length === 0) return 0;
    const bSet = new Set(bBigrams);
    let hit = 0;
    for (const bg of aBigrams) {
      if (bSet.has(bg)) hit += 1;
    }
    return hit / Math.max(aBigrams.length, bBigrams.length);
  };

  let bestIndex = null;
  let bestScore = 0;
  for (let i = 0; i < options.length; i += 1) {
    const normalizedOption = normalizeAnswerText(options[i]);
    const score = bigramScore(normalizedAnswer, normalizedOption);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestIndex !== null && bestScore >= 0.2) {
    return bestIndex;
  }

  if (normalizedAnswer.match(/動けない|無理|強い|ひどい|悪化|辛い|つらい/)) {
    return 2;
  }
  if (normalizedAnswer.match(/少し|やや|中|真ん中|そこそこ/)) {
    return 1;
  }
  if (normalizedAnswer.match(/普通|軽い|問題ない|大丈夫|上/)) {
    return 0;
  }

  return null;
}

function mapFreeTextToOptionIndex(answer, options, type) {
  if (!answer || !Array.isArray(options) || options.length === 0) return null;
  const text = (answer || "").trim();
  if (!text) return null;
  const normalizedText = normalizeAnswerText(text);

  const indexOf = (needle) =>
    options.findIndex((opt) => normalizeAnswerText(opt).includes(normalizeAnswerText(needle)));

  // カテゴリ差し替え3択（slot4/5/6）の意味マッピング
  if (options.length === 3) {
    // SKIN: 見た目
    if (indexOf("水ぶくれ・ただれ・できもの") >= 0) {
      if (/水ぶくれ|ただれ|できもの/.test(text)) return 2;
      if (/変わらない|ほとんど変わらない/.test(text)) return 0;
      if (/赤み|乾燥/.test(text)) return 1;
    }
    // SKIN: きっかけ
    if (indexOf("紫外線や乾燥が強かった") >= 0) {
      if (/思い当たらない|特にない|わからない|不明/.test(text)) return 0;
      if (/紫外線|乾燥|日差し/.test(text)) return 1;
      if (/新しい|製品|刺激物|化粧|洗剤|石けん|石鹸/.test(text)) return 2;
    }
    // SKIN: 状況
    if (indexOf("触ると激痛が走る") >= 0) {
      if (/激痛|触ると激痛/.test(text)) return 2;
      if (/触ると痛|押すと痛/.test(text)) return 1;
      if (/触っても痛くない|痛くない/.test(text)) return 0;
    }
    // INFECTION: 体温
    if (indexOf("38度以上") >= 0) {
      if (/(38|39|40)(\.|,)?\d*|高熱/.test(text)) return 2;
      if (/37/.test(text)) return 1;
      if (/平熱|36/.test(text)) return 0;
    }
    // INFECTION: 主症状
    if (indexOf("咳が強い／胸が苦しい") >= 0) {
      if (/咳.*強|胸が苦しい|息苦/.test(text)) return 2;
      if (/だるい|倦怠|全身/.test(text)) return 1;
      if (/喉|のど|鼻水|鼻づまり/.test(text)) return 0;
    }
    // INFECTION: きっかけ
    if (indexOf("周りが咳をしていた") >= 0) {
      if (/思い当たらない|特にない|不明|わからない/.test(text)) return 0;
      if (/ストレス|疲労|寝不足|過労/.test(text)) return 1;
      if (/周り|咳をしていた|感染/.test(text)) return 2;
    }
    // GI: 部位
    if (indexOf("みぞおち付近") >= 0) {
      if (/みぞおち|上腹部/.test(text)) return 2;
      if (/全体|お腹全体|全体的/.test(text)) return 1;
      if (/わからない|不明/.test(text)) return 0;
    }
    // GI: 便・吐き気
    if (indexOf("吐き気・嘔吐がある") >= 0) {
      if (/吐き気|嘔吐/.test(text)) return 2;
      if (/下痢|軟便/.test(text)) return 1;
      if (/変化ない|特にない|なし/.test(text)) return 0;
    }
    // GI: きっかけ
    if (indexOf("食あたり") >= 0) {
      if (/食あたり|当たっ|生もの|傷ん|食後/.test(text)) return 2;
      if (/便秘|出ない|硬い便/.test(text)) return 1;
      if (/冷え|冷たい|体が冷え|冷房/.test(text)) return 0;
    }
    // worsening_trend（3.5・全カテゴリ共通）
    if (indexOf("発症時より悪化している") >= 0) {
      if (/発症時より悪化|悪化している|ひどくなって|悪化してきた/.test(text)) return 2;
      if (/変わらない|横ばい|同じ|変化なし/.test(text)) return 1;
      if (/回復に向か|良くなって|ましになって|楽になって|改善して/.test(text)) return 0;
    }
  }

  const severe = /強い|激しい|ひどい|高熱|息苦|意識|吐き|ぐったり|動けない|我慢でき|失神/;
  const mild = /少し|軽い|ちょっと|わずか|違和感|気になる/;
  const none = /ない|特にない|なし|思い当たらない/;
  const unknown = /分からない|わからない|不明|はっきりしない|曖昧/;
  const causeHints = /周り|人混み|冷房|咳|風邪|感染|寝不足|ストレス|運動|飲酒|食べ|仕事|花粉/;

  if (type === "cause_category") {
    if (causeHints.test(text)) return 1;
    if (unknown.test(text)) return Math.min(2, options.length - 1);
    if (none.test(text)) return 0;
    return options.length >= 3 ? 1 : 0;
  }

  if (type === "associated_symptoms") {
    if (indexOf("これ以外は特にない") >= 0 && indexOf("咳や鼻詰まりがある") >= 0) {
      if (none.test(text)) return 0;
      if (indexOf("吐き気がある") >= 0 && /吐き気|嘔吐|むかむか/.test(text)) return 1;
      if (textImpliesFeverForInfectionTriage(text)) return 0;
      if (/鼻|詰まり|咳|せき/.test(text)) return 2;
      if (severe.test(text)) return Math.min(2, options.length - 1);
      return options.length >= 3 ? 1 : 0;
    }
    if (indexOf("咳や鼻詰まりがある") >= 0 && indexOf("発熱がある") >= 0) {
      if (none.test(text)) return 0;
      if (indexOf("吐き気がある") >= 0 && /吐き気|嘔吐|むかむか/.test(text)) return 1;
      if (textImpliesFeverForInfectionTriage(text)) return 2;
      if (/鼻|詰まり|咳|せき/.test(text)) return 0;
      if (severe.test(text)) return Math.min(2, options.length - 1);
      return options.length >= 3 ? 1 : 0;
    }
    if (none.test(text)) return 0;
    if (indexOf("吐き気がある") >= 0 && /吐き気|嘔吐|むかむか/.test(text)) return 1;
    if ((indexOf("咳や発熱がある") >= 0 || indexOf("咳がある") >= 0 || indexOf("だるさや発熱がある") >= 0 || indexOf("だるさがある") >= 0) &&
        /だるさ|発熱|熱|頭が熱い|頭があつい|ねつ|熱っぽい/.test(text)) return 2;
    if (severe.test(text)) return Math.min(2, options.length - 1);
    return options.length >= 3 ? 1 : 0;
  }

  if (type === "daily_impact") {
    if (/動けない|寝込|起き上がれ/.test(text)) return Math.min(2, options.length - 1);
    if (mild.test(text)) return options.length >= 3 ? 1 : 0;
    return 0;
  }

  if (type === "worsening") {
    if (/悪化|ひどく|強く|増え/.test(text)) return Math.min(2, options.length - 1);
    if (/変わらない|同じ|横ばい/.test(text)) return options.length >= 3 ? 1 : 0;
    if (/良く|和らぎ|軽く/.test(text)) return 0;
    return options.length >= 3 ? 1 : 0;
  }

  if (type === "worsening_trend") {
    if (/発症時より悪化|悪化している|ひどくなって|悪化してきた/.test(text)) return 2;
    if (/変わらない|横ばい|同じ|変化なし|悪くも良くも/.test(text)) return 1;
    if (/回復に向か|良くなって|ましになって|楽になって|改善して/.test(text)) return 0;
    return 1;
  }

  if (options.length === 2) {
    return severe.test(text) ? 1 : 0;
  }
  if (options.length === 3) {
    if (none.test(text)) return 0;
    if (severe.test(text)) return 2;
    if (mild.test(text)) return 1;
    return 1;
  }
  return null;
}

function hasConcreteCauseDetail(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  // 「ある」「思い当たる」だけの短い返答は具体自由記述とみなさない
  if (/^(ある|あり|思い当たる|思い当たるかも|はい|うん|yes)$/i.test(normalized)) {
    return false;
  }
  // きっかけの具体が含まれる場合は、追加質問なしで原因詳細取得済みとみなす
  return /周り|人混み|冷房|咳|風邪|感染|寝不足|ストレス|運動|飲酒|食べ|食事|仕事|花粉|寝冷え|ブルーライト|目の使いすぎ/.test(
    normalized
  );
}

function classifyAnswerToOption(answer, options, type) {
  const exact = matchAnswerToOption(answer, options);
  if (exact !== null) return { index: exact, usedFreeText: false };
  const mapped = mapFreeTextToOptionIndex(answer, options, type);
  if (mapped !== null) return { index: mapped, usedFreeText: true };
  return { index: null, usedFreeText: false };
}

function computeUrgencyLevel(questionCount, totalScore, debugMeta = {}) {
  if (debugMeta?.state) {
    return calculateRiskFromState(debugMeta.state);
  }
  return calculateRisk(questionCount, totalScore, debugMeta);
}

function calculateRisk(questionCount, totalScore, debugMeta = {}) {
  const painScore = debugMeta?.painScore ?? null;
  const painWeight = debugMeta?.painWeight ?? null;
  const maxScore = questionCount * 2;
  const rawRatio = maxScore > 0 ? totalScore / maxScore : 0;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  let urgency = "green";
  if (ratio >= 0.8) {
    urgency = "red";
  } else if (ratio >= 0.69) {
    urgency = "yellow";
  } else {
    urgency = "green";
  }
  const level = urgency === "red" ? "🔴" : urgency === "yellow" ? "🟡" : "🟢";
  console.log("---- KAIRO URGENCY DEBUG ----");
  console.log("painScore (raw):", painScore);
  console.log("painWeight:", painWeight);
  console.log("totalScore:", totalScore);
  console.log("questionCount:", questionCount);
  console.log("maxPossibleScore:", questionCount * 2);
  console.log("ratio:", ratio);
  console.log("finalUrgency:", urgency);
  console.log("------------------------------");
  console.assert(ratio >= 0 && ratio <= 1, "ratio out of range", ratio);
  return { ratio, level, urgency };
}

function mapRiskLevelToSeverityScore(riskLevel) {
  if (riskLevel === RISK_LEVELS.HIGH) return 3;
  if (riskLevel === RISK_LEVELS.MEDIUM) return 1;
  return 0;
}

function getPainSeverityScore(state) {
  const pain = Number.isFinite(state?.lastPainScore) ? state.lastPainScore : null;
  if (pain !== null && state?.slotFilled?.pain_score === true) {
    if (pain >= 7) return 3;
    if (pain >= 5) return 1;
    return 0;
  }
  return mapRiskLevelToSeverityScore(state?.slotNormalized?.pain_score?.riskLevel);
}

/**
 * RED抑制：経過が「さっき」「数時間前」相当のときは 🔴 を禁止（PAIN / INFECTION）。
 * INFECTION かつ痛みスコアが 8 以上のときだけガード解除（KAIRO_SPEC RED抑制ガード）。
 */
function shouldBlockRedByRecentShortDuration(state) {
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state);
  if (category !== "PAIN" && category !== "INFECTION") return false;
  if (category === "INFECTION") {
    if (
      state?.slotFilled?.pain_score === true &&
      Number.isFinite(state?.lastPainScore) &&
      state.lastPainScore >= 8
    ) {
      return false;
    }
  }
  const durationRaw = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  const selectedIndex = state?.durationMeta?.selectedIndex;
  if (selectedIndex === 0 || selectedIndex === 1) return true;
  return /(さっき|今さっき|数時間前|数時間|数分|数十分|今朝)/.test(durationRaw);
}

/**
 * RED抑制ガード時の①組み合わせ行：経過を書くとき「一時的な可能性」を含む短いラベル（KAIRO_SPEC 特例）。
 * 呼び出し元は shouldBlockRedByRecentShortDuration(state) === true のときのみ。
 */
function buildDurationTemporaryPossibilityLabelForRedGuard(state) {
  if (!state) return "";
  const dur = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  const selectedIndex = state?.durationMeta?.selectedIndex;
  if (selectedIndex === 0) return "さっきから（一時的な可能性）";
  if (selectedIndex === 1) return "数時間前から（一時的な可能性）";
  if (/(さっき|今さっき|たった今|数分|数十分)/.test(dur)) return "さっきから（一時的な可能性）";
  if (/(数時間前|数時間)/.test(dur)) return "数時間前から（一時的な可能性）";
  if (/(今朝)/.test(dur)) return "今朝から（一時的な可能性）";
  return "短い経過（一時的な可能性）";
}

/**
 * RED抑制ガード特例時：特例ラベル（一時的な可能性）以外に「経過・発症」を重ねない（KAIRO_SPEC 651〜654）。
 * 例:「さっきから（一時的な可能性）」と「症状はさっきから始まっている」を並べない。
 */
function shouldExcludeComboCandidateDueToRedGuardOnsetOverlap(label, state) {
  if (!shouldBlockRedByRecentShortDuration(state)) return false;
  const s = String(label || "").trim();
  if (!s) return false;
  if (/一時的な可能性/.test(s)) return false;
  if (/^症状は/.test(s)) return true;
  if (/^経過の様子は/.test(s)) return false;
  if (/^発症から時間が短い$|^症状が続いている$/.test(s)) return true;
  if (/(?:^|[\s「])(さっき|今さっき|数時間前|数十分|今朝|たった今|短い経過)/.test(s)) return true;
  return false;
}

function filterComboCandidatesForRedGuardOnset(candidates, state) {
  if (!Array.isArray(candidates)) return [];
  if (!shouldBlockRedByRecentShortDuration(state)) return candidates;
  return candidates.filter((c) => !shouldExcludeComboCandidateDueToRedGuardOnsetOverlap(c.label, state));
}

function calculateRiskFromState(state) {
  const worseningTrendVal = getSlotStatusValue(state, "worsening_trend", state?.slotAnswers?.worsening_trend || "");
  const worseningTrendIndex = state?.slotNormalized?.worsening_trend?.riskLevel === RISK_LEVELS.HIGH
    ? 2
    : /発症時より悪化|悪化している/.test(worseningTrendVal)
      ? 2
      : null;
  if (worseningTrendIndex === 2) {
    const painScoreRaw =
      state?.slotFilled?.pain_score === true && Number.isFinite(state?.lastPainScore)
        ? state.lastPainScore
        : Number(String(state?.slotAnswers?.pain_score || "").match(/\d+/)?.[0]) || 0;
    if (painScoreRaw >= 5) {
      const blockRedByRecentShortDuration = shouldBlockRedByRecentShortDuration(state);
      if (blockRedByRecentShortDuration) {
        return { ratio: 0.64, level: "🟡", urgency: "yellow" };
      }
      console.log("---- KAIRO URGENCY DEBUG (worsening_trend=発症時より悪化 かつ pain>=5 → RED) ----");
      return { ratio: 1, level: "🔴", urgency: "red" };
    }
    // 喉主症状 INFECTION：経過の「悪化」で痛みが強くないときは 🔴 にせず最低🟡（KAIRO_SPEC）
    if (isThroatInfectionSession(state)) {
      return { ratio: 0.52, level: "🟡", urgency: "yellow" };
    }
  }

  const scores = {
    pain: getPainSeverityScore(state),
    quality: mapRiskLevelToSeverityScore(state?.slotNormalized?.worsening?.riskLevel),
    onset: mapRiskLevelToSeverityScore(state?.slotNormalized?.duration?.riskLevel),
    impact: mapRiskLevelToSeverityScore(state?.slotNormalized?.daily_impact?.riskLevel),
    symptoms: mapRiskLevelToSeverityScore(state?.slotNormalized?.associated_symptoms?.riskLevel),
    cause: mapRiskLevelToSeverityScore(state?.slotNormalized?.cause_category?.riskLevel),
  };

  const slotScoreList = [
    scores.pain,
    scores.quality,
    scores.onset,
    scores.impact,
    scores.symptoms,
    scores.cause,
  ];
  const highSlotCount = slotScoreList.filter((v) => v === 3).length;
  const blockRedByRecentShortDuration = shouldBlockRedByRecentShortDuration(state);

  // Phase1: 判断6スロットのうち「高」が2つ以上 → 比率計算なしで即時🔴
  if (highSlotCount >= 2) {
    if (blockRedByRecentShortDuration) {
      return { ratio: 0.64, level: "🟡", urgency: "yellow" };
    }
    console.log("---- KAIRO URGENCY DEBUG (Phase1: 高2つ以上 → RED) ----");
    console.log("scores:", scores);
    console.log("highSlotCount:", highSlotCount);
    console.log("finalUrgency:", "red");
    console.log("-------------------------------------------");
    return { ratio: 1, level: "🔴", urgency: "red" };
  }

  const weightedTotal =
    scores.pain * 1.4 +
    scores.impact * 1.0 +
    scores.symptoms * 1.0 +
    scores.onset * 1.0 +
    scores.quality * 1.0 +
    scores.cause * 0.8;
  const maxWeighted = 18.6;
  const rawIndex = weightedTotal / maxWeighted;
  const severityIndex = Math.max(0, Math.min(1, rawIndex));

  let urgency = "green";
  if (severityIndex >= 0.65) {
    urgency = "red";
  } else if (severityIndex >= 0.4) {
    urgency = "yellow";
  }
  if (urgency === "red" && blockRedByRecentShortDuration) {
    urgency = "yellow";
  }
  let level = urgency === "red" ? "🔴" : urgency === "yellow" ? "🟡" : "🟢";

  // 「高」がちょうど1つ: 指数で🟢になっても最低🟡（🟡以上に固定）
  if (highSlotCount === 1 && level === "🟢") {
    level = "🟡";
    urgency = "yellow";
  }

  console.log("---- KAIRO URGENCY DEBUG (Phase2 Index) ----");
  console.log("scores:", scores);
  console.log("highSlotCount:", highSlotCount);
  console.log("weightedTotal:", weightedTotal);
  console.log("maxWeighted:", maxWeighted);
  console.log("severityIndex:", severityIndex);
  console.log("finalUrgency:", urgency);
  console.log("finalLevel:", level);
  console.log("--------------------------------------------");
  console.assert(severityIndex >= 0 && severityIndex <= 1, "severityIndex out of range", severityIndex);
  return { ratio: severityIndex, level, urgency };
}

function judgeDecision(state) {
  console.log("[DEBUG] judge function entered");
  const { ratio, level } = calculateRiskFromState(state);
  const confidence = state.confidence;
  const slotsFilledCount = countFilledSlots(state.slotFilled, state);
  const askedSlotsCount = countAskedSlots(state.askedSlots);
  const requiredCount = getRequiredSlotCount(state);
  const decisionCompleted = slotsFilledCount >= requiredCount;
  const shouldJudge = decisionCompleted;

  console.log(
    "[DEBUG] shouldJudge=",
    shouldJudge,
    "questionCount=",
    state.questionCount,
    "slotsFilled=",
    slotsFilledCount,
    "askedSlots=",
    askedSlotsCount,
    "noNewInformationTurns=",
    state.noNewInformationTurns || 0,
    "missingSlots=",
    getMissingSlots(state.slotFilled, state).join(",")
  );

  return { ratio, level, confidence, shouldJudge, slotsFilledCount };
}

function buildTriageState(isFinal, judgement, slotsFilledCount) {
  const levelMap = { "🔴": "red", "🟡": "yellow", "🟢": "green" };
  return {
    triage_level: isFinal && judgement ? (levelMap[judgement] || null) : null,
    is_final: Boolean(isFinal),
    required_fields_filled: Number(slotsFilledCount) || 0,
  };
}

function shouldAvoidSummary(text, shouldJudge) {
  if (shouldJudge) {
    return false;
  }
  const adviceIndicators = [
    "おすすめ",
    "意識してください",
    "今すぐ",
    "様子見",
    "市販薬",
    "病院",
    "受診",
  ];
  const hasAdvice = adviceIndicators.some((indicator) => text.includes(indicator));
  return (
    hasAnySummaryBlocks(text) ||
    hasAdvice ||
    !isQuestionResponse(text) ||
    containsQuestionPhaseForbidden(text)
  );
}

// Root route - serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function getOrInitConversationState(conversationId) {
  if (!conversationState[conversationId]) {
    conversationState[conversationId] = initConversationState({ conversationId });
  }
  return conversationState[conversationId];
}

/** 確認文表示時にバックグラウンドでまとめを生成。conversationId のみで呼び、conversationState/History を参照する。失敗時は必ず buildLocalSummaryFallback でまとめを返す。 */
async function generateSummaryForConfirmation(conversationId) {
  const state = conversationState[conversationId];
  const history = conversationHistory[conversationId];
  if (!state || !history) return { message: "", followUpQuestion: null, followUpMessage: null };
  // まとめ後・フォロー中は再生成禁止（呼び出しバグ時も空で返さず既存テキストを返す）
  if (
    state.summaryShown ||
    state.summaryGenerated === true ||
    state.hasSummaryBlockGenerated ||
    state.phase === "FOLLOW_UP"
  ) {
    console.error("🚨 BLOCKED: generateSummaryForConfirmation — post-summary or FOLLOW_UP");
    return {
      message: state.summaryText || "",
      followUpQuestion: null,
      followUpMessage: null,
    };
  }
  const epochAtStart = state.summaryGenerationEpoch;
  ensureUserUtterancesCapturedBeforeConfirmation(conversationId, state);
  const hadSkip = !!state.skipSupplementBeforeSummary;
  if (state.skipSupplementBeforeSummary) {
    state.skipSupplementBeforeSummary = false;
  }
  const hasBulletsAfterEnsure =
    Array.isArray(state.stateAboutBulletsCache) && state.stateAboutBulletsCache.length > 0;
  const needSupplement = !hasBulletsAfterEnsure || !hadSkip;
  await Promise.all([
    needSupplement ? supplementStateBulletsFromUncoveredUserUtterances(state) : Promise.resolve(),
    resolveLocationContext(state, state.clientMeta),
  ]);
  if (state.summaryGenerationEpoch !== epochAtStart) {
    return { message: state.summaryText || "", followUpQuestion: null, followUpMessage: null };
  }
  const level = finalizeRiskLevel(state);
  try {
  const historyTextForCare = history.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const careDestination = detectCareDestinationFromHistory(historyTextForCare);
  state.careDestination = careDestination;
  state.historyTextForCare = historyTextForCare;
  const historyTextForOtc = historyTextForCare;
  const otcCategory = (() => {
    if (historyTextForOtc.match(/腹|お腹|胃|下痢|便秘/)) return "bowel";
    if (historyTextForOtc.match(/喉|のど/)) return "throat";
    if (historyTextForOtc.match(/鼻水|鼻づまり|くしゃみ/)) return "nose";
    if (historyTextForOtc.match(/咳|せき/)) return "cough";
    if (historyTextForOtc.match(/だるい|脱水|水分/)) return "fatigue";
    if (historyTextForOtc.match(/かゆみ|アレルギー|花粉/)) return "allergy";
    if (historyTextForOtc.match(/頭痛|頭が痛|頭が重|発熱|熱/)) return "pain_fever";
    return "pain_fever";
  })();
  const otcWarningIndex = Math.floor(Math.random() * 5);
  const locationContext = state.locationContext || {};
  if (level === "🔴") {
    [state.clinicCandidates, state.hospitalCandidates, state.pharmacyCandidates] = await Promise.all([
      resolveCareCandidates(state, careDestination),
      resolveHospitalCandidates(state),
      resolvePharmacyCandidates(state),
    ]);
  } else {
    // 🟢/🟡: 薬局検索を非同期で行い、まとめ表示を待たせない
    state.pharmacyCandidates = [];
    state.pharmacyRecommendation = buildPharmacyRecommendation(state, locationContext, []);
    void resolvePharmacyCandidates(state).then((candidates) => {
      state.pharmacyCandidates = candidates;
      state.pharmacyRecommendation = buildPharmacyRecommendation(state, locationContext, candidates);
    });
  }
  const pharmacyRec = level === "🔴"
    ? buildPharmacyRecommendation(state, locationContext, state.pharmacyCandidates)
    : state.pharmacyRecommendation;
  if (level === "🔴") state.pharmacyRecommendation = pharmacyRec;
  const otcExamples = buildOtcExamples(otcCategory, locationContext.country);
  state.otcExamples = otcExamples;
  const hospitalRec = buildHospitalRecommendationDetail(state, locationContext, state.clinicCandidates, state.hospitalCandidates);
  state.hospitalRecommendation = hospitalRec;
  const hospitalListSource = (state.hospitalCandidates || []).length > 0 ? state.hospitalCandidates : state.clinicCandidates || [];
  const clinicList = hospitalListSource.map((item) => `・${item.name}`).join("\n");
  const clinicHint = clinicList ? `\n以下の候補から具体名を1つ選んで提示してください。\n${clinicList}\n` : "\n具体名がない場合は、近いGP/クリニックの具体名を提示してください。\n";
  const pharmacyHint = pharmacyRec?.name
    ? `\n薬局名は「${pharmacyRec.name}」を優先してください。\n薬名は例示で2〜3件、一般名＋商品名で示し、末尾に「最終判断は薬剤師に相談してください。これは一般的に現地で使われる選択肢です。」を入れてください。\n`
    : "\n薬局名は国・都市レベルで具体名を1件提示し、薬名は例示で2〜3件、一般名＋商品名で示してください。\n末尾に「最終判断は薬剤師に相談してください。これは一般的に現地で使われる選択肢です。」を入れてください。\n";
  const summaryContextMessages = buildStructuredConversationForLlm(history, state);
  const summaryOnlyMessages = [
    { role: "system", content: buildRepairPrompt(level, state) },
    { role: "system", content: clinicHint },
    { role: "system", content: pharmacyHint },
    ...summaryContextMessages,
  ];
  let aiResponse = "";
  for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
    try {
      aiResponse = (await openai.chat.completions.create({ model: "gpt-4o-mini", messages: summaryOnlyMessages, temperature: 0.5 + attempt * 0.05, max_tokens: 1000 })).choices?.[0]?.message?.content ?? "";
      if (aiResponse && hasAllSummaryBlocks(aiResponse)) break;
      if (attempt < LLM_RETRY_COUNT - 1) {
        const strict = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: buildRepairPrompt(level, state) + "\n\n不足ブロックがある場合は必ず補完して、全ブロックを完成させてください。" }, ...summaryContextMessages],
          temperature: 0.5 + (attempt + 1) * 0.05,
          max_tokens: 1000,
        });
        aiResponse = strict.choices?.[0]?.message?.content ?? aiResponse ?? "";
        if (aiResponse && hasAllSummaryBlocks(aiResponse)) break;
      }
    } catch (_) {
      /* retry */
    }
  }
  if (level !== "🔴" && isHospitalFlow(aiResponse)) {
    const repair = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: buildRepairPrompt(level, state) }, ...summaryContextMessages],
      temperature: 0.7,
      max_tokens: 1000,
    });
    aiResponse = repair.choices?.[0]?.message?.content ?? aiResponse ?? "";
  }
  aiResponse = normalizeSummaryLevel(aiResponse, level);
  aiResponse = ensureYellowOtcBlock(aiResponse, level, otcCategory, otcWarningIndex, state.pharmacyRecommendation, state.otcExamples, state.pharmacyRecommendation?.preface);
  aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
  let immediateActionPlan = null;
  if (level === "🟢" || level === "🟡") {
    try {
      immediateActionPlan = await buildImmediateActionHypothesisPlan(state, historyTextForOtc, aiResponse);
    } catch (e) {
      immediateActionPlan = await buildImmediateActionFallbackPlanFromState(state);
    }
    aiResponse = normalizeStateBlockForGreenYellow(aiResponse, state);
    aiResponse = await ensureImmediateActionsBlock(aiResponse, level, state, historyTextForOtc, immediateActionPlan);
  }
  if (level === "🔴") {
    state.decisionLevel = "🔴";
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        immediateActionPlan = await buildImmediateActionHypothesisPlan(state, historyTextForOtc, aiResponse);
        if (immediateActionPlan) break;
      } catch (_) {
        if (attempt >= 9) immediateActionPlan = null;
      }
    }
  }
  aiResponse = ensureOutlookBlock(aiResponse, state);
  aiResponse = await ensureLastBlock(aiResponse, level, state, historyTextForOtc || aiResponse);
  aiResponse = enforceYellowOtcPositionStrict(aiResponse, level);
  if (level === "🔴") {
    aiResponse = await ensureHospitalMemoBlock(aiResponse, state, historyTextForOtc);
    aiResponse = await ensureRedImmediateActionsBlock(aiResponse, state, historyTextForOtc, immediateActionPlan);
    aiResponse = ensureHospitalBlock(aiResponse, state, historyTextForOtc);
  }
  if (level === "🔴" && state.hospitalRecommendation?.name && (!aiResponse.includes(state.hospitalRecommendation.name) || !aiResponse.includes("タイプ：") || !aiResponse.includes("理由："))) {
    aiResponse = await buildLocalSummaryFallback(level, history, state);
  }
  if (!validateSummaryAgainstNormalized(aiResponse, state)) {
    aiResponse = await buildLocalSummaryFallback(level, history, state);
  }
  aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
  if (!hasAllSummaryBlocks(aiResponse)) {
    aiResponse = await buildLocalSummaryFallback(level, history, state);
  }
  aiResponse = ensureRestMcDecisionBlock(aiResponse, level, state);
  aiResponse = sanitizeGeneralPhrases(aiResponse);
  aiResponse = stripStateAboutIntroOutro(aiResponse);
  aiResponse = sanitizeSummaryQuestions(aiResponse);
  aiResponse = stripForbiddenFollowUpMessage(aiResponse);
  aiResponse = simplifyPossibilityPhrases(aiResponse);
  aiResponse = correctKanjiAndTypos(aiResponse);
  aiResponse = enforceSummaryIntroTemplate(aiResponse);
  aiResponse = await enforceSummaryStructureStrict(aiResponse, level, history, state);
  aiResponse = stripInfectionOnlineClinicGuidance(aiResponse, state);
  aiResponse = stripHospitalMapLinks(aiResponse);
  aiResponse = stripMcForRed(aiResponse, level);
  aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
  const decisionType = level === "🔴" ? "A_HOSPITAL" : "C_WATCHFUL_WAITING";
  // まとめ「返却済み」は確認応答で HTTP レスを返すときのみ立てる（markSummaryDeliveredAndFollowUpPhase）。
  // ここで立てると summaryShown が先に true になり、確認応答分岐（!summaryShown）に入らずまとめが出ない。
  state.decisionType = decisionType;
  state.decisionLevel = level === "🔴" ? "🔴" : level === "🟡" ? "🟡" : "🟢";
  if (!state.judgmentSnapshot) {
    state.judgmentSnapshot = buildJudgmentSnapshot(state, history, decisionType);
  }
  if (state.decisionRatio === null) {
    const computed = calculateRiskFromState(state);
    state.decisionRatio = computed.ratio;
  }
  state.finalQuestionPending = false;
  let followUpQuestion = null;
  if (decisionType === "A_HOSPITAL") {
    state.followUpPhase = "questioning";
    state.followUpStep = 1;
    state.followUpDestinationName = formatDestinationName(state.hospitalRecommendation?.name, decisionType);
    followUpQuestion = RED_FOLLOW_UP_QUESTION;
  } else {
    state.followUpPhase = "questioning";
    state.followUpStep = 1;
    followUpQuestion = getInitialFollowUpQuestionBySpec(state);
  }
  if (!aiResponse || !hasAllSummaryBlocks(aiResponse)) {
    aiResponse = await buildLocalSummaryFallback(level, history, state);
  }
  if (state.summaryGenerationEpoch !== epochAtStart) {
    return { message: state.summaryText || "", followUpQuestion: null, followUpMessage: null };
  }
  state.summaryText = aiResponse;
  return { message: aiResponse || "", followUpQuestion, followUpMessage: null };
  } catch (err) {
    console.error("[generateSummaryForConfirmation Error]", err?.message || err);
    if (state.summaryGenerationEpoch !== epochAtStart) {
      return { message: state.summaryText || "", followUpQuestion: null, followUpMessage: null };
    }
    for (let i = 0; i < LLM_RETRY_COUNT; i++) {
      try {
        const recovered = await buildLocalSummaryFallback(level, history, state);
        if (recovered && hasAllSummaryBlocks(recovered)) {
          if (state.summaryGenerationEpoch !== epochAtStart) {
            return { message: state.summaryText || "", followUpQuestion: null, followUpMessage: null };
          }
          return { message: recovered, followUpQuestion: null, followUpMessage: null };
        }
      } catch (retryErr) {
        if (i >= LLM_RETRY_COUNT - 1) {
          console.error("[generateSummaryForConfirmation Fallback Error]", retryErr?.message || retryErr);
        }
      }
    }
    const stateBullets = buildStateFactsBullets(state, { forSummary: true });
    const stateBlock = stateBullets.length > 0 ? stateBullets.join("\n") : "";
    const historyText = (history || []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const ctx = buildCurrentStateContext(state, historyText, state?.lastConcreteDetailsText || "");
    const [lastBlock, actionsBlock] = await Promise.all([
      (async () => {
        for (let i = 0; i < 5; i++) {
          try {
            return await generateLastBlockWithLLM(level, state, stateBlock);
          } catch (_) {
            /* retry */
          }
        }
        return "";
      })(),
      (async () => {
        try {
          const lastResort = await generateMinimalActionsLastResort(ctx);
          if (lastResort.length > 0) {
            return lastResort.map((a) => `・${a.title}\n→ ${a.reason}`).join("\n\n");
          }
          const supplemented = ensureActionCount([], 2, ctx, {});
          return supplemented.map((a) => `・${toConciseActionTitle(a.title)}\n→ ${ensureReliableReason(a.reason, {})}`).join("\n\n");
        } catch (e) {
          console.error("[generateSummaryForConfirmation minimal actions]", e?.message || e);
          return "・無理をせず、安静を優先してください\n→ 今の状態で負担を減らす行動は、回復を早める助けになります。";
        }
      })(),
    ]);
    if (state.summaryGenerationEpoch !== epochAtStart) {
      return { message: state.summaryText || "", followUpQuestion: null, followUpMessage: null };
    }
    const minimal = [
      `${level} ここまでの情報を整理します`,
      buildSummaryIntroTemplate(),
      "",
      "🤝 今の状態について",
      stateBlock || "症状の状態を確認しました。",
      "",
      "✅ 今すぐやること",
      actionsBlock,
      "",
      "⏳ 今後の見通し",
      "症状の変化には気をつけて、悪化したら再度ご相談ください。",
      "",
      lastBlock || `${level === "🔴" ? "💬" : "🌱"} 最後に\n今は体を休めることを優先してください。`,
    ].join("\n");
    return { message: minimal, followUpQuestion: null, followUpMessage: null };
  }
}

// Chat API endpoint
app.post("/api/chat", async (req, res) => {
  try {
  const { message, conversationId: rawConversationId, location, clientMeta, resetSession } = req.body;
  const conversationId =
    rawConversationId || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  let followUpQuestion = null;
  let followUpMessage = null;
  let locationRePromptBeforeSummary = null;

    if (!message) {
      return res.status(200).json({
        conversationId,
        message: "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
        response: "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。",
        judgeMeta: { judgement: null, confidence: 0, ratio: null, shouldJudge: false, slotsFilledCount: 0, decisionAllowed: false, questionCount: 0, summaryLine: null, questionType: null, rawScore: null, painScoreRatio: null },
        triage_state: buildTriageState(false, null, 0),
        questionPayload: null,
        normalizedAnswer: null,
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      const fallback = buildFixedQuestion("pain_score", false);
      const symptomLabel = toMainSymptomLabelForSafety(message || "");
      const stNoKey = getOrInitConversationState(conversationId);
      stNoKey.safetyIntroMainSymptomLabel = symptomLabel;
      const safetyTemplate = FIRST_QUESTION_SAFETY_TEMPLATES[Math.floor(Math.random() * FIRST_QUESTION_SAFETY_TEMPLATES.length)];
      const safetyLine = safetyTemplate(symptomLabel);
      const fullResponse = `${safetyLine}\n\n${fallback.question}`;
      return res.status(200).json({
        conversationId,
        message: fullResponse,
        response: fullResponse,
        judgeMeta: { judgement: null, confidence: 0, ratio: null, shouldJudge: false, slotsFilledCount: 0, decisionAllowed: false, questionCount: 0, summaryLine: null, questionType: null, rawScore: null, painScoreRatio: null },
        triage_state: buildTriageState(false, null, 0),
        questionPayload: { introTemplateIds: [], question: fallback.question, safetyLine },
        normalizedAnswer: null,
      });
    }

    // 履歴を先に確保してからユーザーターン数を数える（リセット判定より前）
    if (!conversationHistory[conversationId]) {
      conversationHistory[conversationId] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];
    }
    let userMessageCountBefore = (conversationHistory[conversationId] || []).filter((m) => m.role === "user").length;
    // 最重要: resetSession または「初回バナー表示セッションの最初の送信」ではサーバーを必ず空にする（古い conv ID のまとめ誤表示防止）
    const introBannerClient = clientMeta?.hasIntroBannerMessage === true;
    const forceIntroFresh = introBannerClient && userMessageCountBefore === 0;
    const forceFreshSession = resetSession === true || forceIntroFresh;
    if (forceFreshSession && conversationId) {
      delete conversationHistory[conversationId];
      delete conversationState[conversationId];
    }
    if (!conversationHistory[conversationId]) {
      conversationHistory[conversationId] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];
    }
    let state = getOrInitConversationState(conversationId);
    userMessageCountBefore = (conversationHistory[conversationId] || []).filter((m) => m.role === "user").length;
    // フォールバック: 初回メッセージなのに古い状態が残っている場合は強制リセット（まとめ誤表示バグ防止）
    const hasStaleState =
      state &&
      (state.summaryShown ||
        state.confirmationShown ||
        countFilledSlots(state.slotFilled, state) >= getRequiredSlotCount(state));
    if (userMessageCountBefore === 0 && hasStaleState) {
      delete conversationHistory[conversationId];
      delete conversationState[conversationId];
      conversationHistory[conversationId] = [{ role: "system", content: SYSTEM_PROMPT }];
      state = initConversationState({ conversationId });
      conversationState[conversationId] = state;
    }
    if (!state.triageCategory) {
      const detected = detectQuestionCategory4(message);
      // 喉が痛いなど、喉的なものが主症状の時は必ず初めからずっとINFECTION系にする
      state.triageCategory = isThroatMainSymptom(message)
        ? "INFECTION"
        : detected === "INFECTION"
          ? "PAIN"
          : detected;
    }
    console.log("[DEBUG] request init", {
      conversationId,
      hasConversationState: !!conversationState[conversationId],
      hasLocationSnapshot: !!state.locationSnapshot,
    });
    if (location) {
      const normalized = normalizeLocation(location);
      if (normalized) {
        state.locationSnapshot = normalized;
      }
    }
    if (clientMeta) {
      state.clientMeta = clientMeta;
      if (clientMeta.hasIntroBannerMessage === true) {
        state.hasIntroBannerSession = true;
      }
      if (clientMeta.locationPromptShown === true) {
        state.locationPromptShown = true;
      }
      if (clientMeta.locationSnapshot) {
        const normalized = normalizeLocation(clientMeta.locationSnapshot);
        if (normalized && !state.locationSnapshot) {
          state.locationSnapshot = normalized;
        }
      }
    }

    const locationPromptMessage = null;
    const locationRePromptMessage = null;

    // 🔥 【最優先】まとめ後のフォロー：state/history/clientMeta ベースで最早判定。以降の処理より先に実行。
    const historyForGuard = conversationHistory[conversationId] || [];
    reconcilePostSummaryStateIfNeeded(state, historyForGuard, clientMeta, forceFreshSession);
    if (mustUseFollowUpPhase(state, historyForGuard, clientMeta, userMessageCountBefore)) {
      console.log("🛑 FORCE FOLLOW MODE (earliest guard) - summary generation blocked");
      return handleFollowUpPhase(res, conversationId, message, state, locationPromptMessage, locationRePromptMessage);
    }

    ensureSlotFilledConsistency(conversationState[conversationId]);
    const filledBeforeTurn = countFilledSlots(conversationState[conversationId].slotFilled, conversationState[conversationId]);
    applySpontaneousSlotFill(conversationState[conversationId], message, { isFirstMessage: userMessageCountBefore === 0 });
    const isFirstUserMessage = userMessageCountBefore === 0;
    const triageCompleted = filledBeforeTurn >= getRequiredSlotCount(state) || !!state.decisionLevel;
    const summaryGenerated = !!(
      conversationState[conversationId].summaryShown ||
      conversationState[conversationId].summaryGenerated ||
      conversationState[conversationId].hasSummaryBlockGenerated
    );
    const history = conversationHistory[conversationId] || [];
    const lastAssistantMsg = [...history].reverse().find((m) => m.role === "assistant")?.content || "";
    const lastMsgLooksLikeConfirmation = /合っていますか|この整理で|よろしければ/.test(lastAssistantMsg);
    const isWaitingForConfirmationResponse =
      conversationState[conversationId].confirmationPending ||
      conversationState[conversationId].expectsCorrectionReason ||
      (conversationState[conversationId].confirmationShown && !conversationState[conversationId].summaryShown) ||
      (filledBeforeTurn >= getRequiredSlotCount(state) && !conversationState[conversationId].summaryShown && lastMsgLooksLikeConfirmation);

    const forceFollowMode = mustUseFollowUpPhase(state, history, clientMeta, userMessageCountBefore);
    console.log("[PHASE_GUARD]", {
      PHASE: state.phase,
      summaryShown: state.summaryShown,
      forceFollowMode,
      conversationStep: userMessageCountBefore,
    });
    // 二重ガード（最早ガードで既にreturn済みのはず。ここは保険。）
    if (forceFollowMode) {
      console.log("🛑 FORCE FOLLOW MODE (secondary guard) - redirecting to handleFollowUpPhase");
      return handleFollowUpPhase(res, conversationId, message, state, locationPromptMessage, locationRePromptMessage);
    }

    // フェーズ制御（優先順位厳守）: ①初回は質問のみ ②triage未完了は質問 ③summary未生成はまとめ
    if (isFirstUserMessage) {
      conversationHistory[conversationId].push({ role: "user", content: message });
      const missingSlotsFirst = getMissingSlots(state.slotFilled, state);
      const firstSlot = mustAskPainScoreBeforeOtherSlots(state)
        ? "pain_score"
        : missingSlotsFirst[0] || "pain_score";
      let fixed = buildFixedQuestion(firstSlot, false);
      const historyText = message;
      const category = resolveLockedQuestionCategory(state, historyText);
      applyCategoryQuestionOverride(fixed, firstSlot, category, false, historyText, state);
      const symptomLabel = toMainSymptomLabelForSafety(message);
      state.safetyIntroMainSymptomLabel = symptomLabel;
      const safetyTemplate = FIRST_QUESTION_SAFETY_TEMPLATES[Math.floor(Math.random() * FIRST_QUESTION_SAFETY_TEMPLATES.length)];
      const safetyLine = safetyTemplate(symptomLabel);
      const fullResponse = `${safetyLine}\n\n${fixed.question}`;
      const introTemplateIds = [];
      conversationState[conversationId].lastOptions = fixed.options;
      conversationState[conversationId].lastQuestionType = fixed.type;
      conversationState[conversationId].expectsPainScore = firstSlot === "pain_score";
      conversationState[conversationId].askedSlots[firstSlot] = true;
      conversationHistory[conversationId].push({ role: "assistant", content: fullResponse });
      const slotsFilledFirst = countFilledSlots(state.slotFilled, state);
      return res.json({
        message: fullResponse,
        response: fullResponse,
        judgeMeta: {
          judgement: "🟢",
          confidence: 0,
          ratio: 0,
          shouldJudge: false,
          slotsFilledCount: slotsFilledFirst,
          decisionAllowed: false,
          questionCount: 0,
          summaryLine: null,
          questionType: firstSlot,
          rawScore: null,
          painScoreRatio: null,
        },
        triage_state: buildTriageState(false, null, slotsFilledFirst),
        questionPayload: { introTemplateIds, question: fixed.question, safetyLine },
        normalizedAnswer: null,
        locationPromptMessage: null,
        locationRePromptMessage: null,
        locationSnapshot: state.locationSnapshot,
        conversationId,
      });
    }

    // 確認文の後: ユーザーが応答した場合のみまとめを画面表示。生成は確認文と同時に開始済み（早く終わっていればそのまま待機していた）。
    // 最重要: まとめ再生成の完全禁止。summaryShown が true の場合は絶対にここに入らない（上で return 済み）。
    // 強制: 確認応答時は必ずまとめを返す。いかなるエラーでもまとめを出し切る。
    if (isWaitingForConfirmationResponse && !conversationState[conversationId].summaryShown) {
      try {
      conversationState[conversationId].confirmationPending = false;
      conversationState[conversationId].expectsCorrectionReason = false;
      conversationHistory[conversationId].push({ role: "user", content: message });
      const msg = String(message || "").trim();
      const isConfirmationOnly = isConfirmationOnlyAnswer(msg);
      const isRejectionOnly = isRejectionOnlyAnswer(msg);
      const hasAddedInfo = !isConfirmationOnly && !isRejectionOnly;
      const historyTextForBlock = (conversationHistory[conversationId] || [])
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      if (hasAddedInfo) {
        conversationState[conversationId].summaryGenerationEpoch =
          (conversationState[conversationId].summaryGenerationEpoch || 0) + 1;
        conversationState[conversationId].summaryGenerationPromise = null;
        conversationState[conversationId].summaryPrefetchFingerprint = null;
        (conversationState[conversationId].confirmationExtraFacts =
          conversationState[conversationId].confirmationExtraFacts || []).push(msg);
        conversationState[conversationId].stateAboutBulletsCache = null;
      }
      ensureUserUtterancesCapturedBeforeConfirmation(conversationId, conversationState[conversationId]);
      await buildStateFactsBulletsTwoStage(conversationState[conversationId]);
      mergeConfirmationExtraFactsIntoStateBulletsCache(conversationState[conversationId]);
      await supplementStateBulletsFromUncoveredUserUtterances(conversationState[conversationId]);
      let summaryMsg = "";
      let followUpQ = null;
      let stateAboutReplacedInTry = false;
      try {
        if (
          hasAddedInfo &&
          state.summaryText &&
          hasAllSummaryBlocks(state.summaryText)
        ) {
          summaryMsg = await replaceStateAboutBlockOnly(state.summaryText, state, historyTextForBlock);
          stateAboutReplacedInTry = true;
        } else {
          let result;
          if (hasAddedInfo) {
            result = await generateSummaryForConfirmation(conversationId);
          } else {
            const promise = conversationState[conversationId].summaryGenerationPromise;
            result = promise ? await promise : await generateSummaryForConfirmation(conversationId);
            conversationState[conversationId].summaryGenerationPromise = null;
            conversationState[conversationId].summaryPrefetchFingerprint = null;
          }
          summaryMsg = result?.message || "";
          followUpQ = result?.followUpQuestion || null;
          if (!summaryMsg || !hasAllSummaryBlocks(summaryMsg)) {
            const level = finalizeRiskLevel(state);
            const history = conversationHistory[conversationId] || [];
            summaryMsg = await buildLocalSummaryFallback(level, history, state);
          }
          if (hasAddedInfo && summaryMsg) {
            summaryMsg = await replaceStateAboutBlockOnly(summaryMsg, state, historyTextForBlock);
            stateAboutReplacedInTry = true;
          }
        }
        summaryMsg = stripEmergencyBlock(summaryMsg);
        summaryMsg = enforceSummaryIntroTemplate(summaryMsg);
        summaryMsg = ensureGreenHeaderForYellow(summaryMsg, finalizeRiskLevel(state));
      } catch (summaryError) {
        console.error("[ConfirmationSummary Error]", summaryError?.message || summaryError);
        try {
          const level = finalizeRiskLevel(state);
          const history = conversationHistory[conversationId] || [];
          summaryMsg = await buildLocalSummaryFallback(level, history, state);
        } catch (fallbackError) {
          console.error("[ConfirmationSummary Fallback Error]", fallbackError?.message || fallbackError);
          const level = finalizeRiskLevel(state);
          const stateBullets = buildStateFactsBullets(state, { forSummary: true });
          const stateBlock = stateBullets.length > 0 ? stateBullets.join("\n") : "";
          const lastBlock = await generateLastBlockWithLLM(level, state, stateBlock);
          summaryMsg = [
            `${level} ここまでの情報を整理します`,
            buildSummaryIntroTemplate(),
            "",
            "🤝 今の状態について",
            stateBlock,
            "",
            "✅ 今すぐやること",
            "・無理をせず、安静を優先してください",
            "",
            "⏳ 今後の見通し",
            "症状の変化には気をつけて、悪化したら再度ご相談ください。",
            "",
            lastBlock,
          ].join("\n");
        }
      }
      if (!summaryMsg || summaryMsg.trim().length === 0) {
        const level = finalizeRiskLevel(state);
        const stateBullets = buildStateFactsBullets(state, { forSummary: true });
        const stateBlock = stateBullets.length > 0 ? stateBullets.join("\n") : "";
        const lastBlock = await generateLastBlockWithLLM(level, state, stateBlock);
        summaryMsg = [
          `${level} ここまでの情報を整理します`,
          buildSummaryIntroTemplate(),
          "",
          "🤝 今の状態について",
          stateBlock,
          "",
          "✅ 今すぐやること",
          "・無理をせず、安静を優先してください",
          "",
          "⏳ 今後の見通し",
          "症状の変化には気をつけて、悪化したら再度ご相談ください。",
          "",
          lastBlock,
        ].join("\n");
      }
      summaryMsg = ensureGreenHeaderForYellow(summaryMsg, finalizeRiskLevel(state));
      if (hasAddedInfo && summaryMsg && !stateAboutReplacedInTry) {
        summaryMsg = await replaceStateAboutBlockOnly(summaryMsg, state, historyTextForBlock);
      }
      const finalRisk = conversationState[conversationId].decisionLevel || finalizeRiskLevel(conversationState[conversationId]);
      if (!summaryMsg || summaryMsg.trim().length === 0) {
        console.error("[ConfirmationSummary] まとめが空です。強制フォールバックを適用します。");
        summaryMsg = `${finalRisk} ここまでの情報を整理します\n${buildSummaryIntroTemplate()}\n\n症状の変化には気をつけて、悪化したら再度ご相談ください。`;
      }
      conversationState[conversationId].summaryText = summaryMsg;
      markSummaryDeliveredAndFollowUpPhase(conversationState[conversationId]);
      conversationHistory[conversationId].push({ role: "assistant", content: summaryMsg });
      const sections = extractSectionsBySpecs(summaryMsg, getSummarySectionSpecsByJudgement(finalRisk)).map((e) => e.text);
      const followUpForHistory = shouldSendFollowUpQuestion(sections)
        ? followUpQ || getInitialFollowUpQuestionBySpec(state)
        : null;
      if (followUpForHistory) {
        conversationHistory[conversationId].push({ role: "assistant", content: followUpForHistory });
      }
      const slotsFilledCount = countFilledSlots(state.slotFilled, state);
      const decisionAllowed = slotsFilledCount >= getRequiredSlotCount(state);
      return res.json({
        message: summaryMsg,
        response: summaryMsg,
        judgeMeta: {
          judgement: finalRisk,
          confidence: state.confidence,
          ratio: state.decisionRatio ?? 0,
          shouldJudge: true,
          slotsFilledCount,
          decisionAllowed,
          questionCount: state.questionCount,
          summaryLine: extractSummaryLine(summaryMsg),
          questionType: null,
          rawScore: state.lastPainScore,
          painScoreRatio: state.lastPainWeight,
        },
        triage: { judgement: finalRisk, confidence: state.confidence, ratio: state.decisionRatio ?? 0, shouldJudge: true },
        triage_state: buildTriageState(true, finalRisk, slotsFilledCount),
        sections,
        questionPayload: null,
        normalizedAnswer: state.lastNormalizedAnswer || null,
        followUpQuestion: shouldSendFollowUpQuestion(sections) ? (followUpQ || getInitialFollowUpQuestionBySpec(state)) : null,
        followUpMessage: null,
        locationPromptMessage,
        locationRePromptMessage: null,
        locationSnapshot: state.locationSnapshot,
        conversationId,
      });
      } catch (confirmErr) {
        console.error("[ConfirmationSummary 強制フォールバック]", confirmErr?.message || confirmErr);
        const level = finalizeRiskLevel(state);
        const hist = conversationHistory[conversationId] || [];
        let fallbackSummary = "";
        try {
          fallbackSummary = await buildLocalSummaryFallback(level, hist, state);
        } catch (e) {
          fallbackSummary = `${level} ここまでの情報を整理します\n${buildSummaryIntroTemplate()}\n\n症状の変化には気をつけて、悪化したら再度ご相談ください。`;
        }
        conversationState[conversationId].summaryText = fallbackSummary;
        markSummaryDeliveredAndFollowUpPhase(conversationState[conversationId]);
        const finalRisk = conversationState[conversationId].decisionLevel || level;
        const sections = extractSectionsBySpecs(fallbackSummary, getSummarySectionSpecsByJudgement(finalRisk)).map((e) => e.text);
        return res.json({
          message: fallbackSummary,
          response: fallbackSummary,
          judgeMeta: { judgement: finalRisk, confidence: state.confidence || 0, ratio: state.decisionRatio ?? 0, shouldJudge: true, slotsFilledCount: countFilledSlots(state.slotFilled, state), decisionAllowed: true, questionCount: state.questionCount || 0, summaryLine: extractSummaryLine(fallbackSummary), questionType: null, rawScore: state.lastPainScore, painScoreRatio: state.lastPainWeight },
          triage: { judgement: finalRisk, confidence: state.confidence || 0, ratio: state.decisionRatio ?? 0, shouldJudge: true },
          triage_state: buildTriageState(true, finalRisk, countFilledSlots(state.slotFilled, state)),
          sections,
          questionPayload: null,
          normalizedAnswer: state.lastNormalizedAnswer || null,
          followUpQuestion: shouldSendFollowUpQuestion(sections) ? getInitialFollowUpQuestionBySpec(state) : null,
          followUpMessage: null,
          locationPromptMessage,
          locationRePromptMessage: null,
          locationSnapshot: state.locationSnapshot,
          conversationId,
        });
      }
    }

    // confirmationShown && !summaryShown の場合は確認待ち。フォローアップで閉じメッセージを返さない。
    const followUpResult = state.summaryDeliveredForFollowUp
      ? generateFollowResponse(state, message, {
          history: conversationHistory[conversationId] || [],
        })
      : null;
    if (state.summaryShown && state.summaryDeliveredForFollowUp && !followUpResult) {
      // 仕様8.2通り：フォロー質問は固定テンプレ。🔴は質問①、🟢🟡は質問②を返す。
      const specFollowUp = getInitialFollowUpQuestionBySpec(state);
      const outMessage = specFollowUp || buildFollowClosingMessage();
      if (!state.hasSummaryBlockGenerated) {
        state.hasSummaryBlockGenerated = true;
      }
      if (!state.decisionType && state.decisionLevel) {
        state.decisionType = state.decisionLevel === "🔴" ? "A_HOSPITAL" : "C_WATCHFUL_WAITING";
      }
      if (!state.judgmentSnapshot) {
        state.judgmentSnapshot = buildJudgmentSnapshot(state, [], state.decisionType);
      }
      if (state.followUpStep <= 0) {
        state.followUpPhase = "questioning";
        state.followUpStep = 1;
      }
      conversationHistory[conversationId].push({ role: "user", content: message });
      conversationHistory[conversationId].push({ role: "assistant", content: outMessage });
      const judgeMeta = buildFollowUpJudgeMeta(state);
      return res.json({
        message: outMessage,
        response: outMessage,
        judgeMeta,
        triage_state: buildTriageState(true, judgeMeta.judgement, judgeMeta.slotsFilledCount),
        triage: { judgement: judgeMeta.judgement, confidence: judgeMeta.confidence, ratio: judgeMeta.ratio },
        sections: [],
        questionPayload: null,
        normalizedAnswer: state.lastNormalizedAnswer || null,
        isFollowUpOnlyResponse: true,
        locationPromptMessage,
        locationRePromptMessage,
        locationSnapshot: state.locationSnapshot,
        conversationId,
      });
    }
    if (followUpResult) {
      const outMessage = followUpResult.message;
      if (FORBIDDEN_FOLLOW_UP.test(outMessage || "")) {
        // 禁止メッセージは置き換えず、出さない（会話履歴にも追加しない）
        conversationHistory[conversationId].push({ role: "user", content: message });
        const judgeMeta = buildFollowUpJudgeMeta(state);
        return res.json({
          message: "",
          response: "",
          judgeMeta,
          triage_state: buildTriageState(true, judgeMeta.judgement, judgeMeta.slotsFilledCount),
          triage: { judgement: judgeMeta.judgement, confidence: judgeMeta.confidence, ratio: judgeMeta.ratio },
          sections: [],
          questionPayload: null,
          normalizedAnswer: state.lastNormalizedAnswer || null,
          isFollowUpOnlyResponse: true,
          locationPromptMessage,
          locationRePromptMessage,
          locationSnapshot: state.locationSnapshot,
          conversationId,
        });
      }
      conversationHistory[conversationId].push({
        role: "user",
        content: message,
      });
      conversationHistory[conversationId].push({
        role: "assistant",
        content: outMessage,
      });
      const judgeMeta = buildFollowUpJudgeMeta(state);
      return res.json({
        message: outMessage,
        response: outMessage,
        judgeMeta,
        triage_state: buildTriageState(true, judgeMeta.judgement, judgeMeta.slotsFilledCount),
        triage: {
          judgement: judgeMeta.judgement,
          confidence: judgeMeta.confidence,
          ratio: judgeMeta.ratio,
        },
        sections: [],
        questionPayload: null,
        normalizedAnswer: state.lastNormalizedAnswer || null,
        isFollowUpOnlyResponse: true,
        locationPromptMessage,
        locationRePromptMessage,
        locationSnapshot: state.locationSnapshot,
        conversationId,
      });
    }

    // ユーザー回答のスコアを集計
    // 毎ターン先頭で自然発話解析を実施済み
    if (conversationState[conversationId].expectsCauseDetail) {
      conversationState[conversationId].causeDetailText = message.trim();
      conversationState[conversationId].expectsCauseDetail = false;
      conversationState[conversationId].causeDetailAnswered = true;
    }
    if (conversationState[conversationId].expectsPainScore) {
      const rawScore = normalizePainScoreInput(message);
      let weight = 1.5;
      if (rawScore !== null) {
        if (rawScore >= 7) weight = 2.0;
        else if (rawScore >= 5) weight = 1.5;
        else weight = 1.0;
      }
      const isValidPainResponse = rawScore !== null && Number.isFinite(rawScore);
      if (isValidPainResponse) {
        conversationState[conversationId].questionCount += 1;
        conversationState[conversationId].totalScore += weight;
      }
      console.log("[KAIRO SCORE ADD] painWeight applied", {
        painScoreRaw: rawScore,
        painWeight: weight,
        totalScore: conversationState[conversationId].totalScore,
        questionCount: conversationState[conversationId].questionCount,
      });
      conversationState[conversationId].expectsPainScore = false;
      updatePainScoreState(
        conversationState[conversationId],
        rawScore,
        weight,
        rawScore !== null ? String(rawScore) : ""
      );

      const type = conversationState[conversationId].lastQuestionType;
      if (type && SLOT_KEYS.includes(type)) {
        if (isValidPainResponse) {
          if (!conversationState[conversationId].slotFilled[type]) {
            conversationState[conversationId].slotFilled[type] = true;
          }
          const normalized = buildNormalizedAnswer(
            type,
            String(rawScore),
            0,
            rawScore
          ) || { slotId: type, rawAnswer: String(rawScore), riskLevel: RISK_LEVELS.MEDIUM };
          conversationState[conversationId].slotNormalized[type] = normalized;
          conversationState[conversationId].lastNormalizedAnswer = normalized;
          conversationState[conversationId].slotAnswers[type] = String(rawScore);
          markSlotStatus(
            conversationState[conversationId],
            type,
            "question_response",
            String(rawScore)
          );
          conversationState[conversationId].confidence = computeConfidenceFromSlots(
            conversationState[conversationId].slotFilled,
            conversationState[conversationId]
          );
        }
      }
      conversationState[conversationId].lastQuestionType = null;
    } else if (conversationState[conversationId].lastOptions.length >= 2) {
      const lastOptionsSnapshot = conversationState[conversationId].lastOptions;
      const type = conversationState[conversationId].lastQuestionType;
      const classified = classifyAnswerToOption(message, lastOptionsSnapshot, type);
      const selectedIndex = classified.index;
      if (selectedIndex !== null) {
        const optionCount = lastOptionsSnapshot.length;
        const score =
          selectedIndex === 0
            ? 1.0
            : selectedIndex === 1
              ? optionCount === 2
                ? 2.0
                : 1.5
              : selectedIndex === 2
                ? 2.0
                : 1.5;
        conversationState[conversationId].questionCount += 1;
        conversationState[conversationId].totalScore += score;
      }

      // 判断スロットの更新（埋まったスロットを記録）※有効な選択時のみ埋める
      if (type && SLOT_KEYS.includes(type) && selectedIndex !== null && lastOptionsSnapshot[selectedIndex]) {
        if (!conversationState[conversationId].slotFilled[type]) {
          conversationState[conversationId].slotFilled[type] = true;
        }
        const valueForDisplay = String(message || "").trim();
        conversationState[conversationId].slotAnswers[type] =
          valueForDisplay || lastOptionsSnapshot[selectedIndex];
        let normalized = buildNormalizedAnswer(
          type,
          lastOptionsSnapshot[selectedIndex],
          selectedIndex
        );
        if (!normalized) {
          normalized = { slotId: type, rawAnswer: lastOptionsSnapshot[selectedIndex], riskLevel: RISK_LEVELS.MEDIUM };
        }
        conversationState[conversationId].slotNormalized[type] = normalized;
        conversationState[conversationId].lastNormalizedAnswer = normalized;
        markSlotStatus(
          conversationState[conversationId],
          type,
          "question_response",
          valueForDisplay || lastOptionsSnapshot[selectedIndex]
        );
        if (type === "cause_category") {
          const freeText = classified.usedFreeText ? message : "";
          if (classified.usedFreeText && hasConcreteCauseDetail(freeText)) {
            conversationState[conversationId].causeDetailText = freeText.trim();
          }
        }
        if (type === "associated_symptoms") {
          const selectedOpt = lastOptionsSnapshot[selectedIndex] || valueForDisplay || "";
          const answerCombined = (valueForDisplay || selectedOpt || "").trim();
          const selectedIsFeverOption = lastOptionsSnapshot[selectedIndex] === "発熱がある";
          const isFeverAnswerForInfectionShift =
            selectedIsFeverOption || textImpliesFeverForInfectionTriage(answerCombined);
          if (isFeverAnswerForInfectionShift) {
            conversationState[conversationId].triageCategory = "INFECTION";
          }
        }
        conversationState[conversationId].confidence = computeConfidenceFromSlots(
          conversationState[conversationId].slotFilled,
          conversationState[conversationId]
        );
      }
      if (selectedIndex !== null) {
        conversationState[conversationId].lastOptions = [];
        conversationState[conversationId].lastQuestionType = null;
      }
    }

    const filledAfterTurn = countFilledSlots(conversationState[conversationId].slotFilled, conversationState[conversationId]);
    if (filledAfterTurn > filledBeforeTurn) {
      conversationState[conversationId].noNewInformationTurns = 0;
    } else {
      conversationState[conversationId].noNewInformationTurns =
        (conversationState[conversationId].noNewInformationTurns || 0) + 1;
    }

    // Add user message to history
    conversationHistory[conversationId].push({
      role: "user",
      content: message,
    });
    const userTurnCount = conversationHistory[conversationId].filter((msg) => msg.role === "user").length;
    const isFirstUserTurn = userTurnCount <= 1;

    const askedSlotsCount = countAskedSlots(conversationState[conversationId].askedSlots);

    const isInitialQuestionPhase =
      conversationState[conversationId].questionCount === 0 &&
      conversationState[conversationId].lastPainScore === null &&
      !conversationState[conversationId].expectsPainScore;
    if (isInitialQuestionPhase) {
      const fixed = buildFixedQuestion("pain_score", false);
      const introTemplateIds = buildIntroTemplateIds(
        conversationState[conversationId],
        conversationState[conversationId].questionCount,
        "pain_score"
      );
      res.locals.questionPayload = {
        introTemplateIds,
        question: fixed.question,
      };
      res.locals.isFixedQuestion = true;
      conversationState[conversationId].lastOptions = fixed.options;
      conversationState[conversationId].lastQuestionType = fixed.type;
      conversationState[conversationId].expectsPainScore = true;
      conversationState[conversationId].askedSlots.pain_score = true;

      conversationHistory[conversationId].push({
        role: "assistant",
        content: fixed.question,
      });

      const slotsFilledExp = countFilledSlots(conversationState[conversationId].slotFilled, conversationState[conversationId]);
      const judgeMeta = {
        judgement: "🟢",
        confidence: conversationState[conversationId].confidence,
        ratio: 0,
        shouldJudge: false,
        slotsFilledCount: slotsFilledExp,
        decisionAllowed: false,
        questionCount: conversationState[conversationId].questionCount,
        summaryLine: null,
        questionType: null,
        rawScore: null,
        painScoreRatio: null,
      };
      const questionPayload = res.locals.questionPayload || null;
      const normalizedAnswer = conversationState[conversationId].lastNormalizedAnswer || null;
      console.log("[DEBUG] response payload", {
        response: fixed.question,
        judgeMeta,
        questionPayload,
        normalizedAnswer,
      });
      return res.json({
        message: fixed.question,
        response: fixed.question,
        judgeMeta,
        triage_state: buildTriageState(false, null, slotsFilledExp),
        questionPayload,
        normalizedAnswer,
      });
    }

    // Call OpenAI API
    const minQuestions = 5;
    const currentQuestionCount = conversationState[conversationId].questionCount;
    const { ratio, level, confidence, shouldJudge, slotsFilledCount } = judgeDecision(
      conversationState[conversationId]
    );
    // 強制仕様: 全スロット充填完了、またはカテゴリ別の全質問完了時のみ判定・まとめを許可
    const requiredCount = getRequiredSlotCount(conversationState[conversationId]);
    const decisionAllowed = slotsFilledCount >= requiredCount;
    // カテゴリ・場合によりスロット数が異なる（PAIN/GI/SKIN=5, INFECTION=6, worsening_trend ありで+1等）
    const questionsCompleted = currentQuestionCount >= requiredCount;
    // 絶対ルール: 初回ユーザーターンでは絶対にまとめを出さない（2ターン未満も禁止）
    const minUserTurnsForSummary = 2;
    const canShowSummary = !isFirstUserTurn && userTurnCount >= minUserTurnsForSummary;
    // 仕様: 「全スロット埋まり」OR「カテゴリ別の全質問完了」のどちらかで強制的に確認文＋まとめへ
    // 初回バナーセッション: ユーザーターンが十分でない限りまとめへ進まない（canShowSummary と二重だが明示）
    const shouldJudgeNow =
      canShowSummary &&
      (decisionAllowed || questionsCompleted) &&
      !(
        conversationState[conversationId].hasIntroBannerSession &&
        userTurnCount < minUserTurnsForSummary
      );
    const missingSlots = getMissingSlots(conversationState[conversationId].slotFilled, conversationState[conversationId]);
    if (!shouldJudgeNow) {
      const isFirstQuestion =
        conversationState[conversationId].questionCount === 0 &&
        conversationState[conversationId].lastPainScore === null;
      const lastType = conversationState[conversationId].lastQuestionType;
      const reaskSameSlot = lastType && missingSlots.includes(lastType);
      const stFixed = conversationState[conversationId];
      const nextSlot = mustAskPainScoreBeforeOtherSlots(stFixed)
        ? "pain_score"
        : isFirstQuestion
          ? "pain_score"
          : reaskSameSlot
            ? lastType
            : missingSlots[0] || (isFirstUserTurn ? SLOT_KEYS[0] : null);
      if (nextSlot) {
        const useFinalPrefix = missingSlots.length === 1;
        const fixed = buildFixedQuestion(nextSlot, useFinalPrefix);
        const historyText = conversationHistory[conversationId]
          .filter((msg) => msg.role === "user")
          .map((msg) => msg.content)
          .join("\n");
        const category = resolveLockedQuestionCategory(
          conversationState[conversationId],
          historyText
        );
        applyCategoryQuestionOverride(fixed, nextSlot, category, useFinalPrefix, historyText, conversationState[conversationId]);
        const introTemplateIds = buildIntroTemplateIds(
          conversationState[conversationId],
          conversationState[conversationId].questionCount,
          nextSlot
        );
        const questionPayload = {
          introTemplateIds,
          question: fixed.question,
        };
        const aiResponse = fixed.question;
        conversationState[conversationId].lastOptions = fixed.options;
        conversationState[conversationId].lastQuestionType = fixed.type;
        conversationState[conversationId].expectsPainScore = fixed.type === "pain_score";
        conversationState[conversationId].askedSlots[nextSlot] = true;
        conversationHistory[conversationId].push({
          role: "assistant",
          content: aiResponse,
        });
        const judgeMeta = {
          judgement: level,
          confidence,
          ratio: Number(ratio.toFixed(2)),
          shouldJudge: false,
          slotsFilledCount,
          decisionAllowed,
          questionCount: conversationState[conversationId].questionCount,
          summaryLine: null,
          questionType: fixed.type,
          rawScore: conversationState[conversationId].lastPainScore,
          painScoreRatio: conversationState[conversationId].lastPainWeight,
        };
        return res.json({
          message: aiResponse,
          response: aiResponse,
          judgeMeta,
          triage_state: buildTriageState(false, null, slotsFilledCount),
          questionPayload,
          normalizedAnswer: conversationState[conversationId].lastNormalizedAnswer || null,
          locationSnapshot: conversationState[conversationId].locationSnapshot,
          conversationId,
        });
      }
    }

    // 絶対防御: 初回ユーザーターンではLLMを呼ばず、必ず質問を返す（まとめ・フォロー禁止）
    if (isFirstUserTurn) {
      const fallbackSlot =
        getMissingSlots(conversationState[conversationId].slotFilled, conversationState[conversationId])[0] || SLOT_KEYS[0];
      const fixed = buildFixedQuestion(fallbackSlot, false);
      const historyText = conversationHistory[conversationId]
        .filter((msg) => msg.role === "user")
        .map((msg) => msg.content)
        .join("\n");
      const category = resolveLockedQuestionCategory(
        conversationState[conversationId],
        historyText
      );
      applyCategoryQuestionOverride(fixed, fallbackSlot, category, false, historyText, conversationState[conversationId]);
      const aiResponseForced = fixed.question;
      conversationState[conversationId].lastOptions = fixed.options;
      conversationState[conversationId].lastQuestionType = fixed.type;
      conversationState[conversationId].expectsPainScore = fixed.type === "pain_score";
      conversationState[conversationId].askedSlots[fallbackSlot] = true;
      conversationHistory[conversationId].push({
        role: "assistant",
        content: aiResponseForced,
      });
      const judgeMeta = {
        judgement: level,
        confidence,
        ratio: Number(ratio.toFixed(2)),
        shouldJudge: false,
        slotsFilledCount,
        decisionAllowed,
        questionCount: conversationState[conversationId].questionCount,
        summaryLine: null,
        questionType: fixed.type,
        rawScore: conversationState[conversationId].lastPainScore,
        painScoreRatio: conversationState[conversationId].lastPainWeight,
      };
      return res.json({
        message: aiResponseForced,
        response: aiResponseForced,
        judgeMeta,
        triage_state: buildTriageState(false, null, slotsFilledCount),
        questionPayload: {
          introTemplateIds: buildIntroTemplateIds(
            conversationState[conversationId],
            conversationState[conversationId].questionCount,
            fallbackSlot
          ),
          question: fixed.question,
        },
        normalizedAnswer: conversationState[conversationId].lastNormalizedAnswer || null,
        locationSnapshot: conversationState[conversationId].locationSnapshot,
        conversationId,
      });
    }

    // 6スロット完了時: 確認文の箇条書きは TwoStage＋追補を await してから組み立てる（非同期だとキャッシュ未生成で欠落する）。まとめ生成のみバックグラウンド。
    if (shouldJudgeNow && !conversationState[conversationId].confirmationShown && !conversationState[conversationId].summaryShown) {
      ensureUserUtterancesCapturedBeforeConfirmation(conversationId, conversationState[conversationId]);
      const stPre = conversationState[conversationId];
      try {
        await buildStateFactsBulletsTwoStage(stPre);
      } catch (e) {
        console.error("[Pre-summary twoStage]", e?.message || e);
      }
      try {
        await Promise.all([
          supplementStateBulletsFromUncoveredUserUtterances(stPre).catch((e) => {
            console.error("[Pre-summary supplement]", e?.message || e);
            return { added: 0 };
          }),
          resolveLocationContext(stPre, stPre.clientMeta).catch((e) => {
            console.error("[Pre-summary location]", e?.message || e);
          }),
        ]);
        stPre.skipSupplementBeforeSummary = true;
      } catch (e) {
        console.error("[Pre-summary parallel]", e?.message || e);
        stPre.skipSupplementBeforeSummary = true;
      }
      const confirmMsg = buildPreSummaryConfirmationMessage(conversationState[conversationId]);
      const stForPrefetch = conversationState[conversationId];
      const prefetchFp = computeSummaryPrefetchFingerprint(stForPrefetch);
      if (!stForPrefetch.summaryGenerationPromise || stForPrefetch.summaryPrefetchFingerprint !== prefetchFp) {
        stForPrefetch.summaryPrefetchFingerprint = prefetchFp;
        stForPrefetch.summaryGenerationPromise = generateSummaryForConfirmation(conversationId).catch((e) => {
          console.error("[Background pre-summary]", e?.message || e);
          return { message: "", followUpQuestion: null, followUpMessage: null };
        });
      }
      conversationHistory[conversationId].push({ role: "assistant", content: confirmMsg });
      conversationState[conversationId].confirmationPending = true;
      conversationState[conversationId].confirmationShown = true;
      conversationState[conversationId].lastOptions = [];
      conversationState[conversationId].lastQuestionType = null;
      const finalLevel = finalizeRiskLevel(conversationState[conversationId]);
      const summaryQuickPreview = buildSummaryQuickPreviewFromState(conversationState[conversationId]);
      return res.json({
        message: confirmMsg,
        response: confirmMsg,
        isPreSummaryConfirmation: true,
        summaryQuickPreview,
        summaryFullPending: true,
        judgeMeta: {
          judgement: finalLevel,
          confidence,
          ratio: Number(ratio.toFixed(2)),
          shouldJudge: true,
          slotsFilledCount,
          decisionAllowed: true,
          questionCount: conversationState[conversationId].questionCount,
          summaryLine: null,
          questionType: null,
          rawScore: conversationState[conversationId].lastPainScore,
          painScoreRatio: conversationState[conversationId].lastPainWeight,
        },
        triage_state: buildTriageState(true, finalLevel, slotsFilledCount),
        questionPayload: null,
        normalizedAnswer: conversationState[conversationId].lastNormalizedAnswer || null,
        locationPromptMessage,
        locationRePromptMessage,
        locationSnapshot: conversationState[conversationId].locationSnapshot,
        conversationId,
      });
    }

    // 最終防御: 初回ユーザーターンでは、まとめ/フォローを絶対に返さない（上で return 済みのため通常到達しない）
    if (isFirstUserTurn && hasAnySummaryBlocks(aiResponse)) {
      const forcedSlot =
        getMissingSlots(conversationState[conversationId].slotFilled, conversationState[conversationId])[0] || "worsening";
      const fixed = buildFixedQuestion(forcedSlot, false);
      const historyText = conversationHistory[conversationId]
        .filter((msg) => msg.role === "user")
        .map((msg) => msg.content)
        .join("\n");
      const category = resolveLockedQuestionCategory(
        conversationState[conversationId],
        historyText
      );
      applyCategoryQuestionOverride(fixed, forcedSlot, category, false, historyText, conversationState[conversationId]);
      aiResponse = fixed.question;
      conversationState[conversationId].lastOptions = fixed.options;
      conversationState[conversationId].lastQuestionType = fixed.type;
      conversationState[conversationId].expectsPainScore = fixed.type === "pain_score";
      conversationState[conversationId].askedSlots[forcedSlot] = true;
      res.locals.questionPayload = {
        introTemplateIds: buildIntroTemplateIds(
          conversationState[conversationId],
          conversationState[conversationId].questionCount,
          forcedSlot
        ),
        question: fixed.question,
      };
      res.locals.isFixedQuestion = true;
    }
    const scoreContext = `現在の回答数: ${conversationState[conversationId].questionCount}\n判断スロット埋まり数: ${slotsFilledCount}/${requiredCount}\n未充足スロット: ${missingSlots.join(",")}\n確信度: ${confidence}%\n緊急度判定は「危険フラグ優先モデル」を使用する（Phase1: 即時RED条件 / Phase2: 重症指数）。\n重要: 次の質問は未充足スロットのみから1つ選ぶこと。既に埋まったスロットの質問は禁止。質問回数が${requiredCount}以上、または判断スロットが${requiredCount}つ全て埋まった時点で必ず判定・まとめへ移行する。\n※内部計算はユーザーに表示しないこと。最終判断はまとめ直前の1回のみ実行すること。`;
    const stLate = conversationState[conversationId];
    const histLate = conversationHistory[conversationId] || [];
    reconcilePostSummaryStateIfNeeded(stLate, histLate, clientMeta, false);
    if (
      stLate.summaryDeliveredForFollowUp &&
      (stLate.summaryShown ||
        stLate.phase === "FOLLOW_UP" ||
        stLate.summaryGenerated ||
        stLate.hasSummaryBlockGenerated ||
        historyContainsSummaryBlock(histLate))
    ) {
      if (historyContainsSummaryBlock(histLate) && !stLate.summaryShown) {
        markSummaryDeliveredAndFollowUpPhase(stLate);
      }
      if (
        stLate.summaryShown ||
        stLate.phase === "FOLLOW_UP" ||
        stLate.summaryGenerated ||
        stLate.hasSummaryBlockGenerated
      ) {
        console.log("🛑 LLM triage blocked: post-summary / FOLLOW_UP (defense before completion)");
        return handleFollowUpPhase(
          res,
          conversationId,
          message,
          stLate,
          locationPromptMessage,
          locationRePromptBeforeSummary,
          { skipUserPush: true }
        );
      }
    }
    const structuredConversation = buildStructuredConversationForLlm(
      conversationHistory[conversationId],
      conversationState[conversationId]
    );
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost-effective model
      messages: [
        ...structuredConversation,
        { role: "system", content: scoreContext },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });
    let aiResponse = completion.choices[0].message.content;

    // 判定確定トリガー発動時は、まとめを強制生成（初回のみ）。summaryShown が true なら絶対にまとめを生成しない。
    if (shouldJudgeNow && !conversationState[conversationId].summaryShown) {
      const stGuard = conversationState[conversationId];
      if (
        stGuard.summaryDeliveredForFollowUp &&
        (stGuard.phase === "FOLLOW_UP" ||
          stGuard.summaryGenerated ||
          stGuard.hasSummaryBlockGenerated)
      ) {
        console.error("🚨 BLOCKED: LLM full-summary path while post-summary flags set (redirect to follow-up)");
        return handleFollowUpPhase(
          res,
          conversationId,
          message,
          stGuard,
          locationPromptMessage,
          locationRePromptBeforeSummary,
          { skipUserPush: true }
        );
      }
      const level = finalizeRiskLevel(conversationState[conversationId]);
      const historyTextForCare = conversationHistory[conversationId]
        .filter((msg) => msg.role === "user")
        .map((msg) => msg.content)
        .join("\n");
      const careDestination = detectCareDestinationFromHistory(historyTextForCare);
      conversationState[conversationId].careDestination = careDestination;
      conversationState[conversationId].historyTextForCare = historyTextForCare;
      const historyTextForOtc = conversationHistory[conversationId]
        .filter((msg) => msg.role === "user")
        .map((msg) => msg.content)
        .join("\n");
      const otcCategory = (() => {
        if (historyTextForOtc.match(/腹|お腹|胃|下痢|便秘/)) return "bowel";
        if (historyTextForOtc.match(/喉|のど/)) return "throat";
        if (historyTextForOtc.match(/鼻水|鼻づまり|くしゃみ/)) return "nose";
        if (historyTextForOtc.match(/咳|せき/)) return "cough";
        if (historyTextForOtc.match(/だるい|脱水|水分/)) return "fatigue";
        if (historyTextForOtc.match(/かゆみ|アレルギー|花粉/)) return "allergy";
        if (historyTextForOtc.match(/頭痛|頭が痛|頭が重|発熱|熱/)) return "pain_fever";
        return "pain_fever";
      })();
      const otcWarningIndex = Math.floor(Math.random() * 5);
      await resolveLocationContext(
        conversationState[conversationId],
        conversationState[conversationId].clientMeta
      );
      const locationContext = conversationState[conversationId].locationContext || {};
      const stateForPlaces = conversationState[conversationId];
      const hasLocationSnapshot = !!(stateForPlaces?.locationSnapshot?.lat && stateForPlaces?.locationSnapshot?.lng);
      if (level === "🔴") {
        console.log("[Places] 🔴 受診先検索開始", {
          hasLocationSnapshot,
          hasPlacesKey: !!getPlacesApiKey(),
          locationSnapshot: stateForPlaces?.locationSnapshot ? { lat: stateForPlaces.locationSnapshot.lat, lng: stateForPlaces.locationSnapshot.lng } : null,
        });
        if (hasLocationSnapshot) {
          [stateForPlaces.clinicCandidates, stateForPlaces.hospitalCandidates, stateForPlaces.pharmacyCandidates] = await Promise.all([
            resolveCareCandidates(stateForPlaces, careDestination),
            resolveHospitalCandidates(stateForPlaces),
            resolvePharmacyCandidates(stateForPlaces),
          ]);
        } else {
          [stateForPlaces.clinicCandidates, stateForPlaces.hospitalCandidates] = await Promise.all([
            resolveCareCandidates(stateForPlaces, careDestination),
            resolveHospitalCandidates(stateForPlaces),
          ]);
          stateForPlaces.pharmacyCandidates = await resolvePharmacyCandidates(stateForPlaces);
        }
        const clinicLen = (stateForPlaces.clinicCandidates || []).length;
        const hospLen = (stateForPlaces.hospitalCandidates || []).length;
        console.log("[Places] 🔴 受診先検索結果", { clinicCandidates: clinicLen, hospitalCandidates: hospLen });
      } else {
        // 🟢/🟡: 薬局検索を非同期で行い、まとめ表示を待たせない
        stateForPlaces.pharmacyCandidates = [];
        stateForPlaces.pharmacyRecommendation = buildPharmacyRecommendation(
          stateForPlaces,
          locationContext,
          []
        );
        void resolvePharmacyCandidates(stateForPlaces).then((candidates) => {
          stateForPlaces.pharmacyCandidates = candidates;
          stateForPlaces.pharmacyRecommendation = buildPharmacyRecommendation(
            stateForPlaces,
            locationContext,
            candidates
          );
        });
      }
      const pharmacyRec = level === "🔴"
        ? buildPharmacyRecommendation(
            conversationState[conversationId],
            locationContext,
            conversationState[conversationId].pharmacyCandidates
          )
        : conversationState[conversationId].pharmacyRecommendation;
      if (level === "🔴") conversationState[conversationId].pharmacyRecommendation = pharmacyRec;
      const otcExamples = buildOtcExamples(otcCategory, locationContext.country);
      conversationState[conversationId].otcExamples = otcExamples;
      const hospitalRec = buildHospitalRecommendationDetail(
        conversationState[conversationId],
        locationContext,
        conversationState[conversationId].clinicCandidates,
        conversationState[conversationId].hospitalCandidates
      );
      conversationState[conversationId].hospitalRecommendation = hospitalRec;
      const hospitalListSource =
        (conversationState[conversationId].hospitalCandidates || []).length > 0
          ? conversationState[conversationId].hospitalCandidates
          : conversationState[conversationId].clinicCandidates || [];
      const clinicList = hospitalListSource
        .map((item) => `・${item.name}`)
        .join("\n");
      const clinicHint = clinicList
        ? `\n以下の候補から具体名を1つ選んで提示してください。\n${clinicList}\n`
        : "\n具体名がない場合は、近いGP/クリニックの具体名を提示してください。\n";
      const pharmacyHint = pharmacyRec?.name
        ? `\n薬局名は「${pharmacyRec.name}」を優先してください。\n薬名は例示で2〜3件、一般名＋商品名で示し、末尾に「最終判断は薬剤師に相談してください。これは一般的に現地で使われる選択肢です。」を入れてください。\n`
        : "\n薬局名は国・都市レベルで具体名を1件提示し、薬名は例示で2〜3件、一般名＋商品名で示してください。\n末尾に「最終判断は薬剤師に相談してください。これは一般的に現地で使われる選択肢です。」を入れてください。\n";
      locationRePromptBeforeSummary = null;
      const summaryContextMessages = buildStructuredConversationForLlm(
        conversationHistory[conversationId],
        conversationState[conversationId]
      );
      const summaryOnlyMessages = [
        { role: "system", content: buildRepairPrompt(level, conversationState[conversationId]) },
        { role: "system", content: clinicHint },
        { role: "system", content: pharmacyHint },
        ...summaryContextMessages,
      ];
      const forced = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: summaryOnlyMessages,
        temperature: 0.7,
        max_tokens: 1000,
      });
      aiResponse = forced.choices[0].message.content;
      if (!hasAllSummaryBlocks(aiResponse)) {
        const strictMessages = [
          { role: "system", content: buildRepairPrompt(level, conversationState[conversationId]) + "\n\n不足ブロックがある場合は必ず補完して、全ブロックを完成させてください。" },
          ...summaryContextMessages,
        ];
        const strict = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: strictMessages,
          temperature: 0.7,
          max_tokens: 1000,
        });
        aiResponse = strict.choices[0].message.content;
      }
      if (level !== "🔴" && isHospitalFlow(aiResponse)) {
        const repairForLevel = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: buildRepairPrompt(level, conversationState[conversationId]) },
            ...summaryContextMessages,
          ],
          temperature: 0.7,
          max_tokens: 1000,
        });
        aiResponse = repairForLevel.choices[0].message.content;
      }
      aiResponse = normalizeSummaryLevel(aiResponse, level);
      aiResponse = ensureYellowOtcBlock(
        aiResponse,
        level,
        otcCategory,
        otcWarningIndex,
        conversationState[conversationId].pharmacyRecommendation,
        conversationState[conversationId].otcExamples,
        conversationState[conversationId].pharmacyRecommendation?.preface
      );
      aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
      let immediateActionPlan = null;
      if (level === "🟢" || level === "🟡") {
        try {
          immediateActionPlan = await buildImmediateActionHypothesisPlan(
            conversationState[conversationId],
            historyTextForOtc,
            aiResponse
          );
        } catch (immediateActionError) {
          console.error("[ImmediateActionPlan Error]", immediateActionError?.message || immediateActionError);
          immediateActionPlan = await buildImmediateActionFallbackPlanFromState(
            conversationState[conversationId]
          );
        }
        aiResponse = normalizeStateBlockForGreenYellow(
          aiResponse,
          conversationState[conversationId]
        );
        aiResponse = await ensureImmediateActionsBlock(
          aiResponse,
          level,
          conversationState[conversationId],
          historyTextForOtc,
          immediateActionPlan
        );
      }
      if (level === "🔴") {
        conversationState[conversationId].decisionLevel = "🔴";
        try {
          immediateActionPlan = await buildImmediateActionHypothesisPlan(
            conversationState[conversationId],
            historyTextForOtc,
            aiResponse
          );
        } catch (immediateActionError) {
          console.error("[ImmediateActionPlan Error]", immediateActionError?.message || immediateActionError);
          immediateActionPlan = null;
        }
      }
      aiResponse = ensureOutlookBlock(aiResponse, conversationState[conversationId]);
      aiResponse = await ensureLastBlock(aiResponse, level, conversationState[conversationId], historyTextForOtc || aiResponse);
      aiResponse = enforceYellowOtcPositionStrict(aiResponse, level);
      if (level === "🔴") {
        aiResponse = await ensureHospitalMemoBlock(aiResponse, conversationState[conversationId], historyTextForOtc);
        aiResponse = await ensureRedImmediateActionsBlock(aiResponse, conversationState[conversationId], historyTextForOtc, immediateActionPlan);
        aiResponse = ensureHospitalBlock(
          aiResponse,
          conversationState[conversationId],
          historyTextForOtc
        );
      }
      conversationState[conversationId].summaryText = aiResponse;
      if (level === "🔴") {
        const hospitalName = conversationState[conversationId].hospitalRecommendation?.name;
        const hasType = aiResponse.includes("タイプ：");
        const hasReason = aiResponse.includes("理由：");
        if (hospitalName && (!aiResponse.includes(hospitalName) || !hasType || !hasReason)) {
          aiResponse = await buildLocalSummaryFallback(
            level,
            conversationHistory[conversationId],
            conversationState[conversationId]
          );
        }
      }
      if (!validateSummaryAgainstNormalized(aiResponse, conversationState[conversationId])) {
        aiResponse = await buildLocalSummaryFallback(
          level,
          conversationHistory[conversationId],
          conversationState[conversationId]
        );
      }
      aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
      if (!hasAllSummaryBlocks(aiResponse)) {
        aiResponse = await buildLocalSummaryFallback(
          level,
          conversationHistory[conversationId],
          conversationState[conversationId]
        );
      }
      aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
      aiResponse = ensureRestMcDecisionBlock(
        aiResponse,
        level,
        conversationState[conversationId]
      );
      aiResponse = sanitizeGeneralPhrases(aiResponse);
      aiResponse = stripStateAboutIntroOutro(aiResponse);
      aiResponse = sanitizeSummaryQuestions(aiResponse);
      aiResponse = stripForbiddenFollowUpMessage(aiResponse);
      aiResponse = simplifyPossibilityPhrases(aiResponse);
      aiResponse = correctKanjiAndTypos(aiResponse);
      aiResponse = enforceSummaryIntroTemplate(aiResponse);
      aiResponse = await enforceSummaryStructureStrict(
        aiResponse,
        level,
        conversationHistory[conversationId],
        conversationState[conversationId]
      );
      aiResponse = stripInfectionOnlineClinicGuidance(
        aiResponse,
        conversationState[conversationId]
      );
      aiResponse = stripHospitalMapLinks(aiResponse);
      aiResponse = stripMcForRed(aiResponse, level);
      aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
      const decisionType =
        level === "🔴" ? "A_HOSPITAL" : "C_WATCHFUL_WAITING";
      markSummaryDeliveredAndFollowUpPhase(conversationState[conversationId]);
      conversationState[conversationId].decisionType = decisionType;
      conversationState[conversationId].decisionLevel =
        level === "🔴" ? "🔴" : level === "🟡" ? "🟡" : "🟢";
      if (!conversationState[conversationId].judgmentSnapshot) {
        conversationState[conversationId].judgmentSnapshot = buildJudgmentSnapshot(
          conversationState[conversationId],
          conversationHistory[conversationId],
          decisionType
        );
      }
      if (conversationState[conversationId].decisionRatio === null) {
        const computed = calculateRiskFromState(conversationState[conversationId]);
        conversationState[conversationId].decisionRatio = computed.ratio;
      }
      conversationState[conversationId].finalQuestionPending = false;
      if (decisionType === "A_HOSPITAL") {
        conversationState[conversationId].followUpPhase = "questioning";
        conversationState[conversationId].followUpStep = 1;
        const destinationName = conversationState[conversationId].hospitalRecommendation?.name;
        conversationState[conversationId].followUpDestinationName = formatDestinationName(
          destinationName,
          decisionType
        );
        followUpQuestion = RED_FOLLOW_UP_QUESTION;
      } else {
        conversationState[conversationId].followUpPhase = "questioning";
        conversationState[conversationId].followUpStep = 1;
        followUpQuestion = getInitialFollowUpQuestionBySpec(conversationState[conversationId]);
      }
    }

    // まとめが早すぎる／助言が混ざる場合は質問に差し戻す
    if (
      !shouldJudgeNow &&
      shouldAvoidSummary(aiResponse, shouldJudgeNow)
    ) {
      const questionOnlyPrompt = `
あなたはKairoです。今は情報収集中のフェーズです。
必ず以下を守って、次の質問だけを出してください：
- 共感を1文入れる（直前のユーザーの言葉を1語以上使う）
- 小さな前進の言語化を1文入れる
- 目的宣言を1文入れる（次は〜を一緒に確認したいです 等）
- 共感・前進・目的の言い回しは直近2問と同じ表現を避ける
- 判断・助言・原因推測は一切入れない
- 質問は1つだけ
- 必ず二択（A or B の1行形式）
- 選択肢は意味のある具体表現で並べる（低/中/高は禁止）
- まとめブロックは出さない
- 直前の質問と同じ意味・同じ軸の質問は禁止
`;
      const questionMessages = [
        { role: "system", content: questionOnlyPrompt },
        ...structuredConversation,
      ];
      const reask = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          ...questionMessages,
          { role: "system", content: scoreContext },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });
      aiResponse = reask.choices[0].message.content;
    }

    // 6スロット埋めを保証するため、質問が不適切なら補正する
    if (!shouldJudgeNow) {
      const missingSlots = getMissingSlots(
        conversationState[conversationId].slotFilled,
        conversationState[conversationId]
      );
      const isFirstQuestion =
        conversationState[conversationId].questionCount === 0 &&
        conversationState[conversationId].lastPainScore === null;
      const lastType = conversationState[conversationId].lastQuestionType;
      const reaskSameSlot = lastType && missingSlots.includes(lastType);
      const st = conversationState[conversationId];
      const nextSlot = mustAskPainScoreBeforeOtherSlots(st)
        ? "pain_score"
        : isFirstQuestion
          ? "pain_score"
          : reaskSameSlot
            ? lastType
            : missingSlots[0];
      if (nextSlot) {
        const useFinalPrefix = missingSlots.length === 1;
        const fixed = buildFixedQuestion(nextSlot, useFinalPrefix);
        const historyText = conversationHistory[conversationId]
          .filter((msg) => msg.role === "user")
          .map((msg) => msg.content)
          .join("\n");
        const category = resolveLockedQuestionCategory(
          conversationState[conversationId],
          historyText
        );
        applyCategoryQuestionOverride(fixed, nextSlot, category, useFinalPrefix, historyText, conversationState[conversationId]);
        const introTemplateIds = buildIntroTemplateIds(
          conversationState[conversationId],
          conversationState[conversationId].questionCount,
          nextSlot
        );
        res.locals.questionPayload = {
          introTemplateIds,
          question: fixed.question,
        };
        res.locals.isFixedQuestion = true;

        aiResponse = fixed.question;
        conversationState[conversationId].lastOptions = fixed.options;
        conversationState[conversationId].lastQuestionType = fixed.type;
        conversationState[conversationId].expectsPainScore = fixed.type === "pain_score";
        conversationState[conversationId].askedSlots[nextSlot] = true;
      }
    }

    // 次の質問の選択肢と質問タイプを保存
    const options = extractOptionsFromAssistant(aiResponse);
    if (options.length >= 2) {
      conversationState[conversationId].lastOptions = options;
      if (!res.locals.isFixedQuestion) {
        conversationState[conversationId].previousQuestionType =
          conversationState[conversationId].lastQuestionType;
        conversationState[conversationId].lastQuestionType = detectQuestionType(aiResponse);
        if (conversationState[conversationId].lastQuestionType) {
          const history = conversationState[conversationId].recentQuestionTypes || [];
          history.push(conversationState[conversationId].lastQuestionType);
          conversationState[conversationId].recentQuestionTypes = history.slice(-5);
        }
        const questionText = normalizeQuestionText(aiResponse);
        if (questionText) {
          const textHistory = conversationState[conversationId].recentQuestionTexts || [];
          textHistory.push(questionText);
          conversationState[conversationId].recentQuestionTexts = textHistory.slice(-5);
        }
        const phraseSignature = extractQuestionPhrases(aiResponse);
        if (phraseSignature) {
          const phraseHistory = conversationState[conversationId].recentQuestionPhrases || [];
          phraseHistory.push(phraseSignature);
          conversationState[conversationId].recentQuestionPhrases = phraseHistory.slice(-5);
        }
      }
    }

    // 最後の質問は「最後に〜」で始める（AIが終盤と判断した場合）。カテゴリ別の質問数に合わせる
    if (
      !shouldJudgeNow &&
      currentQuestionCount >= minQuestions &&
      currentQuestionCount < requiredCount &&
      missingSlots.length === 1 &&
      isQuestionResponse(aiResponse) &&
      !hasFinalQuestionPrefix(aiResponse)
    ) {
      const finalQuestionPrompt = `
あなたはKairoです。今は最後の質問です。
必ず以下を守って、次の質問だけを出してください：
- 文頭は必ず「最後に」または「最後の質問です」から始める
- 共感を1文入れる（直前のユーザーの言葉を1語以上使う）
- 小さな前進の言語化を1文入れる
- 目的宣言を1文入れる（次は〜を一緒に確認したいです 等）
- 質問は1つだけ
- 必ず二択 or 選択式
- 選択肢は意味のある具体表現で並べる（低/中/高は禁止）
- 記号は必ず「・」を使う
- 判断・助言・原因推測は一切入れない
- まとめブロックは出さない
`;
      const finalMessages = [
        { role: "system", content: finalQuestionPrompt },
        ...structuredConversation,
      ];
      const finalAsk = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          ...finalMessages,
          { role: "system", content: scoreContext },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });
      aiResponse = finalAsk.choices[0].message.content;
    }

    // 最後の質問フラグを立てる（「最後に〜」が出たら次でまとめ）
    if (
      currentQuestionCount >= minQuestions &&
      isQuestionResponse(aiResponse) &&
      hasFinalQuestionPrefix(aiResponse)
    ) {
      conversationState[conversationId].finalQuestionPending = true;
    } else if (isQuestionResponse(aiResponse)) {
      conversationState[conversationId].finalQuestionPending = false;
    }

    // まとめブロックが欠けている/出ていない場合は再生成（質問数を満たした後のみ）。まとめ後フェーズでは絶対に実行しない。
    const updatedQuestionCount = conversationState[conversationId].questionCount;
    const updatedLevel = computeUrgencyLevel(
      updatedQuestionCount,
      conversationState[conversationId].totalScore
    ).level;
    if (
      !conversationState[conversationId].summaryShown &&
      updatedQuestionCount >= minQuestions &&
      !isQuestionResponse(aiResponse)
    ) {
      const needsRepair = !hasAllSummaryBlocks(aiResponse);
      if (needsRepair) {
        const repairMessages = [
          { role: "system", content: buildRepairPrompt(updatedLevel, conversationState[conversationId]) },
          ...structuredConversation,
        ];
        const repaired = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: repairMessages,
          temperature: 0.7,
          max_tokens: 1000,
        });
        aiResponse = repaired.choices[0].message.content;
      }
    }

    aiResponse = enforceBulletSymbol(aiResponse);
    aiResponse = simplifyPossibilityPhrases(aiResponse);
    aiResponse = correctKanjiAndTypos(aiResponse);

    // Add AI response to history
    conversationHistory[conversationId].push({
      role: "assistant",
      content: aiResponse,
    });
    const finalRisk = conversationState[conversationId].decisionLevel || level;
    const sections =
      shouldJudgeNow
        ? extractSectionsBySpecs(aiResponse, getSummarySectionSpecsByJudgement(finalRisk)).map((e) => e.text)
        : [];
    if (followUpMessage) {
      conversationHistory[conversationId].push({
        role: "assistant",
        content: followUpMessage,
      });
    }
    if (followUpQuestion && shouldSendFollowUpQuestion(sections)) {
      conversationHistory[conversationId].push({
        role: "assistant",
        content: followUpQuestion,
      });
    }
    const finalScore = conversationState[conversationId].totalScore;
    console.log("FINAL RISK:", finalRisk);
    console.log("FINAL SCORE:", finalScore);
    const judgeMeta = {
      judgement: finalRisk,
      confidence,
      ratio: conversationState[conversationId].decisionRatio ?? Number(ratio.toFixed(2)),
      shouldJudge: shouldJudgeNow,
      slotsFilledCount,
      decisionAllowed,
      questionCount: conversationState[conversationId].questionCount,
      summaryLine: shouldJudgeNow ? extractSummaryLine(aiResponse) : null,
      questionType: conversationState[conversationId].lastPainScore !== null ? "pain_score" : null,
      rawScore: conversationState[conversationId].lastPainScore,
      painScoreRatio: conversationState[conversationId].lastPainWeight,
    };
    const questionPayload = res.locals.questionPayload || null;
    const normalizedAnswer = conversationState[conversationId].lastNormalizedAnswer || null;
    console.log("[DEBUG] response payload", {
      response: aiResponse,
      judgeMeta,
      questionPayload,
      normalizedAnswer,
    });
    const triage = {
      judgement: finalRisk,
      confidence,
      ratio: conversationState[conversationId].decisionRatio ?? Number(ratio.toFixed(2)),
      shouldJudge: shouldJudgeNow,
    };
    const triage_state = buildTriageState(shouldJudgeNow, finalRisk, slotsFilledCount);
    // 最終ガード: まとめ返却直前。万が一ここに到達したらリダイレクト＋履歴ロールバック
    const mustFollow = mustUseFollowUpPhase(
      conversationState[conversationId],
      conversationHistory[conversationId],
      conversationState[conversationId]?.clientMeta,
      (conversationHistory[conversationId] || []).filter((m) => m.role === "user").length
    );
    if (sections.length > 0 && mustFollow) {
      console.error("🛑 CRITICAL: About to return summary in follow-up phase. Rolling back and redirecting.");
      const hist = conversationHistory[conversationId];
      let toPop = 1;
      if (followUpMessage) toPop++;
      if (followUpQuestion && shouldSendFollowUpQuestion(sections)) toPop++;
      for (let i = 0; i < toPop && hist?.length; i++) hist.pop();
      return handleFollowUpPhase(
        res,
        conversationId,
        req.body?.message || message,
        conversationState[conversationId],
        locationPromptMessage,
        locationRePromptBeforeSummary,
        { skipUserPush: true }
      );
    }
    res.json({
      message: aiResponse,
      response: aiResponse,
      judgeMeta,
      triage,
      triage_state,
      sections,
      questionPayload,
      normalizedAnswer,
      followUpQuestion: shouldSendFollowUpQuestion(sections) ? (followUpQuestion || null) : null,
      followUpMessage: followUpMessage || null,
      locationPromptMessage,
      locationRePromptMessage: locationRePromptBeforeSummary,
      locationSnapshot: conversationState[conversationId].locationSnapshot,
      conversationId,
    });
  } catch (error) {
    console.error("OpenAI API Error:", error);
    console.error("Error details:", {
      message: error?.message,
      type: error?.constructor?.name,
      stack: error?.stack,
    });
    const cid = (req.body && req.body.conversationId) || null;
    const state = cid ? conversationState[cid] : null;
    const history = cid ? conversationHistory[cid] || [] : [];
    const filled = state ? countFilledSlots(state.slotFilled, state) : 0;
    const wasWaitingForSummary = state && (state.confirmationShown && !state.summaryShown);
    if (state && (filled >= getRequiredSlotCount(state) || wasWaitingForSummary)) {
      const msg = (req.body && req.body.message) || "";
      if (msg && history.length > 0 && history[history.length - 1]?.role !== "user") {
        history.push({ role: "user", content: msg });
      }
      const level = state.decisionLevel || finalizeRiskLevel(state);
      const localFallback = await buildLocalSummaryFallback(level, history, state);
      const fallbackSummary = await enforceSummaryStructureStrict(
        localFallback,
        level,
        history,
        state
      );
      const triage = {
        judgement: level,
        confidence: state.confidence || 0,
        ratio: state.decisionRatio ?? null,
        shouldJudge: true,
      };
      const triage_state = buildTriageState(true, level, filled);
      const sections = extractSectionsBySpecs(
        fallbackSummary,
        getSummarySectionSpecsByJudgement(level)
      ).map((entry) => entry.text);
      if (state) {
        state.decisionLevel = level;
        markSummaryDeliveredAndFollowUpPhase(state);
        state.summaryText = fallbackSummary;
        if (history.length > 0) history.push({ role: "assistant", content: fallbackSummary });
      }
      const fallbackFq = getInitialFollowUpQuestionBySpec(state || { decisionLevel: level });
      return res.status(200).json({
        conversationId: cid,
        message: fallbackSummary,
        response: fallbackSummary,
        triage,
        triage_state,
        sections,
        questionPayload: null,
        normalizedAnswer: state?.lastNormalizedAnswer || null,
        followUpQuestion: shouldSendFollowUpQuestion(sections) ? fallbackFq : null,
        followUpMessage: null,
        judgeMeta: {
          judgement: level,
          confidence: state.confidence || 0,
          ratio: state.decisionRatio ?? null,
          shouldJudge: true,
          slotsFilledCount: filled,
          decisionAllowed: true,
          questionCount: state.questionCount || 0,
          summaryLine: extractSummaryLine(fallbackSummary),
          questionType: null,
          rawScore: state.lastPainScore ?? null,
          painScoreRatio: state.lastPainWeight ?? null,
        },
      });
    }
    const safeMessage = "少し情報が足りないかもしれませんが、今わかる範囲で一緒に整理しますね。";
    const errFilled = cid && state ? countFilledSlots(state.slotFilled, state) : 0;
    return res.status(200).json({
      conversationId: cid,
      message: safeMessage,
      response: safeMessage,
      triage_state: buildTriageState(false, null, errFilled),
      judgeMeta: {
        judgement: "🟡",
        confidence: 0,
        ratio: null,
        shouldJudge: false,
        slotsFilledCount: 0,
        decisionAllowed: false,
        questionCount: 0,
        summaryLine: null,
        questionType: null,
        rawScore: null,
        painScoreRatio: null,
      },
      questionPayload: null,
      normalizedAnswer: null,
    });
  }
});

app.post("/api/state-patterns", async (req, res) => {
  try {
    const { conversationId, summaryFacts, summarySection } = req.body || {};
    const state = conversationId ? getOrInitConversationState(conversationId) : initConversationState();
    const { message, structured, triageLevel, query, queryJP, queryEN, sourceNames } =
      await buildConcreteStateDetailsFromSearch(
        state,
        Array.isArray(summaryFacts) ? summaryFacts : [],
        summarySection || ""
      );
    state.lastConcreteDetailsText = message;
    state.lastConcreteQueryJP = queryJP || null;
    state.lastConcreteQueryEN = queryEN || null;
    const basePayload = {
      message,
      structured: structured || undefined,
      triageLevel: triageLevel || undefined,
      sourcePolicy: [
        "公的機関",
        "大学病院",
        "国際医療機関",
        "大手医療情報サイト",
      ],
    };
    if (IS_DEBUG) {
      return res.status(200).json({
        ...basePayload,
        query,
        queryJP,
        queryEN,
        sourceNames,
      });
    }
    return res.status(200).json(basePayload);
  } catch (error) {
    console.error("state-patterns error:", error);
    return res.status(200).json({
      message: [
        "今の状態は、次のようなパターンと似ています。",
        "",
        "■ 現在の症状経過に近いパターン",
        "症状の強さと経過時間をあわせて見ると、今の状態を理解しやすくなります。",
        "強さが上がるか、同じ強さのまま続くかが、次の判断ポイントです。",
        "新しい症状が加わらないかを、短い間隔で確認していくのが安全です。",
        "",
        "現時点の安心材料",
        "・強い緊急サインが直ちに重なっている情報は今のところ見えていません",
        "",
        "こんな変化があれば受診を検討",
        "・痛みやつらさが短時間で強まる",
        "・新しい強い症状が加わる",
        "・数時間たっても改善の動きが見えない",
      ].join("\n"),
      sourcePolicy: [],
    });
  }
});

app.post("/api/action-details", async (req, res) => {
  try {
    const { conversationId, actionSection } = req.body || {};
    const state = conversationId ? getOrInitConversationState(conversationId) : initConversationState();
    const historyText = (conversationHistory[conversationId] || [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    if (state?.decisionLevel === "🔴") {
      let research = null;
      try {
        research = await buildImmediateActionHypothesisPlan(
          state,
          historyText,
          state?.summaryText || actionSection || ""
        );
      } catch (e) {
        console.error("[RedModal research]", e?.message || e);
      }
      const message = buildRedModalContent(state, historyText, research);
      return res.status(200).json({
        message,
        sourcePolicy: [
          "公的機関",
          "大学病院",
          "国際医療機関",
          "大手医療情報サイト",
        ],
      });
    }
    const { message, query, sourceNames } = await buildConcreteImmediateActionsDetails(
      state,
      actionSection || ""
    );
    const basePayload = {
      message,
      sourcePolicy: [
        "公的機関",
        "大学病院",
        "国際医療機関",
        "大手医療情報サイト",
      ],
    };
    if (IS_DEBUG) {
      return res.status(200).json({
        ...basePayload,
        query,
        sourceNames,
      });
    }
    return res.status(200).json(basePayload);
  } catch (error) {
    console.error("action-details error:", error);
    const cid = (req.body && req.body.conversationId) || null;
    const retryState = cid ? getOrInitConversationState(cid) : initConversationState();
    const retryHistory = (cid && conversationHistory[cid]) || [];
    const retryHistoryText = retryHistory
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    if (retryState?.decisionLevel === "🔴") {
      let research = null;
      for (let i = 0; i < 10; i++) {
        try {
          research = await buildImmediateActionHypothesisPlan(
            retryState,
            retryHistoryText,
            retryState?.summaryText || ""
          );
          break;
        } catch (_) {}
      }
      return res.status(200).json({
        message: buildRedModalContent(retryState, retryHistoryText, research),
        sourcePolicy: [],
      });
    }
    for (let attempt = 0; attempt < LLM_RETRY_COUNT; attempt++) {
      try {
        const { message } = await buildConcreteImmediateActionsDetails(
          retryState,
          (req.body && req.body.actionSection) || ""
        );
        return res.status(200).json({
          message,
          sourcePolicy: ["公的機関", "大学病院", "国際医療機関", "大手医療情報サイト"],
        });
      } catch (retryErr) {
        if (attempt >= LLM_RETRY_COUNT - 1) {
          const mainSymptom = retryState?.primarySymptom || "症状";
          let llmMsg = null;
          for (let i = 0; i < 5; i++) {
            try {
              const c = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content: `主症状「${mainSymptom}」に合わせて、今すぐやること2件とやらないほうがいいこと1件を、それぞれ「・」と「→」形式で生成。見出しは「■今すぐやること」「■やらないほうがいいこと」。`,
                  },
                  { role: "user", content: retryHistoryText || "症状の状態を確認しました。" },
                ],
                temperature: 0.3,
                max_tokens: 400,
              });
              const body = (c?.choices?.[0]?.message?.content || "").trim();
              if (body && body.length > 20) {
                llmMsg = `${buildYellowPsychologicalCushionLine()}\n\n${body}`;
                break;
              }
            } catch (_) {}
          }
          return res.status(200).json({
            message: llmMsg || "読み込みに失敗しました。しばらくしてからもう一度お試しください。",
            sourcePolicy: [],
          });
        }
      }
    }
    return res.status(200).json({
      message: "読み込みに失敗しました。しばらくしてからもう一度お試しください。",
      sourcePolicy: [],
    });
  }
});

app.post("/api/hospital-details", async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    const state = conversationId ? getOrInitConversationState(conversationId) : initConversationState();
    const message = await buildHospitalDetailsModalContent(state);
    return res.status(200).json({ message });
  } catch (error) {
    console.error("hospital-details error:", error);
    const cid = (req.body && req.body.conversationId) || null;
    const fallbackState = cid ? getOrInitConversationState(cid) : null;
    const fallbackMsg =
      fallbackState && fallbackState.decisionLevel === "🔴"
        ? "受診先の詳細を取得できませんでした。近くの医療機関を検索してご確認ください。"
        : "受診先の詳細を取得できませんでした。";
    return res.status(200).json({ message: fallbackMsg });
  }
});

function getSummarySectionSpecsByJudgement(judgement) {
  if (judgement === "🔴") {
    return [
      { id: 1, title: "📝 今の状態について", patterns: [/^📝\s*今の状態について/, /^📝\s*いまの状態を整理します（メモ）/, /^📝\s*いまの状態を整理します/] },
      { id: 2, title: "✅ 今すぐやること", patterns: [/^✅\s*今すぐやること（これだけでOK）/, /^✅\s*今すぐやること/] },
      { id: 3, title: "🏥 受診先の候補", patterns: [/^🏥\s*受診先の候補/, /^🏥\s*Kairoの判断/] },
      { id: 4, title: "💬 最後に", patterns: [/^💬\s*最後に/] },
    ];
  }
  if (judgement === "🟡") {
    return [
      { id: 1, title: "🟢 ここまでの情報を整理します", patterns: [/^🟢\s*ここまでの情報を整理します/] },
      { id: 2, title: "🤝 今の状態について", patterns: [/^🤝\s*今の状態について/] },
      { id: 3, title: "✅ 今すぐやること", patterns: [/^✅\s*今すぐやること（これだけでOK）/, /^✅\s*今すぐやること/] },
      { id: 4, title: "⏳ 今後の見通し", patterns: [/^⏳\s*今後の見通し/, /^⏳\s*この先の見通し/] },
      { id: 5, title: "🌱 最後に", patterns: [/^🌱\s*最後に/] },
    ];
  }
  return [
    { id: 1, title: "🟢 ここまでの情報を整理します", patterns: [/^🟢\s*ここまでの情報を整理します/] },
    { id: 2, title: "🤝 今の状態について", patterns: [/^🤝\s*今の状態について/] },
    { id: 3, title: "✅ 今すぐやること", patterns: [/^✅\s*今すぐやること（これだけでOK）/, /^✅\s*今すぐやること/] },
    { id: 4, title: "⏳ 今後の見通し", patterns: [/^⏳\s*今後の見通し/, /^⏳\s*この先の見通し/] },
    { id: 5, title: "🌱 最後に", patterns: [/^🌱\s*最後に/] },
  ];
}

/** フォロー文を送る条件: 最後のセクションが「最後に」の絵文字（🌱 or 💬）で始まる時のみ。エンコーディング耐性のためUnicode正規化とコードポイントで判定 */
function shouldSendFollowUpQuestion(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return false;
  const lastSection = sections[sections.length - 1];
  const normalized = String(lastSection || "").normalize("NFC").trim();
  const firstLine = normalized.split("\n")[0] || "";
  return /^[\u{1F331}\u{1F4AC}]\s*最後に/u.test(firstLine) || /^[🌱💬]\s*最後に/.test(firstLine);
}

function extractSectionsBySpecs(text, specs) {
  if (!text || !Array.isArray(specs) || specs.length === 0) return [];
  const buckets = specs.map(() => []);
  const findSpecIndex = (line) => {
    const trimmed = (line || "").trim();
    return specs.findIndex((spec) =>
      spec.patterns.some((pattern) => pattern.test(trimmed))
    );
  };
  let currentIndex = -1;
  for (const line of text.split("\n")) {
    const specIndex = findSpecIndex(line);
    if (specIndex !== -1) {
      currentIndex = specIndex;
      buckets[specIndex].push(line);
      continue;
    }
    if (currentIndex !== -1) {
      buckets[currentIndex].push(line);
    }
  }
  return specs
    .map((spec, idx) => ({
      id: spec.id,
      text: buckets[idx].join("\n").trim(),
    }))
    .filter((section) => section.text.length > 0);
}

// Clear conversation history（はじめから・再検索時に完全リセット）
app.post("/api/clear", (req, res) => {
  const { conversationId } = req.body || {};
  if (conversationId && typeof conversationId === "string") {
    delete conversationHistory[conversationId];
    delete conversationState[conversationId];
  }
  res.json({ success: true });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  res.json({
    status: "ok",
    hasApiKey: !!process.env.OPENAI_API_KEY,
    hasPlacesApiKey: !!placesKey,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kairo server is running on port ${PORT}`);
  console.log(
    process.env.OPENAI_API_KEY
      ? "✓ OpenAI API key is configured"
      : "⚠ OpenAI API key is not configured. Please set OPENAI_API_KEY in .env file"
  );
  const placesKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  console.log(
    placesKey
      ? "✓ Google Places API key is configured"
      : "⚠ Google Places API key is not configured. Set GOOGLE_PLACES_API_KEY in .env for facility search"
  );
});
