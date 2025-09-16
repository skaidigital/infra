# Sanity to Cloudflare R2 Backup Workflow

Automated backup solution for Sanity datasets to Cloudflare R2 storage with retention management, notifications, and GitHub Actions integration.

## Features

- 🔄 **Automated Backups**: Schedule daily backups via GitHub Actions
- 📦 **Compressed Archives**: Efficient tar.gz compression
- ✅ **Data Integrity**: SHA256 checksums for all backups
- 🗑️ **Retention Management**: Automatic cleanup of old backups
- 📢 **Slack Notifications**: Real-time status updates
- 🔒 **Secret Redaction**: Automatic masking of sensitive data in logs
- 🔁 **Retry Logic**: Exponential backoff for transient failures
- 🚀 **High Performance**: Built with Bun runtime

## Complete Setup Guide

### Prerequisites

1. **Sanity Project**: You need a Sanity project with data to backup
2. **Cloudflare R2**: Active R2 account with a bucket created
3. **GitHub Organization**: This workflow uses organization-level secrets

### Step 1: Configure Organization Secrets (One-Time Setup)

**Location**: GitHub Organization → Settings → Secrets and variables → Actions → Secrets

Add these **organization secrets** that will be shared across all repos:

| Secret Name | Where to Find It | Description |
|------------|------------------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare Dashboard → R2 → Overview | Your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → Manage R2 API Tokens → Create API Token | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → Manage R2 API Tokens → Create API Token | R2 secret key |
| `R2_BUCKET` | Cloudflare → R2 → Your bucket name | Name of your R2 bucket (e.g., `backups`) |

**Access Configuration**: Choose which repos can use these secrets:
- All repositories
- Private repositories only
- Selected repositories (recommended)

### Step 2: Infrastructure Repository Setup (This Repo)

**No secrets or configuration needed!** This repository only hosts the reusable workflow. Other repos call it.

### Step 3: Configure Each Project Repository

For **each repository** that needs Sanity backups:

#### A. Add Repository Secret

**Location**: Your Project Repo → Settings → Secrets and variables → Actions → Secrets

| Secret Name | How to Create | Required |
|------------|---------------|----------|
| `SANITY_TOKEN` | sanity.io → Your Project → API → Tokens → Add API token → Choose "Viewer" permission | ✅ Yes |

#### B. Create Workflow File

Create `.github/workflows/backup.yml` in your project repository:

```yaml
name: Daily Sanity Backup

on:
  schedule:
    - cron: '0 3 * * *'  # Daily at 3 AM UTC
  workflow_dispatch:      # Allows manual trigger

jobs:
  backup:
    uses: your-org/infra/.github/workflows/sanity-r2-backup.yml@main
    with:
      # CONFIGURATION VALUES (not secrets - hardcode these)
      projectId: 'abc123xyz'     # Your Sanity project ID (find in sanity.io dashboard)
      dataset: 'production'      # Dataset name: 'production', 'staging', 'development', etc.
      retainCount: 7            # Number of daily backups to keep (default: 7)
      includeDrafts: true       # Include draft documents (default: true)
      includeAssets: true       # Include images/files (default: true)
      assetConcurrency: 6       # Parallel asset downloads (default: 6)
      r2Prefix: 'sanity'        # Folder prefix in R2 bucket (default: 'sanity')
    secrets:
      # SECRETS (pulled from GitHub secrets)
      SANITY_TOKEN: ${{ secrets.SANITY_TOKEN }}              # From repo secret
      R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}            # From org secret
      R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}      # From org secret
      R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }} # From org secret
      R2_BUCKET: ${{ secrets.R2_BUCKET }}                    # From org secret
```

#### C. Optional: Slack Notifications

Add as a **repository variable** (not secret):

**Location**: Your Project Repo → Settings → Secrets and variables → Actions → Variables

| Variable Name | Value | Required |
|--------------|-------|----------|
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/services/...` | ❌ Optional |

Then update your workflow:

```yaml
with:
  slackWebhookUrl: ${{ vars.SLACK_WEBHOOK_URL }}
```

### Complete Configuration Reference

#### Values You Hardcode in Workflow YAML

These are **not secrets** - put them directly in your workflow file:

| Value | Example | Description |
|-------|---------|-------------|
| `projectId` | `'abc123xyz'` | Found in Sanity dashboard URL or project settings |
| `dataset` | `'production'` | The dataset you want to backup |
| `retainCount` | `7` | Days of backups to keep |
| `includeDrafts` | `true` | Whether to backup draft documents |
| `includeAssets` | `true` | Whether to backup images/files |
| `assetConcurrency` | `6` | Number of parallel asset downloads |
| `r2Prefix` | `'sanity'` | Folder path in R2 bucket |

#### Secrets Configuration Summary

| Secret | Where to Add | Where to Find | Scope |
|--------|--------------|---------------|--------|
| `R2_ACCOUNT_ID` | GitHub Organization | Cloudflare Dashboard | All backup repos |
| `R2_ACCESS_KEY_ID` | GitHub Organization | Cloudflare R2 API Tokens | All backup repos |
| `R2_SECRET_ACCESS_KEY` | GitHub Organization | Cloudflare R2 API Tokens | All backup repos |
| `R2_BUCKET` | GitHub Organization | Your R2 bucket name | All backup repos |
| `SANITY_TOKEN` | Each Project Repository | Sanity.io → API → Tokens | Per project |

### Finding Your Configuration Values

#### Sanity Project ID
1. Log into [sanity.io](https://sanity.io)
2. Select your project
3. Find in URL: `https://www.sanity.io/manage/project/YOUR_PROJECT_ID`
4. Or go to Settings → Project ID

#### Sanity Dataset Names
Common datasets:
- `production` - Live data
- `staging` - Testing environment
- `development` - Local development

Check existing datasets: Sanity Studio → Datasets tab

#### Cloudflare R2 Credentials
1. Log into Cloudflare Dashboard
2. Go to R2 → Overview for Account ID
3. Go to R2 → Manage R2 API Tokens
4. Create new API token with:
   - Permission: Object Read & Write
   - Specify bucket or all buckets
   - TTL: No expiry (or set rotation schedule)

## Configuration

### Workflow Inputs

| Input | Description | Default | Required |
|-------|-------------|---------|----------|
| `projectId` | Sanity project ID | - | ✅ |
| `dataset` | Dataset to backup | - | ✅ |
| `includeDrafts` | Include draft documents | `true` | ❌ |
| `includeAssets` | Include binary assets | `true` | ❌ |
| `assetConcurrency` | Concurrent asset downloads | `6` | ❌ |
| `retainCount` | Days of backups to keep | `7` | ❌ |
| `r2Prefix` | Storage path prefix | `sanity` | ❌ |
| `slackWebhookUrl` | Slack webhook for notifications | - | ❌ |

### Environment Variables

For local development, create `.env`:

```bash
# Required
SANITY_TOKEN=your_token
SANITY_PROJECT_ID=your_project
SANITY_DATASET=production
R2_ACCOUNT_ID=your_account
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET=your_bucket

# Optional
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
R2_PREFIX=sanity
RETAIN_COUNT=7
LOG_LEVEL=info  # debug, info, warn, error
```

## Storage Structure

Backups are organized in R2:

```
bucket/
└── sanity/                           # r2Prefix
    └── project-id/                   # projectId
        └── dataset-name/             # dataset
            ├── 2024-01-15T03-00-00-000Z.tar.gz
            ├── 2024-01-15T03-00-00-000Z.tar.gz.sha256
            ├── 2024-01-14T03-00-00-000Z.tar.gz
            └── 2024-01-14T03-00-00-000Z.tar.gz.sha256
```

## Recovery

### Download Backup

```bash
# Download from R2
aws s3 cp \
  s3://your-bucket/sanity/project/dataset/2024-01-15T03-00-00-000Z.tar.gz \
  backup.tar.gz \
  --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com

# Verify checksum
aws s3 cp \
  s3://your-bucket/sanity/project/dataset/2024-01-15T03-00-00-000Z.tar.gz.sha256 \
  backup.tar.gz.sha256 \
  --endpoint-url https://YOUR_ACCOUNT.r2.cloudflarestorage.com

sha256sum -c backup.tar.gz.sha256
```

### Extract Archive

```bash
# Extract backup
tar -xzf backup.tar.gz

# View structure
ls -la export/
# data.ndjson - Document data
# images/     - Asset files (if included)
```

### Import to Sanity

```bash
# Import data back to Sanity
npx sanity dataset import export/data.ndjson TARGET_DATASET \
  --project YOUR_PROJECT_ID \
  --replace  # WARNING: This replaces the entire dataset
```

## Development

### Prerequisites

- [Bun](https://bun.sh) runtime (>= 1.0.0)
- Node.js (for Sanity CLI)

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/infra.git
cd infra

# Install dependencies
bun install
```

### Testing

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test src/backup/index.test.ts

# Type checking
bun run typecheck
```

### Local Backup

```bash
# Set environment variables
export SANITY_TOKEN=...
export SANITY_PROJECT_ID=...
# ... other required vars

# Run backup
bun run backup
```

## Architecture

### Components

1. **GitHub Actions Workflow** (`.github/workflows/sanity-r2-backup.yml`)
   - Orchestrates the backup process
   - Validates inputs and secrets
   - Reports job outputs

2. **Backup Core** (`src/backup/index.ts`)
   - Coordinates export, archival, upload
   - Manages temporary files
   - Handles notifications

3. **Sanity Export** (`src/backup/sanity-export.ts`)
   - Wraps Sanity CLI
   - Validates exports
   - Redacts sensitive logs

4. **R2 Operations** (`src/backup/r2-upload.ts`)
   - S3-compatible API client
   - Upload with verification
   - Retention management

5. **Utilities**
   - **Logger**: Secret redaction, log levels
   - **Retry**: Exponential backoff
   - **Checksum**: SHA256 generation

### Error Handling

- **Retry Logic**: Network failures retry with exponential backoff
- **Secret Safety**: Automatic redaction in logs
- **Cleanup**: Temporary files removed on failure
- **Notifications**: Failures reported to Slack

## Monitoring

### GitHub Actions

- View runs: `Actions` tab in repository
- Manual trigger: `Run workflow` button
- Logs: Click on workflow run

### Slack Notifications

Success message includes:
- Project and dataset
- Backup size
- Storage location
- Execution time

Failure message includes:
- Error details
- Link to GitHub logs

### Metrics

Track these metrics:
- **Success Rate**: Should be > 99%
- **Execution Time**: Typically < 15 minutes
- **Storage Growth**: Monitor bucket size
- **Retention Compliance**: Verify old backups deleted

## Troubleshooting

### Common Issues

**Backup fails with "SANITY_TOKEN secret is not set"**
- Ensure secret is added to repository settings
- Check secret name matches exactly

**"Export file is empty"**
- Verify dataset name is correct
- Check Sanity token has read permissions
- Ensure dataset contains data

**R2 upload fails**
- Verify R2 credentials are correct
- Check bucket exists and is accessible
- Ensure sufficient storage quota

**Retention not working**
- Check R2 credentials have delete permissions
- Verify prefix path is correct
- Check backup count exceeds retention limit

### Debug Mode

Enable detailed logging:

```yaml
env:
  LOG_LEVEL: debug
  DEBUG: true
```

## Security

- ✅ Secrets never logged (automatic redaction)
- ✅ Temporary files cleaned up
- ✅ R2 credentials use IAM with minimal permissions
- ✅ Sanity tokens should be read-only
- ✅ Slack webhooks optional and isolated

## License

MIT

## Support

- Issues: [GitHub Issues](https://github.com/your-org/infra/issues)
- Documentation: [Wiki](https://github.com/your-org/infra/wiki)