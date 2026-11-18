/** An old resend budget must not permanently strand an unverified account. */
export const getOtpRequestCount = (
  authentication?: { latestRequestAt?: Date; requestCount?: number },
  now = Date.now(),
): number => {
  const lastRequest = authentication?.latestRequestAt
    ? new Date(authentication.latestRequestAt).getTime()
    : NaN
  return Number.isFinite(lastRequest) && now - lastRequest < 15 * 60 * 1000
    ? Math.max(0, authentication?.requestCount || 0)
    : 0
}

export const getOtpRetryAfter = (authentication?: { latestRequestAt?: Date }) =>
  Math.max(1, Math.ceil(((authentication?.latestRequestAt
    ? new Date(authentication.latestRequestAt).getTime() : Date.now()) + 15 * 60 * 1000 - Date.now()) / 1000))
