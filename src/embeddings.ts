import pgvector from 'pgvector'
import { pathToFileURL } from 'node:url'
import { db } from './db.ts'
import { errorFields, log } from './logging.ts'

// Blurts are saved first and embedded afterwards, so posting never waits for (or fails
// because of) the model. Anything left without an embedding — e.g. after a crash — is
// picked up by the next run; the server also triggers a run at startup.

export type Embedder = (texts: string[]) => Promise<number[][]>

const batchSize = 32

let embedder: Embedder = localModelEmbedder()
let queue: Promise<void> = Promise.resolve()

// Tests swap in a fast, deterministic embedder.
export function setEmbedder(next: Embedder): void {
  embedder = next
}

// Queues a run that embeds every blurt still missing an embedding.
// The returned promise settles when that run is done; it never rejects.
export function embedPendingBlurts(): Promise<void> {
  queue = queue.then(runPending).catch((error: unknown) => {
    log('error', 'embedding blurts failed', { error: errorFields(error) })
  })
  return queue
}

async function runPending(): Promise<void> {
  for (;;) {
    const { rows } = await db().query<{ id: number; text: string }>(
      'SELECT id, text FROM blurts WHERE embedding IS NULL AND deleted_at IS NULL ORDER BY id LIMIT $1',
      [batchSize],
    )
    if (rows.length === 0) {
      return
    }

    const vectors = await embedder(rows.map((row) => row.text))
    // A blurt deleted meanwhile stays without an embedding.
    await db().query(
      `UPDATE blurts b SET embedding = v.embedding::vector
       FROM unnest($1::bigint[], $2::text[]) AS v(id, embedding)
       WHERE b.id = v.id AND b.deleted_at IS NULL`,
      [rows.map((row) => row.id), vectors.map((vector) => pgvector.toSql(vector))],
    )
  }
}

// all-MiniLM-L6-v2 runs locally (no API key, ~23 MB). It is downloaded from the Hugging Face
// Hub on first use and cached in MODEL_CACHE_DIR (default: inside node_modules, which
// `npm ci` wipes). Deploys download it beforehand with `npm run prefetch-model`, so the
// server never waits for (or depends on) the Hub. Loaded, it takes roughly 100–200 MB of
// memory in this process.
type Extractor = (texts: string[], options: object) => Promise<{ tolist(): number[][] }>

let model: Promise<Extractor> | undefined

export function loadModel(): Promise<Extractor> {
  model ??= import('@huggingface/transformers')
    .then(({ env, pipeline }) => {
      if (process.env.MODEL_CACHE_DIR) {
        env.cacheDir = process.env.MODEL_CACHE_DIR
      }
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' })
    })
    .then((extractor) => extractor as unknown as Extractor)
    .catch((error: unknown) => {
      model = undefined // retry loading on the next run instead of failing forever
      throw error
    })
  return model
}

// A model that fails to load only fails the embedding run: blurts stay saved without an
// embedding, and the next run (the next post, or the periodic catch-up in src/server.ts)
// tries again.
function localModelEmbedder(): Embedder {
  return async (texts) => {
    const extractor = await loadModel()
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return output.tolist()
  }
}

// `npm run prefetch-model`: downloads the model into the cache and checks that it loads.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const extractor = await loadModel()
  const output = await extractor(['hello'], { pooling: 'mean', normalize: true })
  console.log(`Embedding model ready (${output.tolist()[0].length} dimensions)`)
}
