# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Sanity to Cloudflare R2 backup workflow system built with Bun runtime and TypeScript. It provides automated backup of Sanity datasets with compression, integrity checking, retention management, and notifications.

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

The project includes a reusable workflow (`.github/workflows/sanity-r2-backup.yml`) that can be called from other repositories. It validates inputs, manages secrets, and reports job outputs.

## Environment Variables

Required environment variables (see `.env.example`):
- `SANITY_TOKEN`: Authentication token for Sanity
- `SANITY_PROJECT_ID`: Sanity project identifier
- `SANITY_DATASET`: Dataset to backup (e.g., production)
- `R2_ACCOUNT_ID`: Cloudflare account ID
- `R2_ACCESS_KEY_ID`: R2 access key
- `R2_SECRET_ACCESS_KEY`: R2 secret key
- `R2_BUCKET`: Target R2 bucket name

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