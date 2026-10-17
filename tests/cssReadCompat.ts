import fs from 'fs';
import path from 'path';
import { syncBuiltinESMExports } from 'node:module';

const compatFs = fs as typeof fs & { __logbookCssReadCompatInstalled?: boolean };

if (!compatFs.__logbookCssReadCompatInstalled) {
  const originalReadFileSync = fs.readFileSync.bind(fs);
  const cssEntrypoints = new Set([
    path.resolve(process.cwd(), 'src/styles/global.css'),
    path.resolve(process.cwd(), 'src/components/Training/training.css'),
  ]);

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

  // UI tests inspect both the global and Training CSS entrypoints as text.
  // Expand local imports so existing assertions still exercise the effective CSS.
  fs.readFileSync = ((filePath: any, options?: any) => {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (
      typeof filePath === 'string' &&
      cssEntrypoints.has(path.resolve(filePath)) &&
      (encoding === 'utf8' || encoding === 'utf-8')
    ) {
      return expandLocalCssImports(filePath);
    }

    return originalReadFileSync(filePath, options);
  }) as typeof fs.readFileSync;

  compatFs.__logbookCssReadCompatInstalled = true;
  syncBuiltinESMExports();
}
