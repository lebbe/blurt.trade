import type { Request, RequestHandler, Response } from 'express'
import multer from 'multer'
import { pictureMaxStoredBytes, pictureMaxUploadBytes } from '../limits.ts'
import { type FieldError, sendError } from '../negotiate.ts'
import {
  drawPicture,
  PictureBusyError,
  PictureTimeoutError,
  type DrawnPicture,
} from '../picture-pool.ts'

// An uploaded picture in the form field `picture`, for blurts and profile pictures: held
// in memory, never written to disk (see src/picture.ts).
const pictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: pictureMaxUploadBytes, files: 1 },
}).single('picture')

export const uploadPicture: RequestHandler = (request, response, next) => {
  pictureUpload(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        sendError(request, response, 413, 'Picture is too large')
      } else {
        sendError(request, response, 400, error.message, 'picture')
      }
    } else {
      next(error)
    }
  })
}

// Draws the uploaded picture (drawPicture): the drawing, or a form error for the `picture`
// field when it is no picture or too detailed. Undefined when the response has been sent
// already: a 503 when too many pictures are being drawn.
export async function drawUpload(
  request: Request,
  response: Response,
  file: Express.Multer.File,
  options: { square?: boolean } = {},
): Promise<{ picture: DrawnPicture } | { error: FieldError } | undefined> {
  let drawn
  try {
    drawn = await drawPicture(file.buffer, options)
  } catch (error) {
    if (error instanceof PictureBusyError) {
      response.set('Retry-After', '5')
      sendError(request, response, 503, 'Too many pictures are being processed. Try again soon.')
      return undefined
    }
    if (!(error instanceof PictureTimeoutError)) {
      throw error
    }
  }
  if (!drawn) {
    return {
      error: { field: 'picture', message: 'Could not read the picture. Use JPEG, PNG or WebP.' },
    }
  }
  if (drawn.shapes.length > pictureMaxStoredBytes) {
    return { error: { field: 'picture', message: 'The picture is too detailed' } }
  }
  return { picture: drawn }
}
