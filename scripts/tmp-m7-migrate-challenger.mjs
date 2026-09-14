import { readFileSync, writeFileSync } from 'node:fs';

const file = 'tests/challenger_m4_adversarial.test.ts';
const text = readFileSync(file, 'utf8');
const startMarker = "        it('DB.deleteAccount breaks large reference sets into chunks of <= 400', async () => {";
const endMarker = "            expect(mockBatch.commit).toHaveBeenCalledTimes(4);\n        });";
const start = text.indexOf(startMarker);
const endStart = text.indexOf(endMarker, start);
if (start < 0 || endStart < 0) throw new Error('Expected legacy deletion challenger block not found');
const end = endStart + endMarker.length;

const replacement = `        it('server deletion preserves <=400 batches and verifies residues before deleting Auth', () => {
            const jobStore = fs.readFileSync(
                path.resolve(__dirname, '../server/accountDeletion/jobStore.ts'),
                'utf-8'
            );
            const runner = fs.readFileSync(
                path.resolve(__dirname, '../server/accountDeletion/runner.ts'),
                'utf-8'
            );

            expect(jobStore).toContain('const PAGE_SIZE = 400;');
            expect(jobStore).toMatch(/\\.limit\\(PAGE_SIZE\\)/);

            const verificationIndex = runner.indexOf('await verifyNoAccountResidue(uid);');
            const authIndex = runner.indexOf('await deleteAuthUserLast(uid);');
            const completeIndex = runner.indexOf('await markDeletionComplete(uid);');
            expect(verificationIndex).toBeGreaterThan(-1);
            expect(authIndex).toBeGreaterThan(verificationIndex);
            expect(completeIndex).toBeGreaterThan(authIndex);
        });`;

writeFileSync(file, text.slice(0, start) + replacement + text.slice(end), 'utf8');
