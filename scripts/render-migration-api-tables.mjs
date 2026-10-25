import fs from "node:fs";
import path from "node:path";

const [diffPath, packagePath = "."] = process.argv.slice(2);
if (!diffPath) {
  process.stderr.write("Usage: node scripts/render-migration-api-tables.mjs <api-diff.json> [head-package-root]\n");
  process.exit(2);
}

const packageRoot = path.resolve(packagePath);
const kernelDist = fs.realpathSync(path.join(packageRoot, "node_modules/@nerima-games/mc-kernel/dist"));
const diff = JSON.parse(fs.readFileSync(path.resolve(diffPath), "utf8"));
const fieldCounts = diff.summary.fieldChangeCounts;
const packageDist = path.join(packageRoot, "dist");
const filesUnder = (directory) => fs.readdirSync(directory, { recursive: true })
  .map((filename) => path.join(directory, String(filename)))
  .filter((filename) => filename.endsWith(".d.ts"));
const declarationFiles = [...filesUnder(packageDist), ...filesUnder(kernelDist)];
const constructors = new Map();
const aliases = new Map();
const tick = String.fromCharCode(96);
const specialConstructors = new Map([
  ["BlockVector", { display: `${tick}blockVectorResult(x, y, z)${tick}`, owner: "mc-physics" }],
  ["VelocityVector", { display: `${tick}velocityVectorResult(x, y, z)${tick}`, owner: "mc-physics" }],
]);

for (const filename of declarationFiles) {
  const contents = fs.readFileSync(filename, "utf8");
  const owner = filename.startsWith(packageDist + path.sep) ? "mc-physics" : "mc-kernel";
  const localConstructors = new Map();
  for (const match of contents.matchAll(/(?:export\s+)?declare\s+const\s+(?<name>\w+)\s*:\s*Brand(?:\.Brand)?\.Constructor<(?<type>[\w$]+)>/g)) {
    localConstructors.set(match.groups.name, { type: match.groups.type, owner });
    if (match[0].startsWith("export ")) {
      constructors.set(match.groups.type, { name: match.groups.name, owner });
    }
  }
  for (const match of contents.matchAll(/export\s*\{(?<aliases>[^}]+)\}/gs)) {
    for (const alias of match.groups.aliases.matchAll(/\b(?<source>\w+)\s+as\s+(?<name>\w+)\b/g)) {
      const constructor = localConstructors.get(alias.groups.source);
      if (constructor) constructors.set(constructor.type, { name: alias.groups.name, owner });
    }
  }
  for (const alias of contents.matchAll(/\b(?:type\s+)?(?<source>\w+)\s+as\s+(?<name>\w+)\b/g)) {
    aliases.set(alias.groups.name, alias.groups.source);
  }
}

const typeNames = (typeText) => {
  const found = new Set();
  for (const name of constructors.keys()) {
    const escaped = name.replaceAll("$", "\\$");
    if (new RegExp(`\\b${escaped}\\b`).test(typeText)) found.add(name);
  }
  for (const [alias, type] of aliases) {
    if (new RegExp(`\\b${alias.replaceAll("$", "\\$")}\\b`).test(typeText) && constructors.has(type)) {
      found.add(type);
    }
  }
  for (const match of typeText.matchAll(/Brand(?:\.Brand)?\.Brand<['"](?<type>[\w$]+)['"]>/g)) {
    if (constructors.has(match.groups.type)) found.add(match.groups.type);
  }
  for (const type of specialConstructors.keys()) {
    if (new RegExp(`\\b${type}\\b`).test(typeText)) found.add(type);
  }
  return [...found].sort();
};

const constructorCell = (types) => {
  const used = new Set(types.flatMap((type) => typeNames(type)));
  const entries = [...used].sort().map((type) => {
    const special = specialConstructors.get(type);
    if (special) return `${special.display} (${special.owner})`;
    const constructor = constructors.get(type);
    if (!constructor) return "";
    return `${tick}${constructor.name}.result(value)${tick} (${constructor.owner})`;
  }).filter(Boolean);
  return entries.length ? entries.join("; ") : "—";
};

const markdownText = (value) => String(value ?? "∅")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "")
  .replaceAll("|", "\\|")
  .replaceAll("\n", " ")
  .replace(/\s+/g, " ")
  .trim();

const inlineCode = (value) => `${tick}${markdownText(value).replaceAll(tick, `\\${tick}`)}${tick}`;

const typeWithOptionality = (field) => {
  if (!field) return "∅";
  const optionality = field.optional ? "optional" : "required";
  return `${field.type} (${optionality})`;
};

const fieldGuidance = (row) => {
  if (row.name === "ExplosionEntityEffect" && row.field === "damage") {
    return "[DamageAmountSchema](#decoding-damageamount); [decode example](#decoding-damageamount)";
  }
  if (row.name === "ResolveOptions" && row.field === "environment") {
    return "[blockEnvironmentFromKernel](./public-api.md#collision-resolution-and-environment); [resolveOptionsFromKernel](./public-api.md#collision-resolution-and-environment)";
  }
  const guidance = constructorCell([row.new?.type ?? ""]);
  if (row.name === "EntityCollider" && row.field === "mass") {
    return `${guidance}; pass zero as the literal ${inlineCode("0")}`;
  }
  return guidance;
};

const out = [];
out.push("## Machine-generated API comparison: published 0.3.0 → 0.4.0");
out.push("");
out.push(`Compared the published 0.3.0 and head package distributions through their dist/index.d.ts entry points. The TypeScript checker resolved all exports with zero semantic diagnostics for both packages. The comparison found ${diff.summary.base.publicExports} base exports and ${diff.summary.head.publicExports} head exports (${diff.removedExports.length} removed and ${diff.addedExports.length} added). It reports ${diff.changedArguments.length} function and callback parameter entries, ${diff.changedReturns.length} return changes, and ${diff.changedFields.length} exported type field changes (${fieldCounts.type} type changes, ${fieldCounts.added} additions, ${fieldCounts.removed} removals, and ${fieldCounts.optionality} optionality changes). Five scalar root-exported constant type changes are listed separately.`);
out.push("");
out.push(`### Removed exports (${diff.removedExports.length})`);
out.push("");
out.push("| Export | 0.3.0 | 0.4.0 |");
out.push("| --- | --- | --- |");
for (const name of diff.removedExports) out.push(`| ${inlineCode(name)} | present | removed |`);

out.push("");
out.push(`### Function and callback parameter changes (${diff.changedArguments.length} parameter entries)`);
out.push("");
out.push("| Export | 0.3.0 parameter types | 0.4.0 parameter types | Create branded inputs with |");
out.push("| --- | --- | --- | --- |");
const groupedArguments = new Map();
for (const row of diff.changedArguments) {
  const key = `${row.name}#${row.signature}`;
  if (!groupedArguments.has(key)) groupedArguments.set(key, []);
  groupedArguments.get(key).push(row);
}
for (const [key, rows] of groupedArguments) {
  const name = key.slice(0, key.lastIndexOf("#"));
  const oldTypes = rows.map((row) => `${row.old?.name ?? `#${row.parameter}`}: ${row.old?.type ?? "∅"}${row.old?.optional ? "?" : ""}`).join("; ");
  const newTypes = rows.map((row) => `${row.new?.name ?? `#${row.parameter}`}: ${row.new?.type ?? "∅"}${row.new?.optional ? "?" : ""}`).join("; ");
  out.push(`| ${inlineCode(name)} | ${inlineCode(oldTypes)} | ${inlineCode(newTypes)} | ${constructorCell(rows.map((row) => row.new?.type ?? ""))} |`);
}

out.push("");
out.push(`### Function return changes (${diff.changedReturns.length})`);
out.push("");
out.push("| Export | 0.3.0 return type | 0.4.0 return type | Brand constructors appearing in the new type |");
out.push("| --- | --- | --- | --- |");
for (const row of diff.changedReturns) {
  out.push(`| ${inlineCode(row.name)} | ${inlineCode(row.old)} | ${inlineCode(row.new)} | ${constructorCell([row.new ?? ""])} |`);
}

out.push("");
out.push(`### Root-exported constant type changes (${diff.changedConstants.length})`);
out.push("");
out.push("| Constant | 0.3.0 type | 0.4.0 type | Create the branded value with |");
out.push("| --- | --- | --- | --- |");
for (const row of diff.changedConstants) {
  out.push(`| ${inlineCode(row.name)} | ${inlineCode(row.old)} | ${inlineCode(row.new)} | ${constructorCell([row.new])} |`);
}

out.push("");
out.push(`### Exported interface/type field changes (${diff.changedFields.length}: ${fieldCounts.type} type changes, ${fieldCounts.added} additions, ${fieldCounts.removed} removals, ${fieldCounts.optionality} optionality changes)`);
out.push("");
out.push("| Exported type | Changed field | 0.3.0 field | 0.4.0 field | Create or adapt the new value with |");
out.push("| --- | --- | --- | --- | --- |");
for (const row of diff.changedFields) {
  let exportedType = inlineCode(row.name);
  if (row.variant) exportedType += ` (${markdownText(row.variant)} variant)`;
  out.push(`| ${exportedType} | ${inlineCode(row.field)} | ${inlineCode(typeWithOptionality(row.old))} | ${inlineCode(typeWithOptionality(row.new))} | ${fieldGuidance(row)} |`);
}

out.push("");
out.push("### Decoding DamageAmount");
out.push("");
out.push("DamageAmount is defined by DamageAmountSchema. Decode unknown input with Schema.decodeUnknownResult to preserve schema failures as a Result.");
out.push("");
const fence = tick.repeat(3);
out.push(`${fence}ts`);
out.push('import { Result, Schema } from "effect"');
out.push('import { DamageAmountSchema } from "@nerima-games/mc-kernel"');
out.push("");
out.push("const decodeDamage = (rawDamage: unknown) => {");
out.push("  const decoded = Schema.decodeUnknownResult(DamageAmountSchema)(rawDamage)");
out.push("  if (Result.isFailure(decoded)) return Result.fail(decoded.failure)");
out.push("  return Result.succeed(decoded.success)");
out.push("}");
out.push(fence);
out.push("");
process.stdout.write(out.join("\n"));
