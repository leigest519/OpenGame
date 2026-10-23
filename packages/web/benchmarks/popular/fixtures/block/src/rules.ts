import config from '../gameConfig.json';
export type Shape = { id: string; cells: number[][] };
export type Snapshot = { board: number[][]; hand: (Shape | null)[]; score: number; lines: number; over: boolean; moves: number; selected: number; rng: number };
export type State = Snapshot & { undoRemaining: number; undoSnapshot: Snapshot | null };
function snapshot(state: Snapshot): Snapshot {
  return {board: state.board.map(row => [...row]), hand: state.hand.map(shape => shape ? {id:shape.id,cells:shape.cells.map(cell=>[...cell])} : null), score:state.score, lines:state.lines, over:state.over, moves:state.moves, selected:state.selected, rng:state.rng};
}
function nextRandom(source: {rng:number}): number {
  source.rng = (Math.imul(source.rng, 1664525) + 1013904223) >>> 0;
  return source.rng / 4294967296;
}
export function selectHand(state: State, index: number): State {
  return !state.over && state.hand[index] ? {...state, selected:index} : state;
}
export function canUndo(state: State): boolean { return state.undoRemaining > 0 && state.undoSnapshot !== null; }
export function undo(state: State): {state:State; error?:string} {
  if (!canUndo(state)) return {state, error:'当前没有可用的撤销机会。'};
  return {state:{...snapshot(state.undoSnapshot!), undoRemaining:state.undoRemaining-1, undoSnapshot:null}};
}
export const shapes: Shape[] = config.shapes;
export function deal(random: () => number = Math.random): Shape[] {
  const pool = [...shapes];
  const result: Shape[] = [];
  while (result.length < config.handSize) {
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}
export function initialize(tutorial = false, random: () => number = Math.random): State {
  const board = Array.from({length: config.boardSize}, () => Array(config.boardSize).fill(0));
  const source = {rng: Math.floor(random() * 4294967296) >>> 0};
  const hand = deal(() => nextRandom(source));
  if (tutorial) {
    board[config.boardSize - 1].fill(1, 0, config.boardSize - 1);
    hand.splice(0, hand.length, shapes[0], shapes[4], shapes[5]);
  }
  return {board, hand, score: 0, lines: 0, over: false, moves: 0, selected:-1, rng:source.rng, undoRemaining:config.undoPerGame, undoSnapshot:null};
}
export function canPlace(board: number[][], shape: Shape, row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && shape.cells.every(([x,y]) =>
    row+y >= 0 && row+y < config.boardSize && col+x >= 0 && col+x < config.boardSize && board[row+y][col+x] === 0);
}
export function legalPositions(board: number[][], shape: Shape): [number,number][] {
  const result: [number,number][] = [];
  for (let r=0;r<config.boardSize;r++) for (let c=0;c<config.boardSize;c++) if(canPlace(board,shape,r,c)) result.push([r,c]);
  return result;
}
export function isDeadlock(state: Pick<State,'board'|'hand'>): boolean {
  return !state.hand.some(shape => shape && legalPositions(state.board,shape).length > 0);
}
export function place(state: State, handIndex: number, row: number, col: number): { state: State; error?: string; cleared?: number } {
  if(state.over) return {state,error:'本局已结束，请重新开始。'};
  const shape = state.hand[handIndex];
  if(!shape) return {state,error:'请先选择一块手牌。'};
  if(!canPlace(state.board,shape,row,col)) return {state,error:'这里放不下：方块不能重叠或超出港湾。'};
  const board = state.board.map(line=>[...line]);
  shape.cells.forEach(([x,y])=>board[row+y][col+x]=handIndex+1);
  const rows = board.map((line,i)=>line.every(Boolean)?i:-1).filter(i=>i>=0);
  const cols = Array.from({length:config.boardSize},(_,i)=>i).filter(c=>board.every(line=>line[c]!==0));
  for(let r=0;r<config.boardSize;r++) for(let c=0;c<config.boardSize;c++) if(rows.includes(r)||cols.includes(c)) board[r][c]=0;
  let hand = [...state.hand]; hand[handIndex]=null;
  const source = {rng:state.rng};
  if(hand.every(item=>item===null)) hand=deal(() => nextRandom(source));
  const cleared=rows.length+cols.length;
  const next: State = {board, hand, score:state.score+shape.cells.length*config.pointsPerCell+cleared*config.pointsPerLine, lines:state.lines+cleared, over:false, moves:state.moves+1, selected:-1, rng:source.rng, undoRemaining:state.undoRemaining, undoSnapshot:state.undoRemaining > 0 ? snapshot(state) : null};
  next.over=isDeadlock(next);
  return {state:next,cleared};
}
