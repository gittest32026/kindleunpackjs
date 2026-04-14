/**
 * mobi_uncompress.js
 * JavaScript equivalent of Python mobi_uncompress.py
 * Decompression routines for MOBI files
 */

const { bchr } = require('./compatibility_utils');

class UncompressedReader {
    unpack(data) {
        return data;
    }
}

class PalmdocReader {
    unpack(i) {
        let o = Buffer.alloc(0);
        let p = 0;
        
        while (p < i.length) {
            const c = i[p];
            p += 1;
            
            if (c >= 1 && c <= 8) {
                o = Buffer.concat([o, i.slice(p, p + c)]);
                p += c;
            } else if (c < 128) {
                o = Buffer.concat([o, bchr(c)]);
            } else if (c >= 192) {
                o = Buffer.concat([o, Buffer.from([0x20, c ^ 0x80])]);
            } else {
                if (p < i.length) {
                    const c2 = (c << 8) | i[p];
                    p += 1;
                    const m = (c2 >> 3) & 0x07ff;
                    const n = (c2 & 7) + 3;
                    
                    if (m > n) {
                        o = Buffer.concat([o, o.slice(o.length - m, o.length - m + n)]);
                    } else {
                        for (let k = 0; k < n; k++) {
                            if (m === 1) {
                                o = Buffer.concat([o, o.slice(o.length - m)]);
                            } else {
                                o = Buffer.concat([o, o.slice(o.length - m, o.length - m + 1)]);
                            }
                        }
                    }
                }
            }
        }
        
        return o;
    }
}

class HuffcdicReader {
    constructor() {
        this.dict1 = [];
        this.mincode = [];
        this.maxcode = [];
        this.dictionary = [];
    }

    loadHuff(huff) {
        if (!huff.slice(0, 8).equals(Buffer.from('HUFF\x00\x00\x00\x18'))) {
            throw new Error('Invalid huff header');
        }
        
        const off1 = huff.readUInt32BE(8);
        const off2 = huff.readUInt32BE(12);

        const dict1Unpack = (v) => {
            const codelen = v & 0x1f;
            const term = v & 0x80;
            let maxcode = v >> 8;
            if (codelen === 0) {
                throw new Error('Invalid codelen');
            }
            if (codelen <= 8 && !term) {
                throw new Error('Invalid term flag');
            }
            maxcode = ((maxcode + 1) << (32 - codelen)) - 1;
            return [codelen, term, maxcode];
        };

        for (let i = 0; i < 256; i++) {
            this.dict1.push(dict1Unpack(huff.readUInt32BE(off1 + i * 4)));
        }

        const dict2 = [];
        for (let i = 0; i < 64; i++) {
            dict2.push(huff.readUInt32BE(off2 + i * 4));
        }

        this.mincode = [0];
        this.maxcode = [0];
        
        for (let codelen = 1; codelen <= 32; codelen++) {
            const mincode = dict2[(codelen - 1) * 2];
            const maxcode = dict2[(codelen - 1) * 2 + 1];
            this.mincode.push(mincode << (32 - codelen));
            this.maxcode.push(((maxcode + 1) << (32 - codelen)) - 1);
        }
    }

    loadCdic(cdic) {
        if (!cdic.slice(0, 8).equals(Buffer.from('CDIC\x00\x00\x00\x10'))) {
            throw new Error('Invalid cdic header');
        }
        
        const phrases = cdic.readUInt32BE(8);
        const bits = cdic.readUInt32BE(12);
        const n = Math.min(1 << bits, phrases - this.dictionary.length);

        for (let i = 0; i < n; i++) {
            const off = cdic.readUInt16BE(16 + i * 2);
            const blen = cdic.readUInt16BE(16 + off);
            const slice = cdic.slice(18 + off, 18 + off + (blen & 0x7fff));
            const flag = blen & 0x8000;
            this.dictionary.push([slice, flag]);
        }
    }

    unpack(data) {
        let bitsleft = data.length * 8;
        data = Buffer.concat([data, Buffer.alloc(8)]);
        let pos = 0;
        let x = data.readUInt32BE(pos);
        let n = 32;
        
        let s = Buffer.alloc(0);
        
        while (true) {
            if (n <= 0) {
                pos += 4;
                x = data.readUInt32BE(pos);
                n += 32;
            }
            
            const code = (x >>> n) & 0xffffffff;
            const [codelen, term, maxcode] = this.dict1[code >>> 24];
            
            let actualCodelen = codelen;
            if (!term) {
                while (code < this.mincode[actualCodelen]) {
                    actualCodelen++;
                }
            }
            
            n -= actualCodelen;
            bitsleft -= actualCodelen;
            
            if (bitsleft < 0) {
                break;
            }
            
            const actualMaxcode = term ? maxcode : this.maxcode[actualCodelen];
            const r = (actualMaxcode - code) >>> (32 - actualCodelen);
            let [slice, flag] = this.dictionary[r];
            
            if (!flag) {
                this.dictionary[r] = null;
                slice = this.unpack(slice);
                this.dictionary[r] = [slice, 1];
            }
            
            s = Buffer.concat([s, slice]);
        }
        
        return s;
    }
}

module.exports = {
    UncompressedReader,
    PalmdocReader,
    HuffcdicReader
};
