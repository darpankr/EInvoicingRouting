
# SECRET MANAGER SETUP

# 1. Create Fonoa Secret
aws secretsmanager create-secret \
    --name fonoa-secrets \
    --description "Fonoa API credentials" \
    --secret-string '{"FONOA_API_KEY":"your-actual-api-key-here"}' \
    --region eu-west-1

# 2. Create NetSuite Secret
aws secretsmanager create-secret \
    --name netsuite-secrets \
    --description "NetSuite OAuth credentials" \
    --secret-string '{
      "NS_CONSUMER_KEY":"your-consumer-key",
      "NS_CONSUMER_SECRET":"your-consumer-secret",
      "NS_TOKEN_ID":"your-token-id",
      "NS_TOKEN_SECRET":"your-token-secret",
      "NS_ACCOUNT_ID":"your-account-id",
      "NETSUITE_RESTLET_URL":"https://xxxxx.restlets.api.netsuite.com/..."
    }' \
    --region eu-west-1

# 3. Create OPSI Secret
aws secretsmanager create-secret \
    --name opsi-secrets \
    --description "OPSI API credentials" \
    --secret-string '{
      "OPSI_URL":"https://opsi-api.example.com/v1/webhook",
      "OPSI_API_KEY":"your-opsi-api-key"
    }' \
    --region eu-west-1

# 4. Create DARTS Secret
aws secretsmanager create-secret \
    --name darts-secrets \
    --description "DARTS API credentials" \
    --secret-string '{
      "DARTS_URL":"https://darts-api.example.com/integration-api/fonoa-webhook",
      "DARTS_API_KEY":"your-darts-api-key"
    }' \
    --region eu-west-1


# LAMBDA VARIABLE

aws lambda update-function-configuration \
    --function-name fonoa-webhook-router \
    --environment Variables="{
        AWS_REGION_NAME=eu-west-1,
        ENVIRONMENT=PRODUCTION,
        IDEMPOTENCY_TABLE=FonoaWebhookIdempotency,
        FONOA_SECRET_NAME=fonoa-secrets,
        NETSUITE_SECRET_NAME=netsuite-secrets,
        OPSI_SECRET_NAME=opsi-secrets,
        DARTS_SECRET_NAME=darts-secrets,
        SENDER_EMAIL=notifications@example.com,
        ADMIN_EMAILS=admin@example.com
    }"


# SECRET LOAD PATTERN

// Each service manages its own secret

// When NetSuite is called:
services/netsuite.js → loadSecret('netsuite-secrets') → Cache

// When OPSI is called:
services/opsi.js → loadSecret('opsi-secrets') → Cache

// When DARTS is called:
services/darts.js → loadSecret('darts-secrets') → Cache