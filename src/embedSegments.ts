// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any

export const EMBEDDING_MODELS = [
  { id: 'Xenova/all-MiniLM-L6-v2',                      label: 'MiniLM-L6 (fast, ~22 MB)',         default: false },
  { id: 'Xenova/all-MiniLM-L12-v2',                     label: 'MiniLM-L12 (balanced, ~33 MB)',    default: true },
  { id: 'Xenova/all-mpnet-base-v2',                      label: 'MPNet-base (quality, ~420 MB)',    default: false },
  { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', label: 'Multilingual MiniLM (~125 MB)',    default: false },
] as const

export type EmbeddingModelId = typeof EMBEDDING_MODELS[number]['id']

// Cache pipelines per model so switching back doesn't re-download
const pipelineCache = new Map<string, AnyPipeline>()

export async function getEmbeddings(
  texts: string[],
  onProgress: (loaded: number, total: number, phase: 'model-loading' | 'embedding') => void,
  modelId: EmbeddingModelId = 'Xenova/all-MiniLM-L6-v2'
): Promise<Float32Array[]> {
  if (!pipelineCache.has(modelId)) {
    const { pipeline } = await import('@huggingface/transformers')
    const instance = await pipeline('feature-extraction', modelId, {
      progress_callback: (info: unknown) => {
        const pct = (info as { progress?: number })?.progress ?? 0
        onProgress(Math.round(pct), 100, 'model-loading')
      },
    })
    pipelineCache.set(modelId, instance)
  }

  const pipe = pipelineCache.get(modelId)!
  const results: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    onProgress(i, texts.length, 'embedding')
    const output = await pipe(texts[i], { pooling: 'mean', normalize: true })
    results.push(output.data as Float32Array)
  }
  return results
}
