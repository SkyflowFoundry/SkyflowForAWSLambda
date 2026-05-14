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

assert.deepStrictEqual(
    parseRequestBody({
        body: gzipBase64Body,
        isBase64Encoded: true,
        headers: {}
    }),
    snowflakeBody
);

assert.deepStrictEqual(
    parseRequestBody({
        body: Buffer.from(JSON.stringify(snowflakeBody), 'utf8'),
        headers: {}
    }),
    snowflakeBody
);

assert.deepStrictEqual(parseRequestBody({ body: '', headers: {} }), {});
assert.deepStrictEqual(parseRequestBody({ body: null, headers: {} }), {});
assert.deepStrictEqual(parseRequestBody({ headers: {} }), {});

assert.throws(
    () => parseRequestBody({
        body: zlib.gzipSync('not json').toString('base64'),
        isBase64Encoded: true,
        headers: { 'content-encoding': 'gzip' }
    }),
    /failed to parse JSON/
);

assert.throws(
    () => parseRequestBody({
        body: gzipBase64Body.slice(0, -8),
        isBase64Encoded: true,
        headers: { 'content-encoding': 'gzip' }
    }),
    /failed to decompress gzip/
);

assert.throws(
    () => parseRequestBody({ body: 123, headers: {} }),
    /body must be a string, Buffer, or parsed object/
);

console.log('body parser tests passed');
