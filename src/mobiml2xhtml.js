const fs = require('fs');
const path = require('path');

const SPECIAL_HANDLING_TAGS = {
    '?xml':     ['xmlheader', -1],
    '!--':      ['comment', -3],
    '!DOCTYPE': ['doctype', -1],
};

const SPECIAL_HANDLING_TYPES = ['xmlheader', 'doctype', 'comment'];

const SELF_CLOSING_TAGS = ['br', 'hr', 'input', 'img', 'image', 'meta', 'spacer', 'link', 'frame', 'base', 'col', 'reference'];

function MobiMLConverter(filename) {
    this.base_css_rules =  'blockquote { margin: 0em 0em 0em 1.25em }\n';
    this.base_css_rules += 'p { margin: 0em }\n';
    this.base_css_rules += '.bold { font-weight: bold }\n';
    this.base_css_rules += '.italic { font-style: italic }\n';
    this.base_css_rules += '.mbp_pagebreak { page-break-after: always; margin: 0; display: block }\n';
    this.tag_css_rules = {};
    this.tag_css_rule_cnt = 0;
    this.path = [];
    this.filename = filename;
    this.wipml = fs.readFileSync(this.filename, 'utf-8');
    this.pos = 0;
    this.opfname = filename.replace(/\.[^.]*$/, '') + '.opf';
    this.opos = 0;
    this.meta = '';
    this.cssname = path.join(path.dirname(this.filename), 'styles.css');
    this.current_font_size = 3;
    this.font_history = [];
}

MobiMLConverter.PAGE_BREAK_PAT = /(<[/]{0,1}mbp:pagebreak\s*[/]{0,1}>)+/gi;
MobiMLConverter.IMAGE_ATTRS = ['lowrecindex', 'recindex', 'hirecindex'];

MobiMLConverter.prototype.cleanup_html = function() {
    this.wipml = this.wipml.replace(/<div height="0(pt|px|ex|em|%)?"><\/div>/g, '');
    this.wipml = this.wipml.replace(/\r\n/g, '\n');
    this.wipml = this.wipml.replace(/> </g, '>\n<');
    this.wipml = this.wipml.replace(/<mbp: /g, '<mbp:');
    // this.wipml = this.wipml.replace(/<?xml[^>]*>/g, '');
    this.wipml = this.wipml.replace(/<br><\/br>/g, '<br/>');
};

MobiMLConverter.prototype.replace_page_breaks = function() {
    this.wipml = this.wipml.replace(MobiMLConverter.PAGE_BREAK_PAT, '<div class="mbp_pagebreak" />');
};

MobiMLConverter.prototype.parseml = function() {
    const p = this.pos;
    if (p >= this.wipml.length) {
        return null;
    }
    if (this.wipml.charAt(p) !== '<') {
        let res = this.wipml.indexOf('<', p);
        if (res === -1) {
            res = this.wipml.length;
        }
        this.pos = res;
        return [this.wipml.slice(p, res), null];
    }
    let te;
    if (this.wipml.slice(p, p + 4) === '<!--') {
        te = this.wipml.indexOf('-->', p + 1);
        if (te !== -1) {
            te = te + 2;
        }
    } else {
        te = this.wipml.indexOf('>', p + 1);
        const ntb = this.wipml.indexOf('<', p + 1);
        if (ntb !== -1 && ntb < te) {
            this.pos = ntb;
            return [this.wipml.slice(p, ntb), null];
        }
    }
    this.pos = te + 1;
    return [null, this.wipml.slice(p, te + 1)];
};

MobiMLConverter.prototype.parsetag = function(s) {
    let p = 1;
    let tname = null;
    let ttype = null;
    const tattr = {};
    while (s.charAt(p) === ' ') {
        p += 1;
    }
    if (s.charAt(p) === '/') {
        ttype = 'end';
        p += 1;
        while (s.charAt(p) === ' ') {
            p += 1;
        }
    }
    let b = p;
    let ch;
    while (true) {
        ch = s.charAt(p);
        if (ch === '>' || ch === '/' || ch === ' ' || ch === '"' || ch === "'" || ch === '\r' || ch === '\n' || ch === '') {
            break;
        }
        p += 1;
    }
    tname = s.slice(b, p).toLowerCase();
    if (tname === '!doctype') {
        tname = '!DOCTYPE';
    }
    if (SPECIAL_HANDLING_TAGS.hasOwnProperty(tname)) {
        const specialInfo = SPECIAL_HANDLING_TAGS[tname];
        ttype = specialInfo[0];
        const backstep = specialInfo[1];
        tattr.special = s.slice(p, s.length + backstep);
    }
    if (ttype === null) {
        while (s.indexOf('=', p) !== -1) {
            while (s.charAt(p) === ' ') {
                p += 1;
            }
            b = p;
            while (s.charAt(p) !== '=') {
                p += 1;
            }
            let aname = s.slice(b, p).toLowerCase();
            aname = aname.replace(/ +$/, '');
            p += 1;
            while (s.charAt(p) === ' ') {
                p += 1;
            }
            let val;
            if (s.charAt(p) === '"' || s.charAt(p) === "'") {
                const quote = s.charAt(p);
                p += 1;
                b = p;
                while (s.charAt(p) !== quote) {
                    p += 1;
                }
                val = s.slice(b, p);
                p += 1;
            } else {
                b = p;
                while (true) {
                    ch = s.charAt(p);
                    if (ch === '>' || ch === '/' || ch === ' ' || ch === '') {
                        break;
                    }
                    p += 1;
                }
                val = s.slice(b, p);
            }
            tattr[aname] = val;
        }
    }
    if (ttype === null) {
        ttype = 'begin';
        if (s.indexOf(' /', p) >= 0) {
            ttype = 'single_ext';
        } else if (s.indexOf('/', p) >= 0) {
            ttype = 'single';
        }
    }
    return [ttype, tname, tattr];
};

MobiMLConverter.prototype.processml = function() {
    let html_done = false;
    let head_done = false;
    let body_done = false;
    let skip = false;
    let htmlstr = '';
    this.replace_page_breaks();
    this.cleanup_html();

    while (true) {
        const r = this.parseml();
        if (!r) {
            break;
        }

        const text = r[0];
        const tag = r[1];

        if (text) {
            if (!skip) {
                htmlstr += text;
            }
        }

        if (tag) {
            const parsed = this.parsetag(tag);
            let ttype = parsed[0];
            let tname = parsed[1];
            let tattr = parsed[2];

            if (SPECIAL_HANDLING_TAGS.hasOwnProperty(tname) && tname !== 'comment' && body_done) {
                htmlstr += '\n</body></html>';
                break;
            }

            if (ttype === 'begin' && SELF_CLOSING_TAGS.indexOf(tname) >= 0) {
                ttype = 'single';
            }

            if (ttype === 'end' && SELF_CLOSING_TAGS.indexOf(tname) >= 0) {
                continue;
            }

            if ((tname === 'guide' || tname === 'ncx' || tname === 'reference') && (ttype === 'begin' || ttype === 'single' || ttype === 'single_ext')) {
                tname = 'removeme:' + tname;
                tattr = null;
            }
            if ((tname === 'guide' || tname === 'ncx' || tname === 'reference' || tname === 'font' || tname === 'span') && ttype === 'end') {
                if (this.path[this.path.length - 1] === 'removeme:' + tname) {
                    tname = 'removeme:' + tname;
                    tattr = null;
                }
            }

            if (tname === 'font' && (ttype === 'begin' || ttype === 'single' || ttype === 'single_ext')) {
                if (tattr && Object.keys(tattr).length === 1 && 'color' in tattr) {
                    tname = 'removeme:font';
                    tattr = null;
                }
            }

            if (tname === 'span' && (ttype === 'begin' || ttype === 'single' || ttype === 'single_ext') && (!tattr || Object.keys(tattr).length === 0)) {
                tname = 'removeme:span';
            }

            if (tname === 'font' && ttype === 'begin') {
                if (this.font_history.length > 0) {
                    let taginfo = ['end', 'font', null];
                    htmlstr += this.processtag(taginfo);
                }
                this.font_history.push([ttype, tname, tattr]);
                let taginfo = [ttype, tname, tattr];
                htmlstr += this.processtag(taginfo);
                continue;
            }

            if (tname === 'font' && ttype === 'end') {
                this.font_history.pop();
                let taginfo = ['end', 'font', null];
                htmlstr += this.processtag(taginfo);
                if (this.font_history.length > 0) {
                    taginfo = this.font_history[this.font_history.length - 1];
                    htmlstr += this.processtag(taginfo);
                }
                continue;
            }

            if (ttype === 'begin') {
                this.path.push(tname);
            } else if (ttype === 'end') {
                if (tname !== this.path[this.path.length - 1]) {
                    console.log('improper nesting: ', this.path, tname, ttype);
                    if (this.path.indexOf(tname) < 0) {
                        let taginfo = ['begin', tname, null];
                        htmlstr += this.processtag(taginfo);
                        console.log("     - fixed by injecting empty start tag ", tname);
                        this.path.push(tname);
                    } else if (this.path.length > 1 && tname === this.path[this.path.length - 2]) {
                        let taginfo = ['end', this.path[this.path.length - 1], null];
                        htmlstr += this.processtag(taginfo);
                        console.log("     - fixed by injecting end tag ", this.path[this.path.length - 1]);
                        this.path.pop();
                    }
                }
                this.path.pop();
            }

            if (tname === 'removeme:' + tname) {
                if (ttype === 'begin' || ttype === 'single' || ttype === 'single_ext') {
                    skip = true;
                } else {
                    skip = false;
                }
            } else {
                let taginfo = [ttype, tname, tattr];
                htmlstr += this.processtag(taginfo);
            }

            if (tname === 'html' && ttype === 'begin' && !html_done) {
                htmlstr += '\n';
                html_done = true;
            }

            if (tname === 'head' && ttype === 'begin' && !head_done) {
                htmlstr += '\n';
                htmlstr += this.meta;
                htmlstr += '<link href="styles.css" rel="stylesheet" type="text/css" />\n';
                head_done = true;
            }

            if (tname === 'body' && ttype === 'begin' && !body_done) {
                htmlstr += '\n';
                body_done = true;
            }
        }
    }

    if (!body_done) {
        htmlstr = '<body>\n' + htmlstr + '</body>\n';
    }
    if (!head_done) {
        let headstr = '<head>\n';
        headstr += this.meta;
        headstr += '<link href="styles.css" rel="stylesheet" type="text/css" />\n';
        headstr += '</head>\n';
        htmlstr = headstr + htmlstr;
    }
    if (!html_done) {
        htmlstr = '<html>\n' + htmlstr + '</html>\n';
    }

    htmlstr = '<?xml version="1.0"?>\n<!DOCTYPE HTML PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n' + htmlstr;

    let css = this.base_css_rules;
    for (const cls in this.tag_css_rules) {
        if (this.tag_css_rules.hasOwnProperty(cls)) {
            css += '.' + cls + ' { ' + this.tag_css_rules[cls] + ' }\n';
        }
    }

    return [htmlstr, css, this.cssname];
};

MobiMLConverter.prototype.ensure_unit = function(raw, unit) {
    unit = unit || 'px';
    if (/\d$/.test(raw)) {
        raw += unit;
    }
    return raw;
};

MobiMLConverter.prototype.taginfo_tostring = function(taginfo) {
    const ttype = taginfo[0];
    const tname = taginfo[1];
    const tattr = taginfo[2];
    if (ttype === null || tname === null) {
        return '';
    }
    if (ttype === 'end') {
        return '</' + tname + '>';
    }
    if (SPECIAL_HANDLING_TYPES.indexOf(ttype) >= 0 && tattr !== null && 'special' in tattr) {
        const info = tattr.special;
        if (ttype === 'comment') {
            return '<' + tname + ' ' + info + '-->';
        } else {
            return '<' + tname + ' ' + info + '>';
        }
    }
    const res = [];
    res.push('<' + tname);
    if (tattr !== null) {
        for (const key in tattr) {
            if (tattr.hasOwnProperty(key)) {
                res.push(' ' + key + '="' + tattr[key] + '"');
            }
        }
    }
    if (ttype === 'single') {
        res.push('/>');
    } else if (ttype === 'single_ext') {
        res.push(' />');
    } else {
        res.push('>');
    }
    return res.join('');
};

MobiMLConverter.prototype.processtag = function(taginfo) {
    const size_map = {
        'xx-small': '1',
        'x-small': '2',
        'small': '3',
        'medium': '4',
        'large': '5',
        'x-large': '6',
        'xx-large': '7',
    };

    const size_to_em_map = {
        '1': '.65em',
        '2': '.75em',
        '3': '1em',
        '4': '1.125em',
        '5': '1.25em',
        '6': '1.5em',
        '7': '2em',
    };

    const ttype = taginfo[0];
    let tname = taginfo[1];
    let tattr = taginfo[2];
    if (!tattr) {
        tattr = {};
    }

    const styles = [];

    if (tname === null || tname.indexOf('removeme') === 0) {
        return '';
    }

    if (tname === 'country-region' || tname === 'place' || tname === 'placetype' || tname === 'placename' ||
            tname === 'state' || tname === 'city' || tname === 'street' || tname === 'address' || tname === 'content') {
        tname = tname === 'content' ? 'div' : 'span';
        for (const key in tattr) {
            if (tattr.hasOwnProperty(key)) {
                delete tattr[key];
            }
        }
    }

    if ('style' in tattr) {
        let style = tattr.style;
        delete tattr.style;
        style = style.trim();
        if (style) {
            styles.push(style);
        }
    }

    if ('align' in tattr) {
        let align = tattr.align;
        delete tattr.align;
        align = align.trim();
        if (align) {
            if (tname !== 'table' && tname !== 'td' && tname !== 'tr') {
                styles.push('text-align: ' + align);
            }
        }
    }

    if ('height' in tattr) {
        let height = tattr.height;
        delete tattr.height;
        height = height.trim();
        if (height && height.indexOf('<') < 0 && height.indexOf('>') < 0 && /\d/.test(height)) {
            if (tname === 'table' || tname === 'td' || tname === 'tr') {
                // pass
            } else if (tname === 'img') {
                tattr.height = height;
            } else {
                styles.push('margin-top: ' + this.ensure_unit(height));
            }
        }
    }

    if ('width' in tattr) {
        let width = tattr.width;
        delete tattr.width;
        width = width.trim();
        if (width && /\d/.test(width)) {
            if (tname === 'table' || tname === 'td' || tname === 'tr') {
                // pass
            } else if (tname === 'img') {
                tattr.width = width;
            } else {
                styles.push('text-indent: ' + this.ensure_unit(width));
                if (width.charAt(0) === '-') {
                    styles.push('margin-left: ' + this.ensure_unit(width.substring(1)));
                }
            }
        }
    }

    if ('bgcolor' in tattr) {
        if (tname === 'div') {
            delete tattr.bgcolor;
        }
    } else if (tname === 'font') {
        tname = 'span';
        if (ttype === 'begin' || ttype === 'single' || ttype === 'single_ext') {
            if ('face' in tattr) {
                const face = tattr.face;
                delete tattr.face;
                styles.push('font-family: "' + face.trim() + '"');
            }

            if ('size' in tattr) {
                let sz = tattr.size;
                delete tattr.size;
                sz = sz.trim().toLowerCase();
                const numSz = parseFloat(sz);
                if (isNaN(numSz) || !/^[-+]?(\d*\.?\d+|\d+\.?)$/.test(sz)) {
                    if (sz in size_map) {
                        sz = size_map[sz];
                    }
                } else {
                    if (sz.charAt(0) === '-' || sz.charAt(0) === '+') {
                        sz = this.current_font_size + numSz;
                        if (sz > 7) {
                            sz = 7;
                        } else if (sz < 1) {
                            sz = 1;
                        }
                        sz = String(Math.floor(sz));
                    }
                }
                styles.push('font-size: ' + size_to_em_map[sz]);
                this.current_font_size = parseInt(sz, 10);
            }
        }
    } else if (tname === 'img') {
        for (let i = 0; i < 2; i++) {
            const attr = i === 0 ? 'width' : 'height';
            if (attr in tattr) {
                const val = tattr[attr];
                if (val.toLowerCase().endsWith('em')) {
                    try {
                        let nval = parseFloat(val.slice(0, -2));
                        nval *= 16 * (168.451 / 72);
                        tattr[attr] = Math.floor(nval) + 'px';
                    } catch (e) {
                        delete tattr[attr];
                    }
                } else if (val.toLowerCase().endsWith('%')) {
                    delete tattr[attr];
                }
            }
        }
    }

    if ('filepos-id' in tattr) {
        tattr.id = tattr['filepos-id'];
        delete tattr['filepos-id'];
        if ('name' in tattr && tattr.name !== tattr.id) {
            tattr.name = tattr.id;
        }
    }

    if ('filepos' in tattr) {
        const filepos = tattr.filepos;
        delete tattr.filepos;
        const intFilepos = parseInt(filepos, 10);
        if (!isNaN(intFilepos)) {
            tattr.href = '#filepos' + intFilepos;
        }
    }

    if (styles.length > 0) {
        let ncls = null;
        const rule = styles.join('; ');
        for (const sel in this.tag_css_rules) {
            if (this.tag_css_rules.hasOwnProperty(sel) && this.tag_css_rules[sel] === rule) {
                ncls = sel;
                break;
            }
        }
        if (ncls === null) {
            this.tag_css_rule_cnt += 1;
            ncls = 'rule_' + this.tag_css_rule_cnt;
            this.tag_css_rules[ncls] = rule;
        }
        let cls = tattr.class || '';
        cls = cls + (cls ? ' ' : '') + ncls;
        tattr.class = cls;
    }

    if (Object.keys(tattr).length === 0) {
        tattr = null;
    }
    const newTagInfo = [ttype, tname, tattr];
    return this.taginfo_tostring(newTagInfo);
};

function main(argv) {
    argv = argv || process.argv;
    if (argv.length !== 3) {
        return 1;
    }
    const infile = argv[2];

    try {
        console.log('Converting Mobi Markup Language to XHTML');
        const mlc = new MobiMLConverter(infile);
        console.log('Processing ...');
        const result = mlc.processml();
        const htmlstr = result[0];
        const css = result[1];
        const cssname = result[2];
        const outname = infile.replace(/\.[^.]*$/, '') + '_converted.html';
        fs.writeFileSync(outname, htmlstr, 'utf-8');
        fs.writeFileSync(cssname, css, 'utf-8');
        console.log('Completed');
        console.log('XHTML version of book can be found at: ' + outname);
    } catch (e) {
        console.log("Error: " + e.message);
        return 1;
    }

    return 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = {
    SPECIAL_HANDLING_TAGS,
    SPECIAL_HANDLING_TYPES,
    SELF_CLOSING_TAGS,
    MobiMLConverter,
    main
};
