import { parentPort } from 'node:worker_threads'
import { encodeShapes, pictureFromUpload } from './picture.ts'

// Runs in a worker thread of picture-pool.ts: one upload in, its drawing (encoded) out.
parentPort!.on(
  'message',
  async ({ id, upload, square }: { id: number; upload: ArrayBuffer; square?: boolean }) => {
    try {
      const shapes = await pictureFromUpload(Buffer.from(upload), { square })
      if (!shapes) {
        parentPort!.postMessage({ id })
        return
      }
      const encoded = new Uint8Array(encodeShapes(shapes)) // a copy, so its buffer can move
      parentPort!.postMessage(
        { id, result: { width: shapes.width, height: shapes.height, shapes: encoded.buffer } },
        [encoded.buffer],
      )
    } catch (error) {
      parentPort!.postMessage({ id, error: String(error) })
    }
  },
)
