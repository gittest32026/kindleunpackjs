/**
 * mobi_k8proc.js
 * JavaScript equivalent of Python mobi_k8proc.py
 * KF8 (MOBI8) processor for handling KF8-specific structures
 */

const fs = require('fs');
const path = require('path');
const { bstr, utf8Str } = require('./compatibility_utils');
const { MobiIndex } = require('./mobi_index');
const { fromBase32 } = require('./mobi_utils');
const { pathof } = require('./unipath');

const _guide_types = [
    'cover', 'title-page', 'toc', 'index', 'glossary', 'acknowledgements',
    'bibliography', 'colophon', 'copyright-page', 'dedication',
    'epigraph', 'foreword', 'loi', 'lot', 'notes', 'preface', 'text'
];

function locateBegEndOfTag(ml, aid) {
    const pattern = new RegExp(`<[^>]*\\said\\s*=\\s*['"]${aid}['"][^>]*>`, 'i');
    const m = ml.toString('utf-8').match(pattern);
    if (m) {
        const plt = m.index;
        const pgt = ml.indexOf('>', plt + 1);
        return [plt, pgt];
    }
    return [0, 0];
}

function* reverseTagIter(block) {
    let end = block.length;
    while (true) {
        let pgt = block.lastIndexOf('>', end - 1);
        if (pgt === -1) break;
        let plt = block.lastIndexOf('<', pgt);
        if (plt === -1) break;
        yield block.slice(plt, pgt + 1);
        end = plt;
    }
}

class K8Processor {
    constructor(mh, sect, files, debug = false) {
        this.sect = sect;
        this.files = files;
        this.mi = new MobiIndex(sect);
        this.mh = mh;
        this.skelidx = mh.skelidx;
        this.fragidx = mh.fragidx;
        this.guideidx = mh.guideidx;
        this.fdst = mh.fdst;
        this.flowmap = {};
        this.flows = null;
        this.flowinfo = [];
        this.parts = null;
        this.partinfo = [];
        this.linked_aids = new Set();
        this.fdsttbl = [0, 0xffffffff];
        this.DEBUG = debug;

        if (this.fdst !== 0xffffffff) {
            const header = this.sect.loadSection(this.fdst);
            if (header.slice(0, 4).equals(Buffer.from('FDST'))) {
                const num_sections = header.readUInt32BE(0x08);
                this.fdsttbl = [];
                for (let j = 0; j < num_sections; j++) {
                    this.fdsttbl.push(header.readUInt32BE(12 + j * 8));
                }
                this.fdsttbl.push(mh.rawSize);
                sect.setSectionDescription(this.fdst, 'KF8 FDST INDX');
                if (this.DEBUG) {
                    console.log('\nFDST Section Map:  %d sections', num_sections);
                    for (let j = 0; j < num_sections; j++) {
                        console.log('Section %d: 0x%08X - 0x%08X', j, this.fdsttbl[j], this.fdsttbl[j + 1]);
                    }
                }
            } else {
                console.log('\nError: K8 Mobi with Missing FDST info');
            }
        }

        const skeltbl = [];
        if (this.skelidx !== 0xffffffff) {
            const [outtbl, ctoc_text] = this.mi.getIndexData(this.skelidx, 'KF8 Skeleton');
            let fileptr = 0;
            for (const [text, tagMap] of outtbl) {
                skeltbl.push([fileptr, text, tagMap[1][0], tagMap[6][0], tagMap[6][1]]);
                fileptr += 1;
            }
        }
        this.skeltbl = skeltbl;
        if (this.DEBUG) {
            console.log('\nSkel Table:  %d entries', skeltbl.length);
            console.log('table: filenum, skeleton name, frag tbl record count, start position, length');
            for (let j = 0; j < skeltbl.length; j++) {
                console.log(skeltbl[j]);
            }
        }

        const fragtbl = [];
        if (this.fragidx !== 0xffffffff) {
            const [outtbl, ctoc_text] = this.mi.getIndexData(this.fragidx, 'KF8 Fragment');
            for (const [text, tagMap] of outtbl) {
                const ctocoffset = tagMap[2][0];
                const ctocdata = ctoc_text[ctocoffset];
                fragtbl.push([parseInt(text, 10), ctocdata, tagMap[3][0], tagMap[4][0], tagMap[6][0], tagMap[6][1]]);
            }
        }
        this.fragtbl = fragtbl;
        if (this.DEBUG) {
            console.log('\nFragment Table: %d entries', fragtbl.length);
            console.log('table: file position, link id text, file num, sequence number, start position, length');
            for (let j = 0; j < fragtbl.length; j++) {
                console.log(fragtbl[j]);
            }
        }

        const guidetbl = [];
        if (this.guideidx !== 0xffffffff) {
            const [outtbl, ctoc_text] = this.mi.getIndexData(this.guideidx, 'KF8 Guide elements)');
            for (const [text, tagMap] of outtbl) {
                const ctocoffset = tagMap[1][0];
                const ref_title = ctoc_text[ctocoffset];
                const ref_type = text;
                let fileno = null;
                if (3 in tagMap) {
                    fileno = tagMap[3][0];
                }
                if (6 in tagMap) {
                    fileno = tagMap[6][0];
                }
                guidetbl.push([ref_type, ref_title, fileno]);
            }
        }
        this.guidetbl = guidetbl;
        if (this.DEBUG) {
            console.log('\nGuide Table: %d entries', guidetbl.length);
            console.log('table: ref_type, ref_title, fragtbl entry number');
            for (let j = 0; j < guidetbl.length; j++) {
                console.log(guidetbl[j]);
            }
        }
    }

    buildParts(rawML) {
        this.flows = [];
        for (let j = 0; j < this.fdsttbl.length - 1; j++) {
            const start = this.fdsttbl[j];
            const end = this.fdsttbl[j + 1];
            this.flows.push(rawML.slice(start, end));
        }

        let text = this.flows[0];
        this.flows[0] = Buffer.alloc(0);

        if (this.DEBUG) {
            console.log('\nRebuilding flow piece 0: the main body of the ebook');
        }
        this.parts = [];
        this.partinfo = [];
        let fragptr = 0;
        let baseptr = 0;
        let cnt = 0;
        let filename = 'part' + String(cnt).padStart(4, '0') + '.xhtml';

        for (const [skelnum, skelname, fragcnt, skelpos, skellen] of this.skeltbl) {
            baseptr = skelpos + skellen;
            let skeleton = text.slice(skelpos, baseptr);
            let aidtext = '0';
            for (let i = 0; i < fragcnt; i++) {
                const [insertpos, idtext, filenum, seqnum, startpos, length] = this.fragtbl[fragptr];
                aidtext = idtext.slice(12, -2).toString('utf-8');
                if (i === 0) {
                    filename = 'part' + String(filenum).padStart(4, '0') + '.xhtml';
                }
                let slice = text.slice(baseptr, baseptr + length);
                let insertPosLocal = insertpos - skelpos;
                let head = skeleton.slice(0, insertPosLocal);
                let tail = skeleton.slice(insertPosLocal);
                let actualInspos = insertPosLocal;
                const tailGt = tail.indexOf('>');
                const tailLt = tail.indexOf('<');
                const headGt = head.lastIndexOf('>');
                const headLt = head.lastIndexOf('<');
                if ((tailGt !== -1 && tailLt !== -1 && tailGt < tailLt) || (headGt !== -1 && headLt !== -1 && headGt < headLt)) {
                    console.log('The fragment table for %s has incorrect insert position. Calculating manually.', skelname);
                    const [bp, ep] = locateBegEndOfTag(skeleton, aidtext);
                    if (bp !== ep) {
                        actualInspos = ep + 1 + startpos;
                    }
                }
                if (insertPosLocal !== actualInspos) {
                    console.log('fixed corrupt fragment table insert position', insertPosLocal + skelpos, actualInspos + skelpos);
                    insertPosLocal = actualInspos;
                    this.fragtbl[fragptr][0] = actualInspos + skelpos;
                }
                skeleton = Buffer.concat([skeleton.slice(0, insertPosLocal), slice, skeleton.slice(insertPosLocal)]);
                baseptr += length;
                fragptr += 1;
            }
            cnt += 1;
            this.parts.push(skeleton);
            this.partinfo.push([skelnum, 'Text', filename, skelpos, baseptr, aidtext]);
        }

        const assembledText = Buffer.concat(this.parts);
        if (this.DEBUG) {
            const outassembled = path.join(this.files.k8dir, 'assembled_text.dat');
            fs.writeFileSync(pathof(outassembled), assembledText);
        }

        this.flowinfo.push([null, null, null, null]);
        const svgTagPattern = /(<svg[^>]*>)/gi;
        const imageTagPattern = /(<image[^>]*>)/gi;
        for (let j = 1; j < this.flows.length; j++) {
            let flowpart = this.flows[j];
            const nstr = String(j).padStart(4, '0');
            const m = svgTagPattern.exec(flowpart.toString('utf-8'));
            svgTagPattern.lastIndex = 0;
            let ptype, pformat, pdir, fname;
            if (m !== null) {
                ptype = 'svg';
                const start = m.index;
                const m2 = imageTagPattern.exec(flowpart.toString('utf-8'));
                imageTagPattern.lastIndex = 0;
                if (m2 !== null) {
                    pformat = 'inline';
                    pdir = null;
                    fname = null;
                    flowpart = flowpart.slice(start);
                } else {
                    pformat = 'file';
                    pdir = 'Images';
                    fname = 'svgimg' + nstr + '.svg';
                }
            } else {
                if (flowpart.indexOf('[CDATA[') >= 0) {
                    ptype = 'css';
                    flowpart = Buffer.from('<style type="text/css">\n', 'utf-8') + flowpart + Buffer.from('\n</style>\n', 'utf-8');
                    pformat = 'inline';
                    pdir = null;
                    fname = null;
                } else {
                    ptype = 'css';
                    pformat = 'file';
                    pdir = 'Styles';
                    fname = 'style' + nstr + '.css';
                }
            }
            this.flows[j] = flowpart;
            this.flowinfo.push([ptype, pformat, pdir, fname]);
        }

        if (this.DEBUG) {
            console.log('\nFlow Map:  %d entries', this.flowinfo.length);
            for (const fi of this.flowinfo) {
                console.log(fi);
            }
            console.log('\n');
            console.log('\nXHTML File Part Position Information: %d entries', this.partinfo.length);
            for (const pi of this.partinfo) {
                console.log(pi);
            }
        }
    }

    getFragTblInfo(pos) {
        for (let j = 0; j < this.fragtbl.length; j++) {
            const [insertpos, idtext, filenum, seqnum, startpos, length] = this.fragtbl[j];
            if (pos >= insertpos && pos < (insertpos + length)) {
                return [seqnum, Buffer.from('in: ', 'utf-8') + idtext];
            }
            if (pos < insertpos) {
                return [seqnum, Buffer.from('before: ', 'utf-8') + idtext];
            }
        }
        return [null, null];
    }

    getFileInfo(pos) {
        for (const [partnum, pdir, filename, start, end, aidtext] of this.partinfo) {
            if (pos >= start && pos < end) {
                return [filename, partnum, start, end];
            }
        }
        return [null, null, null, null];
    }

    getNumberOfParts() {
        return this.parts.length;
    }

    getPart(i) {
        if (i >= 0 && i < this.parts.length) {
            return this.parts[i];
        }
        return null;
    }

    getPartInfo(i) {
        if (i >= 0 && i < this.partinfo.length) {
            return this.partinfo[i];
        }
        return null;
    }

    getNumberOfFlows() {
        return this.flows.length;
    }

    getFlow(i) {
        if (i > 0 && i < this.flows.length) {
            return this.flows[i];
        }
        return null;
    }

    getFlowInfo(i) {
        if (i > 0 && i < this.flowinfo.length) {
            return this.flowinfo[i];
        }
        return null;
    }

    getIDTagByPosFid(posfid, offset) {
        const row = fromBase32(posfid);
        const off = fromBase32(offset);
        const [insertpos, idtext, filenum, seqnm, startpos, length] = this.fragtbl[row];
        let pos = insertpos + off;
        let [fname, pn, skelpos, skelend] = this.getFileInfo(pos);
        if (fname === null) {
            console.log('Link To Position', pos, 'does not exist, retargeting to top of target');
            pos = this.skeltbl[filenum][3];
            [fname, pn, skelpos, skelend] = this.getFileInfo(pos);
        }
        const idTag = this.getIDTag(pos);
        return [fname, idTag];
    }

    getIDTag(pos) {
        const [fname, pn, skelpos, skelend] = this.getFileInfo(pos);
        if (pn === null && skelpos === null) {
            console.log('Error: getIDTag - no file contains ', pos);
        }
        let textblock = this.parts[pn];
        let npos = pos - skelpos;
        let pgt = textblock.indexOf('>', npos);
        let plt = textblock.indexOf('<', npos);
        if (plt === npos || (pgt !== -1 && plt !== -1 && pgt < plt)) {
            npos = pgt + 1;
        }
        textblock = textblock.slice(0, npos);
        const idPattern = /<[^>]*\sid\s*=\s*['"]([^'"]*)['"]/i;
        const namePattern = /<[^>]*\sname\s*=\s*['"]([^'"]*)['"]/i;
        const aidPattern = /<[^>]+\s(?:aid|AID)\s*=\s*['"]([^'"]+)['"]/;
        for (const tag of reverseTagIter(textblock.toString('utf-8'))) {
            if (tag.slice(0, 6) === '<body ') {
                return '';
            }
            if (tag.slice(0, 6) !== '<meta ') {
                let m = idPattern.exec(tag) || namePattern.exec(tag);
                if (m !== null) {
                    return m[1];
                }
                m = aidPattern.exec(tag);
                if (m !== null) {
                    this.linked_aids.add(m[1]);
                    return 'aid-' + m[1];
                }
            }
        }
        return '';
    }

    setParts(parts) {
        if (parts.length !== this.parts.length) {
            throw new Error('setParts: parts length mismatch');
        }
        for (let i = 0; i < parts.length; i++) {
            this.parts[i] = parts[i];
        }
    }

    setFlows(flows) {
        if (flows.length !== this.flows.length) {
            throw new Error('setFlows: flows length mismatch');
        }
        for (let i = 0; i < flows.length; i++) {
            this.flows[i] = flows[i];
        }
    }

    getSkelInfo(pos) {
        for (const [partnum, pdir, filename, start, end, aidtext] of this.partinfo) {
            if (pos >= start && pos < end) {
                return [partnum, pdir, filename, start, end, aidtext];
            }
        }
        return [null, null, null, null, null, null];
    }

    getGuideText() {
        let guidetext = Buffer.alloc(0);
        for (const [ref_type_buf, ref_title, fileno] of this.guidetbl) {
            const ref_type = ref_type_buf.toString('utf-8');
            if (ref_type === 'thumbimagestandard') {
                continue;
            }
            let rt = ref_type;
            if (!_guide_types.includes(ref_type) && !ref_type.startsWith('other.')) {
                if (ref_type === 'start') {
                    rt = 'text';
                } else {
                    rt = 'other.' + ref_type;
                }
            }
            const [pos, idtext, filenum, seqnm, startpos, length] = this.fragtbl[fileno];
            const [pn, pdir, filename, skelpos, skelend, aidtext] = this.getSkelInfo(pos);
            const idTag = this.getIDTag(pos);
            let linktgt = Buffer.from(filename, 'utf-8');
            if (idTag !== '') {
                linktgt = Buffer.concat([linktgt, Buffer.from('#' + idTag, 'utf-8')]);
            }
            const line = Buffer.concat([
                Buffer.from('<reference type="' + rt + '" title="' + ref_title.toString(this.mh.codec) + '" href="' + pdir + '/'),
                linktgt,
                Buffer.from('" />\n')
            ]);
            guidetext = Buffer.concat([guidetext, line]);
        }
        guidetext = Buffer.from(guidetext.toString(this.mh.codec), 'utf-8');
        return guidetext;
    }

    getPageIDTag(pos) {
        const [fname, pn, skelpos, skelend] = this.getFileInfo(pos);
        if (pn === null && skelpos === null) {
            console.log('Error: getIDTag - no file contains ', pos);
        }
        let textblock = this.parts[pn];
        let npos = pos - skelpos;
        let pgt = textblock.indexOf('>', npos);
        let plt = textblock.indexOf('<', npos);
        if (plt === npos || (pgt !== -1 && plt !== -1 && pgt < plt)) {
            const pend1 = textblock.indexOf('/>', npos);
            const pend2 = textblock.indexOf('</', npos);
            let pend;
            if (pend1 !== -1 && pend2 !== -1) {
                pend = Math.min(pend1, pend2);
            } else {
                pend = Math.max(pend1, pend2);
            }
            if (pend !== -1) {
                npos = pend;
            } else {
                npos = pgt + 1;
            }
        }
        textblock = textblock.slice(0, npos);
        const idPattern = /<[^>]*\sid\s*=\s*['"]([^'"]*)['"]/i;
        const namePattern = /<[^>]*\sname\s*=\s*['"]([^'"]*)['"]/i;
        for (const tag of reverseTagIter(textblock.toString('utf-8'))) {
            if (tag.slice(0, 6) === '<body ') {
                return '';
            }
            if (tag.slice(0, 6) !== '<meta ') {
                const m = idPattern.exec(tag) || namePattern.exec(tag);
                if (m !== null) {
                    return m[1];
                }
            }
        }
        return '';
    }
}

module.exports = {
    K8Processor
};
