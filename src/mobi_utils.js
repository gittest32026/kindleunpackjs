/**
 * mobi_utils.js
 * JavaScript equivalent of Python mobi_utils.py
 * Utility functions for MOBI file processing
 */

const { hexlify } = require('./compatibility_utils');

/**
 * Get language code from language ID and sublanguage ID
 * @param {number} langID - Language ID
 * @param {number} sublangID - Sublanguage ID
 * @returns {string} - Language code
 */
function getLanguage(langID, sublangID) {
    const mobilangdict = {
        54: { 0: 'af' },  // Afrikaans
        28: { 0: 'sq' },  // Albanian
        1: { 0: 'ar', 5: 'ar-dz', 15: 'ar-bh', 3: 'ar-eg', 2: 'ar-iq', 11: 'ar-jo', 13: 'ar-kw', 12: 'ar-lb', 4: 'ar-ly',
             6: 'ar-ma', 8: 'ar-om', 16: 'ar-qa', 1: 'ar-sa', 10: 'ar-sy', 7: 'ar-tn', 14: 'ar-ae', 9: 'ar-ye' },
        43: { 0: 'hy' },  // Armenian
        77: { 0: 'as' },  // Assamese
        44: { 0: 'az' },  // Azeri
        45: { 0: 'eu' },  // Basque
        35: { 0: 'be' },  // Belarusian
        69: { 0: 'bn' },  // Bengali
        2: { 0: 'bg' },  // Bulgarian
        3: { 0: 'ca' },  // Catalan
        4: { 0: 'zh', 3: 'zh-hk', 2: 'zh-cn', 4: 'zh-sg', 1: 'zh-tw' },
        26: { 0: 'hr', 3: 'sr' },  // Croatian, Serbian
        5: { 0: 'cs' },  // Czech
        6: { 0: 'da' },  // Danish
        19: { 0: 'nl', 1: 'nl', 2: 'nl-be' },  // Dutch
        9: { 0: 'en', 1: 'en', 3: 'en-au', 10: 'en-bz', 4: 'en-ca', 6: 'en-ie', 8: 'en-jm', 5: 'en-nz', 13: 'en-ph',
             7: 'en-za', 11: 'en-tt', 2: 'en-gb', 1: 'en-us', 12: 'en-zw' },
        37: { 0: 'et' },  // Estonian
        56: { 0: 'fo' },  // Faroese
        41: { 0: 'fa' },  // Farsi
        11: { 0: 'fi' },  // Finnish
        12: { 0: 'fr', 1: 'fr', 2: 'fr-be', 3: 'fr-ca', 5: 'fr-lu', 6: 'fr-mc', 4: 'fr-ch' },
        55: { 0: 'ka' },  // Georgian
        7: { 0: 'de', 1: 'de', 3: 'de-at', 5: 'de-li', 4: 'de-lu', 2: 'de-ch' },
        8: { 0: 'el' },  // Greek
        71: { 0: 'gu' },  // Gujarati
        13: { 0: 'he' },  // Hebrew
        57: { 0: 'hi' },  // Hindi
        14: { 0: 'hu' },  // Hungarian
        15: { 0: 'is' },  // Icelandic
        33: { 0: 'id' },  // Indonesian
        16: { 0: 'it', 1: 'it', 2: 'it-ch' },
        17: { 0: 'ja' },  // Japanese
        75: { 0: 'kn' },  // Kannada
        63: { 0: 'kk' },  // Kazakh
        87: { 0: 'x-kok' },  // Konkani
        18: { 0: 'ko' },  // Korean
        38: { 0: 'lv' },  // Latvian
        39: { 0: 'lt' },  // Lithuanian
        47: { 0: 'mk' },  // Macedonian
        62: { 0: 'ms' },  // Malay
        76: { 0: 'ml' },  // Malayalam
        58: { 0: 'mt' },  // Maltese
        78: { 0: 'mr' },  // Marathi
        97: { 0: 'ne' },  // Nepali
        20: { 0: 'no' },  // Norwegian
        72: { 0: 'or' },  // Oriya
        21: { 0: 'pl' },  // Polish
        22: { 0: 'pt', 2: 'pt', 1: 'pt-br' },
        70: { 0: 'pa' },  // Punjabi
        23: { 0: 'rm' },  // Rhaeto-Romanic
        24: { 0: 'ro' },  // Romanian
        25: { 0: 'ru' },  // Russian
        59: { 0: 'sz' },  // Sami
        79: { 0: 'sa' },  // Sanskrit
        27: { 0: 'sk' },  // Slovak
        36: { 0: 'sl' },  // Slovenian
        46: { 0: 'sb' },  // Sorbian
        10: { 0: 'es', 1: 'es', 11: 'es-ar', 16: 'es-bo', 13: 'es-cl', 9: 'es-co', 5: 'es-cr', 7: 'es-do',
              12: 'es-ec', 17: 'es-sv', 4: 'es-gt', 18: 'es-hn', 2: 'es-mx', 19: 'es-ni', 6: 'es-pa',
              15: 'es-py', 10: 'es-pe', 20: 'es-pr', 14: 'es-uy', 8: 'es-ve' },
        48: { 0: 'sx' },  // Sutu
        65: { 0: 'sw' },  // Swahili
        29: { 0: 'sv', 1: 'sv', 2: 'sv-fi' },
        73: { 0: 'ta' },  // Tamil
        68: { 0: 'tt' },  // Tatar
        74: { 0: 'te' },  // Telugu
        30: { 0: 'th' },  // Thai
        49: { 0: 'ts' },  // Tsonga
        50: { 0: 'tn' },  // Tswana
        31: { 0: 'tr' },  // Turkish
        34: { 0: 'uk' },  // Ukrainian
        32: { 0: 'ur' },  // Urdu
        67: { 0: 'uz', 1: 'uz' },  // Uzbek
        42: { 0: 'vi' },  // Vietnamese
        52: { 0: 'xh' },  // Xhosa
        53: { 0: 'zu' },  // Zulu
    };
    
    let lang = 'en';
    if (langID in mobilangdict) {
        const subdict = mobilangdict[langID];
        lang = subdict[0];
        if (sublangID in subdict) {
            lang = subdict[sublangID];
        }
    }
    return lang;
}

/**
 * Convert bytes to hex string
 * @param {Buffer} byteList - Bytes to convert
 * @returns {string} - Hex string
 */
function toHex(byteList) {
    return hexlify(byteList);
}

/**
 * Convert value to base32 string
 * @param {number} value - Value to convert
 * @param {number} npad - Minimum padding (default: 4)
 * @returns {Buffer} - Base32 string as buffer
 */
function toBase32(value, npad = 4) {
    const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
    let numString = '';
    let current = value;
    
    while (current !== 0) {
        const remainder = current % 32;
        current = Math.floor(current / 32);
        numString = digits[remainder] + numString;
    }
    
    if (numString === '') {
        numString = '0';
    }
    
    const pad = npad - numString.length;
    if (pad > 0) {
        numString = '0'.repeat(pad) + numString;
    }
    
    return Buffer.from(numString);
}

/**
 * Convert base32 string to value
 * @param {Buffer|string} strNum - Base32 string
 * @returns {number} - Converted value
 */
function fromBase32(strNum) {
    let s = strNum;
    if (typeof s === 'string') {
        s = Buffer.from(s, 'latin1');
    }
    
    const scalelst = [1, 32, 1024, 32768, 1048576, 33554432, 1073741824, 34359738368];
    let value = 0;
    let j = 0;
    const n = s.length;
    let scale = 0;
    
    for (let i = 0; i < n; i++) {
        const c = s[n - i - 1];
        let v;
        if (c >= 0x30 && c <= 0x39) {  // '0'-'9'
            v = c - 0x30;
        } else {
            v = c - 0x41 + 10;  // 'A'-'V'
        }
        
        if (j < scalelst.length) {
            scale = scalelst[j];
        } else {
            scale = scale * 32;
        }
        j++;
        
        if (v !== 0) {
            value = value + (v * scale);
        }
    }
    
    return value;
}

/**
 * Mangle fonts with encryption key
 * @param {Buffer|string} encryptionKey - Encryption key
 * @param {Buffer} data - Data to mangle
 * @returns {Buffer} - Mangled data
 */
function mangleFonts(encryptionKey, data) {
    let key = encryptionKey;
    if (typeof key === 'string') {
        key = Buffer.from(key, 'latin1');
    }
    
    const crypt = data.slice(0, 1024);
    const result = Buffer.alloc(1024);
    
    for (let i = 0; i < 1024; i++) {
        result[i] = crypt[i] ^ key[i % key.length];
    }
    
    return Buffer.concat([result, data.slice(1024)]);
}

module.exports = {
    getLanguage,
    toHex,
    toBase32,
    fromBase32,
    mangleFonts
};
