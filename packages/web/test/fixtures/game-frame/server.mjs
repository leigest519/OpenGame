import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
// Browser regression harness: open ?mode=stalled-paint, ?mode=slow, or /.
// Stalled paint must show PASS and allow clicking the game; slow requests
// must retain the overlay and offer retry / standalone after 12 seconds.
const webRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {GameFrame} from './src/components/game-frame';
const mode=new URLSearchParams(location.search).get('mode');
if(mode==='stalled-paint') window.requestAnimationFrame=()=>1;
function App(){const [n,setN]=React.useState(0);return <GameFrame src={'/game?run='+n+(mode==='slow'?'&slow=1':'')} title="测试游戏" gameTitle="加载回归" onRetry={()=>setN(n+1)}/>}
createRoot(document.getElementById('root')).render(<App/>);
setTimeout(()=>{document.getElementById('result').textContent=mode==='slow'?'慢请求测试':document.querySelector('[aria-busy="true"]')?'FAIL: 游戏已加载但遮罩未消失':'PASS: 游戏已加载且遮罩消失'},1500);`;
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/game')) {
    if (req.url.includes('slow=1')) return;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<button onclick="this.textContent=\'已开始\'">开始游戏</button>');
    return;
  }
  const b = await build({
    stdin: { contents: entry, loader: 'tsx', resolveDir: webRoot },
    bundle: true,
    write: false,
    outfile: 'test.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    `<style>${b.outputFiles.find((f) => f.path.endsWith('.css')).text}</style><div id="root" style="height:500px"></div><p id="result">检查中</p><script>${b.outputFiles.find((f) => f.path.endsWith('.js')).text}</script>`,
  );
});
server.listen(4198, '127.0.0.1', () =>
  console.log('http://127.0.0.1:4198/?mode=stalled-paint'),
);
