# 検証と完成条件

- 上位仕様: plan.md §3.4（検証）、§6 Step 2（完了条件）

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト・ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint / format 設定（prettier も biome も .editorconfig も置かない） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止 |
| `pnpm test` | vitest。`@effect/vitest` の `it.effect` が主 API |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。§3 参照） |
| `pnpm verify` | 上記 4 つを直列実行。**CI と同じ内容** |

セットアップ:

```console
$ direnv allow          # devenv 経由で nodejs_22 + pnpm が入る
$ pnpm install
```

devenv を使わない場合は Node.js 22 以上と pnpm 9.15.0 が要る。
`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい。

> `devenv.lock` はコミットされていない。生成には devenv の実行が必要なため、
> 初回に devenv を動かした人がコミットすること。

## 2. テストの方針

### `it.effect` を使う

`@effect/vitest` の `it.effect` が主 API である。純粋な同期アサーションでも
`Effect.sync(() => { ... })` で包む。理由は一貫性であり、
Effect を要求するコードが後から入ったときにテストの書き方が変わらないためである。

**例外**（参照実装で確立済み、plan.md §3.13）: DOM イベントフローのテストで
`Effect.fork` + `Deferred.await` を `it.effect` の中に書くとデッドロックする。
そのときはプレーンな `it` + `Effect.runPromise` を使う。
mc-physics は DOM を触らないので現時点では該当しない。

### プロパティテストを優先する

`effect` の `FastCheck` re-export（`import { FastCheck } from 'effect'`）を使う。
`.npmrc` が `fast-check` と `pure-rand` を hoist しているのは、これの型解決と
Vite からの解決のためである。

mc-physics で最も価値が高いのは**座標と AABB の不変条件**である。

- foot → centre → foot のラウンドトリップ
- ブロックは `[y, y+1]` を占有する
- `surfaceY + 1` にちょうど立っている実体は「めり込み」ではなく「接地」と読まれる

3 つ目のプロパティテストは実際に**浮動小数の問題を発見した**:
`(foot + h) - h` は IEEE-754 では正確に `foot` にならない。
反例は `surfaceY = 1`, `halfHeight = 0.05` で、復元された足元がブロック上面の 2 ulp 下に落ちる。
これが `CONTACT_EPSILON` の存在理由であり、テストを緩めて済ませていたら
同じバグがリゾルバの中に移動していただけだった。`design-notes.md` P-6 を参照。

### 少数の誠実なテスト > 多数の自明なテスト

各テストは「何が壊れたら落ちるか」が一意に分かる名前を持つこと。
`design-notes.md` の各項目には**回帰テスト名**が振ってあり、ソースのコメントからも
同じ名前で参照している。テストを消すときは design-notes 側も同時に更新すること。

## 3. カバレッジ閾値は**まだ**有効化していない

参照実装は branches / functions / lines / statements すべてに **99%** を強制している。
本リポジトリは計測とレポートは常に動かしているが、**閾値は設定していない**。

理由（`vitest.config.ts` のコメントにも記載）:
スケルトンに閾値を課しても意味がない。第一版のモジュール数個で自明に満たされてしまい、
実装の質については何も言わない数字になる。

**99% ゲートは完成条件（§4）に到達した時点で、`vitest.config.ts` と CI の両方で有効化する。**

```typescript
// vitest.config.ts に追加する行
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

## 4. 完成条件

plan.md §6 Step 2 の各リポジトリ完了条件は
「ユニット/シナリオテスト green + 内蔵プレビューが操作可能」である。

**mc-physics はプレビューを持たない。** 安定ライブラリ層（plan.md §2.2）は
「純粋関数・狭い界面」であって、ユーザが操作できるものではない。
plan.md §2.3-4 が「プレビューは検証対象と同居する」と定め、
§3.7 が「worldgen の地形プレビューが最初の遊べる成果物」と明示しているとおり、
プレビューを持つのは基盤層以上である。

したがって mc-physics の完成条件は:

- **プロパティテスト**（エネルギー非増加、めり込みゼロ、決定論）—— plan.md §3.4 の要求。
  現在あるのは決定論と座標不変条件。**エネルギー非増加とめり込みゼロはリゾルバ実装後**
- **参照実装で発見された不変条件の回帰テスト** —— `design-notes.md` の P-1〜P-8 がそれであり、
  リゾルバに依存しないものは既に書いてある
- **AABB 衝突リゾルバの実装** —— これがこのリポジトリの本体であり、まだ無い。
  現在あるのは積分・座標規約・DDA。リゾルバは以下を満たすこと:
  - ground clamp を内部に持ち、`step()` の後に走る（`design-notes.md` P-3）
  - Y 軸を X より先に解決する（参照実装の
    `aabb-collision-edge-cases.test.ts` が「player falling onto a ledge does not embed sideways」で保持）
  - `CONTACT_EPSILON` 以内のめり込みは「接地」として何もしない
- **`isBlockSolid` を能力フラグ経由にする** —— mc-kernel が publish されてから

到達時に行うこと:

1. `vitest.config.ts` と `.github/workflows/ci.yaml` で 99% 閾値を有効化
2. ビルド / publish パイプラインを追加（`versioning.md` §3）
3. `0.x` → `1.0.0`（mc-sim が実際に消費して契約を確認したら）

## 5. CI

`.github/workflows/ci.yaml` は `pnpm verify` と同じ内容を job のステップに展開したものである
（失敗箇所が step 名で分かるようにするため）:

1. Checkout
2. Setup pnpm（`pnpm/action-setup@v4`）
3. Setup Node.js 22（pnpm キャッシュ有効）
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck`
6. `pnpm lint`
7. `pnpm check:deps` —— **ハードゲート**。参照実装の `check-package-dag.ts` と違い、
   違反があれば必ず非ゼロ終了する
8. `pnpm test`
9. `pnpm test:coverage`（閾値なし。§3）
10. カバレッジレポートを artifact に upload（7 日保持）

## 6. 現時点のテスト一覧

| ファイル | 内容 |
| --- | --- |
| `test/coordinates.test.ts` | foot/centre のラウンドトリップ、半分と全体の取り違え検出、ブロック占有 `[y,y+1]`、`surfaceY+1`、接地が衝突と読まれないこと、**浮動小数誤差の大きさの固定**、文書化された反例、AABB の対称性 |
| `test/integrate.test.ts` | deltaTime クランプの厳密一致 / 上下限 / NaN / 初回フレーム、`DeltaTimeSecs` の構築拒否、semi-implicit Euler の順序、終端速度、**トンネリング不変条件**、static/kinematic 不変、決定論と順序非依存、DDA（原点セル除外・法線・maxDistance・退化入力・訪問順・決定論） |
| `test/public-api.test.ts` | barrel の export、実測定数の固定、終端速度と delta 上限の導出関係、`CONTACT_EPSILON` の桁 |
| `test/check-dependency-whitelist.test.ts` | 16 リポジトリ roster の完全性、非循環、体験モジュール間エッジ 0、kit の devDependency 専用性、推移閉包の拒否、`Date.now()` 禁止、import 抽出 |
