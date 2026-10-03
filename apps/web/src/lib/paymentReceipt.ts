export interface ManualPaymentReceiptResult {
  receiptStatus?: 'not_requested' | 'sent' | 'failed' | 'not_retried';
}

export function manualPaymentFeedback(result: ManualPaymentReceiptResult) {
  if (result.receiptStatus === 'failed') return { message: 'Payment recorded. Receipt not sent; resend it from payment details.', type: 'info' as const };
  if (result.receiptStatus === 'not_retried') return { message: 'Payment already recorded. Check receipt history before resending.', type: 'info' as const };
  return { message: result.receiptStatus === 'sent' ? 'Payment recorded and receipt sent' : 'Payment recorded', type: 'success' as const };
}
