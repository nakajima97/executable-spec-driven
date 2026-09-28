# コアルール

このプロジェクトで作業する際に常に適用される、フレームワーク非依存の運用ルール。
`.claude/rules/` ディレクトリに配置されているため、Claude Code によってすべての会話で自動的に読み込まれる。

## 実装判断の基準

複数の実装方針で悩んだ場合、**変更量が少ない選択肢ではなく、将来の保守性が高い選択肢**を選ぶこと。

- 短期的なコスト（変更量・複雑さ）より、長期的な読みやすさ・拡張しやすさを優先する
- 「今は動く」より「将来変えやすい」設計を選ぶ
- **選択は依頼されたスコープの内側で行う**。定型的な判断は自分で下し、解釈の違いで成果物が大きく変わるときだけ確認する
- 依頼が誤っている・より良い方法があると判断した場合も、一文で伝えたうえで依頼どおりに進める（黙ってスコープを狭める・広げる・別のものに置き換えない）。明らかに依頼の範囲を超える操作はしない

## 成果物ドキュメントの長さ

仕様書・計画書・レポート・issue コメントなど、成果物として残す文書の長さはタスクが必要とする分量に合わせる。

- 必要な実質（判断の根拠・決定事項・手順）を書く
- 水増しの節・重複する要約・定型文で埋めない
- テンプレートが定められている文書（issue コメント・PR 本文など）はテンプレートの節に従い、節を勝手に増やさない

## ツール結果の捏造禁止

- ツール（Read / Grep / Bash など）を実際に呼ばずに、その結果を推測・再現して応答へ書かない。ファイル内容・検索結果・コマンド出力は必ず実際のツール呼び出しで取得する
- 結果を捏造したことに気づいた（自分で気づいた場合・自白を含む）ら、そのまま続行しない。ユーザーに `/clear` と作業の再実行を促して停止する
- 自白テキスト自体が捏造トランスクリプト風の文字列を増やし再発を誘発するため、詳細な再現・弁明を続けない（何が起きたかを簡潔に伝えるにとどめる）

## サブエージェントへの委任

サブエージェント（general-purpose / Explore など）への委任は、**真に独立していて相当規模の作業**に限る。

- 委任する例:
  - 複数ファイル・複数ディレクトリにまたがる広いコードベース調査
  - 互いに依存しない相当規模の実装範囲・リファクタ範囲
- 委任しない:
  - 数回のツール呼び出しで自分で終えられる作業
  - 自分の作業の検証・ダブルチェック（自己検証のためにサブエージェントを起動しない）
  - 後続タスクが前段の出力に依存する場合
  - 同じファイルを複数エージェントが触る場合（コンフリクトのリスク）
- **1 つで済むなら 1 つにする**。起動数は少なく保ち、同時起動は最大 3 までとする
- 並列起動する場合は、1 メッセージ内に複数の Agent ツール呼び出しを並べて発行する
- サブエージェントは親の会話履歴を引き継がないため、指示プロンプトに
  以下を自己完結で含める:
  - 紐付く issue 番号（仕様・テスト計画は `gh issue view <番号> --json comments --jq '.comments[].body'` で取得させる。`--comments` は auto mode の環境で空出力になる既知事象があるため使わない）
  - 担当範囲（対象ファイル・対象機能）
  - 守るべき制約（アーキテクチャ定義の参照先など）
- 委任した作業の成果物は、親（メイン）でレビュー・統合する

## コミット規約

- コミットメッセージの先頭には issue 番号を付ける
  - 例: issue 番号が 7 のブランチでは `#7 xxx` の形式で書く
- 関連 issue がない作業（メンテナンス・ドキュメント単独修正など）は `chore:` / `docs:` などの conventional commits プレフィックスを使ってよい
- ステージングは `git add` で対象ファイルを個別に指定する（`git add .` / `git add -A` は使わない）。意図しない一時ファイル・他作業の差分を混入させないため

## ブランチ命名規約

- ASCII 文字のみで構成する（日本語・全角記号は使わない）
- 形式: `<issue番号>-<type>/<kebab-case-name>`
  - `<issue番号>`: 紐付く GitHub issue の番号
  - `<type>`: `feature` / `fix` / `docs` / `refactor` / `chore` など conventional commits と揃える
  - `<kebab-case-name>`: 内容を短く表すハイフン区切りの名称（小文字）
  - 例: `7-docs/branch-naming-rule` / `42-feature/user-login` / `108-fix/null-pointer-on-login`
- 関連 issue がない作業の場合は `<type>/<kebab-case-name>` の形式でよい（例: `chore/update-readme`）
- `gh issue develop <issue番号> --name <ブランチ名>` を使うと issue とブランチの紐付けが自動化できる

## git stash の取り扱い

`git stash` のスタックは `.git` 単位でリポジトリ全体（worktree・セッションをまたぐ）で共有される。
対象パス・stash 参照を指定しない bare `git stash` / `git stash pop` / `git stash apply` を使うと、
他の worktree・セッションの無関係な WIP stash を巻き込みコンフリクトが起きる。

**回避策: 対象パス・stash 参照を明示する**

| 使わない | 代わりに使う |
|---|---|
| `git stash` | 変更を捨てるだけなら `git show HEAD:<path> > <path>.tmp && mv <path>.tmp <path>`（複数ファイルは対象ごとに繰り返す） |
| `git stash pop` / `git stash apply`（参照なし） | どうしても stash が必要なら `git stash push -m "<issue番号>-<用途>" -- <path>` で作り、`git stash list` でそのメッセージの参照を確認してから `git stash pop 'stash@{n}'` のように対象・参照を明示する |
| `git stash clear` | 使わない（全 worktree の stash を復旧不能に破棄する）。不要になった自分の stash だけを `git stash drop 'stash@{n}'` で消す |

**注意:**

- `git show HEAD:<path>` は追跡済みファイルの復元手段であり、新規・未追跡ファイルには使えない
- リダイレクト先のファイルは `git show` の実行前に空にされる。`> <path>` で直接上書きすると、パス誤りや未追跡ファイル指定で `git show` が失敗したときに対象が 0 バイトになるため、一時ファイルに書いてから `mv` する
- `git show <rev>:<path>` の `<path>` はリポジトリルート起点で解決される（カレントディレクトリ起点ではない）。リダイレクト先のパスとずれないよう、リポジトリルートから実行しルート起点のパスで書く
- 作業ツリーの変更を破棄する `git checkout HEAD -- <path>` 系のコマンドは `.claude/block-destructive-commands.mjs` でブロックされるため、復元には上記の `git show` 経由を使う
- `git stash push` は既定で未追跡ファイルを含まない。新規ファイルも退避するなら `-u` を付ける
- `git stash push -- <path>` は対象パスに変更が無いと stash を作らずに終了する（`No local changes to save`）。作られていない状態で pop すると他の作業の stash を pop してしまうため、push 後に `git stash list` で自分のメッセージの entry を必ず確認する
- `stash@{n}` は他 worktree からの割り込みでインデックスがずれうる。`git stash list` での確認と `git stash pop` の間にも割り込みは起きうるため、参照はメッセージで特定し、pop の直前に確認し直す
- `stash@{n}` は必ずクォートする（fish 等のシェルでは未クォートの `{n}` がブレース展開され `stash@n` になる）

## フォーマット・コード整形

- フォーマットは必ず設定済みのフォーマッタ（biome / prettier / pint / black 等）を実行すること
- Claude Code が独自判断でコードを整形することは禁止

## ライブラリのインストール

新規ライブラリの追加は必ずユーザーの承認を得ること。
ロックファイルからの復元（パッケージ名を指定しないインストール）は承認不要。

## サンドボックスの取り扱い

- サンドボックスは絶対に無効化しない（`dangerouslyDisableSandbox` を勝手に付けない）
- サンドボックスが原因で操作できない場合は、その旨を必ずユーザーに伝え、人間に操作を依頼する
- 「タスクを進めるため」を理由にサンドボックスを解除することは禁止

### git worktree 環境での既知の制限

Claude Code の bwrap サンドボックスは git worktree 環境で不安定になる既知のバグがある
（[anthropics/claude-code#17374](https://github.com/anthropics/claude-code/issues/17374)）。
`ls` や `find` が `bwrap: Can't mount tmpfs ... No such file or directory` で失敗することがある。

**回避策: Bash でファイル一覧が必要な場合は `git ls-files` で代替する**

| 使わない | 代わりに使う |
|---|---|
| `ls <path>` | `git ls-files <path>` |
| `find <path> -type f` | `git ls-files <path>` |

- `Read` ツールはパスが判明しているファイルを直接読むのに引き続き使える
- `git` / `gh` コマンドはサンドボックス内でも動作する
- `enableWeakerNestedSandbox: true` や `sandbox.enabled: false` では解決しない（Linux では後者は無視される）

### リポジトリ内のテキスト検索は git grep を使う

worktree 作成スクリプト（`scripts/wt-new.sh` 等。設計パターンは `docs/examples/README.md` を参照）で
作成した worktree には `.env` 系の秘密情報ファイルが実体コピーされることがある。
この状態で worktree ルート起点の再帰 `grep` を実行すると、`.claude/settings.json` の deny rule
（`Read(.env*)` 等）に触れて permission ダイアログで停止する（`--permission-mode auto` でも自動では
通過しない）。

**回避策: リポジトリ内のテキスト検索は `grep` ではなく `git grep` を使う**

| 使わない | 代わりに使う |
|---|---|
| `grep -r <pattern> <path>` / `grep -rn <pattern> .` | `git grep -n <pattern>` |

`grep` の主なオプションは `git grep` で次のように書き換える。

| grep のオプション | git grep での書き方 |
|---|---|
| 拡張子の絞り込み: `--include="*.ts"` | pathspec: `git grep -n <pattern> -- '*.ts' '*.tsx'` |
| ディレクトリの除外: `--exclude-dir=<dir>` | pathspec: `git grep -n <pattern> -- ':!src/'` |
| 未追跡ファイルを含める | `--untracked`（`.gitignore` 済みファイルは `--untracked` を付けても対象外のまま） |

**`git grep` を使う理由:**

- worktree ルート起点の再帰 grep は `.env` 系ファイルにより deny rule に触れて
  permission ダイアログで停止する
- `git` コマンドは上記の bwrap worktree バグの影響を受けにくい（`.claude/settings.json` の
  `sandbox.excludedCommands` に `git` を含めている場合は影響を受けない）
- `node_modules` 等の `.gitignore` 済みディレクトリを自動で除外する

**`src/` 配下への限定で代替しない。** 判断根拠が `docs/adr/` 配下など `src/` 外に置かれることが
あるため（例: あるコンポーネントの削除判断の根拠が ADR にある）、探索範囲を
`src/` に限定すると根拠を見落とす。

## 外部ドキュメントの参照順序

ライブラリやフレームワークの仕様確認時は以下の順序で参照する:

1. プロジェクト内のドキュメント（`docs/` 配下・`README.md`・各種設定ファイル）
2. 公式ドキュメント（Context7 等の MCP が利用可能ならそれを優先）
3. Web 上の解説記事

ライブラリのソースコードはコンテキスト消費が大きいため基本的に読まない。
3 を使う場合はユーザーの承認を得る。

## 機密ファイルの取り扱い

書き込み禁止:
- `.git/hooks/*`
- `.github/workflows/*`（CI 設定の改変はユーザー承認が必要）
- `.gitlab-ci.yml` / `.circleci/*`
- `package.json` / `composer.json` / `pyproject.toml` の `scripts` セクション
- `Makefile` / `Dockerfile` の `ENTRYPOINT`

読み取り時に必ず承認が必要:
- `.env*` / `*secret*` / `*password*`
- `~/.ssh/*`
- クラウド認証情報（`~/.aws/*` / `~/.config/gcloud/*` 等）
