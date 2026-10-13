// Turns clauses into vectors. Shared by the browser and by the Node scripts that train and
// test the classifier, so both run exactly the same model, prompt and quantisation.
// The caller passes in transformers.js (from jsDelivr in the browser, from npm in Node).

export const MODELS = {
  // What ships. EmbeddingGemma's ONNX export ends in its own pooling and projection layers
  // and returns a normalised `sentence_embedding`, so it is called as a model, not through
  // the feature-extraction pipeline (which would mean-pool raw hidden states instead).
  // The 4-bit build is what the tests measure and what runs on WebGPU. Its quantised token
  // lookup (GatherBlockQuantized) is missing from the browser's WASM runtime, so browsers
  // without WebGPU load the "no_gather" 4-bit build instead, which keeps that table
  // unquantised. scripts/fallback.mjs measures how often the two agree.
  gemma: {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    wasmFile: 'model_no_gather',
    dtype: 'q4',
    prefix: 'task: classification | query: ',
    dims: 768,
    mb: 197,
  },
  // The comparison: a model a sixth of the size.
  bge: {
    id: 'Xenova/bge-small-en-v1.5',
    dtype: 'q8',
    prefix: '',
    dims: 384,
    mb: 34,
  },
};

const BATCH = 16;

/**
 * @param {object} tf  the transformers.js module
 * @param {'gemma'|'bge'} key
 * @returns {Promise<(texts: string[], onBatch?: (done:number)=>void) => Promise<Float32Array[]>>}
 */
export async function embedder(tf, key, { device, file, progress_callback } = {}) {
  const m = MODELS[key];
  const model_file_name = file ?? (device === 'wasm' ? m.wasmFile : undefined);
  const tokenizer = await tf.AutoTokenizer.from_pretrained(m.id, { progress_callback });
  const model = await tf.AutoModel.from_pretrained(m.id, { dtype: m.dtype, model_file_name, device, progress_callback });

  return async (texts, onBatch) => {
    // Batches of similar length waste far less work on padding: about twice as fast on a
    // real contract, where clauses run from ten words to two hundred.
    const order = texts.map((t, i) => i).sort((a, b) => texts[a].length - texts[b].length);
    const out = new Array(texts.length);
    for (let i = 0; i < order.length; i += BATCH) {
      const ids = order.slice(i, i + BATCH);
      const inputs = await tokenizer(ids.map((j) => m.prefix + texts[j]), { padding: true, truncation: true, max_length: 512 });
      const res = await model(inputs);
      let vecs;
      if (res.sentence_embedding) {
        vecs = res.sentence_embedding;
      } else {
        // BERT-style: the [CLS] token, normalised (what bge was trained for).
        const h = res.last_hidden_state;
        vecs = h.slice(null, 0, null).normalize(2, -1);
      }
      const d = vecs.dims[1];
      const data = vecs.data;
      ids.forEach((j, k) => { out[j] = Float32Array.from(data.subarray(k * d, (k + 1) * d)); });
      onBatch?.(Math.min(i + BATCH, texts.length));
    }
    return out;
  };
}
