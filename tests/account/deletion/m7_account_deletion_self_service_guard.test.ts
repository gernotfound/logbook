import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';

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

type SyntaxNode = { type: string; start: number; end: number; [key: string]: unknown };
type DeletionCall = { method: string; receiver: string; args: string[]; awaited: boolean };

const isNode = (value: unknown): value is SyntaxNode =>
  value !== null && typeof value === 'object'
  && typeof (value as SyntaxNode).type === 'string'
  && typeof (value as SyntaxNode).start === 'number'
  && typeof (value as SyntaxNode).end === 'number';

function deletionCalls(source: string): DeletionCall[] {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  const calls: DeletionCall[] = [];
  const visit = (node: SyntaxNode, parent?: SyntaxNode): void => {
    if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && isNode(node.callee)) {
      const member = node.callee;
      if ((member.type === 'MemberExpression' || member.type === 'OptionalMemberExpression')
          && isNode(member.property) && isNode(member.object)) {
        const property = member.property;
        const method = !member.computed && property.type === 'Identifier' && typeof property.name === 'string'
          ? property.name
          : member.computed && property.type === 'StringLiteral' && typeof property.value === 'string'
            ? property.value
            : member.computed && property.type === 'TemplateLiteral'
              && Array.isArray(property.expressions) && property.expressions.length === 0
              ? source.slice(property.start + 1, property.end - 1)
              : undefined;
        if (method === 'deleteUser' || method === 'deleteUsers') {
          calls.push({
            method, receiver: source.slice(member.object.start, member.object.end),
            args: Array.isArray(node.arguments)
              ? node.arguments.filter(isNode).map(arg => source.slice(arg.start, arg.end))
              : [],
            awaited: parent?.type === 'AwaitExpression',
          });
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (['loc', 'extra', 'comments', 'errors', 'tokens', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
      if (isNode(child)) visit(child, node);
      else if (Array.isArray(child)) for (const item of child) if (isNode(item)) visit(item, node);
    }
  };
  if (isNode(ast)) visit(ast);
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
    expect(allowed).toEqual([{
      method: 'deleteUser', receiver: 'adminAuth()', args: ['uid'], awaited: true,
    }]);
  });
});
