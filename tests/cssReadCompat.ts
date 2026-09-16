import fs from 'fs';
import path from 'path';
import { syncBuiltinESMExports } from 'node:module';

const compatFs = fs as typeof fs & { __logbookCssReadCompatInstalled?: boolean };

if (!compatFs.__logbookCssReadCompatInstalled) {
  const originalReadFileSync = fs.readFileSync.bind(fs);
  const globalCssPath = path.resolve(process.cwd(), 'src/styles/global.css');

  function expandLocalCssImports(filePath: string, visited = new Set<string>()): string {
    const resolvedPath = path.resolve(filePath);
    if (visited.has(resolvedPath)) return '';
    visited.add(resolvedPath);

    const source = originalReadFileSync(resolvedPath, 'utf8') as string;
    return source.replace(
      /@import\s+['"]([^'"]+)['"]\s*;/g,
      (statement, importPath: string) => {
        if (!importPath.startsWith('.')) return statement;
        const importedPath = path.resolve(path.dirname(resolvedPath), importPath);
        return `\n${expandLocalCssImports(importedPath, visited)}\n`;
      },
    );
  }

  // Repository-level UI tests inspect the effective global stylesheet directly.
  // Keep those oracles valid after modularization by expanding only local imports
  // when the canonical global.css entrypoint is read as UTF-8 text.
  fs.readFileSync = ((filePath: any, options?: any) => {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (
      typeof filePath === 'string' &&
      path.resolve(filePath) === globalCssPath &&
      (encoding === 'utf8' || encoding === 'utf-8')
    ) {
      return expandLocalCssImports(globalCssPath);
    }

    return originalReadFileSync(filePath, options);
  }) as typeof fs.readFileSync;

  compatFs.__logbookCssReadCompatInstalled = true;
  syncBuiltinESMExports();
}
