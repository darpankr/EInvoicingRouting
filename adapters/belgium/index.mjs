import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { safeToUpperCase } from "../../core/utils.js";
import * as Entity2012 from './Entity2012.js';
import * as Entity2045 from './Entity2045.js';
import * as Entity2047 from './Entity2047.js';

// =========================================================================
// DYNAMODB CLIENT FOR INTERCOMPANY LOOKUP
// =========================================================================
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION_NAME });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const IC_TABLE = "IntercompanyEntities";

// =========================================================================
// INTERCOMPANY CACHE (to reduce DynamoDB costs)
// =========================================================================
let IC_CACHE = null;
let LAST_CACHE_REFRESH = 0;
const CACHE_TTL = 60 * 60 * 1000; // Refresh once per hour (1 hour)

async function getIntercompanyList() {
    const now = Date.now();

    // Use cache if it exists and hasn't expired
    if (IC_CACHE && (now - LAST_CACHE_REFRESH < CACHE_TTL)) {
        console.log("Using cached intercompany list.");
        return IC_CACHE;
    }

    console.log("Refreshing intercompany list from DynamoDB...");
    
    try {
        const data = await docClient.send(new ScanCommand({ 
            TableName: IC_TABLE 
        }));

        // Transform DB array into a Set for O(1) fast lookup
        IC_CACHE = new Set(
            data.Items.map(item => String(item.entity_number))
        );
        
        LAST_CACHE_REFRESH = now;
        console.log(`Intercompany list refreshed. Total entities: ${IC_CACHE.size}`);
        
        return IC_CACHE;
    } catch (err) {
        console.error(`Failed to fetch intercompany list: ${err.message}`);
        
        // If cache exists, use stale cache rather than failing
        if (IC_CACHE) {
            console.warn("Using stale intercompany cache due to DynamoDB error.");
            return IC_CACHE;
        }
        
        // No cache available - return empty set
        console.warn("No intercompany cache available. Assuming no IC entities.");
        return new Set();
    }
}

// =========================================================================
// MAIN ROUTING FUNCTION FOR BELGIUM
// =========================================================================
export async function routeTransaction(payload, webhookBody) {
    const direction = safeToUpperCase(payload.direction);
    const icList = await getIntercompanyList();

    let entityNumber;
    let counterpartyEntityNumber;

    // Determine entity and counterparty based on direction
    if (direction === 'RECEIVED') {
        // AP Transaction: We are the customer receiving the invoice
        entityNumber = payload.customer?.entity_number
                    || payload.customer?.tax_information?.tax_number
                    || '';
        counterpartyEntityNumber = String(payload.supplier?.entity_number
                                || payload.supplier?.tax_information?.tax_number
                                || ''

        );
    } else if (direction === 'SENT') {
        // AR Transaction: We are the supplier sending the invoice
        entityNumber = payload.supplier?.entity_number
                    || payload.supplier?.tax_information?.tax_number
                    || '';
        counterpartyEntityNumber = String(payload.customer?.entity_number
                                || payload.customer?.tax_information?.tax_number
                                || ''
        );
    } else {
        throw new Error(`Routing Error: Invalid direction '${direction}'. Expected 'RECEIVED' or 'SENT'`);
    }

    // Validate entity number
    if (!entityNumber) {
        throw new Error(`Routing Error: Could not determine entity number from payload for direction - ${direction}`);
    }

    // Determine if this is an intercompany transaction
    const isIC = icList.has(counterpartyEntityNumber);

    // Determine transaction type
    let trType;
    if (direction === 'RECEIVED') {
        trType = 'AP'; // Accounts Payable
    } else {
        trType = isIC ? 'IC-AR' : 'AR'; // Intercompany AR or regular AR
    }

    console.log(`[Belgium Routing] Entity: ${entityNumber} | Type: ${trType} | IC: ${isIC} | Direction: ${direction}`);

    // Map entity numbers to their handlers
    const handlers = {
        '0422317610': Entity2012.handleRoute,  // Entity 2012
        'BE0422317610': Entity2012.handleRoute,         // Alternative format
        '0885436190': Entity2045.handleRoute,  // Entity 2045
        'BE0885436190': Entity2045.handleRoute,         // Alternative format
        '0885540417': Entity2047.handleRoute,  // Entity 2047
        'BE0885540417': Entity2047.handleRoute          // Alternative format
    };

    const targetHandler = handlers[String(entityNumber)];

    if (!targetHandler) {
        throw new Error(
            `Routing Error: Entity '${entityNumber}' not configured for Belgium. ` +
            `Supported entities: 0422317610 (2012), 0885436190 (2045), 0885540417 (2047)`
        );
    }

    // Delegate to the specific entity handler
    return await targetHandler(payload, webhookBody, trType);
}
