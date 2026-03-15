// triangle_collision_algo.js
// Continuous collision against a 2D equilateral-triangle air/wall mesh.
// This file is intentionally isolated from rendering / input code.

export const SQRT3 = Math.sqrt(3);

export function vec(x = 0, y = 0) {
  return { x, y };
}
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
export function cross(a, b) { return a.x * b.y - a.y * b.x; }
export function len(a) { return Math.hypot(a.x, a.y); }
export function norm(a) {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}
export function perpLeft(a) { return { x: -a.y, y: a.x }; }
export function rotate(a, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function segmentAABB(a, b) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function expandAABB(bb, r) {
  return { minX: bb.minX - r, minY: bb.minY - r, maxX: bb.maxX + r, maxY: bb.maxY + r };
}

function mergeAABB(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function aabbOverlap(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function reflectVelocity(v, n, restitution = 1.0) {
  const vn = dot(v, n);
  if (vn >= 0) return v;
  return sub(v, mul(n, (1 + restitution) * vn));
}

export function buildTriangleMeshFromRows(rows, side = 32, origin = { x: 40, y: 40 }) {
  const H = rows.length;
  const W = rows[0]?.length ?? 0;
  const triH = side * SQRT3 / 2;
  const tris = [];
  const triMap = new Map();

  function key(r, c) { return `${r},${c}`; }
  function trianglePointsUp(r, c) { return ((r + c) & 1) !== 0; }

  function triangleVertices(r, c) {
    // Row of alternating up/down equilateral triangles laid horizontally.
    const up = trianglePointsUp(r, c);
    const cx = origin.x + c * (side / 2) + side / 2;
    const cy = origin.y + r * triH + triH / 2;
    if (up) {
      return [
        { x: cx, y: cy - triH / 2 },
        { x: cx - side / 2, y: cy + triH / 2 },
        { x: cx + side / 2, y: cy + triH / 2 },
      ];
    }
    return [
      { x: cx - side / 2, y: cy - triH / 2 },
      { x: cx + side / 2, y: cy - triH / 2 },
      { x: cx, y: cy + triH / 2 },
    ];
  }

  function triangleBoundaryEdges(verts, up) {
    if (up) {
      return [ [verts[0], verts[1]], [verts[2], verts[0]], [verts[1], verts[2]] ];
    }
    return [ [verts[2], verts[0]], [verts[1], verts[2]], [verts[0], verts[1]] ];
  }

  function neighbors(r, c) {
    const up = trianglePointsUp(r, c);
    if (up) {
      return [ [r, c - 1], [r, c + 1], [r + 1, c] ];
    }
    return [ [r, c - 1], [r, c + 1], [r - 1, c] ];
  }

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = rows[r][c];
      if (ch === '#') continue;
      const verts = triangleVertices(r, c);
      const tri = {
        r, c, ch,
        isWall: ch === 'X',
        isAir: ch === '0',
        verts,
        center: mul(add(add(verts[0], verts[1]), verts[2]), 1 / 3),
      };
      tris.push(tri);
      triMap.set(key(r, c), tri);
    }
  }

  const edges = [];
  const corners = new Map();

  function cornerKey(p) {
    return `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  }

  for (const tri of tris) {
    if (!tri.isWall) continue;
    const nbrs = neighbors(tri.r, tri.c);
    const V = tri.verts;
    const edgeVerts = triangleBoundaryEdges(V, trianglePointsUp(tri.r, tri.c));

    for (let ei = 0; ei < 3; ei++) {
      const [nr, nc] = nbrs[ei];
      const neighbor = triMap.get(key(nr, nc));
      const blocksAir = !neighbor || neighbor.isAir;
      if (!blocksAir) continue;

      const a = edgeVerts[ei][0];
      const b = edgeVerts[ei][1];
      const t = norm(sub(b, a));
      let n = norm(perpLeft(sub(b, a)));
      const mid = mul(add(a, b), 0.5);
      const toAir = neighbor?.center ? sub(neighbor.center, mid) : sub(mid, tri.center);
      if (dot(n, toAir) < 0) n = mul(n, -1);

      const edge = {
        id: edges.length,
        a, b, tangent: t, normal: n,
        wallTri: tri,
        airTri: neighbor && neighbor.isAir ? neighbor : null,
        aabb: expandAABB(segmentAABB(a, b), 1),
      };
      edges.push(edge);

      for (const p of [a, b]) {
        const k = cornerKey(p);
        let corner = corners.get(k);
        if (!corner) {
          corner = { id: corners.size, p, edgeIds: [] };
          corners.set(k, corner);
        }
        corner.edgeIds.push(edge.id);
      }
    }
  }

  const cornerList = [...corners.values()];
  for (const c of cornerList) {
    c.aabb = { minX: c.p.x - 1, minY: c.p.y - 1, maxX: c.p.x + 1, maxY: c.p.y + 1 };
  }

  return { side, triH, origin, rows, tris, triMap, edges, corners: cornerList };
}

export function transformHull(localVerts, pos, angle = 0) {
  const verts = localVerts.map(v => add(rotate(v, angle), pos));
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const e = sub(b, a);
    const tangent = norm(e);
    // outward normal for clockwise vertex ordering; inward for CCW.
    // We correct below based on signed area.
    edges.push({ a, b, tangent, normal: norm(perpLeft(e)) });
  }
  const area2 = signedArea2(verts);
  if (area2 > 0) {
    // CCW: outward is right normal.
    for (const e of edges) e.normal = mul(e.normal, -1);
  }
  return { verts, edges, pos, angle };
}

function signedArea2(verts) {
  let s = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    s += cross(a, b);
  }
  return s;
}

function hullAABB(verts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of verts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function sweptHullAABB(localHull, pos0, pos1, angle0, angle1) {
  const h0 = transformHull(localHull, pos0, angle0);
  const h1 = transformHull(localHull, pos1, angle1);
  return expandAABB(mergeAABB(hullAABB(h0.verts), hullAABB(h1.verts)), 2);
}

export function gatherCandidateFeatures(mesh, localHull, startPos, endPos, startAngle = 0, endAngle = 0) {
  const swept = sweptHullAABB(localHull, startPos, endPos, startAngle, endAngle);
  const edges = mesh.edges.filter(e => aabbOverlap(e.aabb, swept));
  const corners = mesh.corners.filter(c => aabbOverlap(c.aabb, swept));
  return { edges, corners, sweptAABB: swept };
}

function pointEdgeTOI(p0, vRel, edge, dt, epsilon = 1e-8) {
  const denom = dot(edge.normal, vRel);
  if (denom >= -epsilon) return null; // not approaching air->wall boundary
  const t = dot(edge.normal, sub(edge.a, p0)) / denom;
  if (t < -epsilon || t > dt + epsilon) return null;
  const hit = add(p0, mul(vRel, t));
  const ab = sub(edge.b, edge.a);
  const u = dot(sub(hit, edge.a), ab) / Math.max(dot(ab, ab), epsilon);
  if (u < -epsilon || u > 1 + epsilon) return null;
  return {
    type: 'vertex-edge',
    time: clamp(t, 0, dt),
    point: hit,
    normal: edge.normal,
    edge,
    u,
  };
}

function pointSegmentDistanceSq(p, a, b) {
  const ab = sub(b, a);
  const denom = Math.max(dot(ab, ab), 1e-12);
  const t = clamp(dot(sub(p, a), ab) / denom, 0, 1);
  const q = add(a, mul(ab, t));
  const d = sub(p, q);
  return { distSq: dot(d, d), t, q };
}

function wallCornerPlayerEdgeTOI(corner, cornerVel, edge, edgeVel, dt, epsilon = 1e-8) {
  const m = edge.normal;
  const q0 = corner.p;
  const r0 = edge.a;
  const vRel = sub(cornerVel, edgeVel);
  const denom = dot(m, vRel);
  if (denom >= -epsilon) return null;
  const t = dot(m, sub(r0, q0)) / denom;
  if (t < -epsilon || t > dt + epsilon) return null;
  const qt = add(q0, mul(cornerVel, t));
  const at = add(edge.a, mul(edgeVel, t));
  const bt = add(edge.b, mul(edgeVel, t));
  const ab = sub(bt, at);
  const u = dot(sub(qt, at), ab) / Math.max(dot(ab, ab), epsilon);
  if (u < -epsilon || u > 1 + epsilon) return null;
  return {
    type: 'edge-corner',
    time: clamp(t, 0, dt),
    point: qt,
    normal: m,
    corner,
    edge,
    u,
  };
}

function advanceState(state, t) {
  return {
    pos: add(state.pos, mul(state.vel, t)),
    angle: state.angle + state.angVel * t,
    vel: state.vel,
    angVel: state.angVel,
  };
}

function localPointVelocityWorld(state, localPt) {
  const r = rotate(localPt, state.angle);
  return add(state.vel, { x: -state.angVel * r.y, y: state.angVel * r.x });
}

function worldPointVelocityOnBody(meshMotion, worldPt) {
  const rel = sub(worldPt, meshMotion.center);
  return add(meshMotion.vel, { x: -meshMotion.angVel * rel.y, y: meshMotion.angVel * rel.x });
}

function chooseBestHit(hits, vel) {
  if (!hits.length) return null;
  hits.sort((a, b) => a.time - b.time);
  const t0 = hits[0].time;
  const tied = hits.filter(h => Math.abs(h.time - t0) < 1e-6);
  if (tied.length === 1) return tied[0];
  let best = tied[0], bestScore = Infinity;
  for (const h of tied) {
    const score = dot(vel, h.normal);
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

export function simulatePlayerVsTriangleMesh({
  mesh,
  player,
  dt,
  meshMotion = { vel: vec(0, 0), angVel: 0, center: vec(0, 0) },
  restitution = 1.0,
  maxImpacts = 6,
}) {
  let state = {
    pos: { ...player.pos },
    angle: player.angle ?? 0,
    vel: { ...player.vel },
    angVel: player.angVel ?? 0,
  };

  let remaining = dt;
  const impactLog = [];

  for (let impactCount = 0; impactCount < maxImpacts && remaining > 1e-6; impactCount++) {
    const predicted = advanceState(state, remaining);
    const candidates = gatherCandidateFeatures(mesh, player.localHull, state.pos, predicted.pos, state.angle, predicted.angle);
    const worldHull = transformHull(player.localHull, state.pos, state.angle);

    const hits = [];

    // player vertex -> wall edge
    for (let vi = 0; vi < player.localHull.length; vi++) {
      const p0 = worldHull.verts[vi];
      const pVel = localPointVelocityWorld(state, player.localHull[vi]);
      for (const edge of candidates.edges) {
        const edgeMid = mul(add(edge.a, edge.b), 0.5);
        const edgeVelMid = worldPointVelocityOnBody(meshMotion, edgeMid);
        const vRel = sub(pVel, edgeVelMid);
        const hit = pointEdgeTOI(p0, vRel, edge, remaining);
        if (hit) {
          hit.playerVertex = vi;
          hit.relativeVel = vRel;
          hits.push(hit);
        }
      }
    }

    // wall corner -> player edge
    for (const corner of candidates.corners) {
      const cVel = worldPointVelocityOnBody(meshMotion, corner.p);
      for (let ei = 0; ei < worldHull.edges.length; ei++) {
        const edge = worldHull.edges[ei];
        const edgeLocalA = player.localHull[ei];
        const edgeVel = localPointVelocityWorld(state, edgeLocalA);
        const hit = wallCornerPlayerEdgeTOI(corner, cVel, edge, edgeVel, remaining);
        if (hit) {
          hit.playerEdgeIndex = ei;
          hit.relativeVel = sub(cVel, edgeVel);
          // reflection should use the blocking wall normal if available.
          let bestWallNormal = null;
          let bestDist = Infinity;
          for (const edgeId of corner.edgeIds) {
            const we = mesh.edges[edgeId];
            const d = pointSegmentDistanceSq(hit.point, we.a, we.b).distSq;
            if (d < bestDist) {
              bestDist = d;
              bestWallNormal = we.normal;
            }
          }
          if (bestWallNormal) hit.normal = bestWallNormal;
          hits.push(hit);
        }
      }
    }

    const hit = chooseBestHit(hits, state.vel);
    if (!hit) {
      state = predicted;
      break;
    }

    const advanceT = Math.max(0, hit.time - 1e-5);
    state = advanceState(state, advanceT);

    const contactPointVelMesh = worldPointVelocityOnBody(meshMotion, hit.point);
    const relVelAtContact = sub(state.vel, contactPointVelMesh);
    const relReflected = reflectVelocity(relVelAtContact, hit.normal, restitution);
    state.vel = add(contactPointVelMesh, relReflected);

    impactLog.push({
      t: dt - remaining + hit.time,
      type: hit.type,
      point: hit.point,
      normal: hit.normal,
    });

    remaining -= hit.time;
    if (remaining < 1e-6) break;
  }

  return { state, impacts: impactLog };
}
