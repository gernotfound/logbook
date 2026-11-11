import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

// This is a boundary check, not a substitute for Firebase's provider policy.
function sourcesUnder(directory: string): string[] {
  const paths: string[] = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) paths.push(...sourcesUnder(path));
    else if (item.isFile() && /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) {
      paths.push(path);
    }
  }
  return paths;
}

function deletionCalls(source: string): ts.CallExpression[] {
  const ast = ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      const name = ts.isPropertyAccessExpression(target) ? target.name.text
        : ts.isElementAccessExpression(target)
          && (ts.isStringLiteral(target.argumentExpression)
            || ts.isNoSubstitutionTemplateLiteral(target.argumentExpression))
          ? target.argumentExpression.text : undefined;
      if (name === 'deleteUser' || name === 'deleteUsers') calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return calls;
}

describe('Firebase account deletion provider boundary', () => {
  it('keeps the client free of direct Firebase account deletion SDK and REST calls', () => {
    for (const path of sourcesUnder(join(process.cwd(), 'src'))) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/\bdeleteUser\b|\bdeleteUsers\b|accounts:delete\b|accounts\/delete\b/);
    }
  });

  it('detects optional/computed Auth deletion calls without treating strings as invocations', () => {
    expect(deletionCalls("const s = 'adminAuth().deleteUser(uid)'; // adminAuth().deleteUsers(uids)")).toHaveLength(0);
    for (const source of [
      'adminAuth().deleteUser?.(uid)',
      "adminAuth()['deleteUser'](uid)",
      'adminAuth()[`deleteUsers`](uids)',
    ]) expect(deletionCalls(source), source).toHaveLength(1);
  });

  it('confines privileged Auth deletion to the trusted account deletion job', () => {
    const allowedPath = join(process.cwd(), 'server', 'accountDeletion', 'jobStore.ts');
    const trustedSources = [
      ...sourcesUnder(join(process.cwd(), 'server')),
      ...sourcesUnder(join(process.cwd(), 'api')),
    ];
    const callers = trustedSources
      .filter(path => deletionCalls(readFileSync(path, 'utf8')).length > 0);
    expect(callers).toEqual([allowedPath]);
    const allowed = deletionCalls(readFileSync(allowedPath, 'utf8'));
    expect(allowed).toHaveLength(1);
    const call = allowed[0];
    expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
    if (!ts.isPropertyAccessExpression(call.expression)) return;
    expect(call.expression.expression.getText()).toBe('adminAuth()');
    expect(call.arguments.map(arg => arg.getText())).toEqual(['uid']);
    expect(ts.isAwaitExpression(call.parent)).toBe(true);
  });
});
