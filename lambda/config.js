/**
 * Configuration Loader
 *
 * Loads Skyflow credentials and settings from:
 * 1. Environment variables (production)
 * 2. skyflow-config.json file (development)
 *
 * Environment credential precedence: API key, JWT service account, bearer token.
 * Bearer tokens are passed through as-is and are not refreshed by this Lambda.
 *
 * Note: cluster_id is now provided in each API request headers, not in config
 */

const fs = require('fs');
const path = require('path');

function loadConfig() {
    let config = {};

    const hasEnvCredentials = process.env.SKYFLOW_API_KEY || process.env.SKYFLOW_CLIENT_ID || process.env.SKYFLOW_BEARER_TOKEN;

    if (hasEnvCredentials) {
        console.log('Loading config from environment variables');

        if (process.env.SKYFLOW_API_KEY) {
            config.credentials = {
                apiKey: process.env.SKYFLOW_API_KEY
            };
        } else if (process.env.SKYFLOW_CLIENT_ID) {
            config.credentials = {
                clientID: process.env.SKYFLOW_CLIENT_ID,
                clientName: process.env.SKYFLOW_CLIENT_NAME,
                tokenURI: process.env.SKYFLOW_TOKEN_URI,
                keyID: process.env.SKYFLOW_KEY_ID,
                privateKey: process.env.SKYFLOW_PRIVATE_KEY
            };
        } else if (process.env.SKYFLOW_BEARER_TOKEN?.startsWith('sky-')) {
            console.warn('SKYFLOW_BEARER_TOKEN appears to contain an API key; using API key authentication');
            config.credentials = {
                apiKey: process.env.SKYFLOW_BEARER_TOKEN
            };
        } else {
            config.credentials = {
                token: process.env.SKYFLOW_BEARER_TOKEN
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

    } else {
        console.log('Loading config from skyflow-config.json');

        const configPath = path.join(__dirname, 'skyflow-config.json');

        if (!fs.existsSync(configPath)) {
            throw new Error('Configuration not found. Set environment variables or create skyflow-config.json');
        }

        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        config.credentials = fileConfig.credentials;
        config.batching = fileConfig.batching || {};
    }

    if (!config.credentials) {
        throw new Error('Missing required config: credentials');
    }

    if (config.credentials.apiKey) {
        if (!config.credentials.apiKey.startsWith('sky-')) {
            console.warn('Warning: API key does not start with "sky-"');
        }
    } else if (config.credentials.token) {
        // Bearer token authentication is supported by the Skyflow SDK.
        if (typeof config.credentials.token !== 'string' || config.credentials.token.trim().length === 0) {
            throw new Error('Missing required bearer token in SKYFLOW_BEARER_TOKEN');
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
        authType: config.credentials.apiKey ? 'API_KEY' : config.credentials.token ? 'TOKEN' : 'JWT'
    });

    return config;
}

module.exports = loadConfig();
