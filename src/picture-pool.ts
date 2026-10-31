// sharp must be loaded by the main thread before any worker that uses it starts, so its
// shared libraries stay loaded while workers run (see sharp's docs on worker threads).
import 'sharp'
import { Worker } from 'node:worker_threads'
import { pictureQueueLimit, pictureTaskTimeoutMs, pictureWorkers } from './limits.ts'

export type DrawnPicture = { width: number; height: number; shapes: Buffer }

// Every worker is busy and the queue is full.
export class PictureBusyError extends Error {}
// A picture took longer than pictureTaskTimeoutMs.
export class PictureTimeoutError extends Error {}

type Task = {
  id: number
  upload: ArrayBuffer
  square: boolean
  resolve: (picture: DrawnPicture | undefined) => void
  reject: (error: Error) => void
}

type Slot = { worker: Worker; task?: Task; timer?: NodeJS.Timeout }

// A fixed number of long-lived workers (src/picture-worker.ts), started on the first
// upload, one task at a time each, and a FIFO queue of the rest. A worker that crashes or
// times out is terminated and replaced.
const slots: Slot[] = []
const queue: Task[] = []
let nextId = 1
let closed = false

function startSlot(): Slot {
  const slot: Slot = {
    worker: new Worker(new URL('./picture-worker.ts', import.meta.url)),
  }
  slot.worker.unref()
  slot.worker.on('message', (message) => {
    const task = slot.task
    if (!task || message.id !== task.id) {
      return
    }
    finish(slot)
    if (message.error !== undefined) {
      task.reject(new Error(`picture worker: ${message.error}`))
    } else {
      task.resolve(
        message.result && {
          width: message.result.width,
          height: message.result.height,
          shapes: Buffer.from(message.result.shapes),
        },
      )
    }
    next(slot)
  })
  slot.worker.on('error', (error) => replace(slot, error))
  slot.worker.on('exit', () => replace(slot, new Error('picture worker exited')))
  return slot
}

function finish(slot: Slot): void {
  clearTimeout(slot.timer)
  slot.task = undefined
}

// Replaces a dead or stuck worker, rejecting the task it had.
function replace(slot: Slot, error: Error): void {
  const index = slots.indexOf(slot)
  if (index === -1) {
    return
  }
  const task = slot.task
  finish(slot)
  void slot.worker.terminate()
  if (closed) {
    slots.splice(index, 1)
  } else {
    const fresh = startSlot()
    slots[index] = fresh
    next(fresh)
  }
  task?.reject(error)
}

function next(slot: Slot): void {
  const task = queue.shift()
  if (!task || closed) {
    return
  }
  slot.task = task
  slot.timer = setTimeout(
    () => replace(slot, new PictureTimeoutError('picture took too long')),
    pictureTaskTimeoutMs,
  )
  slot.worker.postMessage({ id: task.id, upload: task.upload, square: task.square }, [task.upload])
}

// The buffer's bytes as an ArrayBuffer of their own, which can be transferred. A multer
// buffer is usually its own ArrayBuffer; a small one may sit in Node's shared pool.
function transferable(buffer: Buffer): ArrayBuffer {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
    return buffer.buffer as ArrayBuffer
  }
  return new Uint8Array(buffer).buffer
}

// Draws an upload in a worker (see pictureFromUpload and encodeShapes in picture.ts): its
// size and encoded shapes, or undefined when it is no picture. Rejects with
// PictureBusyError when the queue is full, and PictureTimeoutError when it takes too long.
// The upload's buffer is handed over, not copied, and can't be used afterwards. `square`:
// a profile picture, cropped square (see pictureFromUpload).
export function drawPicture(
  upload: Buffer,
  { square = false }: { square?: boolean } = {},
): Promise<DrawnPicture | undefined> {
  closed = false
  if (slots.length === 0) {
    for (let i = 0; i < pictureWorkers; i++) {
      slots.push(startSlot())
    }
  }
  const idle = slots.find((slot) => !slot.task)
  if (!idle && queue.length >= pictureQueueLimit) {
    return Promise.reject(new PictureBusyError('too many pictures at once'))
  }
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, upload: transferable(upload), square, resolve, reject })
    if (idle) {
      next(idle)
    }
  })
}

// Stops the workers; pending tasks are rejected. A later drawPicture starts them again.
export async function closePicturePool(): Promise<void> {
  closed = true
  const stopping = slots.splice(0)
  for (const task of queue.splice(0)) {
    task.reject(new Error('picture pool closed'))
  }
  await Promise.all(
    stopping.map(async (slot) => {
      clearTimeout(slot.timer)
      slot.task?.reject(new Error('picture pool closed'))
      slot.task = undefined
      await slot.worker.terminate()
    }),
  )
}
