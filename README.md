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
   - **Cluster ID** - The prefix of your vault URL (e.g., `ebfc9bee4242` from `https://ebfc9bee4242.vault.skyflowapis.com`)
   - **Vault ID** - Your vault's unique identifier (e.g., `ac7f4217c9e54fa7a6f4896c34f6964b`)
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
  -H "X-Skyflow-Operation: tokenize" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -H "X-Skyflow-Table: users" \
  -H "X-Skyflow-Env: PROD" \
  -d '{
    "records": [{"email": "test@example.com"}]
  }'
```

**Note:** The `X-Skyflow-Env` header is optional and defaults to `PROD` if not provided. Use `SANDBOX` for development/testing environments.

---

## API Reference

### Endpoints

This API provides three endpoints:

| Endpoint | Purpose | Format |
|----------|---------|--------|
| `POST /process` | Standard REST API | Headers + JSON payload |
| `POST /processDatabricks` | Databricks integration | Same as /process (see [samples/](samples/)) |
| `POST /processSnowflake` | Snowflake external functions | Snowflake-specific format |

**Note:** `/process` and `/processDatabricks` use identical request/response formats. The separate Databricks endpoint exists for traffic isolation and analytics.

### Operations

| Operation | Description |
|-----------|-------------|
| `tokenize` | Insert sensitive data, get tokens back |
| `detokenize` | Convert tokens back to plaintext |
| `query` | Execute SQL queries against vault |
| `tokenize-byot` | Insert with custom tokens |

### Required Headers

All requests require these headers:
- `X-Skyflow-Operation` - Operation to perform (tokenize, detokenize, query, tokenize-byot)
- `X-Skyflow-Cluster-ID` - Your Skyflow cluster ID
- `X-Skyflow-Vault-ID` - Your vault ID
- `X-Skyflow-Table` - Table name (required for tokenize and tokenize-byot operations)

### Optional Headers

- `X-Skyflow-Env` - Skyflow environment (SANDBOX or PROD, defaults to PROD)

---

## Examples

### Tokenize (Single Column)

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Skyflow-Operation: tokenize" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -H "X-Skyflow-Table: users" \
  -H "X-Skyflow-Env: PROD" \
  -d '{
    "records": [
      {"email": "john@example.com"},
      {"email": "jane@example.com"}
    ]
  }'
```

**Environment Options:**
- `PROD` - Production environment (default if header omitted)
- `SANDBOX` - Development/testing environment

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
  -H "X-Skyflow-Operation: tokenize" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -H "X-Skyflow-Table: users" \
  -d '{
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

**Governance-Controlled Detokenization (Recommended):**

Omit `redactionType` to let Skyflow's governance engine determine the appropriate redaction based on your vault policies:

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Skyflow-Operation: detokenize" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -d '{
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

**Override Redaction (Optional):**

You can explicitly specify a redaction type to override governance policies:

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Skyflow-Operation: detokenize" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -d '{
    "tokens": ["tok_abc123xyz"],
    "options": {
      "redactionType": "MASKED"
    }
  }'
```

**Redaction Types:**
- **Omit `redactionType`** (recommended) - Skyflow governance engine decides based on vault policies
- `PLAIN_TEXT` - Returns unmasked data: `john@example.com`
- `MASKED` - Returns masked data: `j***@example.com`
- `REDACTED` - Returns fully redacted: `***`
- `DEFAULT` - Uses vault's default redaction setting

### Query

```bash
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Skyflow-Operation: query" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -d '{
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
  -H "X-Skyflow-Operation: tokenize-byot" \
  -H "X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -H "X-Skyflow-Table: users" \
  -d '{
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

## Snowflake External Functions

This API provides a dedicated endpoint for [Snowflake external functions](https://docs.snowflake.com/en/sql-reference/external-functions-introduction), enabling tokenization and detokenization directly within Snowflake queries.

### Snowflake Format

Snowflake external functions use a specific request/response format:

**Request:**
```json
{
  "data": [
    [0, "value1"],
    [1, "value2"]
  ]
}
```

**Response:**
```json
{
  "data": [
    [0, "result1"],
    [1, "result2"]
  ]
}
```

Row numbers must match exactly between request and response.

### Configuration via Headers

Snowflake automatically prefixes all custom headers with `sf-custom-`. When you define a header in your Snowflake EXTERNAL FUNCTION, Snowflake adds this prefix before sending the request.

For example, if you define `'X-Skyflow-Operation' = 'tokenize'` in your function's HEADERS clause, Snowflake will send it as `sf-custom-X-Skyflow-Operation`.

**Headers to define in Snowflake (without the sf-custom- prefix):**

| Header Name (in Snowflake) | Sent As | Required | Used For | Description |
|----------------------------|---------|----------|----------|-------------|
| `X-Skyflow-Operation` | `sf-custom-X-Skyflow-Operation` | Yes | Both | Operation to perform: "tokenize" or "detokenize" |
| `X-Skyflow-Cluster-ID` | `sf-custom-X-Skyflow-Cluster-ID` | Yes | Both | Your Skyflow cluster ID |
| `X-Skyflow-Vault-ID` | `sf-custom-X-Skyflow-Vault-ID` | Yes | Both | Your Skyflow vault ID |
| `X-Skyflow-Env` | `sf-custom-X-Skyflow-Env` | No | Both | Skyflow environment: "SANDBOX" or "PROD" (defaults to PROD) |
| `X-Skyflow-Table` | `sf-custom-X-Skyflow-Table` | Yes | Tokenize only | Table name for storing data |
| `X-Skyflow-Column-Name` | `sf-custom-X-Skyflow-Column-Name` | Yes | Tokenize only | Column name in the table (single-column operations only) |

### Setup in Snowflake

#### 1. Create API Integration

```sql
CREATE OR REPLACE API INTEGRATION skyflow_api_integration
  API_PROVIDER = aws_api_gateway
  API_AWS_ROLE_ARN = 'arn:aws:iam::YOUR_ACCOUNT:role/snowflake-api-role'
  ENABLED = TRUE
  API_ALLOWED_PREFIXES = ('https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/');
```

#### 2. Create Tokenize Function

```sql
-- Production tokenize function
CREATE OR REPLACE EXTERNAL FUNCTION skyflow_tokenize(plaintext VARCHAR)
  RETURNS VARCHAR
  API_INTEGRATION = skyflow_api_integration
  HEADERS = (
    'X-Skyflow-Operation' = 'tokenize',
    'X-Skyflow-Cluster-ID' = 'ebfc9bee4242',
    'X-Skyflow-Vault-ID' = 'ac7f4217c9e54fa7a6f4896c34f6964b',
    'X-Skyflow-Env' = 'PROD',
    'X-Skyflow-Table' = 'users',
    'X-Skyflow-Column-Name' = 'email'
  )
  AS 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processSnowflake';

-- Sandbox tokenize function (optional)
CREATE OR REPLACE EXTERNAL FUNCTION skyflow_tokenize_sandbox(plaintext VARCHAR)
  RETURNS VARCHAR
  API_INTEGRATION = skyflow_api_integration
  HEADERS = (
    'X-Skyflow-Operation' = 'tokenize',
    'X-Skyflow-Cluster-ID' = 'your-sandbox-cluster-id',
    'X-Skyflow-Vault-ID' = 'your-sandbox-vault-id',
    'X-Skyflow-Env' = 'SANDBOX',
    'X-Skyflow-Table' = 'users',
    'X-Skyflow-Column-Name' = 'email'
  )
  AS 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processSnowflake';
```

#### 3. Create Detokenize Function

```sql
-- Production detokenize function
CREATE OR REPLACE EXTERNAL FUNCTION skyflow_detokenize(token VARCHAR)
  RETURNS VARCHAR
  API_INTEGRATION = skyflow_api_integration
  HEADERS = (
    'X-Skyflow-Operation' = 'detokenize',
    'X-Skyflow-Cluster-ID' = 'ebfc9bee4242',
    'X-Skyflow-Vault-ID' = 'ac7f4217c9e54fa7a6f4896c34f6964b',
    'X-Skyflow-Env' = 'PROD'
  )
  AS 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processSnowflake';

-- Sandbox detokenize function (optional)
CREATE OR REPLACE EXTERNAL FUNCTION skyflow_detokenize_sandbox(token VARCHAR)
  RETURNS VARCHAR
  API_INTEGRATION = skyflow_api_integration
  HEADERS = (
    'X-Skyflow-Operation' = 'detokenize',
    'X-Skyflow-Cluster-ID' = 'your-sandbox-cluster-id',
    'X-Skyflow-Vault-ID' = 'your-sandbox-vault-id',
    'X-Skyflow-Env' = 'SANDBOX'
  )
  AS 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processSnowflake';
```

### Usage Examples

#### Tokenize Data During Load

```sql
-- Tokenize email addresses when loading data
INSERT INTO tokenized_customers (id, email_token, name)
SELECT
  id,
  skyflow_tokenize(email) AS email_token,
  name
FROM staging_customers;
```

#### Detokenize with Masking Policies

```sql
-- Create masking policy for role-based access
CREATE OR REPLACE MASKING POLICY email_mask AS (val VARCHAR) RETURNS VARCHAR ->
  CASE
    WHEN CURRENT_ROLE() IN ('ADMIN', 'ANALYST') THEN skyflow_detokenize(val)
    ELSE '***@***.com'
  END;

-- Apply policy to column
ALTER TABLE tokenized_customers
  MODIFY COLUMN email_token
  SET MASKING POLICY email_mask;

-- Admins see real emails, others see masked
SELECT id, email_token, name
FROM tokenized_customers;
```

#### Query with Selective Detokenization

```sql
-- Detokenize only for specific users
SELECT
  customer_id,
  CASE
    WHEN is_vip = TRUE
    THEN skyflow_detokenize(email_token)
    ELSE email_token
  END AS email
FROM customers
WHERE created_date > '2024-01-01';
```

### Test with curl

Emulate a Snowflake request for testing (note the `sf-custom-` prefix that Snowflake adds):

**Tokenize (Production):**
```bash
curl -X POST https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processSnowflake \
  -H "Content-Type: application/json" \
  -H "sf-custom-X-Skyflow-Operation: tokenize" \
  -H "sf-custom-X-Skyflow-Cluster-ID: ebfc9bee4242" \
  -H "sf-custom-X-Skyflow-Vault-ID: ac7f4217c9e54fa7a6f4896c34f6964b" \
  -H "sf-custom-X-Skyflow-Env: PROD" \
  -H "sf-custom-X-Skyflow-Table: users" \
  -H "sf-custom-X-Skyflow-Column-Name: email" \
  -d '{"data":[[0,"john@example.com"],[1,"jane@example.com"]]}'
```

**Response:**
```json
{
  "data": [
    [0, "tok_abc123xyz"],
    [1, "tok_def456abc"]
  ]
}
```

**Detokenize (Sandbox):**
```bash
curl -X POST https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processSnowflake \
  -H "Content-Type: application/json" \
  -H "sf-custom-X-Skyflow-Operation: detokenize" \
  -H "sf-custom-X-Skyflow-Cluster-ID: your-sandbox-cluster-id" \
  -H "sf-custom-X-Skyflow-Vault-ID: your-sandbox-vault-id" \
  -H "sf-custom-X-Skyflow-Env: SANDBOX" \
  -d '{"data":[[0,"tok_abc123xyz"],[1,"tok_def456abc"]]}'
```

**Response:**
```json
{
  "data": [
    [0, "john@example.com"],
    [1, "jane@example.com"]
  ]
}
```

### Performance Notes

- Snowflake batches rows automatically for efficiency
- Row order is preserved (guaranteed by both Snowflake and Skyflow)
- Lambda singleton pattern ensures fast warm starts
- Typical latency: 50-200ms for batches of 100-1000 rows

### Limitations

- Tokenize requires table name and column name headers
- Only single-column operations supported per function
- For multi-column tokenization, create multiple external functions (one per column)

---

## Databricks Integration

The `/processDatabricks` endpoint enables Skyflow tokenization and detokenization in Databricks using **Unity Catalog Batch Python UDFs**.

### Architecture

```
Databricks → Lambda (batched) → Skyflow (batched)
```

- **Batching to Lambda**: Configurable (default 500 rows per call)
- **Lambda to Skyflow**: Automatic internal batching at 25 rows per Skyflow API call
- **Functions**: Persistent in Unity Catalog, governed and shareable
- **Views**: Support for persistent views with automatic tokenization/detokenization

### Quick Start

1. **Deploy Lambda** (see [Quick Start](#quick-start-end-to-end))
2. **Import notebook**: Upload `samples/databricks.ipynb` to Databricks
3. **Configure credentials** in cell 1
4. **Run cells 2-3** to create persistent Unity Catalog functions
5. **Use in SQL**:
   ```sql
   -- Tokenize
   WITH prepared AS (
     SELECT email, 'email' AS col FROM users
   )
   SELECT skyflow_tokenize_column(email, col) as token FROM prepared;

   -- Detokenize
   SELECT skyflow_detokenize(token) as email FROM tokens;
   ```

### Complete Documentation

See **[samples/README.md](samples/README.md)** for complete Databricks integration guide including:
- Detailed setup instructions
- Derived column pattern (required for UC PARAMETER STYLE PANDAS)
- Performance tuning and batch size configuration
- Troubleshooting guide
- Security best practices
- Handler signature patterns

---

## Client Libraries

### Python

```python
import requests

API_URL = "https://your-api.amazonaws.com/process"

def tokenize(cluster_id, vault_id, table, records):
    response = requests.post(
        API_URL,
        headers={
            "X-Skyflow-Operation": "tokenize",
            "X-Skyflow-Cluster-ID": cluster_id,
            "X-Skyflow-Vault-ID": vault_id,
            "X-Skyflow-Table": table
        },
        json={"records": records}
    )
    return response.json()["data"]

def detokenize(cluster_id, vault_id, tokens, redaction_type=None):
    payload = {"tokens": tokens}

    # Only include options if redaction_type is specified
    if redaction_type:
        payload["options"] = {"redactionType": redaction_type}

    response = requests.post(
        API_URL,
        headers={
            "X-Skyflow-Operation": "detokenize",
            "X-Skyflow-Cluster-ID": cluster_id,
            "X-Skyflow-Vault-ID": vault_id
        },
        json=payload
    )
    return response.json()["data"]

# Usage
tokens = tokenize(
    "ebfc9bee4242",
    "ac7f4217c9e54fa7a6f4896c34f6964b",
    "users",
    [{"email": "john@example.com"}]
)

# Governance-controlled detokenization (recommended)
values = detokenize(
    "ebfc9bee4242",
    "ac7f4217c9e54fa7a6f4896c34f6964b",
    ["tok_abc123xyz"]
)

# Or explicitly specify masking
masked_values = detokenize(
    "ebfc9bee4242",
    "ac7f4217c9e54fa7a6f4896c34f6964b",
    ["tok_abc123xyz"],
    redaction_type="MASKED"
)
```

### Node.js

```javascript
const axios = require('axios');

const API_URL = 'https://your-api.amazonaws.com/process';

async function tokenize(clusterId, vaultId, table, records) {
  const response = await axios.post(API_URL,
    { records: records },
    {
      headers: {
        'X-Skyflow-Operation': 'tokenize',
        'X-Skyflow-Cluster-ID': clusterId,
        'X-Skyflow-Vault-ID': vaultId,
        'X-Skyflow-Table': table
      }
    }
  );

  return response.data.data;
}

async function detokenize(clusterId, vaultId, tokens, redactionType = null) {
  const payload = { tokens: tokens };

  // Only include options if redactionType is specified
  if (redactionType) {
    payload.options = { redactionType: redactionType };
  }

  const response = await axios.post(API_URL, payload, {
    headers: {
      'X-Skyflow-Operation': 'detokenize',
      'X-Skyflow-Cluster-ID': clusterId,
      'X-Skyflow-Vault-ID': vaultId
    }
  });

  return response.data.data;
}

// Usage
const tokens = await tokenize(
  'ebfc9bee4242',
  'ac7f4217c9e54fa7a6f4896c34f6964b',
  'users',
  [{ email: 'john@example.com' }]
);

// Governance-controlled detokenization (recommended)
const values = await detokenize(
  'ebfc9bee4242',
  'ac7f4217c9e54fa7a6f4896c34f6964b',
  ['tok_abc123xyz']
);

// Or explicitly specify masking
const maskedValues = await detokenize(
  'ebfc9bee4242',
  'ac7f4217c9e54fa7a6f4896c34f6964b',
  ['tok_abc123xyz'],
  'MASKED'
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
- `Missing required header: X-Skyflow-Cluster-ID`
- `Missing required header: X-Skyflow-Vault-ID`
- `Missing required header: X-Skyflow-Table`
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

### Error: "Missing required header: X-Skyflow-Cluster-ID"
- Ensure your request includes the required headers: `X-Skyflow-Cluster-ID` and `X-Skyflow-Vault-ID`

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
