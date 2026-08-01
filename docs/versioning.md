# バージョニングと公開

- 上位仕様: plan.md §6 Step 0 / Step 3、§9

## 1. 現在のバージョン: `0.1.0`

**1.0.0 にするのは、上流の消費者が実際にこのリポジトリを消費して契約を確認したときである。**

| バージョン | 意味 |
| --- | --- |
| `0.x` | 界面が未確定。**破壊的変更を minor bump で行ってよい**（semver の 0.x 規定どおり） |
| `1.0.0` | mc-sim がこのリポジトリを実際に import し、公開 API が要求を満たすことを確認した |

「テストが green だから 1.0.0」ではない。テストは自分で書いた仮説を検証するだけであり、
界面が**使えるか**は消費者にしか分からない。plan.md §8 のリスク表が
「新規構築初期は全界面が高 churn」を挙げ、その対策として
「npm 公開を遅らせ dev-meta workspace で開発」を指定しているのはこの理由による。

## 2. なぜ今は publish しないのか（plan.md §6 Step 0-2）

**旧方針(廃止済み)**: かつては「npm公開・バージョンbump運用は界面安定（4週間APIロック無変更）まで
開始しない」という、`api-lock.md` の最終更新日からの経過日数を起点にした freeze-clock 方式だった。
`api-lock.md` / `scripts/api-lock.ts` は org 標準から全廃され(API_STANDARD.md §4)、この日数計測
ベースの自動ゲートも合わせて廃止した。

**現行方針**: 1.0.0 への昇格に代替の自動ゲート(日数・利用実績などの定量基準)は設けず、
maintainer(take)による裁量判断のみで行う(RELEASE_STANDARD.md §4.2)。0.x の間 publish
しない理由そのもの(下記)は変わらない。

16 リポジトリが互いを pin したバージョンで参照し合っている状態で界面が動くと、
1 つの変更が bump の連鎖を引き起こす。初期は全界面が高 churn なので、これは常時起きる。

対策は **mc-dev-meta workspace**（plan.md §6 Step 0-2）:
16 リポジトリの clone を `repos/` 配下に並べて 1 つの pnpm workspace として束ねる薄いリポジトリ。
開発中は `workspace:*` 解決でモノレポ同等の DX が得られ、bump 連鎖が構造的に発生しない。

したがって現在の `package.json` は:

- `dependencies` に `effect` だけを宣言する。`@nerima-games/*` は 1 つも入っていない。
- `exports` は **TypeScript ソースを直接指す**（`./src/index.ts`）。ビルド成果物ではない。
- ビルド / publish パイプラインは存在しない。

## 3. ビルドと publish は完成条件到達時に追加する

`tsconfig.base.json` は `"noEmit": true` である（コメントで理由を明記している）。
`.gitignore` の `dist/` には `# Build outputs (none yet — the build pipeline is added at completion)` と書いてある。

完成条件（`testing.md` §4）に到達した時点で追加するもの:

1. `tsconfig.build.json` の `noEmit` を外し、`dist/` に `.js` + `.d.ts` + source map を出す
2. `package.json` の `exports` を `dist/` に向ける（`files` も同様）
3. `prepublishOnly` で `pnpm verify` を強制
4. CI に publish job を追加（`.github/workflows/ci.yaml` は現在 typecheck / lint / test / coverage /
   changeset status のみ。publish ジョブの設計は RELEASE_STANDARD.md §3 を参照）

`@changesets/cli` はバージョニング・CHANGELOG 生成の入り口として既に導入済みである
（`.changeset/config.json`、RELEASE_STANDARD.md §1）。残っているのはビルド/publish パイプラインのみ。

## 4. 公開先: GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

plan.md §9 の未決事項に「パッケージ公開先（GitHub Packages / private registry）」があるが、
Step 0 の実装として GitHub Packages を選んである。組織 `nerima-games` の下に 16 パッケージが並ぶ。

消費側は `.npmrc` に次を要する:

```
@nerima-games:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

（本リポジトリの `.npmrc` には**この設定は入っていない**。今は誰も `@nerima-games/*` を
解決しないためである。現在の `.npmrc` の中身は `fast-check` / `pure-rand` の hoist だけで、
これは `effect/FastCheck` の型解決のために必要な設定である。）

## 5. 何が破壊的変更なのか

> **`0.x` の間の読み替え（全 16 リポジトリ共通の方針）**
>
> 本リポジトリは `0.1.0` であり、下流が契約を実際に消費して確認するまで `0.x` から出ない。
> **semver では `0.x` の破壊的変更は major bump ではなく minor bump である**（`0.1.0` → `0.2.0`）。
> したがって以下の MAJOR / MINOR / PATCH は **`1.0.0` 到達後の分類**であり、
> `0.x` の間は次のように読み替える。
>
> | 分類 | `1.0.0` 到達後 | `0.x` の間（現在） |
> | --- | --- | --- |
> | MAJOR | major bump | **minor bump**（`0.1.0` → `0.2.0`） |
> | MINOR | minor bump | patch bump |
> | PATCH | patch bump | patch bump |
>
> 分類そのものは `0.x` でも意味を持つ。MAJOR に分類される変更は、
> bump の大きさに関わらず**下流に必ず影響するもの**であり、告知と協調リリースの対象である。
> `0.x` の間に major bump を切ることはない。

### MAJOR（1.0.0 到達後）

- `FootY` / `CentreY` のどちらを「位置」の既定とするかの変更
- `MIN_DELTA_SECS` / `MAX_DELTA_SECS` / `FIRST_FRAME_DELTA_SECS` の変更
  —— シミュレーションのリプレイ結果が変わる
- `GRAVITY_Y` / `TERMINAL_VELOCITY_Y` の変更（同上、かつトンネリング不変条件に影響）
- ブロック占有規約 `[y, y+1]` の変更
- 積分手法の変更（semi-implicit → 別のもの）
- `CONTACT_EPSILON` の変更
- **`DeltaTimeSecs` ブランドの述語を kernel から乖離させること** —— 乖離しても TypeScript には
  見えないので（ブランドは文字列でキーされる）、下流は乖離に気づけないまま壊れる。
  kernel の述語が変わったときだけ、それに追随する形で変える
  （[design-notes.md](./design-notes.md) P-5、[public-api.md](./public-api.md) §2-1）

これらはすべて「決定論的リプレイの結果が変わる」という一点で MAJOR である。
plan.md §5.1-3 が「クロック注入による決定論。全シミュレーションが fast-forward 可能」を
初日から焼き込む原則として挙げている以上、リプレイ結果は契約の一部である。

### MINOR

- AABB 衝突リゾルバの実装（**新規追加**であり既存の積分の挙動は変えない）
- 新しい `BlockCollisionShape` の追加
- step-up / sneak-edge などの追加クエリ

### PATCH

- ドキュメント、コメント、テスト
- 観測可能な出力を変えない内部リファクタ

## 6. API ロックファイル(廃止)

plan.md §6 Step 0-3 は「初回コミットに ... APIロックファイル（公開APIのレポートを diff レビュー）」を
求めており、かつては `api-lock.md`(生成器 `scripts/api-lock.ts`)としてリポジトリ直下に実装されていた。

**この仕組みは org 標準として全廃された。** `api-lock.md` / `scripts/api-lock.ts` /
`test/api-lock.test.ts` は削除済みで、`pnpm api:check` / `pnpm api:update` も
`package.json#scripts` から削除済みである。理由と経緯は API_STANDARD.md §4 が正本であり、
ここでは繰り返さない。要点だけ書くと:

- 「公開 API」とは `src/index.ts` が re-export するものそのものであり、それ以上でもそれ以下でもない
  (API_STANDARD.md §1)。
- 破壊的変更かどうかの判定は、自動スナップショット/diff ツールではなく、API_STANDARD.md §3 の基準に
  基づく**人間のレビュー**で行う。上の §5 の MAJOR/MINOR/PATCH 分類がその判断材料である。
- `@microsoft/api-extractor` を含む新しいスナップショット/diff ツールの再導入は、
  `Context.Tag` のサービスクラスが「forgotten export」として写らない欠陥が実測されていたため、
  org として不採用と決定済みである(API_STANDARD.md §4 の歴史的経緯)。

`test/public-api.test.ts` は残っているし、消す理由もない。あれは barrel の export 名を
明示的に列挙してピン留めし、**名前の消失**を実行時に落とすテストである。`GRAVITY_Y` /
`TERMINAL_VELOCITY_Y` のような §5 で MAJOR に分類した定数のリテラル値は、このテストと
`test/integrate.test.ts` のアサーションが直接固定している。

捕まえないものも書いておく。**挙動**は写らない（`integrate` の返り値が変わってもこのファイルは動かない。
それは §5 の言うリプレイの契約であり、テストの仕事である）。
