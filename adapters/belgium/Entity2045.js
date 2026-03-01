import { forwardToNetSuite } from '../../services/netsuite.js';
import { extractSupplierId } from '../../core/utils.js';

// =========================================================================
// ENTITY 2045 (0885436190) ROUTING LOGIC
// =========================================================================
// Business Rules:
// - AP (Accounts Payable) → NetSuite
// - Currently only handles AP transactions
// - AR/IC-AR can be added later if needed
// =========================================================================

export async function handleRoute(payload, webhookBody, trType) {
    console.log(`[Entity 2045] Handling transaction type: ${trType} and event type: ${webhookBody.event_type}`);

    const supplierId = extractSupplierId(payload);
    console.log(`Environment: NON-PROD - Supplier ID: ${supplierId}`);

    switch (trType) {
        case 'AP':
            console.log("[Entity 2045] Routing AP transaction to NetSuite");
            return await forwardToNetSuite(payload, "AP201220452047");

        default:
            throw new Error(
                `Entity 2045 Logic Error: Unsupported transaction type '${trType}'. ` +
                `Currently only 'AP' transactions are supported for this entity. ` +
                `If you need to add AR/IC-AR support, update this handler.`
            );
    }
}
