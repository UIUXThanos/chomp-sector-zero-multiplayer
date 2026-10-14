
'use strict';

// CHOMP multiplayer client.
// The server controls ghosts, pellets, HP, ammo and scoring.

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
} catch (error) {
    $('#fallback').hidden = false;
    console.error(error);
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
    let nextMoveSeq = 0;
    let lastAckSeq = 0;
    let lastSentX = 25.5;
    let lastSentZ = 28.5;
    let pendingMoves = [];
    let moveBaseReady = false;
    let moveRejects = 0;
    let eliminatedNoticeShown = false;
    let mouseSensitivity = 1;
    let shotFlash = 0;
    let walking = 0;
    let noticeUntil = 0;
    let lastEmptyWarn = 0;
    let projectiles = [];
    let terminalShown = false;
    let nextMinimapAt = 0;

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

    // --------------------------------------------------
    // MULTIPLAYER LOBBY
    // --------------------------------------------------

    const input = document.createElement('div');

    input.id = 'multiplayer-lobby';

    input.innerHTML = `
        <h2>MULTIPLAYER</h2>

        <p>
            CHARACTERS: BATMAN / JOKER /
            WOLVERINE / GHOST RIDER (4 SLOTS)
        </p>

        <label>
            YOUR NAME
            <input
                id="mp-name"
                maxlength="16"
                value="PLAYER"
            />
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
            <input
                id="mp-code"
                maxlength="6"
                placeholder="ABC123"
            />
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

    const status = text => {
        $mp('#mp-status').textContent = text;
    };

    function notify(text, seconds = 2) {
        $('#notification').textContent = text;
        noticeUntil = performance.now() + seconds * 1000;
    }

    // --------------------------------------------------
    // SOCKET EVENTS
    // --------------------------------------------------

        let savedSession = null;

    try {
        savedSession = JSON.parse(
            sessionStorage.getItem('chompSession') || 'null'
        );
    } catch {}

    let reconnecting = false;

    function rememberSession(data) {
        savedSession = {
            code: data.code,
            token: data.token
        };

        try {
            sessionStorage.setItem(
                'chompSession',
                JSON.stringify(savedSession)
            );
        } catch {}
    }

    function resetMovement(x, z) {
        pendingMoves = [];
        lastAckSeq = 0;
        nextMoveSeq = 0;
        lastSentX = x;
        lastSentZ = z;
        moveBaseReady = false;
    }

    socket.on('connect', () => {
        if (savedSession?.code && savedSession?.token) {
            reconnecting = true;
            paused = true;

            socket.emit(
                'resumeRoom',
                savedSession,
                reply => {
                    if (reply?.ok) return;

                    // Session expired or server restarted.
                    reconnecting = false;
                    joined = false;
                    started = false;
                    paused = false;
                    myId = null;
                    room = null;
                    savedSession = null;

                    try {
                        sessionStorage.removeItem(
                            'chompSession'
                        );
                    } catch {}

                    $('#hud').hidden = true;
                    $('#landing').hidden = false;

                    document.body.classList.remove(
                        'playing'
                    );

                    input.hidden = false;

                    status(
                        reply?.error ||
                        'Previous room unavailable. Create a new room.'
                    );
                }
            );
        } else {
            status(
                'Connected. Create a room or enter an invite code.'
            );
        }
    });

    socket.on('disconnect', reason => {
        console.warn('CHOMP disconnected:', reason);

        // Freeze gameplay while preserving the camera.
        reconnecting = true;
        paused = true;
        keys = {};
        pendingMoves = [];
        moveBaseReady = false;

        notify(
            'CONNECTION LOST · RECONNECTING...',
            5
        );

        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
    });

    socket.on('joined', data => {
        joined = true;
        myId = data.id;

        rememberSession(data);

        status(
            'ROOM ' + data.code +
            ' · Share this invite code'
        );

        $mp('#mp-code').value = data.code;

        resetMovement(me.x, me.z);
    });

    socket.on('resumed', data => {
        joined = true;
        myId = data.id;

        rememberSession(data);

        reconnecting = false;
        keys = {};

        resetMovement(me.x, me.z);

        paused = false;
        $('#pause').hidden = true;
$('#landing').hidden = true;
$('#hud').hidden = false;

document.body.classList.add('playing');

notify('RECONNECTED - CLICK THE GAME TO PLAY', 4);

        if (started) {
            $('#landing').hidden = true;
            $('#hud').hidden = false;
            input.hidden = true;

            notify(
                'RECONNECTED · CLICK GAME TO AIM',
                4
            );
        } else {
            status(
                'ROOM ' + data.code +
                ' · Connection restored'
            );
        }
    });


    socket.on('snapshot', snapshot => {
        room = snapshot;

        const p = snapshot.players.find(
            player => player.id === myId
        );

        // Server owns HP, ammo and pickups. The camera is predicted locally;
        // only acknowledged movement can adjust that prediction.
        if (p) {
            if (!moveBaseReady || snapshot.phase !== 'playing') {
                me.x = p.x;
                me.z = p.z;
                lastSentX = p.x;
                lastSentZ = p.z;
                pendingMoves = [];
                moveBaseReady = true;
            }
            const { x, z, yaw, pitch, ...serverFields } = p;
            Object.assign(me, serverFields);
        }

        if (snapshot.phase === 'lobby') {
            $mp('#mp-players').textContent =
                `${snapshot.players.length}/4 players: ` +
                snapshot.players.map(player => player.name).join(', ');

            $mp('#mp-start').hidden = snapshot.host !== myId;
            input.hidden = false;

        } else if (snapshot.phase === 'playing') {
            if (!started) {
                started = true;
                paused = false;
                terminalShown = false;
                eliminatedNoticeShown = false;
                if (p) {
                    me.x = p.x;
                    me.z = p.z;
                    lastSentX = p.x;
                    lastSentZ = p.z;
                    pendingMoves = [];
                    moveBaseReady = true;
                }

                input.hidden = true;
                $('#landing').hidden = true;
                $('#hud').hidden = false;
                $('#end').hidden = true;

                document.body.classList.add('playing');
                requestCapture();
            }

            if (p?.dead && !eliminatedNoticeShown) {
                eliminatedNoticeShown = true;
                keys = {};
                notify(
                    'YOU ARE ELIMINATED · SPECTATING',
                    3
                );
            }

        } else if (
            snapshot.phase === 'finished' &&
            !terminalShown
        ) {
            terminalShown = true;
            started = false;

            input.hidden = true;
            $('#end').hidden = false;

            $('#end-kicker').textContent =
                snapshot.winner === 'coop'
                    ? 'SECTOR SECURED'
                    : 'MATCH FINISHED';

            $('#end-title').textContent =
                snapshot.mode === 'coop'
                    ? 'GAME OVER'
                    : 'PVP OVER';

            $('#end-copy').textContent =
                snapshot.winner === 'coop'
                    ? 'All ghost waves cleared!'
                    : snapshot.winner === 'ghosts'
                        ? 'The ghosts won.'
                        : `${
                            snapshot.players.find(
                                player => player.id === snapshot.winner
                            )?.name || 'A PLAYER'
                        } WON`;

            $('#final-score').textContent = p?.score || 0;
            $('#final-kills').textContent = p?.kills || 0;

            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        }

        updateHud();
    });

    // Each reply identifies precisely which movement update was processed.
    // Replaying unacknowledged movement prevents corrections from using old
    // positions, and makes server rejections visible rather than silent.
    socket.on('moveAck', ack => {
        if (!ack || !moveBaseReady || !started) return;
        const seq = Number(ack.seq);
        if (!Number.isSafeInteger(seq)) return;
        if (!Number.isFinite(ack.x) || !Number.isFinite(ack.z)) return;
        if (seq <= (lastAckSeq || 0)) return;
        lastAckSeq = seq;

        pendingMoves = pendingMoves.filter(m => m.seq > seq);

        let x = ack.x;
        let z = ack.z;
        for (const m of pendingMoves) {
            // Predict only movement that stays outside walls.
            if (passable(x + m.dx, z, 0.25)) x += m.dx;
            if (passable(x, z + m.dz, 0.25)) z += m.dz;
        }

        const error = Math.hypot(me.x - x, me.z - z);
        if (!ack.accepted || error > 0.65) {
            me.x = x;
            me.z = z;
        }
        // Keep outbound deltas relative to the latest prediction.
        if (!ack.accepted) {
            moveRejects++;
            if (moveRejects === 5) notify('MOVEMENT RESYNCED WITH SERVER', 2);
            lastSentX = me.x;
            lastSentZ = me.z;
            pendingMoves = [];
        }
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
        const time = performance.now();

        if (time - lastEmptyWarn > 1200) {
            notify(text, 2.5);
            lastEmptyWarn = time;
        }
    });

    function send(name, data, callback) {
        if (!socket.connected) {
            status('Not connected yet');
            return;
        }

        socket.emit(name, data, callback);
    }

    $mp('#mp-create').onclick = () => {
        send(
            'createRoom',
            {
                mode: $mp('#mp-mode').value,
                name: $mp('#mp-name').value
            },
            response => {
                if (response?.error) status(response.error);
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
            response => {
                if (response?.error) status(response.error);
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
            if (!wall(x, z)) continue;

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

    // --------------------------------------------------
    // MESHES
    // --------------------------------------------------

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

    // --------------------------------------------------
    // GHOST FACES
    // --------------------------------------------------

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
    // CHARACTER MODELS
    // --------------------------------------------------

    const costumes = [
        {
            body: [0.055, 0.07, 0.12],
            head: [0.09, 0.11, 0.17],
            cape: [0.02, 0.02, 0.04],
            accent: [0.95, 0.80, 0.20]
        },
        {
            body: [0.29, 0.08, 0.40],
            head: [0.83, 0.88, 0.76],
            cape: [0.30, 0.06, 0.38],
            accent: [0.10, 0.82, 0.28]
        },
        {
            body: [0.89, 0.72, 0.10],
            head: [0.93, 0.73, 0.23],
            cape: [0.12, 0.16, 0.38],
            accent: [0.12, 0.18, 0.37]
        },
        {
            body: [0.10, 0.12, 0.13],
            head: [0.82, 0.39, 0.11],
            cape: [0.06, 0.06, 0.08],
            accent: [1, 0.32, 0.04]
        }
    ];

    function drawPlayer(p) {
        const skin = costumes[p.character % 4] || costumes[0];

        const x = p.x;
        const z = p.z;
        const yaw = p.yaw;

        const drawPart = (pos, size, tint, glow = 0) => {
            renderer.draw(
                meshes.cube,
                pos,
                size,
                yaw,
                glow,
                tint
            );
        };

        drawPart(
            [x, 0.9, z],
            [0.7, 0.75, 0.4],
            skin.body
        );

        drawPart(
            [x, 1.52, z],
            [0.52, 0.51, 0.52],
            skin.head
        );

        drawPart(
            [x, 0.37, z - 0.09],
            [0.24, 0.68, 0.30],
            skin.body
        );

        drawPart(
            [x, 1.02, z],
            [0.95, 0.19, 0.48],
            skin.accent
        );

        drawPart(
            [x, 1.13, z - 0.30],
            [0.72, 0.9, 0.09],
            skin.cape
        );

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

        // Batman-style ears
        if (p.character === 0) {
            for (const side of [-1, 1]) {
                drawPart(
                    [x + side * 0.18, 1.90, z],
                    [0.15, 0.36, 0.16],
                    skin.head
                );
            }
        }

        // Joker-style green hair
        if (p.character === 1) {
            drawPart(
                [x, 1.9, z],
                [0.62, 0.25, 0.57],
                skin.accent
            );
        }

        // Wolverine-style claws
        if (p.character === 2) {
            for (const side of [-1, 1]) {
                drawPart(
                    [x + side * 0.47, 1.02, z + 0.10],
                    [0.08, 0.34, 0.06],
                    C.white
                );
            }
        }

        // Ghost Rider-style flames
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
                : `${
                    room.players.filter(p => !p.dead).length
                } PLAYERS ALIVE`;

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
                    ? 'ELIPSAN SOU OULLA MANA MOU'
                    : 'TSILA JINTO R';

        $('#power').hidden = !(me.power || me.egg);

        if (me.egg) {
            $('#power').firstChild.textContent =
                me.egg.toUpperCase() + ' ';
        } else {
            $('#power').firstChild.textContent =
                'OVERDRIVE ';
        }

        $('#combo').textContent = room.mode.toUpperCase();
    }

    // --------------------------------------------------
    // CAMERA AND MOVEMENT
    // --------------------------------------------------

    function requestCapture() {
        if (!$('#world').requestPointerLock) return;

        try {
            const promise = $('#world').requestPointerLock();
            promise?.catch?.(() => {});
        } catch {}
    }

    function move(dt) {
        if (
            !started ||
            paused ||
            reconnecting ||
            !socket.connected ||
            me.dead
        ) return;

        const forward =
            (keys.KeyW ? 1 : 0) -
            (keys.KeyS ? 1 : 0);

        const sideways =
            (keys.KeyD || keys.KeyE ? 1 : 0) -
            (keys.KeyA || keys.KeyQ ? 1 : 0);

        const length = Math.hypot(forward, sideways);

        if (length) {
            const speed =
                (keys.ShiftLeft || keys.ShiftRight ? 7 : 4.7) *
                (me.egg === 'frenzy' ? 1.65 : 1);

            const dx =
                (
                    Math.sin(me.yaw) * forward +
                    Math.cos(me.yaw) * sideways
                ) / length * speed * dt;

            const dz =
                (
                    -Math.cos(me.yaw) * forward +
                    Math.sin(me.yaw) * sideways
                ) / length * speed * dt;

            if (passable(me.x + dx, me.z, 0.25)) {
                me.x += dx;
            }

            if (passable(me.x, me.z + dz, 0.25)) {
                me.z += dz;
            }

            walking += dt * 10;
        }

        // Send movement at about 20 Hz. Record every pending displacement
        // so that acknowledged server positions can be reconciled correctly.
        sendAt -= dt;
        if (sendAt <= 0 && socket.connected) {
            sendAt = 0.05;
            const seq = ++nextMoveSeq;
            pendingMoves.push({
                seq,
                dx: me.x - lastSentX,
                dz: me.z - lastSentZ
            });
            // Guard against unbounded memory growth after a lost connection.
            if (pendingMoves.length > 120) pendingMoves.shift();
            lastSentX = me.x;
            lastSentZ = me.z;
            socket.emit('move', {
                seq,
                x: me.x,
                z: me.z,
                yaw: me.yaw,
                pitch: me.pitch
            });
        }
    }

    // --------------------------------------------------
    // RENDER THE GAME
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
                eye.map((value, i) => value + forward[i]),
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
            // ------------------------------------------
            // PELLETS AND POWER-UPS
            // ------------------------------------------

            for (const item of room.pickups) {
                if (
                    started &&
                    Math.hypot(
                        item.x - me.x,
                        item.z - me.z
                    ) > 12
                ) continue;

                const bob =
                    Math.sin(clock * 2 + item.id) * 0.08;

                renderer.draw(
                    item.type === 'health' || item.type === 'egg'
                        ? meshes.cube
                        : meshes.sphere,

                    [
                        item.x,
                        item.type === 'power'
                            ? 0.75
                            : 0.38 + bob,
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

            // ------------------------------------------
            // GHOSTS AND THEIR FACES
            // ------------------------------------------

            for (const e of room.enemies) {
                if (
                    started &&
                    Math.hypot(
                        e.x - me.x,
                        e.z - me.z
                    ) > 18
                ) continue;

                const gy =
                    1.1 +
                    Math.sin(clock * 3 + e.phase) * 0.13;

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

            // ------------------------------------------
            // OTHER PLAYERS
            // ------------------------------------------

            for (const p of room.players) {
                if (p.id === myId || p.dead) continue;

                if (
                    started &&
                    Math.hypot(
                        p.x - me.x,
                        p.z - me.z
                    ) > 18
                ) continue;

                drawPlayer(p);
            }
        }

        // ----------------------------------------------
        // PROJECTILES
        // ----------------------------------------------

        for (const projectile of projectiles) {
            const color =
                projectile.projectile === 'banana'
                    ? [1, 0.9, 0.05]
                    : projectile.projectile === 'poop'
                        ? [0.32, 0.17, 0.07]
                        : C.yellow;

            const pieces =
                projectile.projectile === 'banana'
                    ? 4
                    : projectile.projectile === 'poop'
                        ? 3
                        : 2;

            for (let i = 0; i < pieces; i++) {
                const t = (i + 1) / (pieces + 1);

                renderer.draw(
                    projectile.projectile === 'banana'
                        ? meshes.banana
                        : projectile.projectile === 'poop'
                            ? meshes.poop
                            : meshes.sphere,

                    [
                        projectile.x +
                            (projectile.tx - projectile.x) * t,

                        1.12,

                        projectile.z +
                            (projectile.tz - projectile.z) * t
                    ],

                    projectile.projectile === 'bullet'
                        ? [0.08, 0.08, 0.08]
                        : [0.50, 0.50, 0.50],

                    clock * 3,
                    1,

                    projectile.projectile === 'bullet'
                        ? color
                        : [1, 1, 1]
                );
            }
        }

        // ----------------------------------------------
        // FIRST-PERSON GUN
        // ----------------------------------------------

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
        const dt = Math.min(
            0.04,
            (time - last) / 1000
        );

        last = time;
        clock += dt;

        shotFlash = Math.max(
            0,
            shotFlash - dt
        );

        projectiles = projectiles.filter(
            projectile => (projectile.life -= dt) > 0
        );

        move(dt);
        draw();

        // Refresh minimap 8 times a second.
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
            [
                'KeyW',
                'KeyA',
                'KeyS',
                'KeyD',
                'KeyR',
                'Space',
                'ShiftLeft',
                'ShiftRight'
            ].includes(e.code)
        ) {
            e.preventDefault();
        }

        // R is the ONLY way to start reloading.
        if (
            e.code === 'KeyR' &&
            !e.repeat &&
            started
        ) {
            if (me.reserve <= 0) {
                notify(
                    'ELIPSAN OULLES MANA MOU · SOROPSE JITRINOUKIA',
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
                        e.movementY *
                        0.0018 *
                        mouseSensitivity
                )
            );
        }
    });

    $('#world').addEventListener('mousedown', e => {
        if (
            e.button !== 0 ||
            !socket.connected ||
            reconnecting ||
            !started ||
            paused ||
            me.dead
        ) {
            return;
        }

        if (document.pointerLockElement !== $('#world')) {
            requestCapture();
            return;
        }

        if (me.ammo <= 0) {
            const time = performance.now();

            if (time - lastEmptyWarn > 1400) {
                notify(
                    me.reserve > 0
                        ? 'ELIPSEN MANA MOU · TSILLA R'
                        : 'EEE ELIPSAN OULES · SOROPSE JITRINOUKIA',
                    2.5
                );

                lastEmptyWarn = time;
            }
        } else {
            socket.emit('shoot');
        }
    });

    $('#world').addEventListener('contextmenu', e => {
        e.preventDefault();
    });

    // --------------------------------------------------
    // WINDOW AND MENU CONTROLS
    // --------------------------------------------------

    window.addEventListener('resize', () => {
        renderer.resize();
    });

    window.addEventListener('blur', () => {
        keys = {};
    });

    $('#play').onclick = () => {
        if (!joined) {
            status('Create or join a private room first.');
        }

        input.hidden = false;
    };

    $('#resume').onclick = () => {
        if (!socket.connected || reconnecting) return;
        paused = false;
        $('#pause').hidden = true;
        requestCapture();
    };

    $('#restart-pause').onclick = () => {
        notify('Create a new room to restart a match.');
    };

    $('#again').onclick = () => {
        try {
            sessionStorage.removeItem('chompSession');
        } catch {}
        location.reload();
    };

    $('#back-home').onclick = () => {
        try {
            sessionStorage.removeItem('chompSession');
        } catch {}
        location.reload();
    };

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
            : document.documentElement
                .requestFullscreen()
                .catch(() => {});
    };

    // --------------------------------------------------
    // JOIN ROOM USING URL PARAMETER
    // --------------------------------------------------

    const urlRoom = new URLSearchParams(
        location.search
    ).get('room');

    if (urlRoom) {
        $mp('#mp-code').value = urlRoom.toUpperCase();
    }
}
