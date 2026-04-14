/**
 * mobi_nav.js
 * JavaScript equivalent of Python mobi_nav.py
 * NAV (navigation document) processor for EPUB3
 */

const fs = require('fs');
const path = require('path');
const { unicodeStr } = require('./compatibility_utils');
const { pathof } = require('./unipath');

const DEBUG_NAV = false;
const FORCE_DEFAULT_TITLE = false;
const NAVIGATION_FILENAME = 'nav.xhtml';
const DEFAULT_TITLE = 'Navigation';

class NAVProcessor {
    constructor(files) {
        this.files = files;
        this.navname = NAVIGATION_FILENAME;
    }

    buildLandmarks(guidetext) {
        let header = '';
        header += '  <nav epub:type="landmarks" id="landmarks" hidden="">\n';
        header += '    <h2>Guide</h2>\n';
        header += '    <ol>\n';
        const element = '      <li><a epub:type="{type}" href="{href}">{title}</a></li>\n';
        let footer = '';
        footer += '    </ol>\n';
        footer += '  </nav>\n';

        const typeMap = {
            'cover': 'cover',
            'title-page': 'title-page',
            'text': 'bodymatter',
            'toc': 'toc',
            'loi': 'loi',
            'lot': 'lot',
            'preface': 'preface',
            'bibliography': 'bibliography',
            'index': 'index',
            'glossary': 'glossary',
            'acknowledgements': 'acknowledgements',
            'colophon': null,
            'copyright-page': null,
            'dedication': null,
            'epigraph': null,
            'foreword': null,
            'notes': null
        };

        const reType = /\s+type\s*=\s*"(.*?)"/i;
        const reTitle = /\s+title\s*=\s*"(.*?)"/i;
        const reLink = /\s+href\s*=\s*"(.*?)"/i;
        const dir_ = path.relative(this.files.k8text, this.files.k8oebps).replace(/\\/g, '/');

        let data = '';
        const references = unicodeStr(guidetext).match(/<reference\s+.*?>/gi) || [];
        for (const reference of references) {
            const moType = reType.exec(reference);
            const moTitle = reTitle.exec(reference);
            const moLink = reLink.exec(reference);
            
            let type_ = null;
            if (moType !== null) {
                type_ = typeMap[moType[1]];
            }
            
            let title = null;
            if (moTitle !== null) {
                title = moTitle[1];
            }
            
            let link = null;
            if (moLink !== null) {
                link = moLink[1];
            }

            if (type_ !== null && type_ !== undefined && title !== null && link !== null) {
                link = path.relative(dir_, link).replace(/\\/g, '/');
                data += element.replace('{type}', type_).replace('{href}', link).replace('{title}', title);
            }
        }
        
        if (data.length > 0) {
            return header + data + footer;
        } else {
            return '';
        }
    }

    buildTOC(indxData) {
        let header = '';
        header += '  <nav epub:type="toc" id="toc">\n';
        header += '    <h1>Table of contents</h1>\n';
        const footer = '  </nav>\n';

        const recursINDX = (maxLvl = 0, num = 0, lvl = 0, start = -1, end = -1) => {
            if (start > indxData.length || end > indxData.length) {
                console.log("Warning (in buildTOC): missing INDX child entries", start, end, indxData.length);
                return ['', maxLvl, num];
            }
            if (DEBUG_NAV) {
                console.log("recursINDX (in buildTOC) lvl " + lvl + " from " + start + " to " + end);
            }
            let xhtml = '';
            if (start <= 0) start = 0;
            if (end <= 0) end = indxData.length;
            if (lvl > maxLvl) maxLvl = lvl;

            const indent1 = '  '.repeat(2 + lvl * 2);
            const indent2 = '  '.repeat(3 + lvl * 2);
            xhtml += indent1 + '<ol>\n';
            for (let i = start; i < end; i++) {
                const e = indxData[i];
                const htmlfile = e.filename;
                const desttag = e.idtag;
                const text = e.text;
                if (e.hlvl !== lvl) {
                    continue;
                }
                num += 1;
                let link;
                if (desttag === '') {
                    link = htmlfile;
                } else {
                    link = htmlfile + '#' + desttag;
                }
                xhtml += indent2 + '<li>';
                const entry = '<a href="' + link + '">' + text + '</a>';
                xhtml += entry;
                if (e.child1 >= 0) {
                    xhtml += '\n';
                    const [xhtmlrec, newMaxLvl, newNum] = recursINDX(maxLvl, num, lvl + 1, e.child1, e.childn + 1);
                    xhtml += xhtmlrec;
                    maxLvl = newMaxLvl;
                    num = newNum;
                    xhtml += indent2;
                }
                xhtml += '</li>\n';
            }
            xhtml += indent1 + '</ol>\n';
            return [xhtml, maxLvl, num];
        };

        const [data, maxLvl, num] = recursINDX();
        if (indxData.length !== num) {
            console.log("Warning (in buildTOC): different number of entries in NCX", indxData.length, num);
        }
        return header + data + footer;
    }

    buildNAV(ncxData, guidetext, title, lang) {
        console.log("Building Navigation Document.");
        if (FORCE_DEFAULT_TITLE) {
            title = DEFAULT_TITLE;
        }
        let navHeader = '';
        navHeader += '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>';
        navHeader += '<html xmlns="http://www.w3.org/1999/xhtml"';
        navHeader += ' xmlns:epub="http://www.idpf.org/2007/ops"';
        navHeader += ' lang="' + lang + '" xml:lang="' + lang + '">\n';
        navHeader += '<head>\n<title>' + title + '</title>\n';
        navHeader += '<meta charset="UTF-8" />\n';
        navHeader += '<style type="text/css">\n';
        navHeader += 'nav#landmarks { display:none; }\n';
        navHeader += 'ol { list-style-type: none; }';
        navHeader += '</style>\n</head>\n<body>\n';
        const navFooter = '</body>\n</html>\n';

        const landmarks = this.buildLandmarks(guidetext);
        const toc = this.buildTOC(ncxData);

        let data = navHeader;
        data += landmarks;
        data += toc;
        data += navFooter;
        return data;
    }

    getNAVName() {
        return this.navname;
    }

    writeNAV(ncxData, guidetext, metadata) {
        const title = (metadata['Title'] || [''])[0];
        const lang = (metadata['Language'] || ['en'])[0];
        const xhtml = this.buildNAV(ncxData, guidetext, title, lang);
        const fname = path.join(this.files.k8text, this.navname);
        fs.writeFileSync(pathof(fname), Buffer.from(xhtml, 'utf-8'));
    }
}

module.exports = {
    NAVProcessor
};
