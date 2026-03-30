import axios from 'axios';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// =========================================================================
// SECRETS MANAGER CLIENT
// =========================================================================
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION_NAME });

// =========================================================================
// SECRETS CACHE - Separate cache for each secret manager
// =========================================================================
const SECRETS_CACHE = {
    FONOA: null,
    // Other systems will manage their own caches
};

// =========================================================================
// GENERIC SECRET LOADER - Used by all services
// =========================================================================
export async function loadSecret(secretName) {
    try {
        console.log(`Loading secret: ${secretName}`);
        const response = await secretsClient.send(
            new GetSecretValueCommand({ SecretId: secretName })
        );
        
        const parsed = JSON.parse(response.SecretString);
        
        // Trim all string values to avoid whitespace issues
        const trimmed = Object.fromEntries(
            Object.entries(parsed).map(([k, v]) => [
                k, 
                typeof v === 'string' ? v.trim() : v
            ])
        );
        
        console.log(`Secret loaded successfully: ${secretName}`);
        return trimmed;
    } catch (e) {
        throw new Error(`Failed to load secret '${secretName}': ${e.message}`);
    }
}

// =========================================================================
// LOAD FONOA SECRETS (with caching)
// =========================================================================
async function loadFonoaSecrets() {
    if (SECRETS_CACHE.FONOA) {
        console.log("Using cached Fonoa secrets");
        return SECRETS_CACHE.FONOA;
    }

    // const secretName = process.env.FONOA_SECRET_NAME || 'fonoa-secrets';
    const secretName = process.env.SECRET_NAME_FONOA || 'fonoa-secrets';
    SECRETS_CACHE.FONOA = await loadSecret(secretName);
    return SECRETS_CACHE.FONOA;
}

// =========================================================================
// FETCH FONOA RESOURCE
// =========================================================================
export async function fetchFonoaResource(resourceUrl) {
    try {
        // Ensure Fonoa secrets are loaded
        const secrets = await loadFonoaSecrets();

        const response = await axios.get(resourceUrl, {
            headers: {
                'Ocp-Apim-Subscription-Key': secrets.FONOA_API_KEY
            },
            timeout: 30000 // 30 second timeout
        });

        return response.data;
    } catch (err) {
        if (err.code === 'ECONNABORTED') {
            throw new Error(`Fonoa API: Request timeout after 30s. URL: ${resourceUrl}`);
        }
        throw new Error(`Fonoa API: Resource fetch failed. ${err.message}`);
    }
}