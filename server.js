
'use strict';

const express = require('express');
const { createServer } = require('node:http');
const { randomInt } = require('node:crypto');
const path = require('node:path');
const { Server } = require('socket.io');

const {
    MAP,
    CELL,
    passable,
    wallRay,
    raySphere,
    fieldFrom
} = require('./shared');

const app = express();

// Serve only the browser files, not server source code.
for (const filename of [
    'index.html',
    'style.css',
    'engine.js',
    'game.js'
]) {
    app.get('/' + filename, (_req, res) => {
        res.sendFile(path.join(__dirname, filename));
    });
}

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
});

const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10000 });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;

// Customize your five co-op waves here.
const GHOSTS_PER_WAVE = [8, 15, 27, 40, 75];

const MAX_AMMO = 18;
const RELOAD_MS = 1350;

const EGG_KINDS = ['rifle', 'frenzy', 'banana', 'poop'];
const EGG_DURATION_MS = 15000;

const EGG_POSITIONS = [
    [4.5, 4.5],
    [46.5, 4.5],
    [4.5, 46.5],
    [46.5, 46.5]
];

const COLORS = [
    [0.95, 0.14, 0.48],
    [0.08, 0.69, 0.86],
    [0.64, 0.26, 1],
    [0.92, 1, 0.22]
];

const TICK_MS = 200;

const rooms = new Map();

const now = () => Date.now();
const center = n => n * CELL + CELL / 2;
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

function distanceSquared(ax, az, bx, bz) {
    return (ax - bx) ** 2 + (az - bz) ** 2;
}

function publicPlayer(p) {
    const time = now();

    return {
        id: p.id,
        name: p.name,
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        hp: p.hp,
        ammo: p.ammo,
        reserve: p.reserve,
        score: p.score,
        kills: p.kills,
        dead: p.dead,
        reloading: p.reloadUntil > time,
        invuln: p.invulnUntil > time,
        power: p.powerUntil > time,
        egg: p.eggUntil > time ? p.egg : null,
        eggUntil: p.eggUntil,
        character: p.character
    };
}

function newCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;

    do {
        code = Array.from(
            { length: 6 },
            () => letters[randomInt(letters.length)]
        ).join('');
    } while (rooms.has(code));

    return code;
}

function pickups() {
    const items = [];
    let id = 0;

    for (let z = 1; z < MAP.length - 1; z++) {
        for (let x = 1; x < MAP[z].length - 1; x++) {
            if (MAP[z][x] === '#') continue;

            const corner =
                (x === 1 || x === 15) &&
                (z === 1 || z === 15);

            items.push({
                id: id++,
                x: center(x),
                z: center(z),
                type: corner ? 'power' : 'pellet'
            });
        }
    }

    return items;
}

function makeRoom(mode, host) {
    const room = {
        code: newCode(),
        mode,
        host,
        phase: 'lobby',
        wave: 0,
        players: new Map(),
        enemies: [],
        pickups: pickups(),
        nextEnemyId: 0,
        nextWaveAt: 0,
        score: 0,
        winner: null,
        eggSerial: 0
    };

    rooms.set(room.code, room);
    return room;
}

function spawn(room, p) {
    const spots = [
        [25.5, 28.5],
        [22.5, 28.5],
        [28.5, 28.5],
        [25.5, 25.5]
    ];

    const index = [...room.players.keys()].indexOf(p.id);
    const [x, z] = spots[index % spots.length] || spots[0];
    const time = now();

    Object.assign(p, {
        x,
        z,
        yaw: 0,
        pitch: 0,
        hp: 100,
        ammo: MAX_AMMO,
        reserve: 0,
        score: 0,
        kills: 0,
        dead: false,
        reloadUntil: 0,
        invulnUntil: time + 1500,
        powerUntil: 0,
        egg: null,
        eggUntil: 0,
        lastShotAt: 0,
        lastMoveAt: time,
        lastMoveSeq: 0
    });
}

function addEggs(room) {
    for (let i = 0; i < EGG_KINDS.length; i++) {
        const [x, z] = EGG_POSITIONS[i];

        if (!passable(x, z, 0.4)) continue;

        room.pickups.push({
            id: 100000 + room.eggSerial++,
            x,
            z,
            type: 'egg',
            kind: EGG_KINDS[i]
        });
    }
}

function nextWave(room) {
    room.wave++;

    if (room.wave > GHOSTS_PER_WAVE.length) {
        room.phase = 'finished';
        room.winner = 'coop';
        return;
    }

    room.enemies = [];

    // Bring back all pellets at the beginning of each wave.
    room.pickups = pickups();
    addEggs(room);

    const candidates = [];

    for (let z = 1; z < MAP.length - 1; z++) {
        for (let x = 1; x < MAP[z].length - 1; x++) {
            if (MAP[z][x] === '#') continue;

            const px = center(x);
            const pz = center(z);

            const farEnough = [...room.players.values()].every(p =>
                distanceSquared(p.x, p.z, px, pz) > 81
            );

            if (farEnough) candidates.push([px, pz]);
        }
    }

    // Shuffle so ghosts use different spawn locations first.
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [candidates[i], candidates[j]] =
            [candidates[j], candidates[i]];
    }

    const amount = GHOSTS_PER_WAVE[room.wave - 1];

    for (let i = 0; i < amount; i++) {
        const position = candidates.length
            ? candidates[i % candidates.length]
            : [4.5, 4.5];

        room.enemies.push({
            id: room.nextEnemyId++,
            x: position[0],
            z: position[1],
            hp: room.wave > 3 ? 3 : 2,
            color: COLORS[i % COLORS.length],
            phase: Math.random() * 6,
            hit: 0
        });
    }

    for (const p of room.players.values()) {
        p.hp = Math.min(
            100,
            p.hp + (room.wave > 1 ? 15 : 0)
        );

        p.reloadUntil = 0;
    }

    room.nextWaveAt = 0;
}

function snapshot(room) {
    return {
        code: room.code,
        mode: room.mode,
        host: room.host,
        phase: room.phase,
        wave: room.wave,
        totalWaves: GHOSTS_PER_WAVE.length,
        players: [...room.players.values()].map(publicPlayer),
        enemies: room.enemies,
        pickups: room.pickups,
        score: room.score,
        winner: room.winner
    };
}

function broadcast(room) {
    io.to(room.code).emit('snapshot', snapshot(room));
}

function acceptName(name) {
    return String(name || 'PLAYER')
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .trim()
        .slice(0, 16) || 'PLAYER';
}

function join(socket, room, name) {
    if (
        !room ||
        room.players.size >= MAX_PLAYERS ||
        room.phase !== 'lobby'
    ) return false;

    const used = new Set(
        [...room.players.values()].map(p => p.character)
    );

    let character = 0;

    while (character < MAX_PLAYERS && used.has(character)) {
        character++;
    }

    const p = {
        id: socket.id,
        name: acceptName(name),
        character
    };

    room.players.set(socket.id, p);
    spawn(room, p);

    socket.join(room.code);
    socket.data.code = room.code;

    socket.emit('joined', {
        code: room.code,
        id: socket.id
    });

    broadcast(room);
    return true;
}

function leave(socket) {
    const room = rooms.get(socket.data.code);

    if (!room) return;

    room.players.delete(socket.id);
    socket.leave(room.code);
    delete socket.data.code;

    if (!room.players.size) {
        rooms.delete(room.code);
        return;
    }

    if (room.host === socket.id) {
        room.host = room.players.keys().next().value;
    }

    broadcast(room);
}

// Movement follows the same collision rules as the client.
// A packet represents a short endpoint movement,
// so test both legal axis orders.

function axisPathClear(x1, z1, x2, z2, xFirst) {
    const step = 0.12;
    const r = 0.25;

    const path = xFirst
        ? [[x1, z1, x2, z1], [x2, z1, x2, z2]]
        : [[x1, z1, x1, z2], [x1, z2, x2, z2]];

    for (const [a, b, c, d] of path) {
        const n = Math.max(
            1,
            Math.ceil(Math.hypot(c - a, d - b) / step)
        );

        for (let i = 1; i <= n; i++) {
            const t = i / n;

            if (!passable(
                a + (c - a) * t,
                b + (d - b) * t,
                r
            )) {
                return false;
            }
        }
    }

    return true;
}

function movementPathClear(x1, z1, x2, z2) {
    if (!passable(x2, z2, 0.25)) return false;

    return axisPathClear(x1, z1, x2, z2, true) ||
        axisPathClear(x1, z1, x2, z2, false);
}

// Validate movement and tell the browser which update
// was accepted or rejected.
function receiveMovement(room, p, input, socket) {
    if (!input || typeof input !== 'object') return;

    const x = Number(input.x);
    const z = Number(input.z);
    const yaw = Number(input.yaw);
    const pitch = Number(input.pitch);
    const seq = Number(input.seq);

    if (
        ![x, z, yaw, pitch].every(Number.isFinite) ||
        !Number.isSafeInteger(seq) ||
        seq <= p.lastMoveSeq
    ) return;

    p.lastMoveSeq = seq;
    p.yaw = clamp(yaw, -1e6, 1e6);
    p.pitch = clamp(pitch, -0.9, 0.9);

    const time = now();
    const frenzy = p.egg === 'frenzy' && p.eggUntil > time;
    const maximumSpeed = 7 * (frenzy ? 1.65 : 1);

    const elapsed = clamp(
        (time - p.lastMoveAt) / 1000,
        0,
        0.5
    );

    const allowedDistance =
        0.35 + maximumSpeed * elapsed * 1.35;

    const distance = Math.hypot(x - p.x, z - p.z);

    const accepted =
        distance <= allowedDistance &&
        movementPathClear(p.x, p.z, x, z);

    if (accepted) {
        const oldX = p.x;
        const oldZ = p.z;

        p.x = x;
        p.z = z;
        p.lastMoveAt = time;

        // Check pellets along accepted sprint movement.
        collectPickups(room, p, time, oldX, oldZ);
    }

    socket.emit('moveAck', {
        seq,
        x: p.x,
        z: p.z,
        accepted
    });
}

function fire(room, p) {
    const time = now();

    if (room.phase !== 'playing' || p.dead) return;

    if (p.ammo <= 0) {
        io.to(p.id).emit(
            'notice',
            p.reserve > 0
                ? 'ELIPSEN MANA MOU · TSILLA R'
                : 'EEE ELIPSAN OULES · SOROPSE JITRINOUKIA'
        );
        return;
    }

    const eggActive = p.eggUntil > time;
    let delay = 210;

    if (eggActive && p.egg === 'rifle') {
        delay = 75;
    } else if (eggActive && p.egg === 'frenzy') {
        delay = 95;
    } else if (p.powerUntil > time) {
        delay = 100;
    }

    if (p.reloadUntil > time || time - p.lastShotAt < delay) {
        return;
    }

    p.lastShotAt = time;
    p.ammo--;

    const direction = [
        Math.sin(p.yaw) * Math.cos(p.pitch),
        Math.sin(p.pitch),
        -Math.cos(p.yaw) * Math.cos(p.pitch)
    ];

    const origin = [p.x, 1.12, p.z];

    let distance = wallRay(origin, direction);
    let target = null;

    const targets = room.mode === 'coop'
        ? room.enemies
        : [...room.players.values()].filter(
            other => other.id !== p.id && !other.dead
        );

    for (const entity of targets) {
        const hitDistance = raySphere(
            origin,
            direction,
            [entity.x, 1.12, entity.z],
            0.6
        );

        if (hitDistance < distance) {
            distance = hitDistance;
            target = entity;
        }
    }

    if (target) {
        const enhanced =
            p.powerUntil > time ||
            (eggActive && p.egg === 'banana');

        if (room.mode === 'coop') {
            target.hp -= enhanced ? 2 : 1;
            target.hit = 0.12;

            if (target.hp <= 0) {
                p.kills++;
                p.score += 100;
                room.score += 100;

                room.enemies = room.enemies.filter(
                    e => e.hp > 0
                );

                if (p.kills % 4 === 0) {
                    room.pickups.push({
                        id: room.nextEnemyId + 10000 + p.kills,
                        x: target.x,
                        z: target.z,
                        type: 'health'
                    });
                }

                if (!room.enemies.length) {
                    room.nextWaveAt = time + 3200;
                }
            }
        } else if (target.invulnUntil <= time) {
            target.hp = Math.max(
                0,
                target.hp - (enhanced ? 40 : 25)
            );

            target.invulnUntil = time + 300;

            if (target.hp === 0) {
                target.dead = true;
                p.kills++;
                p.score += 100;

                const living = [...room.players.values()]
                    .filter(player => !player.dead);

                if (living.length <= 1) {
                    room.phase = 'finished';
                    room.winner = living[0]?.id || p.id;
                }
            }
        }
    }

    io.to(room.code).emit('shot', {
        id: p.id,
        x: origin[0],
        z: origin[2],
        hit: !!target,
        tx: origin[0] +
            direction[0] * Math.min(distance, 55),
        tz: origin[2] +
            direction[2] * Math.min(distance, 55),
        projectile:
            eggActive && ['banana', 'poop'].includes(p.egg)
                ? p.egg
                : 'bullet'
    });
}

function collectPickups(
    room,
    p,
    time,
    oldX = p.x,
    oldZ = p.z
) {
    if (p.dead) return;

    // Collect pellets crossed between movement updates,
    // rather than checking only the final position.
    const dx = p.x - oldX;
    const dz = p.z - oldZ;
    const len2 = dx * dx + dz * dz;

    for (let i = room.pickups.length - 1; i >= 0; i--) {
        const item = room.pickups[i];

        const t = len2 > 0
            ? clamp(
                (
                    (item.x - oldX) * dx +
                    (item.z - oldZ) * dz
                ) / len2,
                0,
                1
            )
            : 0;

        const nx = oldX + t * dx;
        const nz = oldZ + t * dz;

        if (
            distanceSquared(
                nx,
                nz,
                item.x,
                item.z
            ) >= 0.65 * 0.65
        ) continue;

        room.pickups.splice(i, 1);

        if (item.type === 'pellet') {
            p.reserve++;
            p.score += 10;
            room.score += 10;

        } else if (item.type === 'power') {
            p.powerUntil = time + 12000;
            p.score += 100;

        } else if (item.type === 'egg') {
            p.egg = item.kind;
            p.eggUntil = time + EGG_DURATION_MS;

            io.to(p.id).emit(
                'notice',
                `EASTER EGG: ${item.kind.toUpperCase()} · 15 SECONDS`
            );

        } else if (item.type === 'health') {
            p.hp = Math.min(100, p.hp + 30);
        }
    }
}

function updateGhosts(room, time, dt) {
    const living = [...room.players.values()]
        .filter(p => !p.dead);

    if (!living.length) {
        room.phase = 'finished';
        room.winner = 'ghosts';
        return;
    }

    // Share maze pathfinding among ghosts chasing
    // the same player tile during this tick.
    const pathCache = new Map();

    for (const e of room.enemies) {
        let target = null;
        let closest = Infinity;

        for (const p of living) {
            const d = distanceSquared(
                p.x,
                p.z,
                e.x,
                e.z
            );

            if (d < closest) {
                closest = d;
                target = p;
            }
        }

        if (!target) continue;

        const tileX = Math.floor(target.x / CELL);
        const tileZ = Math.floor(target.z / CELL);
        const key = tileX + ',' + tileZ;

        let field = pathCache.get(key);

        if (!field) {
            field = fieldFrom(tileX, tileZ);
            pathCache.set(key, field);
        }

        const ex = Math.floor(e.x / CELL);
        const ez = Math.floor(e.z / CELL);

        let next = [target.x, target.z];
        let best = field[ez]?.[ex] ?? 999;

        for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
        ]) {
            const value =
                field[ez + dz]?.[ex + dx] ?? 999;

            if (value < best) {
                best = value;
                next = [
                    center(ex + dx),
                    center(ez + dz)
                ];
            }
        }

        const distance = Math.hypot(
            next[0] - e.x,
            next[1] - e.z
        );

        if (distance > 0.05) {
            const speed = 1.1 + room.wave * 0.14;

            const dx =
                (next[0] - e.x) /
                distance * speed * dt;

            const dz =
                (next[1] - e.z) /
                distance * speed * dt;

            if (passable(e.x + dx, e.z, 0.34)) {
                e.x += dx;
            }

            if (passable(e.x, e.z + dz, 0.34)) {
                e.z += dz;
            }
        }

        const playerDistance = Math.hypot(
            target.x - e.x,
            target.z - e.z
        );

        const direction = [
            (target.x - e.x) /
                Math.max(0.001, playerDistance),
            0,
            (target.z - e.z) /
                Math.max(0.001, playerDistance)
        ];

        // Ghosts damage players only at close range,
        // with an unobstructed path between them.
        if (
            playerDistance < 0.70 &&
            !target.dead &&
            target.invulnUntil < time &&
            wallRay(
                [e.x, 1.12, e.z],
                direction,
                playerDistance
            ) >= playerDistance
        ) {
            target.hp = Math.max(
                0,
                target.hp - 12
            );

            target.invulnUntil = time + 750;

            if (target.hp === 0) {
                target.dead = true;
            }
        }
    }
}

io.on('connection', socket => {
    socket.on('createRoom', (data, callback) => {
        if (socket.data.code) {
            callback?.({ error: 'Already in a room' });
            return;
        }

        const mode = data?.mode === 'pvp'
            ? 'pvp'
            : 'coop';

        const room = makeRoom(mode, socket.id);

        join(socket, room, data?.name);
        callback?.({ code: room.code });
    });

    socket.on('joinRoom', (data, callback) => {
        if (socket.data.code) {
            callback?.({ error: 'Already in a room' });
            return;
        }

        const code = String(data?.code || '')
            .trim()
            .toUpperCase();

        const room = rooms.get(code);

        if (!room) {
            callback?.({ error: 'Room not found' });
            return;
        }

        if (room.phase !== 'lobby') {
            callback?.({ error: 'Game already started' });
            return;
        }

        if (room.players.size >= MAX_PLAYERS) {
            callback?.({
                error: 'Room full (4 players)'
            });
            return;
        }

        join(socket, room, data?.name);
        callback?.({ code: room.code });
    });

    socket.on('startGame', () => {
        const room = rooms.get(socket.data.code);

        if (
            !room ||
            room.host !== socket.id ||
            room.phase !== 'lobby'
        ) return;

        room.phase = 'playing';

        for (const p of room.players.values()) {
            spawn(room, p);
        }

        room.pickups = pickups();

        if (room.mode === 'coop') {
            nextWave(room);
        } else {
            addEggs(room);
        }

        broadcast(room);
    });

    socket.on('move', input => {
        const room = rooms.get(socket.data.code);
        const p = room?.players.get(socket.id);

        if (
            !p ||
            room.phase !== 'playing' ||
            p.dead
        ) return;

        receiveMovement(room, p, input, socket);
    });

    socket.on('shoot', () => {
        const room = rooms.get(socket.data.code);
        const p = room?.players.get(socket.id);

        if (p) {
            fire(room, p);
        }
    });

    socket.on('reload', () => {
        const room = rooms.get(socket.data.code);
        const p = room?.players.get(socket.id);
        const time = now();

        if (
            !p ||
            room.phase !== 'playing' ||
            p.dead ||
            p.reloadUntil > time ||
            p.ammo >= MAX_AMMO
        ) return;

        if (p.reserve <= 0) {
            io.to(socket.id).emit(
                'notice',
                'ELIPSAN OULLES MANA MOU · SOROPSE JITRINOUKIA'
            );
            return;
        }

        const frenzy =
            p.egg === 'frenzy' &&
            p.eggUntil > time;

        p.reloadUntil = time + (
            frenzy
                ? Math.round(RELOAD_MS * 0.35)
                : RELOAD_MS
        );
    });

    socket.on('disconnect', () => {
        leave(socket);
    });
});

// Main server simulation loop.
let lastTick = now();

setInterval(() => {
    const time = now();

    const dt = clamp(
        (time - lastTick) / 1000,
        0,
        0.1
    );

    lastTick = time;

    for (const room of rooms.values()) {
        if (room.phase === 'playing') {
            for (const p of room.players.values()) {
                if (p.egg && p.eggUntil <= time) {
                    p.egg = null;
                    p.eggUntil = 0;
                }

                // Reloading only finishes
                // after R was pressed.
                if (
                    p.reloadUntil &&
                    p.reloadUntil <= time
                ) {
                    const bullets = Math.min(
                        MAX_AMMO - p.ammo,
                        p.reserve
                    );

                    p.ammo += bullets;
                    p.reserve -= bullets;
                    p.reloadUntil = 0;
                }

                collectPickups(room, p, time);
            }

            if (room.mode === 'coop') {
                updateGhosts(room, time, dt);

                if (
                    room.nextWaveAt &&
                    time >= room.nextWaveAt &&
                    room.phase === 'playing'
                ) {
                    nextWave(room);
                }
            }
        }

        // Keep the snapshot format
        // expected by game.js.
        broadcast(room);
    }
}, TICK_MS);

server.listen(PORT, '0.0.0.0', () => {
    console.log(
        'CHOMP multiplayer listening on ' + PORT
    );
});
