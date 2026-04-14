/**
 * mobi_ncx.js
 * JavaScript equivalent of Python mobi_ncx.py
 * NCX file extraction and building
 */

const fs = require('fs');
const path = require('path');
const { pathof } = require('./unipath');
const { unescapeit } = require('./compatibility_utils');
const { toBase32 } = require('./mobi_utils');
const { MobiIndex } = require('./mobi_index');

const DEBUG_NCX = false;

function xmlescape(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

class ncxExtract {
    constructor(mh, files) {
        this.mh = mh;
        this.sect = this.mh.sect;
        this.files = files;
        this.isNCX = false;
        this.mi = new MobiIndex(this.sect);
        this.ncxidx = this.mh.ncxidx;
        this.indx_data = null;
    }

    parseNCX() {
        const indxData = [];
        const tagFieldnameMap = {
            1: ['pos', 0],
            2: ['len', 0],
            3: ['noffs', 0],
            4: ['hlvl', 0],
            5: ['koffs', 0],
            6: ['pos_fid', 0],
            21: ['parent', 0],
            22: ['child1', 0],
            23: ['childn', 0]
        };
        
        if (this.ncxidx !== 0xffffffff) {
            const [outtbl, ctocText] = this.mi.getIndexData(this.ncxidx, 'NCX');
            if (DEBUG_NCX) {
                console.log(ctocText);
                console.log(outtbl);
            }
            let num = 0;
            for (const [text, tagMap] of outtbl) {
                const tmp = {
                    name: text.toString('utf-8'),
                    pos: -1,
                    len: 0,
                    noffs: -1,
                    text: 'Unknown Text',
                    hlvl: -1,
                    kind: 'Unknown Kind',
                    pos_fid: null,
                    parent: -1,
                    child1: -1,
                    childn: -1,
                    num: num
                };
                for (const tag in tagFieldnameMap) {
                    const [fieldname, i] = tagFieldnameMap[tag];
                    if (tag in tagMap) {
                        let fieldvalue = tagMap[tag][i];
                        if (parseInt(tag) === 6) {
                            const pos_fid = toBase32(fieldvalue, 4).toString('utf-8');
                            const fieldvalue2 = tagMap[tag][i + 1];
                            const pos_off = toBase32(fieldvalue2, 10).toString('utf-8');
                            fieldvalue = 'kindle:pos:fid:' + pos_fid + ':off:' + pos_off;
                        }
                        tmp[fieldname] = fieldvalue;
                        if (parseInt(tag) === 3) {
                            let toctext = ctocText[fieldvalue];
                            if (toctext === undefined) {
                                toctext = Buffer.from('Unknown Text');
                            }
                            tmp.text = toctext.toString(this.mh.codec);
                        }
                        if (parseInt(tag) === 5) {
                            let kindtext = ctocText[fieldvalue];
                            if (kindtext === undefined) {
                                kindtext = Buffer.from('Unknown Kind');
                            }
                            tmp.kind = kindtext.toString(this.mh.codec);
                        }
                    }
                }
                indxData.push(tmp);
                if (DEBUG_NCX) {
                    console.log('record number: ', num);
                    console.log('name: ', tmp.name);
                    console.log('position', tmp.pos, ' length: ', tmp.len);
                    console.log('text: ', tmp.text);
                    console.log('kind: ', tmp.kind);
                    console.log('heading level: ', tmp.hlvl);
                    console.log('parent:', tmp.parent);
                    console.log('first child: ', tmp.child1, ' last child: ', tmp.childn);
                    console.log('pos_fid is ', tmp.pos_fid);
                    console.log('\n\n');
                }
                num += 1;
            }
        }
        this.indx_data = indxData;
        return indxData;
    }

    buildNCX(htmlfile, title, ident, lang) {
        const indxData = this.indx_data;

        const ncxHeader = `<?xml version='1.0' encoding='utf-8'?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head>
<meta content="${ident}" name="dtb:uid"/>
<meta content="%d" name="dtb:depth"/>
<meta content="mobiunpack.py" name="dtb:generator"/>
<meta content="0" name="dtb:totalPageCount"/>
<meta content="0" name="dtb:maxPageNumber"/>
</head>
<docTitle>
<text>%s</text>
</docTitle>
<navMap>
`;

        const ncxFooter = `  </navMap>
</ncx>
`;

        const ncxEntry = `<navPoint id="%s" playOrder="%d">
<navLabel>
<text>%s</text>
</navLabel>
<content src="%s"/>`;

        const recursINDX = (maxLvl = 0, num = 0, lvl = 0, start = -1, end = -1) => {
            if (start > indxData.length || end > indxData.length) {
                console.log('Warning: missing INDX child entries', start, end, indxData.length);
                return ['', maxLvl, num];
            }
            if (DEBUG_NCX) {
                console.log('recursINDX lvl ' + lvl + ' from ' + start + ' to ' + end);
            }
            let xml = '';
            if (start <= 0) start = 0;
            if (end <= 0) end = indxData.length;
            if (lvl > maxLvl) maxLvl = lvl;
            const indent = '  '.repeat(2 + lvl);

            for (let i = start; i < end; i++) {
                const e = indxData[i];
                if (e.hlvl !== lvl) {
                    continue;
                }
                num += 1;
                const link = htmlfile + '#filepos' + e.pos;
                const tagid = 'np_' + num;
                let entry = ncxEntry.replace('%s', tagid).replace('%d', num).replace('%s', xmlescape(unescapeit(e.text))).replace('%s', link);
                entry = entry.replace(/^/gm, indent) + '\n';
                xml += entry;
                if (e.child1 >= 0) {
                    const [xmlrec, newMaxLvl, newNum] = recursINDX(maxLvl, num, lvl + 1, e.child1, e.childn + 1);
                    xml += xmlrec;
                    maxLvl = newMaxLvl;
                    num = newNum;
                }
                xml += indent + '</navPoint>\n';
            }
            return [xml, maxLvl, num];
        };

        const [body, maxLvl, num] = recursINDX();
        const header = ncxHeader.replace('%d', maxLvl + 1).replace('%s', xmlescape(unescapeit(title)));
        const ncx = header + body + ncxFooter;
        if (indxData.length !== num) {
            console.log('Warning: different number of entries in NCX', indxData.length, num);
        }
        return ncx;
    }

    writeNCX(metadata) {
        this.isNCX = true;
        console.log('Write ncx');
        const htmlname = 'book.html';
        const xml = this.buildNCX(htmlname, metadata.Title[0], metadata.UniqueID[0], metadata.Language ? metadata.Language[0] : 'en');
        const ncxname = path.join(this.files.mobi7dir, 'toc.ncx');
        fs.writeFileSync(pathof(ncxname), Buffer.from(xml, 'utf-8'));
    }

    buildK8NCX(indxData, title, ident, lang) {
        const ncxHeader = `<?xml version='1.0' encoding='utf-8'?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head>
<meta content="${ident}" name="dtb:uid"/>
<meta content="%d" name="dtb:depth"/>
<meta content="mobiunpack.py" name="dtb:generator"/>
<meta content="0" name="dtb:totalPageCount"/>
<meta content="0" name="dtb:maxPageNumber"/>
</head>
<docTitle>
<text>%s</text>
</docTitle>
<navMap>
`;

        const ncxFooter = `  </navMap>
</ncx>
`;

        const ncxEntry = `<navPoint id="%s" playOrder="%d">
<navLabel>
<text>%s</text>
</navLabel>
<content src="%s"/>`;

        const recursINDX = (maxLvl = 0, num = 0, lvl = 0, start = -1, end = -1) => {
            if (start > indxData.length || end > indxData.length) {
                console.log('Warning: missing INDX child entries', start, end, indxData.length);
                return ['', maxLvl, num];
            }
            if (DEBUG_NCX) {
                console.log('recursINDX lvl ' + lvl + ' from ' + start + ' to ' + end);
            }
            let xml = '';
            if (start <= 0) start = 0;
            if (end <= 0) end = indxData.length;
            if (lvl > maxLvl) maxLvl = lvl;
            const indent = '  '.repeat(2 + lvl);

            for (let i = start; i < end; i++) {
                const e = indxData[i];
                const htmlfile = e.filename;
                const desttag = e.idtag;
                if (e.hlvl !== lvl) {
                    continue;
                }
                num += 1;
                let link;
                if (desttag === '') {
                    link = 'Text/' + htmlfile;
                } else {
                    link = 'Text/' + htmlfile + '#' + desttag;
                }
                const tagid = 'np_' + num;
                let entry = ncxEntry.replace('%s', tagid).replace('%d', num).replace('%s', xmlescape(unescapeit(e.text))).replace('%s', link);
                entry = entry.replace(/^/gm, indent) + '\n';
                xml += entry;
                if (e.child1 >= 0) {
                    const [xmlrec, newMaxLvl, newNum] = recursINDX(maxLvl, num, lvl + 1, e.child1, e.childn + 1);
                    xml += xmlrec;
                    maxLvl = newMaxLvl;
                    num = newNum;
                }
                xml += indent + '</navPoint>\n';
            }
            return [xml, maxLvl, num];
        };

        const [body, maxLvl, num] = recursINDX();
        const header = ncxHeader.replace('%d', maxLvl + 1).replace('%s', xmlescape(unescapeit(title)));
        const ncx = header + body + ncxFooter;
        if (indxData.length !== num) {
            console.log('Warning: different number of entries in NCX', indxData.length, num);
        }
        return ncx;
    }

    writeK8NCX(ncxData, metadata) {
        this.isNCX = true;
        console.log('Write K8 ncx');
        const xml = this.buildK8NCX(ncxData, metadata.Title[0], metadata.UniqueID[0], metadata.Language ? metadata.Language[0] : 'en');
        const bname = 'toc.ncx';
        const ncxname = path.join(this.files.k8oebps, bname);
        fs.writeFileSync(pathof(ncxname), Buffer.from(xml, 'utf-8'));
    }
}

module.exports = {
    ncxExtract
};
