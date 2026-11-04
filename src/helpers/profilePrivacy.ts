export const canSeeProfileIdentity = (subject: any, requester?: any): boolean => {
  if (!['private', 'anonymous'].includes(subject?.settings?.profileStatus)) return true
  if (['admin', 'super_admin'].includes(requester?.role)) return true
  const requesterId = requester?.authId || requester?._id
  return Boolean(requesterId && subject?._id && String(requesterId) === String(subject._id))
}

export const sanitizeReviewIdentity = (value: any, requester?: any) => {
  const review = typeof value?.toObject === 'function' ? value.toObject() : value
  if (!review?.reviewer || canSeeProfileIdentity(review.reviewer, requester)) return review
  return { ...review, reviewer: { name: 'Anonymous User', profile: '', isAnonymous: true } }
}
