# 移植元と実測 LOC

- 参照実装ルート: `<reference-impl>`（以下パスはこれ相対）
- 計測日: 2026-07-26
- 計測方法: `wc -l`（コメント・空行を含む物理行数）

**plan.md の LOC 見積もりは信頼できない。** 本書の数値はすべてこのリポジトリで
`wc -l` を実行して確認したものである。

## 1. plan.md §3.4 の記述と実測

> **移植元**: `packages/game` の physics-service + block-collision-predicates.ts + AABB衝突リゾルバ（1,453 LOC）

### 1.1 狭義の集合: 実測 **805 LOC**

| ファイル | 実測 LOC |
| --- | --- |
| `packages/game/application/physics-service.ts` | 151 |
| `packages/game/application/physics-service-schema.ts` | 17 |
| `packages/game/application/physics-service-error.ts` | 12 |
| `packages/game/domain/block-collision-predicates.ts` | 208 |
| `packages/game/domain/aabb-collision.ts` | 361 |
| `packages/game/domain/aabb-collision-shapes.ts` | 56 |
| **合計** | **805** |

805 になるのは `physics-service*` 3 ファイル**すべて**と `aabb-collision-shapes.ts` を数えたときである。
リゾルバは `aabb-collision.ts` + `aabb-collision-shapes.ts` に分割されており、
後者は `aabb-collision.ts:10` の `export * from './aabb-collision-shapes'` で再公開されている。

`physics-service.ts` + `block-collision-predicates.ts` + `aabb-collision.ts` だけなら **720**。

### 1.2 `packages/game` 内の physics/aabb/collision 全体: 実測 **1,254 LOC**

`find packages/game -name "*.ts" | grep -Ei "physic|aabb|collision" | grep -v test`:

| ファイル | LOC |
| --- | --- |
| `application/physics-service-error.ts` | 12 |
| `application/physics-service-schema.ts` | 17 |
| `application/physics-service.ts` | 151 |
| `domain/aabb-collision-shapes.ts` | 56 |
| `domain/aabb-collision.ts` | 361 |
| `domain/block-collision-predicates.ts` | 208 |
| `domain/physics-body.ts` | 25 |
| `domain/physics-port.ts` | 29 |
| `domain/physics-shape.ts` | 12 |
| `domain/physics-world.ts` | 16 |
| `domain/player-physics.ts` | 310 |
| `infrastructure/boundary/physics-world-service.ts` | 57 |
| **合計** | **1,254** |

### 1.3 重要な注意: 「packages/ 全体」では 1,254 にならない

同じフィルタを `packages/` 全体に掛けると **52 ファイル / 3,396 LOC** になる。
増分の大半は物理ではない:

- `packages/app/application/frame/stages/physics-stage-*`（survival / health / hunger / footstep）
  —— これは**ゲームプレイのルール**であって物理ではない。mx-gameplay の責務
- `packages/entity/application/mob/entity-manager-physics*.ts`（97 + 24 + 33 = 154）
  —— Mob の毎フレーム処理。mc-sim の責務
- `packages/world/domain/chunk-aabb.ts`（112）—— **衝突ではない**。
  再メッシュ用のチャンク単位 dirty 領域 AABB（ヘッダコメントの FR-4.2 参照）。
  **mc-physics に移植してはならない**
- `packages/game/test/physics-builders.ts`（199）—— テストヘルパ

### 1.4 1,453 は再現できない

plan.md の 1,453 も、参照実装自身の
`docs/explanations/architecture/repo-decomposition-plan.md:139` の 1,453 も、
今日の `wc -l` ではどの境界でも再現できなかった。

### 1.5 本リポジトリが採る数字

**移植対象は 1,254 のうち約 780 LOC**:

| 除外するもの | LOC | 理由 |
| --- | --- | --- |
| `block-collision-predicates.ts` | 208 | 手書き denylist。能力フラグに置き換える（`responsibility.md` §3.1） |
| `player-physics.ts` | 310 | プレイヤー固有の高レベル層。mc-sim 寄り。切り分け要検討 |
| `physics-service*.ts` | 180 | Effect の Service / Layer 配線。消費側の責務 |
| `physics-port.ts` | 29 | 同上 |

## 2. 「1,254 に入っていないが物理である」ファイル

| ファイル | LOC | 扱い |
| --- | --- | --- |
| `packages/world/domain/voxel-raycast.ts` | 89 | **移植済み**（`domain/dda.ts`）。名前に physics/aabb/collision を含まないのでフィルタから漏れる |
| `packages/core/domain/physics.ts` | 12 | 定数のみ |
| `packages/rendering/infrastructure/raycasting/raycasting-service.ts` | 89 | Three.js の Raycaster。DDA が置き換えた相手。mc-render の責務 |
| `packages/entity/application/mob/entity-manager-physics-frame.ts` | 97 | Mob の毎フレーム処理。mc-sim の責務。ただし P-3 の呼び出し順の証拠として重要 |
| `packages/world/domain/chunk-aabb.ts` | 112 | **衝突ではない**（§1.3）。移植しない |

## 3. 移植したファイルの対応

| 参照実装 | 本リポジトリ | 備考 |
| --- | --- | --- |
| `packages/core/domain/constants.ts:8-9`（`FIRST_FRAME_DELTA_SECS`） | `domain/delta-time.ts` | 同値 0.016 |
| `packages/game/application/game-loop.ts:119`（クランプ式） | `domain/delta-time.ts` の `clampDeltaTime` | **1 文字違わず同一**。NaN 処理を追加 |
| `packages/core/domain/constants.ts:22-24`（プレイヤー半径） | `domain/coordinates.ts` | 同値 0.3 / 0.9。`HalfHeight` を branded に |
| `packages/game/domain/aabb-collision-shapes.ts:16-23`（`FULL_BLOCK_COLLISION_SHAPE`） | `domain/coordinates.ts` の `FULL_BLOCK_SHAPE` | 同一（unit cube） |
| `packages/game/domain/aabb-collision.ts:232-237`（AABB 構築） | `domain/coordinates.ts` の `entityAABB` | `CentreY` を要求するようにした（`design-notes.md` P-1） |
| `packages/app/.../spawn-selection-search.ts:206`（`surfaceY+1+halfHeight`） | `domain/coordinates.ts` の `standingPlaneAbove` + `centreOfFoot` | 2 段の加算を 2 つの名前付き関数に |
| `packages/game/application/game-state-support.ts:10`（`GRAVITY_Y`） | `domain/integrate.ts` | 同値 -9.82 |
| `packages/game/.../physics-world-service.ts:16`（`TERMINAL_VELOCITY_Y`） | `domain/integrate.ts` | 同値 -32 |
| `packages/game/.../physics-world-service.ts:39-54`（Euler 積分） | `domain/integrate.ts` の `integrateBody` | 破壊的更新 → 純粋版（`public-api.md` §1） |
| `packages/world/domain/voxel-raycast.ts:37-77`（DDA） | `domain/dda.ts` の `voxelRaycast` | direction を正規化するようにした（`public-api.md` §4） |

## 4. plan.md の数値の訂正（実測で検証）

| plan.md の記述 | 実測 |
| --- | --- |
| physics 1,453 LOC | 狭義 **805** / `packages/game` 全体 **1,254**。1,453 は再現不能 |
| voxel-DDA 2.3ms→0.09ms、25倍 | **出典あり**（以前の「裏が取れない」は撤回）。参照実装のコミット `101074e3` に `frame:interaction 2.3ms -> 0.09ms`、"Performance (all browser-measured)" の下。計装済みステージ上でのブラウザ実測であり、`frame:interaction` ステージ全体の時間。ベンチマークスクリプトが無いため再実行はできない（`design-notes.md` P-7） |
| 検証: プロパティテスト（エネルギー非増加、めり込みゼロ、決定論） | **参照実装には存在しない**。property test も fuzz も determinism test も energy test も 1 つも無い。この行は新リポジトリへの**要求**であって、参照実装の記述ではない |

### 4.1 plan.md で正しかったこと（すべて再検証済み）

| 記述 | 検証 |
| --- | --- |
| deltaTime クランプ `min(max(0.001, raw), 0.05)` | `game-loop.ts:119` で 1 文字違わず一致 |
| 初回フレーム 0.016 | `constants.ts:8-9` |
| ブロックは `[y, y+1]` を占有 | `aabb-collision-shapes.ts:16-23` + `aabb-collision.ts:261-262` |
| スポーン / 物理平面は `surfaceY+1` 基準 | `spawn-selection-search.ts:206, 171-172, 223, 312`、Mob は `terrain-spawn.ts:116` |
| ground-clamp はリゾルバ内で `step()` の後 | `aabb-collision.ts:281-285` + 呼び出し鎖（`design-notes.md` P-3） |
| 「物が浮く」の原因は足元原点 vs AABB 中心 | 参照実装は centre 一本、手書き変換 6 箇所、うち 1 箇所は出荷済みバグのコメント付き（`game-state-update-orchestration.ts:97-103`） |

## 5. 参照実装の他の訂正（他リポジトリ向け、本作業で検証したもの）

| plan.md | 実測 |
| --- | --- |
| `SEA_LEVEL=48`（§3.7） | **63**（`packages/core/domain/constants.ts:17`） |
| `LAKE_LEVEL=62`（§3.7） | **63**（`constants.ts:20`: `export const LAKE_LEVEL = SEA_LEVEL`）。「独立した定数ではない」という訂正も不正確で、**別名だが独立した export された束縛**である。62 の出所は `packages/world/test/generator-pipeline-model.test.ts:48` のファイルローカルなテストフィクスチャ |
| `名指し判定 51 ファイル / 229 箇所`（§3.1） | **再現できなかった**。§5.1 |

### 5.1 名指し判定の計数について（正直な記録）

本作業の指示書は「38 ファイル / 90 箇所（テスト除く）」に訂正していたが、**この数字も再現できなかった**。
試した 4 通りの計数条件と結果（すべて `node_modules` 除外、`packages` と `src` 対象）:

| 条件 | 箇所 | ファイル |
| --- | --- | --- |
| `===`/`!==`/`case` の大文字リテラル + `blockTypeToIndex('X')`、テスト除外 | 394 | 103 |
| `blockTypeToIndex('X')` のみ、テスト除外 | 217 | 44 |
| `blockTypeToIndex('X')` のみ、テスト込み | 494 | 113 |
| `===`/`!==`/`case` の大文字リテラルのみ、テスト除外 | 213 | 71 |

mc-kernel の `docs/capability-flag-audit.md` はさらに別の条件で
「335 箇所 / 80 ファイル」「比較文脈に限定して 192 箇所 / 61 ファイル」と報告している。

**51/229 も 38/90 も、どの条件でも再現できない。** ただし `packages/core/domain/block-type.ts` の
`BlockTypeSchema` に大文字リテラルが 120 種あることは確認した。

結論として本書は具体的な数値を主張しない。**主張できるのは定性的な事実だけである**:
参照実装は挙動判定をブロック名の名指しで行っており、その散乱は数十ファイル・数百箇所の規模で、
エンジンとコンテンツの分離を不可能にしていた。
`design-notes.md` P-8 が引用している葉のバグは、その規模の証拠として数字より雄弁である。

## 6. 移植すべきテスト資産

plan.md §6 Step 2 は「各 Step で参照実装の対応テスト・fixture・E2E シナリオを
オラクルとして移植する」と定める。mc-physics に対応するもの:

| 参照実装のテスト | LOC | 内容 | 本リポジトリでの扱い |
| --- | --- | --- | --- |
| `packages/game/test/physics-world-service.test.ts` | 171 | **トンネリング不変条件**（:115-122）、static/kinematic 不変、終端速度 | **移植済み**（`test/integrate.test.ts`） |
| `packages/world/domain/voxel-raycast.test.ts` | 83 | 原点セル非対象、maxDistance 境界（2.4 vs 2.6）、入射面法線、退化入力 | **移植済み**（`test/integrate.test.ts`） |
| `packages/game/domain/aabb-collision.test.ts` | 187 | 形状定数の固定、`FALL_VELOCITY_THRESHOLD`、`clampSneakEdge` | **一部**。形状定数のみ |
| `packages/game/test/aabb-collision.test.ts` | 329 | 接地判定、落下スナップ、2 段重ねで上面、step-height 0.6 境界、天井、X/Z 壁、可変形状、壁登り回帰 | **移植済み**（`test/resolve.test.ts`）。ただし step-height は定数ではなく注入値の境界として（`design-notes.md` P-9-3） |
| `packages/game/test/aabb-collision-edge-cases.test.ts` | 273 | 静止浮遊、めり込みからの押し出し、斜め、巨大座標、**Y を X より先に解決**、可変半径 | **一部**。「Y 先行」（`:220`）は移植したが、**このシナリオは本リポジトリでは順序を区別しない**（face-span ガードが先に効く。P-9-1）。順序の根拠は継ぎ目歩行と step-up の 2 本にある。**「めり込みからの押し出し」は移植しない** —— リゾルバは非めり込みを**維持**するのであって**確立**しない（P-9-7） |
| `packages/game/test/block-collision-predicates.test.ts` | 455 | `PASSABLE_BLOCK_IDS` の中身 | **移植しない**。能力フラグに置き換えるため |
| `packages/game/domain/player-physics.test.ts` | 311 | プレイヤー固有 | mc-sim 寄り |
| `packages/game/test/physics-service.test.ts` ほか | 803 | Service / Layer | 消費側の責務 |

**参照実装にプロパティテスト・fuzz・決定論テスト・エネルギーテストは 1 つも無い。**
plan.md §3.4 の「プロパティテスト（エネルギー非増加、めり込みゼロ、決定論）」は
新リポジトリで**新規に作る資産**である。本リポジトリは決定論と座標不変条件を先に作り、
リゾルバの実装と同時に**エネルギー非増加・めり込みゼロ**を足した（`test/resolve.test.ts`）。
参照実装のテストを移植しただけでは書けないもの —— たとえば
「解決は固定点である」「どのフェーズも正当化できる距離以上に体を動かさない」——
がここに含まれており、実際に mutation を 3 件、参照実装由来のシナリオテストではなく
これらの不変条件のほうが捕まえている（`testing.md` §7）。
