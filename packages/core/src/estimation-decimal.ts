export type EstimationDecimal = string | number;

export class EstimationInputError extends Error {
  readonly code = 'INVALID_ESTIMATION_INPUT';

  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'EstimationInputError';
  }
}

export interface ExactDecimal {
  numerator: bigint;
  denominator: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

export function exact(numerator: bigint, denominator = 1n): ExactDecimal {
  if (denominator <= 0n) throw new Error('Decimal denominator must be positive');
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export const ZERO = exact(0n);
export const ONE = exact(1n);
const MAX_MONEY_MINOR = 9_999_999_999n;

// Decimal input is parsed directly to a rational; intermediate hours/coverage never use floats.
export function decimal(value: EstimationDecimal, field: string, options: { signed?: boolean; scale?: number; positive?: boolean } = {}): ExactDecimal {
  if (typeof value !== 'string' && typeof value !== 'number') throw new EstimationInputError(field, 'Enter a valid number.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new EstimationInputError(field, 'Enter a finite number.');
  const raw = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match || raw.length > 32) throw new EstimationInputError(field, 'Enter a decimal number without separators.');
  const fraction = (match[3] || '').replace(/0+$/, '');
  if (fraction.length > (options.scale ?? 6)) throw new EstimationInputError(field, `Use at most ${options.scale ?? 6} decimal places.`);
  if (match[2].length > 12) throw new EstimationInputError(field, 'This number is too large.');
  const sign = match[1] ? -1n : 1n;
  const parsed = exact(sign * BigInt(`${match[2]}${fraction}`), 10n ** BigInt(fraction.length));
  if ((!options.signed && parsed.numerator < 0n) || (options.positive && parsed.numerator <= 0n)) {
    throw new EstimationInputError(field, options.positive ? 'Enter a number greater than zero.' : 'Enter zero or a positive number.');
  }
  return parsed;
}

export function add(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return exact(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

export function subtract(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return exact(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
}

export function multiply(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return exact(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function divide(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  if (b.numerator <= 0n) throw new Error('Decimal divisor must be positive');
  return exact(a.numerator * b.denominator, a.denominator * b.numerator);
}

export function compare(a: ExactDecimal, b: ExactDecimal): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function round(value: ExactDecimal): bigint {
  const negative = value.numerator < 0n;
  const absolute = negative ? -value.numerator : value.numerator;
  const rounded = (absolute * 2n + value.denominator) / (value.denominator * 2n);
  return negative ? -rounded : rounded;
}

export function ceil(value: ExactDecimal): bigint {
  if (value.numerator < 0n) throw new Error('Cannot purchase a negative quantity');
  return (value.numerator + value.denominator - 1n) / value.denominator;
}

export function boundedInteger(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new EstimationInputError(field, 'The calculated amount exceeds the supported limit.');
  }
  return Number(value);
}

export function minor(value: ExactDecimal, field: string): number {
  return boundedMinor(round(multiply(value, exact(100n))), field);
}

export function boundedMinor(value: bigint, field: string): number {
  if (value > MAX_MONEY_MINOR || value < -MAX_MONEY_MINOR) {
    throw new EstimationInputError(field, 'The calculated amount exceeds the supported estimate limit.');
  }
  return boundedInteger(value, field);
}

export function decimalText(value: ExactDecimal, places = 8): string {
  const scaled = round(multiply(value, exact(10n ** BigInt(places))));
  const negative = scaled < 0n;
  const digits = String(negative ? -scaled : scaled).padStart(places + 1, '0');
  const fraction = digits.slice(-places).replace(/0+$/, '');
  return `${negative ? '-' : ''}${digits.slice(0, -places)}${fraction ? `.${fraction}` : ''}`;
}

export function moneyText(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new EstimationInputError('money', 'Money must be a safe integer number of cents.');
  const value = BigInt(amountMinor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

// Largest remainders distribute cents exactly; stable IDs break ties independently of array order.
export function allocateMinor(total: number, shares: Array<{ id: string; weight: ExactDecimal }>): Map<string, number> {
  if (!Number.isSafeInteger(total) || total < 0) throw new EstimationInputError('allocation', 'Allocation requires nonnegative integer cents.');
  const weight = shares.reduce((sum, share) => add(sum, share.weight), ZERO);
  const result = new Map(shares.map((share) => [share.id, 0]));
  if (weight.numerator === 0n) {
    if (total !== 0) throw new EstimationInputError('allocation', 'A nonzero amount needs a positive allocation weight.');
    return result;
  }
  const allocations = shares.map((share) => {
    const amount = multiply(exact(BigInt(total)), divide(share.weight, weight));
    const whole = amount.numerator / amount.denominator;
    return { id: share.id, whole, remainder: exact(amount.numerator % amount.denominator, amount.denominator) };
  });
  let remainder = BigInt(total) - allocations.reduce((sum, allocation) => sum + allocation.whole, 0n);
  allocations.sort((a, b) => compare(b.remainder, a.remainder) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const allocation of allocations) {
    const extra = remainder > 0n ? 1n : 0n;
    remainder -= extra;
    result.set(allocation.id, boundedInteger(allocation.whole + extra, 'allocation'));
  }
  return result;
}
