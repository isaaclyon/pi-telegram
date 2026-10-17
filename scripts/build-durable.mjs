import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';
await build({entryPoints:['api/durable.ts'],bundle:true,platform:'node',format:'esm',outfile:'api/durable.mjs'});
execFileSync('node_modules/.bin/tsc',['--ignoreConfig','api/durable.ts','--types','node','--declaration','--emitDeclarationOnly','--allowImportingTsExtensions','--skipLibCheck','--module','nodenext','--target','es2023','--outDir','api/durable-types','--rootDir','.'],{stdio:'inherit'});
for(const file of readdirSync('api/durable-types',{recursive:true}).filter(p=>p.endsWith('.d.ts'))) {
 const path=`api/durable-types/${file}`;
 writeFileSync(path,readFileSync(path,'utf8').replaceAll('.ts"','.js"').replaceAll(".ts'",".js'"));
}
writeFileSync('api/durable.d.mts',readFileSync('api/durable-types/api/durable.d.ts','utf8').replaceAll('../lib/','./durable-types/lib/'));
