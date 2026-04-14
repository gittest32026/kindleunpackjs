/**
 * mobi_pagemap.js
 * JavaScript equivalent of Python mobi_pagemap.py
 * Page map processing for MOBI files
 */

const { unicodeStr } = require('./compatibility_utils');

const _TABLE = [
    ['m', 1000], ['cm', 900], ['d', 500], ['cd', 400],
    ['c', 100], ['xc', 90], ['l', 50], ['xl', 40],
    ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]
];

function intToRoman(i) {
    const parts = [];
    let num = i;
    for (const [letter, value] of _TABLE) {
        while (value <= num) {
            num -= value;
            parts.push(letter);
        }
    }
    return parts.join('');
}

function romanToInt(s) {
    let result = 0;
    let rnstr = s.toLowerCase();
    for (const [letter, value] of _TABLE) {
        while (rnstr.startsWith(letter)) {
            result += value;
            rnstr = rnstr.slice(letter.length);
        }
    }
    return result;
}

const _pattern = /\(([^)]*)\)/gi;

function _parseNames(numpages, data) {
    data = unicodeStr(data);
    const pagenames = new Array(numpages).fill(null);
    let pageMap = '';
    
    const matches = data.matchAll(_pattern);
    for (const m of matches) {
        const tup = m[1];
        if (pageMap !== '') {
            pageMap += ',';
        }
        pageMap += '(' + tup + ')';
        let [spos, nametype, svalue] = tup.split(',');
        if (nametype === 'a' || nametype === 'r') {
            svalue = parseInt(svalue, 10);
        }
        spos = parseInt(spos, 10);
        for (let i = spos - 1; i < numpages; i++) {
            let pname;
            if (nametype === 'r') {
                pname = intToRoman(svalue);
                svalue += 1;
            } else if (nametype === 'a') {
                pname = String(svalue);
                svalue += 1;
            } else if (nametype === 'c') {
                const sp = svalue.indexOf('|');
                if (sp === -1) {
                    pname = svalue;
                } else {
                    pname = svalue.slice(0, sp);
                    svalue = svalue.slice(sp + 1);
                }
            } else {
                console.log("Error: unknown page numbering type", nametype);
                pname = '';
            }
            pagenames[i] = pname;
        }
    }
    return [pagenames, pageMap];
}

class PageMapProcessor {
    constructor(mh, data) {
        this.mh = mh;
        this.data = Buffer.isBuffer(data) ? data : Buffer.from(data);
        this.pagenames = [];
        this.pageoffsets = [];
        this.pageMap = '';
        this.pm_len = 0;
        this.pm_nn = 0;
        this.pm_bits = 0;
        this.pmoff = null;
        this.pmstr = '';
        console.log("Extracting Page Map Information");
        
        const rev_len = this.data.readUInt32BE(0x10);
        let ptr = 0x14 + rev_len;
        this.pm_len = this.data.readUInt16BE(ptr + 2);
        this.pm_nn = this.data.readUInt16BE(ptr + 4);
        this.pm_bits = this.data.readUInt16BE(ptr + 6);
        
        this.pmstr = this.data.slice(ptr + 8, ptr + 8 + this.pm_len).toString('latin1');
        this.pmoff = this.data.slice(ptr + 8 + this.pm_len);
        
        let offwidth = 4;
        if (this.pm_bits === 16) {
            offwidth = 2;
        }
        
        ptr = 0;
        for (let i = 0; i < this.pm_nn; i++) {
            let od;
            if (offwidth === 4) {
                od = this.pmoff.readUInt32BE(ptr);
            } else {
                od = this.pmoff.readUInt16BE(ptr);
            }
            ptr += offwidth;
            this.pageoffsets.push(od);
        }
        
        [this.pagenames, this.pageMap] = _parseNames(this.pm_nn, this.pmstr);
    }

    getPageMap() {
        return this.pageMap;
    }

    getNames() {
        return this.pagenames;
    }

    getOffsets() {
        return this.pageoffsets;
    }

    generateKF8PageMapXML(k8proc) {
        let pagemapxml = '<page-map xmlns="http://www.idpf.org/2007/opf">\n';
        for (let i = 0; i < this.pagenames.length; i++) {
            const pos = this.pageoffsets[i];
            const name = this.pagenames[i];
            if (name !== null && name !== '') {
                const [pn, dir, filename, skelpos, skelend, aidtext] = k8proc.getSkelInfo(pos);
                const idtext = unicodeStr(k8proc.getPageIDTag(pos));
                let linktgt = unicodeStr(filename);
                if (idtext !== '') {
                    linktgt += '#' + idtext;
                }
                pagemapxml += '<page name="' + name + '" href="' + dir + '/' + linktgt + '" />\n';
            }
        }
        pagemapxml += "</page-map>\n";
        return pagemapxml;
    }

    generateAPNX(apnx_meta) {
        let content_header;
        if (apnx_meta.format === 'MOBI_8') {
            content_header = `{"contentGuid":"${apnx_meta.contentGuid}","asin":"${apnx_meta.asin}","cdeType":"${apnx_meta.cdeType}","format":"${apnx_meta.format}","fileRevisionId":"1","acr":"${apnx_meta.acr}"}`;
        } else {
            content_header = `{"contentGuid":"${apnx_meta.contentGuid}","asin":"${apnx_meta.asin}","cdeType":"${apnx_meta.cdeType}","fileRevisionId":"1"}`;
        }
        const contentHeaderBuf = Buffer.from(content_header, 'utf-8');
        const page_header = `{"asin":"${apnx_meta.asin}","pageMap":"${apnx_meta.pageMap}"}`;
        const pageHeaderBuf = Buffer.from(page_header, 'utf-8');
        
        const buf = Buffer.allocUnsafe(12 + 6 + contentHeaderBuf.length + pageHeaderBuf.length + this.pm_nn * 4);
        let offset = 0;
        
        buf.writeUInt16BE(1, offset); offset += 2;
        buf.writeUInt16BE(1, offset); offset += 2;
        buf.writeUInt32BE(12 + contentHeaderBuf.length, offset); offset += 4;
        buf.writeUInt32BE(contentHeaderBuf.length, offset); offset += 4;
        contentHeaderBuf.copy(buf, offset); offset += contentHeaderBuf.length;
        buf.writeUInt16BE(1, offset); offset += 2;
        buf.writeUInt16BE(pageHeaderBuf.length, offset); offset += 2;
        buf.writeUInt16BE(this.pm_nn, offset); offset += 2;
        buf.writeUInt16BE(32, offset); offset += 2;
        pageHeaderBuf.copy(buf, offset); offset += pageHeaderBuf.length;
        
        for (const page of this.pageoffsets) {
            buf.writeUInt32BE(page, offset); offset += 4;
        }
        
        return buf.slice(0, offset);
    }
}

module.exports = {
    PageMapProcessor
};
