import cfg from '../../gameConfig.json';
import {makeRoad, carPositions, Road} from './roads';
export type Status = 'playing'|'paused'|'over';
export class Run {
  column=cfg.spawnColumn; row=0; farthest=0; time=0; cooldown=0; status:Status='playing';
  roads:Road[]=[];
  constructor(public seed:number) { this.ensure(); }
  get cameraRow() { return Math.max(0,this.row-cfg.cameraBehind); }
  ensure() { while(this.roads.length<=this.row+cfg.aheadRows) this.roads.push(makeRoad(this.roads.length,this.seed)); }
  hit() {
    const x=(this.column+0.5)*cfg.cell;
    return carPositions(this.roads[this.row],this.time).some(car=>Math.abs(car-x)<cfg.carWidth/2+cfg.robotRadius);
  }
  move(dx:number,dy:number) {
    if(this.status!=='playing'||this.cooldown>0) return;
    const col=this.column+dx, row=this.row+dy;
    if(col<0||col>=cfg.columns||row<0) return;
    this.column=col; this.row=row; this.cooldown=cfg.moveCooldownSeconds; this.ensure();
    if(this.hit()) this.status='over';
    else this.farthest=Math.max(this.farthest,this.row);
  }
  tick(dt:number) {
    if(this.status!=='playing') return;
    this.cooldown=Math.max(0,this.cooldown-dt); this.time+=dt;
    if(this.hit()) this.status='over';
  }
}
