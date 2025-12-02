# Databricks Sample Notebooks

This directory contains Databricks notebook examples for integrating Skyflow tokenization and detokenization into your Spark workflows.

## Available Notebooks

### databricks_skyflow_tokenize.py
Tokenize sensitive data columns using a Pandas UDF that calls the Lambda `/processDatabricks` endpoint.

**Use Case:** Protect sensitive data (emails, SSNs, credit cards) before storing in your data warehouse.

**Example:**
```python
# After running the notebook to register the UDF:
spark.sql("""
  SELECT
    user_id,
    skyflow_tokenize(email) as email_token,
    skyflow_tokenize(ssn) as ssn_token
  FROM raw_users
""")
```

### databricks_skyflow_detokenize.py
Detokenize Skyflow tokens back to plaintext using a Pandas UDF.

**Use Case:** Retrieve original values for authorized analytics or reporting.

**Example:**
```python
# After running the notebook to register the UDF:
spark.sql("""
  SELECT
    user_id,
    skyflow_detokenize(email_token) as email
  FROM tokenized_users
""")
```

## Getting Started

### 1. Deploy the Lambda Function
First, deploy the Skyflow Lambda API to AWS:
```bash
cd ..  # Go to project root
./deploy.sh
```

Note the API URL from the deployment output.

### 2. Configure the Notebook
Open either notebook and update these constants:

```python
LAMBDA_URL = "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/processDatabricks"
CLUSTER_ID = "your-cluster-id"  # e.g., "ebfc9bee4242"
VAULT_ID   = "your-vault-id"    # e.g., "ac7f4217c9e54fa7a6f4896c34f6964b"
TABLE      = "your-table-name"  # For tokenization only
COLUMN_NAME = "your-column"     # For tokenization only
```

### 3. Import to Databricks
1. In your Databricks workspace, go to **Workspace** → **Create** → **Notebook**
2. Click **Import** and upload the `.py` file
3. Attach the notebook to a cluster
4. Run all cells to register the UDF

### 4. Use the UDF
Once registered, the UDF is available in both Python and SQL:

**Python:**
```python
from pyspark.sql.functions import col

df = spark.table("users")
df_tokenized = df.withColumn("email_token", skyflow_tokenize(col("email")))
```

**SQL:**
```sql
SELECT skyflow_tokenize(email) as token FROM users;
```

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

**"Connection timeout"**
- Increase timeout in the notebook: `timeout=30`
- Increase Lambda timeout: Edit `deploy.sh` TIMEOUT variable and redeploy

**"Null values not handled correctly"**
- Both notebooks filter NULL values before API calls
- NULLs in input remain NULL in output

**"UDF not found in SQL"**
- Ensure you ran `spark.udf.register("skyflow_detokenize", skyflow_detokenize)`
- UDFs are session-scoped; re-register after cluster restart

**"Rate limiting errors"**
- Reduce batch size to make more frequent, smaller API calls
- Increase Lambda reserved concurrency (AWS Console)
- Add retry logic with exponential backoff

## Additional Resources

- [Skyflow Documentation](https://docs.skyflow.com/)
- [AWS Lambda Limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Databricks Pandas UDF Guide](https://docs.databricks.com/en/udf/pandas.html)
- [Main Project README](../README.md)
