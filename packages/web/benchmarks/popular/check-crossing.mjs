// Only run after reviewing rules.ts, roads.ts and gameConfig.json. Node vm is
// not a security boundary. These tests do not automate any browser.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw Error('Usage: check-crossing.mjs <audited source directory> <report.json>');
const root=await realpath(directory),entry=path.join(root,'src/modules/rules.ts');
const cfg=JSON.parse(await readFile(path.join(root,'gameConfig.json'),'utf8'));
const bundle=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Rules',plugins:[{name:'local-only',setup(c){
 c.onResolve({filter:/.*/},a=>a.kind!=='entry-point'&&!a.path.startsWith('.')?{errors:[{text:'External import'}]}:undefined);
 c.onLoad({filter:/.*/},async a=>(await realpath(a.path)).startsWith(root+path.sep)?undefined:{errors:[{text:'Outside project'}]});
}}]});
const context=vm.createContext({configJson:JSON.stringify(cfg)},{codeGeneration:{strings:false,wasm:false}});
vm.runInContext(bundle.outputFiles[0].text,context,{timeout:1000});
const tests=JSON.parse(vm.runInContext(`
const cfg=JSON.parse(configJson),tests=[];
const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}));};
const ok=(v,m)=>{if(!v)throw Error(m);};
const check=(name,fn)=>{try{fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:String(e.message)});}};
check('同种子道路一致且前三行安全',()=>{const a=new Rules.Run(43127),b=new Rules.Run(43127);eq(a.roads,b.roads);eq(a.roads.slice(0,3).map(x=>x.safe),[true,true,true]);ok(JSON.stringify(a.roads)!==JSON.stringify(new Rules.Run(777).roads),'seed ignored');});
check('回退前进与左右移动不刷分',()=>{const r=new Rules.Run(1);for(const [x,y] of [[0,1],[0,-1],[0,1],[-1,0],[1,0]]){r.move(x,y);r.tick(.2);}eq(r.farthest,1);eq(r.row,1);eq(r.column,cfg.spawnColumn);});
check('冷却与边界拒绝多次移动',()=>{const r=new Rules.Run(1);r.move(0,1);r.move(0,1);eq(r.row,1);r.tick(.2);r.move(0,1);eq(r.row,2);const b=new Rules.Run(1);b.move(0,-1);eq(b.row,0);b.column=0;b.move(-1,0);eq(b.column,0);});
check('暂停冻结车辆时间角色与计分',()=>{const r=new Rules.Run(1);r.move(0,1);r.status='paused';const before=JSON.stringify(r);r.tick(60);r.move(0,1);eq(JSON.stringify(r),before);});
check('道路上不动也会被驶来的车撞到',()=>{const r=new Rules.Run(1);r.row=3;r.ensure();const x=(r.column+.5)*cfg.cell;r.roads[3]={row:3,safe:false,direction:1,speed:100,phase:x-80,color:0};eq(r.hit(),false);for(let i=0;i<100&&r.status==='playing';i++)r.tick(.01);eq(r.status,'over');});
check('移动撞车后冻结并且不加距离',()=>{const r=new Rules.Run(1);r.row=2;r.farthest=2;const x=(r.column+.5)*cfg.cell;r.roads[3]={row:3,safe:false,direction:1,speed:80,phase:x,color:0};r.move(0,1);eq(r.status,'over');eq(r.farthest,2);const before=JSON.stringify(r);r.move(1,0);r.tick(10);eq(JSON.stringify(r),before);});
check('重新构造一局恢复固定安全开局',()=>{const a=new Rules.Run(9);a.move(0,1);a.tick(.2);const fresh=new Rules.Run(9);eq([fresh.row,fresh.farthest,fresh.time,fresh.cooldown,fresh.status],[0,0,0,0,'playing']);eq(fresh.roads,new Rules.Run(9).roads);});
check('500行道路有限数值且车速有界',()=>{const r=new Rules.Run(43127);r.row=500;r.ensure();eq(r.roads.length,513);for(const road of r.roads){ok([road.speed,road.phase,road.direction].every(Number.isFinite),'invalid road');ok(road.speed<=cfg.maxSpeed*1.12,'unbounded speed');}ok(r.roads.some(x=>x.direction===1)&&r.roads.some(x=>x.direction===-1),'missing opposite direction');});
JSON.stringify(tests);
`,context,{timeout:5000}));
const hashes={};for(const file of ['src/modules/rules.ts','src/modules/roads.ts','gameConfig.json'])hashes[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
const report={checkedAt:new Date().toISOString(),hashes,tests,passed:tests.every(t=>t.passed),scope:'Pure rules; scene lifecycle and visible input checked through real platform/browser'};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
