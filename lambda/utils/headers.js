/**
 * Header Utilities
 *
 * Shared utilities for extracting and validating HTTP headers
 */

/**
 * Extract a header value in a case-insensitive manner
 *
 * @param {Object} headers - The headers object from the Lambda event
 * @param {string} name - The header name to search for (case-insensitive)
 * @returns {string|null} The header value if found, null otherwise
 *
 * @example
 * const headers = { 'X-Skyflow-Operation': 'tokenize', 'content-type': 'application/json' };
 * getHeader(headers, 'x-skyflow-operation'); // returns 'tokenize'
 * getHeader(headers, 'X-SKYFLOW-OPERATION'); // returns 'tokenize'
 * getHeader(headers, 'missing-header');      // returns null
 */
function getHeader(headers, name) {
    if (!headers || typeof headers !== 'object') {
        return null;
    }

    const lowerName = name.toLowerCase();
    const key = Object.keys(headers).find(k => k.toLowerCase() === lowerName);
    return key ? headers[key] : null;
}

/**
 * Extract multiple headers at once
 *
 * @param {Object} headers - The headers object from the Lambda event
 * @param {Array<string>} names - Array of header names to extract
 * @returns {Object} Object with header names as keys and values
 *
 * @example
 * const headers = { 'X-Skyflow-Operation': 'tokenize', 'X-Skyflow-Vault-ID': 'abc' };
 * getHeaders(headers, ['x-skyflow-operation', 'x-skyflow-vault-id']);
 * // returns { 'x-skyflow-operation': 'tokenize', 'x-skyflow-vault-id': 'abc' }
 */
function getHeaders(headers, names) {
    const result = {};
    for (const name of names) {
        const value = getHeader(headers, name);
        if (value !== null) {
            result[name] = value;
        }
    }
    return result;
}

/**
 * Extract all context headers (X-Skyflow-Context-* pattern)
 *
 * Extracts all headers matching the X-Skyflow-Context-* pattern and returns
 * them as a context object with camelCase keys.
 *
 * @param {Object} headers - The headers object from the Lambda event
 * @param {string} prefix - The header prefix to match (default: 'x-skyflow-context-')
 * @returns {Object} Object with context attributes
 *
 * @example
 * const headers = {
 *   'X-Skyflow-Context-User': 'john@example.com',
 *   'X-Skyflow-Context-Role': 'admin',
 *   'X-Skyflow-Context-IpAddress': '1.2.3.4',
 *   'X-Skyflow-Operation': 'tokenize'  // ignored
 * };
 * extractContextHeaders(headers);
 * // returns { user: 'john@example.com', role: 'admin', ipAddress: '1.2.3.4' }
 *
 * @example
 * // Snowflake format with sf-custom- prefix
 * const sfHeaders = {
 *   'sf-custom-X-Skyflow-Context-User': 'john@example.com',
 *   'sf-custom-X-Skyflow-Context-Role': 'admin'
 * };
 * extractContextHeaders(sfHeaders, 'sf-custom-x-skyflow-context-');
 * // returns { user: 'john@example.com', role: 'admin' }
 */
function extractContextHeaders(headers, prefix = 'x-skyflow-context-') {
    if (!headers || typeof headers !== 'object') {
        return {};
    }

    const context = {};
    const lowerPrefix = prefix.toLowerCase();

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();

        if (lowerKey.startsWith(lowerPrefix)) {
            // Extract the attribute name after the prefix
            const attrName = key.substring(prefix.length);

            // Convert to camelCase (e.g., "IpAddress" -> "ipAddress")
            const camelCaseKey = attrName.charAt(0).toLowerCase() + attrName.slice(1);

            context[camelCaseKey] = value;
        }
    }

    return context;
}

module.exports = {
    getHeader,
    getHeaders,
    extractContextHeaders
};
