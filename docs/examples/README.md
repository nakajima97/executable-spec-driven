# docs/examples

実プロジェクトで使われている設定・スクリプト類の**設計パターン**を文書化する場所。
個別のフレームワーク向け実装をここに網羅していく方針は取らない（組み合わせが爆発するため）。
**パターンと、参考のための具体例 1 つを残し、新プロジェクトでは AI に「このパターンに従って自プロジェクト用を生成して」と頼む**運用を想定する。

## ディレクトリ・ファイル一覧

| パス | 概要 |
|---|---|
| 本ファイル | パターンの説明と、自プロジェクトへの適用手順 |
| [scripts/wt-new.sh](scripts/wt-new.sh) | **【具体例】** Laravel + Sail + MySQL + Vite + Storybook + pnpm 構成での実装サンプル（`keiba-db-gen2` 出典） |
| [scripts/wt-rm.sh](scripts/wt-rm.sh) | 同上（削除側） |

---

## パターン: 並行開発のための worktree + ポート自動割り当て

複数 issue を並列に進めるとき、各ブランチを git worktree で物理分離しつつ、Docker コンテナのポート・DB 名を自動でずらして衝突を回避するためのパターン。

### 解決したい問題

- 同じリポジトリのブランチを切り替えるたびに `docker compose down` → `up` するのが重い
- 複数 issue を並行で進めると、各ワーキングツリーが同じポートを取り合って衝突する
- 手動でポートをずらすと、どの worktree がどのポートを使っているか分からなくなる

### 設計の構成要素

| 構成要素 | 役割 | 実装ヒント |
|---|---|---|
| `.worktree-registry` ファイル | どの issue がどのオフセット・どのパスを使っているかの単一の真実の源 | プレーンテキスト `issue_num offset worktree_path` を1行1レコードで append。`grep`/`awk` で読み書きできる形式が運用上ラク |
| オフセット採番 | ポート・DB 名のサフィックスとして使う自然数（1, 2, 3...）。registry を見て未使用の最小値を採る | 「使われていない最小の自然数」を選ぶことで、削除→再作成時に番号が安定する |
| ポート式 | `APP_PORT = BASE + offset` のように決定的に算出 | フレームワーク・ポート種別ごとに `BASE` を決めておく（例: APP=8000, Vite=6000, DB=3306） |
| `.env` 書き換え | プロジェクトが参照する環境変数を worktree ごとに書き換える | `key=value` 行があれば置換、なければ append する関数を用意 |
| ブランチ作成 | issue 番号と紐付いたブランチを作成（既にあればそれを使う） | `gh issue develop <num> --name <branch>` が便利 |
| 依存解決 | worktree 作成直後に各パッケージマネージャの install を実行 | 各ツール（composer / pnpm / pip / cargo 等）に合わせる |
| コンテナ停止 | worktree 削除時に対応するコンテナを止めてから `git worktree remove` | 止め忘れるとボリュームやネットワークが残るため必須 |
| `COMPOSE_PROJECT_NAME` ずらし | Docker Compose のネットワーク・ボリューム名を worktree ごとに分離 | offset を含む名前にする（例: `myapp-wt-${offset}`） |

### 想定するインターフェース

```bash
# 新規作成: issue 番号と、紐付けたいブランチ名を渡す
./scripts/wt-new.sh <issue-num> <branch-name>

# 削除: issue 番号で参照
./scripts/wt-rm.sh <issue-num>
```

issue 番号を主キーにすると registry 操作・人間からの想起ともに楽。

### バリエーション

- **DB が複数ある場合**: registry に MySQL / Redis それぞれのポートを記録する形にする（カラム追加）
- **devcontainer / Tilt / Skaffold 利用時**: `COMPOSE_PROJECT_NAME` の代わりに各ツールの namespace 概念を使う
- **モノレポ**: worktree のサブパッケージごとにオフセットを使い分けることも可能だが、まずは「リポジトリ単位で1オフセット」が運用しやすい

---

## 新プロジェクトに取り込む手順（AI 向け）

1. 本 README の「パターン」セクションを読む
2. プロジェクトの `docs/technical-environment.md` または `docs/architecture/` を読み、フレームワーク・パッケージマネージャ・コンテナ管理ツール・必要なポート種別を把握する
3. `scripts/wt-new.sh` / `scripts/wt-rm.sh` を新規作成する。具体例として `docs/examples/scripts/wt-new.sh` を参考にしてよいが、Laravel/Sail/PHP/pnpm 固有のコマンドはそのままコピーしない
4. プロジェクトの README または `docs/` に使い方を追記する
5. `.gitignore` に `.worktree-registry` を追加する（環境固有の状態のため）

---

## 具体例: Laravel + Sail + MySQL + Vite + Storybook + pnpm

`scripts/wt-new.sh` / `scripts/wt-rm.sh` は `keiba-db-gen2` プロジェクトでの実装。
上記パターンが実際にどう書き下されるかの参考として置いている。

このサンプルに含まれる**プロジェクト固有の判断**:

| 箇所 | 固有の判断 | 別構成での代替例 |
|---|---|---|
| `WORKTREE_BASE` をリポジトリの親ディレクトリに置く | `keiba-db-gen2-wt/` という固定名 | プロジェクト名から算出するなど |
| `MAIN_SOURCE="${PROJECT_ROOT}/source"` | `source/` 配下に Laravel プロジェクトを置く構成 | リポジトリ直下にコードを置く構成なら `MAIN_SOURCE=${PROJECT_ROOT}` |
| `docker run laravelsail/php84-composer` で composer install | PHP 依存解決を使い捨てコンテナでやる | Python なら `uv sync` / `pip install`、Node 単独なら不要 |
| `pnpm install --frozen-lockfile` | Node 側は pnpm | npm/yarn/bun に置換 |
| `APP_PORT=800${OFFSET}` の文字列連結 | offset が 1〜9 前提（10 以上で `80010` になる罠あり） | `APP_PORT=$((8000 + OFFSET))` にすると桁が増えても安全 |
| 書き換える `.env` キー | Sail が参照する `COMPOSE_PROJECT_NAME` / `APP_PORT` / `VITE_PORT` / `STORYBOOK_PORT` / `FORWARD_DB_PORT` / `DB_DATABASE` | フレームワークが参照するキーに置換 |
| `./vendor/bin/sail down` | Sail のラッパー | `docker compose down`、`make down`、`devcontainer down` 等 |

このサンプルは「動かすため」ではなく「パターンの具体化例として読むため」に置いている。
このまま自プロジェクトにコピーしても動かないことを前提に、上記の対応表を見ながら書き換えること。
