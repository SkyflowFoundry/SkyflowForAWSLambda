/**
 * Skyflow Client - Pure SDK Wrapper
 *
 * Provides clean interface to Skyflow SDK operations
 * No custom preprocessing or transformations - direct pass-through to SDK
 */

const { Skyflow, InsertRequest, InsertOptions, DetokenizeRequest, DetokenizeOptions, QueryRequest, TokenMode } = require('skyflow-node');

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
     * Get or initialize SDK client for a specific cluster and vault
     * @private
     */
    _getClient(clusterId, vaultId) {
        const clientKey = `${clusterId}:${vaultId}`;

        if (!this.clients[clientKey]) {
            console.log(`Initializing SDK client for cluster: ${clusterId}, vault: ${vaultId}`);

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
                env: 'PROD',
                credentials: credentials
            };

            const skyflowConfig = {
                vaultConfigs: [vaultConfig]
            };

            this.clients[clientKey] = new Skyflow(skyflowConfig);

            console.log(`SDK client initialized for cluster: ${clusterId}, vault: ${vaultId}`);
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
     * @param {Object} options - Options like {upsert: "email"} or {upsert: ["email", "ssn"]}
     * @returns {Promise<Array>} Array of tokenized records with all columns
     */
    async tokenize(clusterId, vaultId, table, records, options = {}) {
        const columnNames = records.length > 0 ? Object.keys(records[0]) : [];
        console.log(`Tokenize: cluster=${clusterId}, vault=${vaultId}, table=${table}, columns=[${columnNames.join(', ')}], count=${records.length}`);

        const client = this._getClient(clusterId, vaultId);

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
            console.log(`Tokenize complete: ${response.insertedFields?.length || 0} records processed`);
            return response.insertedFields || [];
        } catch (error) {
            console.error('Tokenize error:', error.message);
            throw new Error(`Tokenization failed: ${error.message}`);
        }
    }

    /**
     * Detokenize tokens (vault-level operation, no table/column needed)
     *
     * @param {string} clusterId - Skyflow cluster ID
     * @param {string} vaultId - Skyflow vault ID
     * @param {Array} tokens - Array of token strings
     * @returns {Promise<Array>} Array of detokenized values
     */
    async detokenize(clusterId, vaultId, tokens) {
        console.log(`Detokenize: cluster=${clusterId}, vault=${vaultId}, count=${tokens.length}`);

        const client = this._getClient(clusterId, vaultId);

        const detokenizeData = tokens.map(token => ({
            token: token,
            redaction: 'PLAIN_TEXT'
        }));

        const detokenizeRequest = new DetokenizeRequest(detokenizeData);
        const detokenizeOptions = new DetokenizeOptions();
        detokenizeOptions.setContinueOnError(true);

        try {
            const response = await client.vault(vaultId).detokenize(detokenizeRequest, detokenizeOptions);
            console.log(`Detokenize complete: ${response.detokenizedFields?.length || 0} records processed`);

            return (response.detokenizedFields || []).map(record => ({
                token: record.token,
                value: record.value
            }));
        } catch (error) {
            console.error('Detokenize error:', error.message);
            throw new Error(`Detokenization failed: ${error.message}`);
        }
    }

    /**
     * Query vault data
     *
     * @param {string} clusterId - Skyflow cluster ID
     * @param {string} vaultId - Skyflow vault ID
     * @param {string} sqlQuery - SQL query string
     * @returns {Promise<Array>} Array of query results
     */
    async query(clusterId, vaultId, sqlQuery) {
        console.log(`Query: cluster=${clusterId}, vault=${vaultId}, query=${sqlQuery.substring(0, 100)}...`);

        const client = this._getClient(clusterId, vaultId);
        const queryRequest = new QueryRequest(sqlQuery);

        try {
            const response = await client.vault(vaultId).query(queryRequest);
            console.log(`Query complete: ${response.fields?.length || 0} records returned`);

            // Remove empty tokenizedData field from response
            const cleanedResults = (response.fields || []).map(record => {
                const { tokenizedData, ...cleanRecord } = record;
                return cleanRecord;
            });

            return cleanedResults;
        } catch (error) {
            console.error('Query error:', error.message);
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
     * @returns {Promise<Array>} Array of inserted records with tokens
     */
    async tokenizeByot(clusterId, vaultId, table, records) {
        console.log(`Tokenize-BYOT: cluster=${clusterId}, vault=${vaultId}, table=${table}, count=${records.length}`);

        const client = this._getClient(clusterId, vaultId);

        const insertData = records.map(record => record.fields);
        const tokens = records.map(record => record.tokens);

        const insertRequest = new InsertRequest(table, insertData);
        const insertOptions = new InsertOptions();
        insertOptions.setTokenMode(TokenMode.ENABLE);
        insertOptions.setTokens(tokens);
        insertOptions.setContinueOnError(false);

        try {
            const response = await client.vault(vaultId).insert(insertRequest, insertOptions);
            console.log(`Tokenize-BYOT complete: ${response.insertedFields?.length || 0} records processed`);
            return response.insertedFields || [];
        } catch (error) {
            console.error('Tokenize-BYOT error:', error.message);
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
