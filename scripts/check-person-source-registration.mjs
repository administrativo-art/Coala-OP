import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null;
const diffFile = args.includes('--diff-file') ? args[args.indexOf('--diff-file') + 1] : null;
if (!base && !diffFile) throw new Error('Informe --base <git-ref> ou --diff-file <fixture>.');
const registry = readFileSync(args.includes('--registry-file') ? args[args.indexOf('--registry-file') + 1] : 'src/features/privacy/person-inventory.ts', 'utf8');
const classification = JSON.parse(readFileSync('config/person-source-classification.json', 'utf8'));
if (classification.schemaVersion !== 1 || !Array.isArray(classification.nonPersonalCollections) || !Array.isArray(classification.approvedLegacyGaps)) throw new Error('Classificação de fontes inválida.');
const registryRoot = ts.createSourceFile('person-inventory.ts', registry, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const descriptors = [];
const enums = new Map();
function inspectEnums(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(registryRoot) === 'SOURCE_VALUES') {
    let init = node.initializer;
    if (init && ts.isAsExpression(init)) init = init.expression;
    if (!init || !ts.isObjectLiteralExpression(init)) throw new Error('Enums de fonte ausentes.');
    for (const property of init.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer) || !property.initializer.elements.every(ts.isStringLiteral)) throw new Error('Enum pessoal precisa de literais.');
      enums.set(property.name.getText(registryRoot), property.initializer.elements.map((entry) => entry.text));
    }
  }
  ts.forEachChild(node, inspectEnums);
}
inspectEnums(registryRoot);
function inspectRegistry(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(registryRoot) === 'PERSON_SOURCES' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
    for (const entry of node.initializer.elements) {
      if (!ts.isObjectLiteralExpression(entry)) throw new Error('Descritor de fonte precisa ser objeto literal.');
      const values = new Map(entry.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(registryRoot), property.initializer]));
      for (const required of ['id', 'database', 'collection', 'field', 'role', 'namespace', 'coverage', 'permissionPolicy', 'scopePolicy', 'retention']) {
        if (!values.has(required)) throw new Error(`Descritor pessoal incompleto: falta ${required}.`);
      }
      const literal = (name) => { const value = values.get(name); if (!ts.isStringLiteral(value)) throw new Error(`Descritor ${name} exige literal estável.`); return value.text; };
      const descriptor = Object.fromEntries([...values.keys()].filter((key) => key !== 'reason').map((name) => [name, literal(name)]));
      for (const name of ['database', 'role', 'namespace', 'coverage', 'retention', 'permissionPolicy', 'scopePolicy']) {
        if (!enums.get(name)?.includes(descriptor[name])) throw new Error(`Descritor ${name} desconhecido.`);
      }
      if (descriptor.coverage !== 'live' && (descriptor.coverage !== 'legacy_gap' || !classification.approvedLegacyGaps.includes(descriptor.id) || !values.has('reason'))) throw new Error(`Fonte ${descriptor.id} sem cobertura live ou exceção legada registrada.`);
      descriptors.push(descriptor);
    }
  }
  ts.forEachChild(node, inspectRegistry);
}
inspectRegistry(registryRoot);
if (!descriptors.length || new Set(descriptors.map((entry) => entry.id)).size !== descriptors.length) throw new Error('IDs de fonte ausentes ou duplicados.');
const registered = new Set(descriptors.map((entry) => entry.collection));
const nonPersonal = new Set(classification.nonPersonalCollections);
const dynamicReaders = classification.dynamicCollectionReaders;
function calls(file, code) {
  const root = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const modular = new Map(); const namespaces = new Set(); const modularWriters = new Set();
  for (const statement of root.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !/^firebase\/firestore(?:\/lite)?$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      const original = item.propertyName?.text ?? item.name.text;
      if (['collection', 'collectionGroup'].includes(original)) modular.set(item.name.text, original);
      if (['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'].includes(original)) modularWriters.add(item.name.text);
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const found = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const property = ts.isPropertyAccessExpression(expr) && ['collection', 'collectionGroup'].includes(expr.name.text);
      const imported = ts.isIdentifier(expr) && modular.has(expr.text);
      if (property || imported) {
        const isModular = imported || property && ts.isIdentifier(expr.expression) && namespaces.has(expr.expression.text);
        const arg = node.arguments[isModular ? 1 : 0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) found.push({ name: arg.text });
        else {
          let owner = node.parent;
          while (owner && !ts.isFunctionDeclaration(owner) && !ts.isArrowFunction(owner) && !ts.isFunctionExpression(owner)) owner = owner.parent;
          let writes = false;
          const writesIn = (part) => {
            if (ts.isCallExpression(part)) {
              const e = part.expression;
              if (ts.isPropertyAccessExpression(e) && ['set', 'add', 'update', 'create', 'delete', 'batch', 'runTransaction', 'setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch'].includes(e.name.text) || ts.isIdentifier(e) && (/^(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)$/.test(e.text) || modularWriters.has(e.text))) writes = true;
            }
            ts.forEachChild(part, writesIn);
          };
          if (owner) writesIn(owner); else writes = true;
          const ownerName = owner && ts.isFunctionDeclaration(owner) ? owner.name?.text : null;
          const approved = !writes && dynamicReaders.some((entry) => entry.file === file && entry.function === ownerName && entry.call === node.getText(root) && entry.functionSha256 === createHash('sha256').update(owner.getText(root)).digest('hex'));
          found.push({ name: '<dynamic>', approved });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}
function added(current, before) {
  const count = new Map();
  before.forEach((call) => { const name = JSON.stringify(call); count.set(name, (count.get(name) ?? 0) + 1); });
  return current.filter((call) => {
    const name = JSON.stringify(call);
    const previous = count.get(name) ?? 0;
    if (!previous) return true;
    count.set(name, previous - 1); return false;
  });
}
const changed = [];
if (diffFile) {
  let file = 'src/fixture.ts'; let lines = [];
  for (const line of readFileSync(diffFile, 'utf8').split('\n')) {
    if (line.startsWith('+++ b/')) { if (lines.length) changed.push({ file, now: lines.join('\n'), before: '' }); file = line.slice(6); lines = []; }
    else if (line.startsWith('+') && !line.startsWith('+++')) lines.push(line.slice(1));
  }
  if (lines.length) changed.push({ file, now: lines.join('\n'), before: '' });
} else {
  const ancestor = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim();
  const files = [...new Set([
    ...execFileSync('git', ['diff', '--name-only', '-z', ancestor, '--', 'src', 'functions'], { encoding: 'utf8' }).split('\0').filter(Boolean),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', 'src', 'functions'], { encoding: 'utf8' }).split('\0').filter(Boolean),
  ])];
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    let now = ''; let before = '';
    try { now = readFileSync(file, 'utf8'); } catch { continue; }
    try { before = execFileSync('git', ['show', `${ancestor}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* new file */ }
    changed.push({ file, now, before });
  }
}
const failures = [];
for (const { file, now, before } of changed) {
  for (const { name, approved } of added(calls(file, now), calls(file, before))) {
    if (name === '<dynamic>') {
      if (!approved) failures.push(`${file}: chamada dinâmica de coleção exige registro/revisão explícita`);
    } else if (!registered.has(name) && !nonPersonal.has(name)) failures.push(`${file}: coleção ${name} sem classificação`);
  }
}
if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exitCode = 1; }
else console.log('Novas chamadas de coleção classificadas.');
