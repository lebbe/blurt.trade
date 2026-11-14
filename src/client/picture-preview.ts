import type { Crop, PictureFailure, PictureRequest, PictureResult } from './picture-worker.ts'

// Drawing a picture in the browser, in a Web Worker (./picture-worker.ts), for the
// previews before an upload (./composer.ts, ./picture-upload.ts). One worker per page,
// started on the first picture, one drawing at a time. A caller that only wants the
// newest of several (a crop frame being dragged) uses latest().
//
// Nothing here leaves the device: the file is read and drawn in the browser, and only
// uploaded when the form is sent.

export type { Crop, PictureResult }

type Pending = { resolve: (result: PictureResult) => void; reject: (error: Error) => void }

let worker: Worker | undefined
let nextId = 1
const pending = new Map<number, Pending>()

function start(): Worker {
  if (worker) {
    return worker
  }
  // A module worker under this module's versioned URL (src/client-modules.ts). Allowed by
  // the page's worker-src 'self' (src/middleware/security-headers.ts).
  const started = new Worker(new URL('./picture-worker.ts', import.meta.url), { type: 'module' })
  started.onmessage = ({ data }: MessageEvent<PictureResult | PictureFailure>) => {
    const waiting = pending.get(data.id)
    pending.delete(data.id)
    if (!waiting) {
      return
    }
    if ('error' in data) {
      waiting.reject(new Error(data.error))
    } else {
      waiting.resolve(data)
    }
  }
  // The worker failed to load or crashed: every drawing waiting fails, and the next one
  // starts a new worker.
  started.onerror = (event) => {
    event.preventDefault()
    for (const waiting of pending.values()) {
      waiting.reject(new Error(`picture worker: ${event.message || 'failed'}`))
    }
    pending.clear()
    started.terminate()
    worker = undefined
  }
  worker = started
  return started
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

function ask(request: WithoutId<PictureRequest>): Promise<PictureResult> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    start().postMessage({ ...request, id })
  })
}

// The drawing of `file` (cropped to `crop`, for a profile picture), and with `upload` the
// scaled pixels as a PNG to send instead of the file.
export function drawFile(
  file: Blob,
  options: { crop?: Crop; upload?: boolean } = {},
): Promise<PictureResult> {
  return ask({ kind: 'draw', file, ...options })
}

// Exactly these pixels drawn (the tests compare it with the server's drawing).
export function drawPixels(image: {
  width: number
  height: number
  data: Uint8ClampedArray
}): Promise<PictureResult> {
  return ask({ kind: 'rgba', ...image })
}

// A drawer that only bothers with the newest drawing asked of it: while one is being
// drawn, of those asked for meanwhile only the last is drawn next (a crop frame being
// dragged asks for many). A drawing that is no longer the newest resolves to undefined.
export function latest() {
  let newest = 0
  let queue: Promise<unknown> = Promise.resolve()
  return (
    file: Blob,
    options: { crop?: Crop; upload?: boolean } = {},
  ): Promise<PictureResult | undefined> => {
    const mine = ++newest
    const run = queue.then(() => (mine === newest ? drawFile(file, options) : undefined))
    queue = run.catch(() => undefined)
    return run.then((result) => (mine === newest ? result : undefined))
  }
}

// Shown under every preview: the server draws the picture again.
export const previewNote =
  'Preview, drawn on your device. Nothing is uploaded until you send it; the server then draws it again, so it can come out slightly different.'
