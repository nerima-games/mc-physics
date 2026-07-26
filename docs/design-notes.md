# 設計注意と回帰テスト

plan.md §3.4 の「設計注意（参照実装の実測知見、**全て回帰テスト化すること**）」を、
参照実装の証拠（file:line）付きで展開し、名前付き回帰テストとして書き下したもの。

各項目の見出しにある `code` 名がテスト名である。ソース側のコメントからも同じ名前で参照している。

---

## P-1 `physics-y-convention-is-typed`

### plan.md §3.4 の記述

> 「物が浮く」バグ類は例外なく**足元原点 vs AABB中心のY規約不一致**が原因。座標規約を型で区別する

### 参照実装の証拠

参照実装は物理パス全体で **BODY-CENTRE Y** を使う。
`packages/game/domain/aabb-collision.ts:232-237`（原文）:

```typescript
    const feetY = y - halfH
    const headY = y + halfH
```

水平フェーズも同じ（`aabb-collision.ts:89`, `:93-96`）。foot-origin の位置は物理パスに存在しない。

**centre → foot の変換が 6 箇所に手書きされている**（`public-api.md` §3 の表）。
どちらも素の `number` なので、コンパイラにも人間のレビュアーにも区別できない。

そして参照実装には、この規約が原因の**出荷されたバグの記録**が残っている。
`packages/game/application/game-state-update-orchestration.ts:97-103`（原文）:

```typescript
// Vertical offset subtracted from the body-center Y before sampling the vehicle
// support cell (rail). Deliberately samples MID-BODY, not the true feet: the
// feet (−PLAYER_HALF_HEIGHT = −0.9) sit exactly on the rail-cell floor boundary,
// where downward physics jitter flips floor(y) to the cell below and spuriously
// dismounts. …
export const VEHICLE_SURFACE_SAMPLE_OFFSET = 0.4
```

規約が原因で「本当の足元をサンプルできない」ところまで来ている。

反例として、centre をそのまま探査点に使っている箇所もある
（`player-physics.ts:296-307` が ladder / cobweb / water / lava を `physPos.y` と `physPos.y + 1` で探る）。
つまり「centre を使うか foot を使うか」がその場その場の判断になっている。

### 対処

`domain/coordinates.ts` で `FootY` / `CentreY` / `HalfHeight` を branded にした。
`footY - halfHeight` は型エラーになる。変換は依然として存在するが、**1 箇所だけ**、名前付きで存在する。

### 未決事項

**`FootY` / `CentreY` は mc-kernel に上げるべきかもしれない。**
区別が mc-physics の中だけで有効なら価値は半分である。mc-sim も同じ区別を必要とする
（`game-state-update-orchestration.ts` の 3 箇所は mc-sim 相当の層にある）。
mc-kernel の界面が固まったときの検討事項。

### 回帰テスト

`test/coordinates.test.ts`:

- `round-trips foot -> centre -> foot exactly`
- `round-trips centre -> foot -> centre exactly`
- `the centre is exactly one half-height above the feet, never zero and never a full height`
  —— 2 倍の取り違え（half ではなく全高を引く）はこのバグの 2 番目に多い形で、
  体が丸ごと 1 つ分床に沈む。
- `rejects a non-positive half-height, which would collapse the two conventions into one`
- `an entity built from a FOOT Y by mistake would sink half a body — which is why the types differ`
  —— branding が防いでいるバグそのものを文書化するテスト。
  `CentreY(foot)` という**明示的で目に見える嘘**を書いており、
  参照実装ではこれが `number` から `number` への見えない流れになる。

---

## P-2 `physics-block-occupies-y-to-y-plus-one` / `physics-spawn-plane-is-surface-plus-one`

### plan.md §3.4 の記述

> ブロックは `[y, y+1]` を占有。スポーンと物理平面は `surfaceY+1` 基準

### 参照実装の証拠

占有: `packages/game/domain/aabb-collision-shapes.ts:16-23` の `FULL_BLOCK_COLLISION_SHAPE`
（全軸 0→1）。ヘッダコメント（`:1-3`）が「the AABB a block occupies within its cell」と明示。
消費は `aabb-collision.ts:261-262` の `by + shape.maxY` / `by + shape.minY`。

スポーン平面: `packages/app/application/main/spawn-selection-search.ts:206`（原文）:

```typescript
      position: { x: wx + 0.5, y: surfaceY + 1 + PLAYER_HALF_HEIGHT, z: wz + 0.5 },
```

**2 段の加算**である。`+1` でブロック上面、`+ PLAYER_HALF_HEIGHT` で足元から体の中心。

他の証拠: `:171-172`（`surfaceY + 1` が feet air、`surfaceY + 2` が head air）、
`:223`（`MIN_SPAWN_BODY_Y = SEA_LEVEL + 1 + PLAYER_HALF_HEIGHT`）、`:312`。
Mob も同規約（`packages/entity/domain/mob/terrain-spawn.ts:116`:
`y: groundY + 1 + MOB_HALF_HEIGHT`）。
テストも保持している（`packages/app/test/spawn-selection-search.test.ts:118`）。

### 対処

`standingPlaneAbove(surfaceY)` が `+1` を 1 箇所に閉じ込め、`centreOfFoot` が `+halfHeight` を担う。
2 段の加算が 2 つの名前付き関数の合成になっている。

### 回帰テスト

`test/coordinates.test.ts`:

- `a block at cell y occupies exactly [y, y+1] on every axis`（プロパティテスト）
- `a slab occupies the bottom half of its cell and nothing above it`
- `the full-block shape is the unit cube, so shapes compose by simple translation`
- `the standing plane above a block is surfaceY + 1, not surfaceY`
  —— `standingPlaneAbove(surfaceY) === blockAABB(0, surfaceY, 0).maxY` を全域で検査。

---

## P-3 `physics-resolve-runs-after-integrate`

### plan.md §3.4 の記述

> ground-clamp は AABB 衝突リゾルバ内にあり、`step()` の**後**に走る（順序を崩すと「物が浮く」）

### 参照実装の証拠

**ground clamp の実体**（`packages/game/domain/aabb-collision.ts:281-289`、原文）:

```typescript
    if (maxFloorY > Number.NEGATIVE_INFINITY) {
      y = maxFloorY + halfH
      vy = 0
      isGrounded = true
    }
    if (minCeilY < Number.POSITIVE_INFINITY) {
      y = minCeilY - halfH
      if (vy > 0) vy = 0
    }
```

`y = maxFloorY + halfH` が ground clamp である。
**コードベースの他のどこにも ground clamp は無い** —— 世界の床の `Math.max(y, 0)` も、
独立した snap パスも存在しない。

**呼び出し順の証拠**（`packages/game/application/game-state-update-orchestration.ts`）:

| 行 | 内容 |
| --- | --- |
| `:175` | `yield* deps.physicsService.step(deps.deltaTime)` |
| `:177-178` | `physPos` / `physVel` をボディから読み戻す |
| `:187` | `resolveUpdatePostPhysicsState({ ... })` |
| → `player-motion.ts:94` | `resolvePlayerPostPhysicsContactState(...)` |
| → `player-physics.ts:293` | `resolveCollisionOrNoclipInto(...)` |
| → `player-physics.ts:158` | `resolveBlockCollisionsInto(...)` |
| `:218-220` | クランプ後の位置・速度を `setPosition` / `setVelocity` で書き戻す |

**積分 → 読み戻し → 解決＋クランプ → 書き戻し**。

Mob も別経路で同順（`packages/entity/application/mob/entity-manager-physics-frame.ts:53-69`:
重力＋Euler を `_candVel`/`_candPos` に入れてから `resolveCollision(...)`。
リゾルバの束縛は `packages/app/application/frame/stages/entity-update-stage.ts:219`）。

### 順序を崩すとどうなるか

クランプの**後**に重力を適用すると、すべての物体が 1 フレーム分の落下距離だけ床の上に浮く。
恒久的に。これが「物が浮く」バグのもう一つの顔である。

### 回帰テスト

**リゾルバ未実装のため、この不変条件はまだテストできない。**
リゾルバを書くときに必ず追加すること:

- `ground clamp lives inside the resolver and runs after integrate`
- `integrating after clamping leaves the body hovering one frame's fall above the floor`
  （誤った順序が実際に浮きを生むことを示すテスト）

現時点で書けている関連テスト（`test/integrate.test.ts`）:

- `updates velocity first and position from the NEW velocity` —— step 内部の順序（P-4）

---

## P-4 `physics-integrator-is-symplectic`

### 参照実装の証拠

`packages/game/infrastructure/boundary/physics-world-service.ts:39-54`（`public-api.md` §1 に原文）。
速度を先に更新し、位置は**新しい**速度から出す。

### なぜ入れ替えてはいけないか

明示的（explicit）Euler —— 位置を**古い**速度から出す —— は毎ステップでエネルギーを注入する。
跳ねる物体が跳ぶたびに高くなる。2 行を入れ替えるのは見た目には整形の変更であり、そうではない。

### 回帰テスト

`test/integrate.test.ts`:

- `updates velocity first and position from the NEW velocity`
  —— explicit Euler なら `y = 100` ちょうど（古い速度 0）。symplectic なら `y = 100 + (g·dt)·dt`。
  この差が区別の全部である。
- `does not touch horizontal velocity: gravity acts on Y only`
- `leaves static and kinematic bodies completely alone`
- `is deterministic and order-independent across a world of bodies`

---

## P-5 `physics-delta-clamp-is-exact` / `physics-terminal-velocity-cannot-tunnel`

> **注記**: `physics-delta-clamp-is-exact` が担っていた主張は、現在**ブランドの述語**と
> **クランプの出力**の 2 本に分かれている。理由は下の「ブランドはクランプを強制しない」節にある。

### plan.md §3.4 の記述

> deltaTime は `min(max(0.001, raw), 0.05)` にクランプ、初回フレームは 0.016

### 参照実装の証拠

`packages/game/application/game-loop.ts:116-119`（原文は `public-api.md` §2）。
**plan.md の記述はこの点について 1 文字違わず正しい**（`:119` を検証）。

`FIRST_FRAME_DELTA_SECS = 0.016` は `packages/core/domain/constants.ts:8-9`。

### 2 つの境界がそれぞれ何を守っているか

**上限 0.05 s**: 30 秒バックグラウンドにあったタブは 30 秒の delta を届ける。
これを 1 step で積分すると、全エンティティが床を貫通して世界の外へテレポートする。

0.05 は恣意的な値ではない。終端速度と結びついており、参照実装にその関係を保持するテストがある。
`packages/game/test/physics-world-service.test.ts:115-122`（原文）:

```typescript
    it('terminal velocity keeps per-step fall within the resolver bbox (tunneling-safe invariant)', () => {
      // The AABB resolver only catches a floor that lands inside the body's
      // ~1.8-block-tall box after a step, so the per-step fall at the deltaTime
      // ceiling must not exceed that height — otherwise a fast fall tunnels.
      const MAX_DELTA_TIME = 0.05 // game-loop.ts deltaTime cap
      const bodyHeight = 2 * PLAYER_HALF_HEIGHT
      expect(Math.abs(TERMINAL_VELOCITY_Y) * MAX_DELTA_TIME).toBeLessThanOrEqual(bodyHeight)
    })
```

**片方の数字を変えるとトンネリングガードが静かに機能しなくなる。**
このテストは本リポジトリに移植してある。

**下限 0.001 s**: 0 や負の delta は、逆行したクロック（NTP 補正、monotonic でない時刻源）や
重複したフレームコールバックから来る。0 だと速度積分が no-op になり、
`x / dt` で計算される量がすべて無限大になる。

### ブランドはクランプを強制しない —— 強制していたのは**誤り**だった

`DeltaTimeSecs` は当初 `[0.001, 0.05]` に refine してあり、
「クランプを通らない値は構築できないので、クランプが唯一の入口であることが慣習ではなく事実になる」
と説明していた。**その説明は成立していない。**

`DeltaTimeSecs` は `@nerima-games/mc-kernel` の資産であり
（`mc-kernel/domain/quantities.ts:37-42`）、kernel は「有限かつ非負」に refine している。
そして `Brand.Brand<'DeltaTimeSecs'>` は**文字列 `'DeltaTimeSecs'` でキーされる**。
つまり kernel のブランドと本リポジトリのブランドは、
**検証の中身がどれだけ違っても TypeScript にとっては同じ型**である。

帰結は具体的である。kernel 経由で構築した `DeltaTimeSecs(30)`（kernel では合法）は、
`integrateBody` の引数の型を**満たす**。コンパイラも、こちらのコンストラクタも、何も言わない。
30 秒の delta は 1 step で全エンティティを床の下へ運ぶ。
狭いほうのブランドが買っていたのは安全ではなく、**偽の保証**だった。

これは Tag のキー衝突（`mc-sim/domain/kernel-vocabulary.ts` の `ClockPort`）と**同じ根**である。
名前が同一で不変条件が違う 2 つのものを、型システムは区別できない。

### 現在の形: kernel の述語 + 境界のクランプ + assert 可能な述語

```typescript
// kernel の refinement、逐語。クランプ済みではない。
export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

// 積分に渡す前に通す境界。参照実装の式そのまま。
export const clampDeltaTime = (rawDeltaSecs: number): DeltaTimeSecs

// ブランドが意図的に強制しなくなった述語。要る場所で assert できる。
export const isClampedDelta = (deltaSecs: number): boolean
```

**クランプは弱まっていない。属すべき場所に移った。**
「30 秒バックグラウンドにあったタブをどうするか」は delta を生んだ**ループ**の問いであって、
量そのものの性質ではない。`clampDeltaTime` は積分に適した delta を作る唯一の正規の入口であり続ける
（mc-sim は kernel のブランドに対して既に同じことをしている: `mc-sim/domain/frame-timing.ts`）。
`isClampedDelta` は、その不変条件に実際に依存する場所——積分器のテストと、
将来フレームループ境界に置くアサーション——で invariant を**検査可能**にする。

### 回帰テスト

**`physics-delta-clamp-is-exact` は 2 つに割れた。**
「ブランドが何を受け付けるか」と「クランプが何を返すか」は別の主張であり、
両者を 1 本のテストが担っていたことが、そもそも不変条件をブランドに載せた誤りの反映だった。

`test/integrate.test.ts`、クランプ側:

- `is exactly min(max(0.001, raw), 0.05)`（プロパティテスト、500 runs）
- `caps a backgrounded tab at 0.05s instead of teleporting everything through the floor`
- `floors a zero, negative or backwards-clock delta at 0.001s`
- `maps NaN to the first-frame delta rather than letting it poison every position`
- `uses 0.016s for the first frame, where there is no previous timestamp to subtract`
- `REGRESSION: clampDeltaTime is the boundary — its output is always inside the safe range`
  —— `isClampedDelta(clampDeltaTime(raw))` を 500 runs のプロパティテストで検査する。
  かつて「コンストラクタが弾く」で言おうとしていたことを、**それが実際に真である場所**で言い直したもの

`test/integrate.test.ts`、ブランド側:

- `REGRESSION: the brand is kernel’s refinement — finite and non-negative, zero included`
  —— `DeltaTimeSecs(0)` も `DeltaTimeSecs(30)` も**通る**ことを assert する。
  ゼロは合法である（1 クロック tick に 2 回フレームがスケジュールされうる、と kernel が書いている）。
  30 は積分器の安全域の外だが、まっとうな量である —— まさにバックグラウンドタブが生む値である。
  弾かれるのは負・NaN・Infinity だけ

トンネリング側:

- `TUNNELLING INVARIANT: one step at the delta cap never falls further than one body height`
- `never lets a dynamic body fall faster than terminal velocity`（プロパティテスト）

`test/public-api.test.ts`:

- `pins DeltaTimeSecs to kernel’s refinement, with the clamp applied at the boundary`
- `keeps terminal velocity strictly inside what the delta cap allows the resolver to catch`
  —— 数字ではなく**導出**を検査する。片方だけ変えたら落ちる。

---

## P-6 `physics-resting-contact-is-not-a-collision`（本リポジトリで発見）

### 発見の経緯

「`surfaceY + 1` にちょうど立っている実体はブロックと交差しない」というプロパティテストが
**反例を見つけた**: `surfaceY = 1`, `halfHeight = 0.05`。

`(foot + h) - h` は IEEE-754 で正確に `foot` にならない。
足元 2、`halfHeight` 0.05 なら centre は 2.05 だが、2.05 は
`2.049999999999999822...` として格納され、0.05 を引くと `1.9999999999999998` —— ブロック上面 2 の
**2 ulp 下**になる。

厳密な `intersects` は、床の上で完全に静止しているエンティティを「衝突」と報告する。
放置するとリゾルバが毎フレーム 2e-16 だけ押し上げ続ける —— 典型的な resting jitter である。

### 対処

`CONTACT_EPSILON = 1e-9` と `isRestingOn` を追加した。
これが「実際の衝突リゾルバが必ず contact skin を持つ」理由である。
定数を名前付きで export しているのは、まだ書かれていないリゾルバとそのテストが
同じ値に合意できるようにするため、および理由を残すためである。

1e-9 は観測された誤差の約 7 桁上、人間が知覚できる距離の約 7 桁下である。

**テストを緩めて済ませてはいけなかった。** そうしていたら同じバグがリゾルバの中に移動していただけである。

### 回帰テスト

`test/coordinates.test.ts`:

- `an entity standing exactly on a block surface reads as resting, never as embedded`
- `the float error at a resting contact really is within CONTACT_EPSILON, by orders of magnitude`
  —— 誤差を**許容する**のではなく**大きさを固定する**。変換が変わって誤差が育てば、
  epsilon が覆えなくなるずっと前に落ちる。
- `the documented counterexample is exactly as documented`
- `an entity one epsilon BELOW the surface does intersect — the boundary is where it is claimed`

---

## P-7 `physics-dda-skips-origin-cell` / `physics-dda-respects-max-distance`

### plan.md §3.4 の記述

> ブロック狙撃はレイキャストではなく voxel-DDA（参照実装で 2.3ms→0.09ms、25倍）

### 参照実装の証拠

実装は `packages/world/domain/voxel-raycast.ts:37-77`（Amanatides & Woo）。
唯一の呼び出し元は `packages/presentation/highlight/block-highlight.ts:139-148`、
DDA と mesh の切り替えは `:159-161`。

### 「2.3ms→0.09ms、25倍」の出所（**訂正**: 以前「裏が取れない」と書いたのは誤り）

本書は以前この数値を「散文ドキュメント 2 箇所のみ。裏が取れない」と記録していた。
**その判定は誤りである。**追跡対象のファイルだけを全文検索して結論を出しており、
**コミットメッセージを見ていなかった**。

一次出典は参照実装のコミット `101074e3`
（`feat: debug instrumentation campaign — 10 fixes, achievements system, voxel-DDA targeting`）である:

```
Performance (all browser-measured):
- block targeting replaced three.js triangle raycast with voxel DDA
  (Amanatides & Woo) over cached chunk data: frame:interaction 2.3ms -> 0.09ms
```

- 計測対象は `frame:interaction` ステージの時間であり、DDA 関数単体のマイクロベンチではない。
- 計測手段は**ブラウザ実測**（同コミットが同時に入れた `debug-frame-spikes` /
  `debug-log-capture` と QA API で計装したステージ上での測定）。
  同じ節に "final numbers: walking p95 10ms @120fps, heap 207MB GC'd plateau" が並ぶ。
- 追跡ファイル側の散文は二次資料である:
  `docs/reference/shipping-readiness-2026-07-10.md:50`
  （`- Block targeting via voxel-DDA: 2.3 ms → **0.09 ms** (~25×).`、
  見出し "## Performance (measured, not estimated)"）と
  `docs/explanations/architecture/repo-decomposition-plan.md:145`（plan.md の元原稿）。

**再現可能性についての限定は残る。** ベンチマークスクリプトも `.bench.ts` も、
コミットされたプロファイラ出力も存在しない。数値は「計装済みステージに対する
一回きりのブラウザ実測」であって、CI で再実行できるものではない。
**由来は明確・再現手段は無い**、が正しい記述である。

コード中のコメント（`voxel-raycast.ts:3-6`）はもっと弱く、もっと擁護しやすい主張をしている:

```typescript
// Voxel ray traversal (Amanatides & Woo). Replaces three.js Raycaster for block
// targeting: the mesh path brute-forces every triangle of every chunk mesh the
// ray's bounds touch (~16% of main thread when facing terrain), while this
// walks at most ceil(maxDistance·√3)+1 grid cells against raw chunk data.
```

`block-highlight.ts:120-125` も「~16% of the main thread」を繰り返している。

**アルゴリズム上の論拠 —— O(横断セル数) 対 O(射程内の三角形数) —— は単独で成立する。**
それが DDA を採る本当の理由であり、25 倍という数字に依存しない。
数字のほうは（由来が判明した今も）本リポジトリでは再現できないので、
テストの assert 対象にはしない。

### 参照実装への訂正 2 点

`public-api.md` §4 に記載。要約:

1. step 上限のコメント（`ceil(maxDistance·√3)+1`）とコード
   （`maxDistance * (|dx|+|dy|+|dz|) + 3`）が食い違う。コードが正しい。
2. 参照実装は direction を正規化しないので `maxDistance` の単位が呼び出し側依存。
   本リポジトリは正規化する。

### 回帰テスト

`test/integrate.test.ts`:

- `never returns the cell the ray starts in, so you cannot mine the block you are inside`
- `finds the first targetable cell along the ray and reports the face it entered through`
- `respects maxDistance measured in blocks, because the direction is normalised`
  —— 長さ 1 と長さ 100 の direction で同じ結果になることを検査。
- `returns none for degenerate inputs instead of looping or throwing`
- `visits cells in strictly increasing distance order, never skipping one`
  —— 誤った軸を進める DDA はセルを飛ばし、飛ばされたセルは「撃ち抜ける壁」になる。
  訪問順を記録するのが外から見る唯一の方法である。
- `is deterministic: the same ray against the same world always gives the same hit`

---

## P-8 `physics-no-block-id-name-checks`

### plan.md §3.4 の記述

> **依存**: kernel（能力フラグで通過可否を判定。ブロックID名指し禁止）

### 参照実装の証拠（バグの証拠）

`packages/game/domain/block-collision-predicates.ts:16-42` の `PASSABLE_BLOCK_IDS`
（19 個の手書きリスト、原文は `responsibility.md` §3.1 に引用）。
コメント自体が「葉をこのリストに入れたのでプレイヤーが樹冠をすり抜けた」という
出荷済みバグの記録である。

判定（`block-collision-predicates.ts:99-108`）:

```typescript
export const isBlockSolid = (...): boolean => {
  const blockId = blockIdAt(wx, wy, wz, chunkCache, playerCx, playerCz)
  if (blockId === null) return false
  return blockId !== 0 && !PASSABLE_BLOCK_IDS.has(blockId)
}
```

形状選択も ID ごとの `if` 連鎖（`:127-140`）:

```typescript
  if (blockId === CACTUS_ID) return CACTUS_COLLISION_SHAPE
  if (blockId === PRESSURE_PLATE_ID) return PRESSURE_PLATE_COLLISION_SHAPE
  if (SLAB_BLOCK_IDS.has(blockId)) return SLAB_COLLISION_SHAPE
  return FULL_BLOCK_COLLISION_SHAPE
```

**同じファイルの中で摩擦だけはデータ駆動**である（`:61-63` が `initialBlocks` から
`properties.friction` を読む）。通過可否だけが手書きリストのまま取り残されていた。

### 対処

mc-physics は boolean と形状しか見ない:

```typescript
export type IsTargetable = (bx: number, by: number, bz: number) => boolean
```

能力フラグを解決するのは呼び出し側（mc-sim）である。

### 回帰テスト

型レベルで保証される（`domain/` のどこにもブロック ID の語彙が無い）。
`pnpm check:deps` が mc-kernel 以外の import を禁じているのも間接的な保証である。

リゾルバ実装時に追加すべき: `isBlockSolid` コールバックが呼ばれる座標が
問い合わせ対象の AABB の範囲に収まっていること。

---

## 参照実装の数値の訂正

| plan.md | 実測 |
| --- | --- |
| physics 1,453 LOC | 狭義（physics-service* + block-collision-predicates + AABB リゾルバ）= **805**。`packages/game` 内の physics/aabb/collision 全体 = **1,254**。1,453 は再現不能。詳細は `porting.md` |
| deltaTime クランプ `min(max(0.001, raw), 0.05)` | **正しい**。`game-loop.ts:119` で 1 文字違わず一致 |
| 初回フレーム 0.016 | **正しい**。`constants.ts:8-9` |
| ブロックは `[y, y+1]` を占有 | **正しい**。`aabb-collision-shapes.ts:16-23` |
| スポーンは `surfaceY+1` 基準 | **正しい**。`spawn-selection-search.ts:206` |
| ground-clamp はリゾルバ内、`step()` の後 | **正しい**。`aabb-collision.ts:281-285` + 呼び出し鎖（P-3） |
| voxel-DDA 2.3ms→0.09ms、25倍 | **出典あり**。参照実装のコミット `101074e3` に `frame:interaction 2.3ms -> 0.09ms`（"all browser-measured"）。計装済みステージに対するブラウザ実測で、`frame:interaction` ステージ全体の時間。ベンチマークスクリプトは無く再実行はできない（P-7）。※以前ここに「裏が取れない」と書いていたのは、追跡ファイルだけを検索した誤りである |
| プロパティテスト（エネルギー非増加・めり込みゼロ・決定論） | **参照実装には存在しない**。property test も fuzz も determinism test も energy test も無い。plan.md §3.4 のこの行は新リポジトリへの**要求**であって、参照実装の現状の記述ではない |
