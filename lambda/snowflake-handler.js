/**
 * Snowflake External Function Handler
 *
 * Handles Snowflake external function requests with proper format:
 * Request:  {"data": [[rowNum, value], [rowNum, value], ...]}
 * Response: {"data": [[rowNum, result], [rowNum, result], ...]}
 *
 * Extracts configuration from Snowflake custom headers:
 * - sf-custom-operation (required) - "tokenize" or "detokenize"
 * - sf-custom-cluster-id (required)
 * - sf-custom-vault-id (required)
 * - sf-custom-table (required for tokenize)
 * - sf-custom-column-name (required for tokenize)
 */

const SkyflowClient = require('./skyflow-client');
const config = require('./config');
const { SkyflowError } = require('skyflow-node');

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
            console.log('Initializing Skyflow client...');
            skyflowClient = new SkyflowClient(config);
            console.log('Skyflow client initialized');
        }

        // Extract Snowflake headers (case-insensitive)
        const headers = event.headers || {};
        const sfHeaders = extractSnowflakeHeaders(headers);

        // Log Snowflake metadata
        console.log('Snowflake metadata:', {
            batchId: sfHeaders.batchId,
            queryId: sfHeaders.queryId,
            formatVersion: sfHeaders.formatVersion
        });

        // Parse request body (Snowflake format)
        const body = JSON.parse(event.body || '{}');
        const rows = body.data || [];

        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error('Invalid Snowflake request: data array is empty or missing');
        }

        console.log(`Processing ${rows.length} rows`);

        // Validate required headers
        if (!sfHeaders.clusterId) {
            throw new Error('Missing required header: sf-custom-cluster-id');
        }
        if (!sfHeaders.vaultId) {
            throw new Error('Missing required header: sf-custom-vault-id');
        }

        // Determine operation from header
        const operation = sfHeaders.operation;
        if (!operation) {
            throw new Error('Missing required header: sf-custom-operation (must be "tokenize" or "detokenize")');
        }
        if (operation !== 'tokenize' && operation !== 'detokenize') {
            throw new Error(`Invalid operation: ${operation}. Must be "tokenize" or "detokenize"`);
        }

        console.log(`Operation: ${operation}`);

        const startTime = Date.now();
        let result;

        if (operation === 'tokenize') {
            result = await handleTokenize(rows, sfHeaders, skyflowClient);
        } else {
            result = await handleDetokenize(rows, sfHeaders, skyflowClient);
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
async function handleTokenize(rows, sfHeaders, client) {
    const { clusterId, vaultId, table, columnName } = sfHeaders;

    if (!table) {
        throw new Error('Missing required header: sf-custom-table (required for tokenize)');
    }
    if (!columnName) {
        throw new Error('Missing required header: sf-custom-column-name (required for tokenize)');
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
async function handleDetokenize(rows, sfHeaders, client) {
    const { clusterId, vaultId } = sfHeaders;

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
 * Extract Snowflake headers (case-insensitive)
 */
function extractSnowflakeHeaders(headers) {
    const getHeader = (name) => {
        const lowerName = name.toLowerCase();
        const key = Object.keys(headers).find(k => k.toLowerCase() === lowerName);
        return key ? headers[key] : null;
    };

    return {
        // Custom headers (configuration)
        operation: getHeader('sf-custom-operation'),
        clusterId: getHeader('sf-custom-cluster-id'),
        vaultId: getHeader('sf-custom-vault-id'),
        table: getHeader('sf-custom-table'),
        columnName: getHeader('sf-custom-column-name'), // Optional

        // Snowflake metadata headers
        batchId: getHeader('sf-external-function-query-batch-id'),
        queryId: getHeader('sf-external-function-current-query-id'),
        formatVersion: getHeader('sf-external-function-format-version')
    };
}
