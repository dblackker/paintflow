export const PAYMENT_UNAVAILABLE_TOAST = "Online payments aren't set up yet.";

export function paymentErrorMessage(error: unknown, fallback = 'Unable to start payment') {
  if (!(error instanceof Error)) return fallback;
  const message = error.message || fallback;
  if (/online payments|stripe payments|card payments|not ready|not set up/i.test(message)) {
    return PAYMENT_UNAVAILABLE_TOAST;
  }
  return message;
}
