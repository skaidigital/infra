# Implementation Plan: GitHub Push Notifications to Slack

## Overview
Create a centralized GitHub Actions workflow that monitors pushes to main branches across selected repositories and posts AI-generated summaries to a designated Slack channel using Claude SDK.

## Requirements & Decisions

### User Specifications
- **Primary Goal**: Automated notifications of all main branch pushes with intelligent summaries
- **UI/UX Requirements**: Rich Slack message formatting with repository context and commit details
- **Performance Requirements**: Notifications within 2 minutes of push events
- **Error Handling**: Silent failure for Slack webhook issues, continue processing other repositories

### Technical Decisions
- **Libraries Used**:
  - `claude-code-sdk` for AI summarization
  - GitHub Actions `github-script` for repository API access
  - Native `fetch` for Slack webhook integration
- **State Management**: Stateless workflow execution per repository push
- **Data Flow**: GitHub API → Commit Analysis → Claude SDK → Slack Webhook
- **Testing Strategy**: Manual testing with test repositories and Slack channels

## External Documentation

### Claude Code SDK Python Patterns
From Context7 documentation:
```python
from claude_code_sdk import query, ClaudeCodeOptions

# Basic query for AI summarization
async def main():
    async for message in query(prompt="What is 2 + 2?"):
        print(message)

# Query with specific options
options = ClaudeCodeOptions(
    allowed_tools=["Read", "Write", "Bash"],
    permission_mode='acceptEdits'
)

async for message in query(
    prompt="Summarize these git changes",
    options=options
):
    pass
```

Key APIs:
- `query(prompt, options=None)`: Async generator for Claude interactions
- `ClaudeCodeOptions`: Configuration for allowed tools and permissions

### GitHub Script Integration Pattern
From library docs:
```javascript
// Access GitHub API and workflow context
github.rest.repos.getCommit({
  owner: context.repo.owner,
  repo: context.repo.repo,
  ref: context.sha
})

// Repository comparison for diff analysis
github.rest.repos.compareCommits({
  owner: context.repo.owner,
  repo: context.repo.repo,
  base: 'HEAD~1',
  head: 'HEAD'
})
```

### Error Handling Pattern
From library docs:
```python
from claude_code_sdk import (
    ClaudeSDKError,
    CLINotFoundError,
    ProcessError,
    CLIJSONDecodeError,
)

try:
    async for message in query(prompt="Hello"):
        pass
except CLINotFoundError:
    print("Please install Claude Code")
except ProcessError as e:
    print(f"Process failed with exit code: {e.exit_code}")
```

## Codebase Analysis

### Relevant Files
- `.github/workflows/sanity-r2-backup.yml` - Existing workflow pattern for reference
- `src/backup/notifications.ts` - Slack integration patterns and message formatting
- `src/utils/logger.ts` - Logging and secret redaction utilities
- `package.json` - Package manager (Bun) and dependency patterns

### Patterns to Follow
- **Workflow Pattern**: From `sanity-r2-backup.yml:69-278` - Job structure, secret validation, error handling
- **Slack Messaging**: From `notifications.ts:80-244` - Rich block formatting, error handling, webhooks
- **Secret Management**: From `sanity-r2-backup.yml:39-57` - Organization-level secrets pattern
- **Error Handling**: From `notifications.ts:74-77` - Silent failure for notifications

## Implementation Steps

### Step 1: Create GitHub Actions Workflow
**File**: `.github/workflows/github-slack-notifications.yml`
**Action**: Create new workflow file
```yaml
name: GitHub Push Notifications to Slack

on:
  schedule:
    # Run every 5 minutes to check for new pushes
    - cron: '*/5 * * * *'
  workflow_dispatch: # Allow manual triggering

# No environment variables needed - repositories are defined in .github/config/monitored-repos.json

jobs:
  notify-pushes:
    name: Check for new pushes and notify Slack
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout infrastructure repository
        uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install Claude Code SDK
        run: |
          pip install claude-code-sdk

      - name: Validate secrets
        run: |
          if [ -z "${{ secrets.ANTHROPIC_API_KEY }}" ]; then
            echo "::error::ANTHROPIC_API_KEY secret is not set"
            exit 1
          fi
          if [ -z "${{ secrets.SLACK_WEBHOOK_URL }}" ]; then
            echo "::error::SLACK_WEBHOOK_URL secret is not set"
            exit 1
          fi

      - name: Process repository pushes
        uses: actions/github-script@v7
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        with:
          script: |
            const script = await import('./.github/scripts/process-pushes.ts')
            await script.default({github, context, core})
```
**Pattern Source**: `sanity-r2-backup.yml:1-278`
**Dependencies**: Requires `claude-code-sdk` Python package

### Step 2: Create Push Processing Script
**File**: `./.github/scripts/process-pushes.ts`
**Reason**: Following project structure (centralized scripts in .github/)
**Content**:
```typescript
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

interface ScriptParams {
  github: any;
  context: any;
  core: any;
}

export default async ({github, context, core}: ScriptParams) => {
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
      const commitData = {
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
      console.error(`Error processing ${repoName}:`, error.message);
      // Continue with other repositories
    }
  }

  // Update last check time
  updateLastCheckTime(currentTime);
};

function getLastCheckTime() {
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

function updateLastCheckTime(time) {
  try {
    writeFileSync('.last-check', time);
  } catch (error) {
    console.error('Failed to update last check time:', error.message);
  }
}

async function generateAISummary(commitData) {
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
    console.error('AI summarization failed:', error.message);
    return `Recent changes to ${commitData.repository} by ${commitData.author}. ${commitData.message}`;
  }
}

async function sendSlackNotification(commitData, summary) {
  const message = {
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

    console.log(`Slack notification sent for ${commitData.repository}`);
  } catch (error) {
    // Silent failure for Slack notifications
    console.error(`Failed to send Slack notification for ${commitData.repository}:`, error.message);
  }
}
```
**Integration**: Uses patterns from `notifications.ts:41-78` for Slack integration
**Pattern Source**: `notifications.ts:80-244` for message formatting

### Step 3: Create Scripts Directory
**File**: `.github/scripts/` (directory)
**Action**: Create directory structure
```bash
mkdir -p .github/scripts
```
**Reason**: Following GitHub Actions best practices for script organization

## Validation Checklist

### Build & Type Safety
- [ ] Python script executes without syntax errors
- [ ] JavaScript script follows Node.js compatibility
- [ ] All imports and modules resolve correctly
- [ ] Environment variables are properly accessed

### Code Quality
- [ ] Consistent with existing codebase patterns
- [ ] Error handling follows project standards (silent failure for notifications)
- [ ] No hardcoded secrets or credentials
- [ ] Proper logging and debugging output

### Functionality
- [ ] Workflow triggers on schedule and manual dispatch
- [ ] Repository list is correctly parsed from environment
- [ ] Commit data extraction works for monitored repositories
- [ ] AI summarization produces readable output
- [ ] Slack messages are properly formatted

### Testing
- [ ] Test with a single repository first
- [ ] Verify Slack webhook integration
- [ ] Test error handling (invalid repository, API failures)
- [ ] Validate secret access and permissions

## Edge Cases & Error Scenarios

### Scenario 1: Repository Access Denied
**Handling**: Log error and continue with other repositories
**Code**:
```javascript
try {
  const commits = await github.rest.repos.listCommits({...});
} catch (error) {
  if (error.status === 404 || error.status === 403) {
    console.error(`Access denied to repository ${repoName}: ${error.message}`);
    continue; // Skip this repository
  }
  throw error; // Re-throw unexpected errors
}
```

### Scenario 2: Claude SDK API Failure
**Handling**: Fall back to basic commit message
**Code**:
```javascript
try {
  const summary = await generateAISummary(commitData);
} catch (error) {
  console.error('AI summarization failed, using fallback');
  return `Recent changes to ${commitData.repository} by ${commitData.author}. ${commitData.message}`;
}
```

### Scenario 3: Slack Webhook Failure
**Handling**: Log error but don't fail workflow (silent failure as requested)
**Code**:
```javascript
try {
  await sendSlackNotification(commitData, summary);
} catch (error) {
  console.error(`Slack notification failed: ${error.message}`);
  // Continue execution - don't throw error
}
```

### Scenario 4: No New Commits
**Handling**: Skip processing and continue to next repository
**Code**:
```javascript
if (commits.data.length === 0) {
  console.log(`No new commits in ${repoName}`);
  continue;
}
```

## Testing Requirements

### Manual Testing Steps
1. **Repository Configuration**: Add test repository to `.github/config/monitored-repos.json`
2. **Secret Validation**: Verify `ANTHROPIC_API_KEY` and `SLACK_WEBHOOK_URL` are set
3. **Commit Generation**: Make test commit to monitored repository
4. **Workflow Execution**: Trigger workflow manually via `workflow_dispatch`
5. **Output Verification**: Check Slack channel for formatted notification

### Integration Tests
- Test with repositories having different commit patterns
- Verify handling of repositories with no recent commits
- Test error handling with invalid repository names
- Validate Slack message formatting with various commit types

## Common Pitfalls to Avoid

- **Don't**: Hardcode repository names in the workflow file
  **Do**: Use environment variables for easy maintenance
- **Don't**: Fail the entire workflow if one repository has issues
  **Do**: Log errors and continue processing other repositories
- **Don't**: Expose API keys in logs or error messages
  **Do**: Use proper secret handling and log redaction
- **Don't**: Make the AI prompt too technical
  **Do**: Focus on business impact and user-friendly summaries

## Package Manager & Dependencies
**Detected Package Manager**: bun (based on bun.lock file)
**Install Command**: `pip install claude-code-sdk` (Python SDK for GitHub Actions)

### Required Python Dependencies
```bash
# In GitHub Actions runner
pip install claude-code-sdk
```

### GitHub Actions Dependencies
```yaml
# Required actions in workflow
- uses: actions/checkout@v4
- uses: actions/setup-python@v4
- uses: actions/github-script@v7
```

## Environment Variables
```env
# Required organization secrets
ANTHROPIC_API_KEY=sk-ant-...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Repository configuration is now in .github/config/monitored-repos.json
```

## Implementation Gotchas

### GitHub API Quirks
- Repository access requires proper permissions (read access to target repositories)
- Rate limiting applies to GitHub API calls (especially for multiple repositories)
- Commit comparison API returns different data structure than single commit API

### Claude SDK Integration
- Python environment must have proper ANTHROPIC_API_KEY configuration
- Async operations require proper await handling in subprocess calls
- Error handling should catch specific SDK exceptions for better debugging

### Slack Webhook Patterns
- Webhook URLs should be validated before use
- Block message format is more readable than simple text messages
- Character limits apply to individual blocks (3000 chars per text block)

### Workflow Scheduling
- Cron schedule runs on UTC time
- 5-minute intervals provide good balance between timeliness and API usage
- Manual trigger allows for testing and immediate updates

## Quick Wins
- **Existing Slack Utilities**: Reuse message formatting patterns from `notifications.ts`
- **Error Handling**: Apply existing secret redaction from `logger.ts`
- **Workflow Structure**: Follow proven patterns from `sanity-r2-backup.yml`
- **Silent Failure**: Already implemented pattern for non-critical notification failures

## Notes
- **Scalability**: Current design supports adding new repositories via environment variable updates
- **Security**: All sensitive data handled via GitHub organization secrets
- **Monitoring**: Workflow execution logs provide debugging information
- **Maintenance**: Repository list changes don't require code modifications
- **Performance**: 5-minute polling interval balances responsiveness with resource usage