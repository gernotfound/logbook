import { parse } from '@babel/parser';

const testNames = new Set(['test', 'it', 'describe']);
const aliases = new Map([['fit', 'only'], ['fdescribe', 'only'], ['xit', 'skip'], ['xtest', 'skip'], ['xdescribe', 'skip']]);
const forbidden = new Set(['skip', 'todo', 'only']);

function declarationModifiers(expression) {
  const modifiers = [];
  let current = expression;
  while (current) {
    switch (current.type) {
      case 'Identifier':
        if (testNames.has(current.name)) return modifiers;
        return aliases.has(current.name) ? [...modifiers, aliases.get(current.name)] : null;
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
  const ast = parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: name,
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
    errorRecovery: false,
  });
  const findings = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const modifiers = declarationModifiers(node.callee);
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
