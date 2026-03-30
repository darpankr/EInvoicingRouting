import { forwardToNetSuite } from '../../services/netsuite.js';
import { forwardToDARTS } from '../../services/darts.js';
import { extractSupplierId } from '../../core/utils.js';
// =========================================================================
// ENTITY 2047 (0885540417) ROUTING LOGIC
// =========================================================================
// Business Rules:
// - AR (Regular Accounts Receivable) → DARTS
// - AP (Accounts Payable) → NetSuite
// - IC-AR (Intercompany Accounts Receivable) → NetSuite
// =========================================================================

// =========================================================================
// EXTRACT SUPPLIER ID FROM PAYLOAD
// =========================================================================

export async function handleRoute(payload, webhookBody, trType) {
    console.log(`[Entity 2047] Handling transaction type: ${trType} and event type: ${webhookBody.event_type}`);

    const supplierId = extractSupplierId(payload);
    console.log(`Environment: NON-PROD - Supplier ID: ${supplierId}`);

    switch (trType) {
        case 'AR':
            console.log("[Entity 2047] Routing AR transaction to DARTS");
            return await forwardToDARTS(webhookBody, supplierId);

        case 'AP':
            console.log("[Entity 2047] Routing AP transaction to NetSuite");
            return await forwardToNetSuite(payload, "AP201220452047");

        case 'IC-AR':
            console.log("[Entity 2047] Routing IC-AR transaction to NetSuite");
            return await forwardToNetSuite(payload, "ICAR201220452047"); //UPDATED - MARCH 26

        default:
            throw new Error(
                `Entity 2047 Logic Error: Unsupported transaction type '${trType}'. ` +
                `Supported types: AR, AP, IC-AR`
            );
    }
}
