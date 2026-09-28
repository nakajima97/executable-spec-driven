// block-destructive-commands.mjs の回帰テスト
//
// 実行方法（プロジェクトルートで）:
//   node --test .claude/block-destructive-commands.test.mjs
//
// フックを実際に子プロセスとして起動し、stdin へ PreToolUse の payload を渡して
// stdout の JSON（permissionDecision）を検証する。ルールの追加・調整時は
// このテストにケースを追加してから変更すること。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "block-destructive-commands.mjs",
);

/**
 * フックを子プロセスとして実行し、stdout をパースして返す。
 */
function runHook(stdinText) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    input: stdinText,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `フックは常に exit 0 であること: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Bash コマンドをフックに渡し、deny された場合は permissionDecisionReason を、
 * 通過した場合は null を返す。
 */
function checkCommand(command) {
  const stdout = runHook(
    JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  );
  if (stdout === "") return null;
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny");
  return parsed.hookSpecificOutput.permissionDecisionReason;
}

// --- ブロックされるべきコマンド ---
// [コマンド, 期待するルール id]
const BLOCKED_CASES = [
  // 無条件ブロック: 絶対パス・ホームへの rm -rf
  ["rm -rf /", "rm-recursive-force-outside-repo"],
  ["rm -rf /usr/local/lib", "rm-recursive-force-outside-repo"],
  ["rm -rf ~/projects", "rm-recursive-force-outside-repo"],
  ["rm -rf $HOME", "rm-recursive-force-outside-repo"],
  ["rm -rf ${HOME}/foo", "rm-recursive-force-outside-repo"],
  ["sudo rm -rf /var/log", "rm-recursive-force-outside-repo"],
  ["rm --recursive --force /etc/nginx", "rm-recursive-force-outside-repo"],
  ["rm -fr /tmp/foo", "rm-recursive-force-outside-repo"],
  // 無条件ブロック: 強制 push
  ["git push --force", "git-push-force"],
  ["git push --force origin main", "git-push-force"],
  ["git push -f origin main", "git-push-force"],
  ["git push --force-with-lease", "git-push-force"],
  ["git push --force-if-includes origin main", "git-push-force"],
  ["git push origin +main", "git-push-refspec-force"],
  // 手動実行に委ねる: リポジトリ内の rm -rf
  ["rm -rf node_modules", "rm-recursive-force"],
  ["rm -rf ./dist", "rm-recursive-force"],
  ["rm -r -f build", "rm-recursive-force"],
  ["rm -Rf coverage", "rm-recursive-force"],
  // 手動実行に委ねる: git clean -f
  ["git clean -f", "git-clean-force"],
  ["git clean -fdx", "git-clean-force"],
  ["git clean -d --force", "git-clean-force"],
  // 手動実行に委ねる: git reset --hard
  ["git reset --hard", "git-reset-hard"],
  ["git reset --hard HEAD~1", "git-reset-hard"],
  // 手動実行に委ねる: git restore
  ["git restore .", "git-restore"],
  ["git restore --staged src/index.ts", "git-restore"],
  // 手動実行に委ねる: git checkout によるパス復元
  ["git checkout -- .", "git-checkout-discard"],
  ["git checkout HEAD -- src/backend", "git-checkout-discard"],
  ["git checkout .", "git-checkout-discard"],
  ["git checkout -f main", "git-checkout-discard"],
  // 複合コマンド内の破壊的コマンド
  ["echo done && rm -rf build", "rm-recursive-force"],
  ["cd src; git clean -fd", "git-clean-force"],
  ["true || git reset --hard", "git-reset-hard"],
  ["find . -name '*.tmp' | xargs rm -rf", "rm-recursive-force"],
  ["(git restore .)", "git-restore"],
  ["echo start\ngit reset --hard HEAD", "git-reset-hard"],
];

// --- 通過するべきコマンド ---
const ALLOWED_CASES = [
  "git status",
  "git push",
  "git push origin main",
  "git push -u origin 325-feature/block-destructive-commands-hook",
  "git clean -n",
  "git clean --dry-run",
  "git checkout main",
  "git checkout -b 42-feature/user-login",
  "git checkout --track origin/main",
  "git reset --soft HEAD~1",
  "git reset HEAD src/index.ts",
  "git stash list",
  "rm foo.txt",
  "rm -f foo.txt",
  "rm -r build",
  "pnpm test",
  "grep -r 'restore' src/",
  // 引用符内の破壊的パターン文字列（コマンド区切りを含まない）は誤検知しない
  'echo "git reset --hard は使わない"',
  'git commit -m "rm -rf の説明を追記"',
];

test("破壊的コマンドは deny され、理由と代替手順が返る", () => {
  for (const [command, expectedRuleId] of BLOCKED_CASES) {
    const reason = checkCommand(command);
    assert.ok(reason, `ブロックされるべき: ${command}`);
    assert.ok(
      reason.includes(`ルール: ${expectedRuleId}`),
      `${command} は ${expectedRuleId} でブロックされるべき。実際: ${reason.split("\n")[0]}`,
    );
    assert.ok(
      reason.includes("代替手順"),
      `代替手順が含まれるべき: ${command}`,
    );
  }
});

test("manual カテゴリの理由には git status による確認手順が含まれる", () => {
  const reason = checkCommand("git clean -fd");
  assert.ok(reason.includes("git status"), "git status での確認手順が含まれるべき");
  assert.ok(reason.includes("ユーザー自身が手動で実行"), "手動実行への誘導が含まれるべき");
});

test("forbidden カテゴリの理由には無条件ブロックの説明が含まれる", () => {
  const reason = checkCommand("git push --force");
  assert.ok(reason.includes("無条件でブロック"), "無条件ブロックの説明が含まれるべき");
});

test("非破壊的コマンドは何も出力せず通過する", () => {
  for (const command of ALLOWED_CASES) {
    const reason = checkCommand(command);
    assert.equal(reason, null, `通過するべき: ${command}（実際: ${reason}）`);
  }
});

test("Bash 以外のツールは検査しない", () => {
  const stdout = runHook(
    JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "note.md", content: "rm -rf /" },
    }),
  );
  assert.equal(stdout, "");
});

test("入力異常時は fail-open（exit 0・出力なし）", () => {
  assert.equal(runHook(""), "");
  assert.equal(runHook("{ broken json"), "");
  assert.equal(runHook(JSON.stringify({ tool_name: "Bash" })), "");
  assert.equal(
    runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: 123 } })),
    "",
  );
});
