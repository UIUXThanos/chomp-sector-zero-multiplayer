'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MAP,passable,wallRay,fieldFrom}=require('../shared');
test('map has 17 rows and 17 columns',()=>{assert.equal(MAP.length,17);assert.ok(MAP.every(r=>r.length===17));});
test('starting location and spawn cells are open',()=>{for(const [x,z] of [[25.5,28.5],[22.5,28.5],[28.5,28.5],[25.5,25.5]])assert.equal(passable(x,z),true,`${x},${z}`);});
test('walls block a player and bullets',()=>{assert.equal(passable(1.5,1.5),false);assert.ok(wallRay([25.5,1.12,28.5],[0,0,-1])>0);});
test('ghost distance field starts at zero',()=>{const f=fieldFrom(8,9);assert.equal(f[9][8],0);});
