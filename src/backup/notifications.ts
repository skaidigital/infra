import { logger } from '../utils/logger.ts';

export interface NotificationOptions {
  status: 'success' | 'failure';
  projectId: string;
  dataset: string;
  backupSize?: string;
  objectKey?: string;
  duration?: number;
  error?: string;
}

interface SlackMessage {
  text: string;
  blocks?: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    elements?: Array<{
      type: string;
      text: string;
    }>;
    fields?: Array<{
      type: string;
      text: string;
    }>;
  }>;
  attachments?: Array<{
    color: string;
    fields?: Array<{
      title: string;
      value: string;
      short: boolean;
    }>;
  }>;
}

export async function sendNotification(options: NotificationOptions): Promise<void> {
  const { status, projectId, dataset } = options;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.info('No webhook URL configured, skipping notification');
    return;
  }

  try {
    const message = buildSlackMessage(options);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Slack API error: ${response.status} - ${errorText}`);
    }

    logger.info('Notification sent successfully', { status, projectId, dataset });
  } catch (error) {
    // Don't throw error for notification failures - we don't want to fail the entire backup
    logger.error('Failed to send notification', error as Error);
  }
}

function buildSlackMessage(options: NotificationOptions): SlackMessage {
  const { status, projectId, dataset, backupSize, objectKey, duration, error } = options;
  const timestamp = new Date().toISOString();

  if (status === 'success') {
    return buildSuccessMessage({
      projectId,
      dataset,
      backupSize: backupSize || 'Unknown',
      objectKey: objectKey || 'Unknown',
      duration: duration || 0,
      timestamp,
    });
  } else {
    return buildFailureMessage({
      projectId,
      dataset,
      error: error || 'Unknown error',
      timestamp,
    });
  }
}

function buildSuccessMessage(params: {
  projectId: string;
  dataset: string;
  backupSize: string;
  objectKey: string;
  duration: number;
  timestamp: string;
}): SlackMessage {
  const { projectId, dataset, backupSize, objectKey, duration, timestamp } = params;

  return {
    text: `✅ Backup completed successfully for ${projectId}/${dataset}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '✅ Backup Successful',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Project:*\n${projectId}`,
          },
          {
            type: 'mrkdwn',
            text: `*Dataset:*\n${dataset}`,
          },
          {
            type: 'mrkdwn',
            text: `*Size:*\n${backupSize} MB`,
          },
          {
            type: 'mrkdwn',
            text: `*Duration:*\n${formatDuration(duration)}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Storage Location:*\n\`${objectKey}\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Completed at ${formatTimestamp(timestamp)}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: 'good',
        fields: [
          {
            title: 'Backup Type',
            value: 'Full Backup',
            short: true,
          },
          {
            title: 'Compression',
            value: 'tar.gz',
            short: true,
          },
        ],
      },
    ],
  };
}

function buildFailureMessage(params: {
  projectId: string;
  dataset: string;
  error: string;
  timestamp: string;
}): SlackMessage {
  const { projectId, dataset, error, timestamp } = params;

  return {
    text: `❌ Backup failed for ${projectId}/${dataset}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '❌ Backup Failed',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Project:*\n${projectId}`,
          },
          {
            type: 'mrkdwn',
            text: `*Dataset:*\n${dataset}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:*\n\`\`\`${truncateError(error)}\`\`\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Failed at ${formatTimestamp(timestamp)}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: 'danger',
        fields: [
          {
            title: 'Action Required',
            value: 'Please check the GitHub Actions logs for details',
            short: false,
          },
        ],
      },
    ],
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' UTC';
}

function truncateError(error: string, maxLength: number = 500): string {
  if (error.length <= maxLength) {
    return error;
  }
  return error.substring(0, maxLength - 3) + '...';
}

export async function sendTestNotification(webhookUrl: string): Promise<void> {
  const testMessage: SlackMessage = {
    text: '🧪 Test notification from Sanity R2 Backup',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🧪 *Test Notification*\n\nThis is a test message to verify your Slack webhook configuration.',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Sent at ${formatTimestamp(new Date().toISOString())}`,
          },
        ],
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(testMessage),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send test notification: ${response.status} - ${errorText}`);
  }

  logger.info('Test notification sent successfully');
}