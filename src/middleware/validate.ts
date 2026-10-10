import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

export class ValidationError extends Error {
  readonly input: unknown

  constructor(message: string, input: unknown) {
    super(message)
    this.name = 'ValidationError'
    this.input = input
  }
}

export function validate<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body)

    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((issue) => issue.message).join(' '),
        request.body,
      )
    }

    request.body = result.data
    next()
  }
}
