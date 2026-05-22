---
description: フレームワーク非依存の汎用ルール（コミット規約・サンドボックス・フォーマット・ライブラリインストール）
alwaysApply: true
---

# コアルール

このプロジェクトで作業する際に常に適用される、フレームワーク非依存の運用ルール。

## コミット規約

- コミットメッセージの先頭には issue 番号を付ける
  - 例: issue 番号が 7 のブランチでは `#7 xxx` の形式で書く
- 関連 issue がない作業（メンテナンス・ドキュメント単独修正など）は `chore:` / `docs:` などの conventional commits プレフィックスを使ってよい

## フォーマット・コード整形

- フォーマッタ（biome / prettier / pint / black 等）の整形は自己判断で実行しない
  - 整形は CI で検証され、通過しなければマージできないようにする運用を前提とする
  - 都度ローカルで動かす必要はない
- どうしても先に整形したい場合のみユーザーに確認したうえで実行する

## ライブラリのインストール

新規ライブラリの追加は必ずユーザーの承認を得ること。

承認が必要なコマンド例:
- `npm install <pkg>` / `npm add <pkg>`
- `yarn add <pkg>`
- `pnpm add <pkg>`
- `bun add <pkg>`
- `composer require <pkg>`
- `pip install <pkg>` / `uv add <pkg>` / `poetry add <pkg>`
- `cargo add <pkg>`
- `go get <pkg>`

承認不要なコマンド（ロックファイルからの単純復元）:
- `npm install`（パッケージ名なし）
- `pnpm install`（パッケージ名なし）
- `composer install`（パッケージ名なし）
- `pip install -r requirements.txt`
- `uv sync` / `poetry install`

## サンドボックスの取り扱い

- サンドボックスは絶対に無効化しない（`dangerouslyDisableSandbox` を勝手に付けない）
- サンドボックスが原因で操作できない場合は、その旨を必ずユーザーに伝え、人間に操作を依頼する
- 「タスクを進めるため」を理由にサンドボックスを解除することは禁止

## 外部ドキュメントの参照順序

ライブラリやフレームワークの仕様確認時は以下の順序で参照する:

1. プロジェクト内のドキュメント（`docs/` 配下・`README.md`・各種設定ファイル）
2. 公式ドキュメント（Context7 等の MCP が利用可能ならそれを優先）
3. ライブラリのソースコード
4. Web 上の解説記事

3 以降を使う場合はユーザーの承認を得る。

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
