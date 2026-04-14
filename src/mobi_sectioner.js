/**
 * mobi_sectioner.js
 * JavaScript equivalent of Python mobi_sectioner.py
 * Handles Palm DB section parsing
 */

const fs = require('fs');
const { pathof } = require('./unipath');
const { hexlify, bord, bchar } = require('./compatibility_utils');

class UnpackException extends Error {}

/**
 * Describe binary data for debugging
 * @param {Buffer} data - Binary data
 * @returns {string} - Description string
 */
function describe(data) {
    let txtans = '';
    const hexans = hexlify(data);
    for (let i = 0; i < data.length; i++) {
        const b = data[i];
        if (b < 32 || b > 127) {
            txtans += '?';
        } else {
            txtans += String.fromCharCode(b);
        }
    }
    return `"${txtans}" 0x${hexans}`;
}

/**
 * Convert Palm time to JavaScript Date
 * @param {number} palmtime - Palm time value
 * @returns {Date} - JavaScript Date
 */
function datetimeFromPalmTime(palmtime) {
    if (palmtime > 0x7FFFFFFF) {
        // Palm OS epoch (1904)
        const baseDate = new Date(Date.UTC(1904, 0, 1));
        return new Date(baseDate.getTime() + palmtime * 1000);
    } else {
        // Unix epoch (1970)
        const baseDate = new Date(Date.UTC(1970, 0, 1));
        return new Date(baseDate.getTime() + palmtime * 1000);
    }
}

/**
 * Sectionizer class for parsing Palm DB files
 */
class Sectionizer {
    constructor(filename) {
        this.data = fs.readFileSync(pathof(filename));
        this.palmHeader = this.data.slice(0, 78);
        this.palmName = this.data.slice(0, 32);
        this.ident = this.palmHeader.slice(0x3C, 0x3C + 8);
        this.numSections = this.palmHeader.readUInt16BE(76);
        this.fileLength = this.data.length;
        
        // Parse section offsets
        const sectionsData = [];
        for (let i = 0; i < this.numSections * 2; i++) {
            sectionsData.push(this.data.readUInt32BE(78 + i * 4));
        }
        sectionsData.push(this.fileLength);
        sectionsData.push(0);
        
        this.sectionOffsets = [];
        this.sectionAttributes = [];
        for (let i = 0; i < this.numSections; i++) {
            this.sectionOffsets.push(sectionsData[i * 2]);
            this.sectionAttributes.push(sectionsData[i * 2 + 1]);
        }
        this.sectionOffsets.push(this.fileLength);
        
        this.sectionDescriptions = new Array(this.numSections + 1).fill('');
        this.sectionDescriptions[this.numSections] = 'File Length Only';
    }

    dumpSectionsInfo() {
        console.log('Section     Offset  Length      UID Attribs Description');
        for (let i = 0; i < this.numSections; i++) {
            const offset = this.sectionOffsets[i];
            const length = this.sectionOffsets[i + 1] - offset;
            const uid = this.sectionAttributes[i] & 0xFFFFFF;
            const attribs = (this.sectionAttributes[i] >> 24) & 0xFF;
            console.log(`%3d %3X  0x%07X 0x%05X % 8d % 7d %s`, 
                i, i, offset, length, uid, attribs, this.sectionDescriptions[i]);
        }
        console.log(`%3d %3X  0x%07X                          %s`,
            this.numSections, this.numSections, this.sectionOffsets[this.numSections], 
            this.sectionDescriptions[this.numSections]);
    }

    setSectionDescription(section, description) {
        if (section < this.sectionDescriptions.length) {
            this.sectionDescriptions[section] = description;
        } else {
            console.log(`Section out of range: ${section}, description ${description}`);
        }
    }

    dumpPalmHeader() {
        console.log('Palm Database Header');
        console.log('Database name: ' + JSON.stringify(this.palmHeader.slice(0, 32).toString('latin1')));
        
        const dbAttributes = this.palmHeader.readUInt16BE(32);
        process.stdout.write(`Bitfield attributes: 0x${dbAttributes.toString(16).toUpperCase()}`);
        
        if (dbAttributes !== 0) {
            const attrs = [];
            if (dbAttributes & 2) attrs.push('Read-only');
            if (dbAttributes & 4) attrs.push('Dirty AppInfoArea');
            if (dbAttributes & 8) attrs.push('Needs to be backed up');
            if (dbAttributes & 16) attrs.push('OK to install over newer');
            if (dbAttributes & 32) attrs.push('Reset after installation');
            if (dbAttributes & 64) attrs.push('No copying by PalmPilot beaming');
            console.log(' (' + attrs.join('; ') + ')');
        } else {
            console.log('');
        }
        
        console.log(`File version: ${this.palmHeader.readUInt16BE(34)}`);
        
        const dbCreation = this.palmHeader.readUInt32BE(36);
        console.log(`Creation Date: ${datetimeFromPalmTime(dbCreation)} (0x${dbCreation.toString(16).toUpperCase()})`);
        
        const dbModification = this.palmHeader.readUInt32BE(40);
        console.log(`Modification Date: ${datetimeFromPalmTime(dbModification)} (0x${dbModification.toString(16).toUpperCase()})`);
        
        const dbBackup = this.palmHeader.readUInt32BE(44);
        if (dbBackup !== 0) {
            console.log(`Backup Date: ${datetimeFromPalmTime(dbBackup)} (0x${dbBackup.toString(16).toUpperCase()})`);
        }
        
        console.log(`Modification No.: ${this.palmHeader.readUInt32BE(48)}`);
        console.log(`App Info offset: 0x${this.palmHeader.readUInt32BE(52).toString(16).toUpperCase()}`);
        console.log(`Sort Info offset: 0x${this.palmHeader.readUInt32BE(56).toString(16).toUpperCase()}`);
        console.log(`Type/Creator: ${JSON.stringify(this.palmHeader.slice(60, 64).toString('latin1'))}/${JSON.stringify(this.palmHeader.slice(64, 68).toString('latin1'))}`);
        console.log(`Unique seed: 0x${this.palmHeader.readUInt32BE(68).toString(16).toUpperCase()}`);
        
        const expectedZero = this.palmHeader.readUInt32BE(72);
        if (expectedZero !== 0) {
            console.log(`Should be zero but isn't: ${expectedZero}`);
        }
        
        console.log(`Number of sections: ${this.numSections}`);
    }

    loadSection(section) {
        const before = this.sectionOffsets[section];
        const after = this.sectionOffsets[section + 1];
        return this.data.slice(before, after);
    }
}

module.exports = {
    Sectionizer,
    describe,
    UnpackException
};