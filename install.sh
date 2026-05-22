#!/usr/bin/env bash
# Usage: Run from the root of the project you want to set up
#   bash /path/to/executable-spec-driven/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(pwd)"

# ── Step 1: Copy .claude ──────────────────────────────────────────────────────

echo "==> Copying .claude/ to $TARGET_DIR"

if [ -d "$TARGET_DIR/.claude" ]; then
  echo "    .claude/ already exists. Merging skills..."
  mkdir -p "$TARGET_DIR/.claude/skills"
  cp -rn "$SCRIPT_DIR/.claude/skills/"* "$TARGET_DIR/.claude/skills/"
  echo "    Skipping settings.json (already exists)"
else
  cp -r "$SCRIPT_DIR/.claude" "$TARGET_DIR/"
  echo "    Done."
fi

# ── Step 2: Check required files ─────────────────────────────────────────────

echo ""
echo "==> Checking required files"

required_files=(
  "CLAUDE.md"
  "docs/architecture/overview.md"
  "docs/architecture/frontend/directory-structure.md"
  "docs/architecture/frontend/dev-environment.md"
  "docs/architecture/frontend/naming-conventions.md"
  "docs/architecture/backend/directory-structure.md"
  "docs/architecture/backend/dev-environment.md"
  "docs/architecture/backend/naming-conventions.md"
)

missing=()
for f in "${required_files[@]}"; do
  if [ -f "$TARGET_DIR/$f" ]; then
    echo "    [ok] $f"
  else
    echo "    [!!] $f  <-- missing"
    missing+=("$f")
  fi
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if [ ${#missing[@]} -eq 0 ]; then
  echo "All required files are present. You're ready to use the workflow."
else
  echo "${#missing[@]} file(s) are missing. Create them before running the workflow."
  echo "See README.md for what to write in each file."
  exit 1
fi
