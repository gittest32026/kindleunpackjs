/**
 * imghdr.js
 * JavaScript equivalent of Python imghdr.py
 * Recognize image file formats based on their first few bytes
 */

const fs = require('fs');

/**
 * Determine the type of image from file or buffer
 * @param {string|Buffer|null} file - File path or null if using h
 * @param {Buffer|null} h - Image header bytes (first 32 bytes)
 * @returns {string|null} - Image type or null if unknown
 */
function what(file, h = null) {
    let header = h;
    let f = null;
    
    try {
        if (header === null) {
            if (typeof file === 'string') {
                f = fs.openSync(file, 'r');
                header = Buffer.alloc(32);
                fs.readSync(f, header, 0, 32, 0);
            } else {
                // Assume it's a file handle with tell/seek
                const location = file.tell ? file.tell() : 0;
                header = file.read(32);
                if (file.seek) file.seek(location);
            }
        }
        
        for (const test of tests) {
            const res = test(header, f);
            if (res) return res;
        }
    } finally {
        if (f !== null) {
            fs.closeSync(f);
        }
    }
    
    return null;
}

// Test functions
function testJpeg(h, f) {
    // JPEG data in JFIF or Exif format
    const marker = h.slice(6, 10).toString('ascii');
    if (marker === 'JFIF' || marker === 'Exif') {
        return 'jpeg';
    }
    return null;
}

function testPng(h, f) {
    if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47 &&
        h[4] === 0x0D && h[5] === 0x0A && h[6] === 0x1A && h[7] === 0x0A) {
        return 'png';
    }
    return null;
}

function testGif(h, f) {
    // GIF ('87 and '89 variants)
    const sig = h.slice(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') {
        return 'gif';
    }
    return null;
}

function testTiff(h, f) {
    // TIFF (can be in Motorola or Intel byte order)
    const order = h.slice(0, 2).toString('ascii');
    if (order === 'MM' || order === 'II') {
        return 'tiff';
    }
    return null;
}

function testRgb(h, f) {
    // SGI image library
    if (h[0] === 0x01 && h[1] === 0xDA) {
        return 'rgb';
    }
    return null;
}

function testPbm(h, f) {
    // PBM (portable bitmap)
    if (h.length >= 3 && h[0] === 0x50 && (h[1] === 0x31 || h[1] === 0x34) &&
        [0x20, 0x09, 0x0A, 0x0D].includes(h[2])) {
        return 'pbm';
    }
    return null;
}

function testPgm(h, f) {
    // PGM (portable graymap)
    if (h.length >= 3 && h[0] === 0x50 && (h[1] === 0x32 || h[1] === 0x35) &&
        [0x20, 0x09, 0x0A, 0x0D].includes(h[2])) {
        return 'pgm';
    }
    return null;
}

function testPpm(h, f) {
    // PPM (portable pixmap)
    if (h.length >= 3 && h[0] === 0x50 && (h[1] === 0x33 || h[1] === 0x36) &&
        [0x20, 0x09, 0x0A, 0x0D].includes(h[2])) {
        return 'ppm';
    }
    return null;
}

function testRast(h, f) {
    // Sun raster file
    if (h[0] === 0x59 && h[1] === 0xA6 && h[2] === 0x6A && h[3] === 0x95) {
        return 'rast';
    }
    return null;
}

function testXbm(h, f) {
    // X bitmap (X10 or X11)
    if (h.slice(0, 8).toString('ascii') === '#define ') {
        return 'xbm';
    }
    return null;
}

function testBmp(h, f) {
    if (h[0] === 0x42 && h[1] === 0x4D) {
        return 'bmp';
    }
    return null;
}

function testWebp(h, f) {
    if (h.slice(0, 4).toString('ascii') === 'RIFF' &&
        h.slice(8, 12).toString('ascii') === 'WEBP') {
        return 'webp';
    }
    return null;
}

function testExr(h, f) {
    if (h[0] === 0x76 && h[1] === 0x2F && h[2] === 0x31 && h[3] === 0x01) {
        return 'exr';
    }
    return null;
}

const tests = [
    testJpeg,
    testPng,
    testGif,
    testTiff,
    testRgb,
    testPbm,
    testPgm,
    testPpm,
    testRast,
    testXbm,
    testBmp,
    testWebp,
    testExr
];

module.exports = {
    what
};
