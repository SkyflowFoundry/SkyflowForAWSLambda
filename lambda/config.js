/**
 * Configuration Loader
 *
 * Loads Skyflow credentials and settings from:
 * 1. Environment variables (production)
 * 2. skyflow-config.json file (development)
 *
 * Note: cluster_id is now provided in each API request headers, not in config
 */

const fs = require('fs');
const path = require('path');

/**
 * Extract context attributes from environment variables
 * Looks for SKYFLOW_CONTEXT_* pattern and converts to camelCase keys
 *
 * @returns {Object} Context object with camelCase keys
 *
 * @example
 * // Environment variables:
 * // SKYFLOW_CONTEXT_SOURCE=lambda
 * // SKYFLOW_CONTEXT_FUNCTION_NAME=my-function
 * extractContextFromEnv();
 * // returns { source: 'lambda', functionName: 'my-function' }
 */
function extractContextFromEnv() {
    const context = {};
    const prefix = 'SKYFLOW_CONTEXT_';

    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(prefix)) {
            // Extract the attribute name after the prefix
            const attrName = key.substring(prefix.length);

            // Convert UPPER_SNAKE_CASE to camelCase
            // e.g., FUNCTION_NAME -> functionName, SOURCE -> source
            const camelCaseKey = attrName
                .toLowerCase()
                .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

            context[camelCaseKey] = value;
        }
    }

    return context;
}

function loadConfig() {
    let config = {};

    if (process.env.SKYFLOW_API_KEY || process.env.SKYFLOW_CLIENT_ID) {
        console.log('Loading config from environment variables');

        if (process.env.SKYFLOW_API_KEY) {
            config.credentials = {
                apiKey: process.env.SKYFLOW_API_KEY
            };
        } else {
            config.credentials = {
                clientID: process.env.SKYFLOW_CLIENT_ID,
                clientName: process.env.SKYFLOW_CLIENT_NAME,
                tokenURI: process.env.SKYFLOW_TOKEN_URI,
                keyID: process.env.SKYFLOW_KEY_ID,
                privateKey: process.env.SKYFLOW_PRIVATE_KEY
            };
        }

        config.batching = {
            tokenize: {
                batchSize: parseInt(process.env.TOKENIZE_BATCH_SIZE || '25'),
                maxConcurrency: parseInt(process.env.TOKENIZE_MAX_CONCURRENCY || '5')
            },
            detokenize: {
                batchSize: parseInt(process.env.DETOKENIZE_BATCH_SIZE || '25'),
                maxConcurrency: parseInt(process.env.DETOKENIZE_MAX_CONCURRENCY || '5')
            }
        };

        // Extract static context from environment variables (SKYFLOW_CONTEXT_* pattern)
        config.context = extractContextFromEnv();

    } else {
        console.log('Loading config from skyflow-config.json');

        const configPath = path.join(__dirname, 'skyflow-config.json');

        if (!fs.existsSync(configPath)) {
            throw new Error('Configuration not found. Set environment variables or create skyflow-config.json');
        }

        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        config.credentials = fileConfig.credentials;
        config.batching = fileConfig.batching || {};
        config.context = fileConfig.context || {};
    }

    if (!config.credentials) {
        throw new Error('Missing required config: credentials');
    }

    if (config.credentials.apiKey) {
        if (!config.credentials.apiKey.startsWith('sky-')) {
            console.warn('Warning: API key does not start with "sky-"');
        }
    } else {
        const requiredJwtFields = ['clientID', 'clientName', 'tokenURI', 'keyID', 'privateKey'];
        for (const field of requiredJwtFields) {
            if (!config.credentials[field]) {
                throw new Error(`Missing required JWT credential: ${field}`);
            }
        }
    }

    console.log('Configuration loaded successfully', {
        authType: config.credentials.apiKey ? 'API_KEY' : 'JWT',
        hasContext: Object.keys(config.context || {}).length > 0,
        contextKeys: Object.keys(config.context || {})
    });

    return config;
}

module.exports = loadConfig();
