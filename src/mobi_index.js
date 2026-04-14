/**
 * mobi_index.js
 * JavaScript equivalent of Python mobi_index.py
 * Handles MOBI INDX (index) section parsing
 */

const { bchr, bord } = require('./compatibility_utils');
const { toHex } = require('./mobi_utils');

class MobiIndex {
    constructor(sect, DEBUG = false) {
        this.sect = sect;
        this.DEBUG = DEBUG;
    }

    getIndexData(idx, label = "Unknown") {
        const sect = this.sect;
        const outtbl = [];
        const ctoc_text = {};
        if (idx !== 0xffffffff) {
            sect.setSectionDescription(idx, `${label} Main INDX section`);
            let data = sect.loadSection(idx);
            const [idxhdr, hordt1, hordt2] = this.parseINDXHeader(data);
            const IndexCount = idxhdr.count;
            let rec_off = 0;
            const off = idx + IndexCount + 1;
            for (let j = 0; j < idxhdr.nctoc; j++) {
                const cdata = sect.loadSection(off + j);
                sect.setSectionDescription(off + j, label + ' CTOC Data ' + j);
                const ctocdict = this.readCTOC(cdata);
                for (const k in ctocdict) {
                    ctoc_text[parseInt(k) + rec_off] = ctocdict[k];
                }
                rec_off += 0x10000;
            }
            const tagSectionStart = idxhdr.len;
            const [controlByteCount, tagTable] = readTagSection(tagSectionStart, data);
            if (this.DEBUG) {
                console.log("ControlByteCount is", controlByteCount);
                console.log("IndexCount is", IndexCount);
                console.log("TagTable:", tagTable);
            }
            for (let i = idx + 1; i < idx + 1 + IndexCount; i++) {
                sect.setSectionDescription(i, `${label} Extra ${i - idx} INDX section`);
                data = sect.loadSection(i);
                const [hdrinfo, ordt1, ordt2] = this.parseINDXHeader(data);
                const idxtPos = hdrinfo.start;
                const entryCount = hdrinfo.count;
                if (this.DEBUG) {
                    console.log(idxtPos, entryCount);
                }
                const idxPositions = [];
                for (let j = 0; j < entryCount; j++) {
                    const pos = data.readUInt16BE(idxtPos + 4 + (2 * j));
                    idxPositions.push(pos);
                }
                idxPositions.push(idxtPos);
                for (let j = 0; j < entryCount; j++) {
                    const startPos = idxPositions[j];
                    const endPos = idxPositions[j + 1];
                    const textLength = data[startPos];
                    let text = data.slice(startPos + 1, startPos + 1 + textLength);
                    if (hordt2 !== null) {
                        const transformed = [];
                        for (let x = 0; x < text.length; x++) {
                            transformed.push(bchr(hordt2[bord(text[x])]));
                        }
                        text = Buffer.concat(transformed);
                    }
                    const tagMap = getTagMap(controlByteCount, tagTable, data, startPos + 1 + textLength, endPos);
                    outtbl.push([text, tagMap]);
                    if (this.DEBUG) {
                        console.log(tagMap);
                        console.log(text);
                    }
                }
            }
        }
        return [outtbl, ctoc_text];
    }

    parseINDXHeader(data) {
        if (!data.slice(0, 4).equals(Buffer.from('INDX'))) {
            console.log("Warning: index section is not INDX");
            return false;
        }
        const words = [
            'len', 'nul1', 'type', 'gen', 'start', 'count', 'code',
            'lng', 'total', 'ordt', 'ligt', 'nligt', 'nctoc'
        ];
        const num = words.length;
        const values = [];
        for (let n = 0; n < num; n++) {
            values.push(data.readUInt32BE(4 + n * 4));
        }
        const header = {};
        for (let n = 0; n < num; n++) {
            header[words[n]] = values[n];
        }

        let ordt1 = null;
        let ordt2 = null;

        const ocnt = data.readUInt32BE(0xa4);
        const oentries = data.readUInt32BE(0xa8);
        const op1 = data.readUInt32BE(0xac);
        const op2 = data.readUInt32BE(0xb0);
        // const otagx = data.readUInt32BE(0xb4);

        if (header.code === 0xfdea || ocnt !== 0 || oentries > 0) {
            if (ocnt !== 1) {
                throw new Error(`assertion failed: ocnt == 1 (got ${ocnt})`);
            }
            if (!data.slice(op1, op1 + 4).equals(Buffer.from('ORDT'))) {
                throw new Error(`assertion failed: data at op1 is ORDT`);
            }
            if (!data.slice(op2, op2 + 4).equals(Buffer.from('ORDT'))) {
                throw new Error(`assertion failed: data at op2 is ORDT`);
            }
            ordt1 = [];
            for (let i = 0; i < oentries; i++) {
                ordt1.push(data[op1 + 4 + i]);
            }
            ordt2 = [];
            for (let i = 0; i < oentries; i++) {
                ordt2.push(data.readUInt16BE(op2 + 4 + i * 2));
            }
        }

        if (this.DEBUG) {
            console.log("parsed INDX header:");
            for (const n of words) {
                process.stdout.write(n + ' ' + header[n].toString(16).toUpperCase() + ' ');
            }
            console.log("");
        }
        return [header, ordt1, ordt2];
    }

    readCTOC(txtdata) {
        const ctoc_data = {};
        let offset = 0;
        while (offset < txtdata.length) {
            if (txtdata[offset] === 0) {
                break;
            }
            const idx_offs = offset;
            const [pos, ilen] = getVariableWidthValue(txtdata, offset);
            offset += pos;
            const name = txtdata.slice(offset, offset + ilen);
            offset += ilen;
            if (this.DEBUG) {
                console.log("name length is ", ilen);
                console.log(idx_offs, name);
            }
            ctoc_data[idx_offs] = name;
        }
        return ctoc_data;
    }
}

function getVariableWidthValue(data, offset) {
    let value = 0;
    let consumed = 0;
    let finished = false;
    while (!finished) {
        const v = data[offset + consumed];
        consumed += 1;
        if (v & 0x80) {
            finished = true;
        }
        value = (value << 7) | (v & 0x7f);
    }
    return [consumed, value];
}

function readTagSection(start, data) {
    let controlByteCount = 0;
    const tags = [];
    if (data.slice(start, start + 4).equals(Buffer.from('TAGX'))) {
        const firstEntryOffset = data.readUInt32BE(start + 0x04);
        controlByteCount = data.readUInt32BE(start + 0x08);

        for (let i = 12; i < firstEntryOffset; i += 4) {
            const pos = start + i;
            tags.push([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]);
        }
    }
    return [controlByteCount, tags];
}

function countSetBits(value, bits = 8) {
    let count = 0;
    for (let i = 0; i < bits; i++) {
        if ((value & 0x01) === 0x01) {
            count += 1;
        }
        value = value >> 1;
    }
    return count;
}

function getTagMap(controlByteCount, tagTable, entryData, startPos, endPos) {
    const tags = [];
    const tagHashMap = {};
    let controlByteIndex = 0;
    let dataStart = startPos + controlByteCount;

    for (let [tag, valuesPerEntry, mask, endFlag] of tagTable) {
        if (endFlag === 0x01) {
            controlByteIndex += 1;
            continue;
        }
        if (0) {
            console.log("Control Byte Index %0x , Control Byte Value %0x", controlByteIndex, entryData[startPos + controlByteIndex]);
        }

        let value = entryData[startPos + controlByteIndex] & mask;
        if (value !== 0) {
            if (value === mask) {
                if (countSetBits(mask) > 1) {
                    const [consumed, val] = getVariableWidthValue(entryData, dataStart);
                    dataStart += consumed;
                    tags.push([tag, null, val, valuesPerEntry]);
                } else {
                    tags.push([tag, 1, null, valuesPerEntry]);
                }
            } else {
                while ((mask & 0x01) === 0) {
                    mask = mask >> 1;
                    value = value >> 1;
                }
                tags.push([tag, value, null, valuesPerEntry]);
            }
        }
    }
    for (const [tag, valueCount, valueBytes, valuesPerEntry] of tags) {
        const values = [];
        if (valueCount !== null) {
            for (let i = 0; i < valueCount; i++) {
                for (let j = 0; j < valuesPerEntry; j++) {
                    const [consumed, data] = getVariableWidthValue(entryData, dataStart);
                    dataStart += consumed;
                    values.push(data);
                }
            }
        } else {
            let totalConsumed = 0;
            while (totalConsumed < valueBytes) {
                const [consumed, data] = getVariableWidthValue(entryData, dataStart);
                dataStart += consumed;
                totalConsumed += consumed;
                values.push(data);
            }
            if (totalConsumed !== valueBytes) {
                console.log(`Error: Should consume ${valueBytes} bytes, but consumed ${totalConsumed}`);
            }
        }
        tagHashMap[tag] = values;
    }
    if (endPos !== null && dataStart !== endPos) {
        for (let i = dataStart; i < endPos; i++) {
            if (entryData[i] !== 0) {
                console.log(`Warning: There are unprocessed index bytes left: ${toHex(entryData.slice(dataStart, endPos))}`);
                if (0) {
                    console.log(`controlByteCount: ${controlByteCount}`);
                    console.log(`tagTable: ${tagTable}`);
                    console.log(`data: ${toHex(entryData.slice(startPos, endPos))}`);
                    console.log(`tagHashMap: ${JSON.stringify(tagHashMap)}`);
                }
                break;
            }
        }
    }

    return tagHashMap;
}

module.exports = {
    getVariableWidthValue,
    readTagSection,
    getTagMap,
    MobiIndex
};
