'use strict';
const express = require('express');
const { createServer } = require('node:http');
const { randomInt } = require('node:crypto');
const { Server } = require('socket.io');
const path = require('node:path');
const { MAP, CELL, passable, wallRay, raySphere, fieldFrom } = require('./shared');

const app = express();
app.use(express.static(__dirname, { index: 'index.html' }));
app.get('/healthz', (_, res) => res.json({ ok: true }));
const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10000 });
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const GHOSTS_PER_WAVE = [8, 15, 27, 40, 75]; // EDIT THE FIVE WAVE COUNTS HERE
const MAX_AMMO = 18;
const RELOAD_MS = 1350;
const EGG_KINDS = ['rifle','frenzy','banana','poop'];
const EGG_DURATION_MS = 15000;
const EGG_POSITIONS = [[4.5,4.5],[46.5,4.5],[4.5,46.5],[46.5,46.5]];
const COLORS = [[.95,.14,.48],[.08,.69,.86],[.64,.26,1],[.92,1,.22]];
const rooms = new Map();
const now = () => Date.now();
const center = n => n * CELL + CELL / 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function publicPlayer(p) { return { id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp,ammo:p.ammo,reserve:p.reserve,score:p.score,kills:p.kills,dead:p.dead,reloading:p.reloadUntil > now(),invuln:p.invulnUntil > now(),power:p.powerUntil > now(),egg:p.eggUntil > now()?p.egg:null,eggUntil:p.eggUntil,character:p.character }; }
function newCode() { let code; do { const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code=Array.from({length:6},()=>letters[randomInt(letters.length)]).join(''); } while (rooms.has(code)); return code; }
function pickups() { const items=[]; let id=0; for(let z=1;z<MAP.length-1;z++) for(let x=1;x<MAP[0].length-1;x++) if(MAP[z][x]!== '#') items.push({id:id++,x:center(x),z:center(z),type:(x===1||x===15)&&(z===1||z===15)?'power':'pellet'}); return items; }
function makeRoom(mode, host) { const room={code:newCode(),mode,host,phase:'lobby',wave:0,players:new Map(),enemies:[],pickups:pickups(),nextEnemyId:0,nextWaveAt:0,score:0,winner:null,eggSerial:0}; rooms.set(room.code,room); return room; }
function spawn(room,p) { const spots=[[25.5,28.5],[22.5,28.5],[28.5,28.5],[25.5,25.5]]; const [x,z]=spots[[...room.players.keys()].indexOf(p.id)%spots.length]||spots[0]; Object.assign(p,{x,z,yaw:0,pitch:0,hp:100,ammo:MAX_AMMO,reserve:0,score:0,kills:0,dead:false,reloadUntil:0,invulnUntil:now()+1500,powerUntil:0,egg:null,eggUntil:0,lastShotAt:0,lastMoveAt:now()}); }
function nextWave(room){ room.wave++; if(room.wave>GHOSTS_PER_WAVE.length){ room.phase='finished';room.winner='coop';return; } room.enemies=[]; room.pickups=pickups(); addEggs(room); const candidates=[];for(let z=1;z<16;z++)for(let x=1;x<16;x++)if(MAP[z][x]!== '#'){const px=center(x),pz=center(z);if([...room.players.values()].every(p=>Math.hypot(p.x-px,p.z-pz)>9))candidates.push([px,pz]);} for(let i=0;i<GHOSTS_PER_WAVE[room.wave-1];i++){const s=candidates[randomInt(Math.max(1,candidates.length))]||[4.5,4.5];room.enemies.push({id:room.nextEnemyId++,x:s[0],z:s[1],hp:room.wave>3?3:2,color:COLORS[i%4],phase:Math.random()*6,hit:0});} for(const p of room.players.values()){p.hp=Math.min(100,p.hp+(room.wave>1?15:0));p.reloadUntil=0;} room.nextWaveAt=0; }
function addEggs(room){for(let i=0;i<EGG_KINDS.length;i++){const [x,z]=EGG_POSITIONS[i];if(passable(x,z,.4))room.pickups.push({id:100000+room.eggSerial++,x,z,type:'egg',kind:EGG_KINDS[i]});}}
function snapshot(room) { return {code:room.code,mode:room.mode,host:room.host,phase:room.phase,wave:room.wave,totalWaves:GHOSTS_PER_WAVE.length,players:[...room.players.values()].map(publicPlayer),enemies:room.enemies,pickups:room.pickups,score:room.score,winner:room.winner}; }
function broadcast(room){io.to(room.code).emit('snapshot',snapshot(room));}
function acceptName(n){return String(n||'PLAYER').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,16)||'PLAYER';}
function join(socket,room,name){ if(!room || room.players.size>=MAX_PLAYERS||room.phase!=='lobby')return false; const p={id:socket.id,name:acceptName(name),character:room.players.size%4};room.players.set(socket.id,p);spawn(room,p);socket.join(room.code);socket.data.code=room.code;socket.emit('joined',{code:room.code,id:socket.id});broadcast(room);return true; }
function leave(socket){const room=rooms.get(socket.data.code);if(!room)return;room.players.delete(socket.id);socket.leave(room.code);delete socket.data.code;if(!room.players.size){rooms.delete(room.code);return;}if(room.host===socket.id)room.host=room.players.keys().next().value;broadcast(room);}
function fire(room,p){const time=now(); if(room.phase!=='playing'||p.dead)return;if(p.ammo<=0){io.to(p.id).emit('notice',p.reserve>0?'EMPTY MAGAZINE · PRESS R TO RELOAD':'OUT OF AMMO · COLLECT YELLOW PELLETS');return;}if(p.reloadUntil>time||time-p.lastShotAt<(p.eggUntil>time&&p.egg==='rifle'?75:p.eggUntil>time&&p.egg==='frenzy'?95:p.powerUntil>time?100:210))return; p.lastShotAt=time;p.ammo--;const d=[Math.sin(p.yaw)*Math.cos(p.pitch),Math.sin(p.pitch),-Math.cos(p.yaw)*Math.cos(p.pitch)];const o=[p.x,1.12,p.z];let dist=wallRay(o,d),target=null;const entities=room.mode==='coop'?room.enemies:[...room.players.values()].filter(t=>t.id!==p.id&&!t.dead);for(const e of entities){const hitDist=raySphere(o,d,[e.x,1.12,e.z],.60);if(hitDist<dist){dist=hitDist;target=e;}}if(target){ if(room.mode==='coop'){target.hp-=(p.powerUntil>time||p.eggUntil>time&&p.egg==='banana')?2:1;target.hit=.12;if(target.hp<=0){p.kills++;p.score+=100;room.score+=100;room.enemies=room.enemies.filter(e=>e.hp>0);if(p.kills%4===0)room.pickups.push({id:room.nextEnemyId+10000+p.kills,x:target.x,z:target.z,type:'health'});if(!room.enemies.length)room.nextWaveAt=time+3200;}}else{if(target.invulnUntil<=time){target.hp=Math.max(0,target.hp-((p.powerUntil>time||p.eggUntil>time&&p.egg==='banana')?40:25));target.invulnUntil=time+300;if(target.hp===0){target.dead=true;p.kills++;p.score+=100;const living=[...room.players.values()].filter(q=>!q.dead);if(living.length<=1){room.phase='finished';room.winner=living[0]?.id||p.id;}}}}}io.to(room.code).emit('shot',{id:p.id,x:o[0],z:o[2],hit:!!target,tx:o[0]+d[0]*Math.min(dist,55),tz:o[2]+d[2]*Math.min(dist,55),projectile:p.eggUntil>time&&(p.egg==='banana'||p.egg==='poop')?p.egg:'bullet'});}
io.on('connection',socket=>{
 socket.on('createRoom',(data,cb)=>{if(socket.data.code)return cb?.({error:'Already in a room'});const mode=data?.mode==='pvp'?'pvp':'coop';const room=makeRoom(mode,socket.id);join(socket,room,data?.name);cb?.({code:room.code});});
 socket.on('joinRoom',(data,cb)=>{if(socket.data.code)return cb?.({error:'Already in a room'});const room=rooms.get(String(data?.code||'').trim().toUpperCase());if(!room)return cb?.({error:'Room not found'});if(room.phase!=='lobby')return cb?.({error:'Game already started'});if(room.players.size>=MAX_PLAYERS)return cb?.({error:'Room full (4 players)'});join(socket,room,data?.name);cb?.({code:room.code});});
 socket.on('startGame',()=>{const room=rooms.get(socket.data.code);if(!room||room.host!==socket.id||room.phase!=='lobby')return;room.phase='playing';for(const p of room.players.values())spawn(room,p);room.pickups=pickups();if(room.mode==='coop')nextWave(room);else addEggs(room);broadcast(room);});
 socket.on('move',input=>{const room=rooms.get(socket.data.code),p=room?.players.get(socket.id);if(!p||room.phase!=='playing'||p.dead||!input)return;const x=Number(input.x),z=Number(input.z),yaw=Number(input.yaw),pitch=Number(input.pitch);if(![x,z,yaw,pitch].every(Number.isFinite))return;const time=now(),dt=clamp((time-p.lastMoveAt)/1000,.01,.25);p.lastMoveAt=time;const distance=Math.hypot(x-p.x,z-p.z);if(distance>Math.max(.5,(p.eggUntil>time&&p.egg==='frenzy'?15:9)*dt))return;if(!passable(x,z,.25))return;Object.assign(p,{x,z,yaw:clamp(yaw,-1e6,1e6),pitch:clamp(pitch,-.9,.9)});});
 socket.on('shoot',()=>{const room=rooms.get(socket.data.code),p=room?.players.get(socket.id);if(p)fire(room,p);});
 socket.on('reload',()=>{const room=rooms.get(socket.data.code),p=room?.players.get(socket.id);if(!p||room.phase!=='playing'||p.dead||p.reloadUntil>now()||p.ammo>=MAX_AMMO)return;if(p.reserve<=0){io.to(socket.id).emit('notice','NO RESERVE AMMO · COLLECT YELLOW PELLETS');return;}p.reloadUntil=now()+(p.eggUntil>now()&&p.egg==='frenzy'?Math.round(RELOAD_MS*.35):RELOAD_MS);});
 socket.on('disconnect',()=>leave(socket));
});
let lastTick=now();setInterval(()=>{const time=now(),dt=clamp((time-lastTick)/1000,0,.1);lastTick=time;for(const room of rooms.values()){if(room.phase==='playing'){
 for(const p of room.players.values()) {if(p.egg&&p.eggUntil<=time){p.egg=null;p.eggUntil=0;}if(p.reloadUntil&&p.reloadUntil<=time){const n=Math.min(MAX_AMMO-p.ammo,p.reserve);p.ammo+=n;p.reserve-=n;p.reloadUntil=0;}if(!p.dead){for(let i=room.pickups.length-1;i>=0;i--){const item=room.pickups[i];if(Math.hypot(p.x-item.x,p.z-item.z)<.65){room.pickups.splice(i,1);if(item.type==='pellet'){p.reserve++;p.score+=10;room.score+=10;}else if(item.type==='power'){p.powerUntil=time+12000;p.score+=100;}else if(item.type==='egg'){p.egg=item.kind;p.eggUntil=time+EGG_DURATION_MS;io.to(p.id).emit('notice','EASTER EGG: '+item.kind.toUpperCase()+' · 15 SECONDS');}else p.hp=Math.min(100,p.hp+30);}}}}
 if(room.mode==='coop'){
 const living=[...room.players.values()].filter(p=>!p.dead);if(!living.length){room.phase='finished';room.winner='ghosts';}
 for(const e of room.enemies){const target=living.reduce((best,p)=>!best||Math.hypot(p.x-e.x,p.z-e.z)<Math.hypot(best.x-e.x,best.z-e.z)?p:best,null);if(!target)continue;const field=fieldFrom(Math.floor(target.x/CELL),Math.floor(target.z/CELL));const ex=Math.floor(e.x/CELL),ez=Math.floor(e.z/CELL);let next=[target.x,target.z],best=field[ez]?.[ex]??999;for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const v=field[ez+dz]?.[ex+dx]??999;if(v<best){best=v;next=[center(ex+dx),center(ez+dz)];}}const distance=Math.hypot(next[0]-e.x,next[1]-e.z);if(distance>.05){const speed=1.1+room.wave*.14;const dx=(next[0]-e.x)/distance*speed*dt,dz=(next[1]-e.z)/distance*speed*dt;if(passable(e.x+dx,e.z,.34))e.x+=dx;if(passable(e.x,e.z+dz,.34))e.z+=dz;}if(Math.hypot(e.x-target.x,e.z-target.z)<.85&&target.invulnUntil<time){target.hp=Math.max(0,target.hp-12);target.invulnUntil=time+750;if(!target.hp)target.dead=true;}}
 if(room.nextWaveAt&&time>=room.nextWaveAt&&room.phase==='playing')nextWave(room);
 }
 }broadcast(room);}},100);
server.listen(PORT,'0.0.0.0',()=>console.log('CHOMP multiplayer listening on '+PORT));
