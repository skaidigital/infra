## Relevant Files

- `.github/workflows/sanity-r2-backup.yml` - Main reusable workflow definition for GitHub Actions.
- `src/backup/index.ts` - Main orchestration logic that coordinates the backup process.
- `src/backup/index.test.ts` - Unit tests for the main backup orchestration logic.
- `src/backup/sanity-export.ts` - Wrapper for Sanity CLI export functionality.
- `src/backup/sanity-export.test.ts` - Unit tests for Sanity export operations.
- `src/backup/r2-upload.ts` - Cloudflare R2 storage operations using AWS SDK.
- `src/backup/r2-upload.test.ts` - Unit tests for R2 upload functionality.
- `src/backup/retention.ts` - Logic for identifying and deleting old backups.
- `src/backup/retention.test.ts` - Unit tests for retention policy enforcement.
- `src/backup/notifications.ts` - Slack webhook integration for status notifications.
- `src/backup/notifications.test.ts` - Unit tests for Slack notifications.
- `src/utils/retry.ts` - Exponential backoff implementation for failed operations.
- `src/utils/retry.test.ts` - Unit tests for retry logic.
- `src/utils/checksum.ts` - SHA256 generation utilities for archive validation.
- `src/utils/checksum.test.ts` - Unit tests for checksum generation.
- `src/utils/logger.ts` - Logging utilities with secret redaction.
- `src/utils/logger.test.ts` - Unit tests for logger and secret masking.
- `tests/fixtures/mock-dataset.json` - Synthetic Sanity data for testing.
- `package.json` - Node.js dependencies and scripts configuration.
- `tsconfig.json` - TypeScript compiler configuration.
- `bunfig.toml` - Bun runtime configuration.
- `.env.example` - Template for environment variables.

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `MyComponent.tsx` and `MyComponent.test.tsx` in the same directory).
- Use `npx jest [optional/path/to/test/file]` to run tests. Running without a path executes all tests found by the Jest configuration.

## Tasks

- [x] 1.0 Initialize project infrastructure
- [x] 2.0 Set up GitHub Actions workflow foundation
- [x] 3.0 Implement core backup logic
- [x] 4.0 Implement Sanity export functionality
- [x] 5.0 Implement R2 storage operations
- [x] 6.0 Implement retention management
- [x] 7.0 Implement notification system
- [x] 8.0 Implement utility modules
- [x] 9.0 Create comprehensive test suite
- [x] 10.0 Add documentation and validation