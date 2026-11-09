import { loadTransformers } from './loadTransformers'

/** Embeds one text into a unit-length vector. */
export type Embed = (text: string) => Promise<Float32Array>

/**
 * Models that can't go through the `feature-extraction` pipeline with mean
 * pooling. EmbeddingGemma pools and projects internally (its ONNX graph outputs
 * `sentence_embedding`), and expects a task prefix on every input. Its
 * activations don't support fp16, so q8 is the browser-friendly choice
 * (~310 MB; fp32 is ~1.2 GB).
 */
const SENTENCE_EMBEDDING_MODELS: Record<string, { dtype: 'fp32' | 'q8' | 'q4'; prefix: string }> = {
  // "Clustering" prompt from the model card: the 3D layout groups segments by topic
  'onnx-community/embeddinggemma-300m-ONNX': { dtype: 'q8', prefix: 'task: clustering | query: ' },
}

const cache = new Map<string, Promise<Embed>>()

/**
 * The embed function for a model, loading it on first use (cached per model,
 * so switching back doesn't re-download). `onProgress` gets 0–100 while
 * the model downloads.
 */
export function getEmbedder(modelId: string, onProgress: (pct: number) => void): Promise<Embed> {
  let embedder = cache.get(modelId)
  if (!embedder) {
    embedder = loadEmbedder(modelId, onProgress)
    cache.set(modelId, embedder)
    embedder.catch(() => cache.delete(modelId)) // let a failed download be retried
  }
  return embedder
}

async function loadEmbedder(modelId: string, onProgress: (pct: number) => void): Promise<Embed> {
  const transformers = await loadTransformers()
  const progress_callback = (info: unknown) => onProgress(Math.round((info as { progress?: number })?.progress ?? 0))

  const special = SENTENCE_EMBEDDING_MODELS[modelId]
  if (special) {
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId, { progress_callback })
    const model = await transformers.AutoModel.from_pretrained(modelId, { dtype: special.dtype, progress_callback })
    return async (text: string) => {
      const inputs = await tokenizer([special.prefix + text], { padding: true, truncation: true })
      const { sentence_embedding } = await model(inputs)
      return normalize(sentence_embedding.data as Float32Array)
    }
  }

  const pipe = await transformers.pipeline('feature-extraction', modelId, { progress_callback })
  return async (text: string) => {
    const output = await pipe(text, { pooling: 'mean', normalize: true })
    return output.data as Float32Array
  }
}

function normalize(v: Float32Array) {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}
