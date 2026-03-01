import * as Belgium from '../adapters/belgium/index.mjs';

// =========================================================================
// COUNTRY REGISTRY
// =========================================================================
// This registry maps country codes to their respective routing adapters.
// Each adapter implements the routeTransaction(payload) function.
//
// To add a new country:
// 1. Create a new adapter folder: adapters/[country]/
// 2. Implement index.mjs with routeTransaction() function
// 3. Add the import and mapping below
// =========================================================================

export const CountryRegistry = {
    'BE': Belgium,      // Belgium
    'BEL': Belgium,     // Alternative code
    // Add more countries here as needed:
    // 'DE': Germany,
    // 'FR': France,
    // 'NL': Netherlands,
};

// =========================================================================
// HELPER FUNCTION TO LIST SUPPORTED COUNTRIES
// =========================================================================
export function getSupportedCountries() {
    return Object.keys(CountryRegistry);
}

// =========================================================================
// HELPER FUNCTION TO VALIDATE COUNTRY CODE
// =========================================================================
export function isCountrySupported(countryCode) {
    return countryCode && CountryRegistry[countryCode.toUpperCase()] !== undefined;
}
