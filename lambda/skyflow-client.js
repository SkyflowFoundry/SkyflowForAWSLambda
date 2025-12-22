/**
 * Skyflow Client - Pure SDK Wrapper
 *
 * Provides clean interface to Skyflow SDK operations
 * No custom preprocessing or transformations - direct pass-through to SDK
 */

const { Skyflow, InsertRequest, InsertOptions, DetokenizeRequest, DetokenizeOptions, QueryRequest, TokenMode, RedactionType, LogLevel, SkyflowError } = require('skyflow-node');

class SkyflowClient {
    /**
     * Initialize Skyflow client
     * @param {Object} config - Configuration object with credentials and settings
     */
    constructor(config) {
        this.config = config;
        this.credentials = config.credentials;
        this.batching = config.batching || {};

        // Cache SDK clients per cluster+vault ID for performance
        this.clients = {};

        console.log('SkyflowClient initialized', {
            authType: this.credentials.apiKey ? 'API_KEY' : 'JWT'
        });
    }

    /**
     * Get or initialize SDK client for a specific cluster, vault, and environment
     * @private
     */
    _getClient(clusterId, vaultId, env = 'PROD') {
        // Validate environment
        const validEnvironments = ['SANDBOX', 'PROD'];
        if (!validEnvironments.includes(env)) {
            throw new Error(`Invalid environment: ${env}. Must be one of: ${validEnvironments.join(', ')}`);
        }

        const clientKey = `${clusterId}:${vaultId}:${env}`;

        if (!this.clients[clientKey]) {
            console.log(`Initializing Skyflow client: cluster=${clusterId}, vault=${vaultId}, env=${env}`);

            let credentials;
            if (this.credentials.apiKey) {
                credentials = {
                    apiKey: this.credentials.apiKey
                };
            } else {
                credentials = {
                    credentialsString: JSON.stringify(this.credentials)
                };
            }

            const vaultConfig = {
                vaultId: vaultId,
                clusterId: clusterId,
                env: env,
                credentials: credentials
            };

            const skyflowConfig = {
                vaultConfigs: [vaultConfig],
                logLevel: LogLevel.ERROR  // Recommended for production
            };

            this.clients[clientKey] = new Skyflow(skyflowConfig);
        }

        return this.clients[clientKey];
    }

    /**
     * Tokenize records (multi-column support)
     *
     * @param {string} clusterId - Skyflow cluster ID
     * @param {string} vaultId - Skyflow vault ID
     * @param {string} table - Table name in vault
     * @param {Array} records - Array of record objects with column names as keys
     *                          Example: [{email: "test@example.com", name: "John Doe"}]
     * @param {Object} options - Options object supporting:
     *                          - {upsert: "email"} - Upsert by single column (recommended)
     *                          - {upsert: ["email"]} - Array format (only first column used, SDK limitation)
     *                          Note: SDK only supports single-column upsert
     * @param {string} env - Skyflow environment (SANDBOX or PROD), defaults to PROD
     * @returns {Promise<Array>} Array of tokenized records with all columns
     */
    async tokenize(clusterId, vaultId, table, records, options = {}, env = 'PROD') {
        const columnNames = records.length > 0 ? Object.keys(records[0]) : [];
        const batchSize = this.batching?.tokenize?.batchSize || 25;

        console.log(`Tokenize: cluster=${clusterId}, vault=${vaultId}, env=${env}, table=${table}, columns=[${columnNames.join(', ')}], count=${records.length}, batchSize=${batchSize}`);

        // If records fit in one batch, process directly
        if (records.length <= batchSize) {
            return await this._tokenizeBatch(clusterId, vaultId, table, records, options, env);
        }

        // Split into batches and process
        const batches = [];
        for (let i = 0; i < records.length; i += batchSize) {
            batches.push(records.slice(i, i + batchSize));
        }

        console.log(`Processing ${batches.length} batches...`);

        // Process all batches
        const results = [];
        const errors = [];

        for (let i = 0; i < batches.length; i++) {
            try {
                const batchResult = await this._tokenizeBatch(clusterId, vaultId, table, batches[i], options, env);
                results.push(...(batchResult.data || []));
                if (batchResult.errors) {
                    errors.push(...batchResult.errors);
                }
            } catch (error) {
                // If a batch fails, collect the error and continue
                console.error(`Batch ${i + 1}/${batches.length} failed:`, error.message);
                throw error; // Fail fast on batch error
            }
        }

        return {
            data: results,
            errors: errors.length > 0 ? errors : null
        };
    }

    /**
     * Process a single batch of tokenization
     * @private
     */
    async _tokenizeBatch(clusterId, vaultId, table, records, options = {}, env = 'PROD') {
        const client = this._getClient(clusterId, vaultId, env);

        const insertRequest = new InsertRequest(table, records);
        const insertOptions = new InsertOptions();
        insertOptions.setReturnTokens(true);

        if (options.upsert) {
            if (typeof options.upsert === 'string') {
                insertOptions.setUpsertColumn(options.upsert);
            } else if (Array.isArray(options.upsert) && options.upsert.length > 0) {
                // Use first column only (SDK limitation)
                insertOptions.setUpsertColumn(options.upsert[0]);
            }
        }
        insertOptions.setContinueOnError(false);

        try {
            const response = await client.vault(vaultId).insert(insertRequest, insertOptions);

            // Return both data and errors for partial failure handling
            return {
                data: response.insertedFields || [],
                errors: response.errors || null
            };
        } catch (error) {
            if (error instanceof SkyflowError) {
                console.error('Tokenize error (Skyflow):', {
                    http_code: error.error?.http_code,
                    grpc_code: error.error?.grpc_code,
                    message: error.message,
                    details: error.error?.details,
                    request_ID: error.error?.request_ID
                });
            } else {
                console.error('Tokenize error (Unexpected):', error.message);
            }
            throw new Error(`Tokenization failed: ${error.message}`);
        }
    }

    /**
     * Detokenize tokens (vault-level operation, no table/column needed)
     *
     * @param {string} clusterId - Skyflow cluster ID
     * @param {string} vaultId - Skyflow vault ID
     * @param {Array} tokens - Array of token strings
     * @param {Object} options - Options object supporting:
     *                          - {redactionType: "PLAIN_TEXT"} - Returns unmasked data
     *                          - {redactionType: "MASKED"} - Returns masked data
     *                          - {redactionType: "REDACTED"} - Returns redacted data
     *                          - {redactionType: "DEFAULT"} - Uses default redaction
     *                          - Omit redactionType to let Skyflow's governance engine decide
     * @param {string} env - Skyflow environment (SANDBOX or PROD), defaults to PROD
     * @returns {Promise<Object>} Object with data array and errors array
     */
    async detokenize(clusterId, vaultId, tokens, options = {}, env = 'PROD') {
        const redactionType = options.redactionType;
        const batchSize = this.batching?.detokenize?.batchSize || 25;

        console.log(`Detokenize: cluster=${clusterId}, vault=${vaultId}, env=${env}, count=${tokens.length}, batchSize=${batchSize}, redactionType=${redactionType || 'governance-controlled'}`);

        // If tokens fit in one batch, process directly
        if (tokens.length <= batchSize) {
            return await this._detokenizeBatch(clusterId, vaultId, tokens, options, env);
        }

        // Split into batches and process
        const batches = [];
        for (let i = 0; i < tokens.length; i += batchSize) {
            batches.push(tokens.slice(i, i + batchSize));
        }

        console.log(`Processing ${batches.length} batches...`);

        // Process all batches
        const results = [];
        const errors = [];

        for (let i = 0; i < batches.length; i++) {
            try {
                const batchResult = await this._detokenizeBatch(clusterId, vaultId, batches[i], options, env);
                results.push(...(batchResult.data || []));
                if (batchResult.errors) {
                    errors.push(...batchResult.errors);
                }
            } catch (error) {
                // If a batch fails, collect the error and continue
                console.error(`Batch ${i + 1}/${batches.length} failed:`, error.message);
                throw error; // Fail fast on batch error
            }
        }

        return {
            data: results,
            errors: errors.length > 0 ? errors : null
        };
    }

    /**
     * Process a single batch of detokenization
     * @private
     */
    async _detokenizeBatch(clusterId, vaultId, tokens, options = {}, env = 'PROD') {
        const redactionType = options.redactionType;
        const client = this._getClient(clusterId, vaultId, env);

        // Only set redactionType if explicitly provided, otherwise let Skyflow governance decide
        const detokenizeData = tokens.map(token => {
            const data = { token: token };

            if (redactionType) {
                // Map string to enum
                data.redactionType = RedactionType[redactionType] || RedactionType.PLAIN_TEXT;
            }

            return data;
        });

        const detokenizeRequest = new DetokenizeRequest(detokenizeData);
        const detokenizeOptions = new DetokenizeOptions();
        detokenizeOptions.setContinueOnError(true);

        try {
            const response = await client.vault(vaultId).detokenize(detokenizeRequest, detokenizeOptions);

            // Return both data and errors for partial failure handling
            return {
                data: (response.detokenizedFields || []).map(record => ({
                    token: record.token,
                    value: record.value
                })),
                errors: response.errors || null
            };
        } catch (error) {
            if (error instanceof SkyflowError) {
                console.error('Detokenize error (Skyflow):', {
                    http_code: error.error?.http_code,
                    grpc_code: error.error?.grpc_code,
                    message: error.message,
                    details: error.error?.details,
                    request_ID: error.error?.request_ID
                });
            } else {
                console.error('Detokenize error (Unexpected):', error.message);
            }
            throw new Error(`Detokenization failed: ${error.message}`);
        }
    }

    /**
     * Query vault data
     *
     * @param {string} clusterId - Skyflow cluster ID
     * @param {string} vaultId - Skyflow vault ID
     * @param {string} sqlQuery - SQL query string
     * @param {string} env - Skyflow environment (SANDBOX or PROD), defaults to PROD
     * @returns {Promise<Array>} Array of query results
     */
    async query(clusterId, vaultId, sqlQuery, env = 'PROD') {
        console.log(`Query: cluster=${clusterId}, vault=${vaultId}, env=${env}, query=${sqlQuery.substring(0, 100)}...`);

        const client = this._getClient(clusterId, vaultId, env);
        const queryRequest = new QueryRequest(sqlQuery);

        try {
            const response = await client.vault(vaultId).query(queryRequest);

            // Remove empty tokenizedData field from response
            const cleanedResults = (response.fields || []).map(record => {
                const { tokenizedData, ...cleanRecord } = record;
                return cleanRecord;
            });

            // Return both data and errors for partial failure handling
            return {
                data: cleanedResults,
                errors: response.errors || null
            };
        } catch (error) {
            if (error instanceof SkyflowError) {
                console.error('Query error (Skyflow):', {
                    http_code: error.error?.http_code,
                    grpc_code: error.error?.grpc_code,
                    message: error.message,
                    details: error.error?.details,
                    request_ID: error.error?.request_ID
                });
            } else {
                console.error('Query error (Unexpected):', error.message);
            }
            throw new Error(`Query failed: ${error.message}`);
        }
    }

    /**
     * Tokenize with BYOT - Bring Your Own Token (multi-column support)
     * Insert records with custom tokens
     *
     * @param {string} clusterId - Skyflow cluster ID
     * @param {string} vaultId - Skyflow vault ID
     * @param {string} table - Table name in vault
     * @param {Array} records - Array of record objects with 'fields' (values) and 'tokens' (custom tokens)
     *                          Example: [{fields: {email: "test@example.com"}, tokens: {email: "custom-token-123"}}]
     * @param {string} env - Skyflow environment (SANDBOX or PROD), defaults to PROD
     * @returns {Promise<Array>} Array of inserted records with tokens
     */
    async tokenizeByot(clusterId, vaultId, table, records, env = 'PROD') {
        const batchSize = this.batching?.tokenize?.batchSize || 25;

        console.log(`Tokenize-BYOT: cluster=${clusterId}, vault=${vaultId}, env=${env}, table=${table}, count=${records.length}, batchSize=${batchSize}`);

        // If records fit in one batch, process directly
        if (records.length <= batchSize) {
            return await this._tokenizeByotBatch(clusterId, vaultId, table, records, env);
        }

        // Split into batches and process
        const batches = [];
        for (let i = 0; i < records.length; i += batchSize) {
            batches.push(records.slice(i, i + batchSize));
        }

        console.log(`Processing ${batches.length} batches...`);

        // Process all batches
        const results = [];
        const errors = [];

        for (let i = 0; i < batches.length; i++) {
            try {
                const batchResult = await this._tokenizeByotBatch(clusterId, vaultId, table, batches[i], env);
                results.push(...(batchResult.data || []));
                if (batchResult.errors) {
                    errors.push(...batchResult.errors);
                }
            } catch (error) {
                // If a batch fails, collect the error and continue
                console.error(`Batch ${i + 1}/${batches.length} failed:`, error.message);
                throw error; // Fail fast on batch error
            }
        }

        return {
            data: results,
            errors: errors.length > 0 ? errors : null
        };
    }

    /**
     * Process a single batch of tokenize-BYOT
     * @private
     */
    async _tokenizeByotBatch(clusterId, vaultId, table, records, env = 'PROD') {
        const client = this._getClient(clusterId, vaultId, env);

        const insertData = records.map(record => record.fields);
        const tokens = records.map(record => record.tokens);

        const insertRequest = new InsertRequest(table, insertData);
        const insertOptions = new InsertOptions();
        insertOptions.setTokenMode(TokenMode.ENABLE);
        insertOptions.setTokens(tokens);
        insertOptions.setContinueOnError(false);

        try {
            const response = await client.vault(vaultId).insert(insertRequest, insertOptions);

            // Return both data and errors for partial failure handling
            return {
                data: response.insertedFields || [],
                errors: response.errors || null
            };
        } catch (error) {
            if (error instanceof SkyflowError) {
                console.error('Tokenize-BYOT error (Skyflow):', {
                    http_code: error.error?.http_code,
                    grpc_code: error.error?.grpc_code,
                    message: error.message,
                    details: error.error?.details,
                    request_ID: error.error?.request_ID
                });
            } else {
                console.error('Tokenize-BYOT error (Unexpected):', error.message);
            }
            throw new Error(`Tokenize-BYOT failed: ${error.message}`);
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.clients = {};
        console.log('SkyflowClient destroyed');
    }
}

module.exports = SkyflowClient;
