const { hexlify, unicodeStr } = require('./compatibility_utils');
const { getLanguage } = require('./mobi_utils');
const { HuffcdicReader, PalmdocReader, UncompressedReader } = require('./mobi_uncompress');

const DEBUG_USE_ORDERED_DICTIONARY = false;

function sortedHeaderKeys(mheader) {
    return Object.keys(mheader).sort((a, b) => mheader[a][0] - mheader[b][0]);
}

class unpackException extends Error {
    constructor(message) {
        super(message);
        this.name = 'unpackException';
    }
}

function decodeBytes(buf, codec) {
    const enc = codec === 'windows-1252' ? 'latin1' : codec;
    return unicodeStr(buf, enc);
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// HD Containers have their own headers and their own EXTH
// this is just guesswork so far, making big assumption that
// metavalue key numbers remain the same in the CONT EXTH

// Note:  The layout of the CONT Header is still unknown
// so just deal with their EXTH sections for now

function dump_contexth(cpage, extheader) {
    // determine text encoding
    let codec = 'windows-1252';
    const codecMap = {
        1252: 'windows-1252',
        65001: 'utf-8',
    };
    if (cpage in codecMap) {
        codec = codecMap[cpage];
    }
    if (extheader.length === 0) {
        return;
    }
    const idMapStrings = {
        1: 'Drm Server Id',
        2: 'Drm Commerce Id',
        3: 'Drm Ebookbase Book Id',
        4: 'Drm Ebookbase Dep Id',
        100: 'Creator',
        101: 'Publisher',
        102: 'Imprint',
        103: 'Description',
        104: 'ISBN',
        105: 'Subject',
        106: 'Published',
        107: 'Review',
        108: 'Contributor',
        109: 'Rights',
        110: 'SubjectCode',
        111: 'Type',
        112: 'Source',
        113: 'ASIN',
        // 114: 'versionNumber',
        117: 'Adult',
        118: 'Retail-Price',
        119: 'Retail-Currency',
        120: 'TSC',
        122: 'fixed-layout',
        123: 'book-type',
        124: 'orientation-lock',
        126: 'original-resolution',
        127: 'zero-gutter',
        128: 'zero-margin',
        129: 'MetadataResourceURI',
        132: 'RegionMagnification',
        150: 'LendingEnabled',
        200: 'DictShortName',
        501: 'cdeType',
        502: 'last_update_time',
        503: 'Updated_Title',
        504: 'CDEContentKey',
        505: 'AmazonContentReference',
        506: 'Title-Language',
        507: 'Title-Display-Direction',
        508: 'Title-Pronunciation',
        509: 'Title-Collation',
        510: 'Secondary-Title',
        511: 'Secondary-Title-Language',
        512: 'Secondary-Title-Direction',
        513: 'Secondary-Title-Pronunciation',
        514: 'Secondary-Title-Collation',
        515: 'Author-Language',
        516: 'Author-Display-Direction',
        517: 'Author-Pronunciation',
        518: 'Author-Collation',
        519: 'Author-Type',
        520: 'Publisher-Language',
        521: 'Publisher-Display-Direction',
        522: 'Publisher-Pronunciation',
        523: 'Publisher-Collation',
        524: 'Content-Language-Tag',
        525: 'primary-writing-mode',
        526: 'NCX-Ingested-By-Software',
        527: 'page-progression-direction',
        528: 'override-kindle-fonts',
        529: 'Compression-Upgraded',
        530: 'Soft-Hyphens-In-Content',
        531: 'Dictionary_In_Langague',
        532: 'Dictionary_Out_Language',
        533: 'Font_Converted',
        534: 'Amazon_Creator_Info',
        535: 'Creator-Build-Tag',
        536: 'HD-Media-Containers-Info',  // CONT_Header is 0, Ends with CONTAINER_BOUNDARY (or Asset_Type?)
        538: 'Resource-Container-Fidelity',
        539: 'HD-Container-Mimetype',
        540: 'Sample-For_Special-Purpose',
        541: 'Kindletool-Operation-Information',
        542: 'Container_Id',
        543: 'Asset-Type',  // FONT_CONTAINER, BW_CONTAINER, HD_CONTAINER
        544: 'Unknown_544',
    };
    const idMapValues = {
        114: 'versionNumber',
        115: 'sample',
        116: 'StartOffset',
        121: 'Mobi8-Boundary-Section',
        125: 'Embedded-Record-Count',
        130: 'Offline-Sample',
        131: 'Metadata-Record-Offset',
        201: 'CoverOffset',
        202: 'ThumbOffset',
        203: 'HasFakeCover',
        204: 'Creator-Software',
        205: 'Creator-Major-Version',
        206: 'Creator-Minor-Version',
        207: 'Creator-Build-Number',
        401: 'Clipping-Limit',
        402: 'Publisher-Limit',
        404: 'Text-to-Speech-Disabled',
        406: 'Rental-Expiration-Time',
    };
    const idMapHexstrings = {
        208: 'Watermark_(hex)',
        209: 'Tamper-Proof-Keys_(hex)',
        300: 'Font-Signature_(hex)',
        403: 'Unknown_(403)_(hex)',
        405: 'Ownership-Type_(hex)',
        407: 'Unknown_(407)_(hex)',
        420: 'Multimedia-Content-Reference_(hex)',
        450: 'Locations_Match_(hex)',
        451: 'Full-Story-Length_(hex)',
        452: 'Sample-Start_Location_(hex)',
        453: 'Sample-End-Location_(hex)',
    };
    const _length = extheader.readUInt32BE(4);
    const numItems = extheader.readUInt32BE(8);
    extheader = extheader.slice(12);
    let pos = 0;
    for (let i = 0; i < numItems; i++) {
        const id = extheader.readUInt32BE(pos);
        const size = extheader.readUInt32BE(pos + 4);
        const content = extheader.slice(pos + 8, pos + size);
        if (id in idMapStrings) {
            const name = idMapStrings[id];
            console.log(`\n    Key: "${name}"\n        Value: "${decodeBytes(content, codec)}"`);
        } else if (id in idMapValues) {
            const name = idMapValues[id];
            if (size === 9) {
                const value = content.readUInt8(0);
                console.log(`\n    Key: "${name}"\n        Value: 0x${value.toString(16)}`);
            } else if (size === 10) {
                const value = content.readUInt16BE(0);
                console.log(`\n    Key: "${name}"\n        Value: 0x${value.toString(16).padStart(2, '0')}`);
            } else if (size === 12) {
                const value = content.readUInt32BE(0);
                console.log(`\n    Key: "${name}"\n        Value: 0x${value.toString(16).padStart(4, '0')}`);
            } else {
                console.log(`\nError: Value for ${name} has unexpected size of ${size}`);
            }
        } else if (id in idMapHexstrings) {
            const name = idMapHexstrings[id];
            console.log(`\n    Key: "${name}"\n        Value: 0x${hexlify(content)}`);
        } else {
            console.log(`\nWarning: Unknown metadata with id ${id} found`);
            const name = String(id) + ' (hex)';
            console.log(`    Key: "${name}"\n        Value: 0x${hexlify(content)}`);
        }
        pos += size;
    }
}

class MobiHeader {
    constructor(sect, sectNumber) {
        this.sect = sect;
        this.start = sectNumber;
        this.header = this.sect.loadSection(this.start);
        if (this.header.length > 20 && this.header.slice(16, 20).equals(Buffer.from('MOBI'))) {
            this.sect.setSectionDescription(0, 'Mobipocket Header');
            this.palm = false;
        } else if (this.sect.ident.equals(Buffer.from('TEXtREAd'))) {
            this.sect.setSectionDescription(0, 'PalmDOC Header');
            this.palm = true;
        } else {
            throw new unpackException('Unknown File Format');
        }

        this.records = this.header.readUInt16BE(0x8);

        // set defaults in case this is a PalmDOC
        this.title = decodeBytes(this.sect.palmName, 'latin1');
        this.length = this.header.length - 16;
        this.type = 3;
        this.codepage = 1252;
        this.codec = 'windows-1252';
        this.unique_id = 0;
        this.version = 0;
        this.hasExth = false;
        this.exth = Buffer.alloc(0);
        this.exth_offset = this.length + 16;
        this.exth_length = 0;
        this.crypto_type = 0;
        this.firstnontext = this.start + this.records + 1;
        this.firstresource = this.start + this.records + 1;
        this.ncxidx = 0xffffffff;
        this.metaOrthIndex = 0xffffffff;
        this.metaInflIndex = 0xffffffff;
        this.skelidx = 0xffffffff;
        this.fragidx = 0xffffffff;
        this.guideidx = 0xffffffff;
        this.fdst = 0xffffffff;
        this.mlstart = this.sect.loadSection(this.start + 1).slice(0, 4);
        this.rawSize = 0;
        this.metadata = {};

        // set up for decompression/unpacking
        this.compression = this.header.readUInt16BE(0x0);
        if (this.compression === 0x4448) {
            const reader = new HuffcdicReader();
            const huffoff = this.header.readUInt32BE(0x70);
            const huffnum = this.header.readUInt32BE(0x74);
            const actualHuffoff = huffoff + this.start;
            this.sect.setSectionDescription(actualHuffoff, 'Huffman Compression Seed');
            reader.loadHuff(this.sect.loadSection(actualHuffoff));
            for (let i = 1; i < huffnum; i++) {
                this.sect.setSectionDescription(actualHuffoff + i, `Huffman CDIC Compression Seed ${i}`);
                reader.loadCdic(this.sect.loadSection(actualHuffoff + i));
            }
            this.unpack = reader.unpack.bind(reader);
        } else if (this.compression === 2) {
            const reader = new PalmdocReader();
            this.unpack = reader.unpack.bind(reader);
        } else if (this.compression === 1) {
            const reader = new UncompressedReader();
            this.unpack = reader.unpack.bind(reader);
        } else {
            throw new unpackException(`invalid compression type: 0x${this.compression.toString(16).padStart(4, '0')}`);
        }

        if (this.palm) {
            return;
        }

        this.length = this.header.readUInt32BE(20);
        this.type = this.header.readUInt32BE(24);
        this.codepage = this.header.readUInt32BE(28);
        this.unique_id = this.header.readUInt32BE(32);
        this.version = this.header.readUInt32BE(36);

        const codecMap = {
            1252: 'windows-1252',
            65001: 'utf-8',
        };
        if (this.codepage in codecMap) {
            this.codec = codecMap[this.codepage];
        }

        // title
        const toff = this.header.readUInt32BE(0x54);
        const tlen = this.header.readUInt32BE(0x58);
        const tend = toff + tlen;
        this.title = decodeBytes(this.header.slice(toff, tend), this.codec);

        const exthFlag = this.header.readUInt32BE(0x80);
        this.hasExth = exthFlag & 0x40;
        this.exth_offset = this.length + 16;
        this.exth_length = 0;
        if (this.hasExth) {
            this.exth_length = this.header.readUInt32BE(this.exth_offset + 4);
            this.exth_length = ((this.exth_length + 3) >> 2) << 2;  // round to next 4 byte boundary
            this.exth = this.header.slice(this.exth_offset, this.exth_offset + this.exth_length);
        }

        // parse the exth / metadata
        this.parseMetaData();

        // this.mlstart = this.sect.loadSection(this.start + 1)
        // this.mlstart = this.mlstart.slice(0, 4)
        this.crypto_type = this.header.readUInt16BE(0xC);

        // Start sector for additional files such as images, fonts, resources, etc
        // Can be missing so fall back to default set previously
        let ofst = this.header.readUInt32BE(0x6C);
        if (ofst !== 0xffffffff) {
            this.firstresource = ofst + this.start;
        }
        ofst = this.header.readUInt32BE(0x50);
        if (ofst !== 0xffffffff) {
            this.firstnontext = ofst + this.start;
        }

        if (this.isPrintReplica()) {
            return;
        }

        if (this.version < 8) {
            // Dictionary metaOrthIndex
            this.metaOrthIndex = this.header.readUInt32BE(0x28);
            if (this.metaOrthIndex !== 0xffffffff) {
                this.metaOrthIndex += this.start;
            }

            // Dictionary metaInflIndex
            this.metaInflIndex = this.header.readUInt32BE(0x2C);
            if (this.metaInflIndex !== 0xffffffff) {
                this.metaInflIndex += this.start;
            }
        }

        // handle older headers without any ncxindex info and later
        // specifically 0xe4 headers
        if (this.length + 16 < 0xf8) {
            return;
        }

        // NCX Index
        this.ncxidx = this.header.readUInt32BE(0xf4);
        if (this.ncxidx !== 0xffffffff) {
            this.ncxidx += this.start;
        }

        // K8 specific Indexes
        if (this.start !== 0 || this.version === 8) {
            // Index into <xml> file skeletons in RawML
            this.skelidx = this.header.readUInt32BE(0xfc);
            if (this.skelidx !== 0xffffffff) {
                this.skelidx += this.start;
            }

            // Index into <div> sections in RawML
            this.fragidx = this.header.readUInt32BE(0xf8);
            if (this.fragidx !== 0xffffffff) {
                this.fragidx += this.start;
            }

            // Index into Other files
            this.guideidx = this.header.readUInt32BE(0x104);
            if (this.guideidx !== 0xffffffff) {
                this.guideidx += this.start;
            }

            // dictionaries do not seem to use the same approach in K8's
            // so disable them
            this.metaOrthIndex = 0xffffffff;
            this.metaInflIndex = 0xffffffff;

            // need to use the FDST record to find out how to properly unpack
            // the rawML into pieces
            // it is simply a table of start and end locations for each flow piece
            this.fdst = this.header.readUInt32BE(0xc0);
            this.fdstcnt = this.header.readUInt32BE(0xc4);
            // if cnt is 1 or less, fdst section mumber can be garbage
            if (this.fdstcnt <= 1) {
                this.fdst = 0xffffffff;
            }
            if (this.fdst !== 0xffffffff) {
                this.fdst += this.start;
                // setting of fdst section description properly handled in mobi_kf8proc
            }
        }
    }

    dump_exth() {
        // determine text encoding
        const codec = this.codec;
        if (!this.hasExth || this.exth_length === 0 || this.exth.length === 0) {
            return;
        }
        const numItems = this.exth.readUInt32BE(8);
        let pos = 12;
        console.log('Key Size Description                    Value');
        for (let i = 0; i < numItems; i++) {
            const id = this.exth.readUInt32BE(pos);
            const size = this.exth.readUInt32BE(pos + 4);
            const contentSize = size - 8;
            const content = this.exth.slice(pos + 8, pos + size);
            if (id in MobiHeader.id_map_strings) {
                const exthName = MobiHeader.id_map_strings[id];
                console.log(`${String(id).padStart(3)} ${String(contentSize).padStart(4)} ${exthName.padEnd(30)} ${decodeBytes(content, codec)}`);
            } else if (id in MobiHeader.id_map_values) {
                const exthName = MobiHeader.id_map_values[id];
                if (size === 9) {
                    const value = content.readUInt8(0);
                    console.log(`${String(id).padStart(3)} byte ${exthName.padEnd(30)} ${value}`);
                } else if (size === 10) {
                    const value = content.readUInt16BE(0);
                    const hexVal = value.toString(16).padStart(4, '0').toUpperCase();
                    console.log(`${String(id).padStart(3)} word ${exthName.padEnd(30)} 0x${hexVal} (${value})`);
                } else if (size === 12) {
                    const value = content.readUInt32BE(0);
                    const hexVal = value.toString(16).padStart(8, '0').toUpperCase();
                    console.log(`${String(id).padStart(3)} long ${exthName.padEnd(30)} 0x${hexVal} (${value})`);
                } else {
                    console.log(`${String(id).padStart(3)} ${String(contentSize).padStart(4)} ${('Bad size for ' + exthName).padEnd(30)} (0x${hexlify(content)})`);
                }
            } else if (id in MobiHeader.id_map_hexstrings) {
                const exthName = MobiHeader.id_map_hexstrings[id];
                console.log(`${String(id).padStart(3)} ${String(contentSize).padStart(4)} ${exthName.padEnd(30)} 0x${hexlify(content)}`);
            } else {
                const exthName = `Unknown EXTH ID ${id}`;
                console.log(`${String(id).padStart(3)} ${String(contentSize).padStart(4)} ${exthName.padEnd(30)} 0x${hexlify(content)}`);
            }
            pos += size;
        }
    }

    dumpheader() {
        // first 16 bytes are not part of the official mobiheader
        // but we will treat it as such
        // so section 0 is 16 (decimal) + this.length in total == at least 0x108 bytes for Mobi 8 headers
        console.log(`Dumping section ${this.start}, Mobipocket Header version: ${this.version}, total length ${this.length + 16}`);
        this.hdr = {};
        // set it up for the proper header version
        if (this.version === 0) {
            this.mobi_header = MobiHeader.palmdoc_header;
            this.mobi_header_sorted_keys = MobiHeader.palmdoc_header_sorted_keys;
        } else if (this.version < 8) {
            this.mobi_header = MobiHeader.mobi6_header;
            this.mobi_header_sorted_keys = MobiHeader.mobi6_header_sorted_keys;
        } else {
            this.mobi_header = MobiHeader.mobi8_header;
            this.mobi_header_sorted_keys = MobiHeader.mobi8_header_sorted_keys;
        }

        // parse the header information
        for (const key of this.mobi_header_sorted_keys) {
            const [pos, format, totLen] = this.mobi_header[key];
            if (pos < (this.length + 16)) {
                let val;
                if (format === '>H') {
                    val = this.header.readUInt16BE(pos);
                } else if (format === '>L') {
                    val = this.header.readUInt32BE(pos);
                } else if (format === '4s') {
                    val = decodeBytes(this.header.slice(pos, pos + 4), 'latin1');
                }
                this.hdr[key] = val;
            }
        }

        let titleOffset, titleLength;
        if ('title_offset' in this.hdr) {
            titleOffset = this.hdr['title_offset'];
            titleLength = this.hdr['title_length'];
        } else {
            titleOffset = 0;
            titleLength = 0;
        }
        if (titleOffset === 0) {
            titleOffset = this.header.length;
            titleLength = 0;
            this.title = decodeBytes(this.sect.palmName, 'latin1');
        } else {
            this.title = decodeBytes(this.header.slice(titleOffset, titleOffset + titleLength), this.codec);
            // title record always padded with two nul bytes and then padded with nuls to next 4 byte boundary
            titleLength = ((titleLength + 2 + 3) >> 2) << 2;
        }

        this.extra1 = this.header.slice(this.exth_offset + this.exth_length, titleOffset);
        this.extra2 = this.header.slice(titleOffset + titleLength);

        console.log(`Mobipocket header from section ${this.start}`);
        console.log('     Offset  Value Hex Dec        Description');
        for (const key of this.mobi_header_sorted_keys) {
            const [pos, format, totLen] = this.mobi_header[key];
            if (pos < (this.length + 16)) {
                if (key !== 'magic') {
                    const spacePad = ' '.repeat(9 - 2 * totLen);
                    const hexPad = totLen * 2;
                    const hexStr = this.hdr[key].toString(16).padStart(hexPad, '0').toUpperCase();
                    console.log(`0x${pos.toString(16).padStart(3, '0').toUpperCase()} (${String(pos).padStart(3)})${spacePad}0x${hexStr} ${String(this.hdr[key]).padStart(10)} ${key}`);
                } else {
                    this.hdr[key] = unicodeStr(this.hdr[key]);
                    console.log(`0x${pos.toString(16).padStart(3, '0').toUpperCase()} (${String(pos).padStart(3)})${this.hdr[key].padStart(11)}            ${key}`);
                }
            }
        }
        console.log('');

        if (this.exth_length > 0) {
            console.log(`EXTH metadata, offset ${this.exth_offset}, padded length ${this.exth_length}`);
            this.dump_exth();
            console.log('');
        }

        if (this.extra1.length > 0) {
            console.log(`Extra data between EXTH and Title, length ${this.extra1.length}`);
            console.log(hexlify(this.extra1));
            console.log('');
        }

        if (titleLength > 0) {
            console.log(`Title in header at offset ${titleOffset}, padded length ${titleLength}: '${this.title}'`);
            console.log('');
        }

        if (this.extra2.length > 0) {
            console.log(`Extra data between Title and end of header, length ${this.extra2.length}`);
            console.log(hexlify(this.extra2));
            console.log('');
        }
    }

    isPrintReplica() {
        return this.mlstart.slice(0, 4).equals(Buffer.from('%MOP'));
    }

    isK8() {
        return this.start !== 0 || this.version === 8;
    }

    isEncrypted() {
        return this.crypto_type !== 0;
    }

    hasNCX() {
        return this.ncxidx !== 0xffffffff;
    }

    isDictionary() {
        return this.metaOrthIndex !== 0xffffffff;
    }

    getncxIndex() {
        return this.ncxidx;
    }

    decompress(data) {
        return this.unpack(data);
    }

    Language() {
        const langcode = this.header.readUInt32BE(0x5c);
        const langid = langcode & 0xFF;
        const sublangid = (langcode >> 10) & 0xFF;
        return getLanguage(langid, sublangid);
    }

    DictInLanguage() {
        if (this.isDictionary()) {
            const langcode = this.header.readUInt32BE(0x60);
            const langid = langcode & 0xFF;
            const sublangid = (langcode >> 10) & 0xFF;
            if (langid !== 0) {
                return getLanguage(langid, sublangid);
            }
        }
        return false;
    }

    DictOutLanguage() {
        if (this.isDictionary()) {
            const langcode = this.header.readUInt32BE(0x64);
            const langid = langcode & 0xFF;
            const sublangid = (langcode >> 10) & 0xFF;
            if (langid !== 0) {
                return getLanguage(langid, sublangid);
            }
        }
        return false;
    }

    getRawML() {
        function getSizeOfTrailingDataEntry(data) {
            let num = 0;
            for (let i = data.length - 4; i < data.length; i++) {
                const v = data[i];
                if (v & 0x80) {
                    num = 0;
                }
                num = (num << 7) | (v & 0x7f);
            }
            return num;
        }
        function trimTrailingDataEntries(data) {
            for (let i = 0; i < trailers; i++) {
                const num = getSizeOfTrailingDataEntry(data);
                data = data.slice(0, -num);
            }
            if (multibyte) {
                const num = (data[data.length - 1] & 3) + 1;
                data = data.slice(0, -num);
            }
            return data;
        }
        let multibyte = 0;
        let trailers = 0;
        if (this.sect.ident.equals(Buffer.from('BOOKMOBI'))) {
            const mobiLength = this.header.readUInt32BE(0x14);
            const mobiVersion = this.header.readUInt32BE(0x68);
            if (mobiLength >= 0xE4 && mobiVersion >= 5) {
                let flags = this.header.readUInt16BE(0xF2);
                multibyte = flags & 1;
                while (flags > 1) {
                    if (flags & 2) {
                        trailers += 1;
                    }
                    flags = flags >> 1;
                }
            }
        }
        // get raw mobi markup language
        console.log('Unpacking raw markup language');
        const dataList = [];
        // offset = 0
        for (let i = 1; i <= this.records; i++) {
            const data = trimTrailingDataEntries(this.sect.loadSection(this.start + i));
            dataList.push(this.unpack(data));
            if (this.isK8()) {
                this.sect.setSectionDescription(this.start + i, `KF8 Text Section ${i}`);
            } else if (this.version === 0) {
                this.sect.setSectionDescription(this.start + i, `PalmDOC Text Section ${i}`);
            } else {
                this.sect.setSectionDescription(this.start + i, `Mobipocket Text Section ${i}`);
            }
        }
        const rawML = Buffer.concat(dataList);
        this.rawSize = rawML.length;
        return rawML;
    }

    // all metadata is stored in a dictionary with key and returns a *list* of values
    // a list is used to allow for multiple creators, multiple contributors, etc
    parseMetaData() {
        const addValue = (name, value) => {
            if (!(name in this.metadata)) {
                this.metadata[name] = [value];
            } else {
                this.metadata[name].push(value);
            }
        };

        const codec = this.codec;
        if (this.hasExth) {
            let extheader = this.exth;
            const _length = extheader.readUInt32BE(4);
            const numItems = extheader.readUInt32BE(8);
            extheader = extheader.slice(12);
            let pos = 0;
            for (let i = 0; i < numItems; i++) {
                const id = extheader.readUInt32BE(pos);
                const size = extheader.readUInt32BE(pos + 4);
                const content = extheader.slice(pos + 8, pos + size);
                if (id in MobiHeader.id_map_strings) {
                    const name = MobiHeader.id_map_strings[id];
                    addValue(name, decodeBytes(content, codec));
                } else if (id in MobiHeader.id_map_values) {
                    const name = MobiHeader.id_map_values[id];
                    if (size === 9) {
                        const value = content.readUInt8(0);
                        addValue(name, String(value));
                    } else if (size === 10) {
                        const value = content.readUInt16BE(0);
                        addValue(name, String(value));
                    } else if (size === 12) {
                        const value = content.readUInt32BE(0);
                        // handle special case of missing CoverOffset or missing ThumbOffset
                        if (id === 201 || id === 202) {
                            if (value !== 0xffffffff) {
                                addValue(name, String(value));
                            }
                        } else {
                            addValue(name, String(value));
                        }
                    } else {
                        console.log('Warning: Bad key, size, value combination detected in EXTH ', id, size, hexlify(content));
                        addValue(name, hexlify(content));
                    }
                } else if (id in MobiHeader.id_map_hexstrings) {
                    const name = MobiHeader.id_map_hexstrings[id];
                    addValue(name, hexlify(content));
                } else {
                    const name = String(id) + ' (hex)';
                    addValue(name, hexlify(content));
                }
                pos += size;
            }
        }

        // add the basics to the metadata each as a list element
        this.metadata['Language'] = [this.Language()];
        this.metadata['Title'] = [this.title];
        this.metadata['Codec'] = [this.codec];
        this.metadata['UniqueID'] = [String(this.unique_id)];
        // if no asin create one using a uuid
        if (!('ASIN' in this.metadata)) {
            this.metadata['ASIN'] = [generateUUID()];
        }
        // if no cdeType set it to 'EBOK'
        if (!('cdeType' in this.metadata)) {
            this.metadata['cdeType'] = ['EBOK'];
        }
    }

    getMetaData() {
        return this.metadata;
    }

    describeHeader(DUMP) {
        console.log('Mobi Version:', this.version);
        console.log('Codec:', this.codec);
        console.log('Title:', this.title);
        if ('Updated_Title' in this.metadata) {
            console.log('EXTH Title:', this.metadata['Updated_Title'][0]);
        }
        if (this.compression === 0x4448) {
            console.log('Huffdic compression');
        } else if (this.compression === 2) {
            console.log('Palmdoc compression');
        } else if (this.compression === 1) {
            console.log('No compression');
        }
        if (DUMP) {
            this.dumpheader();
        }
    }
}

MobiHeader.palmdoc_header = {
    'compression_type': [0x00, '>H', 2],
    'fill0': [0x02, '>H', 2],
    'text_length': [0x04, '>L', 4],
    'text_records': [0x08, '>H', 2],
    'max_section_size': [0x0a, '>H', 2],
    'read_pos   ': [0x0c, '>L', 4],
};

MobiHeader.mobi6_header = {
    'compression_type': [0x00, '>H', 2],
    'fill0': [0x02, '>H', 2],
    'text_length': [0x04, '>L', 4],
    'text_records': [0x08, '>H', 2],
    'max_section_size': [0x0a, '>H', 2],
    'crypto_type': [0x0c, '>H', 2],
    'fill1': [0x0e, '>H', 2],
    'magic': [0x10, '4s', 4],
    'header_length (from MOBI)': [0x14, '>L', 4],
    'type': [0x18, '>L', 4],
    'codepage': [0x1c, '>L', 4],
    'unique_id': [0x20, '>L', 4],
    'version': [0x24, '>L', 4],
    'metaorthindex': [0x28, '>L', 4],
    'metainflindex': [0x2c, '>L', 4],
    'index_names': [0x30, '>L', 4],
    'index_keys': [0x34, '>L', 4],
    'extra_index0': [0x38, '>L', 4],
    'extra_index1': [0x3c, '>L', 4],
    'extra_index2': [0x40, '>L', 4],
    'extra_index3': [0x44, '>L', 4],
    'extra_index4': [0x48, '>L', 4],
    'extra_index5': [0x4c, '>L', 4],
    'first_nontext': [0x50, '>L', 4],
    'title_offset': [0x54, '>L', 4],
    'title_length': [0x58, '>L', 4],
    'language_code': [0x5c, '>L', 4],
    'dict_in_lang': [0x60, '>L', 4],
    'dict_out_lang': [0x64, '>L', 4],
    'min_version': [0x68, '>L', 4],
    'first_resc_offset': [0x6c, '>L', 4],
    'huff_offset': [0x70, '>L', 4],
    'huff_num': [0x74, '>L', 4],
    'huff_tbl_offset': [0x78, '>L', 4],
    'huff_tbl_len': [0x7c, '>L', 4],
    'exth_flags': [0x80, '>L', 4],
    'fill3_a': [0x84, '>L', 4],
    'fill3_b': [0x88, '>L', 4],
    'fill3_c': [0x8c, '>L', 4],
    'fill3_d': [0x90, '>L', 4],
    'fill3_e': [0x94, '>L', 4],
    'fill3_f': [0x98, '>L', 4],
    'fill3_g': [0x9c, '>L', 4],
    'fill3_h': [0xa0, '>L', 4],
    'unknown0': [0xa4, '>L', 4],
    'drm_offset': [0xa8, '>L', 4],
    'drm_count': [0xac, '>L', 4],
    'drm_size': [0xb0, '>L', 4],
    'drm_flags': [0xb4, '>L', 4],
    'fill4_a': [0xb8, '>L', 4],
    'fill4_b': [0xbc, '>L', 4],
    'first_content': [0xc0, '>H', 2],
    'last_content': [0xc2, '>H', 2],
    'unknown0': [0xc4, '>L', 4],
    'fcis_offset': [0xc8, '>L', 4],
    'fcis_count': [0xcc, '>L', 4],
    'flis_offset': [0xd0, '>L', 4],
    'flis_count': [0xd4, '>L', 4],
    'unknown1': [0xd8, '>L', 4],
    'unknown2': [0xdc, '>L', 4],
    'srcs_offset': [0xe0, '>L', 4],
    'srcs_count': [0xe4, '>L', 4],
    'unknown3': [0xe8, '>L', 4],
    'unknown4': [0xec, '>L', 4],
    'fill5': [0xf0, '>H', 2],
    'traildata_flags': [0xf2, '>H', 2],
    'ncx_index': [0xf4, '>L', 4],
    'unknown5': [0xf8, '>L', 4],
    'unknown6': [0xfc, '>L', 4],
    'datp_offset': [0x100, '>L', 4],
    'unknown7': [0x104, '>L', 4],
    'Unknown    ': [0x108, '>L', 4],
    'Unknown    ': [0x10C, '>L', 4],
    'Unknown    ': [0x110, '>L', 4],
    'Unknown    ': [0x114, '>L', 4],
    'Unknown    ': [0x118, '>L', 4],
    'Unknown    ': [0x11C, '>L', 4],
    'Unknown    ': [0x120, '>L', 4],
    'Unknown    ': [0x124, '>L', 4],
    'Unknown    ': [0x128, '>L', 4],
    'Unknown    ': [0x12C, '>L', 4],
    'Unknown    ': [0x130, '>L', 4],
    'Unknown    ': [0x134, '>L', 4],
    'Unknown    ': [0x138, '>L', 4],
    'Unknown    ': [0x11C, '>L', 4],
};

MobiHeader.mobi8_header = {
    'compression_type': [0x00, '>H', 2],
    'fill0': [0x02, '>H', 2],
    'text_length': [0x04, '>L', 4],
    'text_records': [0x08, '>H', 2],
    'max_section_size': [0x0a, '>H', 2],
    'crypto_type': [0x0c, '>H', 2],
    'fill1': [0x0e, '>H', 2],
    'magic': [0x10, '4s', 4],
    'header_length (from MOBI)': [0x14, '>L', 4],
    'type': [0x18, '>L', 4],
    'codepage': [0x1c, '>L', 4],
    'unique_id': [0x20, '>L', 4],
    'version': [0x24, '>L', 4],
    'metaorthindex': [0x28, '>L', 4],
    'metainflindex': [0x2c, '>L', 4],
    'index_names': [0x30, '>L', 4],
    'index_keys': [0x34, '>L', 4],
    'extra_index0': [0x38, '>L', 4],
    'extra_index1': [0x3c, '>L', 4],
    'extra_index2': [0x40, '>L', 4],
    'extra_index3': [0x44, '>L', 4],
    'extra_index4': [0x48, '>L', 4],
    'extra_index5': [0x4c, '>L', 4],
    'first_nontext': [0x50, '>L', 4],
    'title_offset': [0x54, '>L', 4],
    'title_length': [0x58, '>L', 4],
    'language_code': [0x5c, '>L', 4],
    'dict_in_lang': [0x60, '>L', 4],
    'dict_out_lang': [0x64, '>L', 4],
    'min_version': [0x68, '>L', 4],
    'first_resc_offset': [0x6c, '>L', 4],
    'huff_offset': [0x70, '>L', 4],
    'huff_num': [0x74, '>L', 4],
    'huff_tbl_offset': [0x78, '>L', 4],
    'huff_tbl_len': [0x7c, '>L', 4],
    'exth_flags': [0x80, '>L', 4],
    'fill3_a': [0x84, '>L', 4],
    'fill3_b': [0x88, '>L', 4],
    'fill3_c': [0x8c, '>L', 4],
    'fill3_d': [0x90, '>L', 4],
    'fill3_e': [0x94, '>L', 4],
    'fill3_f': [0x98, '>L', 4],
    'fill3_g': [0x9c, '>L', 4],
    'fill3_h': [0xa0, '>L', 4],
    'unknown0': [0xa4, '>L', 4],
    'drm_offset': [0xa8, '>L', 4],
    'drm_count': [0xac, '>L', 4],
    'drm_size': [0xb0, '>L', 4],
    'drm_flags': [0xb4, '>L', 4],
    'fill4_a': [0xb8, '>L', 4],
    'fill4_b': [0xbc, '>L', 4],
    'fdst_offset': [0xc0, '>L', 4],
    'fdst_flow_count': [0xc4, '>L', 4],
    'fcis_offset': [0xc8, '>L', 4],
    'fcis_count': [0xcc, '>L', 4],
    'flis_offset': [0xd0, '>L', 4],
    'flis_count': [0xd4, '>L', 4],
    'unknown1': [0xd8, '>L', 4],
    'unknown2': [0xdc, '>L', 4],
    'srcs_offset': [0xe0, '>L', 4],
    'srcs_count': [0xe4, '>L', 4],
    'unknown3': [0xe8, '>L', 4],
    'unknown4': [0xec, '>L', 4],
    'fill5': [0xf0, '>H', 2],
    'traildata_flags': [0xf2, '>H', 2],
    'ncx_index': [0xf4, '>L', 4],
    'fragment_index': [0xf8, '>L', 4],
    'skeleton_index': [0xfc, '>L', 4],
    'datp_offset': [0x100, '>L', 4],
    'guide_index': [0x104, '>L', 4],
    'Unknown    ': [0x108, '>L', 4],
    'Unknown    ': [0x10C, '>L', 4],
    'Unknown    ': [0x110, '>L', 4],
    'Unknown    ': [0x114, '>L', 4],
    'Unknown    ': [0x118, '>L', 4],
    'Unknown    ': [0x11C, '>L', 4],
    'Unknown    ': [0x120, '>L', 4],
    'Unknown    ': [0x124, '>L', 4],
    'Unknown    ': [0x128, '>L', 4],
    'Unknown    ': [0x12C, '>L', 4],
    'Unknown    ': [0x130, '>L', 4],
    'Unknown    ': [0x134, '>L', 4],
    'Unknown    ': [0x138, '>L', 4],
    'Unknown    ': [0x11C, '>L', 4],
};

MobiHeader.palmdoc_header_sorted_keys = sortedHeaderKeys(MobiHeader.palmdoc_header);
MobiHeader.mobi6_header_sorted_keys = sortedHeaderKeys(MobiHeader.mobi6_header);
MobiHeader.mobi8_header_sorted_keys = sortedHeaderKeys(MobiHeader.mobi8_header);

MobiHeader.id_map_strings = {
    1: 'Drm Server Id',
    2: 'Drm Commerce Id',
    3: 'Drm Ebookbase Book Id',
    4: 'Drm Ebookbase Dep Id',
    100: 'Creator',
    101: 'Publisher',
    102: 'Imprint',
    103: 'Description',
    104: 'ISBN',
    105: 'Subject',
    106: 'Published',
    107: 'Review',
    108: 'Contributor',
    109: 'Rights',
    110: 'SubjectCode',
    111: 'Type',
    112: 'Source',
    113: 'ASIN',
    // 114: 'versionNumber',
    117: 'Adult',
    118: 'Retail-Price',
    119: 'Retail-Currency',
    120: 'TSC',
    122: 'fixed-layout',
    123: 'book-type',
    124: 'orientation-lock',
    126: 'original-resolution',
    127: 'zero-gutter',
    128: 'zero-margin',
    129: 'MetadataResourceURI',
    132: 'RegionMagnification',
    150: 'LendingEnabled',
    200: 'DictShortName',
    501: 'cdeType',
    502: 'last_update_time',
    503: 'Updated_Title',
    504: 'CDEContentKey',
    505: 'AmazonContentReference',
    506: 'Title-Language',
    507: 'Title-Display-Direction',
    508: 'Title-Pronunciation',
    509: 'Title-Collation',
    510: 'Secondary-Title',
    511: 'Secondary-Title-Language',
    512: 'Secondary-Title-Direction',
    513: 'Secondary-Title-Pronunciation',
    514: 'Secondary-Title-Collation',
    515: 'Author-Language',
    516: 'Author-Display-Direction',
    517: 'Author-Pronunciation',
    518: 'Author-Collation',
    519: 'Author-Type',
    520: 'Publisher-Language',
    521: 'Publisher-Display-Direction',
    522: 'Publisher-Pronunciation',
    523: 'Publisher-Collation',
    524: 'Content-Language-Tag',
    525: 'primary-writing-mode',
    526: 'NCX-Ingested-By-Software',
    527: 'page-progression-direction',
    528: 'override-kindle-fonts',
    529: 'Compression-Upgraded',
    530: 'Soft-Hyphens-In-Content',
    531: 'Dictionary_In_Langague',
    532: 'Dictionary_Out_Language',
    533: 'Font_Converted',
    534: 'Amazon_Creator_Info',
    535: 'Creator-Build-Tag',
    536: 'HD-Media-Containers-Info',  // CONT_Header is 0, Ends with CONTAINER_BOUNDARY (or Asset_Type?)
    538: 'Resource-Container-Fidelity',
    539: 'HD-Container-Mimetype',
    540: 'Sample-For_Special-Purpose',
    541: 'Kindletool-Operation-Information',
    542: 'Container_Id',
    543: 'Asset-Type',  // FONT_CONTAINER, BW_CONTAINER, HD_CONTAINER
    544: 'Unknown_544',
};

MobiHeader.id_map_values = {
    114: 'versionNumber',
    115: 'sample',
    116: 'StartOffset',
    121: 'Mobi8-Boundary-Section',
    125: 'Embedded-Record-Count',
    130: 'Offline-Sample',
    131: 'Metadata-Record-Offset',
    201: 'CoverOffset',
    202: 'ThumbOffset',
    203: 'HasFakeCover',
    204: 'Creator-Software',
    205: 'Creator-Major-Version',
    206: 'Creator-Minor-Version',
    207: 'Creator-Build-Number',
    401: 'Clipping-Limit',
    402: 'Publisher-Limit',
    404: 'Text-to-Speech-Disabled',
    406: 'Rental-Expiration-Time',
};

MobiHeader.id_map_hexstrings = {
    208: 'Watermark_(hex)',
    209: 'Tamper-Proof-Keys_(hex)',
    300: 'Font-Signature_(hex)',
    403: 'Unknown_(403)_(hex)',
    405: 'Ownership-Type_(hex)',
    407: 'Unknown_(407)_(hex)',
    420: 'Multimedia-Content-Reference_(hex)',
    450: 'Locations_Match_(hex)',
    451: 'Full-Story-Length_(hex)',
    452: 'Sample-Start_Location_(hex)',
    453: 'Sample-End-Location_(hex)',
};

module.exports = {
    MobiHeader,
    dump_contexth,
};
