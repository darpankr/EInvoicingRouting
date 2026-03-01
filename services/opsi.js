import axios from 'axios';
import { loadSecret } from '../core/fonoa.js';
import { extractSupplierId } from '../core/utils.js';

// =========================================================================
// OPSI SECRETS CACHE
// =========================================================================
let OPSI_SECRETS = null;

// =========================================================================
// LOAD OPSI SECRETS
// =========================================================================
async function loadOPSISecrets() {
    if (OPSI_SECRETS) {
        console.log("Using cached OPSI secrets");
        return OPSI_SECRETS;
    }

    const secretName = process.env.OPSI_SECRET_NAME;
    OPSI_SECRETS = await loadSecret(secretName);
    return OPSI_SECRETS;
}

// `extractSupplierId` moved to `core/utils.js`

// =========================================================================
// FORWARD TO OPSI
// =========================================================================
export async function forwardToOPSI(payload, supplierId) {
    console.log("Forwarding transaction to OPSI...");

    try {
        // Load OPSI-specific secrets
        // const secrets = await loadOPSISecrets();

        // Get Lambda environment
        const environment = process.env.ENVIRONMENT;
        
        let opsiUrl, opsiApiKey;

        // =========================================================================
        // ENVIRONMENT-BASED CREDENTIAL SELECTION
        // =========================================================================
        if (environment === "PROD") {
            // PROD: Use standard keys
            opsiUrl = secrets.OPSI_URL;
            opsiApiKey = secrets.OPSI_API_KEY;
            
            console.log("Environment: PRODUCTION - Using PROD credentials");
            
        } else if (environment === "NON-PROD") {
            
            if (supplierId === "87af90f7cba711f08ff93aed354798f0") {
                // Supplier 1: Use credentials with _1 suffix
                opsiUrl = secrets.OPSI_URL_1;
                opsiApiKey = secrets.OPSI_API_KEY_1;
                
                console.log("Routing to DARTS Environment 1 (DEV)");
                
            }  else {
                throw new Error(
                    `OPSI Routing Error: Invalid supplier_id '${supplierId}'. ` +
                    `Expected '1' or '2' for NON_PROD environment.`
                );
            }
            
        } else {
            throw new Error(
                `OPSI Configuration Error: Unknown ENVIRONMENT '${environment}'. ` +
                `Expected 'PRODUCTION' or 'NON_PROD'.`
            );
        }

        // Validate credentials are present
        if (!opsiUrl || !opsiApiKey) {
            throw new Error(
                `OPSI Configuration Error: Missing credentials for ${environment} ` +
                `${environment === "NON_PROD" ? `supplier ${extractSupplierId(payload)}` : ''}`
            );
        }

        console.log(`OPSI URL: ${opsiUrl}`);

        // =========================================================================
        // MAKE REQUEST
        // =========================================================================
        const response = await axios.post(
            opsiUrl,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': opsiApiKey
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log("OPSI response received:", {
            status: response.status,
            data: response.data
        });

        return response;

    } catch (err) {
        console.error("OPSI forward failed:", err.message);

        // Enhance error message
        if (err.code === 'ECONNABORTED') {
            throw new Error(`OPSI API: Request timeout after 30s`);
        }

        if (err.response) {
            throw new Error(
                `OPSI API Error: ${err.response.status} - ${JSON.stringify(err.response.data)}`
            );
        }

        throw new Error(`OPSI API Failure: ${err.message}`);
    }
}
