import * as ts from 'typescript';
const roots = new Set(['it', 'test', 'describe']);
const aliases = new Map([['fit', 'only'], ['fdescribe', 'only'], ['xit', 'skip'], ['xtest', 'skip'], ['xdescribe', 'skip']]);
const denied = new Set(['skip', 'todo', 'only']);

function testChain(ts, value) {
  let node = value;
  const modifiers = [];
  for (;;) {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression;
    }
    if (ts.isIdentifier(node)) {
      if (roots.has(node.text)) return modifiers;
      if (aliases.has(node.text)) return [...modifiers, aliases.get(node.text)];
      return null;
    }
    if (ts.isCallExpression(node)) {
      node = node.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(node)) {
      modifiers.push(node.name.text);
      node = node.expression;
      continue;
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      modifiers.push(node.argumentExpression.text);
      node = node.expression;
      continue;
    }
    return null;
  }
}

export function findDisabledTests(source, name = 'fixture.test.ts') {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];
  function walk(node) {
    if (ts.isCallExpression(node)) {
      const chain = testChain(ts, node.expression);
      const label = chain?.find(part => denied.has(part));
      if (label) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        findings.push({ line: line + 1, label, expression: node.expression.getText(file) });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(file);
  return findings;
}
