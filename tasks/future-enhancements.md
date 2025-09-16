# Future Enhancements

## Axiom Logging Integration
**Priority:** Medium
**Estimated Effort:** 1-2 days

### Description
Integrate Axiom for centralized logging and monitoring of backup workflow runs.

### Requirements
- Send structured logs to Axiom for all workflow executions
- Include metrics: duration, size, success/failure status, error details
- Use existing Axiom configuration and secrets
- Implement log levels (info, warn, error, debug)
- Create Axiom dashboard for backup monitoring

### Implementation Notes
- Use Axiom's HTTP API or GitHub Action if available
- Structure logs with consistent schema for querying
- Include correlation IDs for tracking across workflow steps
- Consider batching logs for efficiency

### Success Criteria
- All workflow runs appear in Axiom within 1 minute
- Ability to query logs by project, dataset, status, and timestamp
- Dashboard showing backup success rate and trends
- Alert rules for repeated failures

---

## Additional Future Enhancements

### 1. Multi-part Upload Support
- For datasets > 5GB, implement multipart upload to R2
- Parallel chunk uploads for better performance
- Resume capability for interrupted uploads

### 2. Incremental Backups
- Track changed documents since last backup
- Reduce backup time and storage for large datasets
- Maintain full backup schedule alongside incremental

### 3. Backup Verification Service
- Automated restoration tests on schedule
- Integrity verification beyond checksums
- Report on backup recoverability

### 4. Cost Optimization
- Lifecycle policies for moving old backups to cold storage
- Compression optimization based on content type
- Deduplication for similar datasets