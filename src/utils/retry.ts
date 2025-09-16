import { logger } from './logger.ts';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  return withExponentialBackoff(fn, {
    maxRetries,
    initialDelayMs: delayMs,
  });
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error;
  let delayMs = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        logger.error(`All ${maxRetries + 1} attempts failed`, lastError);
        throw lastError;
      }

      if (!shouldRetry(lastError)) {
        logger.info('Error is not retryable, throwing immediately', { error: lastError.message });
        throw lastError;
      }

      const nextDelayMs = Math.min(delayMs, maxDelayMs);

      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${nextDelayMs}ms`, lastError);

      if (onRetry) {
        onRetry(attempt + 1, lastError, nextDelayMs);
      }

      await delay(nextDelayMs);

      // Calculate next delay with exponential backoff
      delayMs = Math.round(delayMs * backoffMultiplier);
    }
  }

  throw lastError!;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isRetryableError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();

  // Network errors
  if (errorMessage.includes('econnrefused') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('etimedout') ||
      errorMessage.includes('enotfound') ||
      errorMessage.includes('network')) {
    return true;
  }

  // Rate limiting
  if (errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429')) {
    return true;
  }

  // Temporary failures
  if (errorMessage.includes('temporarily unavailable') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('503') ||
      errorMessage.includes('502')) {
    return true;
  }

  // Timeout errors
  if (errorMessage.includes('timeout') ||
      errorMessage.includes('timed out')) {
    return true;
  }

  return false;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export async function retryWithJitter<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error;
  let delayMs = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        throw new RetryError(
          `Failed after ${maxRetries + 1} attempts`,
          maxRetries + 1,
          lastError
        );
      }

      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.3 * delayMs; // Up to 30% jitter
      const nextDelayMs = Math.min(delayMs + jitter, maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, lastError, nextDelayMs);
      }

      await delay(Math.round(nextDelayMs));

      // Calculate next delay with exponential backoff
      delayMs = Math.round(delayMs * backoffMultiplier);
    }
  }

  throw lastError!;
}