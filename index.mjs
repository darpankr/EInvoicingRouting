import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { initializeJwks, verifyFonoaToken } from './core/security.js';
import * as Idempotency from './core/idempotency.js';
import { sendErrorNotification } from './core/notifier.js';
import { CountryRegistry } from './config/registry.js';
import { fetchFonoaResource } from './core/fonoa.js';

// =========================================================================
// AWS CLIENTS - Initialize outside handler for container reuse
// =========================================================================
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION_NAME });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Environment Configuration
const ENVIRONMENT = process.env.ENVIRONMENT || 'NA';
const IDEMPOTENCY_TABLE = process.env.IDEMPOTENCY_TABLE;

// Cold start flag
let isInitialized = false;

// =========================================================================
// MAIN LAMBDA HANDLER
// =========================================================================
export const handler = async (event) => {
    let webhookId = "UNKNOWN";
    let resourceId = "UNKNOWN";
    let rawBody = "Could not parse event body";

    try {
        // 1. PARSE REQUEST BODY
        rawBody = event.isBase64Encoded 
            ? Buffer.from(event.body, 'base64').toString('utf8') 
            : event.body;
        
        console.log("Webhook Received:", rawBody);

        if (!rawBody || rawBody.trim() === "{}" || rawBody.trim() === "null") {
            console.warn("Rejected: Empty body");
            return { statusCode: 200, body: JSON.stringify({ error: "Missing body" }) };
        }

        let body;
        try {
            body = JSON.parse(rawBody);
        } catch (e) {
            console.warn("Rejected: Invalid JSON");
            return { statusCode: 200, body: JSON.stringify({ error: "Invalid JSON" }) };
        }

        webhookId = body.webhook_id || "MISSING_ID";
        resourceId = body.resource_id || "MISSING_RES_ID";
        const resourceUrl = body.resource_url;

        // 2. VALIDATE REQUIRED FIELDS
        if (webhookId === "MISSING_ID" || !resourceId || !resourceUrl) {
            console.warn("Rejected: Missing required fields");
            return { statusCode: 200, body: JSON.stringify({ error: "Incomplete payload" }) };
        }

        // 3. IDEMPOTENCY LOCK (prevent duplicate processing)
        const lockStatus = await Idempotency.acquireLock(
            docClient, 
            IDEMPOTENCY_TABLE, 
            webhookId
        );

        if (lockStatus === "COMPLETED") {
            console.log(`Webhook already processed [DUPLICATE]: ${webhookId}`);
            return { statusCode: 200, body: JSON.stringify({ message: "Already processed" }) };
        }

        if (lockStatus === "LOCKED") {
            console.log(`Webhook currently IN_PROGRESS: ${webhookId}`);
            return { statusCode: 429, body: JSON.stringify({ message: "Request currently being processed" }) };
        }

        // 4. COLD START INITIALIZATION (runs once per container lifecycle)
        // Moved here so JWKS failures can be tracked in idempotency table and retried
        if (!isInitialized) {
            await initializeJwks();
            isInitialized = true;
            console.log("Cold start initialization completed.");
        }

        // 5. SECURITY VERIFICATION
        const fonoaToken = event.headers['fonoa-webhook-token'] || event.headers['Fonoa-Webhook-Token'];
        
        if (!fonoaToken) {
            throw new Error("Security Error: Missing fonoa-webhook-token header");
        }

        await verifyFonoaToken(fonoaToken, rawBody, body);
        console.log("Fonoa webhook security validated successfully.");

        // 6. FETCH FULL RESOURCE DATA
        const fullFonoaDetails = await fetchFonoaResource(resourceUrl);
        console.log(`Successfully fetched resource: ${resourceId}`);

        // 7. DYNAMIC COUNTRY-BASED ROUTING
        // Extract country code with fallback logic based on direction
        const direction = fullFonoaDetails.direction?.toUpperCase();
        let countryCode = null;

        if (direction === 'RECEIVED') {
            // For RECEIVED: Try customer fields
            countryCode = fullFonoaDetails.customer?.address?.country_code?.toUpperCase()
                       || fullFonoaDetails.customer?.country_code?.toUpperCase();
        } else if (direction === 'SENT') {
            // For SENT: Try top-level, then supplier fields
            countryCode = fullFonoaDetails.country_code?.toUpperCase()
                       || fullFonoaDetails.supplier?.address?.country_code?.toUpperCase()
                       || fullFonoaDetails.supplier?.country_code?.toUpperCase();
        } else {
            // Fallback: Try all possible fields
            countryCode = fullFonoaDetails.country_code?.toUpperCase()
                       || fullFonoaDetails.customer?.address?.country_code?.toUpperCase()
                       || fullFonoaDetails.customer?.country_code?.toUpperCase()
                       || fullFonoaDetails.supplier?.address?.country_code?.toUpperCase()
                       || fullFonoaDetails.supplier?.country_code?.toUpperCase();
        }

        console.log(`Direction: ${direction}, Country Code: ${countryCode}`);

        const adapter = CountryRegistry[countryCode];
        
        if (!adapter) {
            throw new Error(`Routing Error: Country '${countryCode}' not supported`);
        }

        console.log(`Routing to country adapter: ${countryCode}`);
        const response = await adapter.routeTransaction(fullFonoaDetails, body);

        // 8. VALIDATE TARGET SYSTEM RESPONSE
        if (response.data?.error || response.data?.status === 'FAILED' || response.data?.status === 'error') {
            throw new Error(`Integration Error: Target system rejected the data. Response: ${JSON.stringify(response.data)}`);
        }

        console.log("Data successfully forwarded to target system.");

        // 9. MARK AS COMPLETED
        await Idempotency.markCompleted(docClient, IDEMPOTENCY_TABLE, webhookId);

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                message: "Success",
                webhookId: webhookId,
                resourceId: resourceId
            }) 
        };

    } catch (err) {
        console.error("Handler Error:", err.message);
        
        const detailedMsg = err.message;
        let shouldRetry = false;
        let trackInTable = true;
        let system = "System";
        let category = "Error";
        let subcategory = "Issue";
        let priority = "Low";
        let targetSystem = "N/A";  // Will be set to actual system name when known

        // Comprehensive error categorization matrix
        if (detailedMsg.includes("Missing body") || detailedMsg.includes("Invalid JSON")) {
            priority = "Low"; system = "Fonoa"; category = "Parsing Error"; subcategory = "Body Invalid"; trackInTable = false; shouldRetry = false;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("MISSING_ID") || detailedMsg.includes("Missing required field: 'webhook_id'")) {
            priority = "Low"; system = "Fonoa"; category = "Parsing Error"; subcategory = "Webhook Id Invalid"; trackInTable = false; shouldRetry = false;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("MISSING_RES_ID") || detailedMsg.includes("Missing required field: 'resource_id'")) {
            priority = "Low"; system = "Fonoa"; category = "Parsing Error"; subcategory = "Resource Id Invalid"; trackInTable = true; shouldRetry = false;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Incomplete payload") || detailedMsg.includes("resource_url")) {
            priority = "Low"; system = "Fonoa"; category = "Parsing Error"; subcategory = "Resource URL Invalid"; trackInTable = true; shouldRetry = false;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Failed to load secret") || detailedMsg.includes("Secrets Manager fetch failed")) {
            priority = "Low"; system = "AWS"; category = "Initialization Error"; subcategory = "Secret Fetch Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("OIDC Discovery failed")) {
            priority = "Low"; system = "AWS"; category = "Initialization Error"; subcategory = "JWKS Initialize Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("DATABASE_OFFLINE") || detailedMsg.includes("Requested resource not found") || detailedMsg.includes("Table") && detailedMsg.includes("not found")) {
            priority = "Low"; system = "AWS"; category = "Initialization Error"; subcategory = "DynamoDB Init Failed"; trackInTable = false; shouldRetry = false;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("AWS Initialization")) {
            priority = "Low"; system = "AWS"; category = "Initialization Error"; subcategory = "Initialization TRY-CATCH Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Missing fonoa-webhook-token") || detailedMsg.includes("Missing token")) {
            priority = "Low"; system = "Fonoa"; category = "Security Error"; subcategory = "Fonoa Token Missing"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Missing checksum")) {
            priority = "Low"; system = "Fonoa"; category = "Security Error"; subcategory = "Fonoa Token Checksum Missing"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Checksum mismatch") || detailedMsg.includes("Checksum Mismatch")) {
            priority = "Low"; system = "Fonoa"; category = "Security Error"; subcategory = "Fonoa Checksum Mismatch"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Token verification failed") || detailedMsg.includes("JWTVerify")) {
            priority = "Low"; system = "Fonoa"; category = "Security Error"; subcategory = "Fonoa Token JwtVerification Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Fonoa API") && detailedMsg.includes("Resource fetch failed")) {
            priority = "Low"; system = "Fonoa"; category = "Resource Error"; subcategory = "Fonoa API Resource Fetch Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Timeout") || detailedMsg.includes("timeout")) {
            priority = "Low"; system = "Integration"; category = "Timeout Error"; subcategory = "External API Timeout"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("NetSuite authentication failure") || detailedMsg.includes("NetSuite API Error")) {
            priority = "Medium"; system = "NetSuite"; category = "NetSuite Security Error"; subcategory = "NetSuite Authentication Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "NetSuite";
        }
        else if (detailedMsg.includes("NetSuite") && (detailedMsg.includes("script failure") || detailedMsg.includes("rejected"))) {
            priority = "Low"; system = "NetSuite"; category = "Integration Error"; subcategory = "NetSuite Script Failure"; trackInTable = true; shouldRetry = false;
            targetSystem = "NetSuite";
        }
        else if (detailedMsg.includes("OPSI API Error") || detailedMsg.includes("OPSI API Failure")) {
            priority = "Low"; system = "OPSI"; category = "OPSI Integration Error"; subcategory = "OPSI API Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "OPSI";
        }
        else if (detailedMsg.includes("DARTS API Error") || detailedMsg.includes("DARTS API Failure")) {
            priority = "Low"; system = "DARTS"; category = "DARTS Integration Error"; subcategory = "DARTS API Failed"; trackInTable = true; shouldRetry = true;
            targetSystem = "DARTS";
        }
        else if (detailedMsg.includes("Routing Error")) {
            priority = "Low"; system = "Router"; category = "Routing Error"; subcategory = "Configuration Issue"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else if (detailedMsg.includes("Integration Error") || detailedMsg.includes("Target system rejected")) {
            priority = "Low"; system = "Integration"; category = "Target System Failure"; subcategory = "Data Rejection"; trackInTable = true; shouldRetry = true;
            targetSystem = "N/A";
        }
        else {
            priority = "Low"; system = "Unknown"; category = "Unknown Error"; subcategory = "End To End Failure"; trackInTable = true; shouldRetry = false;
            targetSystem = "N/A";
        }

        // Track failure and send notification
        await Idempotency.markFailed(
            docClient,
            IDEMPOTENCY_TABLE,
            webhookId,
            detailedMsg,
            category,
            subcategory,
            rawBody,
            priority,
            ENVIRONMENT,
            shouldRetry,
            trackInTable,
            targetSystem  // Pass target system (will be "N/A" or actual system name)
        );

        // Return appropriate status code
        if (!shouldRetry) {
            console.log("No more retry for this webhook. Returning 200.");
            return { 
                statusCode: 200, 
                body: JSON.stringify({ 
                    status: "Acknowledged",
                    error: detailedMsg 
                }) 
            };
        }

        console.log("Error is retryable. Returning 500 to trigger Fonoa retry.");
        return { 
            statusCode: 500, 
            body: JSON.stringify({ 
                error: detailedMsg 
            }) 
        };
    }
};
