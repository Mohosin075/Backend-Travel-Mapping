import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { createHash } from 'crypto'
import { Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'

const rateLimitHandler = (req: Request, res: Response) => {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime?.getTime()
  const retryAfter = Math.max(1, Math.ceil(((resetTime || Date.now() + 900000) - Date.now()) / 1000))
  res.status(StatusCodes.TOO_MANY_REQUESTS).json({
    success: false,
    message: 'Too many requests. Please try again later.',
    retryAfter,
  })
}

/** Login / signup / social login — brute-force protection */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})

// Keep account identifiers out of store keys and logs. Invalid payloads still
// receive an IP limit before request validation.
const otpAccountKey = (req: Request) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : ''
  const account = email ? `email:${email}` : phone ? `phone:${phone}` : ''
  return account
    ? createHash('sha256').update(account).digest('hex')
    : ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown')
}

/** Broad IP protection, without sharing the small account budget across a NAT. */
export const otpIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})

/** Code guesses are counted per account, separately from sending email. */
export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: otpAccountKey,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})

/** Resend/recovery share an email budget, but cannot consume verification tries. */
export const otpSendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: otpAccountKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})

/** Password reset / change — account takeover protection */
export const passwordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})

/** Public contact form */
export const contactRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})

/** Refresh token endpoint */
export const refreshTokenRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
})
