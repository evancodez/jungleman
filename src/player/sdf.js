// Signed-distance modelling for the character: smooth-blended primitives
// (round cones, ellipsoids, capsules) polygonised with surface nets into one
// continuous mesh. Evaluation is culled per block so building a full body at
// ~1cm resolution takes a fraction of a second.

/** Polynomial smooth minimum. */
export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Smooth subtraction of b from a. */
export function ssub(a, b, k) {
  if (k <= 0) return Math.max(a, -b);
  const h = Math.max(k - Math.abs(-b - a), 0) / k;
  return Math.max(a, -b) + h * h * k * 0.25;
}

// ------------------------------------------------------------ primitives
// Each primitive: { kind, ..., k (blend), sub (subtract), bone, tag, bound: {c:[x,y,z], r} }

export function roundCone(a, b, r1, r2, o = {}) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return { kind: 'rcone', a, b, r1, r2, ba, l2, rr, a2, il2, ...o, bound: { c, r: Math.sqrt(l2) / 2 + Math.max(r1, r2) } };
}

export function ellipsoid(c, r, o = {}) {
  // Optional rotation as a 3x3 row-major matrix (world -> local).
  return { kind: 'ell', c, r, rot: o.rot || null, ...o, bound: { c, r: Math.max(r[0], r[1], r[2]) } };
}

export function capsule(a, b, r, o = {}) { return roundCone(a, b, r, r, o); }

function evalPrim(p, x, y, z) {
  if (p.kind === 'rcone') {
    // iq's exact round cone.
    const px = x - p.a[0], py = y - p.a[1], pz = z - p.a[2];
    const ba = p.ba;
    const yv = px * ba[0] + py * ba[1] + pz * ba[2];
    const z2 = yv - p.l2;
    const qx = px * p.l2 - ba[0] * yv, qy = py * p.l2 - ba[1] * yv, qz = pz * p.l2 - ba[2] * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * p.l2;
    const zz = z2 * z2 * p.l2;
    const k = Math.sign(p.rr) * p.rr * p.rr * x2;
    if (Math.sign(z2) * p.a2 * zz > k) return Math.sqrt(x2 + zz) * p.il2 - p.r2;
    if (Math.sign(yv) * p.a2 * y2 < k) return Math.sqrt(x2 + y2) * p.il2 - p.r1;
    return (Math.sqrt(x2 * p.a2 * p.il2) + yv * p.rr) * p.il2 - p.r1;
  }
  // Ellipsoid (iq's approximation).
  let lx = x - p.c[0], ly = y - p.c[1], lz = z - p.c[2];
  if (p.rot) {
    const m = p.rot;
    const tx = m[0] * lx + m[1] * ly + m[2] * lz;
    const ty = m[3] * lx + m[4] * ly + m[5] * lz;
    const tz = m[6] * lx + m[7] * ly + m[8] * lz;
    lx = tx; ly = ty; lz = tz;
  }
  const r = p.r;
  const k0 = Math.sqrt((lx / r[0]) ** 2 + (ly / r[1]) ** 2 + (lz / r[2]) ** 2);
  const k1 = Math.sqrt((lx / (r[0] * r[0])) ** 2 + (ly / (r[1] * r[1])) ** 2 + (lz / (r[2] * r[2])) ** 2);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

/** Combine primitives in order (smooth unions, smooth subtractions). */
function evalList(list, x, y, z, out) {
  let d = 1e9, best = 1e9, tag = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const di = evalPrim(p, x, y, z);
    if (p.sub) d = ssub(d, di, p.k || 0);
    else {
      d = d === 1e9 ? di : smin(d, di, p.k || 0);
      if (di < best) { best = di; tag = p; }
    }
  }
  if (out) out.prim = tag;
  return d;
}

/** Distance to the whole blended surface. */
export function sdfEval(list, x, y, z) { return evalList(list, x, y, z); }

/** Distance from p to a primitive (exported for skin weights). */
export function primDist(p, x, y, z) { return evalPrim(p, x, y, z); }

/**
 * Polygonise the union of `prims` with surface nets.
 * Returns { positions, normals, prims } (prims: dominant primitive per vertex).
 */
export function buildSurface(prims, cell = 0.01, pad = 0.03) {
  // Bounds.
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    if (p.sub) continue;
    for (let a = 0; a < 3; a++) {
      mn[a] = Math.min(mn[a], p.bound.c[a] - p.bound.r - pad);
      mx[a] = Math.max(mx[a], p.bound.c[a] + p.bound.r + pad);
    }
  }
  const B = 4; // fine cells per block
  const nb = [0, 1, 2].map((a) => Math.ceil((mx[a] - mn[a]) / (cell * B)));
  const n = nb.map((v) => v * B); // fine cells per axis
  const NX = n[0] + 1, NY = n[1] + 1, NZ = n[2] + 1;
  const field = new Float32Array(NX * NY * NZ).fill(NaN);
  const blockList = new Array(nb[0] * nb[1] * nb[2]).fill(null);
  const idx = (i, j, k) => (k * NY + j) * NX + i;
  const R = Math.sqrt(3) * cell * B * 0.5;
  const kmax = Math.max(...prims.map((p) => p.k || 0));
  const dists = new Float64Array(prims.length);
  // ---- pass 1: per-block culling and fine sampling near the surface
  for (let bz = 0; bz < nb[2]; bz++) for (let by = 0; by < nb[1]; by++) for (let bx = 0; bx < nb[0]; bx++) {
    const cx = mn[0] + (bx + 0.5) * B * cell, cy = mn[1] + (by + 0.5) * B * cell, cz = mn[2] + (bz + 0.5) * B * cell;
    let dmin = Infinity;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const bc = p.bound.c;
      const bd = Math.hypot(cx - bc[0], cy - bc[1], cz - bc[2]) - p.bound.r;
      if (bd > 2 * R + kmax + 0.05 && !p.sub) { dists[i] = Infinity; continue; }
      dists[i] = evalPrim(p, cx, cy, cz);
      if (!p.sub) dmin = Math.min(dmin, dists[i]);
    }
    if (dmin - kmax * 0.25 > R + 0.002) continue; // empty block
    const local = [];
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      if (p.sub) { if (dists[i] < R + (p.k || 0) + 0.01) local.push(p); }
      else if (dists[i] < dmin + 2 * R + (p.k || 0) + 0.002) local.push(p);
    }
    const dc = evalList(local, cx, cy, cz);
    if (dc < -R - 0.002) continue; // solid interior
    blockList[(bz * nb[1] + by) * nb[0] + bx] = local;
    for (let k = 0; k <= B; k++) for (let j = 0; j <= B; j++) for (let i = 0; i <= B; i++) {
      const gi = bx * B + i, gj = by * B + j, gk = bz * B + k;
      const id = idx(gi, gj, gk);
      if (!Number.isNaN(field[id])) continue;
      field[id] = evalList(local, mn[0] + gi * cell, mn[1] + gj * cell, mn[2] + gk * cell);
    }
  }
  // ---- pass 2: one vertex per sign-changing cell
  const cellVert = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  const cidx = (i, j, k) => (k * n[1] + j) * n[0] + i;
  const pos = [];
  const vertBlock = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let bz = 0; bz < nb[2]; bz++) for (let by = 0; by < nb[1]; by++) for (let bx = 0; bx < nb[0]; bx++) {
    const local = blockList[(bz * nb[1] + by) * nb[0] + bx];
    if (!local) continue;
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const gi = bx * B + i, gj = by * B + j, gk = bz * B + k;
      let inside = 0, bad = false;
      for (let c = 0; c < 8; c++) {
        const v = field[idx(gi + corners[c][0], gj + corners[c][1], gk + corners[c][2])];
        if (Number.isNaN(v)) { bad = true; break; }
        cv[c] = v;
        if (v < 0) inside++;
      }
      if (bad || inside === 0 || inside === 8) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [a, b] of edges) {
        const va = cv[a], vb = cv[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
        sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
        sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
        cnt++;
      }
      cellVert[cidx(gi, gj, gk)] = pos.length / 3;
      pos.push(mn[0] + (gi + sx / cnt) * cell, mn[1] + (gj + sy / cnt) * cell, mn[2] + (gk + sz / cnt) * cell);
      vertBlock.push(local);
    }
  }
  // ---- pass 3: quads across sign-changing edges
  const index = [];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    if (cellVert[cidx(i, j, k)] < 0) continue;
    const v0 = field[idx(i, j, k)];
    if (Number.isNaN(v0)) continue;
    // Edge along x from corner (i,j,k): shared by cells (i, j-1..j, k-1..k).
    for (let axis = 0; axis < 3; axis++) {
      const o = [0, 0, 0]; o[axis] = 1;
      const v1 = field[idx(i + o[0], j + o[1], k + o[2])];
      if (Number.isNaN(v1) || (v0 < 0) === (v1 < 0)) continue;
      // The two other axes.
      const u = (axis + 1) % 3, w = (axis + 2) % 3;
      const c = [i, j, k];
      const q = [];
      let ok = true;
      for (const [du, dw] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const cc = c.slice();
        cc[u] -= du; cc[w] -= dw;
        if (cc[0] < 0 || cc[1] < 0 || cc[2] < 0 || cc[0] >= n[0] || cc[1] >= n[1] || cc[2] >= n[2]) { ok = false; break; }
        const vi = cellVert[cidx(cc[0], cc[1], cc[2])];
        if (vi < 0) { ok = false; break; }
        q.push(vi);
      }
      if (!ok) continue;
      if (v0 < 0) index.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      else index.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
  }
  // ---- normals from the field gradient, dominant primitive per vertex
  const nv = pos.length / 3;
  const nrm = new Float32Array(nv * 3);
  const dom = new Array(nv);
  const e = cell * 0.5;
  const tmp = {};
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const L = vertBlock[v];
    const gx = evalList(L, x + e, y, z) - evalList(L, x - e, y, z);
    const gy = evalList(L, x, y + e, z) - evalList(L, x, y - e, z);
    const gz = evalList(L, x, y, z + e) - evalList(L, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[v * 3] = gx / l; nrm[v * 3 + 1] = gy / l; nrm[v * 3 + 2] = gz / l;
    evalList(L, x, y, z, tmp);
    dom[v] = tmp.prim;
  }
  // Relax vertices toward the true surface along the normal (one Newton step).
  for (let v = 0; v < nv; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const d = evalList(vertBlock[v], x, y, z);
    pos[v * 3] -= nrm[v * 3] * d; pos[v * 3 + 1] -= nrm[v * 3 + 1] * d; pos[v * 3 + 2] -= nrm[v * 3 + 2] * d;
  }
  return { positions: new Float32Array(pos), normals: nrm, index, prims: dom };
}
