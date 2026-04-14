/**
 * mobi_dict.js
 * JavaScript equivalent of Python mobi_dict.py
 * Dictionary support for MOBI files
 */

const { utf8Str, bstr, bchr } = require('./compatibility_utils');
const { getVariableWidthValue, readTagSection, getTagMap } = require('./mobi_index');
const { toHex } = require('./mobi_utils');

const DEBUG_DICT = false;

function convertToBytes(ar) {
    return Buffer.from(ar);
}

class InflectionData {
    constructor(infldatas) {
        this.infldatas = infldatas;
        this.starts = [];
        this.counts = [];
        for (const idata of this.infldatas) {
            const start = idata.readUInt32BE(0x14);
            const count = idata.readUInt32BE(0x18);
            this.starts.push(start);
            this.counts.push(count);
        }
    }

    lookup(lookupvalue) {
        let i = 0;
        let rvalue = lookupvalue;
        while (rvalue >= this.counts[i]) {
            rvalue = rvalue - this.counts[i];
            i += 1;
            if (i === this.counts.length) {
                console.log('Error: Problem with multiple inflections data sections');
                return [lookupvalue, this.starts[0], this.counts[0], this.infldatas[0]];
            }
        }
        return [rvalue, this.starts[i], this.counts[i], this.infldatas[i]];
    }

    offsets(value) {
        const [rvalue, start, count, data] = this.lookup(value);
        const offset = data.readUInt16BE(start + 4 + (2 * rvalue));
        let nextOffset = null;
        if (rvalue + 1 < count) {
            nextOffset = data.readUInt16BE(start + 4 + (2 * (rvalue + 1)));
        }
        return [offset, nextOffset, data];
    }
}

class dictSupport {
    constructor(mh, sect) {
        this.mh = mh;
        this.header = mh.header;
        this.sect = sect;
        this.metaOrthIndex = mh.metaOrthIndex;
        this.metaInflIndex = mh.metaInflIndex;
    }

    parseHeader(data) {
        if (!data.slice(0, 4).equals(Buffer.from('INDX'))) {
            console.log('Warning: index section is not INDX');
            return [false, null, null];
        }
        const words = ['len', 'nul1', 'type', 'gen', 'start', 'count', 'code', 'lng', 'total', 'ordt', 'ligt', 'nligt', 'nctoc'];
        const num = words.length;
        const values = [];
        for (let i = 0; i < num; i++) {
            values.push(data.readUInt32BE(4 + i * 4));
        }
        const header = {};
        for (let n = 0; n < num; n++) {
            header[words[n]] = values[n];
        }

        let ordt1 = null;
        let ordt2 = null;

        const otype = data.readUInt32BE(0xa4);
        const oentries = data.readUInt32BE(0xa8);
        const op1 = data.readUInt32BE(0xac);
        const op2 = data.readUInt32BE(0xb0);
        const otagx = data.readUInt32BE(0xb4);
        header.otype = otype;
        header.oentries = oentries;

        if (DEBUG_DICT) {
            console.log('otype %d, oentries %d, op1 %d, op2 %d, otagx %d', otype, oentries, op1, op2, otagx);
        }

        if (header.code === 0xfdea || oentries > 0) {
            if (!data.slice(op1, op1 + 4).equals(Buffer.from('ORDT')) || !data.slice(op2, op2 + 4).equals(Buffer.from('ORDT'))) {
                throw new Error('ORDT assertion failed');
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

        if (DEBUG_DICT) {
            console.log('parsed INDX header:');
            for (const key in header) {
                console.log(key, header[key].toString(16));
            }
            console.log('\n');
        }
        return [header, ordt1, ordt2];
    }

    getPositionMap() {
        const sect = this.sect;
        const positionMap = {};
        const metaOrthIndex = this.metaOrthIndex;
        const metaInflIndex = this.metaInflIndex;

        let decodeInflection = true;
        if (metaOrthIndex !== 0xFFFFFFFF) {
            console.log('Info: Document contains orthographic index, handle as dictionary');
            let dinfl = null;
            let inflNameData = null;
            let inflectionControlByteCount = 0;
            let inflectionTagTable = null;
            
            if (metaInflIndex === 0xFFFFFFFF) {
                decodeInflection = false;
            } else {
                const metaInflIndexData = sect.loadSection(metaInflIndex);
                console.log('\nParsing metaInflIndexData');
                const [midxhdr, mhordt1, mhordt2] = this.parseHeader(metaInflIndexData);

                const metaIndexCount = midxhdr.count;
                const idatas = [];
                for (let j = 0; j < metaIndexCount; j++) {
                    idatas.push(sect.loadSection(metaInflIndex + 1 + j));
                }
                dinfl = new InflectionData(idatas);

                inflNameData = sect.loadSection(metaInflIndex + 1 + metaIndexCount);
                const tagSectionStart = midxhdr.len;
                [inflectionControlByteCount, inflectionTagTable] = readTagSection(tagSectionStart, metaInflIndexData);
                if (DEBUG_DICT) {
                    console.log('inflectionTagTable: %s', inflectionTagTable);
                }
                if (this.hasTag(inflectionTagTable, 0x07)) {
                    console.log('Error: Dictionary uses obsolete inflection rule scheme which is not yet supported');
                    decodeInflection = false;
                }
            }

            let data = sect.loadSection(metaOrthIndex);
            console.log('\nParsing metaOrthIndex');
            const [idxhdr, hordt1, hordt2] = this.parseHeader(data);

            const tagSectionStart = idxhdr.len;
            const [controlByteCount, tagTable] = readTagSection(tagSectionStart, data);
            const orthIndexCount = idxhdr.count;
            console.log('orthIndexCount is', orthIndexCount);
            if (DEBUG_DICT) {
                console.log('orthTagTable: %s', tagTable);
            }
            if (hordt2 !== null) {
                console.log('orth entry uses ordt2 lookup table of type ', idxhdr.otype);
            }
            const hasEntryLength = this.hasTag(tagTable, 0x02);
            if (!hasEntryLength) {
                console.log("Info: Index doesn't contain entry length tags");
            }

            console.log('Read dictionary index data');
            for (let i = metaOrthIndex + 1; i < metaOrthIndex + 1 + orthIndexCount; i++) {
                data = sect.loadSection(i);
                const [hdrinfo, ordt1, ordt2] = this.parseHeader(data);
                const idxtPos = hdrinfo.start;
                const entryCount = hdrinfo.count;
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
                        let utext = '';
                        const pattern = idxhdr.otype === 0 ? 'H' : 'B';
                        const inc = idxhdr.otype === 0 ? 2 : 1;
                        let pos = 0;
                        while (pos < textLength) {
                            let off;
                            if (pattern === 'H') {
                                off = text.readUInt16BE(pos);
                            } else {
                                off = text[pos];
                            }
                            if (off < hordt2.length) {
                                utext += String.fromCharCode(hordt2[off]);
                            } else {
                                utext += String.fromCharCode(off);
                            }
                            pos += inc;
                        }
                        text = Buffer.from(utext, 'utf-8');
                    }

                    const tagMap = getTagMap(controlByteCount, tagTable, data, startPos + 1 + textLength, endPos);
                    if (0x01 in tagMap) {
                        let inflectionGroups = Buffer.alloc(0);
                        if (decodeInflection && 0x2a in tagMap) {
                            inflectionGroups = this.getInflectionGroups(text, inflectionControlByteCount, inflectionTagTable, dinfl, inflNameData, tagMap[0x2a]);
                        }
                        const entryStartPosition = tagMap[0x01][0];
                        if (hasEntryLength) {
                            const ml = Buffer.from('<idx:entry scriptable="yes"><idx:orth value="') + text + Buffer.from('">') + inflectionGroups + Buffer.from('</idx:orth>');
                            if (entryStartPosition in positionMap) {
                                positionMap[entryStartPosition] = Buffer.concat([positionMap[entryStartPosition], ml]);
                            } else {
                                positionMap[entryStartPosition] = ml;
                            }
                            const entryEndPosition = entryStartPosition + tagMap[0x02][0];
                            const endTag = Buffer.from('</idx:entry>');
                            if (entryEndPosition in positionMap) {
                                positionMap[entryEndPosition] = Buffer.concat([endTag, positionMap[entryEndPosition]]);
                            } else {
                                positionMap[entryEndPosition] = endTag;
                            }
                        } else {
                            const indexTags = Buffer.from('<idx:entry>\n<idx:orth value="') + text + Buffer.from('">\n') + inflectionGroups + Buffer.from('</idx:entry>\n');
                            if (entryStartPosition in positionMap) {
                                positionMap[entryStartPosition] = Buffer.concat([positionMap[entryStartPosition], indexTags]);
                            } else {
                                positionMap[entryStartPosition] = indexTags;
                            }
                        }
                    }
                }
            }
        }
        return positionMap;
    }

    hasTag(tagTable, tag) {
        for (const [currentTag] of tagTable) {
            if (currentTag === tag) {
                return true;
            }
        }
        return false;
    }

    getInflectionGroups(mainEntry, controlByteCount, tagTable, dinfl, inflectionNames, groupList) {
        let result = Buffer.alloc(0);
        for (const value of groupList) {
            const [offset, nextOffset, data] = dinfl.offsets(value);
            if (data[offset] !== 0x00) {
                throw new Error('First byte of inflection data must be 0x00');
            }
            const tagMap = getTagMap(controlByteCount, tagTable, data, offset + 1, nextOffset);

            if (!(0x05 in tagMap)) {
                console.log('Error: Required tag 0x05 not found in tagMap');
                return '';
            }
            if (!(0x1a in tagMap)) {
                console.log('Error: Required tag 0x1a not found in tagMap');
                return Buffer.alloc(0);
            }

            result = Buffer.concat([result, Buffer.from('<idx:infl>')]);

            for (let i = 0; i < tagMap[0x05].length; i++) {
                const value = tagMap[0x05][i];
                const [consumed, textLength] = getVariableWidthValue(inflectionNames, value);
                const inflectionName = inflectionNames.slice(value + consumed, value + consumed + textLength);

                const value2 = tagMap[0x1a][i];
                const [rvalue, start, count, data2] = dinfl.lookup(value2);
                const offset2 = data2.readUInt16BE(start + 4 + (2 * rvalue));
                const textLength2 = data2[offset2];
                const inflection = this.applyInflectionRule(mainEntry, data2, offset2 + 1, offset2 + 1 + textLength2);
                if (inflection !== null) {
                    result = Buffer.concat([
                        result,
                        Buffer.from('  <idx:iform name="'),
                        inflectionName,
                        Buffer.from('" value="'),
                        Buffer.from(inflection),
                        Buffer.from('"/>')
                    ]);
                }
            }
            result = Buffer.concat([result, Buffer.from('</idx:infl>')]);
        }
        return result;
    }

    applyInflectionRule(mainEntry, inflectionRuleData, start, end) {
        let mode = -1;
        const byteArray = Array.from(mainEntry);
        let position = byteArray.length;
        for (let charOffset = start; charOffset < end; charOffset++) {
            const abyte = inflectionRuleData[charOffset];
            const char = bchr(abyte);
            if (abyte >= 0x0a && abyte <= 0x13) {
                const offset = abyte - 0x0a;
                if (mode !== 0x02 && mode !== 0x03) {
                    mode = 0x02;
                    position = byteArray.length;
                }
                position -= offset;
            } else if (abyte > 0x13) {
                if (mode === -1) {
                    console.log('Error: Unexpected first byte %i of inflection rule', abyte);
                    return null;
                } else if (position === -1) {
                    console.log('Error: Unexpected first byte %i of inflection rule', abyte);
                    return null;
                } else {
                    if (mode === 0x01) {
                        byteArray.splice(position, 0, abyte);
                        position += 1;
                    } else if (mode === 0x02) {
                        byteArray.splice(position, 0, abyte);
                    } else if (mode === 0x03) {
                        position -= 1;
                        const deleted = byteArray.splice(position, 1)[0];
                        if (bchr(deleted) !== char) {
                            if (DEBUG_DICT) {
                                console.log('0x03: %s %s %s %s', mainEntry, toHex(inflectionRuleData.slice(start, end)), char, bchr(deleted));
                            }
                            console.log('Error: Delete operation of inflection rule failed');
                            return null;
                        }
                    } else if (mode === 0x04) {
                        const deleted = byteArray.splice(position, 1)[0];
                        if (bchr(deleted) !== char) {
                            if (DEBUG_DICT) {
                                console.log('0x03: %s %s %s %s', mainEntry, toHex(inflectionRuleData.slice(start, end)), char, bchr(deleted));
                            }
                            console.log('Error: Delete operation of inflection rule failed');
                            return null;
                        }
                    } else {
                        console.log('Error: Inflection rule mode %x is not implemented', mode);
                        return null;
                    }
                }
            } else if (abyte === 0x01) {
                if (mode !== 0x01 && mode !== 0x04) {
                    position = 0;
                }
                mode = abyte;
            } else if (abyte === 0x02) {
                if (mode !== 0x02 && mode !== 0x03) {
                    position = byteArray.length;
                }
                mode = abyte;
            } else if (abyte === 0x03) {
                if (mode !== 0x02 && mode !== 0x03) {
                    position = byteArray.length;
                }
                mode = abyte;
            } else if (abyte === 0x04) {
                if (mode !== 0x01 && mode !== 0x04) {
                    position = 0;
                }
                mode = abyte;
            } else {
                console.log('Error: Inflection rule mode %x is not implemented', abyte);
                return null;
            }
        }
        return utf8Str(Buffer.from(byteArray));
    }
}

module.exports = {
    dictSupport
};
