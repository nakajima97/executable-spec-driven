#!/usr/bin/env node
// 捏造検出フック（Stop / SubagentStop 用）
//
// 役割:
//   refactor-auto / dev-auto などの自律ループ中に、モデルがツール（Read / Grep 等）を
//   実際に呼ばずに「ツール結果らしきテキスト」を捏造して応答へ書き込む失敗モードを、
//   機械的に検出して警告する。
//
// 検査対象:
//   トランスクリプト JSONL の「末尾 assistant メッセージの text ブロックのみ」。
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

// --- 検出しきい値（運用調整はここを変更する） ---
// 行番号+タブ（cat -n / Read 形式）は日本語文章と衝突しにくいが、
// 誤検知を抑えるため一定行数以上の連続で初めて検出とみなす。
const LINE_NUMBER_TAB_MIN_MATCHES = 3;

// --- 検出マーカー定義 ---
// system-reminder タグ: 注入される system-reminder を assistant が再現・捏造した兆候。1 件で検出。
const SYSTEM_REMINDER_RE = /<system-reminder/;
// ツール結果記号 ⎿（U+23BF）: CLI 上のツール結果表示を assistant が再現した兆候。1 件で検出。
const TOOL_RESULT_GLYPH_RE = /⎿/u;
// 行番号+タブ（cat -n / Read 形式）: 先頭 0〜8 個の空白 + 数字 + タブ。
const LINE_NUMBER_TAB_RE = /^\s{0,8}\d+\t/gm;

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
 * トランスクリプト（JSONL）から末尾の assistant メッセージのテキストを抽出する。
 * 見つからない場合や失敗時は空文字を返す。
 */
function extractLastAssistantText(transcriptPath) {
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return "";
  }

  const lines = raw.split("\n");
  let lastAssistant = null;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      // 破損行はスキップ
      continue;
    }
    const isAssistant =
      entry?.type === "assistant" || entry?.message?.role === "assistant";
    if (isAssistant) {
      lastAssistant = entry;
    }
  }

  if (!lastAssistant) return "";

  const content = lastAssistant.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    // text ブロックのみを連結（thinking / tool_use は無視）
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/**
 * テキストを検査し、検出したマーカー名の配列を返す（空配列なら未検出）。
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
 * 警告文を組み立てる。
 */
function buildWarning(detected) {
  return [
    `[捏造検出] 直近の応答にツール結果らしきテキストを検出しました（${detected.join(" / ")}）。`,
    "ツールを実際に呼ばずに Read / Grep 等の結果を推測・再現して書いていないか確認してください。",
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

  const text = extractLastAssistantText(transcriptPath);
  if (!text) return;

  const detected = detectMarkers(text);
  if (detected.length === 0) return; // 未検出 → 何も出力せず exit 0

  const warning = buildWarning(detected);
  // stdout: ユーザー可視の主手段（1 行 JSON）
  process.stdout.write(`${JSON.stringify({ systemMessage: warning })}\n`);
  // stderr: 従（ログ・端末表示）
  process.stderr.write(`${warning}\n`);
}

try {
  main();
} catch {
  // 想定外のエラーでも fail-open（ループを止めない）
}
process.exit(0);
