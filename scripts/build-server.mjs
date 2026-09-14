import {build} from 'esbuild';
await build({entryPoints:['server/production.ts'],bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',outfile:'.runtime/server.mjs'});

