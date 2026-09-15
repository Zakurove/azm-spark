import {createServer} from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createApi} from './api';
const root=resolve('dist'),api=createApi();
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.woff2':'font/woff2','.wasm':'application/wasm','.mp3':'audio/mpeg','.task':'application/octet-stream','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg','.ico':'image/x-icon'};
const server=createServer((req,res)=>void api.handle(req,res,()=>{
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
 let name:string;try{name=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
 const target=resolve(root,'.'+name);if(!target.startsWith(root+'/')&&target!==root){res.writeHead(403);res.end();return;}
 const file=existsSync(target)&&statSync(target).isFile()?target:resolve(root,'index.html');
 res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');
 if(file!==resolve(root,'index.html')&&/^\/(assets|models|wasm|cues|fonts|illustrations|brand)\//.test(name))res.setHeader('Cache-Control',name.startsWith('/assets/')||name.startsWith('/models/')||name.startsWith('/wasm/')?'public, max-age=31536000, immutable':'public, max-age=86400');
 if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
}));
server.listen(Number(process.env.PORT??5205),process.env.HOST??'127.0.0.1',()=>console.log('Azm application server ready'));server.on('close',api.close);
