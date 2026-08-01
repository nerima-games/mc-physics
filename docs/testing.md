# 検証と完成条件

- 上位仕様: plan.md §3.4（検証）、§6 Step 2（完了条件）

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト・ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint / format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 40 ルールが `warn`、`error` は 2 つだけ。このフラグが無かった頃は実質その 2 つしかゲートになっていなかった） |
| `pnpm test` | vitest。`@effect/vitest` の `it.effect` が主 API |
| `pnpm test:coverage` | カバレッジ計測。4 指標 99% のしきい値を強制する(§3 参照) |
| `pnpm verify` | `typecheck` / `lint` / `test` を直列実行。**CI と同じ内容**。カバレッジは別ゲート |

`pnpm check:deps`(`scripts/check-dependency-whitelist.ts`)と `pnpm api:check` / `pnpm api:update`
(`api-lock.md` + `scripts/api-lock.ts`)は org 標準への移行に伴い全廃された
(PACKAGE_STANDARD.md「`scripts/check-dependency-whitelist.ts` の廃止」、API_STANDARD.md §4)。
依存の許可グラフは `.oxlintrc.json` の `no-restricted-imports` が(DEPENDENCY_POLICY.md)、
破壊的変更の判定は人間のレビュー([versioning.md](./versioning.md) §5-6)がそれぞれ引き継ぐ。

セットアップ:

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0 が要る。
`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい。

> ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

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

## 3. カバレッジ閾値は有効化済み(org 標準、TEST_STANDARD.md §3)

branches / functions / lines / statements の4指標すべてに **99%** のしきい値を、
org の即時・全リポジトリ一律ロールアウト方針(TEST_STANDARD.md §3)に従い有効化している。
猶予期間・段階ロールアウトはない。

`vitest.config.ts`:

```typescript
thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
```

org 標準への移行時点の実測: statements 99.41%、branches 99.35%、functions 100%、
lines 99.41%(`src/domain/dda.ts` の raycast ループ末尾、実質到達不能なフォールバックの
`Option.none()` 1 行のみ未到達)。4 指標とも 99% を上回っており、この移行時点で
CI が赤くなる側の3リポジトリ(MIGRATION_RUNBOOK.md 手順7)には含まれない。

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
  **3 つとも `test/resolve.test.ts` にある**（§6 の表）
- **参照実装で発見された不変条件の回帰テスト** —— `design-notes.md` の P-1〜P-8。
  リゾルバ待ちだった P-3 の 2 本と P-6 のリゾルバ側 3 本が埋まり、**全項目にテストがある**
- **AABB 衝突リゾルバの実装** —— **実装済み**（`domain/resolve.ts`）。満たしている条件:
  - ground clamp を内部に持ち、`step()` の後に走る（`design-notes.md` P-3）。
    `stepBody` / `stepWorld` が「積分 → 解決」の合成に名前を与えており、逆順は diff に現れる
  - Y 軸を X より先に解決する。**根拠は実測**（`design-notes.md` P-9-1）——
    X 先で落ちるのは「平地の継ぎ目に引っかかる」と「step-up が効かなくなる」の 2 本で、
    参照実装が順序テストの題材にしている ledge のケースは
    本リポジトリでは別の機構（face-span ガード）が先に効くため順序を区別しない
  - `CONTACT_EPSILON` 以内のめり込みは「接地」として何もしない。
    **epsilon は述語（`collidesWith`）にあり、リゾルバが書く位置には 1 ulp も足さない**
  - `stepBody` は body span を超える変位を swept AABB で連続判定する。
    高速な水平・垂直・斜め移動、薄い collision shape、接触状態からの内向き／外向き移動、
    既存のめり込みからの離脱を回帰テストで固定している（P-9-2）
- **`isBlockSolid` を能力フラグ経由にする** —— mc-kernel が publish されてから。
  現状は `IsBlockSolid` / `BlockShapeAt` として**注入**されており、
  `domain/` にブロック ID の語彙は 1 つも無い。repoint は mc-sim 側の 1 行になる（P-8）

**残っているもの**（2026-07-28 に 2 件を分離した。かつては 1 文に同居しており、
**片方はもう残っていない**）。

#### (a) step-up の「水平フェーズ再実行」 —— **入れない。条件が構造的に起きない**

参照実装 `aabb-collision.ts:303-318` の再実行は入れていない。
かつてここには「再実行が要るのは『水平フェーズが先に体を止めてしまい Y が持ち上げる機会を失う』
ケースだけである。**そのケースを再現するテストが書けたときに入れる**」と書いてあった。

**そのケースは、この設計では起こらない。** `domain/resolve.ts` の `resolveBody` は
Y → X → Z の順に解決し、**Y は無条件に最初に走る**（水平フェーズが見るのは
`boxAfterY`、すなわち持ち上げ後の位置である）。
「水平フェーズが先に体を止める」状態は、軸の順序が逆でなければ到達できない。

つまりこれは「テストがまだ書けない」項目ではなく、
**Y-before-X の帰結として不要になった**項目である。しかも既に固定されている ——
`test/resolve.test.ts:184` の

> `Y before X is what makes step-up work without a second horizontal pass`

がまさにそれを主張しており、P-9-1 の表は
「X 先にすると step-up が全く効かなくなる」を**実測で**確認している。

**再び検討すべきなのは軸の順序が変わったときだけである。** そのとき上記テストが落ち、
この節に導かれる。順序が立っている限り、ここに残作業は無い。

#### (b) sneak-edge（`clampSneakEdge`） —— **実装済み**

`responsibility.md` §3 の表どおり、機構を独立した純関数として実装した。
`test/resolve.test.ts` は平地で不変、片軸だけの clamp、両軸の clamp、停止軸では
足場 query を行わないことを固定している。スニーク状態と足場探索深度は mc-sim が所有する。

`ResolveOptions` のフラグにしなかったのは、スニーク状態を物理機構へ持ち込まず、通常の
`resolveBody` / `stepBody` の結果を変えないためである。呼び出し側は grounded かつ sneaking の
ときだけ適用し、`hasGroundSupport` callback 内でゲーム値の探索深度を使う。

到達時に行うこと:

1. `vitest.config.ts` と `.github/workflows/ci.yaml` で 99% 閾値を有効化
2. ビルド / publish パイプラインを追加（`versioning.md` §3）
3. `0.x` → `1.0.0`（mc-sim が実際に消費して契約を確認したら）

## 5. CI

`.github/workflows/ci.yaml` は `pnpm verify` の3ゲート(typecheck/lint/test)に加え、
カバレッジと changeset の付け忘れ検出を独立したステップとして job に展開したものである
（失敗箇所が step 名で分かるようにするため。TEST_STANDARD.md §1・§3）:

1. Checkout(`actions/checkout`、commit SHA 固定。SUPPLY_CHAIN.md)
2. Setup pnpm（`pnpm/action-setup`、commit SHA 固定）
3. Setup Node.js 24（`actions/setup-node`、commit SHA 固定。pnpm キャッシュ有効）
4. `pnpm install --frozen-lockfile --ignore-scripts`
5. `pnpm typecheck`
6. `pnpm lint`
7. `pnpm test`
8. `pnpm changeset status --since=main` —— ユーザー向け変更に changeset の付け忘れがないか検出する
   (RELEASE_STANDARD.md §1.2)
9. `pnpm test:coverage` —— **ハードゲート**。4 指標 99% のしきい値を下回れば非ゼロ終了する（§3）
10. カバレッジレポートを artifact に upload（`actions/upload-artifact`、commit SHA 固定。7 日保持）

`pnpm check:deps` と `pnpm api:check` の2ステップは、それぞれの裏付けとなる
`scripts/check-dependency-whitelist.ts` と `api-lock.md` / `scripts/api-lock.ts` が
org 標準への移行で全廃されたため、CI から削除済みである。

## 6. 現時点のテスト一覧

| ファイル | 内容 |
| --- | --- |
| `test/coordinates.test.ts` | foot/centre のラウンドトリップ、半分と全体の取り違え検出、ブロック占有 `[y,y+1]`、`surfaceY+1`、接地が衝突と読まれないこと、**浮動小数誤差の大きさの固定**、文書化された反例、`collidesWith` と `intersects` が食い違う唯一の場所、**`isRestingOn` が両側であること**、AABB の対称性 |
| `test/resolve.test.ts` | **軸順序（継ぎ目・ledge・step-up・壁ずり・入隅）**、ground clamp とその順序（**逆順のコストを `g·dt²` で固定**）、天井、壁が床にならないこと、**着地状態が P-6 の反例と一致すること**、1000 フレームの無ドリフト、固定点、**めり込みゼロ**（起伏地形 / 任意高度からの落下 / 終端速度）、**エネルギー非増加**（および step-up がその唯一の例外であること）、**補正量の上限**、決定論と順序非依存、**問い合わせセルが箱の中に収まること**、形状注入 |
| `test/integrate.test.ts` | deltaTime クランプの厳密一致 / 上下限 / NaN / 初回フレーム、**`DeltaTimeSecs` ブランドが kernel の refinement であること**（有限・非負。ゼロも 30 も通る）、**`clampDeltaTime` の出力が常に安全域に入ること**（プロパティテスト）、semi-implicit Euler の順序、終端速度、**トンネリング不変条件**、static/kinematic 不変、決定論と順序非依存、DDA（原点セル除外・法線・maxDistance・退化入力・訪問順・決定論） |
| `test/public-api.test.ts` | barrel の export、実測定数の固定、**ブランドが kernel 準拠でクランプが境界にあること**、終端速度と delta 上限の導出関係、`CONTACT_EPSILON` の桁 |

> **「`DeltaTimeSecs` の構築拒否」は現在テストしていない。** ブランドはクランプ範囲を要求しない
> ——要求しても意味が無かったからである（[design-notes.md](./design-notes.md) P-5、
> [public-api.md](./public-api.md) §2-1）。代わりに、ブランドが**何を通すか**と
> クランプが**何を返すか**を別々のテストが主張している。

`test/check-dependency-whitelist.test.ts`(16 リポジトリ roster の完全性・非循環・推移閉包の拒否
などを検査していたテスト)は、裏付けの `scripts/check-dependency-whitelist.ts` が org 標準への
移行で全廃されたため、同時に削除した。代替は `.oxlintrc.json` の `no-restricted-imports`
(DEPENDENCY_POLICY.md)で、これはテストコードではなく lint 設定なのでこの一覧には現れない。

## 7. リゾルバのテストは mutation で確かめてある

「落ちるはずのテストが実際に落ちるか」を、対象のコードを壊して確認した。
**102 本 → 133 本**（`test/resolve.test.ts` が 29 本、`test/coordinates.test.ts` が +2 本）。

| # | 壊した箇所 | 落ちたテスト |
| --: | --- | --: |
| 1 | 水平フェーズを Y の**前**に動かす | 4 |
| 2 | `collidesWith` から contact skin を外す（`> CONTACT_EPSILON` → `> 0`） | 3 |
| 3 | ground clamp の**位置**に epsilon を足す（`floorTop + halfHeight + CONTACT_EPSILON`） | **16** |
| 4 | 床判定の reach 上限を外す（重なっている全ブロックを床とみなす） | 6 |
| 5 | `isRestingOn` を旧・片側実装に戻す | 2 |
| 6 | `clampAxis` の face-span ガードを外す | 2 |
| 7 | `stepBody` を「解決 → 積分」の順にする | 16 |
| 8 | `isGrounded` をプローブでなく Y フェーズのフラグにする | 2 |
| 9 | ground clamp で `vy = 0` をやめる | 6 |
| 10 | Z フェーズを X 補正**前**の箱に対して走らせる | 1 |

**6・8・10 は最初 1 本以下しか落とせず、テストのほうを直した。**

- 6 と 10 は当初どちらも「入隅」の 1 シナリオに相乗りしていた。
  6 には不変条件そのもの（`no phase moves a body further than that phase can justify`）を書き、
  10 には**壁ずり**という別シナリオ（`a body slides along a wall`）を用意した。
  入隅のケースは X 補正の有無で答えが変わらないので、10 を区別できていなかった。
- 8 は固定点のプロパティテストが**空中の body ばかり生成していた**ため素通りしていた。
  接地フラグの新旧が分かれるのは「実際に着地した body をもう一度解決したとき」だけなので、
  生成器に積分を 1 回挟むよう直した。

mutation が 1 本しか落とせないときは、テストが**シナリオを**押さえていて
**不変条件を**押さえていない兆候である、というのが今回の教訓である。

## 直前のカバレッジ拡張について — コミットメッセージの数字が誤っている

`test: cover the code the suites were walking past` のコミットメッセージは
「added 107 tests」と書いているが、**正しくは 27 本**である
(mc-noise 8 + mc-meshing 13 + mc-physics 6)。本リポジトリの実測は **96 → 102**。

107 は 1 日古いレビューの baseline (53/53/68) から引いた差であり、
その時点から 3 リポジトリはすでに 79/79/96 まで育っていた。
16 リポジトリ合計も 2,771 → 2,798 で、差は 27 と一致する。

**この誤りをここに残すのは、それが本プロジェクトで最も多く記録されている欠陥だからである** ——
「結論は正しく、証拠が間違っている」。`CONTINENTALNESS_CONTRAST`、`SETTLE_TICK_LIMIT`、
mc-meshing の HashSet 主張、`setDayLength → setTimeOfDay` の作業例に続く 5 例目で、
しかも**テストカバレッジを説明する文章の中で**やっている。
default branch は `non_fast_forward` で保護されているため履歴は書き換えられない。
書き換えられないこと自体は正しい設計であり、だから訂正はここに置く。

> **6 例目が出た。** `design-notes.md` P-3 が「積分と解決の順序を崩すと物体は床の上に**浮く**」と
> 書いていたが、リゾルバを実装して測ると**沈む**（1 フレーム分の落下距離ぶん、恒久的に）。
> 順序が load-bearing だという結論は正しく、症状の記述だけが逆だった。
> 「浮く」は P-1 のバグクラス名からの引き写しと思われる。訂正は P-3 の中に置き、
> 実測した側（沈む、`g·dt²`）を回帰テストが assert している。
