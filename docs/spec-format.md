# 仕様ファイル形式

`schemaVersion: 1` のYAMLまたはJSONを読み込み、シナリオ、レーン、ユーザーストーリー、ノード、エッジからビューを生成します。

## 全体構造

```yaml
# yaml-language-server: $schema=../schema/sdd-flow.schema.json
schemaVersion: 1

scenario: {}
lanes: []
stories: []
nodes: []
edges: []
```

`scenario` では画面タイトルと初期表示を指定します。

```yaml
scenario:
  id: login
  project: 会員ポータル
  domain: 認証
  title: ログインしてトップ画面を表示する
  heading: 情報が入り、変化し、画面に戻るまで
  status: レビュー中
  defaultStory: US-101
  defaultPath: happy       # happy / exception / all
  defaultLevel: 2          # 1 / 2 / 3
  selectedNode: login-command
```

IDは英字で始め、英数字、`_`、`-`を使用します。`defaultStory` と `selectedNode` は実在するIDを参照する必要があります。

## レーン

`lane` は「どこで起きるか」を表します。配列順が画面の上から下の順序です。色は配列順に自動で割り当てられます。

```yaml
lanes:
  - id: browser
    label: ユーザー / ブラウザ
    code: "01"
    subtitle: front stage
```

## ユーザーストーリー

ユーザーストーリーはノードではなく、フロー上の変更範囲です。`nodes` に関連ノードIDを並べます。接続数は自動計算されます。

```yaml
stories:
  - id: US-101
    title: 会員としてログインしたい
    state: レビュー中
    nodes: [login-screen, login-action, login-command]
```

## ノード

```yaml
nodes:
  - id: login-command
    lane: system
    column: 3
    type: command
    path: both
    title:
      level1: ログインを確認
      level2: ログインを要求する
      level3: POST /api/session
    technical: AuthenticateMember
    detail:
      description: 認証処理を開始します。
      behavior:
        given: 認証情報を受信している
        when: ログイン要求を受け付ける
        then: アカウントを照会する
      assumption: 過剰な試行は制限されます。
      links: [US-101, CMD-AUTH-01]
```

`type` はノードの意味です。

| type | 意味 |
|---|---|
| `view` | ユーザーが見る状態 |
| `action` | ユーザーの操作 |
| `command` | システムへの意図 |
| `integration` | 外部システムとの連携 |
| `decision` | ビジネスルールによる判断 |
| `event` | 確定した事実 |
| `state` | 保存・更新された状態 |

`path` は `happy`、`exception`、両方に現れる `both` のいずれかです。

## エッジ

```yaml
edges:
  - from: login-action
    to: login-command
    type: triggers
    path: both

  - from: account-decision
    to: login-rejected
    type: produces
    path: exception
    label: NO
```

| type | 意味 |
|---|---|
| `sequence` | ユーザー体験上の順序 |
| `triggers` | 次の処理を開始する |
| `produces` | イベントを発生させる |
| `reads` | 状態を参照する |
| `writes` | 状態を更新する |
| `requests` | 情報や処理を要求する |
| `responds` | 要求へ応答する |
| `transitions` | 画面や状態を遷移する |
| `returns` | 前の操作へ戻る |

戻り線を下側へ迂回させる場合は `loop: true` を指定します。分岐条件など短い表示には `label` を使用します。

## 読み込みと検証

- 画面の「YAMLを開く」でローカルファイルを選択できます。
- YAMLまたはJSONファイルを画面へドラッグ&ドロップできます。
- `?spec=/path/to/spec.yaml` でサーバー上のファイルを初期表示できます。
- 読み込み失敗時はエラー箇所を表示し、現在のビューは維持します。
- 実行時に必須項目、ID重複、レーン・ノード・ストーリーの参照切れを検証します。
