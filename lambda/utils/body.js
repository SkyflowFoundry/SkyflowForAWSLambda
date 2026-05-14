/**
 * Request body parsing utilities.
 */

const zlib = require('zlib');
const { getHeader } = require('./headers');

function parseRequestBody(event) {
    if (event.body === undefined || event.body === null || event.body === '') {
        return {};
    }

    if (typeof event.body !== 'string') {
        return event.body;
    }

    const headers = event.headers || {};
    const contentEncoding = (getHeader(headers, 'content-encoding') || '').toLowerCase();
    let bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'utf8');

    const hasGzipHeader = bodyBuffer.length >= 2 && bodyBuffer[0] === 0x1f && bodyBuffer[1] === 0x8b;
    if (contentEncoding.includes('gzip') || hasGzipHeader) {
        bodyBuffer = zlib.gunzipSync(bodyBuffer);
    }

    return JSON.parse(bodyBuffer.toString('utf8'));
}

module.exports = {
    parseRequestBody
};
