# @nerima-games/mc-physics

## 責務

Euler 積分、ブロック / エンティティ AABB 衝突、voxel-DDA、環境効果、飛翔体、爆発、起爆済み TNT fuse の
純粋な計算。**外部物理ライブラリなし**（plan.md §3.4）。（爆発と起爆済み TNT の計算自体は
mc-kernel への委譲であり、この層は再 export と bounded な呼び出し契約だけを持つ。
`docs/public-api.md` §5-1/§5-2）

## 依存

`@nerima-games/mc-kernel@0.5.0` を実行時依存として直接利用し、
`BlockProperties`、`BlockCapabilities`、`FluidKind`、`DeltaTimeSecs`、`Position` を共有する。座標語彙も
共有し、この層が独自に持っていたローカルな `{x, y, z}` 型とその生成関数は廃止して
kernel の `Position`/`position` を再 export する
（衝突判定に使う flat AABB はホットパス設計としてこの層に残す。`docs/responsibility.md` §4）。
爆発計画（`planExplosion`）と起爆済み TNT の fuse 進行（`primeTnt`/`planPrimedTnt`）は、旧
`domain/explosion.ts` / `domain/primed-tnt.ts` の独自実装との等価性を確認したうえで削除し、
kernel の実装をそのまま再 export する（`docs/porting.md` §7）。`effect` は値の検証と
純粋な計算の組み立てに使う。ブロック ID、レジストリ、チャンクはこの層に複製しない。

## このリポジトリの位置づけ

| 関係 | リポジトリ |
| --- | --- |
| 親（依存先） | `mc-kernel` のみ |
| 子（依存元） | `mc-sim` のみ |

4 階層アーキテクチャの**安定ライブラリ層**（plan.md §2.2）。

mc-physics がワールドに問うのは、注入されたセルの性質と形状だけである。`null` は空気または
衝突しないセルを表す。`kernel-world` はチャンク座標から ID を読む関数を受け取り、registry の
解決を mc-kernel に直接委譲する。状態依存・複合形状、流体状態、エンティティ集合は個別の
コールバックや引数で注入できるので、ワールドにもチャンクマネージャにもレンダラにも依存しない。

## 2 つの構造的なルール

### 1. ブロック ID の名指し禁止（plan.md §3.4）

通過可否・形状は**mc-kernel の `BlockProperties | null`** として扱う。チャンク座標から ID を
読む処理は呼び出し側が所有し、registry の解決は `blockPropertiesAtFromKernel` または
`resolveOptionsFromKernel` に委譲できる。mc-physics はブロック ID 名の語彙を持たない。

参照実装は逆をやっていた。`packages/game/domain/block-collision-predicates.ts:16-42` に
19 個のブロック名を手書きした `PASSABLE_BLOCK_IDS` denylist があり、
そのコメント自体が出荷済みバグの記録になっている —— 葉をリストに入れたせいで、
プレイヤーが木の樹冠をすり抜けて落ちた。
詳細は [`docs/design-notes.md`](./docs/design-notes.md) P-8〜P-9。

### 2. 足元原点 Y と AABB 中心 Y は別の型である（plan.md §3.4）

> 「物が浮く」バグ類は例外なく**足元原点 vs AABB中心のY規約不一致**が原因。座標規約を型で区別する

参照実装は物理パス全体で中心 Y を使い、足元は各所で手書き変換していた（6 箇所）。
どちらも素の `number` なので、コンパイラにも人間にも区別できない。
参照実装にはこの規約が原因の出荷済みバグのコメントまで残っている
（`game-state-update-orchestration.ts:97-103`）。

本リポジトリでは `FootY` / `CentreY` / `HalfHeight` を branded 型にした。
`footY - halfHeight` は型エラーになる。変換は 1 箇所だけ、名前付きで存在する。
詳細は [`docs/design-notes.md`](./docs/design-notes.md) P-1。

## ドキュメント

**[`docs/`](./docs/README.md) に実装に必要な情報をすべてまとめてある。**

| ドキュメント | 内容 |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | 4 階層、依存グラフ、依存ホワイトリスト CI |
| [`docs/responsibility.md`](./docs/responsibility.md) | 責務と、明示的にスコープ外のもの |
| [`docs/public-api.md`](./docs/public-api.md) | 公開 API と参照実装での裏付け |
| [`docs/design-notes.md`](./docs/design-notes.md) | 設計注意 P-1〜P-9 と、対応する名前付き回帰テスト |
| [`docs/porting.md`](./docs/porting.md) | 移植元パスと実測 LOC |
| [`docs/testing.md`](./docs/testing.md) | 検証と完成条件 |
| [`docs/versioning.md`](./docs/versioning.md) | 0.x → 1.0.0 と公開成果物 |

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11 を用意する
（`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい）。

> **注意**: ツールチェーンは `flake.nix` + `flake.lock` で管理する。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。このリポジトリには別の Nix 環境定義を置かない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 40 ルールが `warn`、`error` は 2 つだけ。このフラグが無かった頃は実質その 2 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | Vitest の同期テストと property-based test |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測。4 指標(statements/branches/functions/lines)とも 100% のしきい値を強制する |
| `pnpm build` | ESM の `dist/index.js` と型宣言・source map を生成 |
| `pnpm benchmark` | ビルド済み ESM 成果物を使う決定論的な衝突ベンチマーク |
| `pnpm pack --dry-run` | npm 配布物に含まれるファイルを確認 |
| `pnpm peers check` | peer dependency の整合性を確認 |
| `pnpm verify:package` | `package.json` の export map から生成済み `dist` を読み込む smoke |
| `pnpm verify` | `typecheck && lint && test && test:coverage && build && verify:package`。公開前に実行する全ゲート |

## 使い方

```typescript
import {
  centreOfFoot, standingPlaneAbove, PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH,
  clampDeltaTime, clampSneakEdge, stepBody, voxelRaycast, position,
  launchProjectile, stepProjectile, ARROW_PROFILE, glideStep, pistonExtrusion,
  planExplosion, applyExplosionPlan, primeTnt, planPrimedTnt, applyPrimedTntPlan,
} from '@nerima-games/mc-physics'

// スポーン: surfaceY の上に立つ。+1 でブロック上面、+halfHeight で体の中心。
const centre = centreOfFoot(standingPlaneAbove(surfaceY), PLAYER_HALF_HEIGHT)

// 1 フレーム進める。`clampDeltaTime` が積分に渡す delta を作る唯一の正規の入口である。
// ブランド自体は kernel と同じく「有限かつ非負」までしか言わない（docs/public-api.md §2-1）。
// 範囲が要るところでは `isClampedDelta` で assert する。
const dt = clampDeltaTime(rawDeltaSecs)     // min(max(0.001, raw), 0.05)

// 積分 → 解決。この順序は逆にできない（逆にすると 1 フレーム分の落下距離だけ床に沈む）。
// stepBody がその合成に名前を与えているので、逆順は diff に現れる。
// 第4引数 IntegrationOptions（省略可、{ gravityY?, dragPerSecond?, terminalVelocityY? }）は
// 既定が公式 Java 版準拠で、注入で上書きできる。dragPerSecond は [0, 1] 外・非有限なら
// 既定の 1（無抵抗）へフォールバックする。
const { body: next, isGrounded } = stepBody(body, dt, {
  halfWidth: PLAYER_HALF_WIDTH,
  halfHeight: PLAYER_HALF_HEIGHT,
  blockPropertiesAt,   // または blockPropertiesAtFromKernel(blockIdAt)
  // blockShapeAt,     // 状態依存・複合形状。単一AABBまたはAABB配列を返す
  // stepHeight: 0.6,  // ゲーム的なチューニング値。既定 0（= step-up 無し）
  // bouncinessAt,     // スライムブロック/ベッドの着地バウンス。[0,1]、反射時は isGrounded=false
}, {
  // dragPerSecond: 0.9, // 例: 低速で落下するブロック。省略時は 1（無抵抗）
})

// ブロック狙撃は DDA。原点セルは決して返さない。
const hit = voxelRaycast(eye, forward, 5, (bx, by, bz) => isSolid(bx, by, bz))

// slab/cactus/pressure plate などは第5引数でcell-local AABBまたはAABB配列を返す。
// resolve/environment では null または空配列が「衝突形状なし」。DDAでは null がfull cube、空配列が非ヒット。
const shapedHit = voxelRaycast(eye, forward, 5, isTargetable, blockShapeAt)

// 矢/雪玉/卵/トライデントは ProjectileProfile を注入する一般化 API。
// ARROW_PROFILE は kernel の矢用ステップ関数とステップ毎等価（test/projectile.test.ts）。
const flying = launchProjectile({ position: eye, yawRadians, pitchRadians, speed: 3 })
const projectileStep = stepProjectile(flying, dt, projectileWorld, ARROW_PROFILE)

// エリトラ滑空とピストン押し出しは、状態を持たない幾何・速度計算だけを提供する。
const nextVelocity = glideStep(velocity, { pitchRadians, yawRadians }, dt)
const extrusion = pistonExtrusion(entityAabb, { axis: 'y', before: blockAabbBeforeMove, distance: 1 })

// 爆発は破壊対象とエンティティ効果を決定論的に計画する。状態の書き込みは呼び出し側が行う。
const explosionPlan = planExplosion({
  center: position(0, 0, 0), radius: 4, seed: 0, blocks: explosionBlockAt, entities,
})
applyExplosionPlan(explosionPlan, ({ destroyedBlocks, entityEffects }) => {
  commitExplosionMutation(destroyedBlocks, entityEffects)
})

// 起爆済み TNT は fuse の進行と爆発計画への遷移だけを行い、状態の commit は呼び出し側が行う。

// sneak/grounded の判定と support の深さはゲーム側の責務。
// 物理層は X/Z を独立に止めるため、崖の縁に沿った移動は残る。
const horizontal = clampSneakEdge(previous, intended, hasGroundSupport)
```

**シミュレーションは時刻を読まない。** `src/` の物理計算はクロックへアクセスせず、
`Date.now()` / `new Date()` / `performance.now()` の値を引数として受け取らない。
ベンチマークだけは計測のため `performance.now()` を使う。
かつては `pnpm check:deps`（`scripts/check-dependency-whitelist.ts`）が機械的に検出していたが、
そのスクリプトは組織共通の標準移行に伴って廃止された。現時点ではレビューで担保する。
`deltaTimeBetween` はクロックではなく**読み取り値**を受け取る。

## 現状

**公開成果物を生成できる実装済みの 0.x ライブラリ。**

- **`DeltaTimeSecs` のブランドは kernel の refinement（有限・非負）であり、`[0.001, 0.05]` ではない。**
  かつて範囲まで refine してあり「クランプを通らない値は構築できない」と説明していたが、
  `Brand.Brand<'DeltaTimeSecs'>` は**文字列でキーされる**ので、
  kernel で作った `DeltaTimeSecs(30)` は本リポジトリの `integrateBody` の引数の型を満たしてしまう。
  狭いブランドが買っていたのは安全ではなく偽の保証だった。
  クランプは `clampDeltaTime` として境界に残り、`isClampedDelta` が不変条件を assert 可能にしている
  （[`docs/design-notes.md`](./docs/design-notes.md) P-5、[`docs/public-api.md`](./docs/public-api.md) §2-1）。
- **AABB 衝突リゾルバは実装済み**（`src/domain/resolve.ts`）。判断とその根拠は
  [`docs/design-notes.md`](./docs/design-notes.md) P-9 にある。要点:
  - **軸順序 Y → X → Z**。根拠は実測である。X を先にすると「平地の継ぎ目に引っかかる」と
    「step-up が効かなくなる」の 2 つが壊れる。参照実装が順序テストの題材にしている
    ledge のケースは、本リポジトリでは別の機構が先に効くので順序を区別しない（P-9-1）
  - **`stepBody` は高速移動を swept AABB で連続判定する**。長い水平・垂直・斜め移動でも
    最初の solid 面で停止し、残りの軸では滑る。短い移動と終点の重なりは既存の
    Y → X → Z resolver に渡すため、step-up と接地の挙動は維持される（P-9-2）
  - **参照実装の `MAX_STEP_UP` / `FALL_VELOCITY_THRESHOLD` を両方とも使わない。**
    床の判定は「このステップで実際に落ちた距離」`-vy * dt` で厳密に決まる。
    これが厳密なのは semi-implicit Euler だから（P-4）である（P-9-3）
  - **`blockPropertiesAt` は注入**。`domain/` にブロック ID の語彙は 1 つも無く、kernel の `collisionShape` を標準形状へ接続する（P-8）
  - ground clamp はリゾルバ内部にあり、`stepBody` が「積分 → 解決」の合成に名前を与えている
- **`design-notes.md` P-3 の「順序を崩すと浮く」は誤りだった。**
  実測すると**沈む**（1 フレーム分の落下距離、恒久的に）。
  順序が load-bearing だという結論は正しく、症状の記述だけが逆だった。P-3 に訂正を置いた。
- **`isRestingOn` は片側だけの述語だった。** `penetrationY` は離れていると負になるので、
  上空を落下中の物体も「接地」を満たしていた。既存テストは全て面の上に物体を置いていたので
  1 本も落ちなかった。リゾルバが接地判定に使い始めたところで露見した（P-6）。
- **`CONTACT_EPSILON` はプロパティテストが見つけた問題への対処である。**
  `(foot + h) - h` は IEEE-754 で正確に `foot` にならない
  （反例: `surfaceY = 1`, `halfHeight = 0.05` で 2 ulp 下にずれる）。
  厳密な交差判定は、床の上で静止しているエンティティを「衝突」と報告する。
  テストを緩めて済ませていたら、同じバグがリゾルバの中に移動していただけだった。
  詳細は [`docs/design-notes.md`](./docs/design-notes.md) P-6。
- **積分器は純粋版のみ。** 参照実装は割り当て回避のため破壊的に更新する。
  ホットパスには in-place 版が要るが、ベンチマークができてから、かつ純粋版を定義とする
  API の下に入れる。正しさが先、速さは後。しかも速い版はこれに対してテストできる。
- **`FootY` / `CentreY` / `HalfHeight` はこの層に置く。**
  kernel の共有値型が担わないボディ座標の意味を物理層で分離し、足元原点と AABB 中心を
  同じ `number` として混同しない。
- **エネルギー非増加・めり込みゼロ・決定論のプロパティテストは 3 つとも入った**
  （`test/resolve.test.ts`）。参照実装にはこれらのテストが 1 つも存在しない
  （plan.md §3.4 のこの行は参照実装の記述ではなく、新リポジトリへの要求である）。
  **エネルギーを増やす経路は step-up ただ 1 つ**であり、それはゲーム的な行為なので
  注入で既定 0 にしてある。テストがその例外も明示している。
- **標準形状は full block / slab / cactus / pressure plate を提供する。**
  kernel の registry 解決は `kernel-world` が担い、state 依存・複合形状との対応付けは
  `blockShapeAt` を実装する呼び出し側の責務である。
- **環境効果の計算を提供する。** `BlockProperties` と `BlockCapabilities` から、表面摩擦、
  movement drag、接触ダメージ、窒息、climbable、流体の体積と flow をサンプリングできる。
  流体伝播とダメージ適用は呼び出し側が所有する。
- **落下ブロックの開始候補を判定する。** `fallsWhenUnsupported` と支持側の
  `canSupportAttachments` を mc-kernel から直接使い、ブロック ID と位置を返す。ブロック除去、
  落下エンティティの生成、着地配置は呼び出し側が所有する。
- **エンティティ衝突と移動の純粋なプリミティブを提供する。** 質量を使った解決に加えて、
  broad-phase（空間グリッド、`potentialPairs`）と narrow-phase（`collisionOf`、`inverseMassOf`、
  `normalizedOptions`）自体も公開する。`applyMovementInput` は水泳上昇（`inFluid` 引数と
  `fluidAscentAcceleration` / `fluidAscentMaxSpeed`）を追加で受け取る。jump、sprint、knockback も公開する。
- **投射体は `ProjectileProfile` を注入する一般化 API を提供する。** Arrow 固有だった旧 API
  （矢専用の launch/step 関数と定数群）は撤去し、`launchProjectile`/`stepProjectile` が
  `ARROW_PROFILE` / `SNOWBALL_PROFILE` / `EGG_PROFILE` / `TRIDENT_PROFILE` を注入で切り替える。
  `ARROW_PROFILE` は kernel の対応する矢実装とステップ毎に等価であることをテストで固定している。
  永続化、アイテム消費、ダメージ、Arrow 型そのものが必要な消費者は kernel を直接使う。
- **爆発と起爆済み TNT の bounded plan は kernel の実装をそのまま再 export する。**
  独自の `domain/explosion.ts` / `domain/primed-tnt.ts` は、kernel 版との等価性を確認したうえで
  削除した（`docs/porting.md` §7）。`planExplosion` はブロックの抵抗・遮蔽から破壊対象を、
  エンティティの露出から damage / knockback を計算し、`applyExplosionPlan` は計画データを
  commit callback に渡すだけである。`primeTnt` / `planPrimedTnt` は bounded な fuse 進行を計画し、
  尽きたフレームでは同じ爆発 planner を再利用する。ブロック除去、health、velocity、ドロップの更新、
  TNT entity の lifecycle と状態の永続化は、どちらもいまなお呼び出し側が所有する。
- **落下・移動の既定値は公式 Java 版準拠で、すべて注入で上書きできる。**
  `integrateBody`/`stepBody` は空気抵抗（`dragPerSecond`、既定 1 = 抵抗なし）と終端速度
  （`terminalVelocityY`、既定 -32）を追加引数で受け取る。`SurfaceEffects.movementDragY` と
  `FluidMotionCoefficients.*.dragPerSecondY` は水平とは別の垂直ドラッグ（クモの巣、パウダースノー、
  溶岩）を表現する。`ResolveOptions.bouncinessAt` はスライムブロック/ベッドの着地バウンスで、
  反射した着地は `isGrounded: false` を返す。
- **エリトラ滑空とピストン押し出しの幾何・速度計算を提供する。** `domain/glide.ts` の `glideStep` は
  1 tick 分の滑空速度変化を計算する純関数で、係数は公式ソースではなくコミュニティによる
  逆解析からの校正であることをモジュールヘッダに明記している。装備・耐久・接地判定は呼び出し側の
  責務である。`domain/piston.ts` の `pistonExtrusion` は、移動するブロック AABB が静止エンティティを
  押し出す変位を計算する —— この層の他の解決関数がすべて「非めり込みを維持する」のに対し、
  ピストンだけは「非めり込みを確立する」唯一の例外である（`docs/design-notes.md` P-9-7）。
  どちらのブロックが動くか、通電判定、ブロック状態の書き換えは mc-redstone/mc-sim が所有する。
- **ビルド成果物を生成する。** `pnpm build` は ESM の `dist/index.js`、型宣言、source map を生成し、
  `exports` は `dist` のみを公開する。`prepublishOnly` は `pnpm verify` を実行する。
- **カバレッジ閾値は 100%。** 計測対象の statements / branches / functions / lines をすべて
  100% で検証する。型だけの `resolve-types.ts` と、証明済みの到達不能な V8 計測点は設定で明示的に除外する。

### 現行 API の境界

公式 Minecraft と同一の版・Edition 仕様は未指定であり、このライブラリ単独での完全互換は主張しない。
上記の環境、移動、エンティティ、投射体、滑空、ピストンの API は、注入された状態に対する純粋な計算であり、
完全な Minecraft tick を実行するオーケストレーターではない。次の機能はこの層が所有しない。

- fluid の流動・ブロック状態更新、インベントリ、アイテム、mob AI
- 接触ダメージ・窒息・落下ダメージの health / status への適用
- 爆発で計画されたブロック除去、health / status / velocity への適用、ドロップ生成
- entity collection の lifecycle、tick 順序、乗り物、落下ブロックのブロック除去・entity 生成・着地配置
- エリトラの装備・耐久判定、滑空状態そのものの決定（`glideStep` は速度変化のみ計算する）
- ピストンの通電・可動判定・ブロック状態の書き換え（`pistonExtrusion` は押し出し幾何のみ計算する）
- Edition / version ごとの block state、複合形状、projectile tuning と公式データセット

これらを公式互換として固定するには、対象 Edition・バージョン・データ源を仕様として固定し、
kernel / sim の責務を追加で定義する必要がある。

## License

MIT
