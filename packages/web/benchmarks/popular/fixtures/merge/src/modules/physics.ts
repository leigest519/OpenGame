import cfg from '../../gameConfig.json';
export type Ball = {id:number; level:number; x:number; y:number; vx:number; vy:number; age:number; danger:number};
export class Universe {
  balls:Ball[]=[]; nextId=1; score=0; merges=0; lost=false;
  add(level:number,x:number,y:number,age=0) { const b={id:this.nextId++,level,x,y,vx:0,vy:0,age,danger:0}; this.balls.push(b); return b; }
  step(dt:number) {
    const p=cfg.physics, c=cfg.chamber;
    for(const b of this.balls){ b.age+=dt; b.vy+=p.gravity*dt; b.x+=b.vx*dt; b.y+=b.vy*dt; }
    const consumed=new Set<number>(); const pairs:[Ball,Ball][]=[];
    for(let k=0;k<p.iterations;k++) {
      for(const b of this.balls){
        const r=cfg.radii[b.level];
        if(b.x<c.left+r){b.x=c.left+r;b.vx=Math.abs(b.vx)*p.restitution;}
        if(b.x>c.right-r){b.x=c.right-r;b.vx=-Math.abs(b.vx)*p.restitution;}
        if(b.y>c.bottom-r){b.y=c.bottom-r;b.vy=-Math.abs(b.vy)*p.restitution;b.vx*=p.friction;}
      }
      for(let i=0;i<this.balls.length;i++) for(let j=i+1;j<this.balls.length;j++){
        const a=this.balls[i],b=this.balls[j],ra=cfg.radii[a.level],rb=cfg.radii[b.level];
        let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
        if(d>ra+rb+0.1)continue;
        if(a.level===b.level && a.level<cfg.radii.length-1 && !consumed.has(a.id)&&!consumed.has(b.id)) {consumed.add(a.id);consumed.add(b.id);pairs.push([a,b]);}
        if(d===0){dx=0.01;dy=-0.01;d=Math.hypot(dx,dy);}
        const nx=dx/d,ny=dy/d,ia=1/(ra*ra),ib=1/(rb*rb),sum=ia+ib;
        const overlap=Math.max(0,ra+rb-d);a.x-=nx*overlap*ia/sum;a.y-=ny*overlap*ia/sum;b.x+=nx*overlap*ib/sum;b.y+=ny*overlap*ib/sum;
        const v=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(v<0){const impulse=-(1+p.restitution)*v/sum;a.vx-=impulse*nx*ia;a.vy-=impulse*ny*ia;b.vx+=impulse*nx*ib;b.vy+=impulse*ny*ib;}
      }
    }
    if(pairs.length){this.balls=this.balls.filter(b=>!consumed.has(b.id));for(const [a,b] of pairs){const level=a.level+1;const n=this.add(level,(a.x+b.x)/2,(a.y+b.y)/2,Math.min(a.age,b.age));n.vx=(a.vx+b.vx)/2;n.vy=(a.vy+b.vy)/2;this.score+=cfg.points[level];this.merges++;}}
    for(const b of this.balls){if(b.age>=cfg.spawnProtection && b.y-cfg.radii[b.level]<c.dangerY)b.danger+=dt;else b.danger=0;if(b.danger>=cfg.dangerDuration)this.lost=true;}
  }
}
