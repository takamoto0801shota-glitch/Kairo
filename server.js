console.log("🚀 Kairo server version: 2026-01-27-A");
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_DEBUG = false;

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
- 「あなたの不安と体調を一番に、一緒に考えます」というメッセージは、会話中には絶対に表示しない
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
  
【まとめブロックの完全性 - 最重要】
- **まとめは必ず「全ブロック」を出す。途中の1ブロックだけを出すのは禁止。**
- **（A）の場合は 📝→✅→🏥→💬 の4ブロックを必ず全部出す。**
- **（B）の場合は 🟢→🤝→✅→⏳→🚨→🌱 の6ブロックを必ず全部出す。**
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
  1) pain_score が高（8以上）かつ daily_impact が高
  2) pain_score が高（8以上）かつ associated_symptoms が中以上
  3) daily_impact が高かつ associated_symptoms が中以上
  4) criticalスロット（pain_score / daily_impact / associated_symptoms）のうち、高レベル（最大weight=3）が2つ以上
  5) criticalスロット（pain_score / daily_impact / associated_symptoms）のうち、高レベルが1つだけの場合は🟡固定
- Phase2（重症指数）：
  - 低=0 / 中=1 / 高=3
  - pain_score ×1.4
  - daily_impact ×1.0
  - associated_symptoms ×1.0
  - onset（発症タイミング）×1.0
  - quality（痛みの質）×1.0
  - cause（原因カテゴリ）×0.8
  - severityIndex = weightedTotal / 18.6
- 判定基準：
  - 0.65以上 → 🔴
  - 0.4〜0.64 → 🟡
  - 0.4未満 → 🟢
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
    hasSummaryBlockGenerated: false,
    decisionType: null,
    decisionLevel: null,
    decisionRatio: null,
    triageCategory: null,
    followUpPhase: "idle",
    followUpStep: 0,
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
  };
}

function buildRepairPrompt(requiredLevel) {
  return `
あなたはKairoです。以下の会話内容を踏まえ、最後に出すべき「まとめブロック」を**必ず全ブロック**で出力してください。

要件：
- 出力はまとめブロックのみ（質問や追加の会話はしない）
- ブロック構成は必ずフルセット
  - 様子見/市販薬の場合：🟢→🤝→✅→⏳→🚨→🌱 の6ブロック
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

function enforceSummaryStructureStrict(text, level, history, state) {
  const normalizedText = normalizeHospitalMemoHeaderText(text);
  const headers = getRequiredSummaryHeadersByLevel(level);
  const cleaned = removeForbiddenSummaryBlocks(normalizedText, headers);
  const blocks = splitByKnownHeaders(cleaned, headers);
  const hasAll = headers.every((h) => blocks.has(h));
  const hasEmergencyBlock = String(cleaned || "").includes("🚨");
  if (!hasAll || hasEmergencyBlock) {
    return buildLocalSummaryFallback(level, history, state);
  }
  // 強制的に仕様順へ再構成（順序ゆらぎを排除）
  return headers.map((h) => blocks.get(h)).join("\n\n").trim();
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

function ensureGreenHeaderForYellow(text, requiredLevel) {
  if (!text) return text;
  if (requiredLevel !== "🟡") return text;
  if (text.includes("🟢 ここまでの情報を整理します")) return text;
  if (text.includes("🟡 ここまでの情報を整理します")) {
    return text.replace("🟡 ここまでの情報を整理します", "🟢 ここまでの情報を整理します");
  }
  return `🟢 ここまでの情報を整理します\n${text}`;
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
  return (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

async function fetchNearbyPlaces(location, { keyword, type, radius = 1000, rankByDistance = false }) {
  const key = getPlacesApiKey();
  if (!key) return [];
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
  if (!res.ok) return [];
  const data = await res.json();
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
  if (!res.ok) return [];
  const data = await res.json();
  return normalizePlaces(data.results || [], location);
}

async function fetchPlaceDetails(placeId) {
  if (!getPlacesApiKey()) return null;
  if (!placeId) return null;
  const params = new URLSearchParams({
    place_id: placeId,
    key: getPlacesApiKey(),
    language: "en",
    fields: "place_id,name,rating,reviews,types,url,user_ratings_total,editorial_summary",
  });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.result;
  if (!result) return null;
  return {
    rating: typeof result?.rating === "number" ? result.rating : null,
    userRatingsTotal:
      typeof result?.user_ratings_total === "number" ? result.user_ratings_total : null,
    types: Array.isArray(result?.types) ? result.types : [],
    mapUrl: typeof result?.url === "string" ? result.url : "",
    editorialSummary: result?.editorial_summary?.overview || "",
    reviewTexts: Array.isArray(result?.reviews)
      ? result.reviews.map((r) => String(r?.text || "").trim()).filter(Boolean)
      : [],
  };
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

async function fetchCarePlacesWithFallbacks(location, plan, state) {
  const types = ["doctor", "hospital"];
  const keywords = plan?.searchKeywords || ["clinic", "general practitioner", "medical clinic"];
  const results = [];
  for (const type of types) {
    for (const keyword of keywords) {
      const places = await fetchNearbyPlaces(location, { keyword, type, radius: 3000 });
      results.push(...places);
    }
  }
  if (results.length === 0) {
    for (const type of types) {
      const fallback = await fetchNearbyPlaces(location, { type, radius: 3000 });
      results.push(...fallback);
    }
  }
  if (results.length === 0) {
    for (const type of types) {
      const rankBy = await fetchNearbyPlaces(location, { type, rankByDistance: true });
      results.push(...rankBy);
    }
  }
  if (results.length === 0) {
    const textQueries = ["clinic", "hospital", "doctor", "medical clinic", "GP"];
    for (const q of textQueries) {
      const textResults = await fetchPlacesByTextSearch(location, q, { type: "doctor", radius: 5000 });
      results.push(...textResults);
      if (results.length >= 4) break;
    }
  }
  if (results.length === 0) {
    const wider = await fetchPlacesByTextSearch(location, "clinic hospital", { radius: 10000 });
    results.push(...wider);
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

function prioritizeCareCandidates(candidates, state) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  const country = String(state?.locationContext?.country || "").toLowerCase();
  if (country.includes("singapore")) {
    return list.sort((a, b) => {
      const p = scoreSingaporePreference(b) - scoreSingaporePreference(a);
      if (p !== 0) return p;
      return sortPlacesByRatingThenDistance([a, b])[0] === a ? -1 : 1;
    });
  }
  return sortPlacesByRatingThenDistance(list);
}

function formatDistanceForCare(distanceM) {
  if (!Number.isFinite(distanceM)) return "不明";
  if (distanceM < 1000) return `約${distanceM}m`;
  return `約${(distanceM / 1000).toFixed(1)}km`;
}

function buildHospitalRecommendationReasons(candidate, plan) {
  const reasons = [];
  const infoText = [candidate?.name || "", candidate?.vicinity || "", ...(candidate?.types || [])].join(" ");
  if (plan?.symptomLabel) {
    reasons.push(`・${plan.symptomLabel}の初期相談に対応しやすい施設タイプです`);
  }
  if (/(japanese|日本語|日系)/i.test(infoText)) {
    reasons.push("・日本語対応に関する記載があり、相談時の負担を下げやすい候補です");
  }
  if (Number.isFinite(candidate?.rating)) {
    const count = Number.isFinite(candidate?.userRatingsTotal) ? `（${candidate.userRatingsTotal}件）` : "";
    reasons.push(`・Google評価は ${candidate.rating.toFixed(1)} ${count} で、利用者評価が確認できます`);
  }
  return reasons.slice(0, 3);
}

function buildCareReviewSummary(candidate, plan) {
  const details = candidate?.details;
  const snippets = Array.isArray(details?.reviewTexts) ? details.reviewTexts.slice(0, 8) : [];
  if (snippets.length === 0) {
    return [
      `${plan?.symptomLabel || "現在の症状"}の初期相談先として、立地・診療領域・評価の整合で選定しています。`,
    ];
  }
  const joined = snippets.join(" ").toLowerCase();
  const points = [];
  if (/(腹痛|gastro|digestive|消化器|stomach|abdominal)/.test(joined)) {
    points.push(`${plan?.symptomLabel || "症状"}に関連する相談への対応が丁寧という記載`);
  }
  if (/(explain|説明|丁寧|わかりやすい|careful)/.test(joined)) {
    points.push("説明が丁寧で相談しやすいという声");
  }
  if (/(wait|待ち|quick|fast|smooth)/.test(joined)) {
    points.push("待ち時間や案内が比較的スムーズという声");
  }
  if (/(friendly|親切|kind|staff)/.test(joined)) {
    points.push("スタッフ対応が親切という声");
  }
  if (points.length === 0) {
    points.push("初期相談で利用しやすいという声");
  }
  return points.slice(0, 3).map((p) => `・${p}`);
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

async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_GEOCODE_API_KEY || getPlacesApiKey();
  if (!apiKey || !address) return null;
  const params = new URLSearchParams({
    address: String(address).trim(),
    key: apiKey,
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
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
  const keywords = ["clinic", "general practitioner", "medical clinic"];
  const results = [];
  for (const keyword of keywords) {
    const places = await fetchNearbyPlaces(state.locationSnapshot, {
      keyword,
      type: "doctor",
      rankByDistance: true,
    });
    results.push(...places);
  }
  if (results.length === 0) {
    const fallback = await fetchNearbyPlaces(state.locationSnapshot, {
      type: "doctor",
      rankByDistance: true,
    });
    results.push(...fallback);
  }
  const merged = sortPlacesByRatingThenDistance(mergePlaces(results)).slice(0, 2);
  if (merged.length > 0) return merged;
  const country = state?.locationContext?.country || "Japan";
  const fallbackNames = FALLBACK_GP_BY_COUNTRY[country] || FALLBACK_GP_BY_COUNTRY.Japan;
  return buildFallbackPlaces(fallbackNames, state?.location);
}

async function resolveHospitalCandidates(state) {
  let location = state?.locationSnapshot;
  if (!location?.lat || !location?.lng) {
    const ctx = state?.locationContext || {};
    const addr = [ctx.city || ctx.area, ctx.country].filter(Boolean).join(", ") || ctx.country || "Singapore";
    if (addr) {
      const geo = await geocodeAddress(addr);
      if (geo) location = geo;
    }
  }
  if (!location?.lat || !location?.lng) return [];
  const results = [];
  for (const keyword of ["hospital", "medical centre", "emergency"]) {
    const places = await fetchNearbyPlaces(location, {
      keyword,
      type: "hospital",
      rankByDistance: true,
    });
    results.push(...places);
  }
  if (results.length === 0) {
    const fallback = await fetchNearbyPlaces(location, {
      type: "hospital",
      rankByDistance: true,
    });
    results.push(...fallback);
  }
  if (results.length === 0) {
    const textResults = await fetchPlacesByTextSearch(
      location,
      "hospital medical centre",
      { type: "hospital", radius: 5000 }
    );
    results.push(...textResults);
  }
  return sortPlacesByRatingThenDistance(mergePlaces(results)).slice(0, 2);
}

async function resolvePharmacyCandidates(state) {
  if (!canRecommendSpecificPlaceFinal(state)) return [];
  if (!state?.locationSnapshot?.lat || !state?.locationSnapshot?.lng) return [];
  const keywords = ["pharmacy", "Watsons", "Guardian"];
  const results = [];
  for (const keyword of keywords) {
    const places = await fetchNearbyPlaces(state.locationSnapshot, {
      keyword,
      type: "pharmacy",
      rankByDistance: true,
    });
    results.push(...places);
  }
  if (results.length === 0) {
    const fallback = await fetchNearbyPlaces(state.locationSnapshot, {
      type: "pharmacy",
      rankByDistance: true,
    });
    results.push(...fallback);
  }
  return sortPlacesByRatingThenDistance(mergePlaces(results)).slice(0, 2);
}

const FALLBACK_PHARMACY_BY_COUNTRY = {
  Japan: ["マツモトキヨシ 新宿東口店", "ツルハドラッグ すすきの店", "スギ薬局 名駅店"],
  Singapore: ["Guardian Pharmacy (Raffles City)", "Watsons (ION Orchard)", "Unity Pharmacy (Bugis Junction)"],
};

const FALLBACK_HOSPITAL_BY_COUNTRY = {
  Japan: [
    { name: "聖路加国際病院", type: "General Hospital" },
    { name: "日本赤十字社医療センター", type: "General Hospital" },
  ],
  Singapore: [
    { name: "Raffles Hospital", type: "General Hospital" },
    { name: "Mount Elizabeth Hospital", type: "General Hospital" },
  ],
};

const FALLBACK_GP_BY_COUNTRY = {
  // 実在候補（検索不能時の最終フォールバック）
  Japan: ["新宿南口内科クリニック", "ゆうメンタルクリニック新宿院"],
  Singapore: ["Raffles Medical", "Fullerton Health", "Healthway Medical"],
};

const FALLBACK_ENT_BY_COUNTRY = {
  Japan: ["東京医科大学病院（耳鼻咽喉科）", "日本赤十字社医療センター（耳鼻咽喉科）"],
  Singapore: ["Mount Elizabeth Hospital (ENT)", "Gleneagles Hospital (ENT)"],
};

function pickFallbackByLocation(list, locationContext) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (!locationContext?.city) return list[0];
  const matched = list.find((item) => String(item).includes(locationContext.city));
  return matched || list[0];
}

function buildFallbackPlaces(names, location) {
  return (names || [])
    .map((name) => ({
      name,
      placeId: "",
      distanceM: null,
      mapsUrl: buildMapsUrl({ name }, location),
    }))
    .slice(0, 3);
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
  const fallbackList = FALLBACK_PHARMACY_BY_COUNTRY.Japan.map((entry) => entry.split(" ")[0]);
  const fallbackCandidates = buildFallbackPlaces(fallbackList, state?.locationSnapshot);
  const name = fallbackCandidates[0]?.name || "近くの薬局";
  return {
    name,
    mapsUrl: fallbackCandidates[0]?.mapsUrl || "",
    candidates: fallbackCandidates,
    reason: "近くで行きやすい場所を案内します。",
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
  const merged = mergePlaces(
    Array.isArray(clinicCandidates) ? clinicCandidates : [],
    Array.isArray(hospitalCandidates) ? hospitalCandidates : []
  );
  const candidates = prioritizeCareCandidates(applySymptomFitFilter(merged, plan), state).slice(0, 2);
  const useHospital = (hospitalCandidates?.length || 0) > 0;
  if (canRecommendSpecificPlaceFinal(state) && candidates.length) {
    return {
      name: candidates[0].name,
      mapsUrl: candidates[0].mapsUrl,
      candidates,
      type: useHospital ? "Hospital" : "Clinic",
      reason: `${plan?.symptomLabel || "現在の症状"}に合う候補を、位置情報ベースで整理しています。`,
      preface: "近くで行きやすい場所を案内します。",
    };
  }
  const country = String(locationContext?.country || "Japan");
  const fallbackList = (() => {
    if (destination?.label === "耳鼻科") {
      return FALLBACK_ENT_BY_COUNTRY[country] || FALLBACK_ENT_BY_COUNTRY.Japan;
    }
    if (destination?.label === "GP") {
      return FALLBACK_GP_BY_COUNTRY[country] || FALLBACK_GP_BY_COUNTRY.Japan;
    }
    return (FALLBACK_HOSPITAL_BY_COUNTRY[country] || FALLBACK_HOSPITAL_BY_COUNTRY.Japan || []).map((item) =>
      typeof item === "string" ? item : item.name
    );
  })();
  const fallbackCandidates = buildFallbackPlaces(fallbackList, state?.locationSnapshot);
  return {
    name: fallbackCandidates[0]?.name || "Raffles Medical",
    mapsUrl: fallbackCandidates[0]?.mapsUrl || "",
    candidates: fallbackCandidates,
    type: destination?.label === "GP" ? "Clinic" : "General Hospital",
    reason: `${plan?.symptomLabel || "現在の症状"}に対応可能な実在候補をフォールバック表示しています。`,
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
      header: "⭐ おすすめの歯医者（近くて行きやすい）",
      places: { type: "dentist", keywords: ["dentist", "dental clinic"] },
      fallbackNames: ["近くの歯科クリニック", "近くの歯医者"],
    };
  }
  if (text.match(/耳|耳鳴り|耳が痛|のど|喉|鼻|鼻水|鼻づまり/)) {
    return {
      label: "耳鼻科",
      header: "⭐ おすすめの耳鼻科（近くて行きやすい）",
      places: { type: "doctor", keywords: ["ENT", "ENT clinic", "otolaryngologist"] },
      fallbackNames: ["近くの耳鼻科", "近くのクリニック（耳鼻科）"],
    };
  }
  // default
  return {
    label: "GP",
    header: "⭐ おすすめのGP（近くて行きやすい）",
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
    const addr = [city, country].filter(Boolean).join(", ") || country || "Singapore";
    if (addr) {
      const geo = await geocodeAddress(addr);
      if (geo) location = geo;
    }
  }
  if (!location?.lat || !location?.lng) return [];
  const historyText = state?.historyTextForCare || "";
  const mainSymptomText = detectCareMainSymptomText(state, historyText);
  const plan = buildCareSearchQueries(mainSymptomText, destination);
  const results = await fetchCarePlacesWithFallbacks(location, plan, state);
  const mergedBase = mergePlaces(results);
  const symptomFitted = applySymptomFitFilter(mergedBase, plan);
  const merged = prioritizeCareCandidates(symptomFitted, state).slice(0, 6);
  const enriched = [];
  for (const item of merged) {
    const details = await fetchPlaceDetails(item.placeId);
    enriched.push({
      ...item,
      details,
      rating: details?.rating ?? item.rating,
      userRatingsTotal: details?.userRatingsTotal ?? item.userRatingsTotal,
      types: details?.types?.length ? details.types : item.types,
      mapsUrl: details?.mapUrl || item.mapsUrl,
    });
  }
  const finalList = enriched.length ? enriched.slice(0, 2) : merged.slice(0, 2);
  if (finalList.length > 0) return finalList;
  const names = destination?.fallbackNames;
  if (Array.isArray(names) && names.length > 0) {
    return buildFallbackPlaces(names, location || state?.locationSnapshot);
  }
  const country = String(state?.locationContext?.country || "Japan");
  const gpFallback =
    (FALLBACK_GP_BY_COUNTRY[country] && FALLBACK_GP_BY_COUNTRY[country].length > 0)
      ? FALLBACK_GP_BY_COUNTRY[country]
      : FALLBACK_GP_BY_COUNTRY.Japan;
  return buildFallbackPlaces(gpFallback.slice(0, 2), location || state?.locationSnapshot);
}

function buildHospitalBlock(state, historyText, hospitalRec) {
  const destination = detectCareDestinationFromHistory(historyText || "");
  const category = resolveQuestionCategoryFromState(state);
  const rawCandidates = Array.isArray(hospitalRec?.candidates) ? hospitalRec.candidates : [];
  const mainSymptomText = detectCareMainSymptomText(state, historyText || "");
  const plan = buildCareSearchQueries(mainSymptomText, destination);
  const fallbackNamesByCountry =
    destination.label === "耳鼻科"
      ? FALLBACK_ENT_BY_COUNTRY
      : destination.label === "GP"
        ? FALLBACK_GP_BY_COUNTRY
        : null;
  const country = String(state?.locationContext?.country || "Japan");
  const fallbackNamePool = fallbackNamesByCountry
    ? (fallbackNamesByCountry[country] || fallbackNamesByCountry.Japan || [])
    : [];
  const candidates = rawCandidates
    .map((c, idx) => {
      const name = String(c?.name || "").trim();
      const isGeneric = /^近くの/.test(name) || name === "近くの医療機関" || name === "近くのクリニック";
      const fallbackName = fallbackNamePool[idx] || fallbackNamePool[0] || name;
      return {
        ...c,
        name: isGeneric ? fallbackName : name,
      };
    })
    .filter((c) => String(c?.name || "").trim().length > 0)
    .filter((c, idx, arr) => arr.findIndex((x) => String(x.name).trim() === String(c.name).trim()) === idx)
    .slice(0, 2);
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
  const lines = [
    "🏥 受診先の候補",
    timeMessage,
    "",
    "⸻",
    "",
    destination.header,
  ].filter(Boolean);

  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length > 0) {
    list.forEach((c, idx) => {
      const normalizedName = String(c?.name || "").trim();
      lines.push("");
      lines.push(`・候補${idx + 1}: ${normalizedName}`);
      lines.push("  推薦理由：");
      const reasons = buildHospitalRecommendationReasons(c, plan);
      if (reasons.length > 0) {
        reasons.slice(0, 3).forEach((r) => lines.push(`  ${r}`));
      } else {
        lines.push("  ・現在地から行きやすく、初期相談先として使いやすい候補です");
      }
    });
  } else {
    lines.push("近くで受診しやすい実在医療機関を優先して案内します。");
  }
  lines.push("");
  // 仕様: INFECTION ではオンライン診療案内を表示しない（強制）
  if (category !== "INFECTION") {
    lines.push("もし、外出がつらい場合は、オンライン診療という方法もあります。");
    lines.push("今の症状であればオンラインでの初期相談は可能です。");
    lines.push("Doctor Anywhere / WhiteCoat");
    lines.push("オンラインでもMCは発行されます。");
  }
  return lines.join("\n");
}

const RED_GP_JUDGMENT_SENTENCES = [
  "今の症状の出方をふまえると、念のため医療機関で確認しておくと安心できる状態です。",
  "現在の症状からは、自己判断で様子を見るよりも、一度医療機関で確認しておく方が安心できそうです。",
];

function buildHospitalConcernPoint(historyText) {
  return RED_GP_JUDGMENT_SENTENCES[Math.floor(Math.random() * RED_GP_JUDGMENT_SENTENCES.length)];
}

function buildRedCushionLine(historyText) {
  return RED_GP_JUDGMENT_SENTENCES[Math.floor(Math.random() * RED_GP_JUDGMENT_SENTENCES.length)];
}

function buildRedImmediateActionsFallback() {
  // 1件目ですでに受診を推奨しているため、2件目以降では受診を勧める内容を含めない
  return [
    {
      title: "水分をこまめに取り、無理をしないでください",
      reason: "体の負担を減らすことが、次の判断の土台になります。",
    },
    {
      title: "安静にして、刺激を減らして過ごしてください",
      reason: "体を回復モードに入れることで、変化が読み取りやすくなります。",
    },
  ];
}

const RED_MODAL_CLOSING_LINE =
  "今動いていること自体が、安全に近づく行動です。今は慌てる段階ではありません。ひとつずつ確認していけば大丈夫です。";

function buildRedModalContent(state, historyText = "") {
  const cushion = buildRedCushionLine(historyText);
  const fallbackActions = buildRedImmediateActionsFallback();
  const safeWaitItems = fallbackActions.slice(0, 2).flatMap((a) => [
    `・${a.title}`,
    `→ ${a.reason}`,
  ]);
  const parts = [
    cushion,
    "",
    "① 今すぐやること（受診優先）",
    "・本日中に医療機関へ連絡する",
    "→ 早い段階で確認することで、重大な問題でないことが分かるケースも多くあります。",
    "",
    "② 受診までの過ごし方（安全待機モード）",
    ...safeWaitItems,
    "",
    RED_MODAL_CLOSING_LINE,
  ];
  if (shouldAppendMcLinesToModal(state)) {
    parts.push("", ...MC_4_LINES);
  }
  return parts.join("\n");
}

function buildRedImmediateActionsBlock(state, historyText) {
  const cushion = buildRedCushionLine(historyText);
  const fixedFirst = [
    "・本日中に医療機関へ連絡する",
    "→ 早い段階で確認することで、重大な問題でないことが分かるケースも多くあります。",
  ];
  const fallbackActions = buildRedImmediateActionsFallback();
  const extra = fallbackActions.slice(0, 2).flatMap((a) => [
    `・${a.title}`,
    `→ ${a.reason}`,
  ]);
  return [
    "✅ 今すぐやること",
    cushion,
    "",
    ...fixedFirst,
    "",
    ...extra,
  ].join("\n");
}

function ensureHospitalMemoBlock(text, state, historyText = "") {
  if (!text) return text;
  const judgment = buildHospitalConcernPoint(historyText);
  const memoLines = [
    "📝 今の状態について",
    ...buildStateFactsBullets(state),
    "",
    judgment,
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

function ensureRedImmediateActionsBlock(text, state, historyText = "") {
  if (!text) return text;
  const block = buildRedImmediateActionsBlock(state, historyText);
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
  if (startIndex === -1) return text;
  const nextIndex = lines.findIndex((line, idx) => {
    if (idx <= startIndex) return false;
    return /^(🟢|🟡|🤝|✅|⏳|🚨|💊|🌱|📝|⚠️|🏥|💬|🧾)\s/.test(line);
  });
  const endIndex = nextIndex === -1 ? lines.length : nextIndex;
  const updated = [
    ...lines.slice(0, startIndex),
    ...block.split("\n"),
    ...lines.slice(endIndex),
  ];
  return updated.join("\n");
}

function ensureOutlookBlock(text, state) {
  return replaceSummaryBlock(text, "⏳ 今後の見通し", buildOutlookBlock(state));
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
  const firstSentence = raw.split(/[。!?！？]/)[0].trim();
  const compact = (firstSentence || raw).replace(/\s{2,}/g, " ");
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

function ensureReliableReason(reason, evidence = {}) {
  const raw = String(reason || "").trim();
  const sanitized = stripSearchTraceFromReason(raw);
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

function buildSecondaryImmediateFallbackAction() {
  return {
    title: "強い刺激を避けて、体調の変化を短時間で確認するといいです",
    reason: "刺激負荷を減らすと、症状の推移を見極めやすくなるためです。",
    isOtc: false,
  };
}

function ensureActionCount(actions = [], targetCount = 2, context = {}, evidence = {}) {
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
        title: "刺激を1つ減らして静かな環境で過ごし、4〜6時間の変化を見てください",
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
    supplements.push(
      buildSafeImmediateFallbackAction(),
      buildSecondaryImmediateFallbackAction(),
      {
        title: "刺激を1つ減らして静かな環境で過ごし、4〜6時間の変化を見てください",
        reason: "負荷を分散すると、症状の推移を判断しやすくなります。",
        isOtc: false,
      }
    );
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

function ensureMinimumDoActions(actions = [], minCount = 3, context = {}, evidence = {}) {
  const out = ensureActionCount(actions, minCount, context, evidence);
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

/** ③ 予想経過（安心設計） */
function buildExpectedCourse(context = {}) {
  const templates = [
    "多くの場合、数時間〜1日程度で徐々に落ち着いていくことが多いです。",
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

/** ④ 締めの一文（心理的アンカー） */
function buildClosingLine() {
  const templates = [
    "今は体を回復モードに入れることが最優先です。",
    "今は体を整える時間として受け止めて大丈夫です。",
    "今は体の負担を減らすことが、いちばんの近道です。",
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

function buildImmediateActionsBlock(level, state, historyText = "", research = null) {
  const context = research?.currentStateContext || buildCurrentStateContext(state, historyText || "", state?.lastConcreteDetailsText || "");
  const lines = ["✅ 今すぐやること", ""];

  // ① なぜそれでいいのか
  lines.push(buildWhySection(context));
  lines.push("");

  // ② 今すぐやること（最大3件）※フォールバック時もcontext由来の補足で埋める
  const plannedActions = sanitizeImmediateActions(
    pickActionsForBlock(research, 3),
    buildSafeImmediateFallbackAction()
  );
  const sourceNames = Array.isArray(research?.sourceNames)
    ? research.sourceNames.filter(Boolean).slice(0, 3)
    : [];
  const baseActions =
    plannedActions.length > 0
      ? plannedActions
      : ensureActionCount([], 3, context, research?.evidence || {});
  let finalActions = ensureActionCount(
    baseActions,
    3,
    context,
    research?.evidence || {}
  );
  const category = resolveQuestionCategoryFromState(state);
  if (level === "🟡" && (category === "PAIN" || category === "INFECTION")) {
    const rest = finalActions.filter(
      (a) => String(a?.title || "").trim() !== PAIN_INFECTION_YELLOW_FIRST_ACTION.title
    );
    finalActions = [PAIN_INFECTION_YELLOW_FIRST_ACTION, ...rest].slice(0, 3);
  }
  finalActions.slice(0, 3).forEach((action, idx) => {
    lines.push(formatActionTitleWithBullet(toConciseActionTitle(action.title)));
    const reason =
      idx === 0 && sourceNames.length > 0
        ? `${ensureReliableReason(action.reason, research?.evidence || {})}（参考: ${sourceNames.join(" / ")}）`
        : ensureReliableReason(action.reason, research?.evidence || {});
    lines.push(formatActionReasonLine(reason));
    if (idx < Math.min(finalActions.length, 3) - 1) lines.push("");
  });
  lines.push("");

  // ③ 予想経過
  lines.push(buildExpectedCourse(context));
  lines.push("");

  // ④ 締めの一文
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

function ensureImmediateActionsBlock(text, level, state, historyText = "", research = null) {
  if (!text) return text;
  if (level !== "🟡" && level !== "🟢") return text;
  return replaceSummaryBlock(
    text,
    "✅ 今すぐやること",
    buildImmediateActionsBlock(level, state, historyText, research)
  );
}

async function buildImmediateActionFallbackPlanFromState(state, overrides = {}) {
  const context =
    overrides.currentStateContext ||
    buildCurrentStateContext(state, "", state?.lastConcreteDetailsText || "");
  const fallbackPrimary = buildSafeImmediateFallbackAction();
  let seedActions =
    Array.isArray(overrides.actions) && overrides.actions.length > 0
      ? sanitizeImmediateActions(overrides.actions, fallbackPrimary)
      : [];
  if (seedActions.length === 0) {
    let contextOnlyActions = await generateImmediateActionsFromContextOnly(state, context);
    if (!contextOnlyActions || contextOnlyActions.length === 0) {
      contextOnlyActions = await generateImmediateActionsFromContextOnly(state, context);
    }
    if (contextOnlyActions && contextOnlyActions.length > 0) {
      seedActions = sanitizeImmediateActions(contextOnlyActions, fallbackPrimary);
    }
  }
  return {
    actions: ensureActionCount(
      seedActions.length > 0 ? seedActions : [],
      3,
      context,
      overrides.evidence || {}
    ),
    currentStateContext: context,
    searchQuery: overrides.searchQuery || "",
    sourceNames: Array.isArray(overrides.sourceNames) ? overrides.sourceNames : [],
    evidence: overrides.evidence || { top3: [], selfCare: [], observe: [], danger: [] },
    concreteMessage: overrides.concreteMessage || "",
  };
}

function buildSafeImmediateFallbackAction() {
  return {
    title:
      "刺激（画面・強い光・空腹）を1つ減らし、水分を150〜200mlとって静かな環境で4〜6時間様子を見てください",
    reason:
      "刺激負荷と脱水要因を同時に下げることで、症状のぶれを抑えやすくなります。",
    isOtc: false,
  };
}

function isForbiddenImmediateAction(action = {}) {
  const title = String(action?.title || "");
  const reason = String(action?.reason || "");
  const forbidden = [
    /症状メモを2時間ごとに1回、合計3回（強さ・変化・随伴症状）で記録し、同日中に悪化サインがないか再確認しましょう/,
    /症状メモを2時間ごとに1回、合計3回（強さ・きっかけ・変化）で記録し、今日中に悪化サインがないか再確認しましょう/,
    /現在の状態データを再評価しやすくなり、次の判断の精度を維持できます。/,
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

const MC_4_LINES = [
  "休むためにMCが必要な場合は、今の症状であればオンライン診療で容易に取得できます。",
  "doctor anywhere / white coat",
];

function shouldAppendMcLinesToModal(state) {
  if (state?.decisionLevel === "🔴") return false;
  const restLevel = resolveRestLevelFromState(state);
  const category = resolveQuestionCategoryFromState(state);
  return (restLevel === "LIGHT" || restLevel === "STRONG") && category !== "INFECTION";
}

function renderActionDetailMessage(cushion, doActions = [], dontActions = [], appendMcLines = false) {
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
  if (appendMcLines) {
    lines.push("", ...MC_4_LINES);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function buildConcreteImmediateActionsDetails(state, actionSection = "") {
  const historyText = state?.historyTextForCare || "";
  const plan = await buildImmediateActionHypothesisPlan(state, historyText, actionSection || "");
  const doActions = sanitizeImmediateActions(plan?.actions || [], buildSafeImmediateFallbackAction())
    .map((a) => ({
      action: toConciseActionTitle(a.title),
      reason: ensureReliableReason(a.reason, plan?.evidence || {}),
    }))
    .slice(0, 4);
  const dontActions = buildDontActionsFromContext(plan?.currentStateContext || {}, plan?.evidence || {});
  const cushion = buildYellowPsychologicalCushionLine();

  try {
    const isYellow = state?.decisionLevel === "🟡";
    const prompt = [
      "あなたは医療情報を要約して行動を具体化するアシスタントです。",
      "出力はJSONのみ。診断断定は禁止。",
      "行動は勧める口調で（〜してください／〜するといいです）。「〜します」は避ける。",
      "次の形式で返す: {\"cushion\":\"...\",\"do\":[{\"action\":\"...\",\"reason\":\"...\"}],\"dont\":[{\"action\":\"...\",\"reason\":\"...\"}]}",
      "cushionは1文、40〜65文字、保証語・危険語を使わない。",
      "doは最低3件、最大4件。dontは最大2件。各reasonは検索要点と整合する確実な理由にする。",
      isYellow ? "OTC（市販薬：鎮痛薬・整腸剤・のど飴・ワセリン等）を1件必ず含める。" : "",
      "「症状メモを2時間ごとに1回...」は禁止。",
    ]
      .filter(Boolean)
      .join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify({
            currentStateContext: plan?.currentStateContext || {},
            evidence: {
              selfCare: plan?.evidence?.selfCare || [],
              observe: plan?.evidence?.observe || [],
              danger: plan?.evidence?.danger || [],
            },
            doActions,
            dontActions,
            fallbackCushion: cushion,
          }),
        },
      ],
      temperature: 0.3,
      max_tokens: 650,
    });
    const parsed = parseJsonObjectFromText(completion?.choices?.[0]?.message?.content || "");
    const outCushion = String(parsed?.cushion || cushion).trim();
    const outDo = Array.isArray(parsed?.do) ? parsed.do : doActions;
    const outDont = Array.isArray(parsed?.dont) ? parsed.dont : dontActions;
    const safeDo = sanitizeImmediateActions(
      outDo.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
      buildSafeImmediateFallbackAction()
    )
      .map((x) => ({
        action: toConciseActionTitle(x.title),
        reason: ensureReliableReason(x.reason, plan?.evidence || {}),
      }))
      .slice(0, 4);
    let ensuredDo = ensureMinimumDoActions(
      safeDo.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
      3,
      plan?.currentStateContext || {},
      plan?.evidence || {}
    ).map((x) => ({ action: x.title, reason: x.reason }));
    const category = resolveQuestionCategoryFromState(state);
    const level = state?.decisionLevel;
    if (level === "🟡" && (category === "PAIN" || category === "INFECTION")) {
      const fixedFirst = {
        action: PAIN_INFECTION_YELLOW_FIRST_ACTION.title,
        reason: PAIN_INFECTION_YELLOW_FIRST_ACTION.reason,
      };
      const rest = ensuredDo.filter((x) => x.action !== fixedFirst.action);
      ensuredDo = [fixedFirst, ...rest].slice(0, 4);
    }
    if (level === "🟡") {
      const hasOtc = ensuredDo.some(
        (x) => /ワセリン|鎮痛薬|整腸剤|のど飴|トローチ|市販/.test(x.action || "")
      );
      if (!hasOtc) {
        const topic = normalizeContextLocation(plan?.currentStateContext?.location || "");
        const otc = getOtcActionForYellowModal(topic);
        ensuredDo = [...ensuredDo, otc].slice(0, 4);
      }
    }
    if (ensuredDo.length < 3) {
      const ctx = plan?.currentStateContext || {};
      const extra = ensureMinimumDoActions(
        ensuredDo.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
        3,
        ctx,
        plan?.evidence || {}
      )
        .map((x) => ({ action: x.title, reason: x.reason }))
        .filter((x) => !ensuredDo.some((e) => e.action === x.action));
      ensuredDo = [...ensuredDo, ...extra].slice(0, 4);
    }
    const safeDont = (Array.isArray(outDont) ? outDont : [])
      .filter((x) => x && x.action && x.reason)
      .slice(0, 2);
    const appendMc = shouldAppendMcLinesToModal(state);
    return {
      message: renderActionDetailMessage(outCushion, ensuredDo, safeDont.length > 0 ? safeDont : dontActions, appendMc),
      query: plan?.searchQuery || "",
      sourceNames: plan?.sourceNames || [],
    };
  } catch (_) {
    let fallbackDo = ensureMinimumDoActions(
      doActions.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
      3,
      plan?.currentStateContext || {},
      plan?.evidence || {}
    ).map((x) => ({ action: x.title, reason: x.reason }));
    const category = resolveQuestionCategoryFromState(state);
    const level = state?.decisionLevel;
    if (level === "🟡" && (category === "PAIN" || category === "INFECTION")) {
      const fixedFirst = {
        action: PAIN_INFECTION_YELLOW_FIRST_ACTION.title,
        reason: PAIN_INFECTION_YELLOW_FIRST_ACTION.reason,
      };
      const rest = fallbackDo.filter((x) => x.action !== fixedFirst.action);
      fallbackDo = [fixedFirst, ...rest].slice(0, 4);
    }
    if (level === "🟡") {
      const hasOtc = fallbackDo.some(
        (x) => /ワセリン|鎮痛薬|整腸剤|のど飴|トローチ|市販/.test(x.action || "")
      );
      if (!hasOtc) {
        const topic = normalizeContextLocation(plan?.currentStateContext?.location || "");
        const otc = getOtcActionForYellowModal(topic);
        fallbackDo = [...fallbackDo, otc].slice(0, 4);
      }
    }
    if (fallbackDo.length < 3) {
      const ctx = plan?.currentStateContext || {};
      const extra = ensureMinimumDoActions(
        fallbackDo.map((x) => ({ title: x.action, reason: x.reason, isOtc: false })),
        3,
        ctx,
        plan?.evidence || {}
      )
        .map((x) => ({ action: x.title, reason: x.reason }))
        .filter((x) => !fallbackDo.some((e) => e.action === x.action));
      fallbackDo = [...fallbackDo, ...extra].slice(0, 4);
    }
    const appendMc = shouldAppendMcLinesToModal(state);
    return {
      message: renderActionDetailMessage(cushion, fallbackDo, dontActions, appendMc),
      query: plan?.searchQuery || "",
      sourceNames: plan?.sourceNames || [],
    };
  }
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
  // PAIN / INFECTION は 4問目（daily_impact）の回答を 1:1 で参照する
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
  if (headerIndex === -1) return text;
  const templateLine = buildSummaryIntroTemplate();
  const nextBlockIndex = lines.findIndex(
    (line, idx) =>
      idx > headerIndex &&
      (line.startsWith("🤝 ") ||
        line.startsWith("✅ ") ||
        line.startsWith("⏳ ") ||
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
  return /^(はい|お願いします|お願いします|いいですね|やります|頼みます)/.test((text || "").trim());
}

function isDecline(text) {
  return /(今はいい|大丈夫|結構です|いりません|不要|いいえ|やめて)/.test((text || "").trim());
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
  if (Number.isFinite(state?.lastPainScore) && state.lastPainScore >= 8) {
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

  return freezeJudgmentSnapshot({
    main_symptom: mainSymptom,
    duration,
    severity,
    red_flags: redFlags.slice(0, 3),
    risk_factors: riskFactors.slice(0, 4),
    user_original_phrases: mergedPhrases.slice(0, 10),
    judgment_type: decisionType || state?.decisionType || "C_WATCHFUL_WAITING",
  });
}

function getMissingFieldForFollowUp(snapshot) {
  if (!snapshot?.main_symptom) {
    return {
      field: "main_symptom",
      question: "行動を正確に整理するため、主な症状をひとことで教えてください。",
    };
  }
  if (!snapshot?.severity) {
    return {
      field: "severity",
      question: "行動の優先度をそろえるため、つらさは10段階でどのくらいか教えてください。",
    };
  }
  if (!snapshot?.duration) {
    return {
      field: "duration",
      question: "判断根拠をそろえるため、症状がいつ頃から続いているかだけ教えてください。",
    };
  }
  return null;
}

function patchSnapshotField(snapshot, field, value) {
  if (!snapshot || !field) return snapshot;
  const nextValue = String(value || "").trim();
  if (!nextValue) return snapshot;
  const next = {
    ...snapshot,
    user_original_phrases: [...(snapshot.user_original_phrases || [])],
  };
  if (!next[field]) {
    next[field] = nextValue;
  }
  if (!next.user_original_phrases.includes(nextValue)) {
    next.user_original_phrases.push(nextValue);
  }
  return freezeJudgmentSnapshot(next);
}

function buildCommunicationScript(state, destinationName, decisionType) {
  const snapshot = state?.judgmentSnapshot || {};
  const facts = [];
  if (snapshot.main_symptom) facts.push(`${snapshot.main_symptom}`);
  if (snapshot.severity) facts.push(`つらさは${snapshot.severity}`);
  if (snapshot.duration) facts.push(`${snapshot.duration}から続いています`);
  const factsSentence = facts.length > 0 ? `症状は${facts.join("、")}。` : "症状について相談したいです。";
  const jp = [
    `こんにちは。${destinationName}で症状の相談をしたくて来ました。`,
    factsSentence,
    "今の状態を見てもらいたいです。",
  ].join("\n");
  const en = [
    `Hello. I'd like to consult about my symptoms at ${destinationName}.`,
    facts.length > 0 ? `My symptoms are: ${facts.join(", ")}.` : "I want to consult about my symptoms.",
    "I'd like you to check my current condition.",
  ].join("\n");
  const label = decisionType === "A_HOSPITAL" ? "病院" : "薬局";
  return `【日本語】\n${jp}\n\n【English】\n${en}\n\n(${label}向け)`;
}

function buildImmediateActionsWithReasons(state, decisionType) {
  if (decisionType === "A_HOSPITAL") {
    return [
      "・今の症状の要点をメモする：短く伝えられると受付がスムーズになります。",
      "・無理な移動は避ける：体力を温存した方が負担が少ないです。",
      "・水分を少しずつとる：喉や体の負担が軽くなります。",
    ].join("\n");
  }
  return [
    "・症状の要点をそのまま伝える：相談が短時間でまとまります。",
    "・薬名は例として確認する：体質に合うか相談しやすくなります。",
    "・今の状態を無理なく保つ：体力の消耗を抑えられます。",
  ].join("\n");
}

function buildNextFlow(decisionType) {
  if (decisionType === "A_HOSPITAL") {
    return [
      "今すぐ：病院へ連絡または受付へ行く。",
      "今日中：症状の要点を伝えて診てもらう。",
      "その後：指示があればその内容に沿って動く。",
    ].join("\n");
  }
  return [
    "今すぐ：薬局で症状を相談する。",
    "今日中：提案された範囲で様子を見る。",
    "数日以内：変化がなければ受診を検討する。",
  ].join("\n");
}

function buildFollowUpQuestion1(destinationName) {
  return `もしよろしければ、${destinationName}でどう伝えればいいか、一緒に考えましょうか？`;
}

function buildWatchfulActions(state) {
  const snapshot = state?.judgmentSnapshot || {};
  const painLevel = snapshot.severity || "不明";
  const mobility = state?.slotAnswers?.daily_impact || "普通に動ける";
  const historyText = [snapshot.main_symptom, ...(snapshot.user_original_phrases || [])].join(" ");
  const category = detectSymptomCategory(historyText || Object.values(state?.slotAnswers || {}).join(" "));
  const symptomLine =
    category === "stomach"
      ? "お腹の張りが主症状のため、消化管への刺激を避ける目的"
      : category === "head"
        ? "頭の重さや痛みが主症状のため、刺激を避ける目的"
        : category === "throat"
          ? "喉の違和感が主症状のため、刺激を避ける目的"
          : "体の違和感が主症状のため、刺激を避ける目的";
  return [
    "今の情報を踏まえると、以下が現実的です。",
    "",
    "・無理に動かず、安静にする",
    `　→ 痛みが「${painLevel}」で「${mobility}」なため、体への負荷を増やさない方がよい`,
    "",
    "・水分を少しずつとる",
    "　→ 1回100〜150mlを目安に、1〜2時間おきに補給するため",
    "",
    "・食事や刺激物は控える",
    `　→ ${symptomLine}`,
    "",
    "・症状の変化をメモしておく",
    "　→ 受診時に「いつ・どう変わったか」を正確に伝えやすくなる",
  ].join("\n");
}

function formatDestinationName(name, decisionType) {
  if (!name) return decisionType === "A_HOSPITAL" ? "病院" : "薬局";
  if (decisionType === "A_HOSPITAL") {
    if (name.match(/病院|Hospital|Clinic/)) return name;
    return `${name}病院`;
  }
  if (name.match(/薬局|Pharmacy/)) return name;
  return `${name}薬局`;
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

function handleFollowUpFlow(message, state) {
  if (!state?.hasSummaryBlockGenerated) return null;
  const trimmed = (message || "").trim();
  if (!state.judgmentSnapshot) {
    state.judgmentSnapshot = buildJudgmentSnapshot(state, [], state.decisionType);
  }
  const decisionType = state?.decisionType;
  const rawDestinationName =
    state?.followUpDestinationName ||
    (decisionType === "A_HOSPITAL"
      ? state?.hospitalRecommendation?.name
      : state?.pharmacyRecommendation?.name);
  const destinationName = formatDestinationName(rawDestinationName, decisionType);
  const q2 = "今できることを、理由と一緒に整理しますか？";

  // 最低限の行動生成に必要な情報が不足している場合のみ、1問だけ確認する
  if (state.followUpSnapshotPendingField) {
    if (isDecline(trimmed)) {
      state.followUpPhase = "closed";
      state.followUpSnapshotPendingField = null;
      state.followUpSnapshotResume = null;
      return { message: buildClosingMessage() };
    }
    state.judgmentSnapshot = patchSnapshotField(
      state.judgmentSnapshot,
      state.followUpSnapshotPendingField,
      trimmed
    );
    const resume = state.followUpSnapshotResume;
    state.followUpSnapshotPendingField = null;
    state.followUpSnapshotResume = null;
    if (resume === "watchful_actions") {
      state.followUpPhase = "closed";
      return { message: `${buildWatchfulActions(state)}\n\n${buildClosingMessage()}` };
    }
    if (resume === "communication_script") {
      state.followUpStep = 2;
      const script = buildCommunicationScript(state, destinationName, decisionType);
      return { message: `${script}\n\n${q2}` };
    }
  }

  if (decisionType === "C_WATCHFUL_WAITING") {
    const qWatchful = "今できることを、理由と一緒に整理しますか？";
    if (state.followUpStep <= 1) {
      if (isAffirmative(trimmed)) {
        const missing = getMissingFieldForFollowUp(state.judgmentSnapshot);
        if (missing) {
          state.followUpSnapshotPendingField = missing.field;
          state.followUpSnapshotResume = "watchful_actions";
          return { message: missing.question };
        }
        state.followUpPhase = "closed";
        return { message: `${buildWatchfulActions(state)}\n\n${buildClosingMessage()}` };
      }
      if (isDecline(trimmed)) {
        state.followUpPhase = "closed";
        return { message: buildClosingMessage() };
      }
      return { message: qWatchful };
    }
    state.followUpPhase = "closed";
    return { message: buildClosingMessage() };
  }

  const q1 = buildFollowUpQuestion1(destinationName);
  const q3 = "今後の目安も含めて整理しますか？";

  if (state.followUpPhase === "closed") {
    return { message: buildClosingMessage() };
  }

  if (state.followUpStep <= 1) {
    if (isAffirmative(trimmed)) {
      const missing = getMissingFieldForFollowUp(state.judgmentSnapshot);
      if (missing) {
        state.followUpSnapshotPendingField = missing.field;
        state.followUpSnapshotResume = "communication_script";
        return { message: missing.question };
      }
      state.followUpStep = 2;
      const script = buildCommunicationScript(state, destinationName, decisionType);
      return { message: `${script}\n\n${q2}` };
    }
    if (isDecline(trimmed)) {
      state.followUpPhase = "closed";
      return { message: buildClosingMessage() };
    }
    return { message: q1 };
  }

  if (state.followUpStep === 2) {
    if (isAffirmative(trimmed)) {
      state.followUpStep = 3;
      const actions = buildImmediateActionsWithReasons(state, decisionType);
      return { message: `${actions}\n\n${q3}` };
    }
    if (isDecline(trimmed)) {
      state.followUpPhase = "closed";
      return { message: buildClosingMessage() };
    }
    return { message: q2 };
  }

  if (state.followUpStep === 3) {
    if (isAffirmative(trimmed)) {
      state.followUpPhase = "closed";
      const flow = buildNextFlow(decisionType);
      return { message: `${flow}\n\n${buildClosingMessage()}` };
    }
    if (isDecline(trimmed)) {
      state.followUpPhase = "closed";
      return { message: buildClosingMessage() };
    }
    return { message: q3 };
  }

  return { message: buildClosingMessage() };
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
  const base = [...FIXED_SLOT_ORDER];
  if (!isDurationNotJustNow(state)) return base;
  const durationIdx = base.indexOf("duration");
  if (durationIdx < 0) return base;
  const insertIdx = durationIdx + 1;
  if (base.includes(CONDITIONAL_SLOT_WORSENING_TREND)) return base;
  base.splice(insertIdx, 0, CONDITIONAL_SLOT_WORSENING_TREND);
  return base;
}

const RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};

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
  if (rawScore >= 8) return RISK_LEVELS.HIGH;
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
  return /(やっぱ|やはり|訂正|正しくは|違う|いや|前の|さっきの|言い直|むしろ)/.test(String(text || ""));
}

function extractSeverityFromText(text) {
  const normalized = normalizeUserText(text);
  const direct = normalized.match(/(?:^|[^\d])(10|[1-9])\s*(?:\/\s*10|点|くらい|ぐらい)?(?:$|[^\d])/);
  let score = direct ? Number(direct[1]) : null;
  if (!Number.isFinite(score)) {
    const parsed = normalizePainScoreInput(normalized);
    if (parsed !== null && normalized.length <= 12) score = parsed;
  }
  if (!Number.isFinite(score)) return null;
  return {
    raw: direct ? direct[0].trim() : String(score),
    score: Math.max(1, Math.min(10, score)),
  };
}

function extractWorseningFromText(text) {
  const normalized = normalizeUserText(text);
  const rawText = String(text || "").trim();
  let trend = null;
  if (/だんだん.*悪|悪化|ひどく|強くな|増えて/.test(normalized)) trend = "worsening";
  else if (/良くな|まし|和らい|軽くな/.test(normalized)) trend = "improving";
  else if (/変わらない|同じ|横ばい/.test(normalized)) trend = "stable";
  else if (/波がある|波があ|上がったり下がったり|ムラ/.test(normalized)) trend = "fluctuating";

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
  ];
  const quality = qualityWords.find((w) => normalized.includes(w)) || null;
  if (!trend && !quality) return null;

  // ユーザー原文を優先。必要最小限の整形のみ行う。
  const raw = quality
    ? quality
    : rawText.length > 0
      ? rawText
      : [trend ? `変化:${trend}` : "", quality ? `痛み方:${quality}` : ""]
          .filter(Boolean)
          .join(" / ");
  return { trend, quality, raw, selectedIndex: null };
}

function mapWorseningToOptionIndex(worsening, category) {
  if (!worsening) return 1;
  const options = buildPainQualityOptions(category || "other");
  const quality = String(worsening.quality || "").trim();
  if (quality) {
    const exact = options.findIndex((opt) => opt.includes(quality) || quality.includes(opt));
    if (exact >= 0) return exact;
  }
  if (worsening.trend === "worsening") return 2;
  if (worsening.trend === "improving") return 0;
  return 1;
}

function extractDurationFromText(text) {
  const rawText = String(text || "");
  const normalized = normalizeUserText(rawText);
  const shortRaw =
    (rawText.match(/(さっき|今さっき|数分|数十分)/) || [])[0] ||
    (normalized.match(/(さっき|今さっき|数分|数十分)/) || [])[0];
  if (shortRaw) {
    const raw = shortRaw || "さっき";
    return { raw_text: raw, normalized: "short", selectedIndex: 0 };
  }
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
  const dRaw = rawText.match(/(\d+\s*日(?:前)?)/);
  const dNorm = normalized.match(/(\d+)\s*日前/);
  if (dRaw || dNorm) {
    const raw = dRaw ? dRaw[1] : `${dNorm[1]}日前`;
    const dValue = Number((dNorm && dNorm[1]) || (dRaw && dRaw[1].match(/(\d+)/)?.[1]) || NaN);
    return { raw_text: raw, normalized: Number.isFinite(dValue) ? `${dValue}d_ago` : "day_or_more", selectedIndex: 2 };
  }
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
  if (/仕事できない|学校休んだ|寝込|動けない|家事できない|集中できないほど/.test(normalized)) {
    return {
      raw: pickRaw(/仕事できない|学校休んだ|寝込んでる|動けない|家事できない|集中できないほど/, rawText || normalized),
      selectedIndex: 2,
    };
  }
  if (/動けるけどつらい|少しつらいが動ける|無理すれば|つらいけど/.test(normalized)) {
    return {
      raw: pickRaw(/動けるけどつらい|少しつらいが動ける|無理すれば|つらいけど/, rawText || normalized),
      selectedIndex: 1,
    };
  }
  if (/普通に生活できる|普通に動ける|問題なく動ける/.test(normalized)) {
    return {
      raw: pickRaw(/普通に生活できる|普通に動ける|問題なく動ける/, rawText || normalized),
      selectedIndex: 0,
    };
  }
  return null;
}

function extractAssociatedSymptoms(text) {
  const rawText = String(text || "").trim();
  const normalized = normalizeUserText(text);
  if (/これ以外は特にない|他はない|特にない|なし|わからない|分からない|不明/.test(normalized)) {
    const m = rawText.match(/これ以外は特にない|他はない|特にない|なし|わからない|分からない|不明/);
    return { primary: null, associated: [], raw: (m && m[0]) || rawText || "これ以外は特にない", selectedIndex: 0 };
  }
  const terms = [
    "下痢", "腹痛", "頭痛", "吐き気", "めまい", "発熱", "熱", "咳", "鼻水", "鼻づまり",
    "のど", "喉", "しびれ", "視界異常", "耳鳴り", "だるい", "倦怠感", "ピクピク", "ゴロゴロ",
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
  const mRaw = rawText.match(/([^。！？\n]{0,24}(食あたり|寝不足|ストレス|ぶつけ|冷房|冷え|ブルーライト|感染|花粉|飲酒|過労|疲れ|人混み|仕事)[^。！？\n]{0,24})/);
  const m = normalized.match(/([^。！？\n]{0,24}(食あたり|寝不足|ストレス|ぶつけ|冷房|冷え|ブルーライト|感染|花粉|飲酒|過労|疲れ|人混み|仕事)[^。！？\n]{0,24})/);
  if (m) {
    return { raw: ((mRaw && mRaw[1]) || m[1] || rawText).trim(), selectedIndex: 1 };
  }
  if (/(かも|と思う|かもしれない)/.test(normalized) && normalized.length <= 30) {
    return { raw: rawText || normalized.trim(), selectedIndex: 2 };
  }
  return null;
}

function extractWorseningTrendFromText(text) {
  const rawText = String(text || "").trim();
  const normalized = normalizeUserText(text);
  if (/(発症時より悪化|悪化している|ひどくなって|悪化してきた)/.test(normalized)) {
    const m = rawText.match(/(発症時より悪化|悪化している|ひどくなって|悪化してきた)[^。！？]*/);
    return { raw: (m && m[0]) || "発症時より悪化している", selectedIndex: 2 };
  }
  if (/(変わらない|横ばい|同じ|変化なし|悪くも良くも)/.test(normalized)) {
    const m = rawText.match(/(変わらない|横ばい|同じ|変化なし|悪くも良くも)/);
    return { raw: (m && m[0]) || "変わらない", selectedIndex: 1 };
  }
  if (/(回復に向か|良くなって|ましになって|楽になって|改善して)/.test(normalized)) {
    const m = rawText.match(/(回復に向か|良くなって|ましになって|楽になって|改善して)[^。！？]*/);
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
    const weight = rawScore >= 8 ? 2.0 : rawScore >= 5 ? 1.5 : 1.0;
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

function applySpontaneousSlotFill(state, message) {
  if (!state) return 0;
  const text = normalizeUserText(message);
  if (!text) return 0;
  ensureSlotStatusShape(state);
  const symptomType = detectSymptomCategory(text);
  let added = 0;
  const correction = hasCorrectionIntent(text);

  const severity = extractSeverityFromText(text);
  if (severity && setSlotFromSpontaneous(state, "pain_score", {
    rawAnswer: severity.raw,
    rawScore: severity.score,
    allowOverwrite: correction,
  })) {
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
    if (setSlotFromSpontaneous(state, "associated_symptoms", {
      rawAnswer: associated.raw,
      selectedIndex: associated.selectedIndex,
      allowOverwrite: correction,
    })) {
      state.associatedSymptoms = associated.associated || [];
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

function ensurePainScoreFallback(state) {
  if (!state) return;
  if (Number.isFinite(state.lastPainScore)) return;
  updatePainScoreState(state, 5, 1.5, "5");
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

/** slotFilled と slotAnswers/slotStatus の整合性を保ち、不正な埋まりを解除する */
function ensureSlotFilledConsistency(state) {
  if (!state || !state.slotFilled) return;
  ensureSlotStatusShape(state);
  for (const slotKey of SLOT_KEYS) {
    if (slotKey === "worsening_trend" && !isDurationNotJustNow(state)) {
      state.slotFilled[slotKey] = false;
      if (state.slotStatus?.worsening_trend) {
        state.slotStatus.worsening_trend.filled = false;
        state.slotStatus.worsening_trend.value = null;
      }
      continue;
    }
    const statusKey = SLOT_STATUS_KEY_MAP[slotKey];
    const rawAnswer = state.slotAnswers?.[slotKey];
    const statusVal = state.slotStatus?.[statusKey]?.value;
    const hasValue = (v) => v != null && String(v).trim().length > 0;
    const isValid =
      slotKey === "pain_score"
        ? Number.isFinite(state.lastPainScore)
        : hasValue(rawAnswer) || hasValue(statusVal);
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

function buildPainQualityOptions(category) {
  if (category === "stomach") {
    return ["キリキリする", "張る感じ", "締め付けられる感じ"];
  }
  if (category === "head") {
    return ["ズキズキする", "重い感じ", "締め付けられる感じ"];
  }
  if (category === "throat") {
    return ["ヒリヒリする", "ズキッとする", "しみる感じ"];
  }
  return ["ズキズキする", "チクチクする", "重だるい感じ"];
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
  if (fromState) {
    state.triageCategory = fromState;
    return fromState;
  }
  const detected = detectQuestionCategory4(historyText);
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
        options: ["赤みや乾燥だけ", "見た目はほとんど変わらない", "水ぶくれ・ただれ・できもの"],
      };
    }
    if (slotKey === "associated_symptoms") {
      return {
        question: "思い当たるきっかけはありますか？",
        options: ["特に思い当たらない", "紫外線や乾燥が強かった", "新しい製品や刺激物を使った"],
      };
    }
    if (slotKey === "cause_category") {
      return {
        question: "症状の状況はどうですか？",
        options: ["触っても痛くない", "触ると痛い", "触ると激痛が走る"],
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
      return {
        question: "今一番つらい症状はどれに近いですか？",
        options: ["喉の違和感や鼻水", "強い全身のだるさ", "咳が強い／胸が苦しい"],
      };
    }
    if (slotKey === "cause_category") {
      return {
        question: "何かきっかけで思い当たることはありますか？",
        options: ["思い当たらない", "周りが咳をしていた", "ストレスや疲労"],
      };
    }
  }
  if (category === "GI") {
    if (slotKey === "daily_impact") {
      return {
        question: "お腹のどのあたりが痛みますか？",
        options: ["わからない", "全体的", "みぞおち付近"],
      };
    }
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

function applyCategoryQuestionOverride(fixed, slotKey, category, useFinalPrefix) {
  if (!fixed || !slotKey) return fixed;
  if (slotKey === "worsening") {
    const baseCategory = detectSymptomCategory(category === "GI" ? "腹痛" : category === "INFECTION" ? "喉" : category === "SKIN" ? "ヒリヒリ" : "頭痛");
    const options = buildPainQualityOptions(baseCategory);
    fixed.options = options;
    fixed.question = `${useFinalPrefix ? "最後に、" : ""}${FIXED_QUESTIONS.worsening.q}\n・${options.join("\n・")}`;
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
  const used = new Set(state.introTemplateUsedIds || []);
  let introIds = [];
  const progressUsedBefore = (state?.introRoleUsage?.PROGRESS || 0) > 0;

  if (questionIndex === 0 || slotKey === "pain_score") {
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

function getSlotStatusValue(state, statusKey, fallback = "") {
  const raw = state?.slotStatus?.[statusKey]?.value;
  const picked = raw !== null && raw !== undefined && String(raw).trim() !== ""
    ? raw
    : fallback;
  return normalizeFreeTextForSummary(picked);
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
  if (associatedRaw) {
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

function sanitizeSummaryBullets(text, state) {
  if (!text) return text;
  const answers = state?.slotAnswers || {};
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("・")) return line;
      if (/^・(ない|特にない|なし)$/.test(trimmed)) {
        if (answers.associated_symptoms?.includes("ない")) {
          return "・これ以外の症状は特にない";
        }
        return "・特にない点がある";
      }
      return line;
    })
    .join("\n");
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

function buildStateFactsBullets(state) {
  const answers = state?.slotAnswers || {};
  const val = (statusKey, fallback = "") => getSlotStatusValue(state, statusKey, fallback);
  const isUnknownLike = (text) =>
    /^(ない|なし|特にない|特になし|これ以外は特にない|わからない|分からない|不明|思い当たらない|特に思い当たらない)$/i.test(
      String(text || "").trim()
    );
  const pushIfValid = (bucket, line) => {
    const normalized = String(line || "").trim();
    if (!normalized) return;
    if (/^・\s*$/.test(normalized)) return;
    if (/^・\s*(ない|なし|特にない|特になし|わからない|分からない|不明)\s*$/i.test(normalized)) return;
    if (!bucket.includes(normalized)) bucket.push(normalized);
  };

  // 1) 痛みスコア（先頭固定）
  const painScore = Number.isFinite(state?.lastPainScore)
    ? state.lastPainScore
    : (() => {
        const m = String(val("severity", answers.pain_score)).match(/(\d{1,2})/);
        return m ? Number(m[1]) : null;
      })();
  let painLine = "";
  if (Number.isFinite(painScore)) {
    painLine = `・痛みは${painScore}/10程度`;
  } else {
    const rawSeverity = val("severity", answers.pain_score);
    painLine = !rawSeverity || isUnknownLike(rawSeverity)
      ? "・痛みは中等度"
      : `・痛みは${String(rawSeverity).replace(/^痛み(は|が)?/, "").trim()}`;
  }
  const lines = [painLine];

  const worsening = val("worsening", answers.worsening);
  if (worsening && !isUnknownLike(worsening)) {
    pushIfValid(lines, `・痛み方は${worsening}`);
  }

  const duration = val("duration", answers.duration);
  if (duration && !isUnknownLike(duration)) {
    pushIfValid(lines, `・始まりは${duration}`);
  }

  const worseningTrend = val("worsening_trend", answers.worsening_trend);
  if (worseningTrend && !isUnknownLike(worseningTrend)) {
    pushIfValid(lines, `・方向性は${worseningTrend}`);
  }

  const impact = val("impact", answers.daily_impact);
  if (impact && !isUnknownLike(impact)) {
    pushIfValid(lines, `・日常生活では${impact}`);
  }

  const associated = val("associated", answers.associated_symptoms);
  if (associated && !isUnknownLike(associated)) {
    const a = String(associated).trim();
    const assocLine = /(ある|ない|続く|出る|つらい|痛い|苦しい|しびれ|吐き気|めまい|嘔吐|発熱)/.test(a)
      ? `・${a}`
      : `・付随症状として${a}`;
    pushIfValid(lines, assocLine);
  }

  const cause = val("cause_category", state?.causeDetailText || answers.cause_category);
  if (cause && !isUnknownLike(cause)) {
    pushIfValid(lines, `・きっかけは${cause}`);
  }

  const extra = (state?.confirmationExtraFacts || []).filter(Boolean);
  extra.forEach((f) => {
    const s = String(f).trim();
    if (!s) return;
    pushIfValid(lines, s.startsWith("・") ? s : `・${s}`);
  });

  return lines.slice(0, 6);
}

const PRE_SUMMARY_CONFIRMATION_PHRASES = [
  "この整理で合っていますか？",
  "合っていますか？",
  "これでよろしいですか？",
  "こちらの理解で合っていますか？",
  "この内容で問題ないでしょうか？",
];

const PRE_SUMMARY_ADD_MORE_PHRASES = [
  "もしまだ足りないことがあれば教えてください。",
  "足りないことがあれば、なんでも教えてください。",
  "他に伝えたいことがあれば教えてください。",
];

function buildPreSummaryConfirmationMessage(state, historyText) {
  const bullets = buildStateFactsBullets(state);
  const level = finalizeRiskLevel(state);
  let judgmentLine;
  if (level === "🔴") {
    judgmentLine = buildHospitalConcernPoint(historyText);
  } else {
    judgmentLine = buildStateAboutLine(state, level);
  }
  const phrase = PRE_SUMMARY_CONFIRMATION_PHRASES[
    Math.floor(Math.random() * PRE_SUMMARY_CONFIRMATION_PHRASES.length)
  ];
  const addMore = PRE_SUMMARY_ADD_MORE_PHRASES[
    Math.floor(Math.random() * PRE_SUMMARY_ADD_MORE_PHRASES.length)
  ];
  const parts = [
    "今のところ整理できているのは、",
    ...bullets,
    "という点です。",
    "",
    judgmentLine,
    "",
    phrase,
    addMore,
  ];
  return parts.join("\n");
}

function buildStateAboutLine(state, level) {
  // 🟡のみ：指定の「型」に合わせて生成（固定文にはしない）
  if (level === "🟡") {
    // RED抑制ガード時（PAIN + さっき/数時間前）は、危険否定ではなく時間軸ベースで記述する
    if (shouldBlockRedByPainRecentDuration(state)) {
      const symptomSource = [
        state?.primarySymptom || "",
        state?.slotStatus?.associated?.value || "",
        state?.slotAnswers?.associated_symptoms || "",
      ]
        .filter(Boolean)
        .join(" ");
      const toMainSymptomLabel = (text) => {
        const s = String(text || "");
        if (/(頭が痛|頭痛|こめかみ|後頭部)/.test(s)) return "頭痛";
        if (/(お腹が痛|腹痛|胃痛|みぞおち|下腹)/.test(s)) return "腹痛";
        if (/(喉が痛|のどが痛|喉の痛み|咽頭痛)/.test(s)) return "喉の痛み";
        if (/(唇が痛|唇|口唇)/.test(s)) return "唇の痛み";
        return "症状";
      };
      const mainSymptom = toMainSymptomLabel(symptomSource);
      return `現在の${mainSymptom}は発症からの時間経過や症状の推移からみて、急激に悪化している経過ではありません。`;
    }
    const painScore = state?.lastPainScore;
    const painPart =
      painScore !== null && painScore !== undefined ? `（痛みは${painScore}くらい）` : "";
    const otherStrong =
      state?.slotAnswers?.associated_symptoms?.includes("ない")
        ? "他に強い症状が見られない"
        : "他に強い症状が目立たない";
    const templates = [
      `現在の症状の強さ${painPart}や${otherStrong}ことから、緊急性を示す特徴は確認されていません。`,
      `現在の症状の強さ${painPart}と${otherStrong}点から見ても、緊急性を示す特徴は確認されていません。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  const painScore = state?.lastPainScore;
  const painText =
    painScore !== null && painScore !== undefined ? `痛みは${painScore}くらい` : "痛みは中程度";
  const symptomsText = state?.slotAnswers?.associated_symptoms?.includes("ない")
    ? "他の症状は少ない"
    : "他の症状は多くない";
  return `今の情報を見る限り、${painText}で${symptomsText}ため、急ぐ状況ではなさそうです。`;
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
  if (Number.isFinite(painScore) && painScore <= 7) {
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
  const templates = causeText
    ? [
        buildCauseDrivenPattern(causeText, mainSymptom, symptomFeature, strengthText, durationText, associated),
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
  return Array.from(new Set(rawSlotFacts)).slice(0, 6);
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
      "- common = 一般的に頻度が高い原因（2〜4件）。各項目は「・<原因名> → <短い理由>」形式",
      "- 「→」の理由は**ユーザーの言動を要約**して記載。ユーザーが言っていないことは書かない。固定文（例：肩こりやストレスで）は使わず、ユーザーが実際に言った内容に合わせる。",
      "- conditional = 条件付きで考慮すべき状況（2〜4件）。各項目は「・<病名> → <関連した理由>」形式。本当の病名を使い、理由はユーザー症状と関連付ける（例：群発頭痛 → ズキズキする痛みが目の奥に集中することがある）。検索結果＋ユーザー症状から要約。煽らない表現。固定テンプレート禁止。",
      "- 禁止：理由に痛みの強さ（3/10、〇/10など）を絶対に使わない。",
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

  let common = sanitize(parsed?.common, false).slice(0, 4);
  let conditional = sanitize(parsed?.conditional, false).slice(0, 4);
  let rare_emergency = sanitize(parsed?.rare_emergency, true).slice(0, 2);

  const userWords = rawFacts;
  const stripPainScoreFromReason = (text) =>
    String(text || "")
      .replace(/\d+\s*\/\s*10/g, "")
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

  if (common.length < 2) {
    const fallbackItems = fallbackPair.map((d) => {
      const reason = d.desc.replace(/とされる状態です。?$/, "").trim();
      const fixed = replaceUnsaidPhrasesInReason(reason, userWords);
      return `・${d.name} → ${fixed}`;
    });
    for (const item of fallbackItems) {
      if (common.length >= 4) break;
      const name = (item.match(/^・([^→]+)/) || [])[1]?.trim?.() || "";
      if (!name || !common.some((c) => c.includes(name))) common.push(item);
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
  const conditionalFallbacks =
    conditionalFallbacksBySymptom[mainSymptom] || conditionalFallbacksBySymptom.頭痛;
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

  const reassuranceCommon =
    level === "🔴"
      ? "今のあなたは🟡の可能性もないとは言えません。なので、確認をするためにも受診をおすすめします。"
      : `${mainSymptom}のほとんどは命に関わるものではありません。特に、急激な悪化や神経症状がなければ、よくあるタイプの可能性が高いです。`;

  return {
    common,
    conditional,
    rare_emergency,
    reassuranceCommon,
    reassuranceBullets: reassurance.slice(0, 3),
    consultChangeBullets: consultChanges.slice(0, 3),
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
      { name: "急性胃腸炎", desc: "ウイルスや細菌による消化管の炎症とされる状態です。腹痛や下痢、吐き気などを伴うことがあります。" },
      { name: "過敏性腸症候群", desc: "ストレスや生活習慣が関与するとされる状態です。腹痛と便通の変化が主な特徴とされています。" },
    ],
    唇の痛み: [
      { name: "口唇ヘルペス", desc: "ウイルス感染により唇に水ぶくれやヒリヒリ感が出るとされる状態です。" },
      { name: "口角炎", desc: "口角の炎症や亀裂が生じるとされる状態です。乾燥やビタミン不足が関与することがあります。" },
    ],
    喉の痛み: [
      { name: "急性咽頭炎", desc: "ウイルスや細菌による咽頭の炎症とされる状態です。のどの痛みや違和感が主な症状です。" },
      { name: "急性扁桃炎", desc: "扁桃の炎症とされる状態です。発熱やのどの痛みを伴うことがあります。" },
    ],
    発熱: [
      { name: "感冒", desc: "ウイルス感染による上気道の炎症とされる状態です。発熱、咳、鼻水などを伴うことがあります。" },
      { name: "インフルエンザ", desc: "インフルエンザウイルスによる感染症とされる状態です。高熱や全身倦怠感が特徴です。" },
    ],
    皮膚症状: [
      { name: "接触皮膚炎", desc: "刺激物への接触により皮膚に炎症が生じるとされる状態です。赤みやかゆみが主な症状です。" },
      { name: "乾燥性皮膚炎", desc: "皮膚のバリア機能低下により乾燥やヒリつきが出るとされる状態です。" },
    ],
    体調不良: [
      { name: "感冒", desc: "ウイルス感染による上気道の炎症とされる状態です。発熱、咳、鼻水、倦怠感などを伴うことがあります。" },
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
        !/^(あなたの状態の理解を深める|今の状態は、次のようなパターンと似ています。|現時点の安心材料|こんな変化があれば受診を検討|■|🟢 よくある原因|🟡 状況によっては確認が必要|🔴 すぐ受診が必要なサイン)/.test(
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

async function fetchGoogleCustomSearchResults(query, language = "ja", retries = 2, skipLanguageRestriction = false) {
  const key =
    process.env.GOOGLE_SEARCH_API_KEY ||
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ||
    process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!key || !cx) return [];
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
    severityHint = painScore >= 8 ? "high" : painScore >= 5 ? "medium" : "low";
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
      ? Array.from(new Set(rawSlotFacts)).slice(0, 6)
      : buildStateFactsBullets(state).map((line) => toBulletText(line));
  const mainSymptom = normalizeMainSymptomLabel([
    state?.primarySymptom || "",
    state?.slotStatus?.associated?.value || "",
    state?.slotAnswers?.associated_symptoms || "",
    historyText || "",
  ].join(" "));
  return {
    symptoms,
    location,
    mainSymptom,
    summaryFacts,
    duration,
    intensity,
    progression,
    associatedSymptoms,
    features,
  };
}

function buildMandatoryGoogleQuery(context) {
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
  const mainEn =
    MAIN_SYMPTOM_TO_EN[mainSymptom] ||
    (/(頭|お腹|喉|皮膚|唇)/.test(mainSymptom)
      ? MAIN_SYMPTOM_TO_EN[mainSymptom.match(/(頭|お腹|喉|皮膚|唇)/)?.[0]] || "symptom relief"
      : "symptom relief");
  const mandatoryQuery = buildMandatoryGoogleQuery(context);
  const jaBase = [
    mandatoryQuery,
    `${mainSymptom} ${facts} ${symptoms} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 256),
    `${mainSymptom} ${symptoms} 対処法 セルフケア`.replace(/\s{2,}/g, " ").trim().slice(0, 256),
    `${mainSymptom} 対処法 自宅`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    `${mainSymptom} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
    painType ? `${mainSymptom} ${painType} 対処法`.replace(/\s{2,}/g, " ").trim().slice(0, 200) : null,
    `${mainSymptom} 自宅 ケア 方法`.replace(/\s{2,}/g, " ").trim().slice(0, 128),
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
  if (actions.length === 0) {
    actions.push({
      title: "刺激を1つ減らして静かな環境で休み、水分を150〜200mlとって4〜6時間の変化を確認してください",
      reason: "刺激負荷と脱水要因を減らすことで、症状のぶれを抑えやすくなります。",
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

async function generateImmediateActionsFromContextOnly(state, context) {
  if (!context) return [];
  try {
    const llmPrompt = [
      "Generate 3 immediate self-care actions based on the user's symptom context. No search results available.",
      "Use ONLY currentStateContext. Do not diagnose.",
      "Return strict JSON: {\"actions\":[{\"title\":\"...\",\"reason\":\"...\",\"isOtc\":false}]}",
      "Use recommending tone: 〜してください or 〜するといいです. Avoid 〜します.",
      "Make actions specific to the symptom (head/stomach/throat/skin). OTC max 1.",
    ].join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: llmPrompt },
        { role: "user", content: JSON.stringify({ currentStateContext: context }) },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });
    const parsed = parseJsonObjectFromText(completion?.choices?.[0]?.message?.content || "");
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    return actions.filter((a) => a && a.title && a.reason).slice(0, 3);
  } catch (_) {
    return [];
  }
}

async function buildImmediateActionHypothesisPlan(state, historyText = "", summarySection = "") {
  const summaryFacts = buildStateFactsBullets(state);
  const concrete = buildConcreteStatePatternMessage(state, summaryFacts, summarySection);
  const currentStateContext = buildCurrentStateContext(
    state,
    historyText,
    [concrete.message, state?.lastConcreteDetailsText || ""].filter(Boolean).join("\n")
  );
  const searchQuery = buildMandatoryGoogleQuery(currentStateContext);
  const queryLevels = buildImmediateActionSearchQueries(currentStateContext);

  try {
    const allQueries = [
      ...queryLevels.ja.map((q) => ({ q, lang: "ja" })),
      ...queryLevels.en.map((q) => ({ q, lang: "en" })),
    ].filter((x) => x.q && String(x.q).trim().length > 0);
    const searchPromises = allQueries.map(({ q, lang }) =>
      fetchGoogleCustomSearchResults(q, lang)
    );
    const searchResults = await Promise.allSettled(searchPromises);
    const allItems = searchResults.flatMap((r) =>
      r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []
    );
    let ranked = dedupeAndRankActionSearchResults(
      allItems,
      currentStateContext.features || {}
    );
    if (!ranked || ranked.length === 0) {
      const mainSymptom = String(currentStateContext?.mainSymptom || currentStateContext?.location || "症状").trim();
      const fallbackQueries = [
        { q: `${mainSymptom} 対処法 セルフケア`, lang: "ja" },
        { q: `${mainSymptom} 自宅 ケア`, lang: "ja" },
        { q: `${MAIN_SYMPTOM_TO_EN[mainSymptom] || "symptom"} self care home`, lang: "en" },
      ];
      const fallbackPromises = fallbackQueries.map(({ q, lang }) =>
        fetchGoogleCustomSearchResults(q, lang, 1)
      );
      const fallbackResults = await Promise.allSettled(fallbackPromises);
      const fallbackItems = fallbackResults.flatMap((r) =>
        r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []
      );
      ranked = dedupeAndRankActionSearchResults(
        fallbackItems,
        currentStateContext.features || {}
      );
    }
    if (!ranked || ranked.length === 0) {
      const contextOnlyActions = await generateImmediateActionsFromContextOnly(state, currentStateContext);
      return await buildImmediateActionFallbackPlanFromState(state, {
        actions: contextOnlyActions && contextOnlyActions.length > 0 ? contextOnlyActions : undefined,
        currentStateContext,
        searchQuery,
        concreteMessage: concrete.message,
      });
    }

    const evidence = extractTopSearchEvidence(ranked);
    const sourceNames = Array.from(
      new Set(ranked.filter((r) => r.trusted).map((r) => r.host).filter(Boolean))
    ).slice(0, 3);

    let parsed = null;
    try {
      const llmPrompt = [
        "You convert medical search evidence into immediate actions.",
        "Use ONLY provided currentStateContext and extractedSearchEvidence.",
        "Do not invent sources. Do not diagnose.",
        "Return strict JSON: {\"topic\":\"...\",\"actions\":[{\"title\":\"...\",\"reason\":\"...\",\"isOtc\":false}]}",
        "actions max 3, OTC max 1.",
        "Keep Japanese output. Use recommending tone: 〜してください or 〜するといいです. Avoid 〜します.",
      ].join("\n");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: llmPrompt },
          {
            role: "user",
            content: JSON.stringify({
              currentStateContext,
              extractedSearchEvidence: {
                selfCare: evidence.selfCare,
                observe: evidence.observe,
                danger: evidence.danger,
              },
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
      });
      parsed = parseJsonObjectFromText(completion?.choices?.[0]?.message?.content || "");
    } catch (_) {
      parsed = null;
    }

    const candidateActions = Array.isArray(parsed?.actions)
      ? parsed.actions
      : buildSearchBackedHeuristicActions(currentStateContext, evidence);
    const adviceTopic = normalizeAdviceTopic(parsed?.topic || currentStateContext.location || "");
    const contextTopic = normalizeContextLocation(currentStateContext.location || "");
    const topicMismatch = adviceTopic && contextTopic && adviceTopic !== contextTopic;

    let otcUsed = false;
    let finalActions = sanitizeImmediateActions(candidateActions, buildSafeImmediateFallbackAction())
      .filter((a) => a && a.title && a.reason)
      .filter((a) => {
        const otc = Boolean(a.isOtc);
        if (otc && otcUsed) return false;
        if (otc) otcUsed = true;
        return true;
      })
      .map((a) => ({
        ...a,
        title: toConciseActionTitle(a.title),
        reason: ensureReliableReason(a.reason, evidence),
      }))
      .slice(0, 3);

    if (topicMismatch || finalActions.length === 0) {
      finalActions = sanitizeImmediateActions(
        buildSearchBackedHeuristicActions(currentStateContext, evidence),
        buildSafeImmediateFallbackAction()
      ).map((a) => ({
        ...a,
        title: toConciseActionTitle(a.title),
        reason: ensureReliableReason(a.reason, evidence),
      }));
    }

    return await buildImmediateActionFallbackPlanFromState(state, {
      actions: finalActions.slice(0, 3),
      currentStateContext,
      searchQuery,
      sourceNames,
      evidence,
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
  // 🟡のみ：心理クッション文（1文）を返す
  if (level === "🟡") {
    return buildYellowPsychologicalCushionLine();
  }
  return "なので、今は様子を見る判断で大丈夫そうです。";
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
  const newBlock = [
    "🤝 今の状態について",
    ...buildStateFactsBullets(state),
    "",
    buildStateAboutLine(state, level),
    buildStateDecisionLine(state, level),
  ];
  return [...lines.slice(0, start), ...newBlock, ...lines.slice(sliceEnd)].join("\n");
}

function buildLocalSummaryFallback(level, history, state) {
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

  const baseBlocks = [
    `${level} ここまでの情報を整理します\n${buildSummaryIntroTemplate()}`,
    `🤝 今の状態について\n${buildStateFactsBullets(state).join("\n")}\n\n${buildStateAboutLine(state, level)}\n${buildStateDecisionLine(state, level)}`,
    buildImmediateActionsBlock(level, state, historyText),
    `⏳ 今後の見通し\nこのタイプの症状は、時間の経過で変化することがあります。\n・もし明日の朝も同じ痛みが続いていたら\n・もし痛みが7以上に強くなったら\nそのタイミングで、もう一度Kairoに聞いてください。`,
  ];
  const closing = `🌱 最後に\nまた不安になったら、いつでもここで聞いてください。`;

  if (level === "🟡") {
    return sanitizeSummaryBullets(
      [
        baseBlocks[0],
        baseBlocks[1],
        baseBlocks[2],
        baseBlocks[3],
        closing,
      ].join("\n"),
      state
    );
  }
  if (level === "🔴") {
    const hospitalRec = buildHospitalRecommendationDetail(
      state,
      locationContext,
      state?.clinicCandidates || [],
      state?.hospitalCandidates || []
    );
    const hospitalBlock = buildHospitalBlock(state, historyText, hospitalRec);
    const memoWithJudgment = [
      "📝 今の状態について",
      buildStateFactsBullets(state).join("\n"),
      "",
      buildHospitalConcernPoint(historyText),
    ].join("\n");
    const redActionsBlock = buildRedImmediateActionsBlock(state, historyText);
    return sanitizeSummaryBullets([
      memoWithJudgment,
      redActionsBlock,
      "🏥 受診先の候補",
      hospitalBlock.replace(/^🏥 受診先の候補\n/, ""),
      "💬 最後に",
      "不安な状況だと思います。迷ったときは受診する判断は慎重で正しいです。",
    ].join("\n"), state);
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
      if (/赤み|乾燥/.test(text)) return 0;
      if (/変わらない|ほとんど変わらない/.test(text)) return 1;
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
      if (/周り|咳をしていた|感染/.test(text)) return 1;
      if (/ストレス|疲労|寝不足|過労/.test(text)) return 2;
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
    if (none.test(text)) return 0;
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
  if (pain !== null) {
    if (pain >= 8) return 3;
    if (pain >= 5) return 1;
    return 0;
  }
  return mapRiskLevelToSeverityScore(state?.slotNormalized?.pain_score?.riskLevel);
}

function shouldBlockRedByPainRecentDuration(state) {
  const category = state?.triageCategory || resolveQuestionCategoryFromState(state);
  if (category !== "PAIN") return false;
  const durationRaw = String(
    getSlotStatusValue(state, "duration", state?.slotAnswers?.duration || "")
  ).trim();
  const selectedIndex = state?.durationMeta?.selectedIndex;
  if (selectedIndex === 0 || selectedIndex === 1) return true;
  return /(さっき|今さっき|数時間前|数時間|数分|数十分|今朝)/.test(durationRaw);
}

function calculateRiskFromState(state) {
  const worseningTrendVal = getSlotStatusValue(state, "worsening_trend", state?.slotAnswers?.worsening_trend || "");
  const worseningTrendIndex = state?.slotNormalized?.worsening_trend?.riskLevel === RISK_LEVELS.HIGH
    ? 2
    : /発症時より悪化|悪化している/.test(worseningTrendVal)
      ? 2
      : null;
  if (worseningTrendIndex === 2) {
    const painScoreRaw = Number.isFinite(state?.lastPainScore)
      ? state.lastPainScore
      : Number(String(state?.slotAnswers?.pain_score || "").match(/\d+/)?.[0]) || 0;
    if (painScoreRaw >= 5) {
      console.log("---- KAIRO URGENCY DEBUG (worsening_trend=発症時より悪化 かつ pain>=5 → RED) ----");
      return { ratio: 1, level: "🔴", urgency: "red" };
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

  const painHigh = scores.pain === 3;
  const impactHigh = scores.impact === 3;
  const symptomsMidOrHigh = scores.symptoms >= 1;
  const criticalHighCount = [scores.pain, scores.impact, scores.symptoms].filter((v) => v === 3).length;
  const blockRedByRecentPainDuration = shouldBlockRedByPainRecentDuration(state);

  const phase1Triggered =
    (painHigh && impactHigh) ||
    (painHigh && symptomsMidOrHigh) ||
    (impactHigh && symptomsMidOrHigh) ||
    criticalHighCount >= 2;

  if (phase1Triggered) {
    if (blockRedByRecentPainDuration) {
      return { ratio: 0.64, level: "🟡", urgency: "yellow" };
    }
    console.log("---- KAIRO URGENCY DEBUG (Phase1 RED) ----");
    console.log("scores:", scores);
    console.log("phase1:", {
      painHigh,
      impactHigh,
      symptomsMidOrHigh,
      criticalHighCount,
    });
    console.log("severityIndex:", 1);
    console.log("finalUrgency:", "red");
    console.log("-------------------------------------------");
    return { ratio: 1, level: "🔴", urgency: "red" };
  }

  // 仕様: critical高レベルが1つだけのときは必ず🟡（ただしPhase1 RED該当時はRED優先）
  if (criticalHighCount === 1) {
    console.log("---- KAIRO URGENCY DEBUG (Forced YELLOW) ----");
    console.log("scores:", scores);
    console.log("criticalHighCount:", criticalHighCount);
    console.log("finalUrgency:", "yellow");
    console.log("----------------------------------------------");
    return { ratio: 0.45, level: "🟡", urgency: "yellow" };
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
  if (urgency === "red" && blockRedByRecentPainDuration) {
    urgency = "yellow";
  }
  const level = urgency === "red" ? "🔴" : urgency === "yellow" ? "🟡" : "🟢";

  console.log("---- KAIRO URGENCY DEBUG (Phase2 Index) ----");
  console.log("scores:", scores);
  console.log("weightedTotal:", weightedTotal);
  console.log("maxWeighted:", maxWeighted);
  console.log("severityIndex:", severityIndex);
  console.log("finalUrgency:", urgency);
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

// Chat API endpoint
app.post("/api/chat", async (req, res) => {
  try {
  const { message, conversationId: rawConversationId, location, clientMeta } = req.body;
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
      const fallback = buildFixedQuestion("pain_score", true);
      return res.status(200).json({
        conversationId,
        message: fallback.question,
        response: fallback.question,
        judgeMeta: { judgement: null, confidence: 0, ratio: null, shouldJudge: false, slotsFilledCount: 0, decisionAllowed: false, questionCount: 0, summaryLine: null, questionType: null, rawScore: null, painScoreRatio: null },
        triage_state: buildTriageState(false, null, 0),
        questionPayload: { introTemplateIds: buildIntroTemplateIds(initConversationState({ conversationId }), 0, "pain_score"), question: fallback.question },
        normalizedAnswer: null,
      });
    }

    // Initialize or get conversation history
    if (!conversationHistory[conversationId]) {
      conversationHistory[conversationId] = [
        { role: "system", content: SYSTEM_PROMPT },
      ];
    }
    const state = getOrInitConversationState(conversationId);
    if (!state.triageCategory) {
      state.triageCategory = detectQuestionCategory4(message);
    }
    console.log("[DEBUG] request init", {
      conversationId,
      hasConversationState: !!conversationState[conversationId],
      hasLocationSnapshot: !!state.locationSnapshot,
    });
    if (location) {
      const normalized = normalizeLocation(location);
      if (normalized && !state.locationSnapshot) {
        state.locationSnapshot = normalized;
      }
    }
    if (clientMeta) {
      state.clientMeta = clientMeta;
      if (clientMeta.locationPromptShown === true) {
        state.locationPromptShown = true;
      }
      if (clientMeta.locationSnapshot && !state.locationSnapshot) {
        const normalized = normalizeLocation(clientMeta.locationSnapshot);
        if (normalized) {
          state.locationSnapshot = normalized;
        }
      }
    }

    const locationPromptMessage = null;
    const locationRePromptMessage = null;
    ensureSlotFilledConsistency(conversationState[conversationId]);
    const filledBeforeTurn = countFilledSlots(conversationState[conversationId].slotFilled, conversationState[conversationId]);
    applySpontaneousSlotFill(conversationState[conversationId], message);

    const userMessageCountBefore = (conversationHistory[conversationId] || []).filter((m) => m.role === "user").length;
    const isFirstUserMessage = userMessageCountBefore === 0;

    // 絶対防御: 初回ユーザーメッセージではサマリー・フォローを絶対に返さない
    if (isFirstUserMessage) {
      conversationHistory[conversationId].push({ role: "user", content: message });
      const missingSlotsFirst = getMissingSlots(state.slotFilled, state);
      const firstSlot = missingSlotsFirst[0] || "pain_score";
      let fixed = buildFixedQuestion(firstSlot, false);
      const historyText = message;
      const category = resolveLockedQuestionCategory(state, historyText);
      applyCategoryQuestionOverride(fixed, firstSlot, category, false);
      const introTemplateIds = buildIntroTemplateIds(state, state.questionCount || 0, firstSlot);
      conversationState[conversationId].lastOptions = fixed.options;
      conversationState[conversationId].lastQuestionType = fixed.type;
      conversationState[conversationId].expectsPainScore = firstSlot === "pain_score";
      conversationState[conversationId].askedSlots[firstSlot] = true;
      conversationHistory[conversationId].push({ role: "assistant", content: fixed.question });
      const slotsFilledFirst = countFilledSlots(state.slotFilled, state);
      return res.json({
        message: fixed.question,
        response: fixed.question,
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
        questionPayload: { introTemplateIds, question: fixed.question },
        normalizedAnswer: null,
        locationPromptMessage: null,
        locationRePromptMessage: null,
        locationSnapshot: state.locationSnapshot,
        conversationId,
      });
    }

    const followUpResult = handleFollowUpFlow(message, state);
    if (followUpResult) {
      conversationHistory[conversationId].push({
        role: "user",
        content: message,
      });
      conversationHistory[conversationId].push({
        role: "assistant",
        content: followUpResult.message,
      });
      const judgeMeta = buildFollowUpJudgeMeta(state);
      return res.json({
        message: followUpResult.message,
        response: followUpResult.message,
        judgeMeta,
        triage_state: buildTriageState(true, judgeMeta.judgement, judgeMeta.slotsFilledCount),
        questionPayload: null,
        normalizedAnswer: state.lastNormalizedAnswer || null,
        locationPromptMessage,
        locationRePromptMessage,
        locationSnapshot: state.locationSnapshot,
        conversationId,
      });
    }

    // Pre-summary confirmation: 6 slots filled, waiting for user response
    if (conversationState[conversationId].confirmationPending || conversationState[conversationId].expectsCorrectionReason) {
      const msg = String(message || "").trim();
      const isRejection = /違う|間違っている|違います|違ってる|違ってます/.test(msg);
      const isOk = /^(はい|うん|ええ|大丈夫|OK|ok|よろしい|合ってる|あってる|いいです|問題ない|それでいい|それでいいです|大丈夫です|合っています|あっています)$/i.test(msg);

      if (conversationState[conversationId].confirmationPending && isRejection) {
        conversationState[conversationId].confirmationPending = false;
        conversationState[conversationId].expectsCorrectionReason = true;
        const reply = "他に気になることがあれば、なんでも言ってください。";
        conversationHistory[conversationId].push({ role: "user", content: message });
        conversationHistory[conversationId].push({ role: "assistant", content: reply });
        const slotsFilledCount = countFilledSlots(state.slotFilled, state);
        const level = finalizeRiskLevel(state);
        return res.json({
          message: reply,
          response: reply,
          judgeMeta: {
            judgement: level,
            confidence: state.confidence,
            ratio: state.decisionRatio || 0,
            shouldJudge: true,
            slotsFilledCount,
            decisionAllowed: true,
            questionCount: state.questionCount,
            summaryLine: null,
            questionType: null,
            rawScore: state.lastPainScore,
            painScoreRatio: state.lastPainWeight,
          },
          triage_state: buildTriageState(true, level, slotsFilledCount),
          questionPayload: null,
          normalizedAnswer: state.lastNormalizedAnswer || null,
          locationPromptMessage,
          locationRePromptMessage,
          locationSnapshot: state.locationSnapshot,
          conversationId,
        });
      }

      conversationState[conversationId].confirmationPending = false;
      conversationState[conversationId].expectsCorrectionReason = false;
      if (!isOk && msg.length > 2) {
        (conversationState[conversationId].confirmationExtraFacts =
          conversationState[conversationId].confirmationExtraFacts || []).push(msg);
      }
      // user message will be pushed below in normal flow
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
        if (rawScore >= 8) weight = 2.0;
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
    const maxQuestions = 7;
    const currentQuestionCount = conversationState[conversationId].questionCount;
    const { ratio, level, confidence, shouldJudge, slotsFilledCount } = judgeDecision(
      conversationState[conversationId]
    );
    // 強制仕様: 6スロット充填完了時のみ判定・まとめを許可
    const decisionAllowed = slotsFilledCount >= getRequiredSlotCount(conversationState[conversationId]);
    // 絶対ルール: 初回ユーザーターンでは絶対にまとめを出さない（2ターン未満も禁止）
    const minUserTurnsForSummary = 2;
    const canShowSummary = !isFirstUserTurn && userTurnCount >= minUserTurnsForSummary;
    const shouldJudgeNow =
      shouldJudge &&
      decisionAllowed &&
      canShowSummary;
    const missingSlots = getMissingSlots(conversationState[conversationId].slotFilled, conversationState[conversationId]);
    if (!shouldJudgeNow) {
      const isFirstQuestion =
        conversationState[conversationId].questionCount === 0 &&
        conversationState[conversationId].lastPainScore === null;
      const lastType = conversationState[conversationId].lastQuestionType;
      const reaskSameSlot = lastType && missingSlots.includes(lastType);
      const nextSlot =
        isFirstQuestion
          ? "pain_score"
          : reaskSameSlot
            ? lastType
            : missingSlots[0] || (isFirstUserTurn ? SLOT_KEYS[0] : null);
      if (nextSlot) {
        const useFinalPrefix =
          currentQuestionCount >= minQuestions && missingSlots.length === 1;
        const fixed = buildFixedQuestion(nextSlot, useFinalPrefix);
        const historyText = conversationHistory[conversationId]
          .filter((msg) => msg.role === "user")
          .map((msg) => msg.content)
          .join("\n");
        const category = resolveLockedQuestionCategory(
          conversationState[conversationId],
          historyText
        );
        applyCategoryQuestionOverride(fixed, nextSlot, category, useFinalPrefix);
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
      applyCategoryQuestionOverride(fixed, fallbackSlot, category, false);
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

    // 6スロット完了時: まとめの前に確認を取る（🟢🟡🔴共通）
    if (shouldJudgeNow && !conversationState[conversationId].confirmationShown && !conversationState[conversationId].summaryShown) {
      const historyTextForConfirm = conversationHistory[conversationId]
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      const confirmMsg = buildPreSummaryConfirmationMessage(
        conversationState[conversationId],
        historyTextForConfirm
      );
      conversationHistory[conversationId].push({ role: "assistant", content: confirmMsg });
      conversationState[conversationId].confirmationPending = true;
      conversationState[conversationId].confirmationShown = true;
      conversationState[conversationId].lastOptions = [];
      conversationState[conversationId].lastQuestionType = null;
      const finalLevel = finalizeRiskLevel(conversationState[conversationId]);
      return res.json({
        message: confirmMsg,
        response: confirmMsg,
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
      applyCategoryQuestionOverride(fixed, forcedSlot, category, false);
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
    const scoreContext = `現在の回答数: ${conversationState[conversationId].questionCount}\n判断スロット埋まり数: ${slotsFilledCount}/6\n未充足スロット: ${missingSlots.join(",")}\n確信度: ${confidence}%\n緊急度判定は「危険フラグ優先モデル」を使用する（Phase1: 即時RED条件 / Phase2: 重症指数）。\n重要: 次の質問は未充足スロットのみから1つ選ぶこと。既に埋まったスロットの質問は禁止。質問回数が7以上、または判断スロットが6つ埋まった時点で必ず判定・まとめへ移行する。\n※内部計算はユーザーに表示しないこと。最終判断はまとめ直前の1回のみ実行すること。`;
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

    // 判定確定トリガー発動時は、まとめを強制生成（初回のみ）
    if (shouldJudgeNow && !conversationState[conversationId].summaryShown) {
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
      if (level === "🔴") {
        // 症状に合わせて受診先候補を選ぶ（歯痛→歯科、耳/鼻/喉→耳鼻科、基本はGP）
        conversationState[conversationId].clinicCandidates = await resolveCareCandidates(
          conversationState[conversationId],
          careDestination
        );
        // 「病院」候補は引き続き別枠で取得（重症時の選択肢として保持）
        conversationState[conversationId].hospitalCandidates = await resolveHospitalCandidates(
          conversationState[conversationId]
        );
      }
      conversationState[conversationId].pharmacyCandidates = await resolvePharmacyCandidates(
        conversationState[conversationId]
      );
      const pharmacyRec = buildPharmacyRecommendation(
        conversationState[conversationId],
        locationContext,
        conversationState[conversationId].pharmacyCandidates
      );
      conversationState[conversationId].pharmacyRecommendation = pharmacyRec;
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
        { role: "system", content: buildRepairPrompt(level) },
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
          { role: "system", content: buildRepairPrompt(level) + "\n\n不足ブロックがある場合は必ず補完して、全ブロックを完成させてください。" },
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
            { role: "system", content: buildRepairPrompt(level) },
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
      if (level === "🟢" || level === "🟡") {
        let immediateActionPlan = null;
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
        aiResponse = ensureImmediateActionsBlock(
          aiResponse,
          level,
          conversationState[conversationId],
          historyTextForOtc,
          immediateActionPlan
        );
      }
      aiResponse = ensureOutlookBlock(aiResponse, conversationState[conversationId]);
      aiResponse = enforceYellowOtcPositionStrict(aiResponse, level);
      if (level === "🔴") {
        aiResponse = ensureHospitalMemoBlock(aiResponse, conversationState[conversationId], historyTextForOtc);
        aiResponse = ensureRedImmediateActionsBlock(aiResponse, conversationState[conversationId], historyTextForOtc);
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
          aiResponse = buildLocalSummaryFallback(
            level,
            conversationHistory[conversationId],
            conversationState[conversationId]
          );
        }
      }
      if (!validateSummaryAgainstNormalized(aiResponse, conversationState[conversationId])) {
        aiResponse = buildLocalSummaryFallback(
          level,
          conversationHistory[conversationId],
          conversationState[conversationId]
        );
      }
      aiResponse = ensureGreenHeaderForYellow(aiResponse, level);
      if (!hasAllSummaryBlocks(aiResponse)) {
        aiResponse = buildLocalSummaryFallback(
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
      aiResponse = sanitizeSummaryQuestions(aiResponse);
      aiResponse = enforceSummaryIntroTemplate(aiResponse);
      aiResponse = enforceSummaryStructureStrict(
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
      const decisionType =
        level === "🔴"
          ? "A_HOSPITAL"
          : level === "🟡"
            ? "B_PHARMACY"
            : "C_WATCHFUL_WAITING";
      conversationState[conversationId].summaryShown = true;
      conversationState[conversationId].hasSummaryBlockGenerated = true;
      conversationState[conversationId].decisionType = decisionType;
      conversationState[conversationId].decisionLevel = level;
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
      if (decisionType === "C_WATCHFUL_WAITING") {
        conversationState[conversationId].followUpPhase = "questioning";
        conversationState[conversationId].followUpStep = 1;
        followUpQuestion = "今できることを、理由と一緒に整理しますか？";
      } else {
        conversationState[conversationId].followUpPhase = "questioning";
        conversationState[conversationId].followUpStep = 1;
        const destinationName =
          decisionType === "A_HOSPITAL"
            ? conversationState[conversationId].hospitalRecommendation?.name
            : conversationState[conversationId].pharmacyRecommendation?.name;
        conversationState[conversationId].followUpDestinationName = formatDestinationName(
          destinationName,
          decisionType
        );
        followUpQuestion = buildFollowUpQuestion1(
          conversationState[conversationId].followUpDestinationName
        );
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
      const nextSlot = isFirstQuestion ? "pain_score" : (reaskSameSlot ? lastType : missingSlots[0]);
      if (nextSlot) {
        const useFinalPrefix =
          currentQuestionCount >= minQuestions && missingSlots.length === 1;
        const fixed = buildFixedQuestion(nextSlot, useFinalPrefix);
        const historyText = conversationHistory[conversationId]
          .filter((msg) => msg.role === "user")
          .map((msg) => msg.content)
          .join("\n");
        const category = resolveLockedQuestionCategory(
          conversationState[conversationId],
          historyText
        );
        applyCategoryQuestionOverride(fixed, nextSlot, category, useFinalPrefix);
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

    // 最後の質問は「最後に〜」で始める（AIが終盤と判断した場合）
    if (
      !shouldJudgeNow &&
      currentQuestionCount >= minQuestions &&
      currentQuestionCount < 7 &&
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

    // まとめブロックが欠けている/出ていない場合は再生成（質問数を満たした後のみ）
    const updatedQuestionCount = conversationState[conversationId].questionCount;
    const updatedLevel = computeUrgencyLevel(
      updatedQuestionCount,
      conversationState[conversationId].totalScore
    ).level;
    if (updatedQuestionCount >= minQuestions && !isQuestionResponse(aiResponse)) {
      const needsRepair = !hasAllSummaryBlocks(aiResponse);
      if (needsRepair) {
        const repairMessages = [
          { role: "system", content: buildRepairPrompt(updatedLevel) },
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

    // Add AI response to history
    conversationHistory[conversationId].push({
      role: "assistant",
      content: aiResponse,
    });
    if (followUpMessage) {
      conversationHistory[conversationId].push({
        role: "assistant",
        content: followUpMessage,
      });
    }
    if (followUpQuestion) {
      conversationHistory[conversationId].push({
        role: "assistant",
        content: followUpQuestion,
      });
    }

    const finalRisk = conversationState[conversationId].decisionLevel || level;
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
    const sections =
      shouldJudgeNow
        ? extractSectionsBySpecs(
            aiResponse,
            getSummarySectionSpecsByJudgement(finalRisk)
          ).map((entry) => entry.text)
        : [];
    res.json({
      message: aiResponse,
      response: aiResponse,
      judgeMeta,
      triage,
      triage_state,
      sections,
      questionPayload,
      normalizedAnswer,
      followUpQuestion,
      followUpMessage,
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
    if (state && filled >= getRequiredSlotCount(state)) {
      const level = state.decisionLevel || finalizeRiskLevel(state);
      const fallbackSummary = enforceSummaryStructureStrict(
        buildLocalSummaryFallback(level, history, state),
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
      return res.status(200).json({
        conversationId: cid,
        message: fallbackSummary,
        response: fallbackSummary,
        triage,
        triage_state,
        sections,
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
        questionPayload: null,
        normalizedAnswer: state.lastNormalizedAnswer || null,
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
      const message = buildRedModalContent(state, historyText);
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
    const fallbackState = cid ? getOrInitConversationState(cid) : null;
    const fallbackHistory = (cid && conversationHistory[cid]) || [];
    const fallbackHistoryText = fallbackHistory
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    if (fallbackState?.decisionLevel === "🔴") {
      return res.status(200).json({
        message: buildRedModalContent(fallbackState, fallbackHistoryText),
        sourcePolicy: [],
      });
    }
    const fallbackParts = [
      buildYellowPsychologicalCushionLine(),
      "",
      "■今すぐやること",
      "・刺激を1つ減らして静かな環境で過ごし、水分を150〜200mlとって4〜6時間の変化を見てください",
      "→ 刺激と脱水の要因を同時に下げると、経過が読み取りやすくなります。",
      "",
      "■やらないほうがいいこと",
      "・つらい状態のまま無理に活動量を上げる",
      "→ 体への負荷が重なると、症状の変化を見極めにくくなるためです。",
    ];
    if (fallbackState && shouldAppendMcLinesToModal(fallbackState)) {
      fallbackParts.push("", ...MC_4_LINES);
    }
    return res.status(200).json({
      message: fallbackParts.join("\n"),
      sourcePolicy: [],
    });
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

// Clear conversation history
app.post("/api/clear", (req, res) => {
  const { conversationId } = req.body;
  if (conversationId && conversationHistory[conversationId]) {
    delete conversationHistory[conversationId];
  }
  if (conversationId && conversationState[conversationId]) {
    delete conversationState[conversationId];
  }
  res.json({ success: true });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasApiKey: !!process.env.OPENAI_API_KEY,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kairo server is running on port ${PORT}`);
  console.log(
    process.env.OPENAI_API_KEY
      ? "✓ OpenAI API key is configured"
      : "⚠ OpenAI API key is not configured. Please set OPENAI_API_KEY in .env file"
  );
});
