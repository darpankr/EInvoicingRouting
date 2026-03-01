# Project Summary: Fonoa Multi-System Router

## 📋 Overview

A production-ready AWS Lambda application that intelligently routes Fonoa webhook transactions to multiple target systems (NetSuite, OPSI, DARTS) based on entity number, transaction type, and country code.

## 🎯 What This Project Solves

**Before:** Single monolithic Lambda handler routing only to NetSuite
**After:** Modular, scalable multi-system router with country-based adapters

## ✅ Key Features

- ✅ **Multi-System Routing**: NetSuite, OPSI, DARTS
- ✅ **Country-Based Adapters**: Easy to add new countries
- ✅ **Entity-Specific Logic**: Each entity has its own routing rules
- ✅ **Intercompany Detection**: DynamoDB-backed with caching
- ✅ **Idempotency**: Prevents duplicate processing
- ✅ **Security**: JWT verification + SHA256 checksum
- ✅ **Error Notifications**: SES email alerts with priority levels
- ✅ **Production-Ready**: Comprehensive logging, monitoring, error handling

## 📁 Project Structure

```
fonoa-multi-system-router/
├── index.mjs                    # Main Lambda handler
├── package.json
├── README.md                    # Full documentation
├── ARCHITECTURE.md              # Technical deep dive
├── DEPLOYMENT.md                # Step-by-step deployment
├── .env.example                 # Configuration template
│
├── adapters/                    # Country routing logic
│   └── belgium/
│       ├── index.mjs           # Belgium orchestrator
│       ├── Entity2012.js       # 0422317610 rules
│       ├── Entity2045.js       # 0885436190 rules
│       └── Entity2047.js       # 0885540417 rules
│
├── services/                   # Target system clients
│   ├── netsuite.js            # OAuth 1.0a client
│   ├── opsi.js                # API key client
│   └── darts.js               # API key client
│
├── core/                      # Infrastructure
│   ├── security.js            # JWT verification
│   ├── fonoa.js               # Fonoa API client
│   ├── idempotency.js         # DynamoDB locking
│   └── notifier.js            # SES emails
│
└── config/
    └── registry.js            # Country registration
```

## 🚦 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure AWS Resources

**Create DynamoDB Tables:**
```bash
# Idempotency table
aws dynamodb create-table \
    --table-name FonoaWebhookIdempotency \
    --attribute-definitions AttributeName=webhook_id,AttributeType=S \
    --key-schema AttributeName=webhook_id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST

# Intercompany entities table
aws dynamodb create-table \
    --table-name IntercompanyEntities \
    --attribute-definitions AttributeName=entity_number,AttributeType=S \
    --key-schema AttributeName=entity_number,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
```

**Create Secrets:**
```bash
aws secretsmanager create-secret \
    --name fonoa-webhook-secrets \
    --secret-string '{
        "FONOA_API_KEY": "...",
        "NS_CONSUMER_KEY": "...",
        "NS_CONSUMER_SECRET": "...",
        "NS_TOKEN_ID": "...",
        "NS_TOKEN_SECRET": "...",
        "NS_ACCOUNT_ID": "...",
        "NETSUITE_RESTLET_URL": "...",
        "OPSI_URL": "...",
        "OPSI_API_KEY": "...",
        "DARTS_URL": "...",
        "DARTS_API_KEY": "..."
    }'
```

### 3. Deploy Lambda
```bash
# Package
zip -r function.zip . -x "*.git*" "*.md"

# Deploy
aws lambda create-function \
    --function-name fonoa-webhook-router \
    --runtime nodejs18.x \
    --role arn:aws:iam::ACCOUNT_ID:role/FonoaWebhookRouterRole \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 60 \
    --memory-size 512
```

## 🔄 Routing Rules

### Belgium Routing Matrix

| Entity | Number | AP | AR | IC-AR |
|--------|--------|----|----|-------|
| 2012 | 0422317610 | NetSuite | OPSI | NetSuite |
| 2045 | 0885436190 | NetSuite | ❌ | ❌ |
| 2047 | 0885540417 | NetSuite | DARTS | NetSuite |

**Transaction Type Logic:**
- `RECEIVED` → `AP` (Accounts Payable)
- `SENT` + Intercompany → `IC-AR`
- `SENT` + Not Intercompany → `AR`

## 🔧 How to Extend

### Add a New Country

1. Create folder: `adapters/germany/`
2. Create `index.mjs` with `routeTransaction(payload)` function
3. Register in `config/registry.js`:
```javascript
import * as Germany from '../adapters/germany/index.mjs';
export const CountryRegistry = {
    'BE': Belgium,
    'DE': Germany,  // Add here
};
```

### Add a New Entity

1. Create `adapters/belgium/Entity[NUMBER].js`:
```javascript
export async function handleRoute(payload, trType) {
    switch (trType) {
        case 'AP': return await forwardToNetSuite(payload);
        // Add cases
    }
}
```

2. Register in `adapters/belgium/index.mjs`:
```javascript
const handlers = {
    'NEW_ENTITY_NUMBER': EntityNEW.handleRoute,
    // ...existing
};
```

### Add a New Target System

1. Create `services/newsystem.js`:
```javascript
export async function forwardToNewSystem(payload) {
    // Implementation
}
```

2. Use in entity handlers:
```javascript
import { forwardToNewSystem } from '../../services/newsystem.js';
case 'AR': return await forwardToNewSystem(payload);
```

## 📊 Monitoring

### CloudWatch Logs
```bash
aws logs tail /aws/lambda/fonoa-webhook-router --follow
```

### Key Log Patterns
- `[Belgium Routing]` - Routing decisions
- `[Entity 20XX]` - Entity-specific logic
- `Webhook marked as COMPLETED` - Success
- `Error notification sent` - Failure alerts

### Metrics to Watch
- **Invocations**: Number of webhooks processed
- **Errors**: Failed transactions
- **Duration**: Processing time
- **Throttles**: Concurrent limit reached

## 🔒 Security Highlights

✅ JWT signature verification (JWKS)  
✅ SHA256 checksum validation  
✅ AWS Secrets Manager for credentials  
✅ OAuth 1.0a for NetSuite  
✅ API keys for OPSI/DARTS  
✅ IAM role with least privilege  
✅ DynamoDB conditional writes (idempotency)  

## 💰 Cost Estimate

**For 10,000 webhooks/month:**
- Lambda: $0.20
- DynamoDB: $1.00
- SES: $0.10
- Secrets Manager: $0.40
- **Total: ~$2/month**

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Comprehensive guide with all features |
| `ARCHITECTURE.md` | Technical deep dive with diagrams |
| `DEPLOYMENT.md` | Step-by-step AWS deployment |
| `.env.example` | Configuration template |
| `PROJECT_SUMMARY.md` | This file - quick overview |

## 🚨 Common Issues & Solutions

### Issue: "Security Error: Missing token"
**Solution**: Ensure Fonoa webhook includes `fonoa-webhook-token` header

### Issue: "Routing Error: Country 'XX' not supported"
**Solution**: Add country adapter in `adapters/` and register in `config/registry.js`

### Issue: "Entity 'XXXX' not configured"
**Solution**: Add entity handler in `adapters/belgium/` and register in handlers map

### Issue: "DATABASE_OFFLINE"
**Solution**: Verify DynamoDB table exists and IAM role has access

### Issue: No email notifications
**Solution**: Verify SES email addresses and check IAM permissions

## 🎓 Learning Resources

1. **Start here**: `README.md` - Full feature documentation
2. **Deployment**: `DEPLOYMENT.md` - AWS setup guide
3. **Architecture**: `ARCHITECTURE.md` - Technical details
4. **Code**: Start with `index.mjs` → Follow imports

## 🔄 Migration from Old Code

**From**: `updated-lambda-handler.js` (single system)
**To**: This project (multi-system)

**Key Improvements:**
1. ✅ Modular structure (vs monolithic file)
2. ✅ Country adapters (vs hardcoded logic)
3. ✅ Entity handlers (vs giant switch statement)
4. ✅ Intercompany caching (vs repeated DB calls)
5. ✅ Service layer (vs inline API calls)
6. ✅ Better error handling (vs try-catch soup)

## 🎯 Next Steps

1. ✅ Review code structure
2. ✅ Configure AWS resources (DynamoDB, Secrets, SES)
3. ✅ Deploy to development environment
4. ✅ Test with sample webhooks
5. ✅ Monitor CloudWatch logs
6. ✅ Add more entities/countries as needed
7. ✅ Set up CloudWatch alarms

## 🤝 Support

- **Logs**: CloudWatch `/aws/lambda/fonoa-webhook-router`
- **Errors**: Check email notifications
- **Questions**: Review `ARCHITECTURE.md` for technical details

---

**Status**: ✅ Production Ready  
**Version**: 1.0.0  
**Last Updated**: 2024  
