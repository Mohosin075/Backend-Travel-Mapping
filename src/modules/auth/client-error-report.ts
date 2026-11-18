import { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { randomUUID } from 'crypto'
import { z } from 'zod'

export const clientErrorRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

const reportSchema = z.object({
  name: z.string().max(100),
  message: z.string().max(1000),
  stack: z.string().max(4000),
  pathname: z.string().max(200).regex(/^\/[a-zA-Z0-9/_-]*$/),
}).strict()

// Browser error text is untrusted. Never log URL query strings, email addresses,
// bearer tokens or long token-like values from a customer browser.
export const redactClientError = (value: string) => value
  .replace(/https?:\/\/[^\s)]+/gi, raw => {
    try { const url = new URL(raw); return `${url.origin}${url.pathname}` } catch { return '[url]' }
  })
  .replace(/\?[^\s)]+/g, '?[redacted]')
  .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
  .replace(/\bBearer\s+\S+/gi, '[token]')
  .replace(/\b\d{6}\b/g, '[code]')
  .replace(/\b[a-zA-Z0-9_.-]{40,}\b/g, '[redacted]')
  .replace(/[\r\n\t]/g, ' ')

export const reportClientError = (req: Request, res: Response) => {
  const parsed = reportSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false })
    return
  }
  const id = randomUUID()
  console.error(JSON.stringify({
    event: 'client_error', id, timestamp: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, redactClientError(value)])),
  }))
  res.status(202).json({ success: true, id })
}
