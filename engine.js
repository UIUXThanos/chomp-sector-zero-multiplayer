
'use strict';

const V3 = {
    sub: (a, b) => a.map((v, i) => v - b[i]),
    dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    cross: (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ],
    norm: a => {
        const length = Math.hypot(...a) || 1;
        return a.map(v => v / length);
    }
};

const M4 = {
    perspective: (fov, aspect, near, far) => {
        const s = 1 / Math.tan(fov / 2);

        return new Float32Array([
            s / aspect, 0, 0, 0,
            0, s, 0, 0,
            0, 0, (far + near) / (near - far), -1,
            0, 0, 2 * far * near / (near - far), 0
        ]);
    },

    look: (eye, target, up = [0, 1, 0]) => {
        const z = V3.norm(V3.sub(eye, target));
        const x = V3.norm(V3.cross(up, z));
        const y = V3.cross(z, x);

        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -V3.dot(x, eye),
            -V3.dot(y, eye),
            -V3.dot(z, eye),
            1
        ]);
    },

    model: (pos, scale = [1, 1, 1], yaw = 0) => {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);

        return new Float32Array([
            c * scale[0], 0, -s * scale[0], 0,
            0, scale[1], 0, 0,
            s * scale[2], 0, c * scale[2], 0,
            ...pos, 1
        ]);
    }
};

class Geometry {
    constructor() {
        this.data = [];
    }

    tri(a, b, c, color, normal) {
        const n = normal || V3.norm(
            V3.cross(V3.sub(b, a), V3.sub(c, a))
        );

        [a, b, c].forEach(p => {
            this.data.push(...p, ...n, ...color);
        });
    }

    quad(a, b, c, d, color) {
        this.tri(a, b, c, color);
        this.tri(a, c, d, color);
    }

    box(x, y, z, w, h, d, color) {
        const X = x + w / 2;
        const A = x - w / 2;
        const Y = y + h / 2;
        const B = y - h / 2;
        const Z = z + d / 2;
        const C = z - d / 2;

        this.quad([A, B, Z], [X, B, Z], [X, Y, Z], [A, Y, Z], color);
        this.quad([X, B, C], [A, B, C], [A, Y, C], [X, Y, C], color);
        this.quad([A, Y, Z], [X, Y, Z], [X, Y, C], [A, Y, C], color);
        this.quad([A, B, C], [X, B, C], [X, B, Z], [A, B, Z], color);
        this.quad([X, B, Z], [X, B, C], [X, Y, C], [X, Y, Z], color);
        this.quad([A, B, C], [A, B, Z], [A, Y, Z], [A, Y, C], color);

        return this;
    }

    sphere(x, y, z, r, color, segments = 14, rings = 8) {
        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < segments; j++) {
                const pt = (a, b) => [
                    x + r * Math.sin(a) * Math.cos(b),
                    y + r * Math.cos(a),
                    z + r * Math.sin(a) * Math.sin(b)
                ];

                const a = i * Math.PI / rings;
                const b = (i + 1) * Math.PI / rings;
                const u = j * 2 * Math.PI / segments;
                const v = (j + 1) * 2 * Math.PI / segments;

                this.quad(pt(a, v), pt(b, v), pt(b, u), pt(a, u), color);
            }
        }

        return this;
    }

    chomp(color) {
        const segments = 26;
        const rings = 15;

        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < segments; j++) {
                const pt = (a, b) => {
                    const px = Math.cos(a);
                    const radius = Math.sin(a);

                    return [
                        px,
                        radius * Math.sin(b),
                        radius * Math.cos(b)
                    ];
                };

                const a = i * Math.PI / rings;
                const b = (i + 1) * Math.PI / rings;
                const u = (0.22 + j / segments * 1.56) * Math.PI;
                const v = (0.22 + (j + 1) / segments * 1.56) * Math.PI;

                this.quad(pt(a, v), pt(b, v), pt(b, u), pt(a, u), color);

                if (j === 0) {
                    this.tri([Math.cos(a), 0, 0], pt(a, u), pt(b, u), color);
                }

                if (j === segments - 1) {
                    this.tri([Math.cos(a), 0, 0], pt(b, v), pt(a, v), color);
                }
            }
        }

        return this;
    }

    ghost(color) {
        const segments = 18;
        const rings = 7;

        for (let i = 0; i < rings; i++) {
            for (let j = 0; j < segments; j++) {
                const pt = (row, col) => {
                    const angle = col / segments * Math.PI * 2;
                    let radius;
                    let y;

                    if (row === 0) {
                        radius = 0.58;
                        y = -0.58 + (col % 2) * 0.18;
                    } else if (row === 1) {
                        radius = 0.62;
                        y = -0.25;
                    } else {
                        const a = (row - 1) / (rings - 1) * Math.PI / 2;
                        radius = 0.62 * Math.cos(a);
                        y = -0.15 + 0.72 * Math.sin(a);
                    }

                    return [
                        radius * Math.sin(angle),
                        y,
                        radius * Math.cos(angle)
                    ];
                };

                this.quad(
                    pt(i, j + 1),
                    pt(i + 1, j + 1),
                    pt(i + 1, j),
                    pt(i, j),
                    color
                );
            }
        }

        return this;
    }
}

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;

        const gl = this.gl = canvas.getContext('webgl', {
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
        });

        if (!gl) {
            throw Error('WebGL unavailable');
        }

        const vertexShader = `
            attribute vec3 aP;
            attribute vec3 aN;
            attribute vec3 aC;

            uniform mat4 uP, uV, uM;

            varying vec3 vC, vN, vW;

            void main() {
                vec4 w = uM * vec4(aP, 1.0);
                vW = w.xyz;
                vN = normalize(mat3(uM) * aN);
                vC = aC;
                gl_Position = uP * uV * w;
            }
        `;

        const fragmentShader = `
            precision mediump float;

            varying vec3 vC, vN, vW;

            uniform vec3 uEye, uTint;
            uniform float uGlow, uFog;

            void main() {
                float light =
                    0.32 +
                    0.55 * max(
                        dot(normalize(vN), normalize(vec3(-0.3, 0.9, 0.45))),
                        0.0
                    ) +
                    0.16 * max(
                        dot(normalize(vN), vec3(0.0, 0.0, -1.0)),
                        0.0
                    );

                vec3 col = vC * uTint *
                    mix(light, 1.35, min(uGlow, 1.0));

                float dist = length(vW - uEye);
                float fog = 1.0 - exp(-dist * dist * uFog);

                gl_FragColor = vec4(
                    mix(col, vec3(0.016, 0.031, 0.055), min(fog, 0.98)),
                    1.0
                );
            }
        `;

        const compile = (type, source) => {
            const shader = gl.createShader(type);

            gl.shaderSource(shader, source);
            gl.compileShader(shader);

            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw Error(gl.getShaderInfoLog(shader));
            }

            return shader;
        };

        const program = this.program = gl.createProgram();

        gl.attachShader(
            program,
            compile(gl.VERTEX_SHADER, vertexShader)
        );

        gl.attachShader(
            program,
            compile(gl.FRAGMENT_SHADER, fragmentShader)
        );

        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw Error(gl.getProgramInfoLog(program));
        }

        gl.useProgram(program);

        this.loc = {};

        ['aP', 'aN', 'aC'].forEach(name => {
            this.loc[name] = gl.getAttribLocation(program, name);
        });

        [
            'uP',
            'uV',
            'uM',
            'uEye',
            'uTint',
            'uGlow',
            'uFog'
        ].forEach(name => {
            this.loc[name] = gl.getUniformLocation(program, name);
        });

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        this._lastMeshBuffer = null;
        this.eye = [0, 0, 0];

        this.resize();
    }

    resize() {
        const ratio = Math.min(
            window.devicePixelRatio || 1,
            0.75
        );

        const width = Math.max(
            1,
            Math.min(1280, Math.round(innerWidth * ratio))
        );

        const height = Math.max(
            1,
            Math.round(width * innerHeight / innerWidth)
        );

        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    mesh(geometry) {
        const gl = this.gl;
        const buffer = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(geometry.data),
            gl.STATIC_DRAW
        );

        return {
            buffer,
            count: geometry.data.length / 9
        };
    }

    camera(eye, target, fov = 1.13, fog = 0.0013, up = [0, 1, 0]) {
        const gl = this.gl;

        this.eye = eye;

        gl.uniformMatrix4fv(
            this.loc.uP,
            false,
            M4.perspective(
                fov,
                this.canvas.width / this.canvas.height,
                0.045,
                170
            )
        );

        gl.uniformMatrix4fv(
            this.loc.uV,
            false,
            M4.look(eye, target, up)
        );

        gl.uniform3fv(this.loc.uEye, eye);
        gl.uniform1f(this.loc.uFog, fog);
    }

    clear() {
        const gl = this.gl;

        gl.clearColor(0.016, 0.031, 0.055, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    draw(
        mesh,
        pos = [0, 0, 0],
        scale = [1, 1, 1],
        yaw = 0,
        glow = 0,
        tint = [1, 1, 1]
    ) {
        const gl = this.gl;

        // Do not configure the same mesh's attributes repeatedly.
        if (this._lastMeshBuffer !== mesh.buffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);

            ['aP', 'aN', 'aC'].forEach((attribute, index) => {
                const location = this.loc[attribute];

                if (location < 0) {
                    return;
                }

                gl.enableVertexAttribArray(location);

                gl.vertexAttribPointer(
                    location,
                    3,
                    gl.FLOAT,
                    false,
                    36,
                    index * 12
                );
            });

            this._lastMeshBuffer = mesh.buffer;
        }

        gl.uniformMatrix4fv(
            this.loc.uM,
            false,
            M4.model(pos, scale, yaw)
        );

        gl.uniform3fv(this.loc.uTint, tint);
        gl.uniform1f(this.loc.uGlow, glow);

        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }

    clearDepth() {
        this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
    }
}

if (typeof module !== 'undefined') {
    module.exports = { V3, M4, Geometry };
}
