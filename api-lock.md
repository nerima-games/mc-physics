# API lock — @nerima-games/mc-physics

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 40
supporting declarations: 0

## Exported

### AABB  `type`

```ts
type AABB = {
    readonly minX: number;
    readonly minY: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly maxZ: number;
};
```

### Body  `type`

```ts
type Body = {
    readonly kind: BodyKind;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly vx: number;
    readonly vy: number;
    readonly vz: number;
};
```

### BodyKind  `type`

```ts
type BodyKind = 'dynamic' | 'static' | 'kinematic';
```

### CONTACT_EPSILON  `const`

```ts
const CONTACT_EPSILON = 1e-9;
```

### CentreY  `const`

```ts
const CentreY: Brand.Brand.Constructor<CentreY>;
```

### CentreY  `type`

```ts
type CentreY = number & Brand.Brand<'CentreY'>;
```

### DeltaTimeSecs  `const`

```ts
const DeltaTimeSecs: Brand.Brand.Constructor<DeltaTimeSecs>;
```

### DeltaTimeSecs  `type`

```ts
type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;
```

### FIRST_FRAME_DELTA_SECS  `const`

```ts
const FIRST_FRAME_DELTA_SECS = 0.016;
```

### FULL_BLOCK_SHAPE  `const`

```ts
const FULL_BLOCK_SHAPE: AABB;
```

### FootY  `const`

```ts
const FootY: Brand.Brand.Constructor<FootY>;
```

### FootY  `type`

```ts
type FootY = number & Brand.Brand<'FootY'>;
```

### GRAVITY_Y  `const`

```ts
const GRAVITY_Y = -9.82;
```

### HalfHeight  `const`

```ts
const HalfHeight: Brand.Brand.Constructor<HalfHeight>;
```

### HalfHeight  `type`

```ts
type HalfHeight = number & Brand.Brand<'HalfHeight'>;
```

### IsTargetable  `type`

```ts
type IsTargetable = (bx: number, by: number, bz: number) => boolean;
```

### MAX_DELTA_SECS  `const`

```ts
const MAX_DELTA_SECS = 0.05;
```

### MIN_DELTA_SECS  `const`

```ts
const MIN_DELTA_SECS = 0.001;
```

### PLAYER_HALF_HEIGHT  `const`

```ts
const PLAYER_HALF_HEIGHT: HalfHeight;
```

### PLAYER_HALF_WIDTH  `const`

```ts
const PLAYER_HALF_WIDTH = 0.3;
```

### SLAB_SHAPE  `const`

```ts
const SLAB_SHAPE: AABB;
```

### TERMINAL_VELOCITY_Y  `const`

```ts
const TERMINAL_VELOCITY_Y = -32;
```

### Vec3  `type`

```ts
type Vec3 = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### VoxelHit  `type`

```ts
type VoxelHit = {
    readonly bx: number;
    readonly by: number;
    readonly bz: number;
    readonly normal: Vec3;
    readonly distance: number;
    readonly point: Vec3;
};
```

### blockAABB  `const`

```ts
const blockAABB: (bx: number, by: number, bz: number, shape?: AABB) => AABB;
```

### centreOfFoot  `const`

```ts
const centreOfFoot: (foot: FootY, halfHeight: HalfHeight) => CentreY;
```

### clampDeltaTime  `const`

```ts
const clampDeltaTime: (rawDeltaSecs: number) => DeltaTimeSecs;
```

### deltaTimeBetween  `const`

```ts
const deltaTimeBetween: (previousSecs: number | undefined, currentSecs: number) => DeltaTimeSecs;
```

### entityAABB  `const`

```ts
const entityAABB: (x: number, centreY: CentreY, z: number, halfWidth: number, halfHeight: HalfHeight) => AABB;
```

### footOfCentre  `const`

```ts
const footOfCentre: (centre: CentreY, halfHeight: HalfHeight) => FootY;
```

### integrate  `const`

```ts
const integrate: (bodies: ReadonlyArray<Body>, deltaTime: DeltaTimeSecs, gravityY?: number) => ReadonlyArray<Body>;
```

### integrateBody  `const`

```ts
const integrateBody: (body: Body, deltaTime: DeltaTimeSecs, gravityY?: number) => Body;
```

### intersects  `const`

```ts
const intersects: (a: AABB, b: AABB) => boolean;
```

### isClampedDelta  `const`

```ts
const isClampedDelta: (deltaSecs: number) => boolean;
```

### isRestingOn  `const`

```ts
const isRestingOn: (body: AABB, surface: AABB) => boolean;
```

### maxFallPerStep  `const`

```ts
const maxFallPerStep: (maxDeltaSecs: number) => number;
```

### penetrationY  `const`

```ts
const penetrationY: (a: AABB, b: AABB) => number;
```

### standingPlaneAbove  `const`

```ts
const standingPlaneAbove: (surfaceY: number) => FootY;
```

### vec3  `const`

```ts
const vec3: (x: number, y: number, z: number) => Vec3;
```

### voxelRaycast  `const`

```ts
const voxelRaycast: (origin: Vec3, direction: Vec3, maxDistance: number, isTargetable: IsTargetable) => Option.Option<VoxelHit>;
```
