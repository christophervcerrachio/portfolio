// The public gardens' ground, graded: their mounds and the banks round their ponds (dev\world\parks.py Grade), each a
// bump [x, z, radius, height] in <city>-grade.json; the ground there is raised by the highest bump over it,
// h * s(1 - d / r), s the smoothstep - the same sum the gardens' lawns, walks, trees and benches were laid on, so the
// walker stands on the mound he sees.
const CELL = 64;

/** A promise of gradeAt(x, z) (m to add to the land there), or null where no city has any. */
export function loadParkGrade(base, cities) {
  return Promise.all(cities.map((c) => fetch(base + 'assets/world/cities/' + c + '-grade.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then((all) => {
      const bumps = [], grid = new Map();
      for (const J of all) for (const b of J?.bumps ?? []) {
        const k = bumps.length; bumps.push(b);
        const [x, z, r] = b;
        for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
          for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
            const key = i * 100003 + j; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(k);
          }
      }
      if (!bumps.length) return null;
      return (x, z) => {
        const l = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
        if (!l) return 0;
        let best = 0;
        for (const k of l) {
          const [bx, bz, r, h] = bumps[k], d = Math.hypot(x - bx, z - bz);
          if (d >= r) continue;
          const t = 1 - d / r, v = h * t * t * (3 - 2 * t);
          if (v > best) best = v;
        }
        return best;
      };
    });
}
