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

---

## 導入方法

対象プロジェクトのルートで以下を実行します。

```bash
# このリポジトリをクローン
git clone https://github.com/nakajima97/ai-driven-development.git executable-spec-driven

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
