/**
 * mobi_k8resc.js
 * JavaScript equivalent of Python mobi_k8resc.py
 * K8 RESC processor for KindleUnpack
 */

const { unicodeStr } = require('./compatibility_utils');
const { fromBase32 } = require('./mobi_utils');

const DEBUG_USE_ORDERED_DICTIONARY = false;

const _OPF_PARENT_TAGS = ['xml', 'package', 'metadata', 'dc-metadata',
    'x-metadata', 'manifest', 'spine', 'tours', 'guide'];

class K8RESCProcessor {
    constructor(data, debug = false) {
        this._debug = debug;
        this.resc = null;
        this.opos = 0;
        this.extrameta = [];
        this.cover_name = null;
        this.spine_idrefs = {};
        this.spine_order = [];
        this.spine_pageattributes = {};
        this.spine_ppd = null;
        // need3 indicate the book has fields which require epub3.
        // but the estimation of the source epub version from the fields is difficult.
        this.need3 = false;
        this.package_ver = null;
        this.extra_metadata = [];
        this.refines_metadata = [];
        this.extra_attributes = [];
        // get header
        const start_pos = data.indexOf('<');
        this.resc_header = data.slice(0, start_pos);
        // get resc data length
        const start = this.resc_header.indexOf('=') + 1;
        const end = this.resc_header.indexOf('&', start);
        let resc_size = 0;
        if (end > 0) {
            resc_size = fromBase32(this.resc_header.slice(start, end));
        }
        const resc_rawbytes = data.length - start_pos;
        if (resc_rawbytes === resc_size) {
            this.resc_length = resc_size;
        } else {
            // Most RESC has a nul string at its tail but some do not.
            const end_pos = data.indexOf('\x00', start_pos);
            if (end_pos < 0) {
                this.resc_length = resc_rawbytes;
            } else {
                this.resc_length = end_pos - start_pos;
            }
        }
        if (this.resc_length !== resc_size) {
            console.log(`Warning: RESC section length(${this.resc_length}bytes) does not match its size(${resc_size}bytes).`);
        }
        // now parse RESC after converting it to unicode from utf-8
        try {
            this.resc = unicodeStr(data.slice(start_pos, start_pos + this.resc_length));
        } catch (e) {
            this.resc = unicodeStr(data.slice(start_pos, start_pos + this.resc_length), 'latin1');
        }
        this.parseData();
    }

    prepend_to_spine(key, idref, linear, properties) {
        this.spine_order = [key].concat(this.spine_order);
        this.spine_idrefs[key] = idref;
        const attributes = {};
        if (linear !== null) {
            attributes['linear'] = linear;
        }
        if (properties !== null) {
            attributes['properties'] = properties;
        }
        this.spine_pageattributes[key] = attributes;
    }

    // RESC tag iterator
    *resc_tag_iter() {
        let tcontent = null;
        let last_tattr = null;
        const prefix = [''];
        while (true) {
            const [text, tag] = this.parseresc();
            if (text === null && tag === null) {
                break;
            }
            if (text !== null) {
                tcontent = text.replace(/[ \r\n]+$/, '');
            } else {  // we have a tag
                let [ttype, tname, tattr] = this.parsetag(tag);
                if (ttype === 'begin') {
                    tcontent = null;
                    prefix.push(tname + '.');
                    if (_OPF_PARENT_TAGS.includes(tname)) {
                        yield [prefix.join(''), tname, tattr, tcontent];
                    } else {
                        last_tattr = tattr;
                    }
                } else {  // single or end
                    if (ttype === 'end') {
                        prefix.pop();
                        tattr = last_tattr;
                        last_tattr = null;
                        if (_OPF_PARENT_TAGS.includes(tname)) {
                            tname += '-end';
                        }
                    }
                    yield [prefix.join(''), tname, tattr, tcontent];
                    tcontent = null;
                }
            }
        }
    }

    // now parse the RESC to extract spine and extra metadata info
    parseData() {
        for (const [prefix, tname, tattr, tcontent] of this.resc_tag_iter()) {
            if (this._debug) {
                console.log("   Parsing RESC: ", prefix, tname, tattr, tcontent);
            }
            if (tname === 'package') {
                this.package_ver = tattr['version'] !== undefined ? tattr['version'] : '2.0';
                const package_prefix = tattr['prefix'] !== undefined ? tattr['prefix'] : '';
                if (this.package_ver.startsWith('3') || package_prefix.startsWith('rendition')) {
                    this.need3 = true;
                }
            }
            if (tname === 'spine') {
                this.spine_ppd = tattr['page-progession-direction'] !== undefined ? tattr['page-progession-direction'] : null;
                if (this.spine_ppd !== null && this.spine_ppd === 'rtl') {
                    this.need3 = true;
                }
            }
            if (tname === 'itemref') {
                let skelid = tattr['skelid'] !== undefined ? tattr['skelid'] : null;
                if ('skelid' in tattr) {
                    delete tattr['skelid'];
                }
                if (skelid === null && this.spine_order.length === 0) {
                    // assume it was removed initial coverpage
                    skelid = 'coverpage';
                    tattr['linear'] = 'no';
                }
                this.spine_order.push(skelid);
                let idref = tattr['idref'] !== undefined ? tattr['idref'] : null;
                if ('idref' in tattr) {
                    delete tattr['idref'];
                }
                if (idref !== null) {
                    idref = 'x_' + idref;
                }
                this.spine_idrefs[skelid] = idref;
                if ('id' in tattr) {
                    delete tattr['id'];
                }
                // tattr["id"] = 'x_' + tattr["id"];
                if ('properties' in tattr) {
                    this.need3 = true;
                }
                this.spine_pageattributes[skelid] = tattr;
            }
            if (tname === 'meta' || tname.startsWith('dc:')) {
                if ('refines' in tattr || 'property' in tattr) {
                    this.need3 = true;
                }
                if ((tattr['name'] || '') === 'cover') {
                    let cover_name = tattr['content'] !== undefined ? tattr['content'] : null;
                    if (cover_name !== null) {
                        cover_name = 'x_' + cover_name;
                    }
                    this.cover_name = cover_name;
                } else {
                    this.extrameta.push([tname, tattr, tcontent]);
                }
            }
        }
    }

    // parse and return either leading text or the next tag
    parseresc() {
        const p = this.opos;
        if (p >= this.resc.length) {
            return [null, null];
        }
        if (this.resc[p] !== '<') {
            const res = this.resc.indexOf('<', p);
            let endPos;
            if (res === -1) {
                endPos = this.resc.length;
            } else {
                endPos = res;
            }
            this.opos = endPos;
            return [this.resc.slice(p, endPos), null];
        }
        // handle comment as a special case
        let te;
        if (this.resc.slice(p, p + 4) === '<!--') {
            te = this.resc.indexOf('-->', p + 1);
            if (te !== -1) {
                te = te + 2;
            }
        } else {
            te = this.resc.indexOf('>', p + 1);
            const ntb = this.resc.indexOf('<', p + 1);
            if (ntb !== -1 && ntb < te) {
                this.opos = ntb;
                return [this.resc.slice(p, ntb), null];
            }
        }
        this.opos = te + 1;
        return [null, this.resc.slice(p, te + 1)];
    }

    // parses tag to identify:  [tname, ttype, tattr]
    //    tname: tag name
    //    ttype: tag type ('begin', 'end' or 'single');
    //    tattr: dictionary of tag atributes
    parsetag(s) {
        let p = 1;
        let tname = null;
        let ttype = null;
        const tattr = {};
        while (s.slice(p, p + 1) === ' ') {
            p += 1;
        }
        if (s.slice(p, p + 1) === '/') {
            ttype = 'end';
            p += 1;
            while (s.slice(p, p + 1) === ' ') {
                p += 1;
            }
        }
        const b = p;
        while (!'>/ "\'\r\n'.includes(s.slice(p, p + 1))) {
            p += 1;
        }
        tname = s.slice(b, p).toLowerCase();
        // some special cases
        if (tname === '?xml') {
            tname = 'xml';
        }
        if (tname === '!--') {
            ttype = 'single';
            const comment = s.slice(p, -3).trim();
            tattr['comment'] = comment;
        }
        if (ttype === null) {
            // parse any attributes of begin or single tags
            while (s.indexOf('=', p) !== -1) {
                while (s.slice(p, p + 1) === ' ') {
                    p += 1;
                }
                let b = p;
                while (s.slice(p, p + 1) !== '=') {
                    p += 1;
                }
                let aname = s.slice(b, p).toLowerCase();
                aname = aname.replace(/ +$/, '');
                p += 1;
                while (s.slice(p, p + 1) === ' ') {
                    p += 1;
                }
                let val;
                if ('"\''.includes(s.slice(p, p + 1))) {
                    p += 1;
                    b = p;
                    while (!'"\''.includes(s.slice(p, p + 1))) {
                        p += 1;
                    }
                    val = s.slice(b, p);
                    p += 1;
                } else {
                    b = p;
                    while (!'>/ '.includes(s.slice(p, p + 1))) {
                        p += 1;
                    }
                    val = s.slice(b, p);
                }
                tattr[aname] = val;
            }
        }
        if (ttype === null) {
            ttype = 'begin';
            if (s.indexOf('/', p) >= 0) {
                ttype = 'single';
            }
        }
        return [ttype, tname, tattr];
    }

    taginfo_toxml(taginfo) {
        const res = [];
        const [tname, tattr, tcontent] = taginfo;
        res.push('<' + tname);
        if (tattr !== null) {
            for (const key of Object.keys(tattr)) {
                res.push(' ' + key + '="' + tattr[key] + '"');
            }
        }
        if (tcontent !== null) {
            res.push('>' + tcontent + '</' + tname + '>\n');
        } else {
            res.push('/>\n');
        }
        return res.join('');
    }

    hasSpine() {
        return this.spine_order.length > 0;
    }

    needEPUB3() {
        return this.need3;
    }

    hasRefines() {
        for (const [tname, tattr, tcontent] of this.extrameta) {
            if ('refines' in tattr) {
                return true;
            }
        }
        return false;
    }

    createMetadata(epubver) {
        for (const taginfo of this.extrameta) {
            const [tname, tattr, tcontent] = taginfo;
            if ('refines' in tattr) {
                if (epubver === 'F' && 'property' in tattr) {
                    const attr = ` id="${tattr['refines']}" opf:${tattr['property']}="${tcontent}"\n`;
                    this.extra_attributes.push(attr);
                } else {
                    const tag = this.taginfo_toxml(taginfo);
                    this.refines_metadata.push(tag);
                }
            } else {
                const tag = this.taginfo_toxml(taginfo);
                this.extra_metadata.push(tag);
            }
        }
    }
}

module.exports = {
    K8RESCProcessor
};
