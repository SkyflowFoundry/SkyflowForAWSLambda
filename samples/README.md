# Databricks Integration with Skyflow

This directory contains a Databricks notebook for integrating Skyflow tokenization and detokenization into your Spark workflows using Unity Catalog Batch Python UDFs.

## Overview

The integration uses **Unity Catalog Batch Python UDFs** with `PARAMETER STYLE PANDAS` for:
- ✅ **Batched execution** - High-throughput batching to Lambda, then Lambda batches to Skyflow
- ✅ **Persistent functions** - Stored in Unity Catalog, available across all clusters
- ✅ **Governed and shareable** - Fine-grained access control
- ✅ **Persistent views** - Create views that automatically tokenize/detokenize
- ✅ **Production ready** - Perfect for ETL pipelines and BI tools

## Architecture

```
Databricks → API Gateway '/processDatabricks' → Lambda (batched) → Skyflow (batched)
```

- **Credentials:** Managed in Lambda (not in notebooks)
- **Batching to Lambda:** Configurable (default 500 rows per call for high throughput)
- **Lambda to Skyflow:** Automatic internal batching at 25 rows per Skyflow API call
- **Performance:** Optimal for high-volume tokenization (100K+ rows)

## Available Notebook

### databricks.ipynb

Complete self-contained notebook that creates persistent Unity Catalog functions for tokenization and detokenization.

**What it creates:**
- `skyflow_tokenize_column(column_value, column_name)` - Batched tokenization function
- `skyflow_detokenize(token)` - Batched detokenization function

**Features:**
- ✅ Self-contained setup - Creates functions directly in the notebook
- ✅ Test data generation (configurable N rows)
- ✅ Persistent table and view creation
- ✅ Roundtrip verification
- ✅ Access control guidance
- ✅ Production best practices

**Usage Example:**
```sql
-- Tokenization using derived column pattern
WITH prepared_data AS (
  SELECT
    user_id,
    email,
    'email' AS email_col
  FROM raw_users
)
SELECT
  user_id,
  skyflow_tokenize_column(email, email_col) AS email_token
FROM prepared_data;

-- Detokenization
SELECT
  user_id,
  skyflow_detokenize(email_token) AS email
FROM tokenized_users;

-- Create persistent view (not possible with temporary UDFs!)
CREATE VIEW users_detokenized AS
SELECT
  user_id,
  skyflow_detokenize(email_token) AS email
FROM tokenized_users;
```

## Getting Started

### Prerequisites

1. **Unity Catalog enabled workspace** - Modern Databricks runtime (DBR 13.3+) or SQL warehouse
2. **Lambda function deployed** - See main README for deployment instructions
3. **Skyflow credentials** - Cluster ID, Vault ID, Table name

### Quick Start

1. **Deploy the Lambda Function** to AWS:
   ```bash
   cd ..  # Go to project root
   ./deploy.sh
   ```
   Note the `/processDatabricks` API URL from the deployment output.

2. **Import notebook** to Databricks:
   - Go to **Workspace** → **Create** → **Import**
   - Upload `databricks.ipynb`
   - Attach to a cluster or SQL warehouse

3. **Configure cell 1** with your credentials:
   ```python
   CATALOG = "your_catalog_name"
   SCHEMA = "your_schema_name"
   LAMBDA_URL = "https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/processDatabricks"
   CLUSTER_ID = "your-cluster-id"
   VAULT_ID = "your-vault-id"
   TABLE = "your_table_name"
   ```

4. **Run cells 2-3** to create the persistent functions in Unity Catalog

5. **Continue with cells 4+** for usage examples and testing

**That's it!** Functions are created and ready to use across all clusters and users (with appropriate permissions).

## Performance Tuning

### Batch Size

The default batch size is 500 records per Lambda API call. This controls how many rows are sent to Lambda in each call. Lambda then internally batches at 25 rows per Skyflow API call.

**Recommended:** Use a high batch size (500-1000) to allow Lambda to scale out and churn through data quickly.

Adjust based on:
- Lambda timeout (default: 30 seconds)
- Average record size
- Network latency

Edit cell 1:
```python
BATCH_SIZE = 500  # Higher values = better Lambda scalability
```

### Parallelism

The UDFs automatically run in parallel across Spark partitions. For optimal performance:
- Keep Lambda in the same AWS region as your Databricks workspace
- Monitor Lambda CloudWatch logs for throttling or timeouts
- Consider increasing Lambda memory for better CPU allocation (see `deploy.sh`)

### Caching

Caching the DataFrame to avoid re-reading input:
```python
df_cached = df.cache()
df_result = df_cached.withColumn("value", skyflow_detokenize(col("token")))
```

## Derived Column Pattern

Due to Unity Catalog limitations, you cannot pass literal strings directly to `PARAMETER STYLE PANDAS` functions.

**❌ Doesn't work:**
```sql
SELECT skyflow_tokenize_column(email, 'email') FROM users
```

**✅ Use derived column pattern:**
```sql
WITH prepared AS (
  SELECT email, 'email' AS email_col
  FROM users
)
SELECT skyflow_tokenize_column(email, email_col)
FROM prepared
```

For multiple columns:
```sql
WITH prepared AS (
  SELECT
    user_id,
    email, 'email' AS email_col,
    phone, 'phone' AS phone_col
  FROM users
)
SELECT
  user_id,
  skyflow_tokenize_column(email, email_col) AS email_token,
  skyflow_tokenize_column(phone, phone_col) AS phone_token
FROM prepared
```

## Error Handling

If operations fail:

1. **Check Lambda CloudWatch logs:**
   ```bash
   aws logs tail /aws/lambda/skyflow-lambda-api --follow
   ```

2. **Verify network connectivity** from Databricks to Lambda endpoint

3. **Confirm Skyflow credentials** are valid in Lambda environment

4. **Check API Gateway logs** in AWS Console

5. **Verify function exists:**
   ```sql
   SHOW FUNCTIONS LIKE 'skyflow*'
   ```

## Security Best Practices

1. **Credentials in Lambda:** Skyflow credentials are managed in Lambda environment (not in notebooks)

2. **Network isolation:** Use AWS PrivateLink if Lambda and Databricks are in the same VPC

3. **IAM authentication:** Configure Lambda to use IAM authentication instead of public API Gateway endpoint

4. **Access control:** Grant appropriate Unity Catalog permissions:
   ```sql
   GRANT EXECUTE ON FUNCTION skyflow_tokenize_column TO `data_engineers`;
   GRANT EXECUTE ON FUNCTION skyflow_detokenize TO `data_engineers`;
   ```

5. **Audit logging:** Enable CloudWatch logging for both Lambda and API Gateway

## Troubleshooting

### Common Issues

**"Function not found"**
- Verify setup ran successfully: `SHOW FUNCTIONS LIKE 'skyflow*'`
- Check catalog and schema: `USE CATALOG x; USE SCHEMA y;`
- Ensure you have EXECUTE permission on the function

**"Connection timeout"**
- Increase timeout in notebook: `REQUEST_TIMEOUT = 30`
- Increase Lambda timeout: Edit `deploy.sh` TIMEOUT variable and redeploy
- Check network connectivity from Databricks to Lambda endpoint

**"Cannot pass literal strings to UDF"**
- Use the derived column pattern (see section above)
- Convert literals to columns using subquery or CTE

**"Permission denied"**
- Ask admin to grant: `GRANT EXECUTE ON FUNCTION skyflow_tokenize_column TO <user>`
- Check Unity Catalog permissions in workspace settings

### Handler Signature Issues

If you see errors like "too many values to unpack" or "missing required positional argument":

**Single-argument UDF** (detokenize):
```python
def handler(batch_iter: Iterator[pd.Series]) -> Iterator[pd.Series]:
    for values in batch_iter:  # Not: for (values,) in batch_iter
        yield pd.Series(results)
```

**Two-argument UDF** (tokenize):
```python
def handler(batch_iter: Iterator[Tuple[pd.Series, pd.Series]]) -> Iterator[pd.Series]:
    for arg1, arg2 in batch_iter:  # Unpack tuple
        yield pd.Series(results)
```

## API Format

The Lambda integration uses the standard `/processDatabricks` endpoint with headers:

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

## Performance Comparison

For 100,000 rows with BATCH_SIZE=500:

| Approach | Lambda Calls | Skyflow API Calls | Cost Multiplier |
|----------|-------------|-------------------|-----------------|
| **UC Batch Python UDFs** | ~200 | ~4,000 | 1x (baseline) |
| UC Scalar UDFs | 100,000 | 100,000 | 500x more expensive |

The batching dramatically reduces costs and improves performance for high-volume workloads. Higher batch sizes to Lambda allow Lambda to scale out and process data more efficiently.

## Additional Resources

- [Skyflow Documentation](https://docs.skyflow.com/)
- [AWS Lambda Limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Databricks Unity Catalog Functions](https://docs.databricks.com/en/sql/language-manual/sql-ref-functions-udf-python.html)
- [Main Project README](../README.md)
