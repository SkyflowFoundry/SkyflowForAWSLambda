/**
 * Skyflow Lambda API Handler
 *
 * Generic REST API wrapper for Skyflow SDK operations
 * Supports: tokenize, detokenize, query, BYOT
 */

const SkyflowClient = require('./skyflow-client');
const config = require('./config');
const { SkyflowError } = require('skyflow-node');

// Singleton client instance (reused across warm invocations)
let skyflowClient;

/**
 * Main Lambda handler
 * Routes requests to appropriate Skyflow operations
 */
exports.handler = async (event, context) => {
    console.log('Request:', {
        requestId: context.requestId,
        functionName: context.functionName,
        remainingTimeMs: context.getRemainingTimeInMillis()
    });

    try {
        // Initialize client on first invocation (singleton pattern)
        if (!skyflowClient) {
            console.log('Initializing Skyflow client...');
            skyflowClient = new SkyflowClient(config);
            console.log('Skyflow client initialized');
        }

        // Parse request body
        const body = JSON.parse(event.body || '{}');

        // Extract operation from header (case-insensitive)
        const headers = event.headers || {};
        const operation = (headers['x-operation'] || headers['X-Operation'] || '').toLowerCase();

        console.log(`Operation: ${operation}`);
        console.log(`Cluster ID: ${body.cluster_id || 'not specified'}`);
        console.log(`Vault ID: ${body.vault_id || 'not specified'}`);

        if (!body.cluster_id) {
            throw new Error('Missing required field: cluster_id');
        }
        if (!body.vault_id) {
            throw new Error('Missing required field: vault_id');
        }

        let result;
        const startTime = Date.now();

        switch (operation) {
            case 'tokenize':
                validateTokenizeRequest(body);
                result = await skyflowClient.tokenize(
                    body.cluster_id,
                    body.vault_id,
                    body.table,
                    body.records,
                    body.options || {}
                );
                break;

            case 'detokenize':
                validateDetokenizeRequest(body);
                result = await skyflowClient.detokenize(
                    body.cluster_id,
                    body.vault_id,
                    body.tokens,
                    body.options || {}
                );
                break;

            case 'query':
                validateQueryRequest(body);
                result = await skyflowClient.query(
                    body.cluster_id,
                    body.vault_id,
                    body.query
                );
                break;

            case 'tokenize-byot':
                validateTokenizeByotRequest(body);
                result = await skyflowClient.tokenizeByot(
                    body.cluster_id,
                    body.vault_id,
                    body.table,
                    body.records
                );
                break;

            default:
                throw new Error(`Unknown operation: ${operation}. Supported operations (via X-Operation header): tokenize, detokenize, query, tokenize-byot`);
        }

        const elapsed = Date.now() - startTime;
        console.log(`Operation completed in ${elapsed}ms`);

        // Include errors array for partial failure visibility
        const response = {
            success: true,
            data: result.data,
            metadata: {
                operation: operation,
                duration_ms: elapsed
            }
        };

        // Include errors if present (partial failures with continueOnError)
        if (result.errors && result.errors.length > 0) {
            response.errors = result.errors;
            console.warn(`Operation completed with ${result.errors.length} partial failures`);
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(response)
        };

    } catch (error) {
        // Comprehensive error handling with Skyflow-specific details
        if (error instanceof SkyflowError) {
            console.error('Skyflow API Error:', {
                http_code: error.error?.http_code,
                grpc_code: error.error?.grpc_code,
                message: error.message,
                details: error.error?.details,
                request_ID: error.error?.request_ID  // Useful for support tickets
            });

            return {
                statusCode: error.error?.http_code || 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: {
                        message: error.message,
                        type: 'SkyflowError',
                        http_code: error.error?.http_code,
                        grpc_code: error.error?.grpc_code,
                        details: error.error?.details,
                        request_ID: error.error?.request_ID
                    }
                })
            };
        } else {
            // Non-Skyflow errors (validation, parsing, etc.)
            console.error('Application Error:', error);
            console.error('Stack:', error.stack);

            return {
                statusCode: error.statusCode || 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
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
 * Request validation functions
 */
function validateTokenizeRequest(body) {
    if (!body.table) throw new Error('Missing required field: table');
    if (!body.records || !Array.isArray(body.records)) {
        throw new Error('Missing or invalid field: records (must be array)');
    }
    if (body.records.length === 0) {
        throw new Error('records array cannot be empty');
    }
    body.records.forEach((record, index) => {
        if (typeof record !== 'object' || record === null) {
            throw new Error(`records[${index}] must be an object with column names as keys`);
        }
        if (Object.keys(record).length === 0) {
            throw new Error(`records[${index}] cannot be empty - must contain at least one column`);
        }
    });
}

function validateDetokenizeRequest(body) {
    if (!body.tokens || !Array.isArray(body.tokens)) {
        throw new Error('Missing or invalid field: tokens (must be array)');
    }
    if (body.tokens.length === 0) {
        throw new Error('tokens array cannot be empty');
    }

    // Validate redactionType if provided (optional - if omitted, Skyflow governance decides)
    if (body.options && body.options.redactionType) {
        const validRedactionTypes = ['PLAIN_TEXT', 'MASKED', 'REDACTED', 'DEFAULT'];
        if (!validRedactionTypes.includes(body.options.redactionType)) {
            throw new Error(`Invalid redactionType: ${body.options.redactionType}. Must be one of: ${validRedactionTypes.join(', ')}, or omit for governance-controlled redaction`);
        }
    }
}

function validateQueryRequest(body) {
    if (!body.query || typeof body.query !== 'string') {
        throw new Error('Missing or invalid field: query (must be string)');
    }
}

function validateTokenizeByotRequest(body) {
    if (!body.table) throw new Error('Missing required field: table');
    if (!body.records || !Array.isArray(body.records)) {
        throw new Error('Missing or invalid field: records (must be array)');
    }
    if (body.records.length === 0) {
        throw new Error('records array cannot be empty');
    }
    body.records.forEach((record, index) => {
        if (!record.fields || typeof record.fields !== 'object') {
            throw new Error(`records[${index}] must have 'fields' object with column values`);
        }
        if (!record.tokens || typeof record.tokens !== 'object') {
            throw new Error(`records[${index}] must have 'tokens' object with custom token values`);
        }
        if (Object.keys(record.fields).length === 0) {
            throw new Error(`records[${index}].fields cannot be empty`);
        }
        if (Object.keys(record.tokens).length === 0) {
            throw new Error(`records[${index}].tokens cannot be empty`);
        }
        // Ensure fields and tokens have matching keys
        const fieldKeys = Object.keys(record.fields).sort();
        const tokenKeys = Object.keys(record.tokens).sort();
        if (fieldKeys.join(',') !== tokenKeys.join(',')) {
            throw new Error(`records[${index}] fields and tokens must have matching column names`);
        }
    });
}
