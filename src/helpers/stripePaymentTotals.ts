import type { IPayment } from '../modules/payment/payment.interface'

type PaymentTotals = Pick<IPayment, 'amount' | 'currency' | 'subtotalAmount' | 'taxAmount' | 'discountAmount' | 'taxCountry'>
type CheckoutTotals = {
  amount_total?: number | null
  amount_subtotal?: number | null
  currency?: string | null
  total_details?: { amount_tax?: number; amount_discount?: number } | null
  automatic_tax?: { enabled?: boolean; status?: string | null }
  customer_details?: { address?: { country?: string | null } | null } | null
}

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// A guest capability still has to match the original order quote before fulfilment.
export const checkoutMatchesPaymentTotal = (payment: PaymentTotals, session: CheckoutTotals): boolean => {
  if (!isAmount(session.amount_total) || !session.currency ||
      session.currency.toUpperCase() !== payment.currency.toUpperCase()) return false
  if (!session.automatic_tax?.enabled) return session.amount_total === Math.round(payment.amount * 100)
  const tax = session.total_details?.amount_tax
  const discount = session.total_details?.amount_discount ?? 0
  if (session.automatic_tax.status !== 'complete' || !isAmount(session.amount_subtotal) ||
      !isAmount(tax) || !isAmount(discount)) return false
  const originalSubtotal = payment.subtotalAmount ?? payment.amount - (payment.taxAmount || 0) + (payment.discountAmount || 0)
  return session.amount_subtotal === Math.round(originalSubtotal * 100) &&
    session.amount_total === session.amount_subtotal - discount + tax
}

// Amounts come only from authenticated Stripe responses/webhooks, never the browser.
export const applyStripeCheckoutTotals = (payment: PaymentTotals, session: CheckoutTotals): boolean => {
  if (session.automatic_tax?.enabled && session.automatic_tax.status !== 'complete') {
    throw new Error('Stripe has not completed the tax calculation for this payment.')
  }
  if (!isAmount(session.amount_total)) {
    if (session.automatic_tax?.enabled) throw new Error('Stripe payment total is missing.')
    return false // Retain compatibility with legacy sessions without a tax breakdown.
  }
  if (session.currency && session.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    throw new Error('Stripe payment currency does not match the order.')
  }
  const tax = session.total_details?.amount_tax ?? 0
  const discount = session.total_details?.amount_discount ?? 0
  if (!isAmount(tax) || !isAmount(discount)) throw new Error('Invalid Stripe tax breakdown.')
  const subtotal = session.amount_subtotal ?? session.amount_total - tax + discount
  if (!isAmount(subtotal)) throw new Error('Invalid Stripe payment subtotal.')
  const values = {
    amount: session.amount_total / 100,
    subtotalAmount: subtotal / 100,
    taxAmount: tax / 100,
    discountAmount: discount / 100,
    ...(session.customer_details?.address?.country ? { taxCountry: session.customer_details.address.country } : {}),
  }
  const changed = Object.entries(values).some(([key, value]) => payment[key as keyof PaymentTotals] !== value)
  Object.assign(payment, values)
  return changed
}

export const applyStripeIntentTotal = (payment: PaymentTotals, intent: { amount_received?: number; amount?: number; currency?: string }): void => {
  const amount = intent.amount_received ?? intent.amount
  if (!isAmount(amount)) return
  if (intent.currency && intent.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    throw new Error('Stripe payment currency does not match the order.')
  }
  // Preserve the original quote if this event arrives before the Checkout tax breakdown.
  if (payment.subtotalAmount == null) {
    payment.subtotalAmount = payment.amount - (payment.taxAmount || 0) + (payment.discountAmount || 0)
  }
  payment.amount = amount / 100
}
