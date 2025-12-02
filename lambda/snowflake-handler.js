/**
 * Snowflake External Function Handler
 *
 * Handles Snowflake external function requests with proper format:
 * Request:  {"data": [[rowNum, value], [rowNum, value], ...]}
 * Response: {"data": [[rowNum, result], [rowNum, result], ...]}
 *
 * IMPORTANT: Snowflake automatically prefixes all custom headers with 'sf-custom-'
 * When you define a header in Snowflake SQL as 'X-Skyflow-Operation',
 * Snowflake sends it as 'sf-custom-X-Skyflow-Operation'
 *
 * Headers to define in Snowflake SQL (without prefix):
 * - X-Skyflow-Operation (required) - "tokenize" or "detokenize"
 * - X-Skyflow-Cluster-ID (required)
 * - X-Skyflow-Vault-ID (required)
 * - X-Skyflow-Table (required for tokenize)
 * - X-Skyflow-Column-Name (required for tokenize)
 *
 * Handler looks for these with 'sf-custom-' prefix added by Snowflake.
 */

const SkyflowClient = require('./skyflow-client');
const config = require('./config');
const { SkyflowError } = require('skyflow-node');
const { getHeader } = require('./utils/headers');

// Singleton client instance (reused across warm invocations)
let skyflowClient;

/**
 * Main Snowflake handler - routes to tokenize or detokenize
 */
exports.handler = async (event, context) => {
    console.log('Snowflake request:', {
        requestId: context.requestId,
        path: event.path,
        remainingTimeMs: context.getRemainingTimeInMillis()
    });

    try {
        // Initialize client on first invocation
        if (!skyflowClient) {
            skyflowClient = new SkyflowClient(config);
        }

        // Extract headers (case-insensitive)
        const headers = event.headers || {};
        const requestConfig = extractHeaders(headers);

        // Parse request body (Snowflake format)
        const body = JSON.parse(event.body || '{}');
        const rows = body.data || [];

        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error('Invalid request: data array is empty or missing');
        }

        // Validate required headers
        if (!requestConfig.clusterId) {
            throw new Error('Missing required header: X-Skyflow-Cluster-ID');
        }
        if (!requestConfig.vaultId) {
            throw new Error('Missing required header: X-Skyflow-Vault-ID');
        }

        // Determine operation from header
        const operation = requestConfig.operation;
        if (!operation) {
            throw new Error('Missing required header: X-Skyflow-Operation (must be "tokenize" or "detokenize")');
        }
        if (operation !== 'tokenize' && operation !== 'detokenize') {
            throw new Error(`Invalid operation: ${operation}. Must be "tokenize" or "detokenize"`);
        }

        const startTime = Date.now();
        let result;

        if (operation === 'tokenize') {
            result = await handleTokenize(rows, requestConfig, skyflowClient);
        } else {
            result = await handleDetokenize(rows, requestConfig, skyflowClient);
        }

        const elapsed = Date.now() - startTime;
        console.log(`Operation completed in ${elapsed}ms`);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: result })
        };

    } catch (error) {
        console.error('Error:', error);
        console.error('Stack:', error.stack);

        // Snowflake expects 200 with error details, or proper error codes
        if (error instanceof SkyflowError) {
            console.error('Skyflow API Error:', {
                http_code: error.error?.http_code,
                grpc_code: error.error?.grpc_code,
                message: error.message,
                request_ID: error.error?.request_ID
            });

            return {
                statusCode: error.error?.http_code || 500,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: {
                        message: error.message,
                        type: 'SkyflowError',
                        http_code: error.error?.http_code,
                        request_ID: error.error?.request_ID
                    }
                })
            };
        } else {
            return {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: {
                        message: error.message,
                        type: error.name || 'Error'
                    }
                })
            };
        }
    }
};

/**
 * Handle tokenize operation
 * Converts plaintext values to tokens
 */
async function handleTokenize(rows, requestConfig, client) {
    const { clusterId, vaultId, table, columnName } = requestConfig;

    if (!table) {
        throw new Error('Missing required header: X-Skyflow-Table (required for tokenize)');
    }
    if (!columnName) {
        throw new Error('Missing required header: X-Skyflow-Column-Name (required for tokenize)');
    }

    console.log(`Tokenize: cluster=${clusterId}, vault=${vaultId}, table=${table}, column=${columnName}, count=${rows.length}`);

    // Extract row numbers and values
    const rowNumbers = rows.map(row => row[0]);
    const values = rows.map(row => row[1]);

    // Build records for Skyflow (single column)
    const records = values.map(val => ({ [columnName]: val }));

    // Call Skyflow tokenize
    const response = await client.tokenize(clusterId, vaultId, table, records, {});

    // Extract tokens from response (Skyflow preserves order)
    const tokens = response.data.map(record => record[columnName]);

    // Build Snowflake response format: [[rowNum, token], ...]
    return rowNumbers.map((rowNum, index) => [rowNum, tokens[index]]);
}

/**
 * Handle detokenize operation
 * Converts tokens to plaintext values
 */
async function handleDetokenize(rows, requestConfig, client) {
    const { clusterId, vaultId } = requestConfig;

    console.log(`Detokenize: cluster=${clusterId}, vault=${vaultId}, count=${rows.length}`);

    // Extract row numbers and tokens
    const rowNumbers = rows.map(row => row[0]);
    const tokens = rows.map(row => row[1]);

    // Call Skyflow detokenize
    const response = await client.detokenize(clusterId, vaultId, tokens, {});

    // Extract plaintext values from response (Skyflow preserves order)
    const values = response.data.map(record => record.value);

    // Build Snowflake response format: [[rowNum, value], ...]
    return rowNumbers.map((rowNum, index) => [rowNum, values[index]]);
}

/**
 * Extract headers (case-insensitive)
 *
 * Note: Snowflake automatically prefixes custom headers with 'sf-custom-'
 * For example, if you define HEADERS = ('X-Skyflow-Operation' = 'tokenize'),
 * Snowflake will send the header as 'sf-custom-X-Skyflow-Operation'
 */
function extractHeaders(headers) {
    return {
        operation: getHeader(headers, 'sf-custom-x-skyflow-operation'),
        clusterId: getHeader(headers, 'sf-custom-x-skyflow-cluster-id'),
        vaultId: getHeader(headers, 'sf-custom-x-skyflow-vault-id'),
        table: getHeader(headers, 'sf-custom-x-skyflow-table'),
        columnName: getHeader(headers, 'sf-custom-x-skyflow-column-name')
    };
}
