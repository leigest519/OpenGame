// Independent rule checks only; no browser automation. Audit the generated
// rules/config before running: Node vm is not a security boundary.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

const [directory, output] = process.argv.slice(2);
assert.ok(directory && output, 'Usage: check-block.mjs <audited source directory> <report.json>');
const root = await realpath(directory);
const entry = path.join(root, 'src/rules.ts');
const bundle = await build({ entryPoints: [entry], bundle: true, write: false,
  platform: 'browser', format: 'iife', globalName: 'Rules', target: 'es2022',
  plugins: [{ name: 'local-rules', setup(context) {
    context.onResolve({filter: /.*/}, args => {
      if (args.kind !== 'entry-point' && !args.path.startsWith('.'))
        return {errors: [{text: 'External rule imports are not allowed'}]};
    });
    context.onLoad({filter: /.*/}, async args => {
      if (!(await realpath(args.path)).startsWith(root + path.sep))
        return {errors: [{text: 'Import leaves the audited project'}]};
    });
  }}] });
const context = vm.createContext({}, {codeGeneration: {strings: false, wasm: false}});
vm.runInContext(bundle.outputFiles[0].text, context, {timeout: 1000});
const suite = `
const tests=[];
const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}));};
const check=(name,fn)=>{try{fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:String(e.message)});}};
const clone=x=>JSON.parse(JSON.stringify(x));
const dot={id:'test-dot',cells:[[0,0]]};
const square={id:'test-square',cells:[[0,0],[1,0],[0,1],[1,1]]};
check('空棋盘与三种不同手牌',()=>{
 const s=Rules.initialize(false,()=>0);eq(s.board.length,8);eq(s.board.flat().filter(Boolean).length,0);
 eq(s.hand.length,3);eq(new Set(s.hand.map(x=>x.id)).size,3);eq([s.score,s.lines,s.over],[0,0,false]);
});
check('教学消行得11分且不改变输入',()=>{
 const s=Rules.initialize(true,()=>0),old=clone(s),n=Rules.place(s,0,7,7,()=>0);
 eq(s,old);eq(n.error,undefined);eq(n.state.score,11);eq(n.state.lines,1);
 eq(n.state.board.flat().filter(Boolean).length,0);eq(n.state.hand.filter(Boolean).length,2);
});
check('重叠越界拒绝且不扣牌不加分',()=>{
 const s=Rules.initialize(true,()=>0);for(const [i,r,c] of [[0,7,0],[1,7,7],[0,-1,0],[0,0,8],[0,0,0.5]]){
 const old=clone(s),n=Rules.place(s,i,r,c,()=>0);eq(s,old);eq(Boolean(n.error),true);eq(n.state,s);}
});
check('同时清行列交叉格只清除一次',()=>{
 const s=Rules.initialize(false,()=>0);s.hand=[dot,square,null];
 for(let i=0;i<7;i++){s.board[7][i]=1;s.board[i][7]=1;}
 const n=Rules.place(s,0,7,7,()=>0).state;eq(n.score,21);eq(n.lines,2);eq(n.board.flat().filter(Boolean).length,0);
});
check('必须所有剩余块都无处放才判负',()=>{
 const s=Rules.initialize(false,()=>0);s.board=Array.from({length:8},()=>Array(8).fill(1));s.board[0][0]=0;
 s.hand=[square,dot,null];eq(Rules.isDeadlock(s),false);s.hand=[square,null,null];eq(Rules.isDeadlock(s),true);
});
check('第三块用完才补牌',()=>{
 let s=Rules.initialize(false,()=>0);s.hand=[dot,dot,dot];
 s=Rules.place(s,0,0,0,()=>0).state;eq(s.hand.filter(Boolean).length,2);
 s=Rules.place(s,1,0,2,()=>0).state;eq(s.hand.filter(Boolean).length,1);
 s=Rules.place(s,2,0,4,()=>0).state;eq(s.hand.filter(Boolean).length,3);eq(s.score,3);
});
check('结束后落子不改变状态',()=>{
 const s=Rules.initialize(false,()=>0);s.over=true;const n=Rules.place(s,0,0,0,()=>0);eq(Boolean(n.error),true);eq(n.state,s);
});
check('独立棋盘对照500次落子/消除/死局',()=>{
 let seed=1234567,steps=0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const fits=(board,shape,r,c)=>shape.cells.every(([x,y])=>r+y>=0&&r+y<8&&c+x>=0&&c+x<8&&!board[r+y][c+x]);
 const spots=(board,shape)=>{const a=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(fits(board,shape,r,c))a.push([r,c]);return a;};
 while(steps<500){let s=Rules.initialize(false,rnd);while(!s.over&&steps<500){
 const choices=[];s.hand.forEach((p,i)=>{if(p)for(const [r,c] of spots(s.board,p))choices.push([i,r,c]);});
 if(!choices.length)throw Error('live state with no legal move');
 const [i,r,c]=choices[Math.floor(rnd()*choices.length)],p=s.hand[i],b=clone(s.board);
 p.cells.forEach(([x,y])=>b[r+y][c+x]=i+1);
 const fullRows=new Set(),fullCols=new Set();for(let j=0;j<8;j++){
 if(b[j].filter(Boolean).length===8)fullRows.add(j);if(b.filter(row=>!!row[j]).length===8)fullCols.add(j);}
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(fullRows.has(y)||fullCols.has(x))b[y][x]=0;
 const old=clone(s),n=Rules.place(s,i,r,c,rnd);eq(s,old);eq(n.state.board,b);
 eq(n.state.score,s.score+p.cells.length+10*(fullRows.size+fullCols.size));
 eq(n.state.lines,s.lines+fullRows.size+fullCols.size);
 eq(n.state.over,!n.state.hand.some(p=>p&&spots(b,p).length));s=n.state;steps++;
 }}
});
if(typeof Rules.undo==='function') {
check('撤销消行完整恢复且不改变原状态',()=>{
 let s=Rules.selectHand(Rules.initialize(true,()=>0),0),n=Rules.place(s,0,7,7).state,old=clone(n);
 const back=Rules.undo(n).state;eq(n,old);eq(back,{...s,undoRemaining:0,undoSnapshot:null});
 eq(Rules.canUndo(back),false);eq(Boolean(Rules.undo(back).error),true);
});
check('错误落子不覆盖撤销快照',()=>{
 const s=Rules.selectHand(Rules.initialize(true,()=>0),0),n=Rules.place(s,0,7,7).state;
 const rejected=Rules.place(n,1,7,7);eq(Boolean(rejected.error),true);
 eq(Rules.undo(rejected.state).state,{...s,undoRemaining:0,undoSnapshot:null});
});
check('补牌后撤销再落同处不会刷出不同手牌',()=>{
 let s=Rules.initialize(false,()=>0);s.hand=[null,null,dot];s=Rules.selectHand(s,2);
 const first=Rules.place(s,2,0,0).state,back=Rules.undo(first).state,second=Rules.place(back,2,0,0).state;
 eq(back.hand,s.hand);eq(back.rng,s.rng);eq(back.selected,2);
 for(const key of ['board','hand','rng','score','lines','moves'])eq(first[key],second[key]);eq(second.undoRemaining,0);
});
check('死局撤销救回且重开恢复一次机会',()=>{
 let s=Rules.initialize(false,()=>0);s.board=Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>(r+c)%2));
 s.hand=[dot,square,null];const n=Rules.place(s,0,0,0).state;eq(n.over,true);
 const back=Rules.undo(n).state;eq(back.over,false);eq(back.undoRemaining,0);eq(back.board,s.board);
 const fresh=Rules.initialize(false,()=>0);eq(fresh.undoRemaining,1);eq(fresh.undoSnapshot,null);
});
}
JSON.stringify(tests);
`;
const tests = JSON.parse(vm.runInContext(suite, context, {timeout: 15000}));
const report = { checkedAt: new Date().toISOString(), ruleHash: createHash('sha256').update(await readFile(entry)).digest('hex'), tests,
  passed: tests.every(t => t.passed), scope: 'Pure rules; browser gameplay and visuals checked separately' };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
