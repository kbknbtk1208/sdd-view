# 仕様ファイル形式

## 対応バージョン

現在のビューは <code>schemaVersion: 3</code> のYAMLまたはJSONだけを読み込みます。v2以前との後方互換はありません。

~~~yaml
# yaml-language-server: $schema=../schema/sdd-flow.schema.json
schemaVersion: 3

scenario: {}
stories: []
experience:
  nodes: []
  edges: []
subflows: {}
~~~

## Scenario

~~~yaml
scenario:
  id: login
  project: 会員ポータル
  domain: 認証
  title: ログインしてトップ画面を表示する
  heading: ユーザーの操作から価値が届くまで
  status: レビュー中
  defaultStory: US-101
  defaultPath: happy
  selectedNode: credential-input
~~~

<code>defaultPath</code> は <code>happy</code>、<code>exception</code>、<code>all</code> のいずれかです。

## User Story

ユーザーストーリーはExperience Flowのノードだけを参照します。Realization Subflowの子ノードは親のスコープを継承します。

~~~yaml
stories:
  - id: US-101
    title: 会員としてログインしたい
    state: レビュー中
    nodes: [login-screen, credential-input, login-attempt, top-screen]
~~~

## Experience Flow

Experience Flowには、ユーザーが操作または観測できる内容だけを置きます。利用できるノード種別は <code>view</code>、<code>action</code>、<code>event</code>、<code>state</code> です。

<code>command</code>、<code>integration</code>、<code>decision</code> はシステム内部の実現方法なので、Subflowへ定義します。

~~~yaml
experience:
  nodes:
    - id: login-attempt
      type: action
      path: both
      expands: authentication
      title: ログインを試行する
      technical: Submit credentials
      detail:
        description: 入力済みの認証情報を送信します。
        behavior:
          given: ログイン操作が有効である
          when: ログインを実行する
          then: 認証結果に応じた画面へ進む
        assumption: 送信中は二重送信を防止します。
        links: [US-101]

  edges:
    - from: login-attempt
      to: top-screen
      type: transitions
      path: happy
      label: SUCCESS
~~~

タイトルは1つの文字列です。L1〜L3のタイトル切り替えはありません。技術的な対応先は <code>technical</code> と <code>detail</code> に分離します。

## Realization Subflow

Experienceノードの <code>expands</code> と、<code>subflows</code> のキーを一致させます。

Subflowには2種類あります。

| kind | 用途 |
|---|---|
| <code>interaction</code> | 入力、画面内検証、ボタン状態などのUI操作 |
| <code>orchestration</code> | 自システム、外部システム、リソース間の連携 |

~~~yaml
subflows:
  credential-entry:
    kind: interaction
    title: 認証情報を入力できる状態にする
    summary: IDとパスワードを入力し、送信操作を有効にします。
    entry: [member-id-input, password-input]
    exits:
      happy: [login-form-ready]
      exception: []
    tracks:
      - { id: member-id, label: 会員ID, code: ID }
      - { id: password, label: パスワード, code: PW }
      - { id: form-state, label: フォーム状態, code: UI }
    groups: {}
    nodes: []
    edges: []
~~~

### EntryとExits

- <code>entry</code>: Subflowを開始できる子ノード。複数指定できます。
- <code>exits.happy</code>: 正常系で親の契約を満たす終了ノード。
- <code>exits.exception</code>: 異常系として外側へ結果を返す終了ノード。

入力エラーから再入力へ戻るだけの場合は、異常系exitへ含めません。

## 順不同と並列

ユーザーがどの順番でも入力できる操作は <code>unordered</code>、同時に実行可能なシステム処理は <code>parallel</code> として区別します。

~~~yaml
groups:
  credential-fields:
    label: IDとパスワードはどちらからでも入力できる
    mode: unordered
    members: [member-id-input, password-input]
~~~

所属は <code>groups.*.members</code> だけで管理します。子ノード側への重複指定は不要です。

~~~yaml
- id: member-id-input
  track: member-id
  type: action
  path: both
  title: 会員IDを入力する
  # technical / detail は通常のノードと同じ
~~~

複数の入力がすべて揃ってから有効になるノードには <code>join: all</code> を指定します。

~~~yaml
- id: login-form-ready
  track: form-state
  join: all
  type: state
  path: happy
  title: ログイン操作を有効にする
~~~

<code>join: all</code> には2本以上の入力エッジが必要です。<code>join: any</code> は、いずれか1本の到達で進めることを明示します。

## 自動配置

<code>column</code> や座標は仕様に記述しません。ビューがエッジから段階を自動計算します。

1. 入力エッジを持たないノードをSTAGE 1に置く
2. 後続ノードを依存元の次のSTAGEへ置く
3. 複数の依存元がある場合は最も遅いSTAGEに合わせる
4. <code>loop: true</code> の戻り線は配置計算から除外する
5. 同じSTAGEではYAMLのノード記述順を維持する

したがって、途中へノードを追加しても後続ノードの番号変更は不要です。

## Node type

| type | 意味 |
|---|---|
| <code>view</code> | ユーザーまたは連携先へ見せる状態 |
| <code>action</code> | ユーザーの操作 |
| <code>command</code> | システムへの意図 |
| <code>integration</code> | 外部システムとの連携 |
| <code>decision</code> | ルールによる判断 |
| <code>event</code> | 確定した事実 |
| <code>state</code> | 保存または導出された状態 |

## Edge

~~~yaml
edges:
  - from: account-decision
    to: profile-query
    type: requests
    path: happy
    label: VALID
~~~

| type | 意味 |
|---|---|
| <code>sequence</code> | ユーザー体験上の順序 |
| <code>triggers</code> | 次の処理を開始する |
| <code>produces</code> | イベントや結果を発生させる |
| <code>reads</code> | 状態を参照する |
| <code>writes</code> | 状態を更新する |
| <code>requests</code> | 情報や処理を要求する |
| <code>responds</code> | 要求へ応答する |
| <code>transitions</code> | 画面や状態を遷移する |
| <code>returns</code> | 前の操作へ戻る |
| <code>enables</code> | 条件成立によって操作を有効にする |

再入力や再試行の戻り線には <code>loop: true</code> を指定します。

## 読み込みと検証

- 画面の「YAMLを開く」でローカルファイルを選択できます。
- YAMLまたはJSONを画面へドラッグ&ドロップできます。
- <code>?spec=/path/to/spec.yaml</code> でサーバー上のファイルを指定できます。
- v2以前、ID重複、参照切れ、不正なgroup、entry、exit、joinを検証します。

フローをどの層へ置くかの判断は、[階層構造の設計ガイド](./hierarchy-guidelines.md)を参照してください。
