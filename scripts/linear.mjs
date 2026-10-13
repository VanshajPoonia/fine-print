// A logistic-regression head per flag, on top of frozen embeddings. Plain JS, no ML library:
// it is a dot product and a sigmoid, which is also all the browser has to run.

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * @param {Float32Array[]} X  embeddings
 * @param {number[][]} Y      Y[i][k] = 1 if example i carries flag k
 * @returns {{W: Float32Array[], b: number[]}}
 */
export function fit(X, Y, { epochs = 40, batch = 128, lr = 0.003, decay = 1e-4, seed = 1 } = {}) {
  const n = X.length, d = X[0].length, k = Y[0].length;
  const W = Array.from({ length: k }, () => new Float32Array(d));
  const b = new Array(k).fill(0);

  // Positives are rare (a few hundred out of ~27,000), so each one counts for more.
  // Square-root weighting: enough to stop the heads predicting "no" for everything,
  // not so much that every clause looks suspicious.
  const pos = Array.from({ length: k }, (_, j) => Y.reduce((s, y) => s + y[j], 0));
  const wPos = pos.map((p) => Math.min(30, Math.sqrt((n - p) / Math.max(p, 1))));

  // Adam state.
  const mW = W.map(() => new Float32Array(d)), vW = W.map(() => new Float32Array(d));
  const mb = new Array(k).fill(0), vb = new Array(k).fill(0);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let step = 0;

  let rnd = seed;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const order = Array.from({ length: n }, (_, i) => i);
  const gW = W.map(() => new Float32Array(d));
  const gb = new Array(k);

  for (let e = 0; e < epochs; e++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let s = 0; s < n; s += batch) {
      const idx = order.slice(s, s + batch);
      for (let j = 0; j < k; j++) { gW[j].fill(0); gb[j] = 0; }
      for (const i of idx) {
        const x = X[i];
        for (let j = 0; j < k; j++) {
          let z = b[j];
          const w = W[j];
          for (let t = 0; t < d; t++) z += w[t] * x[t];
          const y = Y[i][j];
          const g = (sigmoid(z) - y) * (y ? wPos[j] : 1);
          const gw = gW[j];
          for (let t = 0; t < d; t++) gw[t] += g * x[t];
          gb[j] += g;
        }
      }
      step++;
      const m = idx.length;
      const c1 = 1 - b1 ** step, c2 = 1 - b2 ** step;
      for (let j = 0; j < k; j++) {
        const w = W[j], gw = gW[j], mw = mW[j], vw = vW[j];
        for (let t = 0; t < d; t++) {
          const g = gw[t] / m + decay * w[t];
          mw[t] = b1 * mw[t] + (1 - b1) * g;
          vw[t] = b2 * vw[t] + (1 - b2) * g * g;
          w[t] -= (lr * (mw[t] / c1)) / (Math.sqrt(vw[t] / c2) + eps);
        }
        const g = gb[j] / m;
        mb[j] = b1 * mb[j] + (1 - b1) * g;
        vb[j] = b2 * vb[j] + (1 - b2) * g * g;
        b[j] -= (lr * (mb[j] / c1)) / (Math.sqrt(vb[j] / c2) + eps);
      }
    }
  }
  return { W, b };
}

export { predict } from '../src/scan.js';
