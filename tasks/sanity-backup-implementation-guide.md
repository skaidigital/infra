# Sanity R2 Backup - Implementation Guide

## File Tree Structure

```
infra/
├── .github/
│   └── workflows/
│       └── sanity-r2-backup.yml         # Reusable workflow definition
├── src/
│   ├── backup/
│   │   ├── index.ts                     # Main orchestration logic
│   │   ├── sanity-export.ts            # Sanity dataset export handler
│   │   ├── r2-upload.ts                 # R2 storage operations
│   │   ├── retention.ts                # Backup retention management
│   │   └── notifications.ts            # Slack webhook integration
│   └── utils/
│       ├── retry.ts                    # Exponential backoff implementation
│       ├── checksum.ts                 # SHA256 generation utilities
│       └── logger.ts                   # Logging with secret redaction
├── tests/
│   ├── backup.test.ts                  # Core backup functionality tests
│   ├── retention.test.ts               # Retention policy tests
│   ├── r2-upload.test.ts              # R2 operations tests
│   └── fixtures/
│       ├── mock-dataset.json          # Synthetic Sanity data
│       └── test-assets/               # Test binary files
├── scripts/
│   └── test-backup.ts                 # Local testing script
├── docs/
│   └── restore-guide.md               # Restoration procedures
├── .env.example                        # Environment variables template
├── package.json                        # Dependencies and scripts
├── tsconfig.json                       # TypeScript configuration
├── bunfig.toml                        # Bun configuration
├── README.md                          # Basic usage documentation
└── CHANGELOG.md                       # Version history
```

## Workflow Inputs, Outputs, and Secrets

### Inputs Table

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| projectId | string | Yes | - | Sanity project identifier |
| dataset | string | Yes | - | Dataset name to backup (e.g., 'production', 'staging') |
| includeDrafts | boolean | No | true | Include draft documents in backup |
| includeAssets | boolean | No | true | Download and include binary assets |
| assetConcurrency | number | No | 6 | Parallel asset download limit (1-10) |
| retainCount | number | No | 7 | Days of backups to keep |
| r2Prefix | string | No | "sanity" | Root prefix for R2 object keys |
| slackWebhookUrl | string | No | - | Slack webhook for notifications |

### Secrets Table

| Name | Source | Required | Description |
|------|--------|----------|-------------|
| SANITY_TOKEN | Caller repo | Yes | Read-only token with export permissions |
| R2_ACCOUNT_ID | Org/Environment | Yes | Cloudflare account identifier |
| R2_ACCESS_KEY_ID | Org/Environment | Yes | R2 API access key |
| R2_SECRET_ACCESS_KEY | Org/Environment | Yes | R2 API secret key |
| R2_BUCKET | Org/Environment | Yes | R2 bucket name for backups |

### Outputs Table

| Name | Type | Description |
|------|------|-------------|
| objectKey | string | Full R2 path to uploaded backup archive |
| objectSize | number | Size of backup archive in bytes |
| backupTimestamp | string | ISO 8601 timestamp used in backup naming |

## Step-by-Step Setup Instructions

### 1. Creating the Infrastructure Repository

```bash
# Clone the existing infra repo
git clone <your-org>/infra
cd infra

# Create branch for backup workflow
git checkout -b feat/sanity-r2-backup

# Initialize Bun project
bun init

# Install dependencies
bun add @sanity/cli @aws-sdk/client-s3 @aws-sdk/lib-storage tar

# Install dev dependencies
bun add -d @types/bun typescript
```

### 2. Configuring R2 and Organization Secrets

#### In Cloudflare Dashboard:
1. Navigate to R2 Storage
2. Create bucket: `company-backups` (or preferred name)
3. Go to Manage R2 API Tokens
4. Create token with permissions:
   - Object Read & Write
   - List Bucket
   - Restricted to your bucket
5. Note the credentials:
   - Account ID: `abc123...`
   - Access Key ID: `xyz789...`
   - Secret Access Key: `secret...`
   - Endpoint: `https://<account-id>.r2.cloudflarestorage.com`

#### In GitHub Organization:
1. Go to Settings → Secrets → Actions
2. Add organization secrets:
   - `R2_ACCOUNT_ID`: Your Cloudflare account ID
   - `R2_ACCESS_KEY_ID`: Generated access key
   - `R2_SECRET_ACCESS_KEY`: Generated secret key
   - `R2_BUCKET`: Your bucket name

### 3. Wiring a Caller Repository

In your project repository that needs backups:

#### Add Sanity Token:
1. Go to manage.sanity.io
2. Navigate to your project → API → Tokens
3. Create read token with permissions:
   - Read (all datasets)
   - Export datasets
4. In GitHub repo: Settings → Secrets → Actions
5. Add secret: `SANITY_TOKEN`

#### Create Workflow File:
Create `.github/workflows/backup.yml`:

```yaml
name: Backup Sanity Dataset

on:
  schedule:
    - cron: '0 3 * * *'  # Daily at 3 AM
  workflow_dispatch:     # Manual trigger

jobs:
  backup:
    uses: your-org/infra/.github/workflows/sanity-r2-backup.yml@v1
    with:
      projectId: 'your-project-id'
      dataset: 'production'
      includeDrafts: true
      includeAssets: true
      retainCount: 7
    secrets:
      SANITY_TOKEN: ${{ secrets.SANITY_TOKEN }}
      R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
      R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      R2_BUCKET: ${{ secrets.R2_BUCKET }}
```

### 4. Scheduling Options

#### Basic Daily Backup:
```yaml
schedule:
  - cron: '0 3 * * *'  # Every day at 3 AM
```

#### Multiple Schedules (Assets Weekly, Content Daily):
```yaml
# In backup-full.yml
schedule:
  - cron: '0 3 * * 0'  # Sunday at 3 AM
with:
  includeAssets: true
  includeDrafts: true

# In backup-content.yml
schedule:
  - cron: '0 3 * * 1-6'  # Monday-Saturday at 3 AM
with:
  includeAssets: false
  includeDrafts: true
```

#### With Concurrency Control:
```yaml
concurrency:
  group: backup-${{ github.workflow }}
  cancel-in-progress: false
```

### 5. Running a Test Backup

1. **Manual Trigger via GitHub UI:**
   - Go to Actions tab in your repo
   - Select "Backup Sanity Dataset"
   - Click "Run workflow"
   - Choose branch and click "Run workflow"

2. **Verify in R2:**
   - Check Cloudflare dashboard → R2 → Your bucket
   - Look for: `sanity/your-project/production/2024-01-15_10-30-00.tar.gz`

3. **Check Workflow Logs:**
   - Verify successful export
   - Confirm upload completed
   - Check retention cleanup ran

### 6. Performing a Restore Drill

#### Download Backup:
1. List available backups in R2 dashboard
2. Download desired backup and checksum files:
   - `sanity-projectid-dataset-2024-01-15_10-30-00.tar.gz`
   - `sanity-projectid-dataset-2024-01-15_10-30-00.tar.gz.sha256`

#### Verify Integrity:
```bash
# Verify checksum
sha256sum -c sanity-projectid-dataset-2024-01-15_10-30-00.tar.gz.sha256

# Extract archive
tar -xzf sanity-projectid-dataset-2024-01-15_10-30-00.tar.gz

# Review contents
ls -la extracted-folder/
```

#### Import to Sanity:
```bash
# Create test dataset (optional)
sanity dataset create test-restore

# Import backup
sanity dataset import extracted-folder/data.ndjson test-restore \
  --project your-project-id \
  --replace  # Use with caution on production!

# If assets were included
sanity dataset import extracted-folder/ test-restore \
  --project your-project-id \
  --assets \
  --replace
```

#### Verify Restoration:
1. Open Sanity Studio connected to restored dataset
2. Check document counts match
3. Verify assets load correctly
4. Test critical queries

## FAQ

### Q: What's the difference between drafts and published documents?
**A:** Drafts are unpublished changes. Including drafts ensures work-in-progress is backed up. Excluding them creates smaller, production-only backups.

### Q: Can I backup assets separately from documents?
**A:** Yes, set `includeAssets: false` for document-only backups. Useful for frequent small backups with occasional full backups.

### Q: How much does R2 storage cost?
**A:** R2 charges ~$0.015/GB/month with no egress fees. A 1GB dataset backed up daily for 7 days = ~$0.10/month.

### Q: What happens if a backup fails?
**A:** The workflow retries with exponential backoff. If it still fails, previous backups remain intact and Slack notification is sent (if configured).

### Q: Can I restore to a different project?
**A:** Yes, use Sanity CLI with different project ID. Ensure schemas are compatible.

### Q: How do I handle schema changes?
**A:** After restoration, deploy matching Studio version from Git. The backup contains data only, not schemas.

### Q: Why is my backup taking long?
**A:** Large assets slow down backups. Consider reducing `assetConcurrency` or excluding assets in frequent backups.

### Q: Can multiple repos backup to the same bucket?
**A:** Yes, the prefix structure (`sanity/{projectId}/{dataset}/`) prevents conflicts.

### Common Errors:

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid token" | Expired or wrong Sanity token | Regenerate token with correct permissions |
| "Access Denied" | R2 permissions issue | Check R2 token has write access to bucket |
| "Dataset not found" | Wrong dataset name | Verify dataset exists in Sanity project |
| "Timeout" | Large dataset or slow network | Increase timeout or exclude assets |
| "No space left" | GitHub runner disk full | Reduce backup size or use larger runner |