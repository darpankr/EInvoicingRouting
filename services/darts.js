import axios from 'axios';
import { loadSecret } from '../core/secrets.js';

// // =========================================================================
// // DARTS SECRETS CACHE
// // =========================================================================
// let DARTS_SECRETS = null;

// // =========================================================================
// // LOAD DARTS SECRETS
// // =========================================================================
// async function loadDARTSSecrets() {
//     if (DARTS_SECRETS) {
//         console.log("Using cached DARTS secrets");
//         return DARTS_SECRETS;
//     }

//     const secretName = process.env.DARTS_SECRET_NAME;
//     DARTS_SECRETS = await loadSecret(secretName);
//     return DARTS_SECRETS;
// }



// =========================================================================
// FORWARD TO DARTS
// =========================================================================
export async function forwardToDARTS(payload, supplierId) {
    console.log("Forwarding transaction to DARTS...");

    try {
        // Load DARTS-specific secrets
        // const secrets = await loadDARTSSecrets();
        const secretName = process.env.DARTS_SECRET_NAME;
        const secrets = await loadSecret(secretName);  // ✅ Direct call

        // Get Lambda environment
        const environment = process.env.ENVIRONMENT;
        
        let dartsUrl, dartsApiKey;

        // =========================================================================
        // ENVIRONMENT-BASED CREDENTIAL SELECTION
        // =========================================================================
        if (environment === "PROD") {
            // PROD: Use standard keys
            dartsUrl = secrets.DARTS_URL;
            dartsApiKey = secrets.DARTS_API_KEY;
            
            console.log("Environment: PRODUCTION - Using PROD credentials");
            
        } else if (environment === "NON-PROD") {
            // NON_PROD: Determine credentials based on supplier_id
            
            if (supplierId === "84a8c39ab98211f0b89662776c1e4c7a") {
                // Supplier 1: Use credentials with _1 suffix
                // dartsUrl = secrets.DARTS_URL_1;
                // dartsApiKey = secrets.DARTS_API_KEY_1;
                dartsUrl = secrets.DARTS_URL_1;
                dartsApiKey = secrets.DARTS_API_KEY_1;
                
                console.log("Routing to DARTS Environment 1 (DEV)");
                
            } else if (supplierId === "0a484185f6d411f0a79bf21900fea8d9") {
                // Supplier 2: Use credentials with _2 suffix
                // dartsUrl = secrets.DARTS_URL_2;
                // dartsApiKey = secrets.DARTS_API_KEY_2;
                dartsUrl = secrets.DARTS_URL_2;
                dartsApiKey = secrets.DARTS_API_KEY_2;
                
                console.log("Routing to DARTS Environment 2 (TEST)");
                
            } else {
                throw new Error(
                    `DARTS Routing Error: Invalid supplier_id '${supplierId}'. ` +
                    `Expected '1' or '2' for NON_PROD environment.`
                );
            }
            
        } else {
            throw new Error(
                `DARTS Configuration Error: Unknown ENVIRONMENT '${environment}'. ` +
                `Expected 'PRODUCTION' or 'NON_PROD'.`
            );
        }

        // Validate credentials are present
        if (!dartsUrl || !dartsApiKey) {
            throw new Error(
                `DARTS Configuration Error: Missing credentials for ${environment} ` +
                `${environment === "NON-PROD" ? `supplier ${supplierId}` : ''}`
            );
        }

        console.log(`DARTS URL: ${dartsUrl}`);

        // =========================================================================
        // MAKE REQUEST
        // =========================================================================
        const response = await axios.post(
            dartsUrl,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': dartsApiKey
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log("DARTS response received:", {
            status: response.status,
            data: response.data
        });

        return response;

    } catch (err) {
        console.error("DARTS forward failed:", err.message);

        // Enhance error message
        if (err.code === 'ECONNABORTED') {
            throw new Error(`DARTS API: Request timeout after 30s`);
        }

        if (err.response) {
            throw new Error(
                `DARTS API Error: ${err.response.status} - ${JSON.stringify(err.response.data)}`
            );
        }

        throw new Error(`DARTS API Failure: ${err.message}`);
    }
}
