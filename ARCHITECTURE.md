# Technical Architecture

## System Overview

The Fonoa Multi-System Router is a serverless AWS Lambda application that receives webhooks from Fonoa and intelligently routes transactions to multiple target systems based on business rules.

## High-Level Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         FONOA WEBHOOK EVENT                          │
│  {                                                                   │
│    "webhook_id": "wh_123",                                          │
│    "resource_id": "txn_456",                                        │
│    "country_code": "BE",                                            │
│    "resource_url": "https://api.fonoa.com/v1/transactions/..."     │
│  }                                                                   │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (HTTPS)                             │
│  - Receives webhook POST request                                     │
│  - Forwards to Lambda                                                │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   LAMBDA: index.mjs (HANDLER)                        │
│                                                                       │
│  1. Cold Start Check                                                 │
│     ├─ Initialize JWKS (once per container)                         │
│     └─ Cache public keys for token verification                     │
│                                                                       │
│  2. Parse & Validate Request                                        │
│     ├─ Decode Base64 body if needed                                 │
│     ├─ Parse JSON payload                                           │
│     └─ Extract: webhook_id, resource_id, country_code              │
│                                                                       │
│  3. Idempotency Check (DynamoDB)                                    │
│     ├─ Attempt to create lock (IN_PROGRESS)                        │
│     ├─ If exists & COMPLETED → Return 200 (duplicate)              │
│     ├─ If exists & IN_PROGRESS → Return 429 (retry later)          │
│     └─ If FAILED or STALE → Reclaim lock & proceed                 │
│                                                                       │
│  4. Security Verification                                           │
│     ├─ Extract JWT from fonoa-webhook-token header                 │
│     ├─ Verify signature against JWKS                               │
│     └─ Validate SHA256 checksum of body                            │
│                                                                       │
│  5. Fetch Full Resource Data                                        │
│     ├─ GET request to resource_url                                  │
│     ├─ Include Fonoa API key in headers                            │
│     └─ Receive complete transaction details                         │
│                                                                       │
│  6. Country-Based Routing                                           │
│     ├─ Look up country adapter from registry                        │
│     └─ Delegate to country-specific logic                           │
│                                                                       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│              COUNTRY ADAPTER: adapters/belgium/index.mjs             │
│                                                                       │
│  1. Determine Transaction Direction                                 │
│     ├─ RECEIVED → We are the customer (AP)                          │
│     └─ SENT → We are the supplier (AR or IC-AR)                     │
│                                                                       │
│  2. Extract Entity Numbers                                          │
│     ├─ Our entity (customer.entity_number or supplier.entity_number) │
│     └─ Counterparty entity (the other party)                        │
│                                                                       │
│  3. Intercompany Detection                                          │
│     ├─ Check payload.is_intercompany === true                       │
│     ├─ OR query IntercompanyEntities DynamoDB table                 │
│     └─ Cache results for 1 hour to reduce costs                     │
│                                                                       │
│  4. Determine Transaction Type                                      │
│     ├─ RECEIVED → AP                                                │
│     ├─ SENT + Intercompany → IC-AR                                 │
│     └─ SENT + Not Intercompany → AR                                │
│                                                                       │
│  5. Route to Entity Handler                                         │
│     ├─ Entity 2012 (0422317610)                                     │
│     ├─ Entity 2045 (0885436190)                                     │
│     └─ Entity 2047 (0885540417)                                     │
│                                                                       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Entity 2012 │ │  Entity 2045 │ │  Entity 2047 │
│              │ │              │ │              │
│  AP → NS     │ │  AP → NS     │ │  AP → NS     │
│  AR → OPSI   │ │              │ │  AR → DARTS  │
│  IC-AR → NS  │ │              │ │  IC-AR → NS  │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  NetSuite    │ │     OPSI     │ │    DARTS     │
│  Service     │ │   Service    │ │   Service    │
│              │ │              │ │              │
│ OAuth 1.0a   │ │  API Key     │ │  API Key     │
│ RESTlet      │ │  REST API    │ │  REST API    │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       │                │                │
       ▼                ▼                ▼
┌──────────────────────────────────────────────────┐
│          TARGET SYSTEM RESPONSES                 │
│  - Validate response (check for errors)         │
│  - Return to handler                             │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│         HANDLER: Success Path                    │
│  1. Update DynamoDB: status = COMPLETED          │
│  2. Return 200 OK to Fonoa                       │
└──────────────────────────────────────────────────┘
```

## Component Architecture

### 1. Core Layer (`core/`)

#### security.js
- **Purpose**: JWT verification and webhook authentication
- **Dependencies**: jose, axios, crypto
- **Key Functions**:
  - `initializeJwks()`: Fetches OIDC configuration and public keys
  - `verifyFonoaToken()`: Validates JWT signature and body checksum
- **Caching**: JWKS cached for container lifetime

#### fonoa.js
- **Purpose**: Fonoa API client
- **Dependencies**: axios, @aws-sdk/client-secrets-manager
- **Key Functions**:
  - `loadSecrets()`: Fetches credentials from AWS Secrets Manager
  - `fetchFonoaResource()`: Retrieves full transaction data
  - `getSecrets()`: Exposes secrets to other services
- **Caching**: Secrets cached for container lifetime

#### idempotency.js
- **Purpose**: Duplicate detection and concurrency control
- **Dependencies**: @aws-sdk/lib-dynamodb, crypto
- **Key Functions**:
  - `acquireLock()`: Atomic lock acquisition with DynamoDB conditional writes
  - `markCompleted()`: Updates status to COMPLETED
  - `markFailed()`: Updates status and triggers email notification
- **Features**:
  - Stale lock detection (5-minute timeout)
  - Retry support for failed transactions
  - Message fingerprinting to prevent duplicate emails

#### notifier.js
- **Purpose**: Error notification via AWS SES
- **Dependencies**: @aws-sdk/client-sesv2
- **Key Functions**:
  - `sendErrorNotification()`: Sends formatted HTML email alerts
- **Features**:
  - Priority-based subject lines
  - IST timezone formatting
  - Manual retry instructions
  - Detailed error context

### 2. Adapter Layer (`adapters/`)

#### belgium/index.mjs
- **Purpose**: Belgium-specific routing orchestration
- **Key Functions**:
  - `getIntercompanyList()`: Fetches and caches IC entities from DynamoDB
  - `routeTransaction()`: Determines entity and transaction type
- **Business Logic**:
  - Direction mapping (RECEIVED → AP, SENT → AR/IC-AR)
  - Entity number extraction
  - Intercompany detection
  - Entity handler delegation

#### belgium/Entity2012.js, Entity2045.js, Entity2047.js
- **Purpose**: Entity-specific routing rules
- **Pattern**: Switch-case on transaction type
- **Customizable**: Easy to add new transaction types

### 3. Service Layer (`services/`)

#### netsuite.js
- **Purpose**: NetSuite RESTlet integration
- **Authentication**: OAuth 1.0a (HMAC-SHA256)
- **Dependencies**: axios, oauth-1.0a, crypto
- **Flow**:
  1. Load OAuth credentials from Secrets Manager
  2. Generate OAuth signature
  3. Build Authorization header
  4. POST to RESTlet endpoint

#### opsi.js, darts.js
- **Purpose**: OPSI/DARTS API integration
- **Authentication**: API Key
- **Pattern**: Standard REST API client with timeout handling

### 4. Configuration Layer (`config/`)

#### registry.js
- **Purpose**: Country adapter registration
- **Pattern**: Simple key-value mapping
- **Extensibility**: Add new countries by importing and registering

## Data Flow Diagrams

### Security Verification Flow

```
┌─────────────────────┐
│  Webhook Request    │
│  with JWT Token     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────┐
│  Extract JWT from Header    │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Verify JWT Signature       │
│  using JWKS Public Keys     │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Extract SHA256 Checksum    │
│  from Token Payload         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Compute SHA256 of          │
│  Request Body               │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Compare Checksums          │
│  Token vs Computed          │
└──────────┬──────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌────────┐   ┌────────┐
│ Match  │   │Mismatch│
│ ✓ OK   │   │ ✗ Fail │
└────────┘   └────────┘
```

### Idempotency Lock Flow

```
┌─────────────────────────────┐
│  Receive webhook_id         │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  DynamoDB PutItem           │
│  Condition: webhook_id      │
│  does not exist             │
└──────────┬──────────────────┘
           │
    ┌──────┴──────────┐
    │                 │
    ▼                 ▼
┌─────────┐    ┌──────────────┐
│Success  │    │ConditionFail │
│Lock     │    │Already Exists│
│Acquired │    └──────┬───────┘
└─────────┘           │
                      ▼
            ┌─────────────────┐
            │  GetItem to     │
            │  Check Status   │
            └────────┬────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │COMPLETE│  │IN_PROG │  │FAILED/ │
    │        │  │        │  │STALE   │
    │Return  │  │Return  │  │Reclaim │
    │200     │  │429     │  │Lock    │
    └────────┘  └────────┘  └────────┘
```

## AWS Services Integration

### DynamoDB

**FonoaWebhookIdempotency Table:**
- Primary Key: `webhook_id` (String)
- GSI: None required
- TTL: `expiration` attribute (7 days)
- Billing: On-Demand (pay per request)

**IntercompanyEntities Table:**
- Primary Key: `entity_number` (String)
- GSI: None required
- Billing: On-Demand (infrequent reads)

### AWS Secrets Manager

**Secret Structure:**
```json
{
  "FONOA_API_KEY": "string",
  "NS_*": "NetSuite credentials",
  "OPSI_*": "OPSI credentials",
  "DARTS_*": "DARTS credentials"
}
```

**Access Pattern:**
- Fetched once per Lambda container (cold start)
- Cached for container lifetime
- Automatically rotated by AWS (optional)

### AWS SES

**Configuration:**
- Verified sender email
- Verified recipient emails (admin team)
- HTML email templates with inline CSS
- Priority-based subject lines

### CloudWatch

**Logs:**
- `/aws/lambda/fonoa-webhook-router`
- Structured logging with prefixes:
  - `[Belgium Routing]`
  - `[Entity 20XX]`
  - `Webhook marked as...`

**Metrics:**
- Invocations
- Errors
- Duration
- Throttles

## Error Handling Strategy

### Error Categories

1. **Security Errors** (Priority: High)
   - Missing token
   - Invalid signature
   - Checksum mismatch

2. **Routing Errors** (Priority: Medium)
   - Unsupported country
   - Unsupported entity
   - Invalid transaction type

3. **Integration Errors** (Priority: High)
   - Target system rejection
   - API timeout
   - Network failure

4. **Infrastructure Errors** (Priority: Critical)
   - DynamoDB offline
   - Secrets Manager failure
   - SES unavailable

### Error Response Pattern

```javascript
try {
    // Main logic
} catch (err) {
    // Categorize error
    // Track in DynamoDB
    // Send email notification
    // Return 200 (acknowledge to Fonoa)
}
```

**Why return 200 on errors?**
- Prevents Fonoa from retrying indefinitely
- We track failures in DynamoDB
- Email notifications alert admins
- Manual retry is available

## Performance Optimization

### Cold Start Mitigation
- Shared imports at top level
- JWKS initialized once per container
- Secrets cached for container lifetime
- Minimal dependencies

### DynamoDB Optimization
- Conditional writes for idempotency
- TTL for automatic cleanup
- On-Demand billing (no capacity planning)
- Intercompany cache (1 hour TTL)

### Network Optimization
- 30-second timeouts on all external calls
- Connection pooling via axios
- ARM64 architecture (20% faster, 20% cheaper)

## Security Considerations

### Defense in Depth

1. **Transport Layer**: HTTPS only (API Gateway)
2. **Authentication**: JWT signature verification
3. **Integrity**: SHA256 checksum validation
4. **Authorization**: IAM role with least privilege
5. **Secrets**: AWS Secrets Manager (encrypted at rest)
6. **Logging**: CloudWatch (encrypted, monitored)

### Compliance

- GDPR: 7-day data retention via TTL
- SOC 2: CloudWatch audit trail
- PCI DSS: No card data processed

## Scalability

### Horizontal Scaling
- AWS Lambda auto-scales to 1000 concurrent executions (default)
- Can request limit increase to 10,000+
- Each execution handles one webhook

### Vertical Scaling
- 512 MB memory (can increase to 10 GB)
- 60-second timeout (can increase to 15 minutes)
- ARM64 architecture for better price/performance

### Cost Projections

**Assumptions:**
- 10,000 webhooks/month
- 500 ms average duration
- 512 MB memory

**Estimated Costs:**
- Lambda: $0.20/month
- DynamoDB: $1.00/month (on-demand)
- SES: $0.10/month (errors only)
- Secrets Manager: $0.40/month
- **Total: ~$2/month**

## Disaster Recovery

### Backup Strategy
- DynamoDB: Point-in-time recovery (optional)
- Secrets Manager: Automatic replication
- Code: Version control (Git)

### Recovery Procedures

1. **Lambda Failure**: Automatic retry by AWS
2. **Complete Outage**: Fonoa retries for 24 hours
3. **Data Loss**: Manual retry using webhook_id

### Monitoring & Alerting

**CloudWatch Alarms:**
- Error rate > 5% (5 minutes)
- Throttles > 0 (1 minute)
- Duration > 50 seconds (warning)

**Email Notifications:**
- Critical errors: Immediate
- Medium errors: Batched hourly
- Low errors: Daily digest

---

**Last Updated**: 2024
**Author**: DevOps Team
