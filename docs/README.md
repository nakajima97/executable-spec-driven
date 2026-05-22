# docs

実行可能仕様駆動開発で運用するドキュメント群。

## ディレクトリ・ファイル一覧

| パス | 概要 |
|---|---|
| [workflow/](workflow/) | 実行可能仕様駆動開発ワークフローの定義・参考資料 |
| [template/](template/) | ワークフロー実行時に `docs/specs/` などへコピーして使うテンプレート |
| [examples/](examples/) | 実プロジェクトで使われている設定・スクリプトの設計パターンと参考実装 |
| `architecture/`（プロジェクト追加） | 各プロジェクト固有のアーキテクチャ設計（ディレクトリ構造・命名規則等） |
| `specs/`（ワークフローで自動生成） | 確定した仕様。画面一覧・API一覧・ER図・OpenAPI定義など |
| `adr/`（必要に応じて追加） | Architecture Decision Record（重要な設計判断の記録） |
| `technical-environment.md`（プロジェクト追加） | 言語・ランタイム・フレームワーク・DB等の技術スタック |

## このリポジトリの位置づけ

本リポジトリは「実行可能仕様駆動開発」のテンプレート・メタリポジトリ。
個別プロジェクトでは:

1. このリポジトリの `docs/` 構造を踏襲する
2. `docs/template/` のファイルを `docs/specs/` にコピーしてワークフローで埋めていく
3. `docs/template/technical-environment.md` を `docs/technical-environment.md` にコピーしてプロジェクト固有の技術スタックを記述する
4. `docs/architecture/` をプロジェクト固有に作成する
5. 重要な設計判断が発生したら `docs/adr/` に ADR を残す

## ADR（Architecture Decision Record）の運用

設計判断の理由を後から追えるようにするための記録。

### ファイル命名

`docs/adr/NNNN-short-kebab-title.md`

- `NNNN`: 4桁の連番（`0001` から開始）
- `short-kebab-title`: 内容を短く表すケバブケース

例: `docs/adr/0001-no-direct-fk-between-tickets-and-entries.md`

### フォーマット

`docs/template/adr-template.md` をコピーして埋める。最低限以下のセクションを持つ:

- ステータス（`提案中` / `承認済み` / `却下` / `非推奨`）
- コンテキスト（背景・前提）
- 決定（何を決めたか）
- 理由（なぜそう決めたか）
- 影響（決定の結果として発生するトレードオフ・今後の課題）

### 書く対象

以下のような判断は ADR に残す:

- DB設計の非自明な選択（FK持たない・正規化方針・JSONカラム採用など）
- アーキテクチャ境界の引き方（モジュール分割方針・依存方向など）
- 採用ライブラリ・フレームワークの選定理由（複数候補から1つを選んだとき）
- パフォーマンス・運用上のトレードオフを伴う判断

「コードを読めばわかること」「自明な判断」は書かない。

## 並行開発のベストプラクティス（参考）

複数 issue を並列に進める場合、`git worktree` を活用してブランチを物理的に分離する運用が有効。
worktree 作成と同時に Docker コンテナのポート・DB 名を自動割り当てする補助スクリプトの設計パターンを [examples/README.md](examples/README.md) にまとめている。

各プロジェクトでは、そのパターンに従って自プロジェクトのフレームワークに合わせた `scripts/wt-new.sh` / `scripts/wt-rm.sh` を作る運用を推奨する。
