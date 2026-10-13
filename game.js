'use strict';

// CHOMP multiplayer client: the server owns ghosts, pellets, HP, ammo and scoring.

const CELL = 3;

const MAP = [
    '#################',
    '#.......#.......#',
    '#.##.##.#.##.##.#',
    '#...............#',
    '#.##.#.###.#.##.#',
    '#....#.....#....#',
    '###.###.#.###.###',
    '#.......#.......#',
    '#.##.#.....#.##.#',
    '#....#.....#....#',
    '#.##.#.###.#.##.#',
    '#.......#.......#',
    '###.##..#..##.###',
    '#...............#',
    '#.##.##.#.##.##.#',
    '#.......#.......#',
    '#################'
];

const C = {
    yellow: [0.92, 1, 0.22],
    cyan: [0.08, 0.69, 0.86],
    pink: [0.95, 0.14, 0.48],
    white: [0.76, 0.93, 1]
};

const $ = s => document.querySelector(s);

const wall = (x, z) =>
    !MAP[z] ||
    MAP[z][x] === undefined ||
    MAP[z][x] === '#';

function passable(x, z, r = 0.25) {
    for (
        let j = Math.floor((z - r) / CELL);
        j <= Math.floor((z + r) / CELL);
        j++
    ) {
        for (
            let i = Math.floor((x - r) / CELL);
            i <= Math.floor((x + r) / CELL);
            i++
        ) {
            if (wall(i, j)) {
                const a = Math.max(
                    i * CELL,
                    Math.min(x, (i + 1) * CELL)
                );

                const b = Math.max(
                    j * CELL,
                    Math.min(z, (j + 1) * CELL)
                );

                if (Math.hypot(x - a, z - b) < r) {
                    return false;
                }
            }
        }
    }

    return true;
}

let renderer;

try {
    renderer = new Renderer($('#world'));
} catch (e) {
    $('#fallback').hidden = false;
    console.error(e);
}

if (renderer) {
    boot();
}

function boot() {
    const socket = io();

    let room = null;
    let myId = null;
    let joined = false;
    let started = false;
    let paused = false;
    let keys = {};
    let clock = 0;
    let last = performance.now();
    let sendAt = 0;
    let mouseSensitivity = 1;
    let shotFlash = 0;
    let walking = 0;
    let noticeUntil = 0;
    let lastEmptyWarn = 0;
    let projectiles = [];
    let terminalShown = false;

    let me = {
        x: 25.5,
        z: 28.5,
        yaw: 0,
        pitch: 0,
        hp: 100,
        ammo: 18,
        reserve: 0,
        score: 0,
        kills: 0,
        dead: false
    };

    let nextMinimapAt = 0;

    // The minimap does not need a full redraw at display refresh rate.

    const input = document.createElement('div');

    input.id = 'multiplayer-lobby';

    input.innerHTML = `
        <h2>MULTIPLAYER</h2>
        <p>
            CHARACTERS: BATMAN / JOKER / WOLVERINE / GHOST RIDER
            (4 SLOTS)
        </p>

        <label>
            YOUR NAME
            <input id="mp-name" maxlength="16" value="PLAYER" />
        </label>

        <label>
            GAME MODE
            <select id="mp-mode">
                <option value="coop">CO-OP SURVIVAL</option>
                <option value="pvp">PVP ARENA</option>
            </select>
        </label>

        <button id="mp-create">CREATE PRIVATE ROOM</button>

        <label>
            INVITE CODE
            <input id="mp-code" maxlength="6" placeholder="ABC123" />
        </label>

        <button id="mp-join">JOIN ROOM</button>

        <p id="mp-status">
            Connect to create or join a private room.
        </p>

        <p id="mp-players"></p>

        <button id="mp-start" hidden>
            START MATCH (HOST)
        </button>
    `;

    document.body.append(input);

    const $mp = s => input.querySelector(s);

    const status = t => {
        $mp('#mp-status').textContent = t;
    };

    function notify(t, seconds = 2) {
        $('#notification').textContent = t;
        noticeUntil = performance.now() + seconds * 1000;
    }

    socket.on('connect', () => {
        status('Connected. Create a room or enter an invite code.');
    });

    socket.on('disconnect', () => {
        status('Disconnected. Refresh to reconnect.');
        started = false;
    });

    socket.on('joined', data => {
        joined = true;
        myId = data.id;

        status('ROOM ' + data.code + ' · Share this invite code');

        $mp('#mp-code').value = data.code;
    });

    socket.on('snapshot', s => {
        room = s;

        const p = s.players.find(p => p.id === myId);

        if (p) {
            me = { ...me, ...p };
        }

        if (s.phase === 'lobby') {
            $mp('#mp-players').textContent =
                `${s.players.length}/4 players: ${
                    s.players.map(p => p.name).join(', ')
                }`;

            $mp('#mp-start').hidden = s.host !== myId;
            input.hidden = false;

        } else if (s.phase === 'playing') {
            if (!started) {
                started = true;
                paused = false;
                terminalShown = false;

                input.hidden = true;
                $('#landing').hidden = true;
                $('#hud').hidden = false;
                $('#end').hidden = true;

                document.body.classList.add('playing');

                requestCapture();
            }

            if (p?.dead && !terminalShown) {
                notify('YOU ARE ELIMINATED · SPECTATING', 3);
            }

        } else if (
            s.phase === 'finished' &&
            !terminalShown
        ) {
            terminalShown = true;
            started = false;
            input.hidden = true;
            $('#end').hidden = false;

            $('#end-kicker').textContent =
                s.winner === 'coop'
                    ? 'SECTOR SECURED'
                    : 'MATCH FINISHED';

            $('#end-title').textContent =
                s.mode === 'coop'
                    ? 'GAME OVER'
                    : 'PVP OVER';

            $('#end-copy').textContent =
                s.winner === 'coop'
                    ? 'All ghost waves cleared!'
                    : s.winner === 'ghosts'
                        ? 'The ghosts won.'
                        : `${
                            s.players.find(p => p.id === s.winner)?.name
                            || 'A PLAYER'
                        } WON`;

            $('#final-score').textContent = p?.score || 0;
            $('#final-kills').textContent = p?.kills || 0;

            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        }

        updateHud();
    });

    socket.on('shot', shot => {
        if (shot.id === myId) {
            shotFlash = 0.09;
        }

        projectiles.push({
            ...shot,
            life: 0.15
        });
    });

    socket.on('notice', text => {
        const t = performance.now();

        if (t - lastEmptyWarn > 1200) {
            notify(text, 2.5);
            lastEmptyWarn = t;
        }
    });

    function send(name, data, cb) {
        if (!socket.connected) {
            return status('Not connected yet');
        }

        socket.emit(name, data, cb);
    }

    $mp('#mp-create').onclick = () => {
        send(
            'createRoom',
            {
                mode: $mp('#mp-mode').value,
                name: $mp('#mp-name').value
            },
            r => {
                if (r?.error) {
                    status(r.error);
                }
            }
        );
    };

    $mp('#mp-join').onclick = () => {
        send(
            'joinRoom',
            {
                code: $mp('#mp-code').value,
                name: $mp('#mp-name').value
            },
            r => {
                if (r?.error) {
                    status(r.error);
                }
            }
        );
    };

    $mp('#mp-start').onclick = () => send('startGame');

    // --------------------------------------------------
    // WORLD GEOMETRY
    // --------------------------------------------------

    const geo = new Geometry();
    const neon = new Geometry();
    const ground = new Geometry();

    ground.box(
        25.5, -0.16, 25.5,
        170, 0.3, 170,
        [0.025, 0.043, 0.065]
    );

    for (let z = 0; z < 17; z++) {
        for (let x = 0; x < 17; x++) {
            if (wall(x, z)) {
                const px = (x + 0.5) * CELL;
                const pz = (z + 0.5) * CELL;

                geo.box(
                    px, 1.4, pz,
                    2.99, 2.8, 2.99,
                    [0.075, 0.12, 0.21]
                );

                geo.box(
                    px, 2.83, pz,
                    3.03, 0.09, 3.03,
                    [0.10, 0.20, 0.31]
                );

                neon.box(
                    px, 2.68, pz,
                    3.01, 0.035, 3.01,
                    C.cyan
                );

                neon.box(
                    px, 0.15, pz,
                    3.012, 0.022, 3.012,
                    [0.06, 0.34, 0.56]
                );
            }
        }
    }

    for (let i = -20; i <= 75; i += 3) {
        neon.box(
            i, 0.005, 25.5,
            0.014, 0.008, 110,
            [0.014, 0.12, 0.19]
        );

        neon.box(
            25.5, 0.005, i,
            110, 0.008, 0.014,
            [0.014, 0.12, 0.19]
        );
    }

    const meshes = {
        walls: renderer.mesh(geo),
        neon: renderer.mesh(neon),
        floor: renderer.mesh(ground),

        sphere: renderer.mesh(
            new Geometry().sphere(
                0, 0, 0, 1,
                [1, 1, 1],
                12, 8
            )
        ),

        ghost: renderer.mesh(
            new Geometry().ghost([1, 1, 1])
        ),

        chomp: renderer.mesh(
            new Geometry().chomp(C.yellow)
        ),

        cube: renderer.mesh(
            new Geometry().box(
                0, 0, 0,
                1, 1, 1,
                [1, 1, 1]
            )
        ),

        eye: renderer.mesh(
            new Geometry().sphere(
                0, 0, 0, 1,
                [1, 1, 1],
                10, 7
            )
        )
    };

    const bananaGeo = new Geometry();

    for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.45;

        bananaGeo.sphere(
            Math.sin(a) * 0.19,
            Math.cos(a) * 0.11,
            0,
            0.105 - i * 0.007,
            [1, 0.85, 0.08],
            9, 6
        );
    }

    meshes.banana = renderer.mesh(bananaGeo);

    const poopGeo = new Geometry();

    poopGeo.sphere(
        0, -0.14, 0,
        0.25,
        [0.29, 0.13, 0.055],
        10, 6
    );

    poopGeo.sphere(
        0, 0.02, 0,
        0.18,
        [0.37, 0.18, 0.07],
        10, 6
    );

    poopGeo.sphere(
        0, 0.16, 0,
        0.105,
        [0.44, 0.22, 0.08],
        10, 6
    );

    meshes.poop = renderer.mesh(poopGeo);

    const gun = new Geometry();

    gun.box(
        0, -0.04, 0,
        0.27, 0.25, 0.68,
        [0.14, 0.2, 0.28]
    );

    gun.box(
        0, 0.08, -0.1,
        0.22, 0.1, 0.61,
        [0.32, 0.41, 0.47]
    );

    gun.box(
        0, -0.24, 0.19,
        0.17, 0.34, 0.2,
        [0.08, 0.11, 0.16]
    );

    gun.box(
        0, 0.03, -0.43,
        0.18, 0.19, 0.24,
        [0.12, 0.19, 0.27]
    );

    gun.box(
        0, 0.025, -0.565,
        0.11, 0.1, 0.015,
        [0.01, 0.015, 0.02]
    );

    meshes.gun = renderer.mesh(gun);

    // Local-axis +Z is the front of every face.
    // Two eyes + pupils face the camera/player.

    function face(x, y, z, yaw, scale = 1) {
        const sn = Math.sin(yaw);
        const cs = Math.cos(yaw);

        for (const side of [-1, 1]) {
            for (const [
                offsetY,
                depth,
                radius,
                color
            ] of [
                [0.16, 0.53, 0.14, C.white],
                [0.15, 0.64, 0.063, [0.015, 0.03, 0.06]]
            ]) {
                const ex = side * 0.22 * scale;
                const ez = depth * scale;

                renderer.draw(
                    meshes.eye,
                    [
                        x + ex * cs + ez * sn,
                        y + offsetY * scale,
                        z - ex * sn + ez * cs
                    ],
                    [
                        radius * scale,
                        radius * 1.12 * scale,
                        0.065 * scale
                    ],
                    yaw,
                    0.7,
                    color
                );
            }
        }
    }

    // --------------------------------------------------
    // PLAYER CHARACTERS
    // --------------------------------------------------

    const costumes = [
        {
            body: [0.055, 0.07, 0.12],
            head: [0.09, 0.11, 0.17],
            cape: [0.02, 0.02, 0.04],
            accent: [0.95, 0.80, 0.20]
        }, // blocky bat

        {
            body: [0.29, 0.08, 0.40],
            head: [0.83, 0.88, 0.76],
            cape: [0.30, 0.06, 0.38],
            accent: [0.10, 0.82, 0.28]
        }, // clown

        {
            body: [0.89, 0.72, 0.10],
            head: [0.93, 0.73, 0.23],
            cape: [0.12, 0.16, 0.38],
            accent: [0.12, 0.18, 0.37]
        }, // claw hero

        {
            body: [0.10, 0.12, 0.13],
            head: [0.82, 0.39, 0.11],
            cape: [0.06, 0.06, 0.08],
            accent: [1, 0.32, 0.04]
        } // flaming rider
    ];

    function drawPlayer(p) {
        const skin = costumes[p.character % 4] || costumes[0];
        const x = p.x;
        const z = p.z;
        const yaw = p.yaw;

        const draw = (pos, sz, tint, glow = 0) => {
            renderer.draw(
                meshes.cube,
                pos,
                sz,
                yaw,
                glow,
                tint
            );
        };

        draw([x, 0.9, z], [0.7, 0.75, 0.4], skin.body);
        draw([x, 1.52, z], [0.52, 0.51, 0.52], skin.head);
        draw([x, 0.37, z - 0.09], [0.24, 0.68, 0.30], skin.body);
        draw([x, 1.02, z], [0.95, 0.19, 0.48], skin.accent);
        draw([x, 1.13, z - 0.30], [0.72, 0.9, 0.09], skin.cape);

        const sn = Math.sin(yaw);
        const cs = Math.cos(yaw);

        for (const side of [-1, 1]) {
            const ex = side * 0.33;
            const ez = 0.28;

            renderer.draw(
                meshes.eye,
                [
                    x + ex * cs + ez * sn,
                    1.58,
                    z - ex * sn + ez * cs
                ],
                [0.1, 0.09, 0.05],
                yaw,
                0,
                skin.accent
            );
        }

        if (p.character === 0) {
            for (const side of [-1, 1]) {
                draw(
                    [x + side * 0.18, 1.90, z],
                    [0.15, 0.36, 0.16],
                    skin.head
                );
            }
        }

        if (p.character === 1) {
            draw(
                [x, 1.9, z],
                [0.62, 0.25, 0.57],
                skin.accent
            );
        }

        if (p.character === 2) {
            for (const side of [-1, 1]) {
                draw(
                    [x + side * 0.47, 1.02, z + 0.10],
                    [0.08, 0.34, 0.06],
                    C.white
                );
            }
        }

        if (p.character === 3) {
            for (let i = 0; i < 5; i++) {
                const a = i * 1.257 + clock * 2;

                renderer.draw(
                    meshes.sphere,
                    [
                        x + Math.sin(a) * 0.25,
                        1.98 + Math.sin(clock * 4 + i) * 0.11,
                        z + Math.cos(a) * 0.25
                    ],
                    [0.13, 0.24, 0.13],
                    0,
                    1,
                    [1, 0.24 + i * 0.08, 0.02]
                );
            }
        }
    }

    // --------------------------------------------------
    // HUD
    // --------------------------------------------------

    function updateHud() {
        if (!room) return;

        $('#wave').textContent =
            String(room.wave || 1).padStart(2, '0');

        $('#enemy-count').textContent =
            room.mode === 'coop'
                ? `${room.enemies.length} HOSTILES REMAIN`
                : `${room.players.filter(p => !p.dead).length} PLAYERS ALIVE`;

        $('#score').textContent =
            String(me.score || 0).padStart(6, '0');

        $('#health').textContent = me.hp;
        $('#health-bar').style.width = me.hp + '%';

        $('#ammo').textContent =
            `${String(me.ammo).padStart(2, '0')} / ${
                String(me.reserve).padStart(2, '0')
            }`;

        $('#ammo').style.color =
            me.ammo <= 4 ? '#fb6fab' : '#eef4ef';

        $('#reload-label').textContent =
            me.reloading
                ? 'RELOADING…'
                : me.reserve === 0
                    ? 'EFKEROSES TIN'
                    : 'R  RELOAD';

        $('#power').hidden = !(me.power || me.egg);

        if (me.egg) {
            $('#power').firstChild.textContent =
                me.egg.toUpperCase() + ' ';
        } else {
            $('#power').firstChild.textContent = 'OVERDRIVE ';
        }

        $('#combo').textContent = room.mode.toUpperCase();
    }

    // --------------------------------------------------
    // CAMERA AND MOVEMENT
    // --------------------------------------------------

    function requestCapture() {
        if (!$('#world').requestPointerLock) return;

        try {
            const p = $('#world').requestPointerLock();
            p?.catch?.(() => {});
        } catch {}
    }

    function move(dt) {
        if (!started || paused || me.dead) return;

        const f =
            (keys.KeyW ? 1 : 0) -
            (keys.KeyS ? 1 : 0);

        const s =
            (keys.KeyD || keys.KeyE ? 1 : 0) -
            (keys.KeyA || keys.KeyQ ? 1 : 0);

        const len = Math.hypot(f, s);

        if (len) {
            const speed =
                (keys.ShiftLeft || keys.ShiftRight ? 7 : 4.7) *
                (me.egg === 'frenzy' ? 1.65 : 1);

            const dx =
                (
                    Math.sin(me.yaw) * f +
                    Math.cos(me.yaw) * s
                ) / len * speed * dt;

            const dz =
                (
                    -Math.cos(me.yaw) * f +
                    Math.sin(me.yaw) * s
                ) / len * speed * dt;

            if (passable(me.x + dx, me.z, 0.25)) {
                me.x += dx;
            }

            if (passable(me.x, me.z + dz, 0.25)) {
                me.z += dz;
            }

            walking += dt * 10;
        }

        sendAt -= dt;

        if (sendAt <= 0) {
            sendAt = 0.05;

            socket.emit('move', {
                x: me.x,
                z: me.z,
                yaw: me.yaw,
                pitch: me.pitch
            });
        }
    }

    // --------------------------------------------------
    // RENDERING
    // --------------------------------------------------

    function draw() {
        renderer.clear();

        const forward = [
            Math.sin(me.yaw) * Math.cos(me.pitch),
            Math.sin(me.pitch),
            -Math.cos(me.yaw) * Math.cos(me.pitch)
        ];

        if (started) {
            const eye = [
                me.x,
                1.12 + Math.sin(walking) * 0.025,
                me.z
            ];

            renderer.camera(
                eye,
                eye.map((v, i) => v + forward[i]),
                1.12,
                0.0012
            );

        } else {
            renderer.camera(
                [31.5, 4.5, 34.8],
                [23.5, 1.1, 24],
                1.03,
                0.0018
            );
        }

        renderer.draw(meshes.floor);
        renderer.draw(meshes.walls);

        renderer.draw(
            meshes.neon,
            [0, 0, 0],
            [1, 1, 1],
            0,
            0.85
        );

        if (room) {
            // Pickups
            for (const item of room.pickups) {
                if (
                    started &&
                    Math.hypot(item.x - me.x, item.z - me.z) > 12
                ) {
                    continue;
                }

                const bob = Math.sin(clock * 2 + item.id) * 0.08;

                renderer.draw(
                    item.type === 'health' || item.type === 'egg'
                        ? meshes.cube
                        : meshes.sphere,

                    [
                        item.x,
                        item.type === 'power' ? 0.75 : 0.38 + bob,
                        item.z
                    ],

                    item.type === 'power'
                        ? [0.30, 0.30, 0.30]
                        : item.type === 'egg'
                            ? [0.23, 0.23, 0.23]
                            : item.type === 'health'
                                ? [0.24, 0.24, 0.24]
                                : [0.085, 0.085, 0.085],

                    clock * 0.3,
                    1,

                    item.type === 'health'
                        ? C.cyan
                        : item.type === 'egg'
                            ? [0.87, 0.28, 1]
                            : C.yellow
                );
            }

            // Ghost enemies
            for (const e of room.enemies) {
                if (
                    started &&
                    Math.hypot(e.x - me.x, e.z - me.z) > 32
                ) {
                    continue;
                }

                const gy = 1.1 + Math.sin(clock * 3 + e.phase) * 0.13;

                const yaw = Math.atan2(
                    me.x - e.x,
                    me.z - e.z
                );

                renderer.draw(
                    meshes.ghost,
                    [e.x, gy, e.z],
                    [1, 1, 1],
                    yaw,
                    0.3,
                    e.color
                );

                face(e.x, gy, e.z, yaw);
            }

            // Other players
            for (const p of room.players) {
                if (p.id === myId || p.dead) continue;

                if (
                    started &&
                    Math.hypot(p.x - me.x, p.z - me.z) > 18
                ) {
                    continue;
                }

                drawPlayer(p);
            }
        }

        // Projectiles
        for (const q of projectiles) {
            const col =
                q.projectile === 'banana'
                    ? [1, 0.9, 0.05]
                    : q.projectile === 'poop'
                        ? [0.32, 0.17, 0.07]
                        : C.yellow;

            const pieces =
                q.projectile === 'banana'
                    ? 4
                    : q.projectile === 'poop'
                        ? 3
                        : 2;

            for (let i = 0; i < pieces; i++) {
                const t = (i + 1) / (pieces + 1);

                renderer.draw(
                    q.projectile === 'banana'
                        ? meshes.banana
                        : q.projectile === 'poop'
                            ? meshes.poop
                            : meshes.sphere,

                    [
                        q.x + (q.tx - q.x) * t,
                        1.12,
                        q.z + (q.tz - q.z) * t
                    ],

                    q.projectile === 'bullet'
                        ? [0.08, 0.08, 0.08]
                        : [0.50, 0.50, 0.50],

                    clock * 3,
                    1,

                    q.projectile === 'bullet'
                        ? col
                        : [1, 1, 1]
                );
            }
        }

        // First-person weapon
        if (started && !me.dead) {
            renderer.clearDepth();

            renderer.camera(
                [0, 0, 0],
                [0, 0, -1],
                1.1,
                0
            );

            const bob = Math.sin(walking) * 0.01;

            renderer.draw(
                meshes.gun,
                [0.26, -0.31 + bob, -0.57],
                [0.9, 0.9, 0.9],
                -0.08,
                0
            );

            if (shotFlash > 0) {
                renderer.draw(
                    meshes.sphere,
                    [0.30, -0.28, -1.13],
                    [0.15, 0.15, 0.15],
                    0,
                    1,
                    C.yellow
                );
            }
        }
    }

    // --------------------------------------------------
    // MINIMAP
    // --------------------------------------------------

    function mini() {
        const ctx = $('#map').getContext('2d');

        ctx.clearRect(0, 0, 170, 170);

        for (let z = 0; z < 17; z++) {
            for (let x = 0; x < 17; x++) {
                ctx.fillStyle = wall(x, z)
                    ? '#244455'
                    : '#091923';

                ctx.fillRect(
                    x * 10 + 1,
                    z * 10 + 1,
                    8,
                    8
                );
            }
        }

        if (room) {
            for (const e of room.enemies) {
                ctx.fillStyle = '#fb6fab';

                ctx.fillRect(
                    e.x / CELL * 10 - 2,
                    e.z / CELL * 10 - 2,
                    4,
                    4
                );
            }

            for (const p of room.players) {
                ctx.fillStyle =
                    p.id === myId
                        ? '#edff58'
                        : '#64edff';

                ctx.fillRect(
                    p.x / CELL * 10 - 3,
                    p.z / CELL * 10 - 3,
                    6,
                    6
                );
            }
        }
    }

    // --------------------------------------------------
    // GAME LOOP
    // --------------------------------------------------

    function frame(time) {
        const dt = Math.min(0.04, (time - last) / 1000);

        last = time;
        clock += dt;

        shotFlash = Math.max(0, shotFlash - dt);

        projectiles = projectiles.filter(
            p => (p.life -= dt) > 0
        );

        move(dt);
        draw();

        if (time >= nextMinimapAt) {
            mini();
            nextMinimapAt = time + 125;
        }

        if (noticeUntil && time > noticeUntil) {
            $('#notification').textContent = '';
            noticeUntil = 0;
        }

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    // --------------------------------------------------
    // KEYBOARD CONTROLS
    // --------------------------------------------------

    document.addEventListener('keydown', e => {
        if (
            e.target.matches('input,select') ||
            $('#instructions').open
        ) {
            return;
        }

        keys[e.code] = true;

        if (
            ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'Space']
                .includes(e.code)
        ) {
            e.preventDefault();
        }

        if (e.code === 'KeyR' && !e.repeat && started) {
            if (me.reserve <= 0) {
                notify(
                    'EFKEROSES TIN · PIAE JITRINOUKIA',
                    2.2
                );
            } else {
                socket.emit('reload');
            }
        }

        if (e.code === 'Escape' && started) {
            paused = true;
            $('#pause').hidden = false;
        }
    });

    document.addEventListener('keyup', e => {
        keys[e.code] = false;
    });

    // --------------------------------------------------
    // MOUSE CONTROLS
    // --------------------------------------------------

    document.addEventListener('mousemove', e => {
        if (
            started &&
            !paused &&
            document.pointerLockElement === $('#world')
        ) {
            me.yaw +=
                e.movementX * 0.0022 * mouseSensitivity;

            me.pitch = Math.max(
                -0.9,
                Math.min(
                    0.9,
                    me.pitch -
                    e.movementY * 0.0018 * mouseSensitivity
                )
            );
        }
    });

    $('#world').addEventListener('mousedown', e => {
        if (
            e.button !== 0 ||
            !started ||
            paused ||
            me.dead
        ) {
            return;
        }

        if (document.pointerLockElement !== $('#world')) {
            requestCapture();

        } else {
            if (me.ammo <= 0) {
                const t = performance.now();

                if (t - lastEmptyWarn > 1400) {
                    notify(
                        me.reserve > 0
                            ? 'ELIPSEN MANA MOU · TSILLA R'
                            : 'EFKEROSEN TELIA · PIAE JITRINOUKIA',
                        2.5
                    );

                    lastEmptyWarn = t;
                }

            } else {
                socket.emit('shoot');
            }
        }
    });

    $('#world').addEventListener('contextmenu', e => {
        e.preventDefault();
    });

    // --------------------------------------------------
    // WINDOW EVENTS
    // --------------------------------------------------

    window.addEventListener('resize', () => {
        renderer.resize();
    });

    window.addEventListener('blur', () => {
        keys = {};
    });

    // --------------------------------------------------
    // UI BUTTONS
    // --------------------------------------------------

    $('#play').onclick = () => {
        if (!joined) {
            status('Create or join a private room first.');
        }

        input.hidden = false;
    };

    $('#resume').onclick = () => {
        paused = false;
        $('#pause').hidden = true;
        requestCapture();
    };

    $('#restart-pause').onclick = () => {
        notify('Create a new room to restart a match.');
    };

    $('#again').onclick = () => location.reload();

    $('#back-home').onclick = () => location.reload();

    $('#how').onclick = () => {
        $('#instructions').showModal();
    };

    $('.dialog-close').onclick = () => {
        $('#instructions').close();
    };

    $('#manual-play').onclick = () => {
        $('#instructions').close();
        input.hidden = false;
    };

    $('#home').onclick = e => {
        e.preventDefault();

        if (started) {
            paused = true;
            $('#pause').hidden = false;

            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        } else {
            input.hidden = false;
        }
    };

    $('#sensitivity').oninput = e => {
        mouseSensitivity = Number(e.target.value);
    };

    $('#sound').onclick = () => {
        $('#sound').textContent = 'SOUND OFF';
    };

    $('#fullscreen').onclick = () => {
        document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen().catch(() => {});
    };

    // --------------------------------------------------
    // JOIN ROOM FROM URL
    // --------------------------------------------------

    const urlRoom = new URLSearchParams(location.search).get('room');

    if (urlRoom) {
        $mp('#mp-code').value = urlRoom.toUpperCase();
    }
}