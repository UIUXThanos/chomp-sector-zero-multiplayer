'use strict';
const CELL=3;
const MAP=[
'#################','#.......#.......#','#.##.##.#.##.##.#','#...............#',
'#.##.#.###.#.##.#','#....#.....#....#','###.###.#.###.###','#.......#.......#',
'#.##.#.....#.##.#','#....#.....#....#','#.##.#.###.#.##.#','#.......#.......#',
'###.##..#..##.###','#...............#','#.##.##.#.##.##.#','#.......#.......#','#################'];
const wall=(x,z)=>!MAP[z]||MAP[z][x]===undefined||MAP[z][x]==='#';
function passable(x,z,r=.25){for(let j=Math.floor((z-r)/CELL);j<=Math.floor((z+r)/CELL);j++)for(let i=Math.floor((x-r)/CELL);i<=Math.floor((x+r)/CELL);i++)if(wall(i,j)){const a=Math.max(i*CELL,Math.min(x,(i+1)*CELL)),b=Math.max(j*CELL,Math.min(z,(j+1)*CELL));if(Math.hypot(x-a,z-b)<r)return false;}return true;}
function wallRay(o,d,max=55){for(let t=.08;t<max;t+=.08){const y=o[1]+d[1]*t;if(y<0)return t;if(y<2.8&&wall(Math.floor((o[0]+d[0]*t)/CELL),Math.floor((o[2]+d[2]*t)/CELL)))return t;}return max;}
function raySphere(o,d,c,r){const v=o.map((n,i)=>n-c[i]),b=v.reduce((n,v,i)=>n+v*d[i],0),k=v.reduce((n,x)=>n+x*x,0)-r*r,disc=b*b-k;if(disc<0)return Infinity;const t=-b-Math.sqrt(disc);return t>=0?t:Infinity;}
function fieldFrom(x,z){const out=Array.from({length:MAP.length},()=>Array(MAP[0].length).fill(999)),q=[[x,z]];if(wall(x,z))return out;out[z][x]=0;for(let k=0;k<q.length;k++){const [a,b]=q[k];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=a+dx,nz=b+dz;if(!wall(nx,nz)&&out[nz][nx]===999){out[nz][nx]=out[b][a]+1;q.push([nx,nz]);}}}return out;}
module.exports={CELL,MAP,wall,passable,wallRay,raySphere,fieldFrom};
