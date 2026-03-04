import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// =========================================================================
// SECRETS MANAGER CLIENT
// =========================================================================
const secretsClient = new SecretsManagerClient({ 
    region: process.env.AWS_REGION_NAME 
});

// =========================================================================
// CACHE FOR ALL SECRETS (to reduce AWS API calls)
// =========================================================================
const SECRETS_CACHE = {};

// =========================================================================
// LOAD SECRET (with caching)
// =========================================================================
export async function loadSecret(secretName) {
    // Return cached secret if available
    if (SECRETS_CACHE[secretName]) {
        console.log(`Using cached secret: ${secretName}`);
        return SECRETS_CACHE[secretName];
    }

    console.log(`Loading secret from AWS Secrets Manager: ${secretName}`);

    try {
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const response = await secretsClient.send(command);

        if (!response.SecretString) {
            throw new Error(`Secret ${secretName} has no SecretString`);
        }

        // Parse and cache the secret
        const secret = JSON.parse(response.SecretString);
        SECRETS_CACHE[secretName] = secret;

        console.log(`Secret loaded successfully: ${secretName}`);
        return secret;

    } catch (err) {
        console.error(`Failed to load secret ${secretName}: ${err.message}`);
        throw new Error(`Failed to load secret ${secretName}: ${err.message}`);
    }
}

// =========================================================================
// CLEAR CACHE (useful for testing or forcing refresh)
// =========================================================================
export function clearSecretsCache() {
    Object.keys(SECRETS_CACHE).forEach(key => delete SECRETS_CACHE[key]);
    console.log("Secrets cache cleared");
}