import { forwardToNetSuite } from '../../services/netsuite.js';
import { forwardToOPSI } from '../../services/opsi.js';
import { extractSupplierId } from '../../core/utils.js';

// =========================================================================
// ENTITY 2012 (0422317610) ROUTING LOGIC
// =========================================================================
// Business Rules:
// - AP (Accounts Payable) → NetSuite
// - IC-AR (Intercompany Accounts Receivable) → NetSuite
// - AR (Regular Accounts Receivable) → OPSI
// =========================================================================

export async function handleRoute(payload, webhookBody, trType) {
    console.log(`[Entity 2012] Handling transaction type: ${trType} and event type: ${webhookBody.event_type}`);

    const supplierId = extractSupplierId(payload);
    console.log(`Environment: NON-PROD - Supplier ID: ${supplierId}`);

    switch (trType) {
        case 'AP':
            console.log("[Entity 2012] Routing AP transaction to NetSuite");
            return await forwardToNetSuite(payload, "AP201220452047");

        case 'IC-AR':
            console.log("[Entity 2012] Routing IC-AR transaction to NetSuite");
            return await forwardToNetSuite(payload, supplierId);

        case 'AR':
            console.log("[Entity 2012] Routing AR transaction to OPSI");
            return await forwardToOPSI(payload. supplierId);

        default:
            throw new Error(
                `Entity 2012 Logic Error: Unsupported transaction type '${trType}'. ` +
                `Supported types: AP, IC-AR, AR`
            );
    }
}
