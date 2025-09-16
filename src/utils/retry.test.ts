import { describe, expect, test, mock } from 'bun:test';
import {
  withRetry,
  withExponentialBackoff,
  delay,
  isRetryableError,
  RetryError,
  retryWithJitter,
} from './retry.ts';

describe('Retry with Basic Retry', () => {
  test('withRetry succeeds on first attempt', async () => {
    const fn = mock(() => Promise.resolve('success'));

    const result = await withRetry(fn, 3, 100);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('withRetry retries on failure and succeeds', async () => {
    let attempt = 0;
    const fn = mock(() => {
      attempt++;
      if (attempt < 3) {
        return Promise.reject(new Error('Temporary failure'));
      }
      return Promise.resolve('success');
    });

    const result = await withRetry(fn, 3, 10);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('withRetry throws after max retries', async () => {
    const fn = mock(() => Promise.reject(new Error('Persistent failure')));

    await expect(withRetry(fn, 2, 10))
      .rejects.toThrow('Persistent failure');

    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
});

describe('Exponential Backoff', () => {
  test('withExponentialBackoff increases delay exponentially', async () => {
    const delays: number[] = [];
    const fn = mock(() => Promise.reject(new Error('Test error')));

    const startTime = Date.now();

    try {
      await withExponentialBackoff(fn, {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        onRetry: (attempt, error, nextDelayMs) => {
          delays.push(nextDelayMs);
        },
      });
    } catch {
      // Expected to fail
    }

    expect(delays).toEqual([10, 20, 40]);
    expect(fn).toHaveBeenCalledTimes(4); // Initial + 3 retries
  });

  test('withExponentialBackoff respects maxDelayMs', async () => {
    const delays: number[] = [];
    const fn = mock(() => Promise.reject(new Error('Test error')));

    try {
      await withExponentialBackoff(fn, {
        maxRetries: 5,
        initialDelayMs: 100,
        maxDelayMs: 300,
        backoffMultiplier: 2,
        onRetry: (attempt, error, nextDelayMs) => {
          delays.push(nextDelayMs);
        },
      });
    } catch {
      // Expected to fail
    }

    expect(delays).toEqual([100, 200, 300, 300, 300]);
  });

  test('withExponentialBackoff uses shouldRetry predicate', async () => {
    const fn = mock(() => Promise.reject(new Error('Non-retryable')));

    await expect(withExponentialBackoff(fn, {
      maxRetries: 3,
      shouldRetry: (error) => !error.message.includes('Non-retryable'),
    })).rejects.toThrow('Non-retryable');

    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  test('withExponentialBackoff calls onRetry callback', async () => {
    const onRetry = mock((attempt: number, error: Error, nextDelayMs: number) => {});
    const fn = mock(() => Promise.reject(new Error('Test error')));

    try {
      await withExponentialBackoff(fn, {
        maxRetries: 2,
        initialDelayMs: 10,
        onRetry,
      });
    } catch {
      // Expected to fail
    }

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1); // First retry attempt
    expect(onRetry.mock.calls[1][0]).toBe(2); // Second retry attempt
  });
});

describe('Retry with Jitter', () => {
  test('retryWithJitter adds random jitter to delays', async () => {
    const delays: number[] = [];
    const fn = mock(() => Promise.reject(new Error('Test error')));

    try {
      await retryWithJitter(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        onRetry: (attempt, error, nextDelayMs) => {
          delays.push(nextDelayMs);
        },
      });
    } catch {
      // Expected to fail
    }

    // Check that delays have jitter (not exact multiples)
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[0]).toBeLessThanOrEqual(130); // 100 + 30% jitter

    expect(delays[1]).toBeGreaterThanOrEqual(200);
    expect(delays[1]).toBeLessThanOrEqual(260); // 200 + 30% jitter
  });

  test('retryWithJitter throws RetryError after max attempts', async () => {
    const fn = mock(() => Promise.reject(new Error('Test error')));

    await expect(retryWithJitter(fn, {
      maxRetries: 2,
      initialDelayMs: 10,
    })).rejects.toThrow(RetryError);

    try {
      await retryWithJitter(fn, {
        maxRetries: 2,
        initialDelayMs: 10,
      });
    } catch (error) {
      if (error instanceof RetryError) {
        expect(error.attempts).toBe(3);
        expect(error.lastError.message).toBe('Test error');
      }
    }
  });
});

describe('Delay Function', () => {
  test('delay waits for specified milliseconds', async () => {
    const startTime = Date.now();
    await delay(50);
    const endTime = Date.now();

    const elapsed = endTime - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some margin
    expect(elapsed).toBeLessThan(100);
  });

  test('delay resolves without value', async () => {
    const result = await delay(10);
    expect(result).toBeUndefined();
  });
});

describe('Retryable Error Detection', () => {
  test('isRetryableError identifies network errors', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('Connection reset: ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('Request timeout: ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('DNS lookup failed: ENOTFOUND'))).toBe(true);
    expect(isRetryableError(new Error('Network error occurred'))).toBe(true);
  });

  test('isRetryableError identifies rate limiting', () => {
    expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRetryableError(new Error('Too many requests'))).toBe(true);
    expect(isRetryableError(new Error('HTTP 429'))).toBe(true);
  });

  test('isRetryableError identifies temporary failures', () => {
    expect(isRetryableError(new Error('Service temporarily unavailable'))).toBe(true);
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
  });

  test('isRetryableError identifies timeout errors', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true);
    expect(isRetryableError(new Error('Operation timed out'))).toBe(true);
  });

  test('isRetryableError returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('Invalid credentials'))).toBe(false);
    expect(isRetryableError(new Error('File not found'))).toBe(false);
    expect(isRetryableError(new Error('Syntax error'))).toBe(false);
    expect(isRetryableError(new Error('Permission denied'))).toBe(false);
  });

  test('isRetryableError is case-insensitive', () => {
    expect(isRetryableError(new Error('RATE LIMIT EXCEEDED'))).toBe(true);
    expect(isRetryableError(new Error('Network Error'))).toBe(true);
    expect(isRetryableError(new Error('TIMEOUT'))).toBe(true);
  });
});

describe('RetryError Class', () => {
  test('RetryError contains attempt count and last error', () => {
    const lastError = new Error('Original error');
    const retryError = new RetryError('Failed after retries', 5, lastError);

    expect(retryError.name).toBe('RetryError');
    expect(retryError.message).toBe('Failed after retries');
    expect(retryError.attempts).toBe(5);
    expect(retryError.lastError).toBe(lastError);
  });

  test('RetryError is instanceof Error', () => {
    const retryError = new RetryError('Test', 1, new Error('Test'));
    expect(retryError).toBeInstanceOf(Error);
    expect(retryError).toBeInstanceOf(RetryError);
  });
});