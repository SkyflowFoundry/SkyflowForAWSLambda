#!/bin/bash

# Skyflow Lambda API Deployment Script
# Deploys Lambda function and API Gateway
#
# Usage:
#   ./deploy.sh --setup-permissions <iam-user>    Setup AWS permissions
#   ./deploy.sh                                   Deploy Lambda and API Gateway
#   ./deploy.sh --destroy                         Destroy all resources

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
FUNCTION_NAME="skyflow-lambda-api"
REGION="${AWS_REGION:-us-east-1}"  # Can be overridden by --region flag
RUNTIME="nodejs18.x"
HANDLER="handler.handler"
MEMORY_SIZE=512
TIMEOUT=30

# ============================================================================
# Help Function
# ============================================================================
show_help() {
    echo ""
    echo -e "${BLUE}Skyflow Lambda API Deployment Script${NC}"
    echo ""
    echo "Usage:"
    echo "  $0 [--region <region>]                            Deploy or update Lambda function and API Gateway"
    echo "  $0 --help, -h                                     Show this help message"
    echo "  $0 --setup-permissions <iam-user> [--region ...]  Setup AWS IAM permissions for deployment"
    echo "  $0 --destroy [--region <region>]                  Destroy all AWS resources"
    echo ""
    echo "Commands:"
    echo ""
    echo "  ${GREEN}Deploy/Update (default)${NC}"
    echo "    $0 [--region <region>]"
    echo "    Deploys Lambda function and API Gateway. Automatically detects if resources"
    echo "    exist and updates them, or creates new ones if not present."
    echo "    Example: $0 --region us-west-2"
    echo ""
    echo "  ${GREEN}Setup Permissions${NC}"
    echo "    $0 --setup-permissions <iam-username> [--region <region>]"
    echo "    Grants an IAM user permissions to deploy Lambda functions. Run this once"
    echo "    before your first deployment if you don't have the necessary permissions."
    echo "    Example: $0 --setup-permissions john-doe --region us-west-2"
    echo ""
    echo "  ${GREEN}Destroy${NC}"
    echo "    $0 --destroy [--region <region>]"
    echo "    Removes all AWS resources created by this script (Lambda, API Gateway, IAM role)."
    echo "    Example: $0 --destroy --region us-west-2"
    echo ""
    echo "  ${GREEN}Help${NC}"
    echo "    $0 --help   or   $0 -h"
    echo "    Display this help message."
    echo ""
    echo "Prerequisites:"
    echo "  - AWS CLI configured with credentials (aws configure)"
    echo "  - Node.js 18+ installed"
    echo "  - lambda/skyflow-config.json configured with Skyflow credentials"
    echo "  - jq installed (for JSON parsing)"
    echo ""
    echo "Options:"
    echo "  --region <region>    AWS region for deployment (default: us-east-1)"
    echo "                       Can also be set via AWS_REGION environment variable"
    echo ""
    echo "Configuration:"
    echo "  Function:  ${FUNCTION_NAME}"
    echo "  Region:    ${REGION}"
    echo "  Runtime:   ${RUNTIME}"
    echo "  Memory:    ${MEMORY_SIZE}MB"
    echo "  Timeout:   ${TIMEOUT}s"
    echo ""
    echo "Notes:"
    echo "  - The script automatically detects whether to create or update resources"
    echo "  - Credentials from skyflow-config.json are converted to environment variables"
    echo "  - The config file is NOT included in the Lambda deployment package"
    echo ""
    exit 0
}

# ============================================================================
# Setup Permissions Function
# ============================================================================
setup_permissions() {
    local IAM_USERNAME="$1"
    local POLICY_NAME="SkyflowLambdaAPIPolicy"

    if [ -z "$IAM_USERNAME" ]; then
        echo -e "${RED}Error: No IAM username provided${NC}"
        echo ""
        echo "Usage: $0 --setup-permissions <iam-username>"
        echo ""
        echo "Example:"
        echo "  $0 --setup-permissions nimbus-user-s3-access"
        exit 1
    fi

    # Get AWS account info
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}Setup AWS Permissions${NC}"
    echo -e "${BLUE}============================================================================${NC}"
    echo ""
    echo -e "Target IAM User: ${GREEN}${IAM_USERNAME}${NC}"
    echo ""

    # Verify user exists
    if ! aws iam get-user --user-name "$IAM_USERNAME" > /dev/null 2>&1; then
        echo -e "${RED}✗ IAM user '${IAM_USERNAME}' not found${NC}"
        exit 1
    fi

    # Create policy
    cat > /tmp/skyflow-lambda-api-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IAMPermissions",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole", "iam:GetRole", "iam:DeleteRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:ListRoles", "iam:PassRole"
      ],
      "Resource": "arn:aws:iam::*:role/skyflow-lambda-api-role"
    },
    {
      "Sid": "LambdaPermissions",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction", "lambda:GetFunction", "lambda:DeleteFunction",
        "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunctionConfiguration", "lambda:AddPermission",
        "lambda:RemovePermission", "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:*:*:function:skyflow-lambda-api"
    },
    {
      "Sid": "LambdaListPermissions",
      "Effect": "Allow",
      "Action": ["lambda:ListFunctions"],
      "Resource": "*"
    },
    {
      "Sid": "APIGatewayPermissions",
      "Effect": "Allow",
      "Action": ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:DELETE"],
      "Resource": ["arn:aws:apigateway:*::/apis", "arn:aws:apigateway:*::/apis/*"]
    },
    {
      "Sid": "CloudWatchLogsPermissions",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents",
        "logs:GetLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/aws/lambda/skyflow-lambda-api",
        "arn:aws:logs:*:*:log-group:/aws/lambda/skyflow-lambda-api:*"
      ]
    },
    {
      "Sid": "CloudWatchLogsDescribe",
      "Effect": "Allow",
      "Action": ["logs:DescribeLogGroups"],
      "Resource": "*"
    },
    {
      "Sid": "STSPermissions",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
EOF

    # Delete old policy if exists
    POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${POLICY_NAME}"
    if aws iam get-policy --policy-arn "$POLICY_ARN" > /dev/null 2>&1; then
        aws iam detach-user-policy --user-name "$IAM_USERNAME" --policy-arn "$POLICY_ARN" 2>/dev/null || true
        VERSIONS=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text)
        for VERSION in $VERSIONS; do
            aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$VERSION" 2>/dev/null || true
        done
        aws iam delete-policy --policy-arn "$POLICY_ARN" 2>/dev/null || true
        sleep 2
    fi

    # Create policy
    POLICY_ARN=$(aws iam create-policy \
        --policy-name "$POLICY_NAME" \
        --policy-document file:///tmp/skyflow-lambda-api-policy.json \
        --description "Permissions for Skyflow Lambda API deployment" \
        --query 'Policy.Arn' \
        --output text)

    # Attach to user
    aws iam attach-user-policy --user-name "$IAM_USERNAME" --policy-arn "$POLICY_ARN"

    rm -f /tmp/skyflow-lambda-api-policy.json

    echo -e "${GREEN}✓ Permissions granted to ${IAM_USERNAME}${NC}"
    echo ""
    echo -e "Now run: ${BLUE}$0${NC}"
    echo ""
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --region)
            REGION="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            ;;
        --setup-permissions)
            SETUP_PERMISSIONS_USER="$2"
            shift 2
            ;;
        --destroy)
            DESTROY_MODE=true
            shift
            ;;
        *)
            # Unknown option, keep it for later processing
            shift
            ;;
    esac
done

# Handle commands
if [ -n "$SETUP_PERMISSIONS_USER" ]; then
    setup_permissions "$SETUP_PERMISSIONS_USER"
fi

# ============================================================================
# Main Deployment
# ============================================================================

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}Skyflow Lambda API Deployment${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found${NC}"
    echo "Install: https://aws.amazon.com/cli/"
    exit 1
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not found${NC}"
    echo "Install: https://nodejs.org/"
    exit 1
fi

# Get AWS account info
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_USER_ARN=$(aws sts get-caller-identity --query Arn --output text)

echo -e "AWS Account: ${GREEN}${AWS_ACCOUNT_ID}${NC}"
echo -e "AWS User: ${GREEN}${AWS_USER_ARN}${NC}"
echo -e "Region: ${GREEN}${REGION}${NC}"
echo ""

# Check if destroying
if [ "$DESTROY_MODE" == "true" ]; then
    echo -e "${YELLOW}Destroying all resources...${NC}"
    echo ""

    # Delete API Gateway
    API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='${FUNCTION_NAME}-api'].ApiId" --output text)
    if [ -n "$API_ID" ]; then
        echo "Deleting API Gateway: $API_ID"
        aws apigatewayv2 delete-api --region "$REGION" --api-id "$API_ID"
        echo -e "${GREEN}✓ API Gateway deleted${NC}"
    fi

    # Delete Lambda function
    if aws lambda get-function --region "$REGION" --function-name "$FUNCTION_NAME" &> /dev/null; then
        echo "Deleting Lambda function: $FUNCTION_NAME"
        aws lambda delete-function --region "$REGION" --function-name "$FUNCTION_NAME"
        echo -e "${GREEN}✓ Lambda function deleted${NC}"
    fi

    # Delete IAM role
    ROLE_NAME="${FUNCTION_NAME}-role"
    if aws iam get-role --role-name "$ROLE_NAME" &> /dev/null; then
        echo "Deleting IAM role: $ROLE_NAME"

        # Detach policies
        aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" || true

        # Delete role
        aws iam delete-role --role-name "$ROLE_NAME"
        echo -e "${GREEN}✓ IAM role deleted${NC}"
    fi

    echo ""
    echo -e "${GREEN}All resources destroyed${NC}"
    exit 0
fi

# Step 1: Install dependencies
echo -e "${YELLOW}[1/6]${NC} Installing Lambda dependencies..."
cd lambda
if [ ! -d "node_modules" ]; then
    npm install --production
else
    echo "Dependencies already installed"
fi
cd ..
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 2: Load configuration into environment variables
echo -e "${YELLOW}[2/5]${NC} Loading configuration..."
cd lambda

# Check if skyflow-config.json exists
if [ ! -f "skyflow-config.json" ]; then
    echo -e "${RED}Error: skyflow-config.json not found${NC}"
    echo -e "${YELLOW}Please create lambda/skyflow-config.json with your Skyflow credentials${NC}"
    echo -e "${YELLOW}See lambda/config.example.json for format${NC}"
    exit 1
fi

# Detect authentication type
CLIENT_ID=$(jq -r '.credentials.clientID // empty' skyflow-config.json)
API_KEY=$(jq -r '.credentials.apiKey // empty' skyflow-config.json)

# Create environment variables JSON file
ENV_VARS_FILE="../lambda-env-vars.json"

if [ -n "$CLIENT_ID" ]; then
    # JWT (Service Account) authentication
    echo "  Using JWT (Service Account) authentication"
    jq -n \
        --arg clientId "$(jq -r '.credentials.clientID' skyflow-config.json)" \
        --arg clientName "$(jq -r '.credentials.clientName' skyflow-config.json)" \
        --arg tokenUri "$(jq -r '.credentials.tokenURI' skyflow-config.json)" \
        --arg keyId "$(jq -r '.credentials.keyID' skyflow-config.json)" \
        --arg privateKey "$(jq -r '.credentials.privateKey' skyflow-config.json)" \
        '{
            "Variables": {
                "SKYFLOW_CLIENT_ID": $clientId,
                "SKYFLOW_CLIENT_NAME": $clientName,
                "SKYFLOW_TOKEN_URI": $tokenUri,
                "SKYFLOW_KEY_ID": $keyId,
                "SKYFLOW_PRIVATE_KEY": $privateKey
            }
        }' > "$ENV_VARS_FILE"
elif [ -n "$API_KEY" ]; then
    # API Key authentication
    echo "  Using API Key authentication"
    jq -n \
        --arg apiKey "$API_KEY" \
        '{
            "Variables": {
                "SKYFLOW_API_KEY": $apiKey
            }
        }' > "$ENV_VARS_FILE"
else
    echo -e "${RED}Error: No valid credentials found in skyflow-config.json${NC}"
    exit 1
fi

cd ..
echo -e "${GREEN}✓ Configuration loaded into environment variables${NC}"
echo ""

# Step 3: Package Lambda
echo -e "${YELLOW}[3/5]${NC} Packaging Lambda function..."
cd lambda
# Exclude config files - credentials will be passed via environment variables
zip -q -r ../function.zip . -x "skyflow-config.json" -x "config.example.json"
cd ..
echo -e "${GREEN}✓ Lambda packaged ($(du -h function.zip | cut -f1))${NC}"
echo ""

# Step 4: Create/Update IAM Role
echo -e "${YELLOW}[4/6]${NC} Setting up IAM role..."
ROLE_NAME="${FUNCTION_NAME}-role"

if ! aws iam get-role --role-name "$ROLE_NAME" &> /dev/null; then
    echo "Creating IAM role: $ROLE_NAME"

    # Create trust policy
    cat > trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file://trust-policy.json \
        --description "Role for Skyflow Lambda API"

    # Attach basic execution policy
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

    rm trust-policy.json

    # Wait for role to be available
    echo "Waiting for IAM role to propagate..."
    sleep 10
else
    echo "IAM role already exists"
fi

ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ROLE_NAME}"
echo -e "${GREEN}✓ IAM role ready: ${ROLE_ARN}${NC}"
echo ""

# Step 5: Create/Update Lambda Function
echo -e "${YELLOW}[5/6]${NC} Deploying Lambda function..."

if aws lambda get-function --region "$REGION" --function-name "$FUNCTION_NAME" &> /dev/null; then
    echo "Updating existing Lambda function"
    aws lambda update-function-code \
        --region "$REGION" \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://function.zip \
        --output text > /dev/null

    echo "Waiting for code update to complete..."
    aws lambda wait function-updated --region "$REGION" --function-name "$FUNCTION_NAME"

    echo "Updating function configuration with environment variables..."
    aws lambda update-function-configuration \
        --region "$REGION" \
        --function-name "$FUNCTION_NAME" \
        --timeout "$TIMEOUT" \
        --memory-size "$MEMORY_SIZE" \
        --environment file://lambda-env-vars.json > /dev/null

    echo "Waiting for configuration update to complete..."
    aws lambda wait function-updated --region "$REGION" --function-name "$FUNCTION_NAME"
else
    echo "Creating new Lambda function"
    aws lambda create-function \
        --region "$REGION" \
        --function-name "$FUNCTION_NAME" \
        --runtime "$RUNTIME" \
        --role "$ROLE_ARN" \
        --handler "$HANDLER" \
        --zip-file fileb://function.zip \
        --timeout "$TIMEOUT" \
        --memory-size "$MEMORY_SIZE" \
        --environment file://lambda-env-vars.json \
        --output text > /dev/null

    echo "Waiting for function to be active..."
    aws lambda wait function-active --region "$REGION" --function-name "$FUNCTION_NAME"
fi

LAMBDA_ARN=$(aws lambda get-function --region "$REGION" --function-name "$FUNCTION_NAME" --query 'Configuration.FunctionArn' --output text)
echo -e "${GREEN}✓ Lambda deployed: ${LAMBDA_ARN}${NC}"
echo ""

# Step 6: Create/Update API Gateway
echo -e "${YELLOW}[6/6]${NC} Setting up API Gateway..."

# Check if API exists
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='${FUNCTION_NAME}-api'].ApiId" --output text)

if [ -z "$API_ID" ]; then
    echo "Creating API Gateway"
    API_ID=$(aws apigatewayv2 create-api \
        --region "$REGION" \
        --name "${FUNCTION_NAME}-api" \
        --protocol-type HTTP \
        --target "$LAMBDA_ARN" \
        --query 'ApiId' \
        --output text)
else
    echo "API Gateway already exists"
fi

# Create Lambda permission for API Gateway
aws lambda add-permission \
    --region "$REGION" \
    --function-name "$FUNCTION_NAME" \
    --statement-id "apigateway-invoke-$(date +%s)" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${AWS_ACCOUNT_ID}:${API_ID}/*" \
    &> /dev/null || echo "Permission already exists"

# Create single /process route
ROUTE_ID=$(aws apigatewayv2 get-routes --region "$REGION" --api-id "$API_ID" --query "Items[?RouteKey=='POST /process'].RouteId" --output text)

if [ -z "$ROUTE_ID" ]; then
    echo "Creating route: POST /process"

    # Create integration
    INTEGRATION_ID=$(aws apigatewayv2 create-integration \
        --region "$REGION" \
        --api-id "$API_ID" \
        --integration-type AWS_PROXY \
        --integration-uri "$LAMBDA_ARN" \
        --payload-format-version 2.0 \
        --query 'IntegrationId' \
        --output text)

    # Create route
    aws apigatewayv2 create-route \
        --region "$REGION" \
        --api-id "$API_ID" \
        --route-key "POST /process" \
        --target "integrations/${INTEGRATION_ID}" \
        --output text > /dev/null

    echo "✓ Route created"
else
    echo "Route already exists"
fi

# Create Snowflake external function route
echo "Creating Snowflake route..."

# /processSnowflake route (single endpoint, operation determined by header)
SF_ROUTE_ID=$(aws apigatewayv2 get-routes --region "$REGION" --api-id "$API_ID" --query "Items[?RouteKey=='POST /processSnowflake'].RouteId" --output text)

if [ -z "$SF_ROUTE_ID" ]; then
    SF_INTEGRATION_ID=$(aws apigatewayv2 create-integration \
        --region "$REGION" \
        --api-id "$API_ID" \
        --integration-type AWS_PROXY \
        --integration-uri "$LAMBDA_ARN" \
        --payload-format-version 2.0 \
        --query 'IntegrationId' \
        --output text)

    aws apigatewayv2 create-route \
        --region "$REGION" \
        --api-id "$API_ID" \
        --route-key "POST /processSnowflake" \
        --target "integrations/${SF_INTEGRATION_ID}" \
        --output text > /dev/null

    echo "✓ Snowflake route created"
else
    echo "Snowflake route already exists"
fi

# Create Databricks route
echo "Creating Databricks route..."

# /processDatabricks route (same format as /process)
DB_ROUTE_ID=$(aws apigatewayv2 get-routes --region "$REGION" --api-id "$API_ID" --query "Items[?RouteKey=='POST /processDatabricks'].RouteId" --output text)

if [ -z "$DB_ROUTE_ID" ]; then
    DB_INTEGRATION_ID=$(aws apigatewayv2 create-integration \
        --region "$REGION" \
        --api-id "$API_ID" \
        --integration-type AWS_PROXY \
        --integration-uri "$LAMBDA_ARN" \
        --payload-format-version 2.0 \
        --query 'IntegrationId' \
        --output text)

    aws apigatewayv2 create-route \
        --region "$REGION" \
        --api-id "$API_ID" \
        --route-key "POST /processDatabricks" \
        --target "integrations/${DB_INTEGRATION_ID}" \
        --output text > /dev/null

    echo "✓ Databricks route created"
else
    echo "Databricks route already exists"
fi

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/process"
SF_API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/processSnowflake"
DB_API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/processDatabricks"

echo -e "${GREEN}✓ API Gateway configured${NC}"
echo ""

# Cleanup
rm -f function.zip lambda-env-vars.json

# Summary
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}Deployment Complete! 🎉${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
echo -e "${GREEN}API Gateway URL:${NC}"
echo -e "  ${API_URL}"
echo ""
echo -e "${GREEN}Standard Endpoint:${NC}"
echo -e "  POST ${API_URL}"
echo -e "  Operations (via X-Skyflow-Operation header): tokenize, detokenize, query, tokenize-byot"
echo ""
echo -e "${GREEN}Snowflake Endpoint:${NC}"
echo -e "  POST ${SF_API_URL}"
echo ""
echo -e "${GREEN}Databricks Endpoint:${NC}"
echo -e "  POST ${DB_API_URL}"
echo -e "  (Uses same format as standard endpoint - see samples/databricks_*.py)"
echo ""
echo -e "${YELLOW}Test Examples:${NC}"
echo ""
echo -e "${GREEN}1. Tokenize (single column):${NC}"
echo -e "  curl -X POST ${API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'X-Skyflow-Operation: tokenize' \\\\"
echo -e "    -H 'X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -H 'X-Skyflow-Table: users' \\\\"
echo -e "    -d '{\"records\":[{\"email\":\"test@example.com\"}]}'"
echo ""
echo -e "${GREEN}2. Tokenize (multi-column):${NC}"
echo -e "  curl -X POST ${API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'X-Skyflow-Operation: tokenize' \\\\"
echo -e "    -H 'X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -H 'X-Skyflow-Table: users' \\\\"
echo -e "    -d '{\"records\":[{\"email\":\"test@example.com\",\"name\":\"John Doe\"}]}'"
echo ""
echo -e "${GREEN}3. Detokenize (governance-controlled):${NC}"
echo -e "  curl -X POST ${API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'X-Skyflow-Operation: detokenize' \\\\"
echo -e "    -H 'X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -d '{\"tokens\":[\"tok_abc123xyz\"]}'"
echo ""
echo -e "${GREEN}4. Detokenize (with explicit redaction):${NC}"
echo -e "  curl -X POST ${API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'X-Skyflow-Operation: detokenize' \\\\"
echo -e "    -H 'X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -d '{\"tokens\":[\"tok_abc123xyz\"],\"options\":{\"redactionType\":\"MASKED\"}}'"
echo ""
echo -e "${GREEN}5. Query:${NC}"
echo -e "  curl -X POST ${API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'X-Skyflow-Operation: query' \\\\"
echo -e "    -H 'X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -d '{\"query\":\"SELECT * FROM users LIMIT 10\"}'"
echo ""
echo -e "${GREEN}6. Tokenize-BYOT (custom tokens):${NC}"
echo -e "  curl -X POST ${API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'X-Skyflow-Operation: tokenize-byot' \\\\"
echo -e "    -H 'X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -H 'X-Skyflow-Table: users' \\\\"
echo -e "    -d '{\"records\":[{\"fields\":{\"email\":\"test@example.com\"},\"tokens\":{\"email\":\"my-custom-token-123\"}}]}'"
echo ""
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}Snowflake External Function Examples${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
echo -e "${GREEN}7. Snowflake Tokenize (emulates Snowflake request with sf-custom- prefix):${NC}"
echo -e "  curl -X POST ${SF_API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Operation: tokenize' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Table: users' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Column-Name: email' \\\\"
echo -e "    -d '{\"data\":[[0,\"john@example.com\"],[1,\"jane@example.com\"]]}'"
echo ""
echo -e "${GREEN}8. Snowflake Detokenize (emulates Snowflake request with sf-custom- prefix):${NC}"
echo -e "  curl -X POST ${SF_API_URL} \\\\"
echo -e "    -H 'Content-Type: application/json' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Operation: detokenize' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Cluster-ID: your-cluster-id' \\\\"
echo -e "    -H 'sf-custom-X-Skyflow-Vault-ID: your-vault-id' \\\\"
echo -e "    -d '{\"data\":[[0,\"tok_abc123xyz\"],[1,\"tok_def456abc\"]]}'"
echo ""
echo -e "${YELLOW}Note: Snowflake automatically adds 'sf-custom-' prefix to all custom headers${NC}"
echo -e "${YELLOW}Expected Snowflake response format:${NC}"
echo -e '  {"data":[[0,"result1"],[1,"result2"]]}'
echo ""
echo -e "${YELLOW}To destroy:${NC} ./deploy.sh --destroy --region ${REGION}"
echo ""
