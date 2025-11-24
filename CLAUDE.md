# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a generic REST API wrapper for Skyflow SDK operations, deployed as AWS Lambda + API Gateway. It provides a single endpoint that routes to different Skyflow operations based on the `X-Operation` header.

**Core Operations:**
- `tokenize` - Insert sensitive data and receive tokens (multi-column support)
- `detokenize` - Retrieve plaintext values from tokens (vault-level, no table/column needed)
- `query` - Execute SQL queries against vault data
- `tokenize-byot` - Insert records with custom tokens (Bring Your Own Token)

**Important:** Cluster ID is now provided in each API request payload (not in config), enabling multi-cluster deployments from a single Lambda function.

## Key Architecture Principles

### Singleton Pattern for SDK Clients
The Lambda function maintains a singleton `skyflowClient` instance that persists across warm invocations (see `handler.js:12`). Additionally, the SkyflowClient class caches SDK clients per vault ID (`skyflow-client.js:30`) for performance optimization.

### Pure SDK Wrapper Philosophy
The `skyflow-client.js` module is intentionally designed as a **pure pass-through to the Skyflow SDK**. It performs no custom preprocessing, transformations, or business logic. This design ensures compatibility with Skyflow SDK updates and keeps the API surface minimal.

### Configuration Loading Priority
Configuration is loaded via `config.js` with this priority:
1. **Environment variables** (production - used when `SKYFLOW_API_KEY` or `SKYFLOW_CLIENT_ID` is set)
2. **skyflow-config.json file** (development - used as fallback)

**Key Change:** Cluster ID is no longer stored in config. It's provided in each API request, making the Lambda function agnostic to which Skyflow cluster is being targeted.

The deploy script automatically converts `skyflow-config.json` to environment variables during deployment, so credentials are never packaged in the Lambda ZIP file.

### Request Routing Pattern
All operations use a single endpoint (`POST /process`). The operation is determined by the `X-Operation` header, which is extracted case-insensitively in `handler.js:38`. This allows for a unified API Gateway configuration while supporting multiple operations.

## Development Commands

### Install Dependencies
```bash
cd lambda
npm install
```

### Deploy to AWS
```bash
# From project root
./deploy.sh
```

This creates:
- Lambda function with Skyflow SDK
- API Gateway HTTP API with single `/process` route
- IAM role with basic Lambda execution permissions

### Update Existing Deployment
```bash
./deploy.sh
```
(The script automatically detects if the Lambda function exists and updates it)

### Destroy All Resources
```bash
./deploy.sh --destroy
```

### Setup AWS Permissions for IAM User
```bash
./deploy.sh --setup-permissions <iam-username>
```

## Configuration Setup

### Development (Local Testing)
1. Copy the appropriate example config:
   ```bash
   cd lambda
   # For API Key authentication:
   cp config.example.json skyflow-config.json

   # OR for JWT authentication:
   cp config.example-jwt.json skyflow-config.json
   ```

2. Edit `skyflow-config.json` with your Skyflow credentials

**API Key Auth:**
```json
{
  "credentials": {
    "apiKey": "sky-your-api-key-here"
  }
}
```

**JWT Auth (Service Account):**
```json
{
  "credentials": {
    "clientID": "...",
    "clientName": "...",
    "tokenURI": "...",
    "keyID": "...",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n..."
  }
}
```

**Note:** `cluster_id` is provided in each API request payload, not in the config.

### Production (AWS Lambda)
Environment variables are automatically set by the deploy script from `skyflow-config.json`. The configuration file is excluded from the Lambda ZIP file for security.

## File Structure

```
lambda/
├── handler.js               # Lambda entry point, request routing, validation
├── skyflow-client.js        # Pure SDK wrapper, client caching
├── config.js                # Configuration loader (env vars → file)
├── config.example.json      # API Key auth template
├── config.example-jwt.json  # JWT auth template
├── skyflow-config.json      # Local credentials (git-ignored)
└── package.json             # Dependencies (skyflow-node SDK)

deploy.sh                    # Deployment script (create/update/destroy)
```

## Code Architecture Details

### handler.js
- **Purpose:** Lambda entry point, request routing, input validation
- **Singleton:** Maintains single `skyflowClient` instance across warm invocations
- **Routing:** Extracts `X-Operation` header (case-insensitive) and routes to appropriate client method
- **Validation:** Validates both `cluster_id` and `vault_id` are present in every request
- **Parameter Passing:** Passes `cluster_id` as first parameter to all skyflow-client methods
- **Response Format:** All responses include `success`, `data`, and `metadata` fields

### skyflow-client.js
- **Purpose:** Pure wrapper around Skyflow Node SDK
- **Client Caching:** Maintains `clients` object keyed by `cluster_id:vault_id` combination
- **Dynamic Cluster Routing:** Accepts `cluster_id` as parameter, constructs vault URL as needed
- **Auth Detection:** Automatically detects API Key vs JWT auth based on credentials structure
- **Multi-Column Support:** All operations support multiple columns per record

### config.js
- **Purpose:** Unified configuration loading (credentials only, no cluster info)
- **Priority:** Environment variables override config file
- **Validation:** Checks for required fields based on auth type
- **Batching:** Optional batching configuration for tokenize/detokenize operations
- **Key Change:** No longer loads or validates vault URL or cluster ID

## Multi-Column Tokenization

All tokenization operations support multiple columns per record:

```javascript
// Single column
{
  "cluster_id": "your-cluster-id",
  "vault_id": "your-vault-id",
  "records": [{"email": "john@example.com"}]
}

// Multi-column
{
  "cluster_id": "your-cluster-id",
  "vault_id": "your-vault-id",
  "records": [
    {
      "email": "john@example.com",
      "name": "John Doe",
      "ssn": "123-45-6789"
    }
  ]
}
```

The response includes tokens for **all columns**:
```javascript
{
  "data": [
    {
      "email": "tok_abc123",
      "name": "tok_def456",
      "ssn": "tok_ghi789",
      "skyflow_id": "uuid-1"
    }
  ]
}
```

## Upsert Behavior

The `upsert` option supports both string and array formats:
- `"upsert": "email"` - Upsert by single column
- `"upsert": ["email"]` - Upsert by array (only first column used due to SDK limitation)

If a record with the upsert column value already exists, the API returns the existing token instead of creating a new one.

## Common Pitfalls

### Missing cluster_id or vault_id
All operations require both `cluster_id` and `vault_id` in the request body. These are validated in `handler.js:44-49` before routing.

### Detokenization is Vault-Level
Unlike tokenization, detokenization does not require `table` or `column` fields. Tokens are vault-level identifiers.

### Detokenization Redaction Control
Detokenization supports optional `redactionType` in the `options` object:
- **Omit `redactionType`** (recommended) - Skyflow's governance engine determines redaction based on vault policies
- `PLAIN_TEXT` - Returns unmasked data
- `MASKED` - Returns masked data (e.g., `j***@example.com`)
- `REDACTED` - Returns fully redacted data (`***`)
- `DEFAULT` - Uses vault's default redaction setting

The implementation in `skyflow-client.js:149-158` only includes the `redactionType` field if explicitly provided, allowing Skyflow's governance to control access when omitted.

### Query Limitations
- Maximum 25 records per query (Skyflow limitation)
- SELECT statements only
- Cannot return tokens (only plaintext values)

### BYOT Format
Tokenize-BYOT records must have `fields` and `tokens` objects with **matching column names**. This is validated in `handler.js:189-192`.

## AWS Lambda Performance Tuning

The Lambda function is configured with:
- **Memory:** 512 MB (see `deploy.sh:25`)
- **Timeout:** 30 seconds (see `deploy.sh:26`)
- **Runtime:** Node.js 18.x

To adjust performance:
1. Edit `deploy.sh` and modify `MEMORY_SIZE` or `TIMEOUT`
2. Re-run `./deploy.sh` to update the function configuration

Higher memory allocation provides proportionally more CPU, which can reduce latency for operations processing many records.

## Monitoring and Debugging

All operations log to CloudWatch with this structure:
```
Operation: tokenize
Vault ID: abc123
Tokenize: vault=abc123, table=users, columns=[email, name], count=10
Tokenize complete: 10 records processed
Operation completed in 245ms
```

To view logs:
```bash
aws logs tail /aws/lambda/skyflow-lambda-api --follow
```

## Testing the API

After deployment, test with curl:

```bash
# Get API URL from deployment output
API_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com/process"

# Tokenize
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: tokenize" \
  -d '{
    "cluster_id": "your-cluster-id",
    "vault_id": "your-vault-id",
    "table": "users",
    "records": [{"email": "test@example.com"}]
  }'

# Detokenize
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: detokenize" \
  -d '{
    "cluster_id": "your-cluster-id",
    "vault_id": "your-vault-id",
    "tokens": ["tok_abc123xyz"]
  }'
```
