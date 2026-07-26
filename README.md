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
$ direnv allow          # devenv 経由で nodejs_22 + pnpm が入る
$ pnpm install
```

devenv を使わない場合は Node.js 22 以上と pnpm 9.15.0 を用意する
（`package.json` の `packageManager` が版を pin しているので `corepack pnpm ...` でよい）。

> **注意**: `devenv.lock` はコミットされていない。生成には `devenv` の実行が必要なため、
> 初回に devenv を動かした人がコミットすること。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm verify` | `typecheck && lint && check:deps && test`。CI と同じ内容 |

## 使い方

```typescript
import {
  centreOfFoot, standingPlaneAbove, PLAYER_HALF_HEIGHT,
  clampDeltaTime, integrateBody, voxelRaycast, vec3,
} from '@nerima-games/mc-physics'

// スポーン: surfaceY の上に立つ。+1 でブロック上面、+halfHeight で体の中心。
const centre = centreOfFoot(standingPlaneAbove(surfaceY), PLAYER_HALF_HEIGHT)

// 1 フレーム進める。クランプを通らない delta は構築できない。
const dt = clampDeltaTime(rawDeltaSecs)     // min(max(0.001, raw), 0.05)
const next = integrateBody(body, dt)
// ... このあとに AABB 衝突リゾルバが走る（未実装）。順序は逆にできない。

// ブロック狙撃は DDA。原点セルは決して返さない。
const hit = voxelRaycast(eye, forward, 5, (bx, by, bz) => isSolid(bx, by, bz))
```

**時刻は読まない。** `Date.now()` / `new Date()` / `performance.now()` は
リポジトリ全体で禁止され、`pnpm check:deps` が強制する。
`deltaTimeBetween` はクロックではなく**読み取り値**を受け取る。

## 現状

**このリポジトリはまだ第一版（叩き台）である。**

- **AABB 衝突リゾルバが未実装。これがこのリポジトリの本体である。**
  現在あるのは座標規約・deltaTime クランプ・semi-implicit Euler 積分・voxel DDA。
  リゾルバが満たすべき条件は [`docs/testing.md`](./docs/testing.md) §4 に列挙してある。
  特に:
  - ground clamp をリゾルバ内部に持ち、`step()` の**後**に走ること
    （逆にすると全部が 1 フレーム分の落下距離だけ床から浮く）
  - Y 軸を X より先に解決すること
  - `CONTACT_EPSILON` 以内のめり込みは「接地」として何もしないこと
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
- **エネルギー非増加・めり込みゼロのプロパティテストは未着手。**
  リゾルバが無いと書けない。参照実装にもこれらのテストは 1 つも存在しない
  （plan.md §3.4 のこの行は参照実装の記述ではなく、新リポジトリへの要求である）。
- **可変形状は `FULL_BLOCK_SHAPE` と `SLAB_SHAPE` のみ。**
  参照実装にはサボテン・感圧板の形状もある。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  `version` は mc-sim が実際に消費して契約を確認するまで `0.x` に留める。
- **カバレッジ閾値は未設定。** 参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
  計測とレポートは常に動かしており、99% ゲートは完成条件到達時に有効化する。

## License

MIT
