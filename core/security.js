import axios from 'axios';
import crypto from 'crypto';
import { jwtVerify, createRemoteJWKSet } from 'jose';

// =========================================================================
// FONOA SECURITY CONFIGURATION
// =========================================================================
const FONOA_OIDC_URL = 'https://fit-passport.fonoa.com';
const FONOA_AUDIENCE = 'webhook';

// Global JWKS (JSON Web Key Set) cache
let JWKS = null;

// =========================================================================
// INITIALIZE JWKS (called during cold start)
// =========================================================================
export async function initializeJwks() {
    try {
        console.log("Initializing JWKS from Fonoa OIDC...");
        const response = await axios.get(`${FONOA_OIDC_URL}/.well-known/openid-configuration`);
        JWKS = createRemoteJWKSet(new URL(response.data.jwks_uri));
        console.log("JWKS initialized successfully.");
    } catch (e) {
        throw new Error(`AWS Initialization: OIDC Discovery failed. ${e.message}`);
    }
}

// =========================================================================
// VERIFY FONOA WEBHOOK TOKEN
// =========================================================================
export async function verifyFonoaToken(token, rawBody, parsedBody) {
    try {
        // 1. Verify JWT signature and extract payload
        const { payload } = await jwtVerify(token, JWKS, { 
            audience: FONOA_AUDIENCE 
        });

        // 2. Extract Fonoa's custom claim
        const info = payload['passport.fonoa.com/v1/info'];
        
        if (!info?.sha256_checksum) {
            throw new Error("Fonoa Security: Missing checksum in token");
        }

        // 3. Compute local checksum of the request body
        const localChecksum = crypto
            .createHash('sha256')
            .update(rawBody, 'utf8')
            .digest('hex');

        // 4. Verify checksum matches
        if (localChecksum !== info.sha256_checksum) {
            throw new Error("Fonoa Security: Checksum mismatch - body may have been tampered");
        }

        console.log("Token verified and checksum validated.");
        
        return { 
            resourceUrl: parsedBody.resource_url,
            verified: true 
        };

    } catch (err) {
        // Re-throw with better error context
        if (err.message.includes("Fonoa Security")) {
            throw err;
        }
        throw new Error(`Fonoa Security: Token verification failed. ${err.message}`);
    }
}
