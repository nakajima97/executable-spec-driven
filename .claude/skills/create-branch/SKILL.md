---
name: create-branch
description: GitHub issue 番号からブランチ名を考えて作成する。「issue127のブランチを作って」「#42のブランチ名を考えて作成して」「create-branch 127」など、issue に紐づく作業ブランチを用意したい場面で必ず使うこと。issue のタイトル・内容から規約準拠のブランチ名を推論し、issue とブランチを紐付けて作成する。
model: sonnet
---

## 概要

引数で渡された GitHub issue 番号を起点に、ブランチ命名規約（`.claude/rules/core.md`）に沿ったブランチ名を推論し、`gh issue develop` で issue に紐付けて作成する。ローカルのカレントブランチは切り替えない（リモート上に issue 紐付けブランチを作成するのみ）。

issue 番号は必須引数。`create-branch 127` のように issue 番号を渡して呼び出す。

**issue が open で存在しない場合は何もしない**（ブランチを作成しない）。

## ブランチ命名規約（`.claude/rules/core.md` より）

- ASCII 文字のみで構成する（日本語・全角記号は使わない）
- 形式: `<issue番号>-<type>/<kebab-case-name>`
  - `<issue番号>`: 紐付く GitHub issue の番号
  - `<type>`: `feature` / `fix` / `docs` / `refactor` / `chore` など conventional commits と揃える
  - `<kebab-case-name>`: 内容を短く表すハイフン区切りの名称（小文字）
  - 例: `7-docs/branch-naming-rule` / `42-feature/user-login` / `108-fix/null-pointer-on-login`

## 手順

### 1. issue 番号を受け取る

引数から issue 番号を取得する。番号が渡されていない場合はユーザーに確認する（それ以外は確認なしで進めてよい）。

### 2. issue の存在と状態を確認する

```bash
gh issue view <番号> --json number,title,state,labels,body
```

- **コマンドが失敗する（issue が存在しない）場合** → 何もしない。「issue #<番号> は存在しないためブランチを作成しません」と伝えて終了する。
- **`state` が `OPEN` でない（`CLOSED` など）場合** → 何もしない。「issue #<番号> は open ではない（<state>）ためブランチを作成しません」と伝えて終了する。

この判定を必ず先に行う。open で存在するときだけ次に進む。

### 3. 既存のリンクブランチを確認する

```bash
gh issue develop --list <番号>
```

- 既にブランチが紐付いている場合は、新規作成せずそのブランチ名を伝え、チェックアウトするか確認する（またはチェックアウトする）。
- 紐付いたブランチが無い場合のみ、次に進む。

### 4. ブランチ名を推論する

ステップ2で取得したタイトル・本文・ラベルから、規約準拠のブランチ名を組み立てる。

**`<type>` の決定**（ラベルを優先し、なければ内容から推論する）:

| ラベル / 内容 | type |
|---|---|
| `documentation` / ドキュメント作業 | `docs` |
| `bug` / バグ修正 | `fix` |
| `enhancement` / `feature` / 新機能・機能追加 | `feature` |
| `refactoring` / リファクタ・内部改善 | `refactor` |
| その他の雑務・設定変更 | `chore` |

判断に迷う場合は内容（タイトル・本文）から最も近い type を選ぶ。デフォルトは `feature`。

**`<kebab-case-name>` の生成**:

- issue のタイトル・本文の要点を **英語** で短く表す（日本語の issue でも英訳する）
- 小文字・ハイフン区切り・ASCII のみ、3〜5 語程度に収める
- 冠詞（a / the）や汎用語（issue / feature など重複する語）は省いて要点を残す

組み立てた結果: `<番号>-<type>/<kebab-case-name>`

### 5. ブランチを作成する

```bash
gh issue develop <番号> --name <ブランチ名>
```

- `--base` は指定しない（リポジトリのデフォルトブランチの最新から作成される）。
- `--checkout` は付けない。ローカルのカレントブランチは切り替わらず、リモート上に issue 紐付けブランチが作成されるのみ。
- `gh issue develop` は issue とブランチをリモート上で紐付ける（issue の Development 欄に表示される）。

### 6. 結果を伝える

作成したブランチ名をユーザーに伝える。

## 出力例

```
issue #127 のブランチを作成しました: 127-feature/user-profile-edit
（ローカルのカレントブランチは切り替わりません。作業する場合は手動でチェックアウトしてください）
```

issue が open で存在しない場合:

```
issue #127 は open ではない（CLOSED）ためブランチを作成しません。
```

## 注意

- `gh` コマンドが使えない場合はエラーをそのままユーザーに伝える
- ブランチ名は必ず規約（`<番号>-<type>/<kebab-case-name>`・ASCII のみ）に従う
- issue の状態確認（ステップ2）を飛ばさない。open で存在しない issue に対してブランチを作らない
- 既に紐付いたブランチがある場合は重複作成しない（ステップ3）
