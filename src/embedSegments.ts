import { getEmbedder } from './embedder'

export const EMBEDDING_MODELS = [
  { id: 'Xenova/all-MiniLM-L6-v2',                      label: 'MiniLM-L6 (fast, ~22 MB)',         default: false },
  { id: 'Xenova/all-MiniLM-L12-v2',                     label: 'MiniLM-L12 (balanced, ~33 MB)',    default: true },
  { id: 'Xenova/all-mpnet-base-v2',                      label: 'MPNet-base (quality, ~420 MB)',    default: false },
  { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', label: 'Multilingual MiniLM (~125 MB)',    default: false },
  { id: 'onnx-community/embeddinggemma-300m-ONNX',       label: 'EmbeddingGemma-300m (~310 MB)',    default: false },
] as const

export type EmbeddingModelId = typeof EMBEDDING_MODELS[number]['id']

export async function getEmbeddings(
  texts: string[],
  onProgress: (loaded: number, total: number, phase: 'model-loading' | 'embedding') => void,
  modelId: EmbeddingModelId = 'Xenova/all-MiniLM-L6-v2'
): Promise<Float32Array[]> {
  const embed = await getEmbedder(modelId, pct => onProgress(pct, 100, 'model-loading'))
  const results: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    onProgress(i, texts.length, 'embedding')
    results.push(await embed(texts[i]))
  }
  return results
}
