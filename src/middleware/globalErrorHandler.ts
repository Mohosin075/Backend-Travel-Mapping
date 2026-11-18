/* eslint-disable @typescript-eslint/no-unused-vars */
import { ErrorRequestHandler, NextFunction, Request, Response } from 'express'
import config from '../config'
import { IGenericErrorMessage } from '../interfaces/error'
import { ZodError } from 'zod'
import handleZodError from '../errors/handleZodError'
import handleCastError from '../errors/handleCastError'
import handleValidationError from '../errors/handleValidationError'
import ApiError from '../errors/ApiError'
import { translateMessage } from '../helpers/translateMessage'

const globalErrorHandler: ErrorRequestHandler = (
  error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Safe logging
  if (config.node_env === 'development') {
    console.error(
      'Inside Global Error Handler🪐',
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    )
  }

  let statusCode = 500
  let message = 'Something went wrong!'
  let errorMessages: IGenericErrorMessage[] = []

  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || ''
    statusCode = 409
    message = field === 'email'
      ? 'An account with this email already exists. Please log in or use another email.'
      : 'A record with these details already exists. Please use different details.'
    errorMessages = [{ path: field, message }]
  } else if (error?.name === 'ValidationError' || error?.name === 'validationError') {
    const simplifiedError = handleValidationError(error)
    statusCode = simplifiedError.statusCode
    message = simplifiedError.errorMessages[0]?.message || message
    errorMessages = simplifiedError.errorMessages
  } else if (error instanceof ZodError) {
    const simplifiedError = handleZodError(error)
    statusCode = simplifiedError.statusCode
    message = simplifiedError.errorMessages[0]?.message || message
    errorMessages = simplifiedError.errorMessages
  } else if (error?.name === 'CastError') {
    const simplifiedError = handleCastError(error)
    statusCode = simplifiedError.statusCode
    message = simplifiedError.message || message
    errorMessages = simplifiedError.errorMessages || []
  } else if (error instanceof ApiError) {
    statusCode = error.statusCode || statusCode
    message = error.message || message
    errorMessages = error.message ? [{ path: '', message: error.message }] : []
  } else if (error instanceof Error) {
    message = error.message || message
    errorMessages = error.message ? [{ path: '', message: error.message }] : []
  }

  const lang = req.lang || 'es'
  const localizedMessage = translateMessage(message, lang)
  const localizedErrorMessages = errorMessages.map(err => ({
    ...err,
    message: translateMessage(err.message, lang),
  }))

  const retryAfter = error instanceof ApiError && Number.isFinite(error.retryAfter)
    ? Math.max(1, Math.ceil(error.retryAfter!)) : undefined
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter))
  res.status(statusCode).json({
    success: false,
    ...(retryAfter ? { retryAfter } : {}),
    message: localizedMessage,
    errorMessages: localizedErrorMessages,
    stack: config.node_env === 'production' || error?.code === 11000 ? undefined : error?.stack,
  })
}

export default globalErrorHandler
