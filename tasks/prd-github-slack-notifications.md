# PRD: GitHub Push Notifications to Slack

## Introduction/Overview

This feature implements an automated system that monitors pushes to main branches across selected repositories in the GitHub organization and posts AI-generated summaries to a designated Slack channel. The system leverages GitHub Actions for serverless execution, Claude SDK for intelligent summarization, and Slack webhooks for notifications.

**Problem it solves:** Development teams lose visibility into code changes across multiple repositories, making it difficult to stay informed about progress and coordinate work across projects.

**Goal:** Provide instant, automated notifications of all main branch changes with intelligent summaries that highlight what changed and who made the changes.

## Goals

1. **Automated Monitoring:** Automatically detect and respond to pushes to main branches across selected repositories
2. **Intelligent Summarization:** Generate human-readable summaries of changes using AI, leveraging existing commit message formatting
3. **Centralized Notifications:** Deliver all notifications to a single Slack channel for team visibility
4. **Zero Infrastructure:** Implement using GitHub Actions with no external servers or hosting costs
5. **Easy Maintenance:** Simple configuration management through hardcoded repository lists

## User Stories

1. **As a development team lead**, I want to receive automatic notifications when code is pushed to main branches so that I can stay informed about project progress without manually checking multiple repositories.

2. **As a developer**, I want to see summaries of what changed and who made the changes so that I can understand the impact without reading through detailed diffs.

3. **As a project manager**, I want all repository changes to appear in one Slack channel so that I can track development velocity across the organization.

4. **As a team member**, I want notifications to include clear, readable summaries based on our existing commit message standards so that I can quickly understand the business impact of changes.

## Functional Requirements

1. **Repository Monitoring:** The system must monitor a hardcoded list of repositories for pushes to the main branch.

2. **Trigger Mechanism:** The system must trigger immediately on every push to main (real-time notifications).

3. **Change Analysis:** The system must collect commit messages, commit descriptions, author information, and file change lists for AI analysis.

4. **AI Summarization:** The system must use Claude SDK to generate summaries that include:
   - What changed (based on commit messages and descriptions)
   - Who made the changes (commit author)
   - High-level impact summary without detailed diffs

5. **Slack Integration:** The system must post formatted messages to a single Slack channel using webhook URL.

6. **Message Format:** Notifications must include:
   - Repository name and link
   - Author information
   - Files changed (list)
   - AI-generated summary of changes
   - Links back to commits/repository

7. **Centralized Deployment:** The system must run from a single centralized workflow in this repository that monitors other repositories.

8. **Secret Management:** The system must use organization-level secrets for ANTHROPIC_API_KEY and SLACK_WEBHOOK_URL.

9. **Error Handling:** The system must fail silently if Slack webhook fails, without stopping execution or generating alerts.

## Non-Goals (Out of Scope)

1. **Detailed Diff Analysis:** Will not include actual code diffs in notifications
2. **Multiple Channel Support:** Will not support different Slack channels per repository
3. **Batched Notifications:** Will not group multiple pushes into digest format
4. **Retry Mechanisms:** Will not implement retry logic for failed Slack notifications
5. **User Configuration Interface:** Will not provide UI for managing repository lists
6. **Branch Filtering:** Will only monitor main branches, not feature branches
7. **Notification Preferences:** Will not support per-user notification settings

## Technical Considerations

1. **GitHub Actions Workflow:** Implement as `.github/workflows/github-slack-notifications.yml`
2. **Repository List Management:** Maintain hardcoded array of repository names in workflow file
3. **Claude SDK Integration:** Use `claude-code-sdk` Python package with simple query() function
4. **Authentication:** Leverage GitHub Actions built-in authentication for repository access
5. **Webhook Format:** Use Slack's standard webhook JSON format with formatted blocks
6. **Trigger Events:** Use `push` event with `branches: [main]` filter
7. **Git Operations:** Use GitHub Actions checkout and git commands to analyze changes

## Success Metrics

1. **Notification Delivery:** 95%+ of main branch pushes result in Slack notifications
2. **Summary Quality:** AI summaries accurately reflect commit message content and author intent
3. **Response Time:** Notifications appear in Slack within 2 minutes of push to main
4. **Team Adoption:** All team members can identify recent changes across repositories through Slack channel
5. **Maintenance Overhead:** Adding new repositories requires only updating a single configuration list

## Implementation Requirements

### Required Secrets
- `ANTHROPIC_API_KEY`: API key for Claude SDK access
- `SLACK_WEBHOOK_URL`: Target Slack channel webhook URL

### Workflow Structure
1. **Trigger:** On push to main branch of monitored repositories
2. **Analysis Phase:**
   - Checkout repository
   - Get commit information and file changes
   - Format data for AI analysis
3. **Summarization Phase:**
   - Call Claude SDK with commit data
   - Generate human-readable summary
4. **Notification Phase:**
   - Format Slack message with summary
   - POST to webhook URL
   - Continue silently on failure

### Message Template
```
🚀 **[Repository Name]** - Main Branch Update

**Author:** [Commit Author]
**Files Changed:** [List of modified files]

**Summary:** [AI-generated summary based on commit messages]

🔗 [View Changes](link-to-commit)
```

## Open Questions

1. **Repository List Format:** Should the hardcoded repository list include organization prefix (e.g., `org/repo-name`) or just repository names?

2. **Claude Prompt Optimization:** What specific prompt structure will best leverage existing commit message formatting standards?

3. **Slack Channel Management:** Should the system include repository tags or mentions to help filter notifications?

4. **Git History Depth:** How many commits back should be analyzed for context in multi-commit pushes?

5. **Rate Limiting:** Are there any concerns about GitHub API or Claude SDK rate limits with high-frequency pushes?

## Dependencies

- GitHub Actions environment
- Claude SDK Python package (`claude-code-sdk`)
- Slack webhook integration
- Organization-level secret management
- Git command-line tools

---

*This PRD provides the foundation for implementing a serverless, automated notification system that enhances team visibility into code changes across multiple repositories.*