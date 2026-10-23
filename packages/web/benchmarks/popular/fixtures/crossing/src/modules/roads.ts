import cfg from '../../gameConfig.json';
export type Road = { row:number; safe:boolean; direction:number; speed:number; phase:number; color:number };
export function hash(row:number, seed:number) {
  let n = (row * 374761393 + seed * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function makeRoad(row:number, seed:number):Road {
  const safe = row < cfg.safeRows || row % 5 === 2 || (row > 4 && hash(row, seed) < 0.16);
  return {row, safe, direction:row % 2 ? 1 : -1,
    speed:Math.min(cfg.maxSpeed, cfg.baseSpeed + row * cfg.speedPerRow) * (0.88 + hash(row+39,seed)*0.24),
    phase:hash(row+100,seed)*cfg.carSpacing,
    color:[0xf6bd60,0xf28482,0x70b8c4,0xa9a1e8][Math.floor(hash(row+9,seed)*4)]};
}
export function carPositions(road:Road, time:number):number[] {
  if (road.safe) return [];
  const offset = ((road.phase + road.direction * road.speed * time) % cfg.carSpacing + cfg.carSpacing) % cfg.carSpacing;
  const positions:number[]=[];
  for(let x=offset-cfg.carSpacing; x<cfg.width+cfg.carWidth; x+=cfg.carSpacing) positions.push(x);
  return positions;
}
