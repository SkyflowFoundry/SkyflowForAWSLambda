# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a generic REST API wrapper for Skyflow SDK operations, deployed as AWS Lambda + API Gateway. Both endpoints use a unified header-based configuration approach using `X-Skyflow-*` headers.

**Core Operations:**
- `tokenize` - Insert sensitive data and receive tokens (multi-column support)
- `detokenize` - Retrieve plaintext values from tokens (vault-level, no table/column needed)
- `query` - Execute SQL queries against vault data
- `tokenize-byot` - Insert records with custom tokens (Bring Your Own Token)

**Endpoints:**
- `/process` - Standard REST API for all operations, configuration via `X-Skyflow-*` headers
- `/processSnowflake` - Snowflake external function format with same `X-Skyflow-*` headers

**Important:** All configuration (cluster ID, vault ID, table, operation) is provided via headers, not in the request payload. This enables multi-cluster deployments from a single Lambda function and provides a clean separation between configuration (headers) and data (payload).

## Key Architecture Principles

### Singleton Pattern for SDK Clients
The Lambda function maintains a singleton `skyflowClient` instance that persists across warm invocations (see `handler.js:12`). Additionally, the SkyflowClient class caches SDK clients per vault ID (`skyflow-client.js:30`) for performance optimization.

### Pure SDK Wrapper Philosophy
The `skyflow-client.js` module is intentionally designed as a **pure pass-through to the Skyflow SDK**. It performs no custom preprocessing, transformations, or business logic. This design ensures compatibility with Skyflow SDK updates and keeps the API surface minimal.

### Configuration Loading Priority
Configuration is loaded via `config.js` with this priority:
1. **Environment variables** (production - used when `SKYFLOW_API_KEY` or `SKYFLOW_CLIENT_ID` is set)
2. **skyflow-config.json file** (development - used as fallback)

**Key Change:** Cluster ID is no longer stored in config. It's provided via headers in each API request, making the Lambda function agnostic to which Skyflow cluster is being targeted.

The deploy script automatically converts `skyflow-config.json` to environment variables during deployment, so credentials are never packaged in the Lambda ZIP file.

### Request Routing Pattern
Both endpoints now use the same header-based configuration approach with `X-Skyflow-*` headers for consistency:

**Standard API (`POST /process`):**
- Configuration via headers: `X-Skyflow-Operation`, `X-Skyflow-Cluster-ID`, `X-Skyflow-Vault-ID`, `X-Skyflow-Table` (for tokenize operations)
- Data in JSON payload: `records`, `tokens`, `query`, `options`
- Extracted case-insensitively in `handler.js:51-60`
- Supports multi-column tokenization

**Snowflake External Functions (`POST /processSnowflake`):**
- Same `X-Skyflow-*` headers as standard API
- Snowflake-specific request format: `{"data": [[rowNum, value], ...]}`
- Additional header: `X-Skyflow-Column-Name` (single-column operations only)
- Main handler (`handler.js:34-38`) routes requests to `snowflake-handler.js` when path includes `/processSnowflake`

### Snowflake Integration Pattern
The Snowflake handler (`snowflake-handler.js`) implements the external function protocol:
- **Request Format:** `{"data": [[rowNum, value], [rowNum, value], ...]}`
- **Response Format:** `{"data": [[rowNum, result], [rowNum, result], ...]}`
- **Header Prefixing:** Snowflake automatically adds `sf-custom-` prefix to all custom headers
  - Example: Define `'X-Skyflow-Operation' = 'tokenize'` in SQL → Snowflake sends `sf-custom-X-Skyflow-Operation`
- **Operation Selection:** Determined by `sf-custom-X-Skyflow-Operation` header ("tokenize" or "detokenize")
- **Configuration:** Extracted from Snowflake custom headers (with sf-custom- prefix):
  - `sf-custom-X-Skyflow-Cluster-ID` (required for both)
  - `sf-custom-X-Skyflow-Vault-ID` (required for both)
  - `sf-custom-X-Skyflow-Table` (required for tokenize)
  - `sf-custom-X-Skyflow-Column-Name` (required for tokenize)
- **Single-Column Limitation:** Each function handles one column only; multi-column tokenization requires multiple external functions
- **Row Order Preservation:** Skyflow SDK guarantees order is maintained, simplifying the implementation
- **Batching:** Snowflake automatically batches rows; each batch is processed as a single request

The handler extracts the operation from the header (accounting for Snowflake's sf-custom- prefix), extracts row numbers and values, calls the appropriate Skyflow operation (using the shared `skyflow-client.js`), and reconstructs the Snowflake response format maintaining row order.

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

**Note:** `cluster_id` and `vault_id` are provided via headers in each API request, not in the config or payload.

### Production (AWS Lambda)
Environment variables are automatically set by the deploy script from `skyflow-config.json`. The configuration file is excluded from the Lambda ZIP file for security.

## File Structure

```
lambda/
├── handler.js               # Lambda entry point, routes to standard or Snowflake handler
├── snowflake-handler.js     # Snowflake external function handler
├── skyflow-client.js        # Pure SDK wrapper, client caching
├── config.js                # Configuration loader (env vars → file)
├── config.example.json      # API Key auth template
├── config.example-jwt.json  # JWT auth template
├── skyflow-config.json      # Local credentials (git-ignored)
├── package.json             # Dependencies (skyflow-node SDK)
└── utils/
    └── headers.js           # Shared header extraction utilities

deploy.sh                    # Deployment script (create/update/destroy)
```

## Code Architecture Details

### handler.js
- **Purpose:** Lambda entry point, request routing, input validation
- **Singleton:** Maintains single `skyflowClient` instance across warm invocations
- **Path Routing:** Routes to `snowflake-handler` when path contains `/processSnowflake` (line 34-38)
- **Header Extraction:** Extracts configuration from `X-Skyflow-*` headers (case-insensitive) using shared `utils/headers.js`
- **Configuration Headers:** `X-Skyflow-Operation`, `X-Skyflow-Cluster-ID`, `X-Skyflow-Vault-ID`, `X-Skyflow-Table`
- **Validation:** Validates required headers are present: `cluster_id` and `vault_id` always required, `table` required for tokenize/tokenize-byot
- **Parameter Passing:** Passes `cluster_id` as first parameter to all skyflow-client methods
- **Response Format:** All responses include `success`, `data`, and `metadata` fields

### snowflake-handler.js
- **Purpose:** Handles Snowflake external function requests with specific format
- **Singleton:** Uses shared `skyflowClient` singleton for warm invocations
- **Header Extraction:** Extracts configuration from `sf-custom-X-Skyflow-*` headers (case-insensitive) using shared `utils/headers.js`
- **Snowflake Prefix:** Accounts for Snowflake's automatic `sf-custom-` prefix on all custom headers
- **Operation Selection:** Determines operation from `sf-custom-X-Skyflow-Operation` header ("tokenize" or "detokenize")
- **Format Conversion:** Converts Snowflake's `[[rowNum, value], ...]` format to/from Skyflow format
- **Order Preservation:** Relies on Skyflow SDK's guarantee to preserve row order
- **Operations:** Supports `tokenize` (requires table and column-name headers) and `detokenize` (vault-level)
- **Single-Column:** Only processes one column per request; validated in `handleTokenize`
- **Error Handling:** Returns proper Snowflake-compatible error responses

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

### utils/headers.js
- **Purpose:** Shared utilities for HTTP header extraction
- **getHeader():** Case-insensitive header lookup with null safety
- **getHeaders():** Batch extraction of multiple headers
- **Used By:** Both `handler.js` and `snowflake-handler.js` for consistent header parsing
- **Benefits:** Eliminates code duplication, single source of truth for header extraction logic

## Multi-Column Tokenization

All tokenization operations support multiple columns per record. Configuration is in headers, data in payload:

```bash
# Single column
curl -X POST $API_URL \
  -H "X-Skyflow-Operation: tokenize" \
  -H "X-Skyflow-Cluster-ID: your-cluster-id" \
  -H "X-Skyflow-Vault-ID: your-vault-id" \
  -H "X-Skyflow-Table: users" \
  -d '{"records": [{"email": "john@example.com"}]}'

# Multi-column
curl -X POST $API_URL \
  -H "X-Skyflow-Operation: tokenize" \
  -H "X-Skyflow-Cluster-ID: your-cluster-id" \
  -H "X-Skyflow-Vault-ID: your-vault-id" \
  -H "X-Skyflow-Table: users" \
  -d '{
    "records": [{
      "email": "john@example.com",
      "name": "John Doe",
      "ssn": "123-45-6789"
    }]
  }'
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

### Missing cluster_id or vault_id headers
All operations require both `X-Skyflow-Cluster-ID` and `X-Skyflow-Vault-ID` headers. These are validated in `handler.js:66-71` before routing.

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
  -H "X-Skyflow-Operation: tokenize" \
  -H "X-Skyflow-Cluster-ID: your-cluster-id" \
  -H "X-Skyflow-Vault-ID: your-vault-id" \
  -H "X-Skyflow-Table: users" \
  -d '{
    "records": [{"email": "test@example.com"}]
  }'

# Detokenize
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Skyflow-Operation: detokenize" \
  -H "X-Skyflow-Cluster-ID: your-cluster-id" \
  -H "X-Skyflow-Vault-ID: your-vault-id" \
  -d '{
    "tokens": ["tok_abc123xyz"]
  }'
```
