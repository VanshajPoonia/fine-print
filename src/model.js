// EmbeddingGemma in this tab, through transformers.js. WebGPU when the browser has it,
// WASM otherwise. Same q4 weights either way, which are the weights tests/eval.mjs measured.
import * as tf from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
import { embedder, MODELS } from './embed.js';

tf.env.allowLocalModels = false;
tf.env.useBrowserCache = true;

export const SIZE_MB = MODELS.gemma.mb;

let embed = null;
let loading = null;
let device = null;
const listeners = new Set();

export const backend = () => device;

async function webgpu() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

export function load(onProgress) {
  if (onProgress) listeners.add(onProgress);
  loading ??= (async () => {
    const files = new Map();
    const progress_callback = (e) => {
      if (e.status !== 'progress' || !e.total) return;
      files.set(e.file, [e.loaded, e.total]);
      let l = 0, t = 0;
      for (const [a, b] of files.values()) { l += a; t += b; }
      listeners.forEach((fn) => fn(l / t));
    };
    const order = (await webgpu()) ? ['webgpu', 'wasm'] : ['wasm'];
    let lastErr;
    for (const d of order) {
      try {
        const e = await embedder(tf, 'gemma', { device: d, progress_callback });
        await e(['warm up']); // fail here, not halfway through a contract, if a backend cannot run the model
        embed = e;
        device = d;
        return embed;
      } catch (err) { lastErr = err; console.warn(`EmbeddingGemma on ${d} failed`, err); }
    }
    throw lastErr;
  })().catch((err) => { loading = null; throw err; });
  return loading;
}
