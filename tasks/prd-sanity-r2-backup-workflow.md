# PRD: Sanity to Cloudflare R2 Backup Workflow

## Introduction/Overview

This feature provides a reusable GitHub Actions workflow that automatically backs up Sanity datasets to Cloudflare R2 storage. The workflow is designed to be installed across multiple repositories (5-20 expected), providing consistent, reliable backups with configurable retention policies. The system will live in the `infra` repository alongside other similar infrastructure workflows, making it a centralized solution for backup automation.

The workflow addresses the need for automated, scheduled backups of Sanity content with proper versioning, retention management, and failure notifications.

## Goals

1. **Automate Backups**: Enable scheduled, hands-free backup of Sanity datasets to R2 storage
2. **Ensure Reliability**: Implement exponential backoff retry logic and clear error reporting
3. **Maintain Consistency**: Provide a single, reusable workflow for all projects
4. **Manage Retention**: Automatically maintain a 7-day rolling backup window
5. **Enable Monitoring**: Send notifications via Slack for backup status
6. **Support Recovery**: Generate checksums and maintain organized storage structure for easy restoration

## User Stories

1. **As a DevOps engineer**, I want to add automated backups to a Sanity project in under 10 minutes, so that I can quickly protect production data.

2. **As a site reliability engineer**, I want to receive Slack notifications when backups fail, so that I can investigate issues promptly.

3. **As a developer**, I want to trigger manual backups via GitHub UI, so that I can create backups before major changes.

4. **As a data recovery specialist**, I want organized, checksummed backups with clear timestamps, so that I can quickly identify and restore the correct backup.

5. **As a project maintainer**, I want automatic cleanup of old backups, so that storage costs remain controlled.

## Functional Requirements

1. **The workflow must accept the following inputs:**
   - `projectId` (string, required): Sanity project identifier
   - `dataset` (string, required): Dataset name to backup
   - `includeDrafts` (boolean, default: true): Include draft documents
   - `includeAssets` (boolean, default: true): Include binary assets
   - `assetConcurrency` (number, default: 6): Concurrent asset download limit
   - `retainCount` (number, default: 7): Days of backups to retain
   - `r2Prefix` (string, default: "sanity"): Storage path prefix
   - `slackWebhookUrl` (string, optional): Webhook for notifications

2. **The workflow must validate all required secrets before execution:**
   - SANITY_TOKEN (caller-provided)
   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (org-level)

3. **The workflow must export Sanity data using @sanity/export CLI tool**

4. **The workflow must create compressed archives with naming pattern:**
   - `sanity-{projectId}-{dataset}-{YYYY-MM-DD_HH-mm-ss}.tar.gz`

5. **The workflow must generate SHA256 checksums for all archives**

6. **The workflow must upload to R2 with structure:**
   - `{r2Prefix}/{projectId}/{dataset}/{timestamp}.tar.gz`
   - `{r2Prefix}/{projectId}/{dataset}/{timestamp}.tar.gz.sha256`

7. **The workflow must delete backups older than `retainCount` days**

8. **The workflow must implement exponential backoff retry logic for failed operations**

9. **The workflow must output:**
   - `objectKey`: Final R2 storage path
   - `objectSize`: Archive size in bytes
   - `backupTimestamp`: UTC timestamp used

10. **The workflow must send Slack notifications (when configured) containing:**
    - Success/failure status
    - Archive size
    - Storage location
    - Execution duration

11. **The workflow must fail with clear error messages for any unrecoverable errors**

12. **The workflow must redact sensitive information from all logs**

## Non-Goals (Out of Scope)

1. **Incremental backups** - Only full backups are supported
2. **Multi-part uploads** - Single archive upload regardless of size
3. **Migration from other backup solutions**
4. **Backup verification/restoration automation** - Manual process only
5. **Multiple notification channels** - Slack only (Axiom logging is future work)
6. **Cross-region replication** - Single R2 bucket only
7. **Encryption at rest** - Relies on R2's built-in encryption
8. **RBAC/Multi-tenancy** - Uses GitHub's permission model
9. **Backup scheduling within workflow** - Relies on caller's cron configuration
10. **Direct restoration workflow** - Manual restoration only

## Design Considerations

### Repository Structure
```
infra/
├── .github/
│   └── workflows/
│       └── sanity-r2-backup.yml    # Reusable workflow
├── src/
│   ├── backup/
│   │   ├── index.ts                # Main backup logic
│   │   ├── sanity-export.ts        # Sanity export wrapper
│   │   ├── r2-upload.ts             # R2 operations
│   │   ├── retention.ts            # Cleanup logic
│   │   └── notifications.ts        # Slack integration
│   └── utils/
│       ├── retry.ts                # Exponential backoff
│       └── checksum.ts             # SHA256 generation
├── tests/
│   ├── backup.test.ts              # Core backup tests
│   ├── retention.test.ts           # Retention policy tests
│   └── fixtures/                   # Synthetic test data
├── package.json
├── bun.lockb
└── README.md
```

### Error Handling Strategy
- **Level 1**: Detailed stack traces with context for debugging
- **Level 2**: Categorized errors (Network, Auth, Storage, Export)
- **Level 3**: User-friendly messages with suggested fixes
- Errors logged with sanitized details (no secrets)
- All errors include correlation ID for tracking

## Technical Considerations

1. **Use Bun runtime** for all Node.js operations
2. **Use Bun test runner** for unit and integration tests
3. **Leverage AWS SDK v3** for S3-compatible R2 operations
4. **Implement streaming** for large file operations to minimize memory usage
5. **Use GitHub Actions cache** for Bun dependencies
6. **Set reasonable timeouts**:
   - Overall job: 2 hours max
   - Individual operations: 30 minutes max
7. **Handle rate limits** with configurable concurrency
8. **Use composite actions** for reusable workflow steps

## Success Metrics

1. **Backup Success Rate**: > 99% successful backups over 30-day period
2. **Execution Time**: Average backup completes within 15 minutes for datasets < 1GB
3. **Storage Efficiency**: Compression ratio > 50% for typical datasets
4. **Recovery Time**: Ability to identify and download correct backup < 5 minutes
5. **Adoption Rate**: Successfully deployed to all target repos within 1 month
6. **Incident Response**: Backup failures detected and notified within 1 minute

## Open Questions

1. **Large Dataset Handling**: Should we set a maximum size limit for safety? Current design handles any size but may timeout.

2. **Concurrent Backups**: Should we prevent overlapping backups of the same dataset? Could use GitHub's concurrency groups.

3. **Backup Validation**: Should we add optional restore testing as part of the workflow? Currently manual only.

4. **Secret Rotation**: How often will R2 credentials rotate? Need to coordinate updates across all repos.

5. **Disaster Recovery**: Should we maintain a secondary backup location? Currently single R2 bucket only.

6. **Performance Monitoring**: Should execution time degradation trigger alerts? Not currently specified.

7. **Asset Deduplication**: Could we optimize storage by deduplicating unchanged assets across backups?

---

## Implementation Notes

### Testing Requirements
The implementation must include these critical tests using Bun test runner:

1. **Backup Creation Test**: Verify tar.gz creation with synthetic data
2. **Checksum Validation Test**: Ensure SHA256 generation and verification
3. **Retention Policy Test**: Confirm old backups are identified and deleted correctly
4. **Error Handling Test**: Validate exponential backoff and retry logic
5. **Secret Masking Test**: Ensure no secrets appear in logs

### Caller Repository Setup
Projects using this workflow will need to:
1. Create `.github/workflows/backup.yml`
2. Reference `infra/.github/workflows/sanity-r2-backup.yml@v1`
3. Provide `SANITY_TOKEN` secret
4. Configure cron schedule (e.g., `0 3 * * *` for 3 AM daily)
5. Set project-specific inputs (projectId, dataset)

### Future Enhancements
See `tasks/future-enhancements.md` for planned improvements including:
- Axiom logging integration
- Multi-part upload support
- Incremental backup capability
- Automated verification service