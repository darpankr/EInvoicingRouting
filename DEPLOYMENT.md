# Deployment Guide

## Prerequisites

- AWS Account with Administrator access
- AWS CLI configured
- Node.js 18.x installed locally

## Step 1: Create DynamoDB Tables

### Idempotency Table

```bash
aws dynamodb create-table \
    --table-name FonoaWebhookIdempotency \
    --attribute-definitions AttributeName=webhook_id,AttributeType=S \
    --key-schema AttributeName=webhook_id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region eu-west-1

# Enable TTL
aws dynamodb update-time-to-live \
    --table-name FonoaWebhookIdempotency \
    --time-to-live-specification "Enabled=true, AttributeName=expiration" \
    --region eu-west-1
```

### Intercompany Entities Table

```bash
aws dynamodb create-table \
    --table-name IntercompanyEntities \
    --attribute-definitions AttributeName=entity_number,AttributeType=S \
    --key-schema AttributeName=entity_number,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region eu-west-1

# Add intercompany entities
aws dynamodb put-item \
    --table-name IntercompanyEntities \
    --item '{"entity_number": {"S": "0422317610"}}' \
    --region eu-west-1

aws dynamodb put-item \
    --table-name IntercompanyEntities \
    --item '{"entity_number": {"S": "0885436190"}}' \
    --region eu-west-1

aws dynamodb put-item \
    --table-name IntercompanyEntities \
    --item '{"entity_number": {"S": "0885540417"}}' \
    --region eu-west-1
```

## Step 2: Create AWS Secrets Manager Secret

```bash
aws secretsmanager create-secret \
    --name fonoa-webhook-secrets \
    --description "Credentials for Fonoa Multi-System Router" \
    --secret-string '{
        "FONOA_API_KEY": "your-fonoa-api-key",
        "NS_CONSUMER_KEY": "netsuite-consumer-key",
        "NS_CONSUMER_SECRET": "netsuite-consumer-secret",
        "NS_TOKEN_ID": "netsuite-token-id",
        "NS_TOKEN_SECRET": "netsuite-token-secret",
        "NS_ACCOUNT_ID": "netsuite-account-id",
        "NETSUITE_RESTLET_URL": "https://xxxxx.restlets.api.netsuite.com/app/...",
        "OPSI_URL": "https://opsi.example.com/api/webhook",
        "OPSI_API_KEY": "opsi-api-key",
        "DARTS_URL": "https://darts.example.com/api/webhook",
        "DARTS_API_KEY": "darts-api-key"
    }' \
    --region eu-west-1
```

## Step 3: Create IAM Role for Lambda

Create `trust-policy.json`:
```json
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
```

Create the role:
```bash
aws iam create-role \
    --role-name FonoaWebhookRouterRole \
    --assume-role-policy-document file://trust-policy.json
```

Create `lambda-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:eu-west-1:*:table/FonoaWebhookIdempotency",
        "arn:aws:dynamodb:eu-west-1:*:table/IntercompanyEntities"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:eu-west-1:*:secret:fonoa-webhook-secrets-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

Attach the policy:
```bash
aws iam put-role-policy \
    --role-name FonoaWebhookRouterRole \
    --policy-name FonoaWebhookRouterPolicy \
    --policy-document file://lambda-policy.json
```

## Step 4: Verify SES Email Addresses

```bash
# Verify sender email
aws ses verify-email-identity \
    --email-address notifications@example.com \
    --region eu-west-1

# Verify admin emails
aws ses verify-email-identity \
    --email-address admin1@example.com \
    --region eu-west-1

aws ses verify-email-identity \
    --email-address admin2@example.com \
    --region eu-west-1
```

Check email inboxes and click verification links.

## Step 5: Package the Lambda Function

```bash
# Install dependencies
npm install

# Create deployment package
zip -r function.zip . -x "*.git*" "*.md" "DEPLOYMENT.md" "trust-policy.json" "lambda-policy.json"
```

## Step 6: Create Lambda Function

```bash
aws lambda create-function \
    --function-name fonoa-webhook-router \
    --runtime nodejs18.x \
    --role arn:aws:iam::YOUR_ACCOUNT_ID:role/FonoaWebhookRouterRole \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 60 \
    --memory-size 512 \
    --architecture arm64 \
    --environment Variables="{
        AWS_REGION_NAME=eu-west-1,
        ENVIRONMENT=PRODUCTION,
        IDEMPOTENCY_TABLE=FonoaWebhookIdempotency,
        SECRET_NAME=fonoa-webhook-secrets,
        SENDER_EMAIL=notifications@example.com,
        ADMIN_EMAILS=admin1@example.com,admin2@example.com
    }" \
    --region eu-west-1
```

## Step 7: Create API Gateway (for webhook endpoint)

```bash
# Create REST API
aws apigateway create-rest-api \
    --name fonoa-webhook-api \
    --description "API Gateway for Fonoa webhooks" \
    --region eu-west-1

# Get the API ID from the output (save it as API_ID)

# Get the root resource ID
aws apigateway get-resources \
    --rest-api-id YOUR_API_ID \
    --region eu-west-1

# Create a POST method
aws apigateway put-method \
    --rest-api-id YOUR_API_ID \
    --resource-id YOUR_RESOURCE_ID \
    --http-method POST \
    --authorization-type NONE \
    --region eu-west-1

# Integrate with Lambda
aws apigateway put-integration \
    --rest-api-id YOUR_API_ID \
    --resource-id YOUR_RESOURCE_ID \
    --http-method POST \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/arn:aws:lambda:eu-west-1:YOUR_ACCOUNT_ID:function:fonoa-webhook-router/invocations \
    --region eu-west-1

# Grant API Gateway permission to invoke Lambda
aws lambda add-permission \
    --function-name fonoa-webhook-router \
    --statement-id apigateway-invoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:eu-west-1:YOUR_ACCOUNT_ID:YOUR_API_ID/*/*" \
    --region eu-west-1

# Deploy the API
aws apigateway create-deployment \
    --rest-api-id YOUR_API_ID \
    --stage-name prod \
    --region eu-west-1
```

Your webhook URL will be:
```
https://YOUR_API_ID.execute-api.eu-west-1.amazonaws.com/prod
```

## Step 8: Configure Fonoa Webhook

1. Log into Fonoa dashboard
2. Navigate to Webhooks settings
3. Add new webhook endpoint: `https://YOUR_API_ID.execute-api.eu-west-1.amazonaws.com/prod`
4. Save and test

## Step 9: Testing

### Test with AWS CLI

```bash
aws lambda invoke \
    --function-name fonoa-webhook-router \
    --payload '{
        "body": "{\"webhook_id\":\"test-webhook-123\",\"resource_id\":\"test-resource-456\",\"resource_url\":\"https://api-demo.fonoa.com/v1/transactions/test-resource-456\",\"country_code\":\"BE\",\"event_type\":\"transaction.finalized\",\"delivered_at\":\"2024-01-01T12:00:00Z\"}",
        "headers": {
            "fonoa-webhook-token": "VALID_JWT_TOKEN_HERE"
        },
        "isBase64Encoded": false
    }' \
    response.json

cat response.json
```

### Monitor Logs

```bash
aws logs tail /aws/lambda/fonoa-webhook-router --follow
```

## Step 10: Monitoring & Alerts

### Create CloudWatch Alarms

```bash
# Alarm for errors
aws cloudwatch put-metric-alarm \
    --alarm-name fonoa-webhook-errors \
    --alarm-description "Alert when webhook processing has errors" \
    --metric-name Errors \
    --namespace AWS/Lambda \
    --statistic Sum \
    --period 300 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions Name=FunctionName,Value=fonoa-webhook-router

# Alarm for throttles
aws cloudwatch put-metric-alarm \
    --alarm-name fonoa-webhook-throttles \
    --alarm-description "Alert when webhook is being throttled" \
    --metric-name Throttles \
    --namespace AWS/Lambda \
    --statistic Sum \
    --period 60 \
    --threshold 1 \
    --comparison-operator GreaterThanThreshold \
    --evaluation-periods 1 \
    --dimensions Name=FunctionName,Value=fonoa-webhook-router
```

## Updating the Function

```bash
# Update code
zip -r function.zip . -x "*.git*" "*.md" "DEPLOYMENT.md" "*.json"

aws lambda update-function-code \
    --function-name fonoa-webhook-router \
    --zip-file fileb://function.zip \
    --region eu-west-1

# Update environment variables
aws lambda update-function-configuration \
    --function-name fonoa-webhook-router \
    --environment Variables="{
        AWS_REGION_NAME=eu-west-1,
        ENVIRONMENT=PRODUCTION,
        IDEMPOTENCY_TABLE=FonoaWebhookIdempotency,
        SECRET_NAME=fonoa-webhook-secrets,
        SENDER_EMAIL=notifications@example.com,
        ADMIN_EMAILS=admin1@example.com,admin2@example.com
    }" \
    --region eu-west-1
```

## Rollback

```bash
# List versions
aws lambda list-versions-by-function \
    --function-name fonoa-webhook-router \
    --region eu-west-1

# Rollback to previous version
aws lambda update-alias \
    --function-name fonoa-webhook-router \
    --name PROD \
    --function-version PREVIOUS_VERSION \
    --region eu-west-1
```

## Troubleshooting

### Check Lambda Logs
```bash
aws logs tail /aws/lambda/fonoa-webhook-router --follow
```

### Test DynamoDB Access
```bash
aws dynamodb describe-table \
    --table-name FonoaWebhookIdempotency \
    --region eu-west-1
```

### Test Secrets Manager Access
```bash
aws secretsmanager get-secret-value \
    --secret-id fonoa-webhook-secrets \
    --region eu-west-1
```

### Verify IAM Role Permissions
```bash
aws iam get-role-policy \
    --role-name FonoaWebhookRouterRole \
    --policy-name FonoaWebhookRouterPolicy
```

## Cost Optimization

1. **Use ARM64 architecture** (Graviton2) - 20% cheaper
2. **Enable DynamoDB On-Demand** - Pay per request
3. **Set appropriate Lambda timeout** - Don't overpay for hung processes
4. **Use CloudWatch Logs Insights** - Query logs efficiently
5. **Enable TTL on DynamoDB** - Auto-delete old records

---

**Security Checklist:**
- [ ] Secrets stored in AWS Secrets Manager
- [ ] SES emails verified
- [ ] IAM roles follow least privilege
- [ ] CloudWatch logging enabled
- [ ] API Gateway uses HTTPS
- [ ] Webhook token validation enabled
