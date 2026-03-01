// =========================================================================
// GENERAL UTILITIES
// =========================================================================
export function extractSupplierId(payload) {
    return payload?.supplier?.id ?? null;
}
