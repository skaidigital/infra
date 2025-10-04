import Anthropic from '@anthropic-ai/sdk';

export default async ({ github, context, core }) => {
  // Initialize Claude SDK
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Fetch all repositories from the organization
  let repos = [];
  try {
    console.log(`Fetching all repositories from organization: ${context.repo.owner}`);
    const { data: allRepos } = await github.rest.repos.listForOrg({
      org: context.repo.owner,
      type: 'all',
      per_page: 100
    });

    // Filter out archived and disabled repositories
    repos = allRepos
      .filter(repo => !repo.archived && !repo.disabled)
      .map(repo => repo.name);

    console.log(`Found ${repos.length} active repositories to monitor:`, repos);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to fetch organization repositories:', errorMessage);
    core.setFailed('Could not fetch organization repositories');
    return;
  }

  // Check commits from the last hour (matching cron schedule)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const lastCheckTime = oneHourAgo.toISOString();

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

      // Process all new commits (or just the latest for batch summary)
      const commitsToProcess = commits.data;
      console.log(`Found ${commitsToProcess.length} new commits in ${repoName}`);

      // Get detailed information for all commits
      const commitDetails = await Promise.all(
        commitsToProcess.slice(0, 5).map(async (commit) => {
          const details = await github.rest.repos.getCommit({
            owner: context.repo.owner,
            repo: repoName,
            ref: commit.sha
          });
          return details.data;
        })
      );

      // Prepare data for AI summarization
      const changesData = {
        repository: repoName,
        commits: commitDetails.map(commit => ({
          sha: commit.sha.substring(0, 7),
          author: commit.commit.author.name,
          message: commit.commit.message,
          timestamp: commit.commit.author.date,
          files: commit.files.map(f => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ? f.patch.substring(0, 500) : undefined // Include snippet of changes
          })),
          url: commit.html_url
        }))
      };

      // Generate AI summary using Claude SDK
      const summary = await generateAISummary(anthropic, changesData);

      // Send Slack notification
      await sendSlackNotification(changesData, summary);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error processing ${repoName}:`, errorMessage);
      // Continue with other repositories
    }
  }
};

async function generateAISummary(anthropic, changesData) {
  try {
    // Prepare context for Claude
    const commitInfo = changesData.commits.map(c => {
      const fileList = c.files.map(f => `  - ${f.filename} (${f.status}: +${f.additions}/-${f.deletions})`).join('\n');
      return `
Commit: ${c.sha} by ${c.author}
Message: ${c.message}
Files changed:
${fileList}`;
    }).join('\n\n');

    const prompt = `You are a developer summarizing code changes for a team Slack notification. Analyze these commits and provide a CONCISE summary.

Repository: ${changesData.repository}
${commitInfo}

Create a bullet-point summary that:
1. Groups related changes together
2. Explains WHAT changed and WHERE (file/component names)
3. Explains WHY based on commit messages
4. Highlights any breaking changes or important updates
5. Uses technical but clear language

Format rules:
- Start each point with a bullet (•)
- Use backticks for code elements, file names, and technical terms
- Bold important changes using *asterisks*
- Keep each bullet point to 1-2 lines maximum
- Aim for 3-5 main points total
- No markdown headers or excessive formatting

Example format:
• *Fixed CI dependency issue* - Added dependency installation step to resolve \`ERR_MODULE_NOT_FOUND\` errors
• *Implemented AI-powered GitHub summaries* - Integrated Claude SDK for intelligent push notifications
• Added \`@anthropic-ai/sdk\` package to enable contextual code analysis`;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extract the text content from the response
    const summary = response.content[0].type === 'text' ? response.content[0].text : 'Unable to generate summary';
    return summary;
  } catch (error) {
    console.error('Failed to generate AI summary:', error);
    // Fallback to basic summary
    const latestCommit = changesData.commits[0];
    return `• ${latestCommit.message} (${latestCommit.files.length} files changed)`;
  }
}

async function sendSlackNotification(changesData, summary) {
  // Get the latest commit info for header
  const latestCommit = changesData.commits[0];
  const totalFiles = changesData.commits.reduce((sum, c) => sum + c.files.length, 0);
  const commitCount = changesData.commits.length;

  // Format the summary for Slack - ensure proper formatting
  const formattedSummary = summary
    .replace(/\*\*/g, '*') // Convert markdown bold to Slack bold
    .replace(/`([^`]+)`/g, '`$1`') // Ensure inline code formatting works
    .replace(/^- /gm, '• ') // Convert dashes to bullets
    .replace(/^\* /gm, '• '); // Convert asterisks to bullets

  const message = {
    text: `Push to main - ${changesData.repository} - ${latestCommit.author}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Push to main - ${changesData.repository} - ${latestCommit.author}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: formattedSummary
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${commitCount} commit${commitCount > 1 ? 's' : ''} | ${totalFiles} file${totalFiles > 1 ? 's' : ''} changed | <${latestCommit.url}|View changes>`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
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

    console.log(`Slack notification sent for ${changesData.repository}`);
  } catch (error) {
    // Silent failure for Slack notifications
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Failed to send Slack notification for ${changesData.repository}:`, errorMessage);
  }
}