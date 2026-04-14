/**
 * unipath.js
 * JavaScript equivalent of Python unipath.py
 * Utility routines to convert all paths to be full unicode
 */

const fs = require('fs');
const path = require('path');

/**
 * Convert path to unicode string
 * @param {string|Buffer|null} s - Path to convert
 * @param {string} enc - Encoding (default: utf-8)
 * @returns {string|null}
 */
function pathof(s, enc = 'utf-8') {
    if (s === null || s === undefined) {
        return null;
    }
    if (typeof s === 'string') {
        return s;
    }
    if (Buffer.isBuffer(s)) {
        try {
            return s.toString(enc);
        } catch (e) {
            return s.toString();
        }
    }
    return String(s);
}

/**
 * Check if path exists
 * @param {string|Buffer} s - Path to check
 * @returns {boolean}
 */
function exists(s) {
    try {
        fs.accessSync(pathof(s));
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Check if path is a file
 * @param {string|Buffer} s - Path to check
 * @returns {boolean}
 */
function isfile(s) {
    try {
        return fs.statSync(pathof(s)).isFile();
    } catch (e) {
        return false;
    }
}

/**
 * Check if path is a directory
 * @param {string|Buffer} s - Path to check
 * @returns {boolean}
 */
function isdir(s) {
    try {
        return fs.statSync(pathof(s)).isDirectory();
    } catch (e) {
        return false;
    }
}

/**
 * Create directory
 * @param {string|Buffer} s - Path to create
 */
function mkdir(s) {
    fs.mkdirSync(pathof(s), { recursive: true });
}

/**
 * List directory contents
 * @param {string|Buffer} s - Directory path
 * @returns {string[]}
 */
function listdir(s) {
    const dirPath = pathof(s);
    return fs.readdirSync(dirPath).map(file => pathof(file));
}

/**
 * Get current working directory
 * @returns {string}
 */
function getcwd() {
    return process.cwd();
}

/**
 * Walk directory tree
 * @param {string|Buffer} top - Starting directory
 * @returns {string[]}
 */
function walk(top) {
    const topPath = pathof(top);
    const rv = [];
    
    function walkDir(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walkDir(fullPath);
            } else {
                rv.push(relpath(fullPath, topPath));
            }
        }
    }
    
    walkDir(topPath);
    return rv;
}

/**
 * Get relative path
 * @param {string|Buffer} p - Path
 * @param {string|Buffer} start - Start directory
 * @returns {string}
 */
function relpath(p, start) {
    return path.relative(pathof(start) || process.cwd(), pathof(p));
}

/**
 * Get absolute path
 * @param {string|Buffer} p - Path
 * @returns {string}
 */
function abspath(p) {
    return path.resolve(pathof(p));
}

module.exports = {
    pathof,
    exists,
    isfile,
    isdir,
    mkdir,
    listdir,
    getcwd,
    walk,
    relpath,
    abspath
};
