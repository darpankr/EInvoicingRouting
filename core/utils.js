export const EXTERNAL_API_TIMEOUT = 30000; // 30 seconds

export const withTimeout = (promise, ms, operation) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Timeout: ${operation} exceeded ${ms}ms`)), ms)
        )
    ]);
};

export function extractSupplierId(payload) {
    return payload?.supplier?.id ?? null;
}