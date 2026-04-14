/**
 * compatibility_utils.js
 * JavaScript equivalent of Python compatibility_utils.py
 * Utility functions for cross-platform compatibility
 */

const fs = require('fs');
const path = require('path');

// Check if running on Windows
const isWindows = process.platform === 'win32';

// Byte manipulation helpers
function bchr(s) {
    return Buffer.from([s]);
}

function bstr(s) {
    if (typeof s === 'string') {
        return Buffer.from(s, 'latin1');
    }
    return Buffer.from(s);
}

function bord(s) {
    if (Buffer.isBuffer(s)) {
        return s[0];
    }
    return s;
}

function bchar(s) {
    if (Buffer.isBuffer(s)) {
        return s.slice(0, 1);
    }
    return Buffer.from([s]);
}

// Hexlify - convert bytes to hex string
function hexlify(bdata) {
    return bdata.toString('hex');
}

// UTF-8 string conversion
function utf8Str(p, enc = 'utf-8') {
    if (p === null || p === undefined) {
        return null;
    }
    if (typeof p === 'string') {
        return Buffer.from(p, 'utf-8');
    }
    if (enc !== 'utf-8') {
        return Buffer.from(p.toString(), enc).toString('utf-8');
    }
    return p;
}

// Unicode string conversion
function unicodeStr(p, enc = 'utf-8') {
    if (p === null || p === undefined) {
        return null;
    }
    if (typeof p === 'string') {
        return p;
    }
    if (Buffer.isBuffer(p)) {
        return p.toString(enc);
    }
    return p.toString();
}

// HTML unescape
function unescapeit(sval) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'"
    };
    return sval.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, match => entities[match] || match);
}

// URL quote/unquote helpers
const ASCII_CHARS = new Set(Array.from({length: 128}, (_, i) => String.fromCharCode(i)));
const URL_SAFE = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#_.-/~');
const IRI_UNSAFE = new Set([...ASCII_CHARS].filter(x => !URL_SAFE.has(x)));

function quoteurl(href) {
    let str = href;
    if (Buffer.isBuffer(str)) {
        str = str.toString('utf-8');
    }
    const result = [];
    for (const char of str) {
        if (IRI_UNSAFE.has(char)) {
            result.push(`%${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
        } else {
            result.push(char);
        }
    }
    return result.join('');
}

function unquoteurl(href) {
    let str = href;
    if (Buffer.isBuffer(str)) {
        str = str.toString('utf-8');
    }
    return decodeURIComponent(str);
}

// List-producing versions of array methods
function lrange(start, stop, step) {
    const result = [];
    if (step === undefined) {
        if (stop === undefined) {
            stop = start;
            start = 0;
            step = 1;
        } else {
            step = 1;
        }
    }
    for (let i = start; i < stop; i += step) {
        result.push(i);
    }
    return result;
}

function lzip(...arrays) {
    const minLength = Math.min(...arrays.map(a => a.length));
    const result = [];
    for (let i = 0; i < minLength; i++) {
        result.push(arrays.map(a => a[i]));
    }
    return result;
}

function lmap(fn, iterable) {
    return Array.from(iterable).map(fn);
}

function lfilter(fn, iterable) {
    return Array.from(iterable).filter(fn);
}

module.exports = {
    isWindows,
    bchr,
    bstr,
    bord,
    bchar,
    hexlify,
    utf8Str,
    unicodeStr,
    unescapeit,
    quoteurl,
    unquoteurl,
    lrange,
    lzip,
    lmap,
    lfilter
};
