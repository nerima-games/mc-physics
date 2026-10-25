import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
if (args.length !== 2) {
  process.stderr.write("Usage: node scripts/compare-public-api.mjs <base-package-root> <head-package-root>\n");
  process.exit(2);
}

const baseRoot = path.resolve(args[0]);
const headRoot = path.resolve(args[1]);
const requireFromHead = createRequire(path.join(headRoot, "package.json"));
const { API, NodeBuilderFlags, SignatureKind, SymbolFlags } = requireFromHead("typescript/unstable/sync");
const flags = NodeBuilderFlags.NoTruncation + NodeBuilderFlags.NoTypeReduction;
const flagRadix = 2;
const hasFlag = (value, flag) => Math.floor(value / flag) % 2 === 1;
const hasAnyFlag = (value, mask) => {
  let bit = 1;
  while (bit <= mask) {
    if (hasFlag(value, bit) && hasFlag(mask, bit)) return true;
    bit *= flagRadix;
  }
  return false;
};

const typeText = (checker, type, location) => checker.typeToString(type, location, flags);

const sourceLocation = (symbol, source, project) => {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return declaration?.resolve(project) ?? source;
};

const relevantProperty = (symbol, project) => (symbol.declarations ?? []).some((declaration) => {
    const filename = declaration.resolve(project).getSourceFile().fileName.replaceAll("\\", "/");
    return (filename.includes("/dist/") || filename.includes("/node_modules/@nerima-games/mc-kernel/"))
      && !/^\d+$/.test(symbol.name);
});

const isOptional = (symbol) => hasFlag(symbol.flags, SymbolFlags.Optional)
  || (symbol.declarations ?? []).some((declaration) => Boolean(declaration.questionToken));

const signatureData = (checker, signature, declaration, project, location) => {
  const parameterDeclarations = declaration?.parameters ?? declaration?.type?.parameters ?? [];
  const params = signature.parameters.map((parameter, index) => {
    const parameterDeclaration = parameterDeclarations[index]
      ?? parameter.valueDeclaration?.resolve(project)
      ?? parameter.declarations?.[0]?.resolve(project)
      ?? location;
    return {
      name: parameterDeclaration.name?.getText() ?? parameter.name ?? `parameter${index + 1}`,
      type: parameterDeclaration.type?.getText()
        ?? typeText(checker, checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration), parameterDeclaration),
      optional: isOptional(parameter) || Boolean(parameterDeclaration.questionToken),
      rest: Boolean(parameterDeclaration.dotDotDotToken),
    };
  });
  const returnType = declaration?.type?.parameters ? declaration.type.type : declaration?.type;
  return {
    params,
    returns: returnType?.getText() ?? typeText(checker, checker.getReturnTypeOfSignature(signature), location),
  };
};

const propertyData = (checker, property, project, location) => {
  const declaration = (property.valueDeclaration ?? property.declarations?.[0])?.resolve(project) ?? location;
  return {
    type: declaration.type?.getText()
      ?? typeText(checker, checker.getTypeOfSymbolAtLocation(property, declaration), declaration),
    optional: isOptional(property),
  };
};

const isWithinTypeNode = (declaration, typeNode) => {
  const source = declaration.getSourceFile();
  const typeSource = typeNode.getSourceFile();
  return source.fileName === typeSource.fileName
    && declaration.getStart() >= typeNode.getStart()
    && declaration.getEnd() <= typeNode.getEnd();
};

const typeFields = (checker, symbol, project, source) => {
  const location = sourceLocation(symbol, source, project);
  const declaredType = checker.getDeclaredTypeOfSymbol(symbol);
  if (!declaredType.isUnionType()) {
    const fields = new Map();
    for (const property of checker.getPropertiesOfType(declaredType)) {
      if (relevantProperty(property, project)) {
        fields.set(property.name, propertyData(checker, property, project, location));
      }
    }
    return fields;
  }
  const unionDeclaration = (symbol.declarations ?? [])
    .map((declaration) => declaration.resolve(project))
    .find((declaration) => declaration.type?.types);
  const members = declaredType.getTypes();
  const commonFields = new Map();
  for (const property of checker.getPropertiesOfType(declaredType)) {
    if (relevantProperty(property, project)) {
      commonFields.set(property.name, propertyData(checker, property, project, location));
    }
  }
  const memberFields = members.map((member) => {
    const fields = new Map();
    for (const property of checker.getPropertiesOfType(member)) {
      const directUnionVariantField = unionDeclaration
        && (property.declarations ?? []).some((declaration) =>
          isWithinTypeNode(declaration.resolve(project), unionDeclaration.type));
      if (directUnionVariantField && relevantProperty(property, project)) {
        fields.set(property.name, propertyData(checker, property, project, location));
      }
    }
    return fields;
  });
  if (members.length === 1) return memberFields[0];

  const commonNames = [...memberFields[0].keys()].filter((name) => memberFields.every((fields) => fields.has(name)));
  const discriminant = commonNames.find((name) => {
    const values = memberFields.map((fields) => fields.get(name).type);
    const literalValues = values.every((value) => /^["'][^"']+["']$/.test(value) || /^-?\d+$/.test(value));
    return literalValues && new Set(values).size === members.length;
  });
  const variants = memberFields.map((fields, index) => {
    if (!discriminant) return `variant ${index + 1}`;
    return fields.get(discriminant).type.slice(1, -1);
  });
  const names = new Set(memberFields.flatMap((fields) => [...fields.keys()]));
  const result = new Map(commonFields);
  for (const name of [...names].sort()) {
    const values = memberFields.map((fields) => fields.get(name));
    const shared = values.every((value) => value !== undefined)
      && values.every((value) => value.type === values[0].type && value.optional === values[0].optional);
    if (shared) {
      if (!result.has(name)) result.set(name, values[0]);
    } else {
      values.forEach((value, index) => {
        if (value) {
          const variant = variants[index];
          result.set(`${variant}::${name}`, { ...value, variant });
        }
      });
    }
  }
  return result;
};

const scan = (label, root) => {
  const entry = path.join(root, "dist/index.d.ts");
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [entry] });
    const project = snapshot.getDefaultProjectForFile(entry);
    if (!project) throw new Error(`No inferred project for ${entry}`);
    const { program, checker } = project;
    const source = program.getSourceFile(entry);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!source || !moduleSymbol) throw new Error(`Cannot load ${entry}`);
    const exports = checker.getExportsOfModule(moduleSymbol);
    const symbols = new Map();
    let unresolvedAliases = 0;
    for (const exported of exports) {
      try {
        const target = hasFlag(exported.flags, SymbolFlags.Alias) ? checker.getAliasedSymbol(exported) : exported;
        if (checker.isUnknownSymbol(target)) unresolvedAliases++;
        const location = sourceLocation(target, source, project);
        let kind = "other";
        let type;
        if (hasAnyFlag(target.flags, SymbolFlags.Value)) {
          kind = "value";
          type = checker.getTypeOfSymbolAtLocation(exported, location);
        } else if (hasFlag(target.flags, SymbolFlags.TypeAlias) || hasFlag(target.flags, SymbolFlags.Interface)) {
          kind = "type";
          type = checker.getDeclaredTypeOfSymbol(target);
        }
        const fullType = type ? typeText(checker, type, location) : "";
        const brandConstructor = kind === "value" && /Brand(?:\.Brand)?\.Constructor</.test(fullType);
        const callableDeclarations = (target.declarations ?? [])
          .map((declaration) => declaration.resolve(project))
          .filter((declaration) => declaration.parameters || declaration.type?.parameters);
        const signatures = type && !brandConstructor
          ? checker.getSignaturesOfType(type, SignatureKind.Call)
            .map((signature, index) => signatureData(checker, signature, callableDeclarations[index], project, location))
          : [];
        symbols.set(exported.name, {
          name: exported.name,
          kind,
          fullType,
          brandConstructor,
          signatures,
          fields: kind === "type" ? typeFields(checker, target, project, source) : new Map(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} export ${exported.name}: ${message}`, { cause: error });
      }
    }
    const declarationFiles = fs.readdirSync(path.join(root, "dist"), { recursive: true })
      .filter((filename) => String(filename).endsWith(".d.ts")).length;
    return {
      label,
      exports: symbols,
      exportCount: exports.length,
      declarationFiles,
      unresolvedAliases,
      semanticDiagnostics: program.getSemanticDiagnostics(entry).length,
      sourceFiles: program.getSourceFileNames().length,
    };
  } finally {
    api.close();
  }
};

const base = scan("base", baseRoot);
const head = scan("head", headRoot);
const baseNames = new Set(base.exports.keys());
const headNames = new Set(head.exports.keys());
const removedExports = [...baseNames].filter((name) => !headNames.has(name)).sort();
const addedExports = [...headNames].filter((name) => !baseNames.has(name)).sort();
const shared = [...baseNames].filter((name) => headNames.has(name)).sort();
const changedArguments = [];
const changedReturns = [];
const changedFields = [];
const changedConstants = [];
const kindChanges = [];
const brandConstructorChanges = [];

for (const name of shared) {
  const oldExport = base.exports.get(name);
  const newExport = head.exports.get(name);
  if (oldExport.kind !== newExport.kind) {
    kindChanges.push({ name, oldKind: oldExport.kind, newKind: newExport.kind });
  }
  if ((oldExport.brandConstructor || newExport.brandConstructor) && oldExport.fullType !== newExport.fullType) {
    brandConstructorChanges.push({ name, old: oldExport.fullType, new: newExport.fullType });
  }
  if (oldExport.signatures.length || newExport.signatures.length) {
    const signatureCount = Math.max(oldExport.signatures.length, newExport.signatures.length);
    for (let index = 0; index < signatureCount; index++) {
      const oldSignature = oldExport.signatures[index];
      const newSignature = newExport.signatures[index];
      if (!oldSignature || !newSignature) {
        changedArguments.push({
          name,
          signature: index + 1,
          change: oldSignature ? "signature removed" : "signature added",
          old: oldSignature ?? null,
          new: newSignature ?? null,
        });
        changedReturns.push({
          name,
          signature: index + 1,
          old: oldSignature?.returns ?? null,
          new: newSignature?.returns ?? null,
        });
      } else {
        if (oldSignature.returns !== newSignature.returns) {
          changedReturns.push({
            name,
            signature: index + 1,
            old: oldSignature.returns,
            new: newSignature.returns,
          });
        }
        const parameterCount = Math.max(oldSignature.params.length, newSignature.params.length);
        for (let parameterIndex = 0; parameterIndex < parameterCount; parameterIndex++) {
          const oldParameter = oldSignature.params[parameterIndex];
          const newParameter = newSignature.params[parameterIndex];
          if (!oldParameter || !newParameter) {
            changedArguments.push({
              name,
              signature: index + 1,
              parameter: parameterIndex + 1,
              change: oldParameter ? "parameter removed" : "parameter added",
              old: oldParameter ?? null,
              new: newParameter ?? null,
            });
          } else if (oldParameter.type !== newParameter.type
            || oldParameter.optional !== newParameter.optional
            || oldParameter.rest !== newParameter.rest) {
            changedArguments.push({
              name,
              signature: index + 1,
              parameter: parameterIndex + 1,
              old: oldParameter,
              new: newParameter,
            });
          }
        }
      }
    }
  }
  if (oldExport.kind === "type" && newExport.kind === "type"
    && !oldExport.signatures.length && !newExport.signatures.length) {
    const fieldNames = new Set([...oldExport.fields.keys(), ...newExport.fields.keys()]);
    for (const fieldKey of [...fieldNames].sort()) {
      const oldField = oldExport.fields.get(fieldKey);
      const newField = newExport.fields.get(fieldKey);
      const displayField = oldField?.variant ?? newField?.variant
        ? fieldKey.slice(fieldKey.indexOf("::") + 2)
        : fieldKey;
      const variant = oldField?.variant ?? newField?.variant ?? null;
      if (!oldField) {
        changedFields.push({ name, field: displayField, variant, change: "added", old: null, new: newField });
      } else if (!newField) {
        changedFields.push({ name, field: displayField, variant, change: "removed", old: oldField, new: null });
      } else if (oldField.type !== newField.type || oldField.optional !== newField.optional) {
        changedFields.push({
          name,
          field: displayField,
          variant,
          change: oldField.optional !== newField.optional ? "optionality" : "type",
          old: oldField,
          new: newField,
        });
      }
    }
  }
  if (oldExport.kind === "value" && newExport.kind === "value"
    && !oldExport.brandConstructor && !newExport.brandConstructor
    && !oldExport.signatures.length && !newExport.signatures.length
    && oldExport.fullType !== newExport.fullType
    && !newExport.fullType.includes("{")
    && !newExport.fullType.includes("=>")) {
    changedConstants.push({ name, old: oldExport.fullType, new: newExport.fullType });
  }
}

const fieldChangeCounts = Object.fromEntries(
  ["type", "added", "removed", "optionality"].map((change) => [
    change,
    changedFields.filter((field) => field.change === change).length,
  ]),
);
const summary = {
  base: {
    declarationFiles: base.declarationFiles,
    publicExports: base.exportCount,
    sourceFiles: base.sourceFiles,
    unresolvedAliases: base.unresolvedAliases,
    semanticDiagnostics: base.semanticDiagnostics,
  },
  head: {
    declarationFiles: head.declarationFiles,
    publicExports: head.exportCount,
    sourceFiles: head.sourceFiles,
    unresolvedAliases: head.unresolvedAliases,
    semanticDiagnostics: head.semanticDiagnostics,
  },
  removedExports: removedExports.length,
  addedExports: addedExports.length,
  sharedExports: shared.length,
  changedFunctionArguments: changedArguments.length,
  changedFunctionReturns: changedReturns.length,
  changedExportedTypeFields: changedFields.length,
  fieldChangeCounts,
  changedExportedConstantTypes: changedConstants.length,
  exportKindChanges: kindChanges.length,
  brandConstructorChanges: brandConstructorChanges.length,
};

const output = JSON.stringify({
  summary,
  removedExports,
  addedExports,
  changedArguments,
  changedReturns,
  changedFields,
  changedConstants,
  kindChanges,
  brandConstructorChanges,
}, null, 2);
process.stdout.write(`${output}\n`);
