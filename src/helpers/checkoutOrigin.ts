import config from '../config'
import ApiError from '../errors/ApiError'
import { StatusCodes } from 'http-status-codes'

// Only server-configured frontend origins can receive a checkout return.
export const getCheckoutReturnOrigin = (origin?: string): string => {
  if (!origin) return new URL(config.clientUrl).origin
  let url: URL
  try { url = new URL(origin) }
  catch { throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid checkout origin.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid checkout origin.')
  }
  const allowed = [config.clientUrl, ...(config.cors_origins || [])].some(value => {
    try { return new URL(value).origin === url.origin } catch { return false }
  })
  const localDevelopment = config.node_env !== 'production' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!allowed && !localDevelopment) throw new ApiError(StatusCodes.FORBIDDEN, 'Checkout origin is not allowed.')
  return url.origin
}
