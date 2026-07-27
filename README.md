# @nerima-games/mc-physics

## 責務

Euler 積分 + AABB 衝突解決。**外部物理ライブラリなし**（plan.md §3.4）。

## 依存

`effect` のみ。`@nerima-games/*` のどのリポジトリにも依存しない。

将来的には `mc-kernel` に依存する（能力フラグで通過可否を判定する）。
現時点で宣言していないのは、まだ何も publish されていないためである
（bottom-up に publish してから pin する方式）。
意図されたグラフは `scripts/check-dependency-whitelist.ts` の roster と
[`docs/architecture.md`](./docs/architecture.md) に記録してある。

## このリポジトリの位置づけ

| 関係 | リポジトリ |
| --- | --- |
| 親（依存先） | `mc-kernel` のみ |
| 子（依存元） | `mc-sim` のみ |

4 階層アーキテクチャの**安定ライブラリ層**（plan.md §2.2）。

mc-physics がワールドに問うことは 1 つしかない —— 「このセルは solid か、どの形状で当たるか」。
その答えは注入されたコールバックとして受け取るので、ワールドにもチャンクマネージャにも
レンダラにも依存しない。

## 2 つの構造的なルール

### 1. ブロック ID の名指し禁止（plan.md §3.4）

通過可否は**呼び出し側が能力フラグから導いた boolean** として渡される。
mc-physics はブロック ID の語彙を持たない。

参照実装は逆をやっていた。`packages/game/domain/block-collision-predicates.ts:16-42` に
19 個のブロック名を手書きした `PASSABLE_BLOCK_IDS` denylist があり、
そのコメント自体が出荷済みバグの記録になっている —— 葉をリストに入れたせいで、
プレイヤーが木の樹冠をすり抜けて落ちた。
詳細は [`docs/design-notes.md`](./docs/design-notes.md) P-8。

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
| [`docs/design-notes.md`](./docs/design-notes.md) | 設計注意 P-1〜P-8 と、対応する名前付き回帰テスト |
| [`docs/porting.md`](./docs/porting.md) | 移植元パスと実測 LOC |
| [`docs/testing.md`](./docs/testing.md) | 検証と完成条件 |
| [`docs/versioning.md`](./docs/versioning.md) | 0.x → 1.0.0 と publish |

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0 を用意する
（`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい）。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm api:check` | `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了（[`docs/versioning.md`](./docs/versioning.md) §6） |
| `pnpm api:update` | `api-lock.md` を書き直す。公開面を変える PR は結果を同じ PR に含める |
| `pnpm verify` | `typecheck && lint && check:deps && api:check && test`。CI と同じ内容 |

## 使い方

```typescript
import {
  centreOfFoot, standingPlaneAbove, PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH,
  clampDeltaTime, stepBody, voxelRaycast, vec3,
} from '@nerima-games/mc-physics'

// スポーン: surfaceY の上に立つ。+1 でブロック上面、+halfHeight で体の中心。
const centre = centreOfFoot(standingPlaneAbove(surfaceY), PLAYER_HALF_HEIGHT)

// 1 フレーム進める。`clampDeltaTime` が積分に渡す delta を作る唯一の正規の入口である。
// ブランド自体は kernel と同じく「有限かつ非負」までしか言わない（docs/public-api.md §2-1）。
// 範囲が要るところでは `isClampedDelta` で assert する。
const dt = clampDeltaTime(rawDeltaSecs)     // min(max(0.001, raw), 0.05)

// 積分 → 解決。この順序は逆にできない（逆にすると 1 フレーム分の落下距離だけ床に沈む）。
// stepBody がその合成に名前を与えているので、逆順は diff に現れる。
const { body: next, isGrounded } = stepBody(body, dt, {
  halfWidth: PLAYER_HALF_WIDTH,
  halfHeight: PLAYER_HALF_HEIGHT,
  isBlockSolid,        // 能力フラグを解決するのは呼び出し側。ブロック ID は渡ってこない
  // blockShapeAt,     // 立方体でないブロックだけ答え、それ以外は null
  // stepHeight: 0.6,  // ゲーム的なチューニング値。既定 0（= step-up 無し）
})

// ブロック狙撃は DDA。原点セルは決して返さない。
const hit = voxelRaycast(eye, forward, 5, (bx, by, bz) => isSolid(bx, by, bz))
```

**時刻は読まない。** `Date.now()` / `new Date()` / `performance.now()` は
リポジトリ全体で禁止され、`pnpm check:deps` が強制する。
`deltaTimeBetween` はクロックではなく**読み取り値**を受け取る。

## 現状

**このリポジトリはまだ第一版（叩き台）である。**

- **`DeltaTimeSecs` のブランドは kernel の refinement（有限・非負）であり、`[0.001, 0.05]` ではない。**
  かつて範囲まで refine してあり「クランプを通らない値は構築できない」と説明していたが、
  `Brand.Brand<'DeltaTimeSecs'>` は**文字列でキーされる**ので、
  kernel で作った `DeltaTimeSecs(30)` は本リポジトリの `integrateBody` の引数の型を満たしてしまう。
  狭いブランドが買っていたのは安全ではなく偽の保証だった。
  クランプは `clampDeltaTime` として境界に残り、`isClampedDelta` が不変条件を assert 可能にしている
  （[`docs/design-notes.md`](./docs/design-notes.md) P-5、[`docs/public-api.md`](./docs/public-api.md) §2-1）。
- **AABB 衝突リゾルバは実装済み**（`domain/resolve.ts`）。判断とその根拠は
  [`docs/design-notes.md`](./docs/design-notes.md) P-9 にある。要点:
  - **軸順序 Y → X → Z**。根拠は実測である。X を先にすると「平地の継ぎ目に引っかかる」と
    「step-up が効かなくなる」の 2 つが壊れる。参照実装が順序テストの題材にしている
    ledge のケースは、本リポジトリでは別の機構が先に効くので順序を区別しない（P-9-1）
  - **discrete（swept ではない）**。P-5 の delta 上限の論拠がちょうど厳密に成立する形であり、
    破綻する速度 32 m/s は `maxSpeedWithoutTunnelling` が名前で持っている
    （ゲームの最速 6.73 m/s の約 4.8 倍）（P-9-2）
  - **参照実装の `MAX_STEP_UP` / `FALL_VELOCITY_THRESHOLD` を両方とも使わない。**
    床の判定は「このステップで実際に落ちた距離」`-vy * dt` で厳密に決まる。
    これが厳密なのは semi-implicit Euler だから（P-4）である（P-9-3）
  - **`isBlockSolid` は注入**。`domain/` にブロック ID の語彙は 1 つも無い（P-8）
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
- **`FootY` / `CentreY` は mc-kernel に上げるべきかもしれない。**
  区別が mc-physics の中だけで有効なら価値は半分である。mc-sim も同じ区別を必要とする。
  mc-kernel の界面が固まったときの検討事項。
- **エネルギー非増加・めり込みゼロ・決定論のプロパティテストは 3 つとも入った**
  （`test/resolve.test.ts`）。参照実装にはこれらのテストが 1 つも存在しない
  （plan.md §3.4 のこの行は参照実装の記述ではなく、新リポジトリへの要求である）。
  **エネルギーを増やす経路は step-up ただ 1 つ**であり、それはゲーム的な行為なので
  注入で既定 0 にしてある。テストがその例外も明示している。
- **可変形状は `FULL_BLOCK_SHAPE` と `SLAB_SHAPE` のみ。**
  参照実装にはサボテン・感圧板の形状もある。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  `version` は mc-sim が実際に消費して契約を確認するまで `0.x` に留める。
- **カバレッジ閾値は未設定。** 参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
  計測とレポートは常に動かしており、99% ゲートは完成条件到達時に有効化する。

## License

MIT
