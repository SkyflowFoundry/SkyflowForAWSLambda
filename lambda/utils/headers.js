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

module.exports = {
    getHeader,
    getHeaders
};
