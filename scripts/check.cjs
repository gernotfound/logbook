const fs = require('fs');
const logicCode = fs.readFileSync('src/lib/logic.ts', 'utf-8');
const musclesStr = logicCode.match(/MUSCLES:\s*\[([\s\S]*?)\],/)[1];
const groupMapStr = logicCode.match(/GROUP_MAP:\s*(\{[\s\S]*?\}),/)[1];

const musclesIds = [...musclesStr.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
const groupMapKeys = [...groupMapStr.matchAll(/['"]([^'"]+)['"]:/g)].map(m => m[1]);

const unmapped = musclesIds.filter(id => !groupMapKeys.includes(id));
console.log('Unmapped muscles:', unmapped);

const pathsCode = fs.readFileSync('src/components/Training/MuscleModelPaths.tsx', 'utf-8');
const pathIds = [...pathsCode.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]);

const missingPaths = [];
for (const match of groupMapStr.matchAll(/['"]([^'"]+)['"]:\s*\[([\s\S]*?)\]/g)) {
    const key = match[1];
    const arr = match[2];
    const ids = [...arr.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const id of ids) {
        if (!pathIds.includes(id)) {
            missingPaths.push({key, id});
        }
    }
}
console.log('Missing paths in GROUP_MAP:', missingPaths);
