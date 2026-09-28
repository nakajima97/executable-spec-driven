#!/usr/bin/env node
// 破壊的コマンドブロックフック（PreToolUse / Bash 用）
//
// 役割:
//   Bash ツールのコマンドを実行前に検査し、破壊的コマンドを決定論的にブロックする。
//   長コンテキストや作話発生時などモデルの判断品質が低下した状態でも、
//   モデル自身の判断に依存しないハーネス側のブロック層として機能する。
//
// 検査方式:
//   コマンド文字列全体への正規表現マッチ。複合コマンド（; && || | サブシェル バッククォート）内の
//   破壊的コマンドも検出する。sudo / command / env / xargs 経由の主要な形はカバーするが、
//   シェル構文の完全な解析は行わない（すり抜けは permissions.deny / sandbox の他層で補う）。
//   引用符内の文字列がコマンド区切り文字を含む場合は誤検知しうるが、
//   偽陰性（すり抜け）の防止を優先して許容する。誤検知時の実行手段はユーザーの手動実行とする。
//
// 運用方針:
//   - ブロックは permissionDecision: "deny" で行い、理由と代替手順を定型メッセージで Claude へ返す
//   - ユーザーが正当に必要とする場合の実行手段はユーザー自身の手動実行。フック側に例外条件は作らない
//   - フックへの入力異常（stdin 破損・想定外の payload など）は exit 0（fail-open）。
//     permissions.deny / sandbox という他の防御層があるため、この層の異常でツール全体を止めない
//   - 動作を変更したら `node --test .claude/block-destructive-commands.test.mjs` で回帰確認する

import { readFileSync } from "node:fs";

// --- 検査ルール一覧（追加・調整はここを変更する） ---
//
// category の意味:
//   forbidden: 回復不能な操作。無条件ブロック
//   manual:    未コミット作業・追跡外ファイルを破棄しうる操作。ブロックし、ユーザーの手動実行に委ねる
//
// pattern はコマンド開始位置（CMD_PREFIX）に続く部分を文字列で書く。
// 上から順に評価して最初にマッチした 1 件を採用するため、
// 同じコマンドに対するより深刻なルール（forbidden）を先に置くこと。
//
// パターン内の [^;&|\n]* は「同一コマンドセグメント内（次の区切りまで）」を表す。

const RULES = [
  {
    id: "rm-recursive-force-outside-repo",
    category: "forbidden",
    summary: "絶対パス・ホームディレクトリを対象とする rm の再帰・強制削除",
    pattern:
      "rm(?=\\s)(?=[^;&|\\n]*\\s(?:-[A-Za-z]*[rR]|--recursive\\b))(?=[^;&|\\n]*\\s(?:-[A-Za-z]*f|--force\\b))(?=[^;&|\\n]*\\s(?:/|~|\\$HOME\\b|\\$\\{HOME\\}))",
  },
  {
    id: "git-push-force",
    category: "forbidden",
    summary: "リモート履歴を書き換える git push --force / -f（--force-with-lease 等を含む）",
    pattern:
      "git\\s+push(?=[^;&|\\n]*\\s(?:--force(?:-with-lease|-if-includes)?\\b|-[A-Za-z]*f))",
  },
  {
    id: "git-push-refspec-force",
    category: "forbidden",
    summary: "+refspec 指定による強制 push",
    pattern: "git\\s+push(?=[^;&|\\n]*\\s\\+\\S)",
  },
  {
    id: "rm-recursive-force",
    category: "manual",
    summary: "rm の再帰・強制削除（リポジトリ内の相対パス）",
    pattern:
      "rm(?=\\s)(?=[^;&|\\n]*\\s(?:-[A-Za-z]*[rR]|--recursive\\b))(?=[^;&|\\n]*\\s(?:-[A-Za-z]*f|--force\\b))",
  },
  {
    id: "git-clean-force",
    category: "manual",
    summary: "追跡外ファイルを削除する git clean -f",
    pattern: "git\\s+clean(?=[^;&|\\n]*\\s(?:--force\\b|-[A-Za-z]*f))",
  },
  {
    id: "git-reset-hard",
    category: "manual",
    summary: "作業ツリーとインデックスを破棄する git reset --hard",
    pattern: "git\\s+reset(?=[^;&|\\n]*\\s--hard\\b)",
  },
  {
    id: "git-restore",
    category: "manual",
    summary: "作業ツリーの変更を破棄しうる git restore",
    pattern: "git\\s+restore\\b",
  },
  {
    id: "git-checkout-discard",
    category: "manual",
    summary:
      "作業ツリーの変更を破棄する git checkout -- <path> / git checkout . / git checkout -f",
    pattern:
      "git\\s+checkout(?:(?=[^;&|\\n]*\\s--(?:\\s|$))|(?=\\s+\\.(?:[\\s/]|$))|(?=[^;&|\\n]*\\s(?:--force\\b|-[A-Za-z]*f)))",
  },
];

// コマンド開始位置: 行頭・コマンド区切り（; & | サブシェル ( ）・バッククォートの直後。
// command / sudo / env / xargs（とその短いオプション）のラッパー越しの実行も同一コマンドとみなす。
const CMD_PREFIX =
  "(?:^|[;&|(]|`)\\s*(?:(?:command|sudo|env|xargs)\\s+(?:-\\S+\\s+)*)*";

const COMPILED_RULES = RULES.map((rule) => ({
  ...rule,
  regexp: new RegExp(CMD_PREFIX + rule.pattern, "m"),
}));

// カテゴリごとの定型メッセージ（理由と代替手順）
const CATEGORY_MESSAGES = {
  forbidden: [
    "理由: 回復不能な破壊的操作のため、このフックは無条件でブロックします。",
    "代替手順: このコマンドを Claude から実行する手段はありません。本当に必要な場合は、ユーザー自身がターミナルで直接実行してください。",
    "フラグ・表現・実行経路を変えた再実行を試みないでください。",
  ],
  manual: [
    "理由: 未コミットの作業や追跡外ファイルを破棄する可能性があるため、Claude からの実行をブロックします。",
    "代替手順: 1. `git status` で現在の状態を確認し、結果と実行したい操作の意図をユーザーに提示する 2. 実行が必要とユーザーが判断した場合、ユーザー自身が手動で実行する",
    "フラグ・表現・実行経路を変えた再実行を試みないでください。",
  ],
};

/**
 * stdin を最後まで読み取って文字列で返す。
 */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * コマンド文字列を検査し、最初にマッチしたルールを返す（マッチなしは null）。
 */
function findMatchedRule(command) {
  for (const rule of COMPILED_RULES) {
    if (rule.regexp.test(command)) {
      return rule;
    }
  }
  return null;
}

/**
 * ブロック理由と代替手順の定型メッセージを組み立てる。
 */
function buildDenyReason(rule) {
  return [
    `[destructive-command-block] コマンドをブロックしました: ${rule.summary}（ルール: ${rule.id}）`,
    ...CATEGORY_MESSAGES[rule.category],
  ].join("\n");
}

function main() {
  const stdin = readStdin();
  if (!stdin) return;

  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    return; // stdin 破損 → fail-open
  }

  if (payload?.tool_name !== "Bash") return;
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || command === "") return;

  const rule = findMatchedRule(command);
  if (!rule) return; // 何も出力しない → 通常の権限フローへ

  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: buildDenyReason(rule),
    },
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

try {
  main();
} catch {
  // 想定外のエラーでも fail-open（他の防御層に委ねる）
}
process.exit(0);
