import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { sendNotification, sendTestNotification } from './notifications.ts';

// Create a global mock for fetch that persists across test runs
const mockFetch = mock((...args: any[]) => Promise.resolve({
  ok: true,
  text: () => Promise.resolve('ok'),
}));

// Store original fetch
const originalFetch = global.fetch;

describe('Slack Notifications', () => {
  beforeEach(() => {
    // Clear the mock call history
    mockFetch.mockClear();
    // Reset the implementation to the default
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));
    // Assign our mock to global fetch
    global.fetch = mockFetch as any;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    // Do not restore fetch here, let it persist for the entire describe block
  });

  test('sendNotification sends success message correctly', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }) as any);

    await sendNotification({
      status: 'success',
      projectId: 'test-project',
      dataset: 'production',
      backupSize: '125.5',
      objectKey: 'sanity/test-project/production/2024-01-01.tar.gz',
      duration: 180,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe('https://hooks.slack.com/test');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.text).toContain('✅ Backup completed successfully');
    expect(body.text).toContain('test-project');
    expect(body.text).toContain('production');
    expect(body.blocks).toBeArray();
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  test('sendNotification sends failure message correctly', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));

    await sendNotification({
      status: 'failure',
      projectId: 'test-project',
      dataset: 'production',
      error: 'Export failed: Connection timeout',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    const body = JSON.parse(options.body);
    expect(body.text).toContain('❌ Backup failed');
    expect(body.text).toContain('test-project');
    expect(body.text).toContain('production');
    expect(body.blocks).toBeArray();

    // Check error is included
    const errorBlock = body.blocks.find((block: any) =>
      block.text?.text?.includes('Export failed: Connection timeout')
    );
    expect(errorBlock).toBeDefined();
  });

  test('sendNotification skips when no webhook URL', async () => {
    // Don't set SLACK_WEBHOOK_URL environment variable
    await sendNotification({
      status: 'success',
      projectId: 'test-project',
      dataset: 'production',
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('sendNotification handles Slack API errors gracefully', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/invalid';

    mockFetch.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Invalid webhook'),
    }));

    // Should not throw - notifications should fail silently
    await expect(sendNotification({
      status: 'success',
      projectId: 'test-project',
      dataset: 'production',
    })).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('sendNotification handles network errors gracefully', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    mockFetch.mockImplementation(() => Promise.reject(new Error('Network error')));

    // Should not throw - notifications should fail silently
    await expect(sendNotification({
      status: 'success',
      projectId: 'test-project',
      dataset: 'production',
    })).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('sendNotification formats duration correctly', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    const testCases = [
      { duration: 45, expected: '45 seconds' },
      { duration: 90, expected: '1m 30s' },
      { duration: 3665, expected: '1h 1m' },
    ];

    for (const { duration, expected } of testCases) {
      mockFetch.mockClear();
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        text: () => Promise.resolve('ok'),
      }));

      await sendNotification({
        status: 'success',
        projectId: 'test-project',
        dataset: 'production',
        duration,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const durationField = body.blocks
        .find((block: any) => block.fields)
        ?.fields.find((field: any) => field.text.includes('Duration'));

      expect(durationField.text).toContain(expected);
    }
  });

  test('sendNotification truncates long error messages', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    const longError = 'A'.repeat(600);

    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));

    await sendNotification({
      status: 'failure',
      projectId: 'test-project',
      dataset: 'production',
      error: longError,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const errorBlock = body.blocks.find((block: any) =>
      block.text?.text?.includes('Error:')
    );

    // Should be truncated to 500 chars + ...
    expect(errorBlock.text.text.length).toBeLessThan(600);
    expect(errorBlock.text.text).toContain('...');
  });

  test('sendNotification includes attachment colors', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    // Test success color
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));

    await sendNotification({
      status: 'success',
      projectId: 'test-project',
      dataset: 'production',
    });

    let body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe('good');

    // Test failure color
    mockFetch.mockClear();
    await sendNotification({
      status: 'failure',
      projectId: 'test-project',
      dataset: 'production',
      error: 'Test error',
    });

    body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.attachments[0].color).toBe('danger');
  });

  test('sendNotification handles missing optional fields', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';

    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));

    await sendNotification({
      status: 'success',
      projectId: 'test-project',
      dataset: 'production',
      // No optional fields provided
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);

    // Should have defaults for missing fields
    expect(body.text).toContain('test-project');
    expect(body.blocks).toBeArray();

    // Check for "Unknown" defaults
    const fieldsBlock = body.blocks.find((block: any) => block.fields);
    const sizeField = fieldsBlock?.fields.find((field: any) => field.text.includes('Size:'));
    expect(sizeField.text).toContain('Unknown');
  });
});

describe('Test Notifications', () => {
  beforeEach(() => {
    // Clear the mock call history
    mockFetch.mockClear();
    // Reset the implementation to the default
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));
    // Assign our mock to global fetch
    global.fetch = mockFetch as any;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    // Do not restore fetch here, let it persist for the entire describe block
  });

  test('sendTestNotification sends test message correctly', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('ok'),
    }));

    await sendTestNotification('https://hooks.slack.com/test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe('https://hooks.slack.com/test');

    const body = JSON.parse(options.body);
    expect(body.text).toContain('🧪 Test notification');
    expect(body.blocks).toBeArray();
    expect(body.blocks[0].text.text).toContain('Test Notification');
  });

  test('sendTestNotification throws on failure', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Invalid webhook'),
    }));

    await expect(sendTestNotification('https://hooks.slack.com/invalid'))
      .rejects.toThrow('Failed to send test notification: 404 - Invalid webhook');
  });
});

// Restore original fetch after all tests are complete
import { afterAll } from 'bun:test';
afterAll(() => {
  global.fetch = originalFetch;
});