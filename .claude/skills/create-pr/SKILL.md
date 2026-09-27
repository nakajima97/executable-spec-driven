---
name: create-pr
description: GitHubのPRを作成する。「PRを作って」「プルリクを出して」「マージリクエストを作成して」など、実装完了後にPRを作成したい場面で必ず使うこと。.github/pull_request_template.md のテンプレートに従ったPR本文を生成する。
model: sonnet
---

## 概要

`.github/pull_request_template.md` のテンプレート構造を使って GitHub PR を作成する。
会話の流れ・git の差分・コミット履歴から内容を推論し、不足している項目だけをユーザーに確認する。

## リモート操作の実行形式

リモートにアクセスする git コマンド（ステップ2の `git fetch`・ステップ6の `git push` / `git ls-remote`）は、
**Bash ツールに渡す文字列全体をそのコマンド1つだけにする**。

- `|` / `;` / `&&` で他のコマンドと連結しない（`; echo "EXIT=$?"` のような判定用の付け足しも連結にあたる）
- `cd <パス> &&` を前置しない。`-C <パス>` も付けない。worktree を対象にする場合も、セッションの作業ディレクトリのまま単独で実行する（worktree で動いているセッションはその worktree が作業ディレクトリのため、前置は不要）

**理由**: git をサンドボックス外で実行させる設定（`.claude/settings.json` / `.claude/settings.local.json` の `sandbox.excludedCommands` に `git:*` 等を指定する構成）は、Bash に渡した文字列が
単独の `git <サブコマンド>` のときだけ適用される。上記の連結・前置（`-C` / `-c` を含む）があると
サンドボックス内で実行され、SSH の鍵・`~/.ssh/config` をサンドボックスの読み取り禁止（`denyRead`）対象にしている環境では
それらが読めず `Permission denied (publickey)`（exit 128）で失敗する。
単独なら成功するコマンドが失敗するため、ネットワーク断・認証切れと誤診しやすい。

成否は **Bash ツールが返す終了コード**で判定する（成功時も進捗が stderr に出力されるため、出力の有無・文言を根拠にしない）。

### HTTPS 経路での再実行

SSH 経路（`git@github.com:`）で失敗した場合は、中止する前に HTTPS 経路で**1回だけ**再実行する。
`gh` の既存の認証情報を使い、git 設定は永続的に書き換えず実行時オプション（`-c`）だけで経路を切り替える:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' -c url.https://github.com/.insteadOf=git@github.com: <サブコマンド以降>
```

- このコマンドは `-c` を伴うためサンドボックス内で実行される（github.com への到達が必要）
- リトライは**経路ごとに1回まで**（SSH で1回・HTTPS で1回）。HTTPS でも失敗した場合のみ中止し、SSH と HTTPS **両方**のエラー出力を添えてユーザーに伝える

## 手順

### 1. テンプレートを読む

`.github/pull_request_template.md` を読み、セクション構造を把握する。
テンプレートのセクション名・順序は変えずにそのまま使う。HTML コメント（`<!-- -->`）は本文に含めない。

### 2. 現在のブランチ状態と既存ラベルを把握する

まず `git fetch origin main` を「リモート操作の実行形式」に従って単独で実行する（Bash ツールに渡す文字列をこのコマンドだけにする）:

```bash
git fetch origin main
```

成否は **Bash ツールが返す終了コード**で判定する。判定のために `; echo "EXIT=$?"` のようなコマンドを付け足さない（付け足すと複合コマンドになり、単独なら成功する fetch が publickey 拒否で失敗する）。

SSH 経路で失敗した場合は、中止する前に HTTPS 経路で1回だけ再実行する:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' -c url.https://github.com/.insteadOf=git@github.com: fetch origin main
```

worktree 作成スクリプト（例: `scripts/wt-new.sh`。参考実装は `docs/examples/scripts/wt-new.sh`）の `gh issue develop --base main` フローではローカル `main` が追随せず、作業ブランチしか fetch しないため worktree の `origin/main` 自体も古いことがある。そのため比較対象は fetch 済みの `origin/main` とする。

いずれかの経路で成功した場合のみ、以下を並列で実行して差分とラベル一覧を把握する:

```bash
git status
git log origin/main..HEAD --oneline
git diff origin/main...HEAD
gh label list --json name,description --limit 100
```

`git log` は二点・`git diff` は三点である点に注意する（`git log` を三点にすると対称差分になり、分岐後に main へマージされた他 PR のコミットまで履歴に混ざる）。

SSH・HTTPS の両経路とも失敗した場合は `origin/main` も古い可能性があるため、以降の手順（差分・コミット履歴の取得、ステップ3〜7）には進まず処理を中止する。リモートの最新 main を取得できず古い基準で PR 本文を確定させないことを中止理由として、**両経路の** `git fetch` のエラー出力をそのまま添えて（ネットワーク断とは限らないため）、原因の解消後に再実行する対処とあわせてユーザーに伝えて終了する。

### 3. コンテキストから内容を推論する

git の差分・コミット履歴・現在の会話の流れを振り返り、ステップ1で読み込んだテンプレートの各セクションを埋める。
タイトル（PR の件名・issue 番号は含めない）も合わせて推論する。

推論できる項目は自動で埋める。ユーザーに確認なしに作成まで進めてよい。

**`## 動作確認済み` セクションは AI で埋めず、テンプレートの `- [ ]` 空チェックボックスのまま残す**。
このセクションはテストコードに表現されていない動作確認項目を人間が後から記入するためのもので、推論で埋めない。

### 4. ラベルを選択する

ステップ2で取得したラベル一覧を、PR のタイトル・本文（テンプレートの各セクション）・紐付く issue の内容と照合し、内容に合うラベルを選ぶ。
該当するラベルがない場合はラベルなしとする（新しいラベルは作成しない）。

### 5. 不足項目を確認する（必要な場合のみ）

推論できなかった項目がある場合のみ、まとめて1回だけ質問する。

### 6. ブランチを push する

PR 作成にはリモートへの push が必要なため、先にカレントブランチを push する。「リモート操作の実行形式」に従い、Bash ツールに渡す文字列をこのコマンドだけにする:

```bash
git push -u origin HEAD
```

SSH 経路で失敗した場合は、中止する前に HTTPS 経路で1回だけ再実行する:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' -c url.https://github.com/.insteadOf=git@github.com: push -u origin HEAD
```

**push の成否は出力の文言（`Everything up-to-date` など）では判定しない**。リモート先端のコミットがローカル HEAD と一致することで判定する。以下をそれぞれ単独で実行し、コミットハッシュを突き合わせる:

```bash
git rev-parse HEAD
```

```bash
git rev-parse --abbrev-ref HEAD
```

```bash
git ls-remote origin refs/heads/<ブランチ名>
```

`git ls-remote` もリモートにアクセスするため単独で実行し、SSH 経路で失敗した場合は同じ HTTPS 経路の形で1回だけ再実行する。

- 一致した場合は push 済みとしてステップ7へ進む（すでに push 済みで `Everything up-to-date` が返った場合もここで一致する）
- 両経路の push 後も一致しない場合は PR を作成せず、SSH・HTTPS 両方のエラー出力を添えてユーザーに伝えて終了する

`git push -u` の `-u`（upstream の書き込み）は、`.git/config.lock` がサンドボックスにマスクされている環境では失敗する。upstream の設定に失敗しても、上の一致確認が取れていれば push 自体は成功しているため、そのままステップ7へ進む（upstream の成否は push の成否と切り離して扱う）。

### 7. PR を作成する

ステップ1で読み込んだテンプレートのセクション構造をそのまま使って本文を組み立てる。
セクション名・順序はテンプレートに従い、HTML コメントは含めない。

`--base` は指定しない（リポジトリのデフォルトブランチに自動で向く）。スタックド PR など別ブランチを base にしたい場合は、PR 作成後に `gh pr edit <番号> --base <ブランチ名>` で修正する。

ラベルがある場合:
```bash
gh pr create --title "[タイトル]" --body "[ステップ1で読んだテンプレートのセクションに内容を埋めた本文]" --assignee @me --label "label1,label2"
```

ラベルがない場合:
```bash
gh pr create --title "[タイトル]" --body "[ステップ1で読んだテンプレートのセクションに内容を埋めた本文]" --assignee @me
```

作成後、返ってきた PR URL をユーザーに伝える。

## 注意

- `gh` コマンドが使えない場合はエラーをそのままユーザーに伝える
- **PR の作成までを行い、マージはしない**（マージは原則として人間の承認が必要。プロジェクトの CLAUDE.md にマージの規約があればそれに従う）
- テンプレートの構造は変えない（セクション名・順序を保つ）
- 内容の推論に自信がない場合は「〜と解釈しましたが合っていますか？」と一言確認してから作成する
