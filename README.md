# Skyflow Lambda API

Generic REST API wrapper for Skyflow SDK operations. Deploy as AWS Lambda + API Gateway to expose Skyflow tokenization, detokenization, and query capabilities via HTTP.

## Features

- **Multi-column tokenization** - Tokenize multiple fields in a single request
- **Vault-level detokenization** - No table/column needed
- **SQL queries** - Execute SELECT queries against vault data
- **BYOT support** - Bring Your Own Token
- **Multi-cluster** - Route to any Skyflow cluster via request payload
- **Serverless** - Zero infrastructure management

---

## Prerequisites

Before deploying, ensure you have:

1. **AWS Account** with CLI access
2. **AWS CLI** installed and configured
   ```bash
   aws --version  # Should show v2.x or higher
   aws sts get-caller-identity  # Verify credentials work
   ```
3. **Node.js 18+** installed
   ```bash
   node --version  # Should show v18.x or higher
   ```
4. **Skyflow Account** with:
   - Vault created
   - Cluster ID (e.g., `ebfc9bee4242`)
   - Vault ID (e.g., `d8f4d2a3b1c7`)
   - API Key or Service Account credentials

---

## Quick Start (End-to-End)

### Step 1: Install Dependencies

```bash
cd lambda
npm install
cd ..
```

### Step 2: Setup AWS Permissions (First-Time Only)

Grant your IAM user permission to deploy Lambda functions:

```bash
# Replace 'your-iam-username' with your actual IAM username
./deploy.sh --setup-permissions your-iam-username
```

This creates an IAM policy with permissions for:
- Creating/updating Lambda functions
- Managing API Gateway
- Creating IAM roles
- CloudWatch logging

### Step 3: Configure Skyflow Credentials

Choose your authentication method:

**Option A: API Key (Simpler)**
```bash
cd lambda
cp config.example.json skyflow-config.json
# Edit skyflow-config.json and add your API key
```

**Option B: JWT Service Account**
```bash
cd lambda
cp config.example-jwt.json skyflow-config.json
# Edit skyflow-config.json and add your service account credentials
```

Example `skyflow-config.json` (API Key):
```json
{
  "credentials": {
    "apiKey": "sky-xxxxxxxxxxxxxxxx"
  }
}
```

### Step 4: Deploy to AWS

```bash
./deploy.sh
```

You'll see output like:
```
============================================================================
Deployment Complete! 🎉
============================================================================

API Gateway URL:
  https://abc123xyz.execute-api.us-east-1.amazonaws.com/process
```

### Step 5: Test Your API

```bash
# Replace with your actual values
curl -X POST https://your-api-url.amazonaws.com/process \
  -H "Content-Type: application/json" \
  -H "X-Operation: tokenize" \
  -d '{
    "cluster_id": "your-cluster-id",
    "vault_id": "your-vault-id",
    "table": "users",
    "records": [{"email": "test@example.com"}]
  }'
```

---

## API Reference

### Endpoint

**Single Endpoint:** `POST /process`

All operations use the same endpoint. The operation is specified via the `X-Operation` header.

### Operations

| Operation | Description |
|-----------|-------------|
| `tokenize` | Insert sensitive data, get tokens back |
| `detokenize` | Convert tokens back to plaintext |
| `query` | Execute SQL queries against vault |
| `tokenize-byot` | Insert with custom tokens |

### Required Fields

All requests require:
- `cluster_id` - Your Skyflow cluster ID
- `vault_id` - Your vault ID

---

## Examples

### Tokenize (Single Column)

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: tokenize" \
  -d '{
    "cluster_id": "ebfc9bee4242",
    "vault_id": "d8f4d2a3b1c7",
    "table": "users",
    "records": [
      {"email": "john@example.com"},
      {"email": "jane@example.com"}
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "email": "tok_abc123xyz",
      "skyflow_id": "uuid-1"
    },
    {
      "email": "tok_def456abc",
      "skyflow_id": "uuid-2"
    }
  ],
  "metadata": {
    "operation": "tokenize",
    "duration_ms": 245
  }
}
```

### Tokenize (Multiple Columns)

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: tokenize" \
  -d '{
    "cluster_id": "ebfc9bee4242",
    "vault_id": "d8f4d2a3b1c7",
    "table": "users",
    "records": [
      {
        "email": "john@example.com",
        "name": "John Doe",
        "ssn": "123-45-6789"
      }
    ],
    "options": {
      "upsert": "email"
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "email": "tok_abc123xyz",
      "name": "tok_def456abc",
      "ssn": "tok_ghi789jkl",
      "skyflow_id": "uuid-1"
    }
  ]
}
```

### Detokenize

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: detokenize" \
  -d '{
    "cluster_id": "ebfc9bee4242",
    "vault_id": "d8f4d2a3b1c7",
    "tokens": ["tok_abc123xyz", "tok_def456abc"]
  }'
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "token": "tok_abc123xyz",
      "value": "john@example.com"
    },
    {
      "token": "tok_def456abc",
      "value": "Jane Doe"
    }
  ]
}
```

### Query

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: query" \
  -d '{
    "cluster_id": "ebfc9bee4242",
    "vault_id": "d8f4d2a3b1c7",
    "query": "SELECT email, created_at FROM users WHERE created_at > '\''2024-01-01'\'' LIMIT 10"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "email": "john@example.com",
      "created_at": "2024-01-15",
      "skyflow_id": "uuid-1"
    }
  ]
}
```

**Query Limitations:**
- Maximum 25 records per query (use LIMIT/OFFSET for pagination)
- SELECT statements only
- Returns plaintext values (not tokens)

### Tokenize-BYOT (Bring Your Own Token)

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Operation: tokenize-byot" \
  -d '{
    "cluster_id": "ebfc9bee4242",
    "vault_id": "d8f4d2a3b1c7",
    "table": "users",
    "records": [
      {
        "fields": {
          "email": "john@example.com"
        },
        "tokens": {
          "email": "my-custom-token-123"
        }
      }
    ]
  }'
```

---

## Client Libraries

### Python

```python
import requests

API_URL = "https://your-api.amazonaws.com/process"

def tokenize(cluster_id, vault_id, table, records):
    response = requests.post(
        API_URL,
        headers={"X-Operation": "tokenize"},
        json={
            "cluster_id": cluster_id,
            "vault_id": vault_id,
            "table": table,
            "records": records
        }
    )
    return response.json()["data"]

# Usage
tokens = tokenize(
    "ebfc9bee4242",
    "d8f4d2a3b1c7",
    "users",
    [{"email": "john@example.com"}]
)
```

### Node.js

```javascript
const axios = require('axios');

const API_URL = 'https://your-api.amazonaws.com/process';

async function tokenize(clusterId, vaultId, table, records) {
  const response = await axios.post(API_URL, {
    cluster_id: clusterId,
    vault_id: vaultId,
    table: table,
    records: records
  }, {
    headers: { 'X-Operation': 'tokenize' }
  });

  return response.data.data;
}

// Usage
const tokens = await tokenize(
  'ebfc9bee4242',
  'd8f4d2a3b1c7',
  'users',
  [{ email: 'john@example.com' }]
);
```

---

## Configuration

### Local Development

Config file: `lambda/skyflow-config.json` (git-ignored)

**API Key:**
```json
{
  "credentials": {
    "apiKey": "sky-xxxxxxxxxxxxxxxx"
  }
}
```

**JWT Service Account:**
```json
{
  "credentials": {
    "clientID": "your-client-id",
    "clientName": "your-client-name",
    "tokenURI": "https://your-cluster.vault.skyflowapis.com/v1/auth/sa/oauth/token",
    "keyID": "your-key-id",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
  }
}
```

### Production (Environment Variables)

The deploy script automatically converts your config file to Lambda environment variables:

- `SKYFLOW_API_KEY` (for API Key auth)
- `SKYFLOW_CLIENT_ID`, `SKYFLOW_CLIENT_NAME`, `SKYFLOW_TOKEN_URI`, `SKYFLOW_KEY_ID`, `SKYFLOW_PRIVATE_KEY` (for JWT auth)

**Note:** `cluster_id` is provided per-request, not in config. This allows routing to multiple clusters from a single Lambda function.

---

## Deployment Commands

```bash
# Deploy or update
./deploy.sh

# Show help
./deploy.sh --help

# Setup IAM permissions (first-time only)
./deploy.sh --setup-permissions <iam-username>

# Destroy all resources
./deploy.sh --destroy
```

---

## Architecture

```
Client → API Gateway → Lambda → Skyflow SDK → Skyflow API
           (Single      (Pure
           Endpoint)     Wrapper)
```

**Key Files:**
- `lambda/handler.js` - Request routing and validation
- `lambda/skyflow-client.js` - SDK wrapper (no custom logic)
- `lambda/config.js` - Credential loader
- `deploy.sh` - Deployment automation

**Performance:**
- Singleton SDK client (reused across warm Lambda invocations)
- Client caching per cluster+vault combination
- Configurable batching and concurrency

---

## Error Handling

All errors return HTTP 500 with:
```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "type": "ErrorType"
  }
}
```

Common errors:
- `Missing required field: cluster_id`
- `Missing required field: vault_id`
- `Tokenization failed: Invalid vault ID`
- `Query failed: SQL syntax error`

---

## Monitoring

### CloudWatch Logs

```bash
aws logs tail /aws/lambda/skyflow-lambda-api --follow
```

### Lambda Metrics

Monitor in AWS Console:
- Invocations
- Duration
- Errors
- Throttles

---

## Security Best Practices

1. **Never commit** `skyflow-config.json` (already in `.gitignore`)
2. **Use AWS Secrets Manager** for production credentials
3. **Enable API Gateway authentication** (API keys, IAM, Cognito)
4. **Rotate credentials** regularly in Skyflow dashboard
5. **Monitor CloudWatch logs** for suspicious activity
6. **Use HTTPS only** (enforced by API Gateway)

---

## Troubleshooting

### Error: "Configuration not found"
- Create `lambda/skyflow-config.json` from `config.example.json`
- Verify the file is in the correct location

### Error: "Missing required field: cluster_id"
- Ensure your request body includes both `cluster_id` and `vault_id`

### High latency
- Increase Lambda memory (more CPU): edit `MEMORY_SIZE` in `deploy.sh`
- Check CloudWatch logs for slow operations

### Deployment fails
- Verify AWS CLI is configured: `aws sts get-caller-identity`
- Run `./deploy.sh --setup-permissions <your-iam-user>` first
- Check you have `jq` installed: `jq --version`

---

## License

MIT

## Support

- **Skyflow SDK**: https://github.com/skyflowapi/skyflow-node
- **Skyflow Docs**: https://docs.skyflow.com
- **Issues**: Open an issue in this repository
