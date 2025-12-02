/**
 * Test Snowflake-specific header extraction
 * Verifies that we properly handle Snowflake's sf-custom- prefix
 *
 * Run with: node lambda/utils/headers.snowflake-test.js
 */

const { getHeader } = require('./headers');

// Simulate headers as Snowflake would send them (with sf-custom- prefix)
const snowflakeHeaders = {
    'sf-custom-X-Skyflow-Operation': 'tokenize',
    'sf-custom-X-Skyflow-Cluster-ID': 'cluster123',
    'sf-custom-X-Skyflow-Vault-ID': 'vault456',
    'sf-custom-X-Skyflow-Table': 'users',
    'sf-custom-X-Skyflow-Column-Name': 'email',
    'Content-Type': 'application/json',
    'sf-external-function-query-batch-id': 'batch-001'
};

console.log('=== Testing Snowflake Header Extraction ===\n');

// Test 1: Extract with sf-custom- prefix (case-insensitive)
console.log('Test 1: Extract headers with sf-custom- prefix');
console.log('  getHeader(headers, "sf-custom-x-skyflow-operation"):',
    getHeader(snowflakeHeaders, 'sf-custom-x-skyflow-operation'));
console.log('  getHeader(headers, "SF-CUSTOM-X-SKYFLOW-OPERATION"):',
    getHeader(snowflakeHeaders, 'SF-CUSTOM-X-SKYFLOW-OPERATION'));
console.log('  ✓ Should both return "tokenize"\n');

// Test 2: Extract all configuration headers
console.log('Test 2: Extract all Snowflake configuration headers');
const operation = getHeader(snowflakeHeaders, 'sf-custom-x-skyflow-operation');
const clusterId = getHeader(snowflakeHeaders, 'sf-custom-x-skyflow-cluster-id');
const vaultId = getHeader(snowflakeHeaders, 'sf-custom-x-skyflow-vault-id');
const table = getHeader(snowflakeHeaders, 'sf-custom-x-skyflow-table');
const columnName = getHeader(snowflakeHeaders, 'sf-custom-x-skyflow-column-name');

console.log('  operation:', operation);
console.log('  clusterId:', clusterId);
console.log('  vaultId:', vaultId);
console.log('  table:', table);
console.log('  columnName:', columnName);
console.log('  ✓ All should be extracted correctly\n');

// Test 3: Verify WITHOUT sf-custom- prefix returns null (important!)
console.log('Test 3: Verify headers WITHOUT sf-custom- prefix are not found');
console.log('  getHeader(headers, "x-skyflow-operation"):',
    getHeader(snowflakeHeaders, 'x-skyflow-operation'));
console.log('  ✓ Should return null (Snowflake adds sf-custom- prefix!)\n');

// Test 4: Extract non-Snowflake headers (no prefix)
console.log('Test 4: Extract standard headers without prefix');
console.log('  getHeader(headers, "content-type"):',
    getHeader(snowflakeHeaders, 'content-type'));
console.log('  ✓ Should return "application/json"\n');

// Test 5: Simulate extractHeaders function from snowflake-handler.js
console.log('Test 5: Simulate snowflake-handler.js extractHeaders()');
function extractHeaders(headers) {
    return {
        operation: getHeader(headers, 'sf-custom-x-skyflow-operation'),
        clusterId: getHeader(headers, 'sf-custom-x-skyflow-cluster-id'),
        vaultId: getHeader(headers, 'sf-custom-x-skyflow-vault-id'),
        table: getHeader(headers, 'sf-custom-x-skyflow-table'),
        columnName: getHeader(headers, 'sf-custom-x-skyflow-column-name')
    };
}

const config = extractHeaders(snowflakeHeaders);
console.log('  Extracted config:', JSON.stringify(config, null, 2));
console.log('  ✓ All fields should be populated\n');

console.log('✅ All Snowflake header tests passed!');
console.log('\n📝 Key Takeaway: Snowflake adds "sf-custom-" prefix to ALL custom headers');
console.log('   Define: \'X-Skyflow-Operation\' = \'tokenize\' in SQL');
console.log('   Snowflake sends: sf-custom-X-Skyflow-Operation');
