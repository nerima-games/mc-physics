# 公開 API

- 出典: plan.md §3.4 + **参照実装の実コードによる検証**
- 参照実装ルート: `<reference-impl>`（以下パスはこれ相対）

## 1. `step(state, world, dt)` —— 参照実装では 3 層に分かれている

plan.md §3.4 は `step(state, world, dt)` と書くが、参照実装では 3 段になっている。

**Application ファサード**（`packages/game/application/physics-service.ts:95`）:

```typescript
        step: (deltaTime: DeltaTimeSecs): Effect.Effect<void, PhysicsServiceError> =>
```

**Port インターフェース**（`packages/game/domain/physics-port.ts:12`）:

```typescript
  readonly step: (world: CustomWorld, dt: DeltaTimeSecs) => Effect.Effect<void>
```

**実際の Euler 積分器**（`packages/game/infrastructure/boundary/physics-world-service.ts:39-54`、原文）:

```typescript
      step: (world: CustomWorld, deltaTime: DeltaTimeSecs): Effect.Effect<void, never> =>
        Effect.sync(() => {
          const gravityY = world.gravity.y
          for (const body of world.bodies) {
            if (body.type !== 'dynamic') continue

            body.velocity.y += gravityY * deltaTime
            // Clamp downward fall to terminal velocity so a single step never
            // moves the body more than its own height (tunneling guard). Upward
            // motion (jumping) is untouched.
            if (body.velocity.y < TERMINAL_VELOCITY_Y) body.velocity.y = TERMINAL_VELOCITY_Y
            body.position.x += body.velocity.x * deltaTime
            body.position.y += body.velocity.y * deltaTime
            body.position.z += body.velocity.z * deltaTime
          }
        }),
```

読み取れること:

- **semi-implicit（symplectic）Euler**: 速度を先に更新し、位置は**新しい**速度から出す
- 重力は Y のみ。X/Z に加速度は無い
- `static` / `kinematic` はスキップ
- 位置と速度を**破壊的に更新**する（割り当て回避）

本リポジトリ（`domain/integrate.ts`）は純粋版を先に置いた:

```typescript
export type BodyKind = 'dynamic' | 'static' | 'kinematic'
export type Body = {
  readonly kind: BodyKind
  readonly x: number
  readonly y: number   // CENTRE Y
  readonly z: number
  readonly vx: number; readonly vy: number; readonly vz: number
}
export const GRAVITY_Y = -9.82
export const TERMINAL_VELOCITY_Y = -32
export const integrateBody = (body: Body, deltaTime: DeltaTimeSecs, gravityY?: number): Body
export const integrate = (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, gravityY?: number): ReadonlyArray<Body>
export const maxFallPerStep = (maxDeltaSecs: number): number
```

ホットパスには in-place 版が要るが、それは**ベンチマークができてから**、
かつ純粋版を定義とする API の下に入れる。正しさが先、速さは後。しかも速い版はこれに対してテストできる。

### 定数の出典

| 定数 | 値 | 参照実装 |
| --- | --- | --- |
| `GRAVITY_Y` | `-9.82` | `packages/game/application/game-state-support.ts:10`。配線は `game-state-service.ts:104` |
| `TERMINAL_VELOCITY_Y` | `-32` | `physics-world-service.ts:16`。導出コメントは `:6-15` |

`TERMINAL_VELOCITY_Y` は空気抵抗の物理主張**ではない**。トンネリングガードである:
AABB リゾルバは、step 後にボディの箱の中に収まった床しか捕まえられないので、
1 step の落下距離がボディの高さを超えてはならない。
`MAX_DELTA_SECS = 0.05`、身長 1.8 m なら最大 `1.8 / 0.05 = 36`。参照実装は余裕を見て 32。

## 2. deltaTime のクランプ

参照実装 `packages/game/application/game-loop.ts:116-119`（原文）:

```typescript
                  const rawDelta = lastTimestamp === 0
                    ? FIRST_FRAME_DELTA_SECS
                    : (timestamp - lastTimestamp) / 1000
                  const deltaTime = DeltaTimeSecs.make(Math.min(Math.max(0.001, rawDelta), 0.05))
```

`FIRST_FRAME_DELTA_SECS` は `packages/core/domain/constants.ts:8-9`:

```typescript
// Used for the very first frame when no previous timestamp exists (16ms @ 60fps).
export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs.make(0.016)
```

**plan.md の記述はこの点について完全に正しい**（`min(max(0.001, raw), 0.05)`、初回 0.016）。

本リポジトリ（`domain/delta-time.ts`）:

```typescript
export { DeltaTimeSecs } from '@nerima-games/mc-kernel'
export type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
export const MIN_DELTA_SECS = 0.001
export const MAX_DELTA_SECS = 0.05
export const FIRST_FRAME_DELTA_SECS = 0.016
export const isClampedDelta = (deltaSecs: number): boolean          // [MIN, MAX] に入っているか
export const clampDeltaTime = (rawDeltaSecs: number): DeltaTimeSecs // 境界。出力は常に isClampedDelta
export const deltaTimeBetween = (previousSecs: number | undefined, currentSecs: number): DeltaTimeSecs
```

参照実装との差分は **NaN の扱いだけ**である。
`Math.max(a, NaN)` は NaN であり、NaN の delta は 1 フレームで世界中の位置を汚染したうえ、
出所の痕跡を残さない。そのため `clampDeltaTime` は NaN を初回フレーム値に落とす。

### 2-1. ブランドは `[0.001, 0.05]` を要求**しない**

`DeltaTimeSecs` は当初 `[MIN_DELTA_SECS, MAX_DELTA_SECS]` に refine してあり、
「クランプを通らない値は構築できない」と説明していた。**それは誤りだった。**

`DeltaTimeSecs` は `@nerima-games/mc-kernel@0.4.0` の資産であり、kernel は「有限かつ非負」に refine している
（`mc-kernel` の `quantities`。ゼロは合法）。本リポジトリはその値と型を直接再 export し、時間量の検証を複製しない。

したがって kernel 経由で作った `DeltaTimeSecs(30)` は型上は受け取れるが、フレーム幅として安全かどうかは
`clampDeltaTime` / `isClampedDelta` の責務である。狭いローカルブランドを重ねて別の保証を作らない。
（詳細は [design-notes.md](./design-notes.md) P-5。）

**クランプは弱まっていない。属すべき場所に移った。**

| 何を言うか | どこで言うか |
| --- | --- |
| 「これはフレームの経過秒である」（有限・非負） | `DeltaTimeSecs` ブランド。kernel と同一 |
| 「これは積分器に渡して安全な step である」 | `clampDeltaTime` の出力、および `isClampedDelta` |

「30 秒バックグラウンドにあったタブをどうするか」は delta を**生んだループ**の問いであって、
量そのものの性質ではない。`clampDeltaTime` は積分に渡す delta を作る唯一の正規の入口であり続ける。
`isClampedDelta` は、その不変条件に実際に依存する場所で invariant を検査可能にする。

固定しているテスト:
`REGRESSION: the brand is kernel’s refinement — finite and non-negative, zero included`、
`REGRESSION: clampDeltaTime is the boundary — its output is always inside the safe range`、
`pins DeltaTimeSecs to kernel’s refinement, with the clamp applied at the boundary`。

## 3. 座標規約（`domain/coordinates.ts`）—— 本リポジトリの中核

```typescript
export type FootY = number & Brand.Brand<'FootY'>
export type CentreY = number & Brand.Brand<'CentreY'>
export type HalfHeight = number & Brand.Brand<'HalfHeight'>   // refined: 正の有限値

export const centreOfFoot = (foot: FootY, halfHeight: HalfHeight): CentreY
export const footOfCentre = (centre: CentreY, halfHeight: HalfHeight): FootY
export const standingPlaneAbove = (surfaceY: number): FootY

export const PLAYER_HALF_WIDTH = 0.3
export const PLAYER_HALF_HEIGHT: HalfHeight   // 0.9

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number }
export const vec3 = (x: number, y: number, z: number): Vec3

export type AABB = {
  readonly minX: number; readonly minY: number; readonly minZ: number
  readonly maxX: number; readonly maxY: number; readonly maxZ: number
}
export const entityAABB = (x: number, centreY: CentreY, z: number, halfWidth: number, halfHeight: HalfHeight): AABB
export const blockAABB = (bx: number, by: number, bz: number, shape?: AABB): AABB
export const FULL_BLOCK_SHAPE: AABB
export const SLAB_SHAPE: AABB
export const PRESSURE_PLATE_SHAPE: AABB
export const CACTUS_SHAPE: AABB

export const intersects = (a: AABB, b: AABB): boolean
export const penetrationY = (a: AABB, b: AABB): number
export const CONTACT_EPSILON = 1e-9
export const isRestingOn = (body: AABB, surface: AABB): boolean
```

### 参照実装は BODY-CENTRE Y 一本である（実測）

`packages/game/domain/aabb-collision.ts:232-237`（原文）:

```typescript
    const feetY = y - halfH
    const headY = y + halfH
    const playerMinX = x - halfW
    const playerMaxX = x + halfW
    const playerMinZ = z - halfW
    const playerMaxZ = z + halfW
```

物理パスに foot-origin の位置は**一つも無い**。足元は常に `y - halfH` として導出される。

半径定数（`packages/core/domain/constants.ts:22-24`）:

```typescript
// Player AABB half-extents — single source of truth used by block-service and game-state.
export const PLAYER_HALF_WIDTH = 0.3   // x and z half-extents
export const PLAYER_HALF_HEIGHT = 0.9  // y half-extent
```

Mob も同値（`packages/entity/domain/mob/spawner-config.ts:6-8`）。

### 手書きの centre→foot 変換が 6 箇所ある

これが plan.md §3.4 の言う「Y規約不一致」の温床である:

| 場所 | 式 |
| --- | --- |
| `game-state-update-orchestration.ts:148` | `currentPos.y - PLAYER_HALF_HEIGHT - 0.05` |
| `game-state-update-orchestration.ts:231` | `y: physPos.y - PLAYER_HALF_HEIGHT` |
| `game-state-update-orchestration.ts:277` | `y: physPos.y - PLAYER_HALF_HEIGHT` |
| `player-physics.ts:176` | `collidedPos.y - PLAYER_HALF_HEIGHT` |
| `player-physics.ts:219` | `collidedPos.y - PLAYER_HALF_HEIGHT` |
| `entity-update-stage.pressure-plate.ts:36` | `pos.y - MOB_HALF_HEIGHT` |

そして参照実装には、この規約が原因の**出荷されたバグの記録**がある。
`game-state-update-orchestration.ts:97-103`（原文）:

```typescript
// Vertical offset subtracted from the body-center Y before sampling the vehicle
// support cell (rail). Deliberately samples MID-BODY, not the true feet: the
// feet (−PLAYER_HALF_HEIGHT = −0.9) sit exactly on the rail-cell floor boundary,
// where downward physics jitter flips floor(y) to the cell below and spuriously
// dismounts. …
export const VEHICLE_SURFACE_SAMPLE_OFFSET = 0.4
```

`design-notes.md` P-1 に詳細。

### ブロック占有 `[y, y+1]`

`packages/game/domain/aabb-collision-shapes.ts:16-23`（原文）:

```typescript
export const FULL_BLOCK_COLLISION_SHAPE: BlockCollisionShape = {
  minX: 0, maxX: 1,
  minY: 0, maxY: 1,
  minZ: 0, maxZ: 1,
}
```

消費側は整数ブロック座標を足す（`aabb-collision.ts:261-262`）:

```typescript
          const blockTop = by + shape.maxY
          const blockBot = by + shape.minY
```

したがってブロック `by` は `[by + 0, by + 1]` を占有する。

### スポーン平面は `surfaceY + 1`

`packages/app/application/main/spawn-selection-search.ts:206`（原文）:

```typescript
      position: { x: wx + 0.5, y: surfaceY + 1 + PLAYER_HALF_HEIGHT, z: wz + 0.5 },
```

**2 段の加算に注意**: `+1` でブロックの上面に到達し、`+ PLAYER_HALF_HEIGHT` で足元から体の中心に到達する。
本リポジトリの `centreOfFoot(standingPlaneAbove(surfaceY), halfHeight)` がこれと同じである。

他の証拠: `spawn-selection-search.ts:171-172`（`surfaceY + 1` が feet air、`surfaceY + 2` が head air）、
`:223`（`MIN_SPAWN_BODY_Y = SEA_LEVEL + 1 + PLAYER_HALF_HEIGHT`）、
`:312`、Mob 側は `packages/entity/domain/mob/terrain-spawn.ts:116`。

### `CONTACT_EPSILON` —— 本リポジトリで追加

参照実装に対応物は無い。プロパティテストが発見した:
`(foot + h) - h` は IEEE-754 で正確に `foot` にならない。
反例は `surfaceY = 1`, `halfHeight = 0.05` で、復元された足元がブロック上面の 2 ulp 下に落ちる。

厳密な `intersects` は、床の上で完全に静止しているエンティティを「衝突」と報告する。
放置するとリゾルバが毎フレーム 2e-16 だけ押し上げ続ける —— 典型的な resting jitter である。

`design-notes.md` P-6 に詳細。

## 3-2. AABB 衝突リゾルバ（`domain/resolve.ts`）

参照実装の `resolveBlockCollisions` / `resolveBlockCollisionsInto`
（`packages/game/domain/aabb-collision.ts:41-50`, `:325-337`）に対応する。

```typescript
import type { BlockProperties } from '@nerima-games/mc-kernel'

export type BlockPropertiesAt = (bx: number, by: number, bz: number) => BlockProperties | null
export type BlockShape = AABB | ReadonlyArray<AABB>
export type BlockShapeAt = (bx: number, by: number, bz: number) => BlockShape | null

export type ResolveOptions = {
  readonly halfWidth: number
  readonly halfHeight: HalfHeight
  readonly blockPropertiesAt: BlockPropertiesAt
  /** 状態依存・複合形状。指定時は null も含めてこの結果を優先する。 */
  readonly blockShapeAt?: BlockShapeAt
  readonly stepHeight?: number        // 既定 0。参照実装の MAX_STEP_UP に相当するが「値」は mc-sim のもの
}

export type Resolution = { readonly body: Body; readonly isGrounded: boolean }

export const resolveBody  = (body: Body, deltaTime: DeltaTimeSecs, options: ResolveOptions): Resolution
export const resolveWorld = (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, options: ResolveOptions): ReadonlyArray<Resolution>
export const stepBody     = (body: Body, deltaTime: DeltaTimeSecs, options: ResolveOptions, gravityY?: number): Resolution
export const stepWorld    = (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, options: ResolveOptions, gravityY?: number): ReadonlyArray<Resolution>
export const maxSpeedWithoutTunnelling = (halfExtent: number, blockThickness: number, maxDeltaSecs: number): number
```

`blockPropertiesAt` が `null` を返すセルは衝突しない。値があれば kernel の `collisionShape` を
標準形状へ変換する。`blockShapeAt` を指定した場合はその戻り値を常に優先し、`null` または空配列は
「このセルに衝突形状はない」という明示的な結果として扱う。単一 AABB と複合形状の配列はどちらも
cell-local 座標で指定する。チャンク座標から ID を読む処理と state 依存形状の解決は呼び出し側に残る。
registry の ID 解決だけなら、次の `kernel-world` helper を使える。

**`stepBody` が plan.md §3.4 の `step(state, world, dt)` である。**
中身は「積分 → 必要なら swept AABB → endpoint 解決」である。
高速移動は経路上の最初の面で止まり、短い移動と終点の重なりは既存の Y → X → Z 解決へ渡す。
名前が付いていることで P-3 の順序と連続判定の欠落が diff に現れる。

参照実装との差分（詳細は `design-notes.md` P-9）:

| 項目 | 参照実装 | 本リポジトリ |
| --- | --- | --- |
| 軸順序 | Y → X → Z | 同じ。ただし**根拠は実測**（P-9-1） |
| 高速移動 | endpoint のみ | `stepBody` が swept AABB で最初の衝突を解決し、残りの軸を滑らせる（P-9-2） |
| 床とみなす条件 | `MAX_STEP_UP = 0.6` **または** `|vy| >= 8` **または** 中心セル直下 | `-vy * dt`（このステップの実変位）**＋注入された `stepHeight`**。定数なし |
| 水平フェーズ | X と Z を別々に書き下し（約 100 行の重複） | `clampAxis` 1 つを両軸で共有 |
| 面の採用条件 | `face >= x - halfW && face < x + halfW` | 同じ（face-span ガード）。**同時に補正量の上限でもある**（P-9-4） |
| `isGrounded` | ground clamp の隣で立てるフラグ | 解決後の位置から世界に問い直す**プローブ**。`resolveBody` が固定点になる（P-9-5） |
| 出力 | 引数のオブジェクトを破壊的に更新 | 純粋。in-place 版はベンチマークができてから（`integrate.ts` と同じ方針） |
| 前提条件 | `overCenter` 特例でめり込みから復帰しようとする | **ステップ前に非めり込みであること**を前提とし、維持する（P-9-7） |

`deltaTime` を受け取るのは、床とみなす条件がこのステップの変位を必要とするからである。
積分に使ったのと同じ delta を渡すこと —— 別の値を渡すのは丸め誤差ではなく、別の問いへの答えになる。

## 3-3. mc-kernel 直結のワールド境界（`domain/kernel-world.ts`）

チャンクやワールドの所有権は持たず、ブロック座標から ID を読む関数だけを受け取る。
ID の registry 解決は `mc-kernel` の `resolvedBlockOfId` を直接使うため、ブロック定義を
本リポジトリへ複製しない。空気、未知 ID、未ロードセルは `null` として扱う。

```typescript
export type BlockIdAt = (bx: number, by: number, bz: number) => number | null

export const blockAtFromKernel: (blockIdAt: BlockIdAt) => BlockAt
export const blockPropertiesAtFromKernel: (blockIdAt: BlockIdAt) => BlockPropertiesAt
export const blockEnvironmentFromKernel: (
  blockIdAt: BlockIdAt,
  blockShapeAt?: EnvironmentBlockShapeAt,
) => BlockEnvironment
export const resolveOptionsFromKernel: (options: KernelResolveOptions) => ResolveOptions
```

`blockShapeAt` は state 依存・複合形状を持つワールドが必要な場合だけ注入する。
標準の性質、能力、`collisionShape` は kernel の解決済みブロックからそのまま利用される。

落下ブロックの開始候補も kernel の capability から直接判定できる。

```typescript
export type FallingBlockCandidate = Readonly<{
  readonly id: BlockId
  readonly position: BlockPosition
}>

export const fallingBlockCandidateAt: (
  blockIdAt: BlockIdAt,
  position: BlockPosition,
) => FallingBlockCandidate | null
```

現在位置が既知の非空ブロックで `fallsWhenUnsupported` を持ち、直下が空気・未知・未ロード、
または `canSupportAttachments` を持たない場合に候補を返す。それ以外は `null` である。
候補のブロックを除去して falling entity を生成し、衝突後に配置するライフサイクルは mc-sim が所有する。

## 4. voxel-DDA（`domain/dda.ts`）

参照実装 `packages/world/domain/voxel-raycast.ts:21-26`（原文）:

```typescript
export const voxelRaycast = (
  origin: { readonly x: number; readonly y: number; readonly z: number },
  direction: { readonly x: number; readonly y: number; readonly z: number },
  maxDistance: number,
  isTargetable: (x: number, y: number, z: number) => boolean,
): Option.Option<VoxelRaycastHit> => {
```

Hit 型は `voxel-raycast.ts:7-15`: `{ point, normal, distance, blockX, blockY, blockZ }`。

本リポジトリ:

```typescript
export type VoxelHit = {
  readonly bx: number; readonly by: number; readonly bz: number
  readonly normal: Vec3
  readonly distance: number
  readonly point: Vec3
}
export type IsTargetable = (bx: number, by: number, bz: number) => boolean
export type RaycastShapeAt = (bx: number, by: number, bz: number) => BlockShape | null
export const voxelRaycast = (
  origin: Vec3, direction: Vec3, maxDistance: number, isTargetable: IsTargetable,
  shapeAt?: RaycastShapeAt,
): Option.Option<VoxelHit>
```

第5引数を省略した既存呼び出しは従来どおりtargetable cell全体をunit cubeとして扱う。
指定時はDDAで候補cellを列挙した後、cell-local AABBとのslab intersectionで実際の面を求める。
空隙を通った場合は次のcellへ進む。`null` はfull cube、空配列は衝突なしであり、targetableかどうかは
第4引数だけが決める。
shapeは有限・正体積かつunit cell内でなければならず、不正値はhitにせず無視する。

### 参照実装への訂正 2 点

1. **step 上限のコメントとコードが食い違う。** ヘッダ（`voxel-raycast.ts:3-6`）は
   「walks at most ceil(maxDistance·√3)+1 grid cells」と書くが、コード（`:52`）は
   `Math.ceil(maxDistance * (|dx| + |dy| + |dz|)) + 3` を計算している。
   これは L1 ノルムであり、単位ベクトルなら高々 √3 —— つまりコメントはコードの緩い上界であって、
   コードの説明ではない。**コードが正しい。** 本リポジトリは L1 形を使い、その旨を書いている。

2. **参照実装は direction を正規化しない。** したがって `maxDistance` は
   「呼び出し側のベクトルの長さ」単位であって、ブロック単位ではない。
   本リポジトリは正規化するので、`maxDistance` はブロック単位である。
   `test/integrate.test.ts` の
   `respects maxDistance measured in blocks, because the direction is normalised` が固定している。

### 原点セルは返さない

カメラはあるセルの内側にいる（通常は air、クリッピング中や spectator 中は壁の内側）。
原点セルを返すと、頭が入っているブロックを掘れてしまう。
参照実装も同じ規則とテストを持つ（`packages/world/domain/voxel-raycast.test.ts`）。

## 5. 現在公開している実装

| モジュール | 公開している計算 |
| --- | --- |
| `environment` | kernel の `BlockProperties` / `BlockCapabilities` から surface effects、hazards、fluid effects をサンプリングし、surface motion を計算 |
| `fluid` | 注入された fluid effects と係数から fluid motion を計算 |
| `movement` | 移動入力、sprint、jump、knockback を速度へ適用 |
| `falling-block` | kernel の `fallsWhenUnsupported` と支持側 `canSupportAttachments` から落下開始候補を判定 |
| `landing` | 実移動距離ベースの落下距離累積と一回限りの着地衝撃 projection |
| `kernel-world` | kernel の block ID lookup を `BlockAt` / `BlockPropertiesAt` / `BlockEnvironment` / `ResolveOptions` へ接続 |
| `entity-collision` | 空間グリッド broad-phase、AABB narrow-phase、質量と反発係数を使う衝突解決 |
| `projectile` | 矢の launch、drag / gravity / lifetime、ブロック / entity swept hit test |
| `explosion` | 抵抗・遮蔽を考慮したブロック破壊と entity exposure / damage / knockback の bounded plan |
| `primed-tnt` | bounded な fuse 進行、detonated への遷移、既存の explosion planner の再利用 |
| `resolve` / `resolve-shapes` | block AABB の Y → X → Z 解決と標準形状 |

これらは状態を所有しない純粋関数である。`BlockEnvironment`、`FluidStateAt`、entity 集合、
damage / health 更新、tick 順序は呼び出し側が注入・配線する。特に `stepBody` は積分と
ブロック衝突の合成であり、環境・entity・projectile の各 helper を自動で呼び出す
Minecraft 全体の tick 関数ではない。

### 5-1. 爆発計画（`domain/explosion.ts`）

`planExplosion` は、ワールドの読み取りとエンティティ集合を注入して、爆発の結果を状態から分離した
`ExplosionPlan` として返す。中心、半径、seed は有限値に正規化され、既定の訪問ブロック数・光線ステップ数・
影響エンティティ数の上限で計算量を bounded にする。上限に達した場合は `truncated: true` になる。

```typescript
export const planExplosion: (request: ExplosionRequest) => ExplosionPlan
export const applyExplosionPlan: (plan: ExplosionPlan, commit: ExplosionCommit) => void
```

`ExplosionBlockReader` が `undefined` を返すセルは未ロードとして扱い、破壊対象にはしない。非破壊ブロックも
mutation には入らない。`ExplosionPlan.entityEffects` は exposure、damage、knockback の計算結果であり、
health・velocity・status の状態を変更しない。`applyExplosionPlan` は `destroyedBlocks` と `entityEffects` を
commit callback へ渡すだけなので、ワールド書き込み、ダメージ適用、ドロップ生成は呼び出し側が実装する。

### 5-2. 起爆済み TNT（`domain/primed-tnt.ts`）

`primeTnt` は fuse を有限非負へ正規化する。`planPrimedTnt` は 1 回の呼び出しで fuse を進め、
`MAX_TNT_FUSE_ADVANCE_SECS` を超える delta は `deferredSecs` として返す。fuse が尽きたフレームでは
既存の `planExplosion` を再利用し、`detonated` state と爆発計画を返す。detonated state に対する
後続呼び出しは再爆発を生成しない。

```typescript
export const primeTnt: (fuseSecs?: number) => PrimedTntState
export const planPrimedTnt: (request: PrimedTntRequest) => PrimedTntPlan
export const applyPrimedTntPlan: (plan: PrimedTntPlan, commit: PrimedTntCommit) => void
```

`applyPrimedTntPlan` は state と爆発計画の projection を commit callback に渡すだけで、TNT entity の
lifecycle、ワールド書き込み、health / status / velocity、ドロップ生成を所有しない。

### 5-3. 着地衝撃の projection（`domain/landing.ts`）

`createFallTrackingState` と `advanceFallTracking` は、積分前の body、積分後の Y 速度、衝突解決後の
grounded 状態から、実際の下向き移動距離を累積し、`!wasGrounded && isGrounded` の一フレームだけ
`LandingImpact` を返す。上昇距離や接地済みの接触は落下距離に含めない。

体力減算、ダメージイベント、teleport 時の state reset の配線は mc-sim が所有し、mc-physics は
`FallTrackingState` と純粋な `LandingImpact` だけを扱う。

## 6. 参照実装との責務境界と未移植項目

| 項目 | 参照実装 | LOC | 扱い |
| --- | --- | --- | --- |
| ~~**AABB 衝突リゾルバ本体**~~ | `packages/game/domain/aabb-collision.ts` | 361 | **実装済み**（`domain/resolve.ts`）。§3-2 |
| `resolveBlockCollisionsInto`（ゼロ割り当て版） | `aabb-collision.ts:41-50` | — | **移植しない（今は）**。純粋版が定義であり、in-place 版はベンチマークができてから。`integrate.ts` と同じ方針 |
| 落下ブロックの開始候補 | `falling-block.ts` | — | **実装済み**。`fallingBlockCandidateAt` が kernel capability を直接参照する。除去・entity 生成・着地配置は mc-sim |
| `clampSneakEdge` | `aabb-collision.ts:352-360` | — | **実装済み**。X/Z を独立に clamp して edge 沿いの移動を保つ。スニーク状態と足場探索深度は mc-sim（`responsibility.md` §3） |
| step-up の水平フェーズ再実行 | `aabb-collision.ts:303-318` | — | **実装済み**。`resolve-support.ts` の `tryStepUp` が `stepHeight` 分だけ持ち上げて水平移動を再試行し、再試行後に衝突する場合は採用しない。完全な player policy とチューニング値は mc-sim 側 |
| `BlockCollisionShape` の可変形状（cactus / pressure plate） | `aabb-collision-shapes.ts` | 56 | `CACTUS_SHAPE` / `PRESSURE_PLATE_SHAPE` として移植済み。state 依存・複合形状との対応付けは `BlockShapeAt` を実装する呼び出し側の責務。registry の ID 解決には `kernel-world` を使える |
| ~~step-up（`MAX_STEP_UP = 0.6`）~~ | `aabb-collision.ts:32` | — | **定数としては移植しない**。`ResolveOptions.stepHeight`（既定 0）として注入する |
| プレイヤー物理の高レベル層 | `player-physics.ts` | 310 | mc-sim 寄り。切り分け要検討 |
| `isBlockSolid` / `PASSABLE_BLOCK_IDS` | `block-collision-predicates.ts` | 208 | **移植しない**。kernel の `BlockProperties` に置き換える（`responsibility.md` §3.1） |
| Effect の Service / Layer 配線 | `physics-service.ts` ほか | 180 | 消費側（mc-sim）の責務 |
