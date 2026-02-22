// @ts-check

/** @typedef {[number, number]} Vec2 */

/**
 * @typedef {Object} RenderState
 * @property {{x:number,y:number,vx:number,vy:number,state:string,explodeT:number,_samples?:Array<[number,number,boolean,number]>|null,_collision?:{x:number,y:number,tri?:Array<{x:number,y:number}>|null,node?:{x:number,y:number}|null}|null}} ship
 * @property {Array<{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number}>} debris
 * @property {{left:boolean,right:boolean,thrust:boolean,down:boolean}} input
 * @property {boolean} debugCollisions
 * @property {boolean} debugNodes
 * @property {number} fps
 * @property {number} finalAir
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {typeof import("./config.js").CFG} cfg
 * @param {typeof import("./config.js").GAME} game
 */
export function createRenderer(canvas, cfg, game){
  const gl = canvas.getContext("webgl2", { antialias:true, premultipliedAlpha:false });
  if (!gl) throw new Error("WebGL2 not available");

  function resize(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h){
      canvas.width = w; canvas.height = h;
    }
  }

  const vs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in float aAir;
  layout(location=2) in float aShade;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uRot;

  out float vAir;
  out float vShade;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  void main(){
    vAir = aAir;
    vShade = aShade;
    vec2 p = aPos - uCam;
    p = rot(p, uRot);
    gl_Position = vec4(p * uScale, 0.0, 1.0);
  }`;

  const fs = `#version 300 es
  precision highp float;

  in float vAir;
  in float vShade;
  out vec4 outColor;

  uniform vec3 uRockDark;
  uniform vec3 uRockLight;
  uniform vec3 uAirDark;
  uniform vec3 uAirLight;

  vec3 lerp(vec3 a, vec3 b, float t){ return a + (b-a)*t; }

  void main(){
    float t = clamp(vShade, 0.0, 1.0);
    vec3 c = (vAir > 0.5) ? lerp(uAirDark,  uAirLight,  t)
                          : lerp(uRockDark, uRockLight, t);
    outColor = vec4(c, 1.0);
  }`;

  const ovs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec4 aColor;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uRot;

  out vec4 vColor;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  void main(){
    vec2 p = aPos - uCam;
    p = rot(p, uRot);
    gl_Position = vec4(p * uScale, 0.0, 1.0);
    vColor = aColor;
    gl_PointSize = 6.0;
  }`;

  const ofs = `#version 300 es
  precision highp float;
  in vec4 vColor;
  out vec4 outColor;
  void main(){
    outColor = vColor;
  }`;

  function compile(type, src){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(log || "Shader compile failed");
    }
    return sh;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)){
    throw new Error(gl.getProgramInfoLog(prog) || "Program link failed");
  }

  const oprog = gl.createProgram();
  gl.attachShader(oprog, compile(gl.VERTEX_SHADER, ovs));
  gl.attachShader(oprog, compile(gl.FRAGMENT_SHADER, ofs));
  gl.linkProgram(oprog);
  if (!gl.getProgramParameter(oprog, gl.LINK_STATUS)){
    throw new Error(gl.getProgramInfoLog(oprog) || "Overlay program link failed");
  }

  const vao = gl.createVertexArray();
  const oVao = gl.createVertexArray();
  let airBuf = null;
  let vertCount = 0;

  function uploadAttrib(loc, data, size, type=gl.FLOAT){
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, false, 0, 0);
    return buf;
  }

  function setMesh(mesh){
    gl.bindVertexArray(vao);
    uploadAttrib(0, mesh.positions, 2);
    airBuf = uploadAttrib(1, mesh.airFlag, 1);
    uploadAttrib(2, mesh.shade, 1);
    gl.bindVertexArray(null);
    vertCount = mesh.vertCount;
  }

  function updateAir(airFlag){
    if (!airBuf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, airBuf);
    gl.bufferData(gl.ARRAY_BUFFER, airFlag, gl.STATIC_DRAW);
  }

  gl.useProgram(prog);
  const uScale = gl.getUniformLocation(prog, "uScale");
  const uCam = gl.getUniformLocation(prog, "uCam");
  const uRot = gl.getUniformLocation(prog, "uRot");
  const uRockDark = gl.getUniformLocation(prog, "uRockDark");
  const uRockLight= gl.getUniformLocation(prog, "uRockLight");
  const uAirDark  = gl.getUniformLocation(prog, "uAirDark");
  const uAirLight = gl.getUniformLocation(prog, "uAirLight");

  gl.uniform3fv(uRockDark, cfg.ROCK_DARK);
  gl.uniform3fv(uRockLight,cfg.ROCK_LIGHT);
  gl.uniform3fv(uAirDark,  cfg.AIR_DARK);
  gl.uniform3fv(uAirLight, cfg.AIR_LIGHT);

  gl.bindVertexArray(oVao);
  const oPos = gl.createBuffer();
  const oCol = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, oPos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, oCol);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const ouScale = gl.getUniformLocation(oprog, "uScale");
  const ouCam = gl.getUniformLocation(oprog, "uCam");
  const ouRot = gl.getUniformLocation(oprog, "uRot");

  function rot2(x, y, a){
    const c = Math.cos(a), s = Math.sin(a);
    return [c*x - s*y, s*x + c*y];
  }

  function pushTri(pos, col, ax, ay, bx, by, cx, cy, r, g, b, a){
    pos.push(ax, ay, bx, by, cx, cy);
    for (let i = 0; i < 3; i++) col.push(r, g, b, a);
  }

  function pushLine(pos, col, ax, ay, bx, by, r, g, b, a){
    pos.push(ax, ay, bx, by);
    col.push(r, g, b, a, r, g, b, a);
  }

  /**
   * @param {RenderState} state
   * @param {import("./mesh.js").buildRingMesh} mesh
   */
  function drawFrame(state, mesh){
    resize();

    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const camRot = Math.atan2(state.ship.x, state.ship.y || 1e-6);

    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    const s = game.ZOOM / (cfg.RMAX + cfg.PAD);
    const aspect = canvas.width / canvas.height;
    const sx = s / aspect;
    const sy = s;
    gl.uniform2f(uScale, sx, sy);
    gl.uniform2f(uCam, state.ship.x, state.ship.y);
    gl.uniform1f(uRot, camRot);

    gl.drawArrays(gl.TRIANGLES, 0, vertCount);

    gl.bindVertexArray(null);

    const shipHWorld = 0.7;
    const shipWWorld = 0.5;
    const nose = shipHWorld * 0.6;
    const tail = shipHWorld * 0.4;

    const pos = [];
    const col = [];
    let triVerts = 0;
    let lineVerts = 0;
    let pointVerts = 0;

    const local = [
      [0, nose],
      [shipWWorld * 0.6, -tail],
      [0, -tail * 0.6],
      [-shipWWorld * 0.6, -tail],
    ];
    const body = [];
    const shipRot = -camRot;
    if (state.ship.state !== "crashed"){
      for (const [lx, ly] of local){
        const [wx, wy] = rot2(lx, ly, shipRot);
        body.push([state.ship.x + wx, state.ship.y + wy]);
      }
      pushTri(pos, col, body[0][0], body[0][1], body[1][0], body[1][1], body[2][0], body[2][1], 0.06, 0.08, 0.12, 1);
      pushTri(pos, col, body[0][0], body[0][1], body[2][0], body[2][1], body[3][0], body[3][1], 0.06, 0.08, 0.12, 1);
      triVerts += 6;

      pushLine(pos, col, body[0][0], body[0][1], body[1][0], body[1][1], 0.9, 0.9, 0.9, 1);
      pushLine(pos, col, body[1][0], body[1][1], body[2][0], body[2][1], 0.9, 0.9, 0.9, 1);
      pushLine(pos, col, body[2][0], body[2][1], body[3][0], body[3][1], 0.9, 0.9, 0.9, 1);
      pushLine(pos, col, body[3][0], body[3][1], body[0][0], body[0][1], 0.9, 0.9, 0.9, 1);
      lineVerts += 8;
    }

    const thrustV = (dx, dy, r, g, b, extraOffset = 0) => {
      const mag = Math.hypot(dx, dy) || 1;
      const ux = -dx / mag;
      const uy = -dy / mag;
      const len = shipHWorld * 0.28;
      const spread = shipHWorld * 0.12;
      const px = -uy;
      const py = ux;
      const offset = shipHWorld * 0.55 + extraOffset;
      const tipx = ux * len;
      const tipy = uy * len;
      const b1x = -ux * len * 0.45 + px * spread;
      const b1y = -uy * len * 0.45 + py * spread;
      const b2x = -ux * len * 0.45 - px * spread;
      const b2y = -uy * len * 0.45 - py * spread;
      const [tx, ty] = rot2(tipx + ux * offset, tipy + uy * offset, shipRot);
      const [p1x, p1y] = rot2(b1x + ux * offset, b1y + uy * offset, shipRot);
      const [p2x, p2y] = rot2(b2x + ux * offset, b2y + uy * offset, shipRot);
      pushLine(pos, col, state.ship.x + p1x, state.ship.y + p1y, state.ship.x + tx, state.ship.y + ty, r, g, b, 1);
      pushLine(pos, col, state.ship.x + p2x, state.ship.y + p2y, state.ship.x + tx, state.ship.y + ty, r, g, b, 1);
      lineVerts += 4;
    };

    if (state.ship.state !== "crashed"){
      const tc = [1.0, 0.55, 0.15];
      if (state.input.thrust) thrustV(0, 1, tc[0], tc[1], tc[2]);
      if (state.input.down) thrustV(0, -1, tc[0], tc[1], tc[2], shipHWorld * 0.08);
      if (state.input.left) thrustV(-1, 0, tc[0], tc[1], tc[2]);
      if (state.input.right) thrustV(1, 0, tc[0], tc[1], tc[2]);
    }

    if (state.ship.state !== "crashed"){
      const vscale = 0.35;
      pushLine(pos, col, state.ship.x, state.ship.y, state.ship.x + state.ship.vx * vscale, state.ship.y + state.ship.vy * vscale, 0.5, 0.84, 1.0, 1);
      lineVerts += 2;
    }

    if (state.ship.state === "crashed"){
      const t = state.ship.explodeT;
      const radius = shipHWorld * (0.6 + t * 1.6);
      const alpha = Math.max(0, 1 - t);
      const seg = 28;
      for (let i = 0; i < seg; i++){
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const r0 = radius * (0.85 + 0.2 * Math.sin(t * 8 + i));
        const r1 = radius * (0.85 + 0.2 * Math.sin(t * 8 + i + 1));
        const x0 = state.ship.x + Math.cos(a0) * r0;
        const y0 = state.ship.y + Math.sin(a0) * r0;
        const x1 = state.ship.x + Math.cos(a1) * r1;
        const y1 = state.ship.y + Math.sin(a1) * r1;
        pushLine(pos, col, x0, y0, x1, y1, 1.0, 0.72, 0.3, 0.9 * alpha);
        lineVerts += 2;
      }
      pushLine(pos, col, state.ship.x - radius * 0.7, state.ship.y, state.ship.x + radius * 0.7, state.ship.y, 1.0, 0.85, 0.4, 0.6 * alpha);
      pushLine(pos, col, state.ship.x, state.ship.y - radius * 0.7, state.ship.x, state.ship.y + radius * 0.7, 1.0, 0.85, 0.4, 0.6 * alpha);
      lineVerts += 4;
    }

    if (state.debris.length){
      for (const d of state.debris){
        const len = shipHWorld * 0.18;
        const hx = Math.cos(d.a) * len;
        const hy = Math.sin(d.a) * len;
        pushLine(pos, col, d.x - hx, d.y - hy, d.x + hx, d.y + hy, 0.9, 0.9, 0.9, 0.9);
        lineVerts += 2;
      }
    }

    if (state.debugCollisions && state.ship._samples){
      for (const [sxw, syw, air, av] of state.ship._samples){
        pos.push(sxw, syw);
        if (air) col.push(0.45, 1.0, 0.55, 0.9);
        else col.push(1.0, 0.3, 0.3, 0.9);
        pointVerts += 1;
      }
    }
    if (state.debugCollisions && state.ship._collision){
      const c = state.ship._collision;
      pos.push(c.x, c.y);
      col.push(1.0, 0.95, 0.2, 1.0);
      pointVerts += 1;
      if (c.tri){
        const a = c.tri[0], b = c.tri[1], d = c.tri[2];
        pushLine(pos, col, a.x, a.y, b.x, b.y, 1.0, 0.4, 0.2, 0.8);
        pushLine(pos, col, b.x, b.y, d.x, d.y, 1.0, 0.4, 0.2, 0.8);
        pushLine(pos, col, d.x, d.y, a.x, a.y, 1.0, 0.4, 0.2, 0.8);
        lineVerts += 6;
      }
      if (c.node){
        pos.push(c.node.x, c.node.y);
        col.push(0.2, 0.9, 1.0, 0.9);
        pointVerts += 1;
      }
    }

    if (state.debugCollisions && state.debugNodes){
      for (const ring of mesh.rings){
        for (const v of ring){
          pos.push(v.x, v.y);
          col.push(0.95, 0.8, 0.2, 0.6);
          pointVerts += 1;
        }
      }
    }

    gl.useProgram(oprog);
    gl.bindVertexArray(oVao);
    gl.uniform2f(ouScale, sx, sy);
    gl.uniform2f(ouCam, state.ship.x, state.ship.y);
    gl.uniform1f(ouRot, camRot);

    gl.bindBuffer(gl.ARRAY_BUFFER, oPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, oCol);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (triVerts > 0){
      gl.drawArrays(gl.TRIANGLES, 0, triVerts);
    }
    let offset = triVerts;
    if (lineVerts > 0){
      gl.drawArrays(gl.LINES, offset, lineVerts);
      offset += lineVerts;
    }
    if (pointVerts > 0){
      gl.drawArrays(gl.POINTS, offset, pointVerts);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  return {
    setMesh,
    updateAir,
    drawFrame,
  };
}
