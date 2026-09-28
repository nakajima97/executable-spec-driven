#!/usr/bin/env node
// 捏造検出フック（Stop / SubagentStop 用）
//
// 役割:
//   refactor-auto / dev-auto などの自律ループ中に、モデルがツール（Read / Grep 等）を
//   実際に呼ばずに「ツール結果らしきテキスト」を捏造して応答へ書き込む失敗モードを、
//   機械的に検出して警告する。
//
// 検出パターン:
//   1. マーカー混入: ツール結果にしか現れないはずのマーカー文字列
//      （<system-reminder / ⎿ / 行番号+タブ）が assistant text に含まれる
//   2. 実在しないツール結果への言及: ツール結果に言及しているのに、トランスクリプトに
//      tool_use / tool_result エントリが 1 件も存在しない
//   3. 実在しないタスク通知への言及: タスク通知の受領に言及しているのに、トランスクリプトに
//      task-notification エントリが 1 件も存在しない
//   4. インジェクション主張の照合: 「プロンプトインジェクションを検出した」旨の主張で
//      引用された文言が、実際の tool_result / user エントリのどこにも存在しない
//   5. usage 無し completed 通知: <usage> ブロックの無い completed 通知（サブエージェントの
//      途中通知。報告内容が架空の可能性が高い）を受けた状態での完了報告
//      ※ Background command の completed 通知は usage が付かないのが正常なので除外する
//
// 検査対象:
//   トランスクリプト JSONL の「末尾ターン（最後のユーザー実入力・通知以降）の
//   assistant text ブロック」。捏造テキストはツール呼び出しと同一メッセージの text にも
//   現れる（2026-07-12 のインシデント実例）ため、末尾 1 メッセージではなくターン全体を見る。
//   正当な tool_result は user ロールにしか現れないため、assistant の text だけを見れば
//   正当なツール結果を誤検知しない。thinking / tool_use / tool_result は検査しない。
//
// 運用方針:
//   - 警告運用（非ブロッキング）。検出しても exit 0 で、ループ自体は止めない。
//   - あらゆる異常系（stdin 破損・transcript 欠損・ファイル未存在・パース失敗など）でも
//     exit 0（fail-open）。フックがワークフローを壊さないことを最優先する。
//   - ユーザーへの可視化は stdout の JSON（systemMessage）を主、stderr を従とする。
//   - decision: "block" は使わない。

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// --- 検出しきい値（運用調整はここを変更する） ---
// 行番号+タブ（cat -n / Read 形式）は日本語文章と衝突しにくいが、
// 誤検知を抑えるため一定行数以上の連続で初めて検出とみなす。
const LINE_NUMBER_TAB_MIN_MATCHES = 3;
// インジェクション主張の照合対象とする引用の最小長（空白除去後）。
// 短い引用はファイル名・一般語と衝突しやすいため照合しない。
const INJECTION_QUOTE_MIN_LENGTH = 8;

// --- 検出マーカー定義（パターン1） ---
// system-reminder タグ: 注入される system-reminder を assistant が再現・捏造した兆候。1 件で検出。
const SYSTEM_REMINDER_RE = /<system-reminder/;
// ツール結果記号 ⎿（U+23BF）: CLI 上のツール結果表示を assistant が再現した兆候。1 件で検出。
const TOOL_RESULT_GLYPH_RE = /⎿/u;
// 行番号+タブ（cat -n / Read 形式）: 先頭 0〜8 個の空白 + 数字 + タブ。
const LINE_NUMBER_TAB_RE = /^\s{0,8}\d+\t/gm;

// --- 言及検出定義（パターン2・3） ---
// ツール結果への言及
const TOOL_RESULT_MENTION_RE = /ツール(の)?結果|tool[_ ]?result/i;
// タスク通知への言及（語）
const NOTIFICATION_WORD_RE = /task[-_ ]?notification|タスク通知|完了通知|完了の通知/i;
// 通知の受領・根拠化（過去・完了の文脈）。この文脈がある文だけを言及とみなす
const NOTIFICATION_RECEIVED_RE =
  /来(た|てい|まし)|届(い|き)|受け取っ|受領|受信|によると|の通り|のとおり|を確認|が返っ|が上がっ/;
// 通知待ち（未来・仮定）の文脈。「完了通知を待ちます」等の正当な表現を除外する
const NOTIFICATION_WAITING_RE =
  /待(ち|っ|つ)|来たら|来るまで|来次第|届いたら|届き次第|受け取ったら|ポーリング/;

// --- インジェクション主張定義（パターン4） ---
const INJECTION_CLAIM_RE = /(プロンプト|prompt)[\s・=-]*(インジェクション|injection)/i;
const INJECTION_CONTEXT_RE = /検出|検知|発見|警告|疑い|疑わ|注入|仕込|混入|埋め込/;
// 引用抽出: 「…」・`…`・"…" の中身
const QUOTE_RE = /「([^」]+)」|`([^`]+)`|"([^"]+)"/g;

// --- 通知・完了報告定義（パターン5） ---
const NOTIFICATION_BLOCK_RE = /<task-notification>[\s\S]*?<\/task-notification>/g;
// Background command（Bash run_in_background）の完了通知は usage が付かないのが正常
const BACKGROUND_COMMAND_SUMMARY_RE = /^Background command /;
// 完了報告らしい表現（実体側条件が強いため広めでよい）
const COMPLETION_REPORT_RE = /完了|完成|済み|成功|マージ|finished|completed|done|green/i;

/**
 * stdin を最後まで読み取って文字列で返す。
 */
function readStdin() {
  try {
    // fd 0 を同期読み取り（フック実行時は stdin に JSON が渡される）
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * 照合用にテキストから空白類をすべて除去する。
 * 引用時の改行位置・インデントの違い（Read 結果の行番号剥がし等）に頑健にするため。
 */
function normalizeForMatch(text) {
  return text.replace(/\s+/g, "");
}

/**
 * エントリが assistant ロールかを判定する。
 */
function isAssistantEntry(entry) {
  return entry?.type === "assistant" || entry?.message?.role === "assistant";
}

/**
 * JSONL の行配列をエントリ配列にパースする（破損行はスキップ）。
 */
function parseLines(lines) {
  const entries = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 破損行はスキップ
    }
  }
  return entries;
}

/**
 * user エントリのテキスト内の task-notification ブロックを走査し、
 * 「usage ブロックの無い completed 通知」を suspicious（Map<taskId, summary>）へ記録する。
 * 同一 task-id で usage 付き completed 通知が後から来た場合は本物の完了とみなし解除する。
 */
function recordTaskNotifications(text, suspicious) {
  const blocks = text.match(NOTIFICATION_BLOCK_RE);
  if (!blocks) return;
  for (const block of blocks) {
    const status = (block.match(/<status>([^<]*)<\/status>/) || [])[1];
    if (status !== "completed") continue;
    const summary = ((block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || "").trim();
    if (BACKGROUND_COMMAND_SUMMARY_RE.test(summary)) continue;
    const taskId = ((block.match(/<task-id>([^<]*)<\/task-id>/) || [])[1] || "").trim();
    const key = taskId || summary;
    if (block.includes("<usage>")) {
      suspicious.delete(key);
    } else {
      suspicious.set(key, summary);
    }
  }
}

/**
 * エントリ配列を 1 パスで走査し、検出に必要な情報を集計する。
 *
 * 返り値:
 *   - lastTurnText: 末尾ターン（最後のユーザー実入力・通知以降）の assistant text 連結
 *   - hasToolActivity: tool_use / tool_result エントリが 1 件以上あるか
 *   - hasTaskNotification: task-notification を含む user エントリが 1 件以上あるか
 *   - suspiciousNotifications: 未解決の「usage 無し completed 通知」（Map<taskId, summary>）
 *   - entries: パース済みエントリ（インジェクション照合コーパスの遅延構築用）
 */
function computeStats(entries) {
  const lastTurnTexts = [];
  let hasToolActivity = false;
  let hasTaskNotification = false;
  const suspiciousNotifications = new Map();

  for (const entry of entries) {
    if (isAssistantEntry(entry)) {
      const content = entry.message?.content;
      if (typeof content === "string") {
        lastTurnTexts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "text" && typeof block.text === "string") {
            lastTurnTexts.push(block.text);
          }
          if (block?.type === "tool_use") {
            hasToolActivity = true;
          }
        }
      }
      continue;
    }

    if (entry?.type === "user" || entry?.message?.role === "user") {
      const content = entry.message?.content;
      let isToolResult = false;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        isToolResult = content.some((block) => block?.type === "tool_result");
        text = content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("\n");
      }
      if (isToolResult) {
        hasToolActivity = true;
      }
      if (text.includes("<task-notification>")) {
        hasTaskNotification = true;
        recordTaskNotifications(text, suspiciousNotifications);
      }
      if (!isToolResult) {
        // ユーザー実入力またはタスク通知 → 新しいターンの開始
        lastTurnTexts.length = 0;
      }
    }
  }

  return {
    lastTurnText: lastTurnTexts.join("\n"),
    hasToolActivity,
    hasTaskNotification,
    suspiciousNotifications,
    entries,
  };
}

/**
 * トランスクリプト（JSONL）を読み取って集計する。読み取り失敗時は null を返す。
 */
function parseTranscript(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  return computeStats(parseLines(raw.split("\n")));
}

/**
 * 値の中の文字列を再帰的に収集する（toolUseResult 等の構造化データ用）。
 */
function collectStrings(value, parts, depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, parts, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, parts, depth + 1);
  }
}

/**
 * インジェクション主張の照合コーパスを構築する。
 * 非 assistant エントリ（user テキスト・tool_result・toolUseResult・system 等）のテキストを
 * 連結し、空白正規化して返す。主張検出時のみ呼ぶ（通常ターンのオーバーヘッドを増やさないため）。
 */
function buildNonAssistantCorpus(entries) {
  const parts = [];
  for (const entry of entries) {
    if (isAssistantEntry(entry)) continue;
    if (typeof entry?.content === "string") {
      parts.push(entry.content);
    }
    if (entry?.toolUseResult != null) {
      collectStrings(entry.toolUseResult, parts);
    }
    const content = entry?.message?.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block?.text === "string") {
          parts.push(block.text);
        }
        if (block?.type === "tool_result") {
          if (typeof block.content === "string") {
            parts.push(block.content);
          } else if (Array.isArray(block.content)) {
            for (const inner of block.content) {
              if (typeof inner?.text === "string") parts.push(inner.text);
            }
          }
        }
      }
    }
  }
  return normalizeForMatch(parts.join("\n"));
}

/**
 * パターン1: テキストを検査し、検出したマーカー名の配列を返す（空配列なら未検出）。
 */
function detectMarkers(text) {
  const detected = [];
  if (SYSTEM_REMINDER_RE.test(text)) {
    detected.push("system-reminder タグ");
  }
  if (TOOL_RESULT_GLYPH_RE.test(text)) {
    detected.push("ツール結果記号 ⎿");
  }
  const lineNumberMatches = text.match(LINE_NUMBER_TAB_RE);
  if (lineNumberMatches && lineNumberMatches.length >= LINE_NUMBER_TAB_MIN_MATCHES) {
    detected.push(`行番号+タブ形式 ${lineNumberMatches.length} 行`);
  }
  return detected;
}

/**
 * パターン2: ツール結果への言及があるのに、トランスクリプトに tool_use / tool_result が
 * 1 件も存在しない場合に検出する。
 */
function detectPhantomToolResultMention(text, stats) {
  if (stats.hasToolActivity) return null;
  if (!TOOL_RESULT_MENTION_RE.test(text)) return null;
  return "ツール結果への言及（トランスクリプトに tool_use / tool_result が存在しない）";
}

/**
 * パターン3: タスク通知の受領への言及があるのに、トランスクリプトに task-notification が
 * 1 件も存在しない場合に検出する。
 * 「完了通知を待ちます」等の未来・待機表現は正当な頻出パターンのため除外する。
 */
function detectPhantomNotificationMention(text, stats) {
  if (stats.hasTaskNotification) return null;
  // 通知ブロックそのものの再現は受領文脈が無くても捏造の兆候
  if (/<task-notification/.test(text)) {
    return "task-notification ブロックの再現（トランスクリプトに task-notification が存在しない）";
  }
  // 文単位で「受領・根拠化の文脈」を判定する
  const sentences = text.split(/(?<=[。！？!?\n])/);
  for (const sentence of sentences) {
    if (!NOTIFICATION_WORD_RE.test(sentence)) continue;
    if (NOTIFICATION_WAITING_RE.test(sentence)) continue;
    if (NOTIFICATION_RECEIVED_RE.test(sentence)) {
      return "タスク通知の受領への言及（トランスクリプトに task-notification が存在しない）";
    }
  }
  return null;
}

/**
 * パターン4: プロンプトインジェクション検出の主張があり、主張の段落内で引用された文言が
 * 実際の tool_result / user エントリのどこにも存在しない場合に検出する。
 * 引用が抽出できない・すべて実在する場合は検出しない（誤検知回避を優先）。
 */
function detectInjectionClaimFabrication(text, getCorpus) {
  if (!INJECTION_CLAIM_RE.test(text) || !INJECTION_CONTEXT_RE.test(text)) return null;

  // 主張を含む段落内の引用だけを照合対象にする（無関係な段落のファイル名引用等を避ける）
  const quotes = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (!INJECTION_CLAIM_RE.test(paragraph)) continue;
    for (const match of paragraph.matchAll(QUOTE_RE)) {
      const quote = match[1] ?? match[2] ?? match[3];
      if (quote && normalizeForMatch(quote).length >= INJECTION_QUOTE_MIN_LENGTH) {
        quotes.push(quote);
      }
    }
  }
  if (quotes.length === 0) return null;

  const corpus = getCorpus();
  const missing = quotes.filter((quote) => !corpus.includes(normalizeForMatch(quote)));
  if (missing.length === 0) return null;

  const sample = missing[0].length > 40 ? `${missing[0].slice(0, 40)}…` : missing[0];
  return `インジェクション検出の主張で引用された文言が実際の入力・ツール結果に存在しない（例:「${sample}」）`;
}

/**
 * パターン5: 未解決の「usage 無し completed 通知」（サブエージェントの途中通知の可能性が高い）
 * が存在する状態で、末尾ターンが完了報告らしい表現を含む場合に検出する。
 * 実データ上、正当な Agent 完了通知には必ず <usage> が付くため、この組み合わせは
 * 「架空の完了報告を根拠に先へ進もうとしている」兆候となる。
 */
function detectNoUsageCompletedReport(text, stats) {
  if (stats.suspiciousNotifications.size === 0) return null;
  if (!COMPLETION_REPORT_RE.test(text)) return null;
  const ids = [...stats.suspiciousNotifications.keys()].join(", ");
  return `usage ブロックの無い completed 通知（${ids}）を根拠とする完了報告の可能性（git/gh の実状態で裏取りすること）`;
}

/**
 * すべての検出パターンを実行し、検出内容の配列を返す（空配列なら未検出）。
 */
function detectAll(stats) {
  const text = stats.lastTurnText;
  const detected = [...detectMarkers(text)];

  const phantomTool = detectPhantomToolResultMention(text, stats);
  if (phantomTool) detected.push(phantomTool);

  const phantomNotification = detectPhantomNotificationMention(text, stats);
  if (phantomNotification) detected.push(phantomNotification);

  // コーパス構築はコストが高いため、主張検出時のみ遅延構築する
  let corpus = null;
  const getCorpus = () => {
    if (corpus === null) corpus = buildNonAssistantCorpus(stats.entries);
    return corpus;
  };
  const injectionClaim = detectInjectionClaimFabrication(text, getCorpus);
  if (injectionClaim) detected.push(injectionClaim);

  const noUsageReport = detectNoUsageCompletedReport(text, stats);
  if (noUsageReport) detected.push(noUsageReport);

  return detected;
}

/**
 * 警告文を組み立てる。
 */
function buildWarning(detected) {
  return [
    "[捏造検出] 直近の応答に捏造の兆候を検出しました:",
    ...detected.map((item) => `- ${item}`),
    "ツールを実際に呼ばずに結果・通知を推測・再現して書いていないか確認してください。",
    "疑わしい場合は続行せず、/clear した上でスキルを再実行し、issue コメントの Step 0 から再開してください。",
    "（この機能自身のコード・ドキュメントを編集・議論している場合はマーカー文字列を扱うため誤検知しうるが、警告のみで無害です）",
  ].join("\n");
}

function main() {
  const stdin = readStdin();
  if (!stdin) return; // 入力なし → 何もせず exit 0

  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return; // stdin 破損 → exit 0
  }

  const transcriptPath = payload?.transcript_path;
  if (!transcriptPath || typeof transcriptPath !== "string") return;

  const stats = parseTranscript(transcriptPath);
  if (!stats || !stats.lastTurnText) return;

  const detected = detectAll(stats);
  if (detected.length === 0) return; // 未検出 → 何も出力せず exit 0

  const warning = buildWarning(detected);
  // stdout: ユーザー可視の主手段（1 行 JSON）
  process.stdout.write(`${JSON.stringify({ systemMessage: warning })}\n`);
  // stderr: 従（ログ・端末表示）
  process.stderr.write(`${warning}\n`);
}

// テストから検出関数を import できるよう、直接実行時のみ main を走らせる
export {
  parseLines,
  computeStats,
  parseTranscript,
  buildNonAssistantCorpus,
  detectMarkers,
  detectPhantomToolResultMention,
  detectPhantomNotificationMention,
  detectInjectionClaimFabrication,
  detectNoUsageCompletedReport,
  detectAll,
  buildWarning,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    // 想定外のエラーでも fail-open（ループを止めない）
  }
  process.exit(0);
}
