// Reading a picture of a page, for scanned PDFs and DocuSign pages. Shared by the browser and
// scripts/ocr.mjs, which measures it. TrOCR, the model that reads the text, only reads one line
// at a time, so the page is straightened and cut into lines and groups of words first. It was
// trained on receipts and writes only capital letters, so `tidy` turns that back into sentences.

/** The grey level that best splits ink from paper (Otsu's method): darker than this is ink. */
export function otsu(g) {
  const h = new Array(256).fill(0);
  for (const v of g) h[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * h[i];
  let sB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += h[i];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sB += i * h[i];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) { best = v; t = i; }
  }
  return t + 1;
}

/** The tilt, from -2 to 2 degrees, that makes rows of ink line up best. In radians. */
export function skew(g, w, h, t) {
  let best = { a: 0, s: -1 };
  for (let deg = -2; deg <= 2.001; deg += 0.1) {
    const a = (deg * Math.PI) / 180, tan = Math.tan(a);
    const rows = new Float64Array(h + w);
    // Every row, so that at 0 degrees no row of the histogram is left empty by the sampling.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x += 2) if (g[y * w + x] < t) rows[Math.round(y - x * tan) + w]++;
    let s = 0;
    for (let i = 1; i < rows.length; i++) s += (rows[i] - rows[i - 1]) ** 2;
    if (s > best.s) best = { a, s };
  }
  return best.a;
}

/** Turns the page so that ink tilted by `a` (as `skew` measures it) lies level. */
export function rotate(g, w, h, a) {
  const out = new Uint8Array(w * h).fill(255);
  const c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = c * (x - cx) - s * (y - cy) + cx, sy = s * (x - cx) + c * (y - cy) + cy;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= w - 1 || iy >= h - 1) continue;
      const fx = sx - ix, fy = sy - iy, i = iy * w + ix;
      out[y * w + x] = (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
    }
  }
  return out;
}

/** Text lines, each cut into groups of words no wider than `max` times the line's height. */
export function pieces(g, w, h, t, max = 10) {
  const rows = new Uint32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y * w + x] < t) rows[y]++;
  const lines = [];
  let y0 = -1;
  for (let y = 0; y <= h; y++) {
    const ink = y < h && rows[y] > Math.max(2, w * 0.002);
    if (ink && y0 < 0) y0 = y;
    if (!ink && y0 >= 0) { if (y - y0 > 8) lines.push([y0, y]); y0 = -1; }
  }
  return lines.map(([a, b]) => {
    const cols = new Uint32Array(w);
    for (let y = a; y < b; y++) for (let x = 0; x < w; x++) if (g[y * w + x] < t) cols[x]++;
    const gap = Math.max(4, (b - a) * 0.25), words = [];
    let s = -1, blank = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && cols[x]) { if (s < 0) s = x; blank = 0; } else if (s >= 0 && (x === w || ++blank >= gap)) { words.push([s, x - blank + (x === w ? 0 : 1)]); s = -1; blank = 0; }
    }
    const out = [];
    for (const [x0, x1] of words) {
      const last = out[out.length - 1];
      if (last && x1 - last[0] <= max * (b - a)) last[1] = x1; else out.push([x0, x1]);
    }
    return out.map(([x0, x1]) => ({ x0, x1, y0: a, y1: b }));
  });
}

/** All-capital text back into sentences: lower case, then a capital to start each one. */
export const tidy = (t) => t.toLowerCase().replace(/(^|[.!?:]\s+|\n\s*(?:\(?[0-9a-z]{1,3}(?:\.[0-9]+)*[.)]?\s+)?)([a-z])/g, (m, p, c) => p + c.toUpperCase());

/** RGBA pixels (a canvas's ImageData) to grey. */
export function grey(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return g;
}

/**
 * Reads one page. `recognise(rgb, w, h)` reads one cropped line of words and returns its text.
 * @param {{g: Uint8Array, w: number, h: number}} page  grey pixels
 */
export async function readPage({ g, w, h }, recognise, onPiece) {
  const t = otsu(g);
  const a = skew(g, w, h, t);
  if (Math.abs(a) > 0.001) g = rotate(g, w, h, a);
  const lines = pieces(g, w, h, t);
  const total = lines.reduce((n, l) => n + l.length, 0);
  let done = 0;
  const out = [];
  for (const line of lines) {
    const words = [];
    for (const p of line) {
      const pad = Math.round((p.y1 - p.y0) * 0.15);
      const x0 = Math.max(0, p.x0 - pad), x1 = Math.min(w, p.x1 + pad), y0 = Math.max(0, p.y0 - pad), y1 = Math.min(h, p.y1 + pad);
      const cw = x1 - x0, ch = y1 - y0, rgb = new Uint8ClampedArray(cw * ch * 3);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) rgb.fill(g[(y0 + y) * w + x0 + x], (y * cw + x) * 3, (y * cw + x) * 3 + 3);
      words.push(await recognise(rgb, cw, ch));
      onPiece?.(++done / total);
    }
    out.push(words.join(' '));
  }
  return tidy(out.join('\n'));
}

export const READER = { id: 'Xenova/trocr-small-printed', dtype: 'q8', mb: 64 };

/** TrOCR through transformers.js (the module is passed in, as in src/embed.js). */
export async function reader(tf, options = {}) {
  const [processor, tokenizer, model] = await Promise.all([
    tf.AutoProcessor.from_pretrained(READER.id, options),
    tf.AutoTokenizer.from_pretrained(READER.id, options),
    tf.VisionEncoderDecoderModel.from_pretrained(READER.id, { dtype: READER.dtype, ...options }),
  ]);
  return async (rgb, w, h) => {
    const { pixel_values } = await processor(new tf.RawImage(rgb, w, h, 3));
    const ids = await model.generate({ pixel_values, max_new_tokens: 48 });
    return tokenizer.batch_decode(ids, { skip_special_tokens: true })[0].trim();
  };
}
