import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const {default:worker}=await import('../dist/server/index.js');
const origin='https://kimia.test';const req=(path,options={})=>new Request(origin+path,options);
const admin={'oai-authenticated-user-id':'admin-1','oai-authenticated-user-email':'owner@example.test'};
const env={ADMIN_EMAILS:'owner@example.test'};
let r=await worker.fetch(req('/admin'),env);assert.equal(r.status,302);
r=await worker.fetch(req('/api/admin/data'),env);assert.equal(r.status,403);
r=await worker.fetch(req('/api/admin/session',{headers:admin}),env);assert.deepEqual(await r.json(),{ok:true,database_ready:false,uploads_ready:false,auth_mode:'sites'});
r=await worker.fetch(req('/admin',{headers:admin}),env);assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);
r=await worker.fetch(req('/api/admin/settings',{method:'PUT',headers:{...admin,origin:'https://attacker.test','content-type':'application/json'},body:'{}'}),env);assert.equal(r.status,403);
r=await worker.fetch(req('/api/admin/settings',{method:'PUT',headers:{...admin,origin,'content-type':'application/json'},body:'{}'}),env);assert.equal(r.status,503);
r=await worker.fetch(req('/robots.txt'),env);const robots=await r.text();assert.match(robots,/Allow: \/\n/);assert.match(robots,/Disallow: \/api\//);
r=await worker.fetch(req('/sitemap.xml'),env);assert.match(await r.text(),/services\/nails/);
r=await worker.fetch(req('/services/nails'),env);assert.equal(r.status,200);const html=await r.text();assert.match(html,/rel="canonical"/);assert.match(html,/application\/ld\+json/);
r=await worker.fetch(req('/uploads/00000000-0000-0000-0000-000000000000.png'),env);assert.equal(r.status,404);
for(const file of ['index','admin']){const html=await readFile(new URL('../src/'+file+'.html',import.meta.url),'utf8');for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);}
console.log('Admin authorization, cross-origin writes, setup gate, crawler paths, service SEO and client syntax passed.');
