/**
 * Simple manual tests for headers utility
 * Run with: node lambda/utils/headers.test.js
 */

const { getHeader, getHeaders } = require('./headers');

// Test data
const testHeaders = {
    'X-Skyflow-Operation': 'tokenize',
    'x-skyflow-cluster-id': 'cluster123',
    'X-SKYFLOW-VAULT-ID': 'vault456',
    'Content-Type': 'application/json',
    'X-Skyflow-Table': 'users'
};

console.log('=== Testing getHeader ===\n');

// Test 1: Case-insensitive matching
console.log('Test 1: Case-insensitive matching');
console.log('  getHeader(headers, "x-skyflow-operation"):', getHeader(testHeaders, 'x-skyflow-operation'));
console.log('  getHeader(headers, "X-Skyflow-Operation"):', getHeader(testHeaders, 'X-Skyflow-Operation'));
console.log('  getHeader(headers, "X-SKYFLOW-OPERATION"):', getHeader(testHeaders, 'X-SKYFLOW-OPERATION'));
console.log('  ✓ All should return "tokenize"\n');

// Test 2: Different case headers
console.log('Test 2: Different case headers');
console.log('  getHeader(headers, "x-skyflow-cluster-id"):', getHeader(testHeaders, 'x-skyflow-cluster-id'));
console.log('  getHeader(headers, "x-skyflow-vault-id"):', getHeader(testHeaders, 'x-skyflow-vault-id'));
console.log('  ✓ Should return "cluster123" and "vault456"\n');

// Test 3: Missing header
console.log('Test 3: Missing header');
console.log('  getHeader(headers, "x-skyflow-missing"):', getHeader(testHeaders, 'x-skyflow-missing'));
console.log('  ✓ Should return null\n');

// Test 4: Null/undefined headers
console.log('Test 4: Null/undefined headers');
console.log('  getHeader(null, "x-skyflow-operation"):', getHeader(null, 'x-skyflow-operation'));
console.log('  getHeader(undefined, "x-skyflow-operation"):', getHeader(undefined, 'x-skyflow-operation'));
console.log('  ✓ Should both return null\n');

console.log('=== Testing getHeaders ===\n');

// Test 5: Multiple headers at once
console.log('Test 5: Multiple headers at once');
const result = getHeaders(testHeaders, ['x-skyflow-operation', 'x-skyflow-cluster-id', 'x-skyflow-vault-id']);
console.log('  Result:', JSON.stringify(result, null, 2));
console.log('  ✓ Should have all three headers\n');

console.log('✅ All tests completed!');
