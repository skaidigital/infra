# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an infrastructure automation hub for SKAI Digital built with Bun runtime and TypeScript. It provides multiple automated workflows:

1. **Sanity to Cloudflare R2 Backup**: Automated backup of Sanity datasets with compression, integrity checking, retention management, and notifications.

2. **GitHub Push Notifications to Slack**: AI-powered monitoring system that posts intelligent summaries of main branch pushes to Slack channels using Claude SDK.

## Development Commands

```bash
# Install dependencies
bun install

# Run tests
bun test                    # Run all tests
bun test --watch           # Run tests in watch mode
bun test --coverage        # Run tests with coverage report
bun test src/backup/index.test.ts  # Run specific test file

# Type checking
bun run typecheck          # Check TypeScript types (tsc --noEmit)

# Linting
bun run lint               # Run ESLint on src/*.ts files

# Run backup locally
bun run backup             # Execute backup script (requires environment variables)
```

## Architecture

The codebase follows a modular architecture with clear separation of concerns:

### Core Modules

1. **Backup Orchestrator** (`src/backup/index.ts`)
   - Coordinates the entire backup workflow
   - Manages temporary file creation and cleanup
   - Handles archive creation using tar.gz compression
   - Integrates all modules for end-to-end backup process

2. **Sanity Export** (`src/backup/sanity-export.ts`)
   - Wraps Sanity CLI for dataset export
   - Validates export success
   - Handles document and asset downloads
   - Implements secret redaction in logs

3. **R2 Storage** (`src/backup/r2-upload.ts`)
   - S3-compatible API client for Cloudflare R2
   - Handles file uploads with checksums
   - Manages retention policy (deletes old backups)
   - Implements multipart upload for large files

4. **Notifications** (`src/backup/notifications.ts`)
   - Slack webhook integration
   - Success/failure message formatting
   - Includes backup metadata in notifications

### Utility Modules

- **Logger** (`src/utils/logger.ts`): Structured logging with automatic secret redaction
- **Retry** (`src/utils/retry.ts`): Exponential backoff retry mechanism
- **Checksum** (`src/utils/checksum.ts`): SHA256 checksum generation and verification

### GitHub Actions Integration

The project includes multiple GitHub Actions workflows:

1. **Sanity R2 Backup** (`.github/workflows/sanity-r2-backup.yml`) - Reusable workflow that can be called from other repositories. It validates inputs, manages secrets, and reports job outputs.

2. **GitHub Slack Notifications** (`.github/workflows/github-slack-notifications.yml`) - Monitors repository pushes and posts AI-generated summaries to Slack. Includes:
   - **Push Processing Script** (`.github/scripts/process-pushes.ts`) - TypeScript script that integrates GitHub API, Claude SDK, and Slack webhooks
   - **Repository Configuration** (`.github/config/monitored-repos.json`) - JSON configuration for repositories to monitor

## Environment Variables

### For Sanity Backup Development
Required environment variables (see `.env.example`):
- `SANITY_TOKEN`: Authentication token for Sanity
- `SANITY_PROJECT_ID`: Sanity project identifier
- `SANITY_DATASET`: Dataset to backup (e.g., production)
- `R2_ACCOUNT_ID`: Cloudflare account ID
- `R2_ACCESS_KEY_ID`: R2 access key
- `R2_SECRET_ACCESS_KEY`: R2 secret key
- `R2_BUCKET`: Target R2 bucket name

### For GitHub Actions (Organization Secrets)
Required organization secrets:
- `ANTHROPIC_API_KEY`: Claude API key for AI summaries
- `SLACK_WEBHOOK_URL`: Slack webhook URL for notifications
- Plus all R2 secrets listed above for backup workflows

## Testing Strategy

The project uses Bun's built-in test runner with comprehensive test coverage:
- Unit tests for all utility functions
- Integration tests for module interactions
- Mock implementations for external services
- Test fixtures in `tests/fixtures/`

## Key Implementation Details

1. **Secret Safety**: The logger automatically redacts sensitive patterns (tokens, keys) from all log output
2. **Temporary Files**: All operations use OS temp directory with cleanup on both success and failure
3. **Retry Logic**: Network operations use exponential backoff (3 attempts with increasing delays)
4. **Storage Structure**: Backups stored as `{prefix}/{projectId}/{dataset}/{timestamp}.tar.gz`
5. **Checksum Verification**: SHA256 checksums generated and stored alongside backups