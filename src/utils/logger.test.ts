import { describe, expect, test, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { redactSecrets, createLogger } from './logger.ts';

describe('Secret Redaction', () => {
  test('redactSecrets masks various token patterns', () => {
    const input = 'My token: abc123def456 and api_token: xyz789';
    const result = redactSecrets(input);
    expect(result).toBe('My token: *** and api_token: ***');
  });

  test('redactSecrets masks API keys', () => {
    const input = 'API_KEY: sk-1234567890abcdef and apiKey="test123"';
    const result = redactSecrets(input);
    expect(result).toContain('***');
    expect(result).not.toContain('sk-1234567890abcdef');
    expect(result).not.toContain('test123');
  });

  test('redactSecrets masks passwords', () => {
    const input = 'password: mySecretPass123 and user_password="test"';
    const result = redactSecrets(input);
    expect(result).toContain('***');
    expect(result).not.toContain('mySecretPass123');
    expect(result).not.toContain('test');
  });

  test('redactSecrets masks secrets', () => {
    const input = 'client_secret: abc123 and SECRET_KEY=xyz789';
    const result = redactSecrets(input);
    expect(result).toContain('***');
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('xyz789');
  });

  test('redactSecrets masks auth tokens', () => {
    const input = 'auth_token: token123 and Authorization: Bearer abc123';
    const result = redactSecrets(input);
    expect(result).toContain('***');
    expect(result).not.toContain('token123');
    expect(result).not.toContain('abc123');
  });

  test('redactSecrets masks URLs with credentials', () => {
    const input = 'Connect to https://user:password@example.com/path';
    const result = redactSecrets(input);
    expect(result).toContain('***');
    expect(result).not.toContain('password');
    expect(result).toContain('example.com/path');
  });

  test('redactSecrets masks Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const result = redactSecrets(input);
    expect(result).toContain('Bearer ***');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  test('redactSecrets handles case-insensitive patterns', () => {
    const input = 'TOKEN: abc, Token: def, token: ghi';
    const result = redactSecrets(input);
    expect(result).toBe('TOKEN: ***, Token: ***, token: ***');
  });

  test('redactSecrets preserves non-sensitive text', () => {
    const input = 'This is a normal message without any sensitive data';
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  test('redactSecrets handles multiple secrets in JSON', () => {
    const input = JSON.stringify({
      api_key: 'secret123',
      password: 'pass456',
      username: 'john',
      data: 'normal data',
    });
    const result = redactSecrets(input);

    expect(result).toContain('***');
    expect(result).not.toContain('secret123');
    expect(result).not.toContain('pass456');
    expect(result).toContain('john'); // Username should not be redacted
    expect(result).toContain('normal data'); // Normal data preserved
  });

  test('redactSecrets with custom patterns', () => {
    const customPatterns = [
      /custom_field:\s*(\S+)/gi,
    ];
    const input = 'custom_field: sensitive123 and normal: data';
    const result = redactSecrets(input, customPatterns);

    expect(result).toContain('***');
    expect(result).not.toContain('sensitive123');
    expect(result).toContain('normal: data');
  });

  test('redactSecrets handles empty string', () => {
    expect(redactSecrets('')).toBe('');
  });

  test('redactSecrets handles multiline strings', () => {
    const input = `
      API_KEY: secret123
      Normal line
      password: pass456
    `;
    const result = redactSecrets(input);

    expect(result).toContain('API_KEY: ***');
    expect(result).toContain('Normal line');
    expect(result).toContain('password: ***');
  });
});

describe('Logger Creation', () => {
  let originalEnv: any;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };

    consoleLogSpy = spyOn(console, 'log');
    consoleWarnSpy = spyOn(console, 'warn');
    consoleErrorSpy = spyOn(console, 'error');

    consoleLogSpy.mockImplementation(() => {});
    consoleWarnSpy.mockImplementation(() => {});
    consoleErrorSpy.mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('createLogger redacts secrets by default', () => {
    const logger = createLogger();
    logger.info('Token is token: secret123');

    expect(consoleLogSpy).toHaveBeenCalled();
    const logCall = consoleLogSpy.mock.calls[0];
    expect(logCall[0]).toContain('token: ***');
    expect(logCall[0]).not.toContain('secret123');
  });

  test('createLogger can disable secret redaction', () => {
    const logger = createLogger({ redactSecrets: false });
    logger.info('Token is token: secret123');

    expect(consoleLogSpy).toHaveBeenCalled();
    const logCall = consoleLogSpy.mock.calls[0];
    expect(logCall[0]).toContain('token: secret123');
  });

  test('createLogger respects log levels', () => {
    const logger = createLogger({ logLevel: 'warn' });

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warn message');
    logger.error('Error message', new Error('Test'));

    expect(consoleLogSpy).not.toHaveBeenCalled(); // Debug and info not logged
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  test('createLogger includes timestamps', () => {
    const logger = createLogger();
    const beforeTime = new Date().toISOString();

    logger.info('Test message');

    const logCall = consoleLogSpy.mock.calls[0];
    expect(logCall[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    expect(logCall[0]).toContain('[INFO]');
    expect(logCall[0]).toContain('Test message');
  });

  test('createLogger handles data objects', () => {
    const logger = createLogger();
    logger.info('User data', { username: 'john', api_key: 'secret123' });

    expect(consoleLogSpy).toHaveBeenCalled();
    const logCall = consoleLogSpy.mock.calls[0];
    // The second argument contains the JSON stringified and possibly redacted data
    expect(logCall[1]).toContain('john');
    expect(logCall[1]).toContain('***');
    expect(logCall[1]).not.toContain('secret123');
  });

  test('createLogger handles errors', () => {
    const logger = createLogger();
    const error = new Error('Failed with token: abc123');
    logger.error('Operation failed', error);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const errorCall = consoleErrorSpy.mock.calls[0];
    expect(errorCall[0]).toContain('[ERROR]');
    expect(errorCall[0]).toContain('Operation failed');
    expect(errorCall[1]).toContain('token: ***');
    expect(errorCall[1]).not.toContain('abc123');
  });

  test('createLogger shows stack trace in debug mode', () => {
    process.env.DEBUG = 'true';
    const logger = createLogger();
    const error = new Error('Test error');
    logger.error('Failed', error);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(2); // Error + stack trace
    const stackCall = consoleErrorSpy.mock.calls[1];
    expect(stackCall[0]).toBe('Stack trace:');
  });

  test('createLogger respects LOG_LEVEL environment variable', () => {
    process.env.LOG_LEVEL = 'error';
    const logger = createLogger();

    logger.debug('Debug');
    logger.info('Info');
    logger.warn('Warn');
    logger.error('Error', new Error('Test'));

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  test('createLogger debug level logs everything', () => {
    const logger = createLogger({ logLevel: 'debug' });

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warn message');
    logger.error('Error message', new Error('Test'));

    // All log methods should have been called
    expect(consoleLogSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // Debug + Info
    expect(consoleWarnSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(consoleErrorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});