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

**エンティティの位置・速度と、注入された「このセルは solid か」の答えだけを入力とし、
次の位置・速度を返す純粋関数の集合。**

- 座標規約（`FootY` / `CentreY` / `HalfHeight`）とその変換
- ブロック占有規約（`[y, y+1]`）と AABB 構築
- deltaTime のクランプ
- semi-implicit Euler 積分 + 終端速度
- voxel-DDA レイキャスト
- **AABB 衝突リゾルバ（`domain/resolve.ts`。このリポジトリの本体）**

## 3. 明示的にスコープ外のもの

| 項目 | どこが所有するか | 理由 |
| --- | --- | --- |
| **どのブロックが solid か** | mc-kernel（能力フラグ）+ mc-sim | 注入される。§3.1 |
| チャンクデータへのアクセス | mc-worldgen / mc-sim | mc-physics はコールバック越しにしか世界を見ない |
| エンティティの管理（`EntityManager`） | mc-sim | plan.md §3.8。物理は状態を所有しない |
| ゲームループそのもの | mc-sim | plan.md §3.8。`forkDaemon` と `stop()` の話は mc-sim の責務 |
| クロック（時刻の取得） | mc-kernel（Clock Port）+ 呼び出し側 | `deltaTimeBetween` は**読み取り値**を受け取る。§3.2 |
| 落下ブロック（砂・砂利）のルール | mx-gameplay | plan.md §3.11。イベント駆動であることも含めて gameplay の責務 |
| 流体伝播 | mx-gameplay | plan.md §3.11 |
| step-up / sneak-edge の**ゲーム的な値** | mc-sim | 高さ 0.6 などのチューニング値。リゾルバの機構はここ。**実装済み**: `ResolveOptions.stepHeight`（既定 0）。参照実装の `MAX_STEP_UP = 0.6` に相当するが定数ではなく引数である。エネルギーを増やす唯一の経路でもあるため既定は「step-up 無し」（`design-notes.md` P-9-3） |
| 乗り物（ボート / トロッコ）の物理 | mx-gameplay | plan.md §3.11 |
| 外部物理ライブラリ | 使わない | plan.md §3.4 が明示 |
| Mob 用の「未ロード = solid」規約 | mc-sim | §3.3 |

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
export type IsTargetable = (bx: number, by: number, bz: number) => boolean
```

mc-physics は boolean と形状しか見ない。能力フラグを解決するのは呼び出し側である。

### 3.2 時刻を読まない

`Date.now()` / `new Date()` / `performance.now()` はリポジトリ全体で禁止という方針である。
かつては `pnpm check:deps`(`scripts/check-dependency-whitelist.ts`)が機械的に強制していたが、
このスクリプトは org 標準への移行で全廃された(PACKAGE_STANDARD.md)。現時点でこの禁止を
自動検出する仕組みはなく、レビューで担保する。したがって:

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

現時点では `mc-kernel` すら `package.json` に入っていない（まだ publish されていないため）。
`architecture.md` §7 を参照。

`domain/coordinates.ts` の `Vec3` / `AABB` は mc-kernel が本来所有する型
（plan.md §3.1: 「`Position` / `AABB` / チャンク座標系」）だが、
まだ publish されていないのでローカルに宣言してある。

**ただし `FootY` / `CentreY` / `HalfHeight` は mc-kernel に上げるべきかもしれない。**
plan.md §3.4 の「座標規約を型で区別する」は、区別が mc-physics の中だけで有効なら
半分の価値しか無い。mc-sim も同じ区別を必要とする。
mc-kernel の界面が固まったときの検討事項として `design-notes.md` P-1 に記録した。

## 5. 完成条件

`testing.md` §4 に詳細。要約:

- プロパティテスト（エネルギー非増加、めり込みゼロ、決定論）
- 参照実装で発見された不変条件の回帰テスト（`design-notes.md` P-1〜P-8）
- **AABB 衝突リゾルバの実装**（現在は積分・座標規約・DDA のみ）

mc-physics は**プレビューを持たない**。安定ライブラリ層は操作できる成果物を持たない。
物理を体で確認するのは mc-sim の内蔵障害物コースプレビュー
（歩く / 泳ぐ / 跳ぶ / スニーク、plan.md §3.8）である。
