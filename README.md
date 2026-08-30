# Trace — 振る舞い仕様ビュー

ユーザーストーリーがシステム全体のどこに関係するかを、ブラウザ・自システム・外部システム・リソースのレーンを横断するタイムラインとして確認する静的プロトタイプです。

## 起動方法

初回だけ依存関係をインストールします。

```powershell
npm install
npm run dev
```

その後、`http://127.0.0.1:4173` を開きます。YAMLをバンドルして読み込むため、`index.html` の直接表示ではなく開発サーバーを使用してください。

配布用ファイルは次のコマンドで `dist/` に生成できます。

```powershell
npm run build
```

## 試せること

- ユーザーストーリーごとの変更範囲の強調
- 正常系・異常系・全経路の切り替え
- ユーザーフロー・振る舞い・技術フローの3段階表示
- ノード選択によるGiven-When-Then、Assumption、関連仕様の確認
- フローのドラッグスクロール
- 画面上の「YAMLを開く」、またはドラッグ&ドロップによる仕様の差し替え
- YAMLの構文・ID重複・参照切れなどの実行時検証

## 仕様ファイル

既定の表示は [`specs/login.yaml`](./specs/login.yaml) から生成されます。別シナリオの例として [`specs/password-reset.yaml`](./specs/password-reset.yaml) も含まれています。

URLから仕様を指定することもできます。

```text
http://127.0.0.1:4173/?spec=/specs/password-reset.yaml
```

YAMLの形式、ノード種別、エッジ種別については [`docs/spec-format.md`](./docs/spec-format.md) を参照してください。JSON Schemaは [`schema/sdd-flow.schema.json`](./schema/sdd-flow.schema.json) です。

JSONはYAMLのサブセットとして同じローダーで読み込めます。

主要な処理は `src/app.js` にあり、表示データは含んでいません。
