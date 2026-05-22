#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# 【参考実装】wt-new.sh で作成した worktree を削除するスクリプト
#
# 本ファイルはテンプレリポジトリ executable-spec-driven の docs/examples/ 配下
# にある参考実装です。Laravel + Sail 構成（keiba-db-gen2）で使われていた
# ものをそのまま掲載しています。`./vendor/bin/sail down` の部分など、
# プロジェクトのコンテナ管理コマンドに合わせて書き換えてください。
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REGISTRY="${PROJECT_ROOT}/.worktree-registry"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <issue-num>" >&2
  exit 1
fi

ISSUE_NUM="$1"

if ! [[ "$ISSUE_NUM" =~ ^[0-9]+$ ]]; then
  echo "Error: issue-num must be a positive integer" >&2
  exit 1
fi

if [[ ! -f "$REGISTRY" ]]; then
  echo "Error: .worktree-registry not found at ${REGISTRY}" >&2
  exit 1
fi

REGISTRY_LINE=$(grep -E "^${ISSUE_NUM} " "$REGISTRY" || true)
if [[ -z "$REGISTRY_LINE" ]]; then
  echo "Error: issue ${ISSUE_NUM} not found in registry" >&2
  exit 1
fi

OFFSET=$(echo "$REGISTRY_LINE" | awk '{print $2}')
WORKTREE_PATH=$(echo "$REGISTRY_LINE" | awk '{print $3}')
WT_SOURCE="${WORKTREE_PATH}/source"

echo "==> Removing worktree: issue-${ISSUE_NUM}"
echo "    Path   : ${WORKTREE_PATH}"
echo "    Offset : ${OFFSET}"

if [[ -f "${WT_SOURCE}/vendor/bin/sail" && -f "${WT_SOURCE}/.env" ]]; then
  echo "==> Stopping Docker containers..."
  (cd "${WT_SOURCE}" && ./vendor/bin/sail down 2>/dev/null || true)
else
  echo "    Skipping sail down (sail or .env not found)"
fi

echo "==> Removing git worktree..."
if ! git -C "${PROJECT_ROOT}" worktree remove "${WORKTREE_PATH}" 2>/dev/null; then
  echo ""
  echo "Warning: worktree has uncommitted changes."
  read -r -p "Force remove? [y/N]: " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    git -C "${PROJECT_ROOT}" worktree remove --force "${WORKTREE_PATH}"
  else
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Updating registry..."
TMP_REGISTRY=$(mktemp)
grep -vE "^${ISSUE_NUM} " "$REGISTRY" > "$TMP_REGISTRY"
mv "$TMP_REGISTRY" "$REGISTRY"

echo ""
echo "======================================================"
echo " Worktree removed successfully!"
echo "======================================================"
echo " Issue : #${ISSUE_NUM}"
echo " Path  : ${WORKTREE_PATH}"
echo ""
echo " MySQL volume may remain. To remove:"
echo "   docker volume rm sail-wt-${OFFSET}_sail-mysql"
echo "======================================================"
