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

### 順序を崩すとどうなるか —— **訂正: 符号が逆だった**

本書はここに「クランプの**後**に重力を適用すると、すべての物体が 1 フレーム分の落下距離だけ
床の上に**浮く**」と書いていた。**リゾルバを実装して実測した結果、これは誤りである。**
正しくは **1 フレーム分の落下距離だけ床に沈む**。

固定点を計算すれば一意に決まる。床上面 `F`、半身 `h`、静止中心 `C = F + h` として:

| 順序 | 1 フレームの結果 | 固定点 |
| --- | --- | --- |
| `resolve(integrate(s))`（正） | 積分で `C - g·dt²` へ沈み、クランプが `C` へ戻す | `C`。足が床にぴったり乗る |
| `integrate(resolve(s))`（誤） | クランプが `C` へ戻し、そのあと積分が `C - g·dt²` へ沈める | `C - g·dt²`。**沈んだまま** |

誤った順序では、フレームの**最後に走るのが落下**であり、それを補正するものが次のフレームまで無い。
観測される位置は常に沈んだ側である。

**不変条件そのものは無傷である** —— 順序は依然として load-bearing であり、
崩せば恒久的に位置がずれる。誤っていたのは**症状の記述**だけである。
「浮く」は P-1 のバグクラス名（足元原点 vs 中心）から引き写されたものと思われる。
`testing.md` 末尾が数え上げている「結論は正しく、証拠が間違っている」の系列に本項も加わる。

回帰テストは実測した側を assert する（`REGRESSION: reversing the order leaves the body sunk
one frame’s fall INTO the floor`）。`g·dt²` との一致まで見ており、
誤った順序が**固定点**であること（過渡ではないこと）も同じテストが押さえている。

### 回帰テスト

`test/resolve.test.ts`（リゾルバ実装により、ようやく書けるようになったもの）:

- `a body falling onto a floor is clamped to it, with its downward velocity zeroed`
  —— ground clamp が `y = floorTop + halfHeight` としてリゾルバ**内部**にあること
- `REGRESSION: reversing the order leaves the body sunk one frame’s fall INTO the floor`
  —— 上記の訂正。誤った順序のコストを数値で固定する
- `a body pushed up into a ceiling stops there and is not grounded`

`stepBody` / `stepWorld` が「積分 → 解決」の合成に**名前を与えている**。
手で 2 行書くこともできるが、そのとき逆順は diff に現れない。
`clampDeltaTime` が delta の唯一の正規の入口であるのと同じ役割である。

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

### リゾルバ側の帰結（実装後に判明したこと 2 件）

**1. epsilon は述語に入り、位置には入らない。**
`collidesWith`（新設）が「動かすべきか」を答え、`intersects` は「触れているか」を答える。
リゾルバが書く位置は `floorTop + halfHeight` **ちょうど**であり、1 ulp も足していない。
位置側に epsilon を足す実装（`floorTop + halfHeight + CONTACT_EPSILON`）を試すと
**16 本のテストが落ちる** —— 本書が固定している着地状態そのものが壊れるからである。

さらに `collidesWith` の epsilon は、Y だけでなく**水平フェーズでも** load-bearing である。
epsilon を 0 にすると、平地を歩く物体が毎フレーム床に 3.9 mm 沈んでいるせいで
**進行方向の床ブロックが壁として読まれ、`x = 1` を越えられなくなる**。
P-6 が Y 軸の話として発見した問題は、実際には全軸の話だった。

**2. `isRestingOn` は片側だけだった —— 訂正済み。**
旧実装は `penetrationY(body, surface) <= CONTACT_EPSILON` であり、
`penetrationY` は**離れていると負になる**。したがって上空 5 ブロックを自由落下中の物体も、
天井に頭をつけている物体も、この述語を満たしていた。
既存のテストは全て「面にぴったり乗せた物体」しか渡していなかったため、1 本も落ちなかった。

差が出るのはリゾルバが接地判定に使い始めた瞬間である
（`isSupported` が足元のセルにこれを問う）。旧述語では**空中の全物体が接地**になる。
現在は `Math.abs(body.minY - surface.maxY) <= CONTACT_EPSILON` ——
「足の裏が上面の contact skin 内にあるか」を両側で見る。
既存テストは全て通ったままであり、追加した
`REGRESSION: a body nowhere near a block is not resting on it` だけが新旧を区別する。

### 回帰テスト

`test/coordinates.test.ts`:

- `an entity standing exactly on a block surface reads as resting, never as embedded`
- `the float error at a resting contact really is within CONTACT_EPSILON, by orders of magnitude`
  —— 誤差を**許容する**のではなく**大きさを固定する**。変換が変わって誤差が育てば、
  epsilon が覆えなくなるずっと前に落ちる。
- `the documented counterexample is exactly as documented`
- `the resting contact intersects but is not a collision — the predicates differ exactly there`
  —— `collidesWith` と `intersects` が食い違う唯一の場所を固定し、
  「衝突ならば交差」を 300 runs のプロパティテストで検査する
- `REGRESSION: a body nowhere near a block is not resting on it` —— 上記 2 の訂正
- `an entity one epsilon BELOW the surface does intersect — the boundary is where it is claimed`

`test/resolve.test.ts`:

- `a body lands in exactly the state test/coordinates.test.ts documents`
  —— 落下させた物体が `surfaceY = 1`, `halfHeight = 0.05` の**文書化された反例そのもの**に着地する
  （`intersects` は true、`isRestingOn` は true、`0 < penetrationY < 1e-15`）。
  `floorTop + halfHeight` のあと呼び出し側が `- halfHeight` する往復が
  `centreOfFoot` / `footOfCentre` と同じ丸めを踏むので、これは偶然ではない
- `a resting body does not drift by one ulp per frame, for a thousand frames`
  —— 1000 フレーム、`toBe`（厳密一致）。1 フレーム 1 ulp のドリフトは
  どんな許容誤差にも引っかからず、1 時間後のセーブデータには現れる
- `resolving is a fixed point: a resolved body resolves to itself, bit for bit`

### `resolve-axis.ts` 側の不変条件: `velocity === 0` は床テストに決して到達しない

P-6 が確立した「`collidesWith` は `CONTACT_EPSILON` を超える重なりだけを衝突とみなす」という述語は、
`resolveVertical`（`domain/resolve-axis.ts`）の垂直解決に、もう 1 つの不変条件を連鎖させている:
**静止中の body（垂直速度が厳密に 0）は、床の衝突テストに一度も到達しない。**

```typescript
if (state.velocity === 0) {
  return state
}
```

静止中の body は contact skin の分だけ床から離れて（正確には `CONTACT_EPSILON` 未満の重なりで）
静止しており、これは `collidesWith` が「衝突」と認めない側である。一方、床とみなす条件
（`reach = -state.velocity * deltaTime + CONTACT_EPSILON` に収まる面）は `CONTACT_EPSILON` **以下**の
到達しか許さないので、両者は同じ境界を挟んで逆側にある。速度 0 の body がこのテストを通過することは
構造上ありえない。

この早期リターンは最適化ではなく、その不変条件を**コードとして明示する**ためにある。無条件に
テスト本体まで進ませても（bounce ガードが手前で弾くので）挙動は変わらないが、そうすると
「なぜ速度 0 では絶対に一致しないのか」という理由が、到達しないガードの中に隠れてしまう。
P-6 の「テストを緩めて済ませてはいけなかった」と同じ理由で、ここでも**症状を隠す近道ではなく
不変条件を名前で言う**方を選んでいる。

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

`test/dda.test.ts`:

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

mc-physics はブロック ID の名前を判定せず、mc-kernel の共有データを直接受け取る:

```typescript
export type BlockPropertiesAt = (bx: number, by: number, bz: number) => BlockProperties | null
export type BlockShape = AABB | ReadonlyArray<AABB>
export type BlockShapeAt = (bx: number, by: number, bz: number) => BlockShape | null
```

`BlockPropertiesAt` の `null` は非衝突を表す。標準形状は
`BlockProperties.collisionShape` から解決し、`BlockShapeAt` が指定されている場合は
状態依存・複合形状を含むその結果を authoritative な形状として使う。単一 AABB または AABB 配列を
cell-local 座標で返し、`null` または空配列は衝突形状なしを表す。ID・registry・chunk の解決は
呼び出し側が所有する。

`IsTargetable`（`domain/dda.ts`）と**構造的に同一の型を、あえて別宣言にしている**。
「狙えるか」と「ぶつかるか」は別の問いであり、答えも違う
（水は狙えるが solid ではない。未ロードチャンクは Mob には solid、プレイヤーには空気 —— §3.3）。
TypeScript には区別できないので、これは**強制ではなく文書化**である。
そう書いておくほうが、実際には無い保証を匂わせる名前より安い。

### 回帰テスト

型レベルで保証される（`src/domain/` のどこにもブロック ID の語彙が無い）。
`.oxlintrc.json` の `no-restricted-imports`（mc-kernel 以外の `@nerima-games/*` import を禁じる、
組織共通の依存ポリシー）も間接的な保証である。かつては `pnpm check:deps` が同じ役割を担っていたが、
このスクリプトは org 標準への移行で全廃された。

`test/resolve.test.ts`（本項が要求していたテスト）:

- `only asks about cells the body could touch`
  —— コールバックに渡る座標を全件記録し、body の箱の範囲内に収まることを検査する。
  足元 1 セル下だけは範囲外だが、これは**接地プローブ**であり緩みではない。
  チャンクを走査する実装や固定半径を探る実装はここで落ちる
- `a block shape overrides the kernel collision shape, and null represents no collision`
- `the same geometry with different BlockProperties gives a different answer, and no ids are involved`

---

## P-9 `physics-resolve-y-before-x` ほか（リゾルバの設計判断。本リポジトリで決定）

`domain/resolve.ts` を書くにあたって決めたことと、その根拠。
ファイル冒頭のコメントと同じ内容だが、こちらには**実測の手続き**を残す。

### 9-1 軸の順序: Y → X → Z

参照実装と同じ（`aabb-collision.ts:1-3` が 1 行目から宣言している）。
**「X を先にすると何が壊れるか」は推測せず、実際に水平フェーズを Y の前に動かして測った。**

| 症状 | X 先で落ちるか | テスト |
| --- | :-: | --- |
| 平地を歩くとブロックの継ぎ目に引っかかる | **落ちる** | `a body walking along flat ground crosses the seam between two floor blocks` |
| step-up が全く効かなくなる | **落ちる** | `Y before X is what makes step-up work without a second horizontal pass` |
| 段差に落ちたとき横にめり込む | **落ちない** | `Y before X: a body falling onto a ledge does not embed sideways` |

**3 番目は参照実装が順序テストの題材に選んでいるシナリオだが、本リポジトリでは順序を区別しない。**
`clampAxis` の face-span ガード（9-4）が先に効いてしまうためである。
機構が 2 つ重なっている。テストは**振る舞いを固定する価値がある**ので残すが、
順序の根拠としては数えない。

継ぎ目の症状の機構は P-6 と地続きである。平地で静止している物体は、
リゾルバが走る瞬間には静止していない —— 積分器が 1 フレーム分（50 Hz で約 3.9 mm）沈めた直後である。
X を先に解決すると、**進行方向の床ブロック**がその 3.9 mm ぶん全軸で重なるので壁として読まれ、
体は `blockMinX - halfWidth` に clamp される。`x = 1` を永久に越えられない。
Y を先に解決すれば、水平フェーズが見るときには体は床から出ており、重なりは contact skin の内側に戻っている。

Z を X の後にしたことに根拠は無い（対称である）。
意味があるのは「2 番目のフェーズが 1 番目の補正後の位置に対して走る」ことだけで、
これは `a body slides along a wall` が固定している（壁に貼りつく症状で落ちる）。

### 9-2 高速移動は swept AABB、短い移動は endpoint 解決

`stepBody` は、いずれかの軸の変位が body の最小 span を超えたとき swept AABB を使う。
中心線の grid walk を body の extents だけ広げて候補セルを集めるため、探索量は長い斜め移動が作る
直方体の体積ではなく移動距離に比例する。各ブロックを Minkowski 拡張して segment の最初の
衝突時刻を求め、同時なら Y → X → Z の順で決定する。衝突軸だけ速度を 0 にし、残りの軸は滑る。

短い移動と終点ですでに重なるケースは従来の endpoint resolver に任せる。
これにより step-up、接地 probe、既存 overlap の扱いを変えずに tunnelling だけを防ぐ。
開始時に面接触している場合は内向き移動だけを衝突とし、外向き移動は許可する。

直接 `resolveBody` を使う endpoint-only 呼び出しの限界は、引き続き名前で表せる:

```typescript
export const maxSpeedWithoutTunnelling = (halfExtent, blockThickness, maxDeltaSecs) =>
  (blockThickness + 2 * halfExtent) / maxDeltaSecs
```

プレイヤー（halfWidth 0.3）が 1 ブロック厚の壁に対して 0.05 s 上限で **32 m/s**。
この helper は `resolveBody` を直接使うコードの安全域を示す。通常の公開ステップである
`stepBody` はこの範囲を越える移動も経路上で検出する。

### 9-3 床の判定は「このステップで実際に落ちた距離」。MAX_STEP_UP は注入する

参照実装は 2 つのチューニング定数を使う（`MAX_STEP_UP = 0.6`、`FALL_VELOCITY_THRESHOLD = 8`）。
**本リポジトリは両方とも使わない。**
ブロック上面が床とみなされる条件は「このステップで足がそこを通り得たか」であり、
その距離は `-vy * dt` で**厳密に**求まる。

厳密である理由は P-4 である。semi-implicit Euler は**新しい**速度で位置を動かすので、
リゾルバが受け取る速度がそのまま変位を復元する。
explicit Euler なら変位は**古い**速度から出ており、リゾルバはそれを見られない。
**積分器の 2 行を入れ替えられない理由がもう 1 つ増えたことになる。**

判定が無いと何が起きるかは参照実装のコメントが正確である（`aabb-collision.ts:20-25`）:
**すべての壁が登れるようになる。** 壁ブロックの上面は足元の 1.0 上にあり、
重なっている中で最も高い「床」なので、体はその上へ飛ばされる。
実測でもこの mutation は 6 本のテストを落とし、そこには**エネルギー非増加のプロパティテストが含まれる**
（壁を登るのは無からの位置エネルギーである）。

`stepHeight` は `MAX_STEP_UP` と同じ概念だが、**注入で、既定値 0** である。
0.6 はゲーム的なチューニング値であり `responsibility.md` §3 が mc-sim に置いている。
既定 0 なら「落ちた先以外に体を持ち上げることは決してない」。

**そして step-up は本ファイルで唯一エネルギーを増やす経路である。**
段差を上がるのは無償のリフトであり、衝突応答ではなくゲーム的な行為だからである。
opt-in にしてある 2 つ目の理由がこれで、既定の 0 でのみ「エネルギー非増加」が定理になる。

### 9-4 face-span ガード: 体の**後ろ**にある面では押し返さない

水平フェーズが候補にする面は、体の span の中にあるものだけである
（参照実装の `face >= x - halfW`、`aabb-collision.ts:114` と `:141`）。
これは見た目より働いている。**入隅に斜めに歩き込むと、対角のブロックが水平 2 軸の両方で重なる**
—— 片方は深く、もう片方は浅く。深いほうの軸の近い面はすでに体の後ろにあるので、
その軸で解決すると体は**ブロック 1 個ぶん後ろへ飛ぶ**（実測: `x = 0.93` から `x = -0.3`）。

後ろにある面は「そこから入ってきた面」ではない。だから重なりはもう一方の軸の担当であり、
その軸は補正後の位置に対して次に走って浅いほうで解決する。

ガードは**同時に境界でもある**: `face >= bodyMin` なので補正量は必ず体の幅以下になる。
プロパティテスト `no phase moves a body further than that phase can justify` が
水平は体の幅、垂直は実際の移動距離＋ step height で押さえている。

### 9-5 `isGrounded` はフラグではなくプローブ

参照実装は ground clamp の隣で `isGrounded = true` を立てる（`aabb-collision.ts:281-285`）。
本リポジトリは解決後の位置から**世界に問い直す**（`isSupported`）。

差が出るのはリゾルバを 2 回走らせたときである。フラグ版は 1 回目 true・2 回目 false になる
（2 回目には clamp すべきめり込みが残っていないため）。
プローブ版は位置についての事実なので安定し、**`resolveBody` が固定点になる**。
固定点であることが resting jitter を排除する主張そのものである。

`isGrounded` は静的・キネマティック body についても答える。動かさないことと、
問いに答えないことは別である。

### 9-6 返り値に入れなかったもの

`Resolution` は `{ body, isGrounded }` だけである。参照実装も同じ
（`{ position, velocity, isGrounded }`）。
「壁に当たったか」「天井に当たったか」は速度が 0 になったことから消費側で導けるので、
実需が現れるまで界面に足さない。

### 9-7 前提条件: **ステップ前にめり込んでいないこと**

リゾルバは不変条件を**維持**するのであって**確立**しない。
地形の中にスポーンした body や、体の中にブロックを置かれた body は「unstick」という別の問題であり、
別の関数の仕事である。参照実装はこれを `overCenter` 特例で混ぜており
（`aabb-collision.ts:264-272`）、体の中心の下にある最も高いブロックの上へ無条件に飛ばす。

めり込みゼロのプロパティテストはこの前提を明示的に扱う: 空中から始めて**毎ステップ**検査する
（`a body walking over broken terrain never ends a step inside a block`）。

**唯一の例外: `domain/piston.ts` の `pistonExtrusion`。**
この本文が定める「維持であって確立ではない」は、`domain/resolve.ts` と
`domain/entity-collision-resolve.ts` を含むこの層のすべての解決関数に当てはまるが、
ピストンの押し出しだけは逆の前提で書かれている。動いたのはブロックであって
エンティティは動いていないのに、両者は構築によって重なっている —— エンティティ側から見れば、
自分は非めり込みの前提を一度も破っていないのに、外部から前提を壊された状態で関数が呼ばれる。
`pistonExtrusion` はこの重なりを**確立し直す**（establish）唯一の関数であり、
`public-api.md` §5-6 に契約を記載している。逆に言えば、この層のそれ以外のどの解決関数も
「呼ばれた時点でめり込んでいる」状態を正しく扱うことは要求されておらず、要求してもいけない
——それは `pistonExtrusion` のような専用の geometry の仕事であって、汎用リゾルバの仕事では
ないことを、この 1 関数がはっきり示している。

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
