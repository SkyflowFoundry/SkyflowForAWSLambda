/**
 * Simple manual tests for request body parsing.
 * Run with: node lambda/utils/body.test.js
 */

const assert = require('assert');
const zlib = require('zlib');
const { parseRequestBody } = require('./body');

const snowflakeBody = {
    data: [[0, 'email@test.com']]
};

const gzipBase64Body = zlib.gzipSync(JSON.stringify(snowflakeBody)).toString('base64');

assert.deepStrictEqual(
    parseRequestBody({
        body: gzipBase64Body,
        isBase64Encoded: true,
        headers: { 'content-encoding': 'gzip' }
    }),
    snowflakeBody
);

assert.deepStrictEqual(
    parseRequestBody({
        body: JSON.stringify(snowflakeBody),
        isBase64Encoded: false,
        headers: {}
    }),
    snowflakeBody
);

assert.deepStrictEqual(
    parseRequestBody({
        body: Buffer.from(JSON.stringify(snowflakeBody), 'utf8').toString('base64'),
        isBase64Encoded: true,
        headers: {}
    }),
    snowflakeBody
);

console.log('body parser tests passed');
