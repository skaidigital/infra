import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

// GitHub Actions environment includes fetch globally
declare global {
  function fetch(url: string, options?: RequestInit): Promise<Response>;
}

interface GitHubContext {
  repo: {
    owner: string;
    repo: string;
  };
}

interface GitHubAPI {
  rest: {
    repos: {
      listCommits: (params: {
        owner: string;
        repo: string;
        sha: string;
        since: string;
        per_page: number;
      }) => Promise<{ data: GitHubCommit[] }>;
      getCommit: (params: {
        owner: string;
        repo: string;
        ref: string;
      }) => Promise<{ data: GitHubCommitDetails }>;
    };
  };
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      date: string;
    };
    message: string;
  };
}

interface GitHubCommitDetails {
  html_url: string;
  commit: {
    author: {
      name: string;
      date: string;
    };
    message: string;
  };
  files: GitHubFile[];
}

interface GitHubFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

interface CommitData {
  repository: string;
  author: string;
  message: string;
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }[];
  url: string;
  timestamp: string;
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: {
    type: string;
    text: string;
  }[];
  elements?: {
    type: string;
    text: string;
  }[];
}

interface ScriptParams {
  github: GitHubAPI;
  context: GitHubContext;
  core: {
    setFailed: (message: string) => void;
  };
}

interface RepositoryConfig {
  repositories: string[];
}

export default async ({ github, context, core }: ScriptParams): Promise<void> => {
  // Read monitored repositories from config file
  let repos: string[] = [];
  try {
    const configFile = readFileSync('.github/config/monitored-repos.json', 'utf8');
    const config: RepositoryConfig = JSON.parse(configFile);
    repos = config.repositories || [];
    console.log(`Loaded ${repos.length} repositories to monitor:`, repos);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to load repository config:', errorMessage);
    core.setFailed('Could not load monitored repositories configuration');
    return;
  }

  // Get last check time (stored in a file or use 5 minutes ago)
  const lastCheckTime = getLastCheckTime();
  const currentTime = new Date().toISOString();

  for (const repoName of repos) {
    try {
      console.log(`Checking ${repoName} for new pushes...`);

      // Get recent commits on main branch
      const commits = await github.rest.repos.listCommits({
        owner: context.repo.owner,
        repo: repoName,
        sha: 'main',
        since: lastCheckTime,
        per_page: 10
      });

      if (commits.data.length === 0) {
        console.log(`No new commits in ${repoName}`);
        continue;
      }

      // Get detailed commit information
      const latestCommit = commits.data[0];
      const commitDetails = await github.rest.repos.getCommit({
        owner: context.repo.owner,
        repo: repoName,
        ref: latestCommit.sha
      });

      // Prepare data for AI summarization
      const commitData: CommitData = {
        repository: repoName,
        author: commitDetails.data.commit.author.name,
        message: commitDetails.data.commit.message,
        files: commitDetails.data.files.map(f => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions
        })),
        url: commitDetails.data.html_url,
        timestamp: commitDetails.data.commit.author.date
      };

      // Generate AI summary using Claude SDK
      const summary = await generateAISummary(commitData);

      // Send Slack notification
      await sendSlackNotification(commitData, summary);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error processing ${repoName}:`, errorMessage);
      // Continue with other repositories
    }
  }

  // Update last check time
  updateLastCheckTime(currentTime);
};

function getLastCheckTime(): string {
  try {
    if (existsSync('.last-check')) {
      return readFileSync('.last-check', 'utf8').trim();
    }
  } catch (error) {
    console.log('No previous check time found, using 5 minutes ago');
  }

  // Default to 5 minutes ago
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return fiveMinutesAgo.toISOString();
}

function updateLastCheckTime(time: string): void {
  try {
    writeFileSync('.last-check', time);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to update last check time:', errorMessage);
  }
}

async function generateAISummary(commitData: CommitData): Promise<string> {
  const prompt = `Summarize these git changes for a Slack notification:

Repository: ${commitData.repository}
Author: ${commitData.author}
Commit Message: ${commitData.message}

Files Changed:
${commitData.files.map(f => `- ${f.filename} (${f.status})`).join('\n')}

Please provide a concise 2-3 sentence summary that explains what changed and the business impact, based on the commit message and file changes. Focus on the 'what' and 'why', not technical implementation details.`;

  try {
    // Create Python script to call Claude SDK
    const pythonScript = `
import asyncio
import sys
from claude_code_sdk import query

async def main():
    prompt = """${prompt.replace(/"/g, '\\"')}"""

    try:
        result_text = ""
        async for message in query(prompt=prompt):
            if hasattr(message, 'content'):
                for content in message.content:
                    if hasattr(content, 'text'):
                        result_text += content.text
            else:
                result_text += str(message)

        print(result_text.strip())
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
`;

    // Write Python script to temp file
    writeFileSync('temp_claude_script.py', pythonScript);

    // Execute Python script
    const result = execSync('python temp_claude_script.py', {
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    });

    // Clean up temp file
    unlinkSync('temp_claude_script.py');

    return result.trim();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('AI summarization failed:', errorMessage);
    return `Recent changes to ${commitData.repository} by ${commitData.author}. ${commitData.message}`;
  }
}

async function sendSlackNotification(commitData: CommitData, summary: string): Promise<void> {
  const message: SlackMessage = {
    text: `🚀 **${commitData.repository}** - Main Branch Update`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚀 ${commitData.repository} - Main Branch Update`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Author:*\n${commitData.author}`
          },
          {
            type: 'mrkdwn',
            text: `*Files Changed:*\n${commitData.files.slice(0, 5).map(f => f.filename).join(', ')}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Summary:*\n${summary}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔗 <${commitData.url}|View Changes>`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Pushed at ${new Date(commitData.timestamp).toLocaleString()}`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL!, {
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

    console.log(`Slack notification sent for ${commitData.repository}`);
  } catch (error) {
    // Silent failure for Slack notifications
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to send Slack notification for ${commitData.repository}:`, errorMessage);
  }
}