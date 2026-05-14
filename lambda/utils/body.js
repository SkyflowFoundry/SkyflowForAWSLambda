const zlib = require('zlib');
const { getHeader } = require('./headers');

const MAX_DECOMPRESSED_BODY_BYTES = parseInt(process.env.MAX_DECOMPRESSED_BODY_BYTES || `${6 * 1024 * 1024}`, 10);

function parseRequestBody(event) {
    if (event.body === undefined || event.body === null || event.body === '') {
        return {};
    }

    let bodyBuffer;
    if (Buffer.isBuffer(event.body)) {
        bodyBuffer = event.body;
    } else if (typeof event.body === 'string') {
        bodyBuffer = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64')
            : Buffer.from(event.body, 'utf8');
    } else if (typeof event.body === 'object') {
        return event.body;
    } else {
        throw new Error('Invalid request body: body must be a string, Buffer, or parsed object');
    }

    const headers = event.headers || {};
    const contentEncoding = (getHeader(headers, 'content-encoding') || '').toLowerCase();

    const hasGzipHeader = bodyBuffer.length >= 2 && bodyBuffer[0] === 0x1f && bodyBuffer[1] === 0x8b;
    if (contentEncoding.includes('gzip') || hasGzipHeader) {
        try {
            bodyBuffer = zlib.gunzipSync(bodyBuffer, { maxOutputLength: MAX_DECOMPRESSED_BODY_BYTES });
        } catch (error) {
            throw new Error(`Invalid request body: failed to decompress gzip (${error.message})`);
        }
    }

    try {
        return JSON.parse(bodyBuffer.toString('utf8'));
    } catch (error) {
        throw new Error(`Invalid request body: failed to parse JSON (${error.message})`);
    }
}

module.exports = {
    parseRequestBody
};
