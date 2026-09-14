import { readFileSync, writeFileSync } from 'node:fs';

function patch(file, from, to) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`Missing target in ${file}`);
  writeFileSync(file, text.replace(from, to), 'utf8');
}

patch(
  'src/store/slices/createSyncSlice.ts',
  '    resetStore: () => void;',
  '    resetStore: (options?: { force?: boolean }) => void;',
);
patch(
  'src/store/slices/createSyncSlice.ts',
  '        resetStore: () => {',
  '        resetStore: options => {',
);
patch(
  'src/store/slices/createSyncSlice.ts',
  '            if (relevantDeletionPending()) {',
  '            if (!options?.force && relevantDeletionPending()) {',
);
patch(
  'src/contexts/AuthContext.tsx',
  '                useAppStore.getState().resetStore();\n                return;\n            }\n\n            if (mode === \'normal\') {',
  '                useAppStore.getState().resetStore({ force: true });\n                return;\n            }\n\n            if (mode === \'normal\') {',
);
patch(
  'src/contexts/AuthContext.tsx',
  '                await DB.secureLogOut();\n                DB.resetCache();\n                useAppStore.getState().resetStore();',
  '                await DB.secureLogOut();\n                DB.resetCache();\n                useAppStore.getState().resetStore({ force: true });',
);
