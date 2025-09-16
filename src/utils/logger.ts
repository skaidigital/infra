export interface Logger {
  info(message: string, data?: any): void;
  warn(message: string, error?: Error): void;
  error(message: string, error: Error): void;
  debug(message: string, data?: any): void;
}

export interface LoggerOptions {
  redactSecrets?: boolean;
  secretPatterns?: RegExp[];
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_SECRET_PATTERNS = [
  /(Bearer\s+)([A-Za-z0-9\-_\.\/+=]+)/gi, // Bearer tokens - handle first
  /([A-Za-z0-9_-]*[Tt]oken[A-Za-z0-9_-]*)[\s:=]+["']?([A-Za-z0-9_\-\.\/+=]+)["']?/gi,
  /([A-Za-z0-9_-]*[Kk]ey[A-Za-z0-9_-]*)[\s:=]+["']?([A-Za-z0-9_\-\.\/+=]+)["']?/gi,
  /([A-Za-z0-9_-]*[Pp]assword[A-Za-z0-9_-]*)[\s:=]+["']?([^\s'"]+)["']?/gi,
  /([A-Za-z0-9_-]*[Ss]ecret[A-Za-z0-9_-]*)[\s:=]+["']?([A-Za-z0-9_\-\.\/+=]+)["']?/gi,
  /([Aa][Pp][Ii][-_]?[Kk][Ee][Yy])[\s:=]+["']?([A-Za-z0-9_\-\.\/+=]+)["']?/gi,
  // Auth pattern that excludes Bearer tokens
  /([A-Za-z0-9_-]*[Aa]uth[A-Za-z0-9_-]*)[\s:=]+(?!Bearer\s)["']?([A-Za-z0-9_\-\.\/+=]+)["']?/gi,
  /(https?:\/\/)([^:]+):([^@]+)@/gi, // URLs with credentials
  // JSON patterns
  /"([A-Za-z0-9_-]*[Tt]oken[A-Za-z0-9_-]*)"\s*:\s*"([^"]+)"/gi,
  /"([A-Za-z0-9_-]*[Kk]ey[A-Za-z0-9_-]*)"\s*:\s*"([^"]+)"/gi,
  /"([A-Za-z0-9_-]*[Pp]assword[A-Za-z0-9_-]*)"\s*:\s*"([^"]+)"/gi,
  /"([A-Za-z0-9_-]*[Ss]ecret[A-Za-z0-9_-]*)"\s*:\s*"([^"]+)"/gi,
  /"([Aa][Pp][Ii][-_]?[Kk][Ee][Yy])"\s*:\s*"([^"]+)"/gi,
];

export function redactSecrets(text: string, patterns: RegExp[] = DEFAULT_SECRET_PATTERNS): string {
  let redacted = text;

  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, (match, ...args) => {
      // Filter out the offset and full string from the groups array
      const groups = args.slice(0, -2); // Remove offset and full string

      // Handle URL credentials specially
      if (match.startsWith('http')) {
        return match.replace(/:[^@]+@/, ':***@');
      }
      // Handle Bearer tokens - check if we have Bearer in the first group
      if (groups[0] && groups[0].toLowerCase().includes('bearer')) {
        return `${groups[0]}***`;
      }
      // Handle JSON patterns like "key":"value"
      if (match.includes('"') && groups.length >= 2) {
        const key = groups[0];
        return `"${key}":"***"`;
      }
      // For custom patterns that may only have one group
      if (groups.length === 1) {
        // Replace the captured group with *** in the original match
        const value = groups[0];
        return match.replace(value, '***');
      }
      // For key-value patterns, redact the value
      if (groups.length >= 2) {
        const key = groups[0];
        return `${key}: ***`;
      }
      return '***';
    });
  }

  return redacted;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    redactSecrets: shouldRedact = true,
    secretPatterns = DEFAULT_SECRET_PATTERNS,
    logLevel = (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  } = options;

  const logLevels: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const currentLevel = logLevels[logLevel] !== undefined ? logLevels[logLevel] : 1;

  const formatMessage = (message: string): string => {
    if (shouldRedact) {
      return redactSecrets(message, secretPatterns);
    }
    return message;
  };

  const formatData = (data: any): string => {
    if (!data) return '';

    const stringified = typeof data === 'string' ? data : JSON.stringify(data);
    if (shouldRedact) {
      return redactSecrets(stringified, secretPatterns);
    }
    return stringified;
  };

  return {
    debug(message: string, data?: any): void {
      if (currentLevel <= logLevels.debug) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [DEBUG] ${formatMessage(message)}`, formatData(data));
      }
    },

    info(message: string, data?: any): void {
      if (currentLevel <= logLevels.info) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] ${formatMessage(message)}`, formatData(data));
      }
    },

    warn(message: string, error?: Error): void {
      if (currentLevel <= logLevels.warn) {
        const timestamp = new Date().toISOString();
        const errorMessage = error ? formatMessage(error.message) : '';
        console.warn(`[${timestamp}] [WARN] ${formatMessage(message)}`, errorMessage);
      }
    },

    error(message: string, error: Error): void {
      if (currentLevel <= logLevels.error) {
        const timestamp = new Date().toISOString();
        const errorMessage = formatMessage(error.message);
        const stack = error.stack ? formatMessage(error.stack) : '';
        console.error(`[${timestamp}] [ERROR] ${formatMessage(message)}`, errorMessage);
        if (stack && process.env.DEBUG) {
          console.error('Stack trace:', stack);
        }
      }
    },
  };
}

// Default logger instance
export const logger: Logger = createLogger();