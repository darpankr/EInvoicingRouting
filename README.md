# Fonoa Multi-System Router

A production-ready AWS Lambda function that routes Fonoa webhook transactions to multiple target systems (NetSuite, OPSI, DARTS) based on entity number, transaction type, and country code.

## 🏗️ Architecture

```
┌─────────────┐
│   Fonoa     │
│  Webhook    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│    Lambda Handler (index.mjs)   │
│  - Security Verification        │
│  - Idempotency Check            │
│  - Country Routing              │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│  Country Adapter (Belgium)      │
│  - Entity Detection             │
│  - Transaction Type Logic       │
│  - Intercompany Detection       │
└──────┬──────────────────────────┘
       │
       ├─────────────┬─────────────┬─────────────┐
       ▼             ▼             ▼             ▼
   ┌──────┐     ┌──────┐      ┌──────┐      ┌──────┐
   │ 2012 │     │ 2045 │      │ 2047 │      │ ...  │
   └──┬───┘     └──┬───┘      └──┬───┘      └──────┘
      │            │             │
      ▼            ▼             ▼
   Target      Target        Target
   Systems     Systems       Systems
```

## 📁 Project Structure

```
fonoa-multi-system-router/
├── index.mjs                       # Main Lambda handler
├── package.json                    # Dependencies
├── README.md                       # This file
│
├── adapters/                       # Country-specific routing logic
│   └── belgium/
│       ├── index.mjs              # Belgium routing orchestrator
│       ├── Entity2012.js          # Entity 0422317610 rules
│       ├── Entity2045.js          # Entity 0885436190 rules
│       └── Entity2047.js          # Entity 0885540417 rules
│
├── services/                      # Target system integrations
│   ├── netsuite.js               # NetSuite OAuth 1.0a client
│   ├── opsi.js                   # OPSI API client
│   └── darts.js                  # DARTS API client
│
├── core/                         # Core infrastructure
│   ├── security.js               # JWT/OIDC verification
│   ├── fonoa.js                  # Fonoa API client
│   ├── idempotency.js            # DynamoDB locking
│   └── notifier.js               # SES email alerts
│
└── config/
    └── registry.js               # Country adapter registry
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or higher
- AWS Account with appropriate IAM permissions
- AWS Secrets Manager configured
- DynamoDB tables created

### Installation

```bash
npm install
```

### Environment Variables

Required environment variables for Lambda:

```bash
AWS_REGION_NAME=eu-west-1
ENVIRONMENT=PRODUCTION
IDEMPOTENCY_TABLE=FonoaWebhookIdempotency
SECRET_NAME=fonoa-webhook-secrets
SENDER_EMAIL=notifications@example.com
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

### AWS Secrets Manager Configuration

Your secret should contain the following keys:

```json
{
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
}
```

### DynamoDB Tables

#### 1. FonoaWebhookIdempotency

```
Primary Key: webhook_id (String)
TTL Attribute: expiration

Attributes:
- webhook_id (String)
- status (String: IN_PROGRESS | COMPLETED | FAILED_FATAL | FAILED_RETRYING)
- email_sent (Boolean)
- error_message (String)
- last_msg_hash (String)
- last_updated (Number - Unix timestamp)
- expiration (Number - Unix timestamp for TTL)
```

#### 2. IntercompanyEntities

```
Primary Key: entity_number (String)

Attributes:
- entity_number (String)
- entity_name (String, optional)
- country_code (String, optional)
```

Example items:
```json
{ "entity_number": "0422317610" }
{ "entity_number": "0885436190" }
{ "entity_number": "0885540417" }
```

## 🔄 Routing Logic

### Belgium Routing Matrix

| Entity | Entity Number | AP | AR | IC-AR |
|--------|--------------|----|----|-------|
| 2012 | 0422317610 | NetSuite | OPSI | NetSuite |
| 2045 | 0885436190 | NetSuite | ❌ | ❌ |
| 2047 | 0885540417 | NetSuite | DARTS | NetSuite |

**Transaction Type Determination:**
- `RECEIVED` direction → `AP` (Accounts Payable)
- `SENT` direction + Intercompany → `IC-AR` (Intercompany Accounts Receivable)
- `SENT` direction + Not Intercompany → `AR` (Accounts Receivable)

**Intercompany Detection:**
- Check `payload.is_intercompany === true`
- OR check if counterparty entity number exists in `IntercompanyEntities` table

## 📊 Flow Diagram

```
Webhook → Security Check → Idempotency Lock → Fetch Resource
   ↓
Country Routing (Belgium)
   ↓
Entity Detection (2012, 2045, 2047)
   ↓
Transaction Type Logic
   ├─ AP → NetSuite (all entities)
   ├─ AR → OPSI (2012) / DARTS (2047)
   └─ IC-AR → NetSuite (all entities)
   ↓
Response Validation → Mark Complete → Return Success
```

## 🛡️ Security Features

1. **JWT Verification**: Validates Fonoa webhook token signature
2. **Checksum Validation**: Ensures request body hasn't been tampered
3. **Idempotency**: Prevents duplicate processing
4. **OAuth 1.0a**: Secure NetSuite authentication
5. **API Keys**: Secure OPSI and DARTS authentication

## 📧 Error Notifications

Failures trigger SES email alerts with:
- Error category and priority
- Webhook and resource IDs
- Full error details
- Manual retry instructions
- CloudWatch log references

Priority levels:
- **Critical**: Database offline
- **High**: Security failures, integration errors
- **Medium**: Routing failures
- **Low**: General errors

## 🔧 Adding New Countries

1. Create new adapter folder:
```bash
mkdir -p adapters/[country]
```

2. Create `adapters/[country]/index.mjs`:
```javascript
export async function routeTransaction(payload) {
    // Your routing logic here
    // Return response from target system
}
```

3. Register in `config/registry.js`:
```javascript
import * as NewCountry from '../adapters/[country]/index.mjs';

export const CountryRegistry = {
    'BE': Belgium,
    'XX': NewCountry,  // Add your country
};
```

## 🔧 Adding New Entities

1. Create entity handler file:
```bash
# For Belgium
touch adapters/belgium/Entity[NUMBER].js
```

2. Implement routing logic:
```javascript
import { forwardToNetSuite } from '../../services/netsuite.js';

export async function handleRoute(payload, trType) {
    switch (trType) {
        case 'AP': return await forwardToNetSuite(payload);
        // ... more cases
    }
}
```

3. Register in `adapters/belgium/index.mjs`:
```javascript
import * as EntityXXXX from './EntityXXXX.js';

const handlers = {
    'ENTITY_NUMBER': EntityXXXX.handleRoute,
    // ... existing handlers
};
```

## 🧪 Testing

### Manual Invocation

Test with AWS CLI:
```bash
aws lambda invoke \
    --function-name fonoa-webhook-router \
    --payload '{
        "body": "{\"webhook_id\":\"test-123\",\"resource_id\":\"res-456\",\"resource_url\":\"https://...\",\"country_code\":\"BE\"}",
        "headers": {
            "fonoa-webhook-token": "eyJ..."
        }
    }' \
    response.json
```

### Manual Retry

For failed webhooks, retry using:
```bash
aws lambda invoke \
    --function-name fonoa-webhook-router \
    --payload '{
        "isManualSync": true,
        "resource_id": "RESOURCE_ID",
        "webhook_id": "WEBHOOK_ID"
    }' \
    response.json
```

## 📝 Deployment

### Package for Lambda

```bash
# Install dependencies
npm install

# Create deployment package
zip -r function.zip . -x "*.git*" "*.md" "node_modules/aws-sdk/*"
```

### Deploy with AWS CLI

```bash
aws lambda update-function-code \
    --function-name fonoa-webhook-router \
    --zip-file fileb://function.zip
```

### Lambda Configuration

Recommended settings:
- **Runtime**: Node.js 18.x
- **Memory**: 512 MB
- **Timeout**: 60 seconds
- **Architecture**: arm64 (Graviton2 for cost savings)
- **Environment**: Variables listed above

## 🔍 Monitoring

### CloudWatch Logs

Log groups:
- `/aws/lambda/fonoa-webhook-router`

Key log patterns:
- `[Belgium Routing]` - Entity and transaction type detection
- `[Entity 20XX]` - Entity-specific routing decisions
- `Webhook marked as COMPLETED` - Successful processing
- `Error notification sent` - Failure alerts

### CloudWatch Metrics

Monitor:
- Invocation count
- Error count
- Duration
- Throttles

### DynamoDB Monitoring

Track:
- Read/Write capacity
- Throttled requests
- Item count (with TTL enabled)

## 🤝 Contributing

When adding new features:
1. Follow existing file structure
2. Add comprehensive logging
3. Update this README
4. Test with real webhooks
5. Document routing rules

## 📄 License

ISC

## 🆘 Support

For issues or questions:
1. Check CloudWatch logs
2. Verify AWS Secrets Manager configuration
3. Validate DynamoDB table structure
4. Review email notifications for error details

---

**Last Updated**: 2024
**Version**: 1.0.0
