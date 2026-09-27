# executable-spec-driven（実行可能仕様駆動開発）

## ワークフローの概要

GitHub Issueを起点に、要件定義 → 実装準備 → 実装まで一貫して進める実行可能仕様駆動開発のワークフローです。
実装前にStorybook / OpenAPI / DBスキーマ / ログ形式などの実行可能な仕様（executable specification）を確定させ、テストコードを仕様書として扱います。
各ステップはスラッシュコマンドで呼び出します。

| ステップ | コマンド | 内容 |
|---|---|---|
| 起票 | `/create-issue` | 機能要件をGitHub Issueとして作成 |
| ステップ2: 要件定義 | `/dev-requirements <issue番号>` | 不明点の確認・API仕様・画面仕様の生成 |
| ステップ3: 実装準備 | `/dev-impl-prep <issue番号>` | テストケースの作成と合意・テスト実装 |
| ステップ4: 実装 | `/dev-impl <issue番号>` | コード実装・セルフレビュー・動作確認 |

各ステップの成果物はGitHub Issueのコメントに自動記録されます。
次のステップを開始する前に、前のステップのコメントが記録されていることを確認してください。

### 自律実行・補助スキル

| コマンド | 内容 |
|---|---|
| `/dev-auto <issue番号>` | ステップ2〜4を自律実行（人間のタッチポイントは仕様合意1回のみ） |
| `/refactor-auto <issue番号>` | リファクタ issue を探索 → 計画承認 → 実装 → レビュー修正ループで自律実行 |
| `/bugfix-auto <issue番号>` | bug issue を再現・原因分析 → 計画承認 → 回帰テスト先行の修正 → レビュー修正ループで自律実行 |
| `/auto-loop [--limit N] [issue番号...]` | 複数の refactoring / bug / skill-improvement issue を内側ワークフローに順次処理させる外側ループ（Herdr 上で実行） |
| `/auto-loop-parallel [--parallel N] [--limit N] [issue番号...]` | `/auto-loop` を issue ごとに並列実行するメタ指揮役 |
| `/compliance-audit [観点...]` | 規約・ADR・仕様・セキュリティの逸脱を固定観点で調査し issue を起票 |
| `/create-branch <issue番号>` | issue からブランチ命名規約に沿ったブランチを作成 |
| `/create-pr` | PR テンプレートに沿って PR を作成 |

自律実行スキルの共通手順（開始時ガード・コメント投稿許可など）は `.claude/skills/_shared/orchestrator-common.md` にまとまっています。

#### 自律実行スキルを使う場合の前提

- GitHub ラベル `refactoring` / `bug` / `skill-improvement` / `documentation` を用意する（`/auto-loop` を使う場合は `auto-loop:escalated` / `auto-loop:log` も）
- `docs/specs/technical-environment.md` の `## 実行コマンド`（テスト・ビルド・型チェック・フォーマット・Lint・CI 相当チェック）を埋める。エージェント・レビュアーはここからコマンドを取得する
- エージェントが実行するテスト・ビルド等のコマンドを `.claude/settings.json` の `permissions.allow` に追加する（許可外の場合はレビュアーが静的確認にフォールバックする）
- `/auto-loop` 系を使う場合:
  - Herdr（ターミナル多重化ツール）を導入し、Herdr 内で起動する。`herdr` / `git` / `gh` をサンドボックスの `excludedCommands` に含める必要がある（プロジェクトごとに判断して設定する）
  - worktree 作成・削除スクリプト（`scripts/wt-new.sh` / `scripts/wt-rm.sh`）を用意する。求める振る舞いは `.claude/skills/auto-loop/SKILL.md` の「worktree スクリプトの前提」を参照
  - 自動マージは `CLAUDE.md` で `/auto-loop` による自動マージを明示的に許可した場合のみ行われる。許可がなければ条件判定の記録にとどめ、マージは人間に引き渡す

### 安全装置（フック）

`.claude/settings.json` で以下のフックを登録しています。

| ファイル | タイミング | 内容 |
|---|---|---|
| `.claude/block-destructive-commands.mjs` | PreToolUse（Bash） | 強制 push・hard reset・未コミット変更の破棄など、回復不能な操作を決定論的にブロック |
| `.claude/detect-fabrication.mjs` | Stop / SubagentStop | ツールを呼ばずに結果を捏造した応答を検知して警告 |

動作を変更したら `node --test .claude/*.test.mjs` で回帰確認してください。

---

## 導入方法

対象プロジェクトのルートで以下を実行します。

```bash
# このリポジトリをクローン
git clone https://github.com/nakajima97/executable-spec-driven.git

# 対象プロジェクトのルートに移動
cd /path/to/your-project

# インストールスクリプトを実行
bash /path/to/executable-spec-driven/install.sh
```

スクリプトは以下を行います:

1. `.claude/` ディレクトリ（スキルファイル群）を対象プロジェクトにコピー
2. ワークフローに必要なドキュメントファイルが揃っているかチェック

不足しているファイルがある場合はスクリプト終了時に一覧が表示されます。下記「ワークフローを使う前に準備するもの」を参考に作成してください。

---

## ワークフローを使う前に準備するもの

このワークフローを使って開発を始める前に、対象プロジェクトに以下のファイルを用意してください。

### 必須ファイル

#### `CLAUDE.md`（プロジェクトルート）
Claude Code向けの指示ファイル。以下を記述する:
- プロジェクト固有のコーディング規約
- やってはいけないこと（禁止事項）
- Claude への作業上の注意事項

#### `docs/architecture/overview.md`
システム全体に関わる設計方針。以下を記述する:
- システム全体構成（フロント / バック / DB / 外部サービス）
- 技術選定とその根拠
- レイヤー構成・責務分離の方針
- 認証・認可の方式
- フロントエンド↔バックエンドのAPI連携方針

#### `docs/architecture/frontend/`
| ファイル | 内容 |
|---|---|
| `directory-structure.md` | フロントエンドのディレクトリ設計とフォルダの役割 |
| `dev-environment.md` | 開発環境の構築手順・ツール・設定 |
| `naming-conventions.md` | ファイル名・コンポーネント名・変数名などの命名規則 |

#### `docs/architecture/backend/`
| ファイル | 内容 |
|---|---|
| `directory-structure.md` | バックエンドのディレクトリ設計とフォルダの役割 |
| `dev-environment.md` | 開発環境の構築手順・ツール・設定 |
| `naming-conventions.md` | ファイル名・クラス名・関数名などの命名規則 |

#### GitHub Issue
各開発タスクに対してIssueを事前に作成する。ワークフローの各ステップが成果物をIssueコメントに記録するため、開発開始前にIssueが存在している必要がある。

---

### ワークフロー中に自動生成されるファイル

以下はワークフローの各ステップで自動的に作成されます。事前準備は不要です。

| ステップ | 生成・更新されるファイル |
|---|---|
| 2. 要件定義 | `docs/specs/api-list.md`、`docs/specs/openapi.yaml`、`docs/specs/screen-list.md`、`docs/specs/screen-transition.md`、`docs/specs/er-diagram.md`（変更がある項目のみ）、APIスケルトン・画面コンポーネントのProps定義（実際のコードベース内） |
| 3. 実装準備 | テストコード（実際のコードベース内、既存テストパターンに従った場所） |
| 4. 実装 | 補助テストコード・実装コード（実際のコードベース内） |
