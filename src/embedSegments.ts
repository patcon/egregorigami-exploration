// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any

let pipelineInstance: AnyPipeline | null = null

export async function getEmbeddings(
  texts: string[],
  onProgress: (loaded: number, total: number, phase: 'model-loading' | 'embedding') => void
): Promise<Float32Array[]> {
  if (!pipelineInstance) {
    const { pipeline } = await import('@huggingface/transformers')
    pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      progress_callback: (info: any) => {
        const pct = info?.progress ?? 0
        onProgress(Math.round(pct), 100, 'model-loading')
      },
    })
  }

  const results: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    onProgress(i, texts.length, 'embedding')
    const output = await pipelineInstance(texts[i], { pooling: 'mean', normalize: true })
    results.push(output.data as Float32Array)
  }
  return results
}
