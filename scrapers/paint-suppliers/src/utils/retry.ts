import { Logger } from './logger';

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

export class RetryHelper {
  private static logger = new Logger('retry');

  static async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      delayMs = 1000,
      backoffMultiplier = 2,
      maxDelayMs = 30000,
      onRetry,
      shouldRetry = () => true,
    } = options;

    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries || !shouldRetry(lastError)) {
          throw lastError;
        }

        const delay = Math.min(
          delayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );

        this.logger.warn(
          `Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms`,
          { error: lastError.message }
        );

        if (onRetry) {
          onRetry(attempt + 1, lastError);
        }

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  static async withRetrySync<T>(
    fn: () => T,
    options: RetryOptions = {}
  ): Promise<T> {
    return this.withRetry(async () => fn(), options);
  }

  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /ENOTFOUND/i,
      /ECONNREFUSED/i,
      /socket hang up/i,
      /network error/i,
      /timeout/i,
      /rate limit/i,
      /429/,
      /503/,
      /502/,
      /504/,
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage = 'Operation timed out'
  ): Promise<T> {
    return Promise.race([
      promise,
      this.sleep(timeoutMs).then(() => {
        throw new Error(timeoutMessage);
      }),
    ]);
  }

  static async withCircuitBreaker<T>(
    fn: () => Promise<T>,
    options: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
      name?: string;
    } = {}
  ): Promise<T> {
    const { failureThreshold = 5, resetTimeoutMs = 60000, name = 'circuit' } = options;

    // Simple in-memory circuit breaker state
    const state = RetryHelper.getCircuitState(name);

    if (state.isOpen) {
      const timeSinceOpen = Date.now() - state.openedAt;
      if (timeSinceOpen < resetTimeoutMs) {
        throw new Error(`Circuit breaker ${name} is open`);
      }
      // Half-open state
      state.isOpen = false;
      state.failures = 0;
    }

    try {
      const result = await fn();
      state.failures = 0;
      return result;
    } catch (error) {
      state.failures++;
      if (state.failures >= failureThreshold) {
        state.isOpen = true;
        state.openedAt = Date.now();
        this.logger.error(`Circuit breaker ${name} opened after ${failureThreshold} failures`);
      }
      throw error;
    }
  }

  private static circuitStates = new Map<string, { isOpen: boolean; failures: number; openedAt: number }>();

  private static getCircuitState(name: string) {
    if (!this.circuitStates.has(name)) {
      this.circuitStates.set(name, { isOpen: false, failures: 0, openedAt: 0 });
    }
    return this.circuitStates.get(name)!;
  }
}
