// Reviewed pure physics only. vm limits accidental execution but is not a
// security boundary; inspect the generated module and configuration first.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw Error('Usage: check-merge.mjs <audited source directory> <report.json>');
const root=await realpath(directory),entry=path.join(root,'src/modules/physics.ts');
const cfg=JSON.parse(await readFile(path.join(root,'gameConfig.json'),'utf8'));
const bundle=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Physics',plugins:[{name:'local-only',setup(c){
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
check('同级合成一次且分数正确',()=>{const w=new Physics.Universe();w.add(0,250,400);w.add(0,280,400);w.step(1/120);eq(w.balls.length,1);eq(w.balls[0].level,1);eq(w.merges,1);eq(w.score,cfg.points[1]);});
check('三个相交同级球不能重复消费',()=>{const w=new Physics.Universe();for(let i=0;i<3;i++)w.add(0,300,400);w.step(1/120);eq(w.balls.length,2);eq(w.merges,1);eq(w.balls.reduce((s,b)=>s+2**b.level,0),3);});
check('异级与最高级接触不合成',()=>{for(const pair of [[0,1],[7,7]]){const w=new Physics.Universe();w.add(pair[0],280,400);w.add(pair[1],300,400);w.step(1/120);eq(w.balls.length,2);eq(w.merges,0);}});
check('重力落下后留在底部和侧壁内',()=>{const w=new Physics.Universe(),b=w.add(0,300,200);w.step(0.01);ok(b.y>200,'no gravity');for(let i=0;i<360;i++)w.step(1/120);ok(Math.abs(b.y-(cfg.chamber.bottom-cfg.radii[0]))<1,'floor failed');b.x=-100;b.vx=-100;w.step(1/120);ok(b.x>=cfg.chamber.left+cfg.radii[0],'left wall failed');b.x=1000;b.vx=100;w.step(1/120);ok(b.x<=cfg.chamber.right-cfg.radii[0],'right wall failed');});
check('新球保护与连续2秒危险计时',()=>{const w=new Physics.Universe(),b=w.add(0,300,100);w.step(.01);eq(b.danger,0);eq(w.lost,false);b.age=10;for(let i=0;i<199;i++){b.y=100;b.vy=0;w.step(.01);}eq(w.lost,false);b.y=100;b.vy=0;w.step(.011);eq(w.lost,true);});
check('短暂越线回到安全区后清零',()=>{const w=new Physics.Universe(),b=w.add(0,300,100,10);for(let i=0;i<150;i++){b.y=100;b.vy=0;w.step(.01);}eq(w.lost,false);b.y=300;b.vy=0;w.step(.01);eq(b.danger,0);for(let i=0;i<150;i++){b.y=100;b.vy=0;w.step(.01);}eq(w.lost,false);});
check('固定序列连续投放守恒和有限数值',()=>{const w=new Physics.Universe();let mass=0,added=0;for(let i=0;i<21600&&!w.lost;i++){
 if(i%72===0){const level=added%3;w.add(level,90+(added*79)%420,cfg.chamber.spawnY);mass+=2**level;added++;}
 w.step(1/120);eq(w.balls.reduce((s,b)=>s+2**b.level,0),mass);eq(w.balls.length,added-w.merges);
 for(const b of w.balls)ok([b.x,b.y,b.vx,b.vy,b.age,b.danger].every(Number.isFinite),'non-finite body');
 }ok(added>10,'too few throws');ok(w.lost,'fixed fill sequence did not end');});
JSON.stringify(tests);
`,context,{timeout:15000}));
const report={checkedAt:new Date().toISOString(),physicsHash:createHash('sha256').update(await readFile(entry)).digest('hex'),tests,passed:tests.every(t=>t.passed),scope:'Pure physics; pause, input, restart and visuals checked in browser'};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
