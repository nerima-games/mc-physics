# 責務

- 出典: plan.md（**非公開**）§3.4
- 参照実装: `takeokunn/ts-minecraft`

## 1. plan.md §3.4 の記述（原文）

> ### 3.4 mc-physics
>
> - **責務**: Euler積分 + AABB衝突解決（外部物理ライブラリなし）
> - **依存**: kernel（能力フラグで通過可否を判定。ブロックID名指し禁止）
> - **主要な公開API**: `step(state, world, dt)`、AABBクエリ、レイキャスト（voxel-DDA）
> - **検証**: プロパティテスト（エネルギー非増加、めり込みゼロ、決定論）+ 参照実装で発見された不変条件の回帰テスト
> - **移植元**: `packages/game` の physics-service + block-collision-predicates.ts + AABB衝突リゾルバ（1,453 LOC）
> - **設計注意（参照実装の実測知見、全て回帰テスト化すること）**:
>   - ブロックは `[y, y+1]` を占有。スポーンと物理平面は `surfaceY+1` 基準
>   - ground-clamp は AABB 衝突リゾルバ内にあり、`step()` の**後**に走る（順序を崩すと「物が浮く」）
>   - deltaTime は `min(max(0.001, raw), 0.05)` にクランプ、初回フレームは 0.016
>   - 「物が浮く」バグ類は例外なく**足元原点 vs AABB中心のY規約不一致**が原因。座標規約を型で区別する
>   - ブロック狙撃はレイキャストではなく voxel-DDA（参照実装で 2.3ms→0.09ms、25倍）

## 2. 責務の言い換え

**エンティティの位置・速度と、注入された `BlockProperties | null` の答えだけを入力とし、
次の位置・速度を返す純粋関数の集合。** `BlockProperties` は mc-kernel の共有データ契約であり、
チャンク座標から ID を読む処理と state の解決は呼び出し側が行う。registry の ID 解決は
`kernel-world` helper で mc-kernel に直接委譲できる。

- 座標規約（`FootY` / `CentreY` / `HalfHeight`）とその変換
- ブロック占有規約（`[y, y+1]`）と AABB 構築
- deltaTime のクランプ
- semi-implicit Euler 積分 + 終端速度
- voxel-DDA レイキャスト
- **AABB 衝突リゾルバ（`domain/resolve.ts`。このリポジトリの本体）**
- kernel の `BlockProperties` / `BlockCapabilities` を使う環境効果のサンプリング
  （摩擦、movement drag、接触ダメージ、窒息、climbable、流体 volume / flow）
- `fallsWhenUnsupported` と `canSupportAttachments` を使う落下ブロック開始候補の判定
- 積分前後の body と解決後の接地状態から、実移動距離ベースの着地衝撃 projection
- 入力移動、jump、sprint、水泳上昇（`inFluid`）、knockback の速度計算
- entity broad-phase / narrow-phase 衝突検出と質量ベースの解決（`collisionOf` / `inverseMassOf` /
  `normalizedOptions` / `potentialPairs` として個別に公開）
- `ProjectileProfile` を注入する投射体の飛翔、寿命、ブロック / エンティティとの swept hit test
  （矢/雪玉/卵/トライデントを 1 つの汎用エンジンで表現する。Arrow 固有 API は撤去した）
- 爆発のブロック破壊対象、遮蔽、entity exposure / damage / knockback の bounded plan
  （kernel の実装をそのまま再 export。§2.1）
- 起爆済み TNT の fuse 進行と爆発計画への遷移（kernel の実装をそのまま再 export。状態の所有・entity
  lifecycle は除く。§2.1）
- エリトラ滑空 1 tick 分の純粋な速度計算（`domain/glide.ts`。滑空状態の判定と装備は上位層の責務）
- ピストンのエンティティ押し出し幾何（`domain/piston.ts`。ブロックの可動判定はブロック AABB の生成元、
  すなわち mx-redstone/mc-sim の責務）

### 2.1 爆発と起爆済み TNT は kernel へ委譲した

mc-kernel 0.5.0 が `planExplosion` / `applyExplosionPlan` / `primeTnt` / `planPrimedTnt` /
`applyPrimedTntPlan` を実装したため、本リポジトリの独自実装（旧 `domain/explosion.ts` /
`domain/primed-tnt.ts`）は削除し、`src/index.ts` から kernel の実装をそのまま re-export する。

削除前に、旧実装と kernel 実装の入出力が一致することを確認している（`docs/porting.md` §7）。
`test/explosion.test.ts` / `test/primed-tnt.test.ts` は、この re-export された API が
呼び出し側から見て同じ契約（bounded な計画、commit callback への projection、状態非所有）を
満たすことを検証する。

この委譲は §3 の表が定める責務境界そのものは変えない —— ワールド書き込み、health / status /
velocity の適用、ドロップ生成、TNT entity の lifecycle は引き続き mc-sim / mx-gameplay が所有する。
変わったのは「誰が計算するか」だけである。

## 3. 明示的にスコープ外のもの

| 項目 | どこが所有するか | 理由 |
| --- | --- | --- |
| **どのブロックが衝突するか** | mc-kernel の `BlockProperties` + mc-sim | `BlockProperties | null` として注入される。ID lookup からの registry 解決には `kernel-world` を使える。§3.1 |
| チャンクデータへのアクセス | mc-worldgen / mc-sim | mc-physics はコールバック越しにしか世界を見ない |
| エンティティの管理（`EntityManager`） | mc-sim | plan.md §3.8。物理は状態を所有しない |
| ゲームループそのもの | mc-sim | plan.md §3.8。`forkDaemon` と `stop()` の話は mc-sim の責務 |
| クロック（時刻の取得） | mc-kernel（Clock Port）+ 呼び出し側 | `deltaTimeBetween` は**読み取り値**を受け取る。§3.2 |
| 落下ブロックの開始候補判定 | mc-physics | `fallingBlockCandidateAt` が kernel capability を直接使う。未知・未ロードの扱いも注入 query の契約に従う |
| 落下ブロックの除去・entity 生成・着地配置 | mc-sim / mx-gameplay | イベント駆動の lifecycle とワールド状態更新は物理計算の責務ではない |
| 流体伝播 | mx-gameplay | plan.md §3.11 |
| 流体のブロック間伝播・状態更新 | mx-gameplay | 本層は注入された `FluidStateAt` をサンプリングし、移動量を計算するだけ |
| health / status への接触ダメージ・窒息の適用 | mc-sim / mx-gameplay | 本層は hazard 値を返すが、状態を所有しない |
| 爆発のブロック除去、health / status / velocity への効果適用、ドロップ生成 | mc-sim / mx-gameplay | 本層は `ExplosionPlan` を返すが、ワールドとエンティティの状態を所有しない |
| TNT entity の spawn / lifecycle / fuse tick 配線 | mc-sim | 本層は fuse と爆発計画の projection を返すが、entity の状態と tick 順序を所有しない |
| entity collection の lifecycle と tick 順序 | mc-sim | 本層は衝突ペアと解決結果を返すが、集合を所有しない |
| Edition / version 別の公式 tuning とデータセット | mc-kernel / mx-gameplay | この層は値を固定せず、状態と係数を注入する |
| step-up / sneak-edge の**ゲーム的な値** | mc-sim | 高さ 0.6 や足場探索深度などのチューニング値。機構はここ。**実装済み**: `ResolveOptions.stepHeight`（既定 0）と `clampSneakEdge`（足場判定 callback を注入）。参照実装の定数は持ち込まない |
| 乗り物（ボート / トロッコ）の物理 | mx-gameplay | plan.md §3.11 |
| 外部物理ライブラリ | 使わない | plan.md §3.4 が明示 |
| Mob 用の「未ロード = solid」規約 | mc-sim | §3.3 |
| エリトラの装備・耐久判定、滑空状態そのものの決定 | 上位層（mc-sim / mx-gameplay） | `glideStep`（`domain/glide.ts`）は 1 tick 分の速度変化だけを計算する純関数。装備・耐久・grounded 判定は `applyMovementInput` が接地判定を呼び出し側に残すのと同じ切り分け |
| ピストンの通電・可動判定、ブロック状態の書き換え | mx-redstone / mc-sim | `pistonExtrusion`（`domain/piston.ts`）は「動くブロック AABB がエンティティをどれだけ押すか」という幾何だけを答える。どのブロックが動くか、電力状態、ブロックデータの更新はこの層の外 |

### 3.1 ブロック ID 名指しの禁止

plan.md §3.4 の依存欄が明示している:

> **依存**: kernel（能力フラグで通過可否を判定。ブロックID名指し禁止）

**参照実装は逆をやっていた。**
`packages/game/domain/block-collision-predicates.ts:16-42` に手書きの denylist がある:

```typescript
// Blocks that should not collide with the player (transparent/passable).
// Uses a native Set per codebase policy for hot-path collision checks.
// NOTE: LEAVES are intentionally NOT here — in Minecraft leaves are SOLID (you can
// stand on them and they block movement). Listing them let the player fall straight
// through tree canopies ('木の葉にあたり判定がないのですり抜ける'). Only genuinely
// non-colliding blocks (fluids, torches) belong here.
const PASSABLE_BLOCK_IDS: ReadonlySet<number> = new Set([
  0,
  blockTypeToIndex('WATER'),
  blockTypeToIndex('LAVA'),
  ...
])
```

コメント自体が**出荷されたバグの記録**である。葉をこのリストに入れたせいで、
プレイヤーが木の樹冠をすり抜けて落ちた。19 個の名前を手で維持する構造では、
1 つ間違えるだけでこうなり、しかも気づけない。

**これが本リポジトリで能力フラグ方式を採る最強の論拠である。**
興味深いことに、参照実装でも摩擦は**データ駆動**である
（`block-collision-predicates.ts:61-63` が `initialBlocks` から `properties.friction` を読む）。
通過可否だけが手書きリストのまま取り残されていた。

本リポジトリの設計:

```typescript
import type { BlockProperties } from '@nerima-games/mc-kernel'

export type BlockPropertiesAt = (bx: number, by: number, bz: number) => BlockProperties | null
export type BlockShape = AABB | ReadonlyArray<AABB>
export type BlockShapeAt = (bx: number, by: number, bz: number) => BlockShape | null
```

mc-physics は kernel の `collisionShape` を標準 AABB に変換する。チャンク座標から ID を読む
処理は呼び出し側に残るが、registry の解決は `kernel-world` から mc-kernel に直接委譲できる。
状態依存・複合形状を扱う場合だけ呼び出し側が `blockShapeAt` を追加し、単一 AABB または AABB 配列を
返す。その戻り値（`null` または空配列を含む）を標準形状より優先させ、衝突形状の有無を明示できる。

### 3.2 時刻を読まない

`src/` のシミュレーションコードは `Date.now()` / `new Date()` / `performance.now()` を読まない。
ベンチマーク（`scripts/benchmark.mjs`）だけは計測のため `performance.now()` を使う。
かつては `pnpm check:deps`（`scripts/check-dependency-whitelist.ts`）がこの方針を機械的に強制していたが、
このスクリプトは組織共通の標準移行に伴って廃止された。現時点で自動検出する仕組みはなく、レビューで担保する。
したがって:

```typescript
export const deltaTimeBetween = (previousSecs: number | undefined, currentSecs: number): DeltaTimeSecs
```

クロックを読むのではなく**読み取り値**を受け取る。plan.md §5.1-3 の
「クロック注入による決定論。全シミュレーションが fast-forward 可能」の帰結である。

### 3.3 参照実装から**持ち込まない**もの: Mob 用の未ロード規約

`packages/game/domain/block-collision-predicates.ts:110-125` に、
未ロード地形を **solid** として読む変種がある:

```typescript
// Mob-physics variant: UNKNOWN terrain (unloaded chunk / outside the cached
// radius) reads as SOLID so far-away mobs freeze in place instead of treating
// the void as air and free-falling to bedrock (they piled up at y=0.9 —
// world floor + mob half height). Above the world stays non-solid.
```

これは実在するバグへの実在する対処だが、**mc-physics の責務ではない**。
「未ロードのセルをどう答えるか」は注入されるコールバックの実装の話であり、
プレイヤーと Mob で答えが違うのだから、コールバックを渡す側（mc-sim）が決めるべきである。

同様に `blockIdAt` が `ly < 0` に対して `BEDROCK_ID` を返す仕掛け
（`block-collision-predicates.ts:81-82`）も、世界の床を**地形として**表現している。
mc-physics に世界の床の概念は無い。

## 4. 親と子

| 関係 | リポジトリ |
| --- | --- |
| 親（依存先） | `mc-kernel` のみ |
| 子（依存元） | `mc-sim` のみ |

`@nerima-games/mc-kernel@0.5.0` を実行時依存として直接利用し、`BlockProperties` と
`DeltaTimeSecs` を再利用する。`architecture.md` §7 を参照。

座標語彙そのものも kernel と共有する。`domain/coordinates.ts` はかつて独自のローカルな
`{ x, y, z }` 型とその生成関数を持っていたが、これを廃止して kernel の `Position` / `position` を
そのまま再 export する。
一方で `AABB` はこの物理層のローカル表現のまま残した。kernel の AABB はネストした
`{ min, max }` 形状で `BlockProperties` のデータ境界に合わせてあるが、mc-physics の衝突ホットパス
（`resolve.ts` / `resolve-axis.ts` / `resolve-sweep.ts` など、1 フレームに多数回呼ばれる経路）は
flat な `{ minX, minY, minZ, maxX, maxY, maxZ }` を前提に書かれている。kernel 形状への統一は、
呼び出しのたびに変換コストを持ち込むだけで得るものがないため見送った
（`kernel-world.ts` が担う境界変換パターンをこの層の外周だけに閉じ込める、という既存方針の継続）。

**`FootY` / `CentreY` / `HalfHeight` は mc-physics に残す。**
これらは kernel の共有ワールドデータではなく、ボディの足元原点・AABB 中心・半高という
物理アルゴリズム固有の意味を表すためである。

## 5. 完成条件

`testing.md` §4 に詳細。要約:

- プロパティテスト（エネルギー非増加、めり込みゼロ、決定論）
- 参照実装で発見された不変条件の回帰テスト（`design-notes.md` P-1〜P-9）
- **AABB 衝突リゾルバの実装**（kernel の `BlockProperties` と標準形状を接続）
- **環境・移動・entity・矢の純粋なプリミティブ**（kernel の共有データを直接利用）
- **爆発の bounded plan**（抵抗・遮蔽・露出から破壊対象と entity effect を決定論的に計算）
- **起爆済み TNT の bounded fuse plan**（fuse を進め、爆発 plan と `detonated` state を返す）
- **落下ブロック開始候補の純粋な判定**（`fallsWhenUnsupported` と支持側 capability を直接利用）

mc-physics は**ゲームプレビューを持たない**。公開用の ESM / 型宣言成果物は `pnpm build` で生成するが、
歩く / 泳ぐ / 跳ぶ / スニークを含むゲームプレイの tick 配線、状態更新、公式 tuning の確認は
mc-sim / mx-gameplay の責務である。
