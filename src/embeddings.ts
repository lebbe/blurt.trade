import pgvector from 'pgvector'
import { db } from './db.ts'

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
    console.error('Embedding blurts failed:', error)
  })
  return queue
}

async function runPending(): Promise<void> {
  for (;;) {
    const { rows } = await db().query<{ id: number; text: string }>(
      'SELECT id, text FROM blurts WHERE embedding IS NULL ORDER BY id LIMIT $1',
      [batchSize],
    )
    if (rows.length === 0) {
      return
    }

    const vectors = await embedder(rows.map((row) => row.text))
    await db().query(
      `UPDATE blurts b SET embedding = v.embedding::vector
       FROM unnest($1::bigint[], $2::text[]) AS v(id, embedding) WHERE b.id = v.id`,
      [rows.map((row) => row.id), vectors.map((vector) => pgvector.toSql(vector))],
    )
  }
}

// all-MiniLM-L6-v2 runs locally (no API key, ~23 MB, downloaded once on first use).
function localModelEmbedder(): Embedder {
  type Extractor = (texts: string[], options: object) => Promise<{ tolist(): number[][] }>
  let model: Promise<Extractor> | undefined

  return async (texts) => {
    model ??= import('@huggingface/transformers')
      .then(({ pipeline }) =>
        pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' }),
      )
      .then((extractor) => extractor as unknown as Extractor)
      .catch((error: unknown) => {
        model = undefined // retry loading on the next run instead of failing forever
        throw error
      })
    const extractor = await model
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return output.tolist()
  }
}
