# Databricks Sample Notebooks

This directory contains Databricks notebook examples for integrating Skyflow tokenization and detokenization into your Spark workflows.

## Two Integration Approaches

Choose the approach that best fits your use case:

| Feature | Temporary UDFs | Unity Catalog Functions |
|---------|----------------|-------------------------|
| **Setup Complexity** | Simple (run notebook) | Simple (run notebook cells 1-3) |
| **Function Lifecycle** | Session-scoped | Permanent (cluster-wide) |
| **User Availability** | Single session only | All users with permissions |
| **Configuration** | In notebook (flexible) | Embedded in function (centralized) |
| **Function Signature** | `skyflow_tokenize(value)` | `skyflow_tokenize(value, table, column)` |
| **Cluster/Vault Config** | Set per notebook | Embedded at function creation |
| **View Persistence** | Temporary views only | Persistent views supported |
| **API Batching** | ✅ Yes (25 rows/call) | ❌ No (1 row/call - scalar UDF) |
| **Performance** | Optimal for high-volume | Spark parallelizes across partitions |
| **Best For** | High-volume tokenization, development | Moderate-volume, shared access, persistent views |
| **Files** | `databricks_skyflow.ipynb` | `databricks_unity_catalog.ipynb` |

### Recommendation

**For high-volume workloads (100K+ rows):**
- Use **Temporary UDFs** (`databricks_skyflow.ipynb`) for optimal API batching (25 rows per call)
- Batching reduces API costs and improves performance significantly

**For shared production workflows with moderate volume:**
- Use **Unity Catalog** (`databricks_unity_catalog.ipynb`) for persistent functions and views
- Trade-off: More API calls (1 per row) but better for team collaboration and governance

**For ad-hoc analysis:**
- Use **Temporary UDFs** for flexibility and optimal performance

## Available Notebooks

### 1. Temporary UDFs (Quick Start)

#### databricks_skyflow.ipynb
Complete notebook with tokenization and detokenization using session-scoped Pandas UDFs.

**Features:**
- ✅ Single notebook with full workflow
- ✅ Test data generation (configurable N rows)
- ✅ Tokenization and detokenization UDFs
- ✅ Temporary view creation
- ✅ SQL usage examples
- ✅ Roundtrip verification

**Use Case:** Individual analysts, data scientists doing exploratory work, development and testing.

**Example:**
```python
# After running the UDF registration cells:
spark.sql("""
  SELECT
    user_id,
    skyflow_tokenize(email) as email_token
  FROM raw_users
""")
```

### 2. Unity Catalog External Functions (Production)

#### databricks_unity_catalog.ipynb
**Complete self-contained notebook** - creates and demonstrates persistent external functions.

**What it creates:**
- `skyflow_tokenize()` function (persistent, cluster-wide) with embedded Lambda URL and credentials
- `skyflow_detokenize()` function (persistent, cluster-wide) with embedded Lambda URL and credentials
- Complete usage examples and test data

**Features:**
- ✅ **Self-contained setup** - Creates functions directly in the notebook (setup cells 1-3)
- ✅ Test data generation
- ✅ Persistent table and view creation
- ✅ Roundtrip verification
- ✅ Access control guidance
- ✅ Production best practices

**Important Performance Note:**
- Unity Catalog SQL UDFs are **scalar functions** (process 1 row at a time)
- Makes 1 API call per row (not batched like Pandas UDFs)
- Spark parallelizes across partitions to maintain reasonable performance
- **For high-volume tokenization (100K+ rows), use temporary Pandas UDFs instead for optimal batching**

**Use Case:** Production ETL pipelines with moderate volume, shared team resources, BI tools requiring persistent views.

**Example:**
```sql
-- Functions are always available (no registration needed)
-- Cluster ID and Vault ID are embedded in the function at creation time
SELECT
  user_id,
  skyflow_tokenize(email, 'users', 'email') as email_token
FROM raw_users;

-- Create persistent view (not possible with temporary UDFs!)
CREATE VIEW users_detokenized AS
SELECT
  user_id,
  skyflow_detokenize(email_token) as email
FROM tokenized_users;
```

## Getting Started

### Prerequisites (Both Approaches)

1. **Deploy the Lambda Function** to AWS:
   ```bash
   cd ..  # Go to project root
   ./deploy.sh
   ```
   Note the `/processDatabricks` API URL from the deployment output.

2. **Gather Skyflow credentials:**
   - Cluster ID (e.g., `ebfc9bee4242`)
   - Vault ID (e.g., `ac7f4217c9e54fa7a6f4896c34f6964b`)
   - Table name (for tokenization)

### Quick Start: Temporary UDFs

**Best for:** Ad-hoc analysis, development, individual users

1. **Import notebook** to Databricks:
   - Go to **Workspace** → **Create** → **Import**
   - Upload `databricks_skyflow.ipynb`
   - Attach to a cluster

2. **Configure** (Cell 1):
   ```python
   LAMBDA_URL = "https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/processDatabricks"
   CLUSTER_ID = "your-cluster-id"
   VAULT_ID = "your-vault-id"
   TABLE = "your-table-name"
   COLUMN_NAME = "email"  # or other column
   ```

3. **Run cells 1-3** to register UDFs

4. **Use immediately** in SQL or Python:
   ```python
   # Python
   df_tokenized = df.withColumn("email_token", skyflow_tokenize(col("email")))

   # SQL
   spark.sql("SELECT skyflow_tokenize(email) as token FROM users")
   ```

**Note:** Re-run registration cells after cluster restart.

### Production Setup: Unity Catalog External Functions

**Best for:** Production pipelines, team collaboration, persistent views

1. **Import** `databricks_unity_catalog.ipynb` to Databricks

2. **Configure cell 1** with your credentials:
   ```python
   CATALOG = "your_catalog"
   SCHEMA = "your_schema"
   LAMBDA_URL = "https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com"
   CLUSTER_ID = "your-cluster-id"
   VAULT_ID = "your-vault-id"
   TABLE = "your_table_name"
   ```

3. **Run cells 1-3** to create the functions:
   - Cell 1: Configuration
   - Cell 2: Create tokenize function
   - Cell 3: Create detokenize function

4. **Continue with cells 4+** for usage examples and testing

**That's it!** Functions are created and ready to use.

#### Grant Permissions (Optional)

```sql
GRANT EXECUTE ON FUNCTION skyflow_tokenize TO `data_engineers`;
GRANT EXECUTE ON FUNCTION skyflow_detokenize TO `data_engineers`;
```

#### Usage

```sql
-- Simple function calls with embedded cluster/vault configuration
SELECT skyflow_tokenize(email, 'users', 'email') as token
FROM users;

SELECT skyflow_detokenize(token) as value
FROM tokenized_data;
```

**Note:** Functions persist across cluster restarts and are available to all authorized users.

## Performance Tuning

### Batch Size
The default batch size is 10,000 records per API call. Adjust based on:
- Lambda timeout (default: 30 seconds)
- Average record size
- Network latency

```python
BATCH_SIZE = 5000  # Reduce for large records or slow networks
```

### Parallelism
The UDF automatically runs in parallel across Spark partitions. For optimal performance:
- Keep Lambda in the same AWS region as your Databricks workspace
- Monitor Lambda CloudWatch logs for throttling or timeouts
- Consider increasing Lambda memory for better CPU allocation (see `deploy.sh`)

### Caching
For repeated detokenization of the same tokens:
```python
df_cached = df.cache()
df_result = df_cached.withColumn("value", skyflow_detokenize(col("token")))
```

## Error Handling

Both notebooks include error handling with `resp.raise_for_status()`. If API calls fail:
1. Check Lambda CloudWatch logs: `aws logs tail /aws/lambda/skyflow-lambda-api --follow`
2. Verify network connectivity from Databricks to Lambda endpoint
3. Confirm your Skyflow credentials are valid
4. Check API Gateway logs in AWS Console

## Security Best Practices

1. **Store credentials securely:** Use Databricks Secrets instead of hardcoding:
   ```python
   CLUSTER_ID = dbutils.secrets.get(scope="skyflow", key="cluster-id")
   VAULT_ID = dbutils.secrets.get(scope="skyflow", key="vault-id")
   ```

2. **Network isolation:** Use AWS PrivateLink if Lambda and Databricks are in the same VPC

3. **IAM authentication:** Configure Lambda to use IAM authentication instead of public API Gateway endpoint

4. **Audit logging:** Enable CloudWatch logging for both Lambda and API Gateway

## API Format

The notebooks use the standard `/process` API format with headers:

```python
headers = {
    "Content-Type": "application/json",
    "X-Skyflow-Operation": "tokenize",      # or "detokenize"
    "X-Skyflow-Cluster-ID": CLUSTER_ID,
    "X-Skyflow-Vault-ID": VAULT_ID,
    "X-Skyflow-Table": TABLE                # tokenize only
}
```

For more details on the API format, see the [main README](../README.md).

## Troubleshooting

### Common Issues (Both Approaches)

**"Connection timeout"**
- Increase timeout in the notebook: `timeout=30`
- Increase Lambda timeout: Edit `deploy.sh` TIMEOUT variable and redeploy
- Check network connectivity from Databricks to Lambda endpoint

**"Null values not handled correctly"**
- Both approaches handle NULL values gracefully
- NULLs in input remain NULL in output (no API call made)

**"Rate limiting errors"**
- Lambda automatically batches requests (default: 25 records per API call)
- Configure batching in `lambda/skyflow-config.json`
- Increase Lambda reserved concurrency in AWS Console
- Add retry logic with exponential backoff in notebooks

### Temporary UDF Issues

**"UDF not found in SQL"**
- Ensure you ran `spark.udf.register("skyflow_tokenize", skyflow_tokenize)`
- UDFs are session-scoped; re-register after cluster restart
- Check cell execution order in notebook

**"Cannot create persistent view with temporary UDF"**
- Error: `INVALID_TEMP_OBJ_REFERENCE`
- **Solution:** Use `CREATE OR REPLACE TEMP VIEW` instead of `CREATE VIEW`
- Or migrate to Unity Catalog external functions for persistent views

### Unity Catalog Issues

**"Function not found"**
- Verify setup script ran successfully: `SHOW FUNCTIONS LIKE 'skyflow*'`
- Check catalog and schema: `USE CATALOG x; USE SCHEMA y;`
- Ensure you have EXECUTE permission on the function

**"Connection not found"**
- Connection name must match in function definition
- List connections: `SHOW CONNECTIONS`
- Verify connection URL is correct

**"Permission denied"**
- Ask admin to grant: `GRANT EXECUTE ON FUNCTION skyflow_tokenize TO <user>`
- Check Unity Catalog permissions in workspace settings

**"Cannot access Lambda from Databricks"**
- Verify API Gateway endpoint is public or use AWS PrivateLink
- Check Databricks workspace network settings
- Test connectivity: `curl https://your-api-id.execute-api.region.amazonaws.com/processDatabricks`

## Additional Resources

- [Skyflow Documentation](https://docs.skyflow.com/)
- [AWS Lambda Limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Databricks Pandas UDF Guide](https://docs.databricks.com/en/udf/pandas.html)
- [Main Project README](../README.md)
