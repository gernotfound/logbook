import { parse } from '@babel/parser';

const testNames = new Set(['test', 'it', 'describe']);
const aliases = new Map([['fit', 'only'], ['fdescribe', 'only'], ['xit', 'skip'], ['xtest', 'skip'], ['xdescribe', 'skip']]);
// Conditional Vitest helpers can silently omit tests from the canonical suite.
const forbidden = new Set(['skip', 'todo', 'only', 'skipIf', 'runIf']);
const testModules = new Set(['vitest', '@jest/globals', 'node:test']);

function importedTestReferences(program) {
  const named = new Map();
  const namespaces = new Set();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type'
      || !testModules.has(statement.source.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') {
        namespaces.add(specifier.local.name);
      } else if (specifier.type === 'ImportDefaultSpecifier' && statement.source.value === 'node:test') {
        named.set(specifier.local.name, null);
      } else if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
        const imported = specifier.imported.type === 'Identifier'
          ? specifier.imported.name : specifier.imported.value;
        if (testNames.has(imported)) named.set(specifier.local.name, null);
        else if (aliases.has(imported)) named.set(specifier.local.name, aliases.get(imported));
      }
    }
  }
  return { named, namespaces };
}

function declarationModifiers(expression, references) {
  const modifiers = [];
  let current = expression;
  while (current) {
    switch (current.type) {
      case 'Identifier':
        if (testNames.has(current.name)) return modifiers;
        if (aliases.has(current.name)) return [...modifiers, aliases.get(current.name)];
        if (references.named.has(current.name)) {
          const alias = references.named.get(current.name);
          return alias ? [...modifiers, alias] : modifiers;
        }
        return null;
      case 'CallExpression':
      case 'OptionalCallExpression':
        current = current.callee;
        break;
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        const property = current.property;
        const name = current.computed
          ? property.type === 'StringLiteral' ? property.value : null
          : property.type === 'Identifier' ? property.name : null;
        if (name === null) return null;
        if (current.object.type === 'Identifier' && references.namespaces.has(current.object.name)) {
          if (testNames.has(name)) return modifiers;
          return aliases.has(name) ? [...modifiers, aliases.get(name)] : null;
        }
        modifiers.push(name);
        current = current.object;
        break;
      }
      case 'TSAsExpression':
      case 'TSTypeAssertion':
      case 'TSNonNullExpression':
      case 'ParenthesizedExpression':
        current = current.expression;
        break;
      default:
        return null;
    }
  }
  return null;
}

export function findDisabledTests(source, name = 'fixture.test.ts') {
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      sourceFilename: name,
      // JSX is only valid in JSX/TSX files. On .ts the generic <T>() arrow is
      // TypeScript syntax, which Babel 8 otherwise misreads as a JSX element.
      plugins: ['typescript', ...(/\\.[jt]sx$/i.test(name) ? ['jsx'] : []), 'decorators-legacy'],
      errorRecovery: false,
    });
  } catch (error) {
    throw new Error(`Cannot parse test source ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const findings = [];
  const references = importedTestReferences(ast.program);
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const modifiers = declarationModifiers(node.callee, references);
      const label = modifiers?.find(modifier => forbidden.has(modifier));
      if (label) {
        findings.push({
          line: node.loc.start.line,
          label,
          expression: source.slice(node.callee.start, node.callee.end),
        });
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'tokens' || key === 'comments' || key === 'extra') continue;
      if (Array.isArray(child)) {
        for (const nested of child) if (nested?.type) visit(nested);
      } else if (child?.type) {
        visit(child);
      }
    }
  };
  visit(ast.program);
  return findings;
}
