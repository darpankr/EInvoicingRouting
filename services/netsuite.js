import axios from 'axios';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';
import { loadSecret } from '../core/secrets.js';

// =========================================================================
// NETSUITE SECRETS CACHE
// =========================================================================
// let NETSUITE_SECRETS = null;

// =========================================================================
// OAUTH 1.0A CONFIGURATION
// =========================================================================
const createHmacSha256 = (baseString, key) => {
    return crypto.createHmac('sha256', key).update(baseString).digest('base64');
};

const oauth = new OAuth({
    consumer: { key: '', secret: '' },
    signature_method: 'HMAC-SHA256',
    hash_function: createHmacSha256,
    parameter_seperator: ','
});

// =========================================================================
// LOAD NETSUITE SECRETS
// =========================================================================
// async function loadNetSuiteSecrets() {
//     if (NETSUITE_SECRETS) {
//         console.log("Using cached NetSuite secrets");
//         return NETSUITE_SECRETS;
//     }

//     const secretName = process.env.SECRET_NAME;
//     NETSUITE_SECRETS = await loadSecret(secretName);
//     return NETSUITE_SECRETS;
// }

// =========================================================================
// EXTRACT SUPPLIER ID FROM PAYLOAD
// =========================================================================

// =========================================================================
// FORWARD TO NETSUITE
// =========================================================================
export async function forwardToNetSuite(payload, supplierId) {
    console.log("Forwarding transaction to NetSuite...");

    try {
        // Load NetSuite-specific secrets
        // const secrets = await loadNetSuiteSecrets();
        const secretName = process.env.SECRET_NAME;
        const secrets = await loadSecret(secretName);  // ✅ Direct call

        // Get Lambda environment
        const environment = process.env.ENVIRONMENT;
        
        let consumerKey, consumerSecret, tokenId, tokenSecret, accountId, restletUrl;

        // =========================================================================
        // ENVIRONMENT-BASED CREDENTIAL SELECTION
        // =========================================================================
        if (environment === "PROD") {
            // PROD: Use standard keys
            consumerKey = secrets.NS_CONSUMER_KEY;
            consumerSecret = secrets.NS_CONSUMER_SECRET;
            tokenId = secrets.NS_TOKEN_ID;
            tokenSecret = secrets.NS_TOKEN_SECRET;
            accountId = secrets.NS_ACCOUNT_ID;
            restletUrl = secrets.NETSUITE_RESTLET_URL;
            
            console.log("Environment: PRODUCTION - Using PROD credentials");
            
        } else if (environment === "NON-PROD") {
            
            if (supplierId === "87af90f7cba711f08ff93aed354798f0" || supplierId === "AP201220452047") {
                // Supplier 1: Use credentials with _1 suffix
                consumerKey = secrets.NS_CONSUMER_KEY;
                consumerSecret = secrets.NS_CONSUMER_SECRET;
                tokenId = secrets.NS_TOKEN_ID;
                tokenSecret = secrets.NS_TOKEN_SECRET;
                accountId = secrets.NS_ACCOUNT_ID;
                restletUrl = secrets.NETSUITE_RESTLET_URL;
                
                console.log("Routing to NetSuite Environment 1 (DEV)");
                
            } else {
                throw new Error(
                    `NetSuite Routing Error: Invalid supplier_id '${supplierId}'. ` +
                    `Expected '1' or '2' for NON_PROD environment.`
                );
            }
            
        } else {
            throw new Error(
                `NetSuite Configuration Error: Unknown ENVIRONMENT '${environment}'. ` +
                `Expected 'PRODUCTION' or 'NON_PROD'.`
            );
        }

        // Validate credentials are present
        if (!consumerKey || !restletUrl) {
            throw new Error(
                `NetSuite Configuration Error: Missing credentials for ${environment} ` +
                `${environment === "NON_PROD" ? `supplier ${supplierId}` : ''}`
            );
        }

        // =========================================================================
        // OAUTH 1.0A AUTHENTICATION
        // =========================================================================
        oauth.consumer.key = consumerKey;
        oauth.consumer.secret = consumerSecret;

        const token = {
            key: tokenId,
            secret: tokenSecret
        };

        // Parse URL for OAuth signature
        const urlParts = new URL(restletUrl);
        const requestData = {
            url: restletUrl,
            method: 'POST',
            data: Object.fromEntries(urlParts.searchParams.entries())
        };

        // Generate OAuth authorization
        const authorization = oauth.authorize(requestData, token);

        // Build OAuth header
        const authHeader = `OAuth realm="${accountId}",${oauth.toHeader(authorization).Authorization.substring(6)}`;

        console.log(`NetSuite Account ID: ${accountId}`);
        console.log(`NetSuite URL: ${restletUrl}`);

        // =========================================================================
        // MAKE REQUEST
        // =========================================================================
        const response = await axios.post(
            restletUrl,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log("NetSuite response received:", {
            status: response.status,
            data: response.data
        });

        return response;

    } catch (err) {
        console.error("NetSuite forward failed:", err.message);

        // Enhance error message
        if (err.code === 'ECONNABORTED') {
            throw new Error(`NetSuite API: Request timeout after 30s`);
        }

        if (err.response) {
            throw new Error(
                `NetSuite API Error: ${err.response.status} - ${JSON.stringify(err.response.data)}`
            );
        }

        throw new Error(`NetSuite authentication failure: ${err.message}`);
    }
}
