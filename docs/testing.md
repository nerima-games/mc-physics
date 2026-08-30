# 検証と完成条件

- 上位仕様: plan.md §3.4（検証）、§6 Step 2（完了条件）

## 1. コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json`（出荷ソース）と `tsconfig.test.json`（テスト・ツール）の両方 |
| `pnpm lint` | oxlint。このリポジトリ唯一の lint / format 設定（prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 40 ルールが `warn`、`error` は 2 つだけ。このフラグが無かった頃は実質その 2 つしかゲートになっていなかった） |
| `pnpm test` | Vitest の同期テストと property-based test |
| `pnpm test:coverage` | カバレッジ計測。4 指標 100% のしきい値を強制する(§3 参照) |
| `pnpm build` | `scripts/clean-dist.mjs` で `dist/` を空にしてから `tsc -p tsconfig.release.json` で ESM 実行成果物・型宣言・source map を `dist/` に生成する（バンドラを介さない） |
| `pnpm package:verify` | `pnpm build` を実行したうえで `scripts/verify-package.mjs` を走らせる。`pnpm pack` した実際のアーカイブに `dist/index.js` / `dist/index.d.ts` が含まれ `src/` が含まれないこと、公開 runtime export、型宣言経由の consumer 型検査を検証する |
| `pnpm benchmark` | ビルド済み ESM 成果物を使う決定論的な衝突ベンチマーク |
| `nix flake check --no-build --all-systems` | 宣言した全システムの flake 評価を確認する |
| `pnpm verify` | `typecheck && lint && test` を直列実行する 3 段ゲート。カバレッジ（`test:coverage`）とパッケージ境界検証（`package:verify`）は CI の独立したステップとして別途実行する（組織共通のテスト標準 §1・§3） |

`pnpm check:deps`（`scripts/check-dependency-whitelist.ts`）と `pnpm api:check` / `pnpm api:update`
（`api-lock.md` + `scripts/api-lock.ts`）は組織共通の標準移行に伴い廃止された。
依存の許可グラフは `.oxlintrc.json` の `no-restricted-imports` が（組織共通の依存ポリシー）、
破壊的変更の判定は人間のレビュー([versioning.md](./versioning.md) §5-6)がそれぞれ引き継ぐ。

セットアップ:

```console
$ direnv allow          # flake.nix の devShell で Node.js 24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11.24.0 が要る。
`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい。

> ツールチェーンは `flake.nix` + `flake.lock` で管理する。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。このリポジトリには別の Nix 環境定義を置かない。

## 2. テストの方針

### 同期テストは Vitest を直接使う

mc-physics の公開 API は純粋関数なので、テストも Vitest の `it` / `expect` を直接使う。
Effect の実行ランナーや test adapter を挟まず、失敗した入力と返り値がそのまま見える形にする。

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

## 3. カバレッジ閾値は有効化済み（組織共通のテスト標準 §3）

branches / functions / lines / statements の4指標すべてに **100%** のしきい値を、
voxel raycastはunit cube互換経路に加え、slab/cactus/pressure plateの実形状、空隙通過、
6面、実形状面でのmaxDistance、反復決定性を固定している。

組織共通の即時・全リポジトリ一律ロールアウト方針（テスト標準 §3）に従い有効化している。
猶予期間・段階ロールアウトはない。

`vitest.config.ts`:

```typescript
thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
```

`pnpm test:coverage` は statements / branches / functions / lines の 4 指標すべてに
100% のしきい値を設定している。`resolve-types.ts` は型だけを宣言し実行時コードを出さないため
計測対象から除外し、DDA の実質到達不能な終端フォールバックは V8 の ignore 注釈で
アルゴリズムの他の部分を除外せずに扱っている。

`test/falling-block.test.ts` は、既知・未知・空気の現在ブロック、支持側 capability、
空気・未ロードセル・非支持ブロック直下の落下開始候補を抽象化した座標 query で検証する。

`test/explosion.test.ts` は、抵抗による破壊、遮蔽、未ロードセル、非有限入力、訪問・光線・エンティティ数の
上限、大半径のキャッシュ、entity exposure / damage / knockback、commit callback を検証する。

`test/primed-tnt.test.ts` は、既定 fuse、有限非負への正規化、bounded advance、detonate-once、爆発 planner
の再利用、commit projection を検証する。

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
- **参照実装で発見された不変条件の回帰テスト** —— `design-notes.md` の P-1〜P-9。
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
- **ブロックの共有データを mc-kernel と直接共有する** —— 実装済み。
  `BlockPropertiesAt` は `BlockProperties | null` を返し、標準形状は
  `BlockProperties.collisionShape` から解決する。状態依存・複合形状が必要な呼び出し側だけ
  `BlockShapeAt` を任意注入できる。戻り値は単一 AABB または AABB 配列で、`null`/空配列は
  衝突形状なしを表す。ID・registry・chunk の解決は上位層が所有する（P-8）。DDA の shape callback
  だけは `null` を full cube、空配列を非ヒットとして扱う。
- **爆発計画の純粋性と上限** —— 実装済み。`ExplosionBlockReader` と entity 集合を読み取り専用で受け取り、
  mutation は `ExplosionPlan` に収集する。未ロードセルの遮蔽、決定論、各上限による truncation、commit の
  状態非所有を `test/explosion.test.ts` で固定する。
- **起爆済み TNT の純粋な fuse plan** —— 実装済み。fuse の進行を bounded に計画し、尽きたフレームで
  `planExplosion` を再利用する。detonated state の再爆発禁止と commit の状態非所有を
  `test/primed-tnt.test.ts` で固定する。

**確認済みの移植境界**:

#### (a) step-up の「水平フェーズ再実行」 —— **実装済み**

`resolve-support.ts` の `tryStepUp` は、Y 解決後の水平衝突を入力にして、
`stepHeight` 分だけ持ち上げた位置で X と Z の解決を再試行する。持ち上げ後にも
衝突が残る場合は step-up を採用せず、通常の水平解決結果を返す。

Y → X → Z の順序は、水平フェーズが Y の解決前に体を止めることを防ぐ。
そのうえで、step-up に必要な水平再試行は `tryStepUp` に分離されている。
`test/resolve.test.ts` は片軸・両軸の再試行、持ち上げ後の衝突による棄却、
step height を超える段差の拒否を固定している。

#### (b) sneak-edge（`clampSneakEdge`） —— **実装済み**

`responsibility.md` §3 の表どおり、機構を独立した純関数として実装した。
`test/resolve.test.ts` は平地で不変、片軸だけの clamp、両軸の clamp、停止軸では
足場 query を行わないことを固定している。スニーク状態と足場探索深度は mc-sim が所有する。

`ResolveOptions` のフラグにしなかったのは、スニーク状態を物理機構へ持ち込まず、通常の
`resolveBody` / `stepBody` の結果を変えないためである。呼び出し側は grounded かつ sneaking の
ときだけ適用し、`hasGroundSupport` callback 内でゲーム値の探索深度を使う。

現在のリリース前チェック:

1. `pnpm verify` で型検査・lint・通常テストを実行し、`pnpm test:coverage` でカバレッジを確認する
2. `pnpm package:verify` で `dist/` のビルドと、`pnpm pack` した実際のアーカイブに含まれるファイル・
   runtime export・型宣言経由の consumer 型検査を確認する
3. `0.x` → `1.0.0` の昇格は、mc-sim が実際に消費して契約を確認した後に判断する

## 5. CI

`.github/workflows/ci.yaml` は組織標準のワークフロー（15 runtime repo 共通の形。組織共通のビルド標準
§2.5）。すべてのコマンドを `nix develop --command` 経由で実行する — oxlint は `package.json` の
devDependency ではなく `flake.nix` の devShell が提供するため、他のどのステップも Nix シェルの外では
意味を持たない。job 全体に `timeout-minutes: 20`:

1. Checkout（`actions/checkout`、commit SHA 固定、`fetch-depth: 0`。組織共通のサプライチェーン標準）
2. Setup pnpm（`pnpm/action-setup`、commit SHA 固定）
3. Setup Node.js 24（`actions/setup-node`、commit SHA 固定。pnpm キャッシュ有効）
4. Set up Nix（`./.github/actions/nix-setup`）
5. Configure GitHub Packages authentication（`GITHUB_TOKEN` を pnpm の user 設定へ渡す。public repo
   でも GitHub Packages からの解決に要る）
6. `nix develop --command pnpm install --frozen-lockfile`
7. `nix develop --command pnpm verify` —— `typecheck && lint && test` の3段
8. `nix develop --command pnpm exec changeset status --since=origin/main`（`pull_request` のときだけ。
   `docs/` か `.github/` だけの変更はスキップ） —— ユーザー向け変更に changeset の付け忘れがないか
   検出する（組織共通のリリース標準 §1.2）
9. `nix develop --command pnpm test:coverage` —— **ハードゲート**。4 指標 100% のしきい値を下回れば
   非ゼロ終了する（§3）
10. `nix develop --command pnpm package:verify` —— `dist/` のビルドと、`pnpm pack` した実際の
    アーカイブの内容・runtime export・型宣言を検証する
11. `nix develop --command pnpm audit` —— 依存の脆弱性監査。advisory が出た transitive package は
    `pnpm-workspace.yaml` の `overrides` で pin する（現在: `nanoid`、GHSA-2v37-7h3g-55p8）
12. カバレッジレポートを artifact に upload（`actions/upload-artifact`、commit SHA 固定、`if: always()`。
    7 日保持）

publish は別の `.github/workflows/release.yaml` が担う: `main` への push で `package.json` の
`version` が変化していたときだけ `pnpm verify && pnpm package:verify` を再実行してから
`pnpm publish --no-git-checks` する（detect → publish → tag の 3 job。組織共通のリリース標準 §3.3）。

`pnpm check:deps` と `pnpm api:check` の2ステップは、それぞれの裏付けとなる
`scripts/check-dependency-whitelist.ts` と `api-lock.md` / `scripts/api-lock.ts` が
org 標準への移行で全廃されたため、CI から削除済みである。

## 6. 現時点のテスト一覧

| ファイル | 内容 |
| --- | --- |
| `test/coordinates.test.ts` | foot/centre のラウンドトリップ、半分と全体の取り違え検出、ブロック占有 `[y,y+1]`、`surfaceY+1`、接地が衝突と読まれないこと、**浮動小数誤差の大きさの固定**、文書化された反例、`collidesWith` と `intersects` が食い違う唯一の場所、**`isRestingOn` が両側であること**、AABB の対称性 |
| `test/resolve.test.ts` | **軸順序（継ぎ目・ledge・step-up・壁ずり・入隅）**、ground clamp とその順序（**逆順のコストを `g·dt²` で固定**）、天井、壁が床にならないこと、**着地状態が P-6 の反例と一致すること**、1000 フレームの無ドリフト、固定点、**めり込みゼロ**（起伏地形 / 任意高度からの落下 / 終端速度）、**エネルギー非増加**（および step-up がその唯一の例外であること）、**補正量の上限**、決定論と順序非依存、**問い合わせセルが箱の中に収まること**、形状注入、着地バウンス（`bouncinessAt`。genuine な床衝突でだけ効くこと、接触した cell のサンプル、`0` が無指定と bit-identical であること、`1` へのクランプ、反射後 `isGrounded: false`） |
| `test/integrate.test.ts` | semi-implicit Euler の順序、終端速度、**トンネリング不変条件**、static/kinematic 不変、決定論と順序非依存、注入された `dragPerSecond` の連続減衰と既定値 1 が無注入と bit-identical であること、注入された `terminalVelocityY` とその既定値へのフォールバック |
| `test/dda.test.ts` | voxel DDA（原点セル除外・法線・面・maxDistance・退化入力・step 予算の枯渇・訪問順・決定論）、負方向の走査、shape narrow-phase（slab/cactus/pressure plate の実形状、空隙通過、6 面、複合形状の最近傍選択、不正形状の無視） |
| `test/delta-time.test.ts` | deltaTime クランプの厳密一致 / 上下限 / NaN / 初回フレーム、**`DeltaTimeSecs` ブランドが kernel の refinement であること**（有限・非負。ゼロも 30 も通る）、**`clampDeltaTime` の出力が常に安全域に入ること**（プロパティテスト） |
| `test/glide.test.ts` | ダイブ/レベル/クライムでの速度変化の向き、視線方向への漸次的な旋回、決定論、非有限入力の無害化、有限入力が常に有限出力になること（プロパティテスト）、ゼロ delta が恒等写像であること、ダイブの反復変換が発散せず不動点に収束すること |
| `test/piston.test.ts` | 押し出し距離と crush 判定、ゼロ移動・未到達を押し出しと数えないこと、負方向の押し出し、押し出し軸に直交する軸を変えないこと、押し出し後にめり込みが残らないこと、変位が押し出し軸だけに乗ること、決定論 |
| `test/public-api.test.ts` | barrel の export、実測定数の固定、**ブランドが kernel 準拠でクランプが境界にあること**、終端速度と delta 上限の導出関係、`CONTACT_EPSILON` の桁 |
| `test/entity-collision.test.ts` | entity 同士の broad-phase（`potentialPairs`）/ narrow-phase（`collisionOf`）検出、質量ベースの解決（`resolveEntityCollisions`）、接触法線、反発係数、決定論、解決結果のプロパティ |
| `test/environment.test.ts` | block query、形状 query、空気・未知ブロック・流体状態の環境境界、`SurfaceEffects.movementDragY`（クモの巣/パウダースノー相当の異方性ドラッグ） |
| `test/falling-block.test.ts` | falling capability、支持 capability、空気・未ロードセル・未知セル・非支持ブロック直下の落下開始候補 |
| `test/landing.test.ts` | 実移動距離ベースの落下距離累積と一回限りの着地衝撃 |
| `test/fluid.test.ts` | 水・溶岩の fluid state と流体判定、kernel registry との整合、`dragPerSecondY`（垂直ドラッグが水平と独立であること、未指定時のフォールバック） |
| `test/kernel-world.test.ts` | mc-kernel の block id / properties / shape を参照するワールド境界 |
| `test/movement.test.ts` | body の移動、衝突解決、step-up、sneak-edge の組み合わせ、水泳上昇（`inFluid`、接地ジャンプとの排他） |
| `test/projectile.test.ts` | `ARROW_PROFILE` が kernel の矢実装をステップ毎に再現すること、launch と積分、block/entity への継続的な swept 衝突、寿命・ワールド境界、プロファイルごとの挙動差、決定論 |
| `test/explosion.test.ts` | 爆発の抵抗・遮蔽・上限・決定論、entity effect、commit projection |
| `test/primed-tnt.test.ts` | fuse の既定値・正規化・bounded advance・detonate-once・爆発 planner 再利用・commit projection |

> **「`DeltaTimeSecs` の構築拒否」は現在テストしていない。** ブランドはクランプ範囲を要求しない
> ——要求しても意味が無かったからである（[design-notes.md](./design-notes.md) P-5、
> [public-api.md](./public-api.md) §2-1）。代わりに、ブランドが**何を通すか**と
> クランプが**何を返すか**を別々のテストが主張している。

`test/check-dependency-whitelist.test.ts`(16 リポジトリ roster の完全性・非循環・推移閉包の拒否
などを検査していたテスト)は、裏付けの `scripts/check-dependency-whitelist.ts` が組織共通の
標準移行に伴って廃止されたため、同時に削除した。代替は `.oxlintrc.json` の
`no-restricted-imports`（組織共通の依存ポリシー）で、これはテストコードではなく lint 設定なので
この一覧には現れない。

## 7. テストの健全性

軸順序、接触 skin、ground clamp、支持判定、step-up、swept collision などの
不変条件について、対象実装を意図的に変更したときに対応するテストが失敗することを
確認している。検証用の変更は作業ツリーに残していない。

新しいテストは、代表的なシナリオだけでなく、実装の順序や境界を直接検出する不変条件も
含める。これにより、テストが通ることだけでなく、壊れた実装をテストが検出することも
リゾルバの変更時に確認できる。
