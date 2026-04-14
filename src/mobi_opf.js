'use strict';

const path = require('path');
const fs = require('fs');

const { unicodeStr, unescapeit, lzip } = require('./compatibility_utils');
const { pathof } = require('./unipath');

function xmlescape(str, extras) {
    let res = String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (extras) {
        for (const key of Object.keys(extras)) {
            res = res.split(key).join(extras[key]);
        }
    }
    return res;
}

function uuid4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const EPUB3_WITH_NCX = true;
const EPUB3_WITH_GUIDE = true;
const EPUB_OPF = 'content.opf';
const TOC_NCX = 'toc.ncx';
const NAVIGATION_DOCUMENT = 'nav.xhtml';
const BEGIN_INFO_ONLY = '<!-- BEGIN INFORMATION ONLY ';
const END_INFO_ONLY = 'END INFORMATION ONLY -->';
const EXTH_TITLE_FURIGANA = 'Title-Pronunciation';
const EXTH_CREATOR_FURIGANA = 'Author-Pronunciation';
const EXTH_PUBLISHER_FURIGANA = 'Publisher-Pronunciation';
const EXTRA_ENTITIES = {'"': '&quot;', "'": "&apos;"};

class OPFProcessor {

    constructor(files, metadata, fileinfo, rscnames, hasNCX, mh, usedmap, pagemapxml, guidetext, k8resc, epubver) {
        pagemapxml = pagemapxml || '';
        guidetext = guidetext || '';
        k8resc = k8resc || null;
        epubver = epubver || '2';

        this.files = files;
        this.metadata = metadata;
        this.fileinfo = fileinfo;
        this.rscnames = rscnames;
        this.has_ncx = hasNCX;
        this.codec = mh.codec;
        this.isK8 = mh.isK8();
        this.printReplica = mh.isPrintReplica();
        this.guidetext = unicodeStr(guidetext);
        this.used = usedmap;
        this.k8resc = k8resc;
        this.covername = null;
        this.cover_id = 'cover_img';
        if (this.k8resc !== null && this.k8resc.cover_name !== null) {
            this.cover_id = this.k8resc.cover_name;
        }
        this.BookId = unicodeStr(uuid4());
        this.pagemap = pagemapxml;

        this.ncxname = null;
        this.navname = null;

        const ppdArr = metadata['page-progression-direction'];
        this.page_progression_direction = ppdArr ? ppdArr[0] : null;
        if (ppdArr) {
            delete metadata['page-progression-direction'];
        }

        const pwmArr = metadata['primary-writing-mode'];
        if (pwmArr && pwmArr[0].indexOf('rl') !== -1) {
            this.page_progression_direction = 'rtl';
        }

        this.epubver = epubver;
        this.target_epubver = epubver;
        if (this.epubver === 'A') {
            this.target_epubver = this.autodetectEPUBVersion();
        } else if (this.epubver === 'F') {
            this.target_epubver = '2';
        } else if (this.epubver !== '2' && this.epubver !== '3') {
            this.target_epubver = '2';
        }

        this.title_id = {};
        this.creator_id = {};
        this.publisher_id = {};
        this.title_attrib = {};
        this.creator_attrib = {};
        this.publisher_attrib = {};
        this.extra_attributes = [];
        this.exth_solved_refines_metadata = [];
        this.exth_refines_metadata = [];
        this.exth_fixedlayout_metadata = [];

        this.defineRefinesID();
        this.processRefinesMetadata();
        if (this.k8resc !== null) {
            this.k8resc.createMetadata(epubver);
        }
        if (this.target_epubver === '3') {
            this.createMetadataForFixedlayout();
        }
    }

    escapeit(sval, EXTRAS) {
        sval = unicodeStr(sval);
        if (EXTRAS) {
            return xmlescape(unescapeit(sval), EXTRAS);
        }
        return xmlescape(unescapeit(sval));
    }

    createMetaTag(data, property, content, refid) {
        refid = refid || '';
        let refines = '';
        if (refid) {
            refines = ' refines="#' + refid + '"';
        }
        data.push('<meta property="' + property + '"' + refines + '>' + content + '</meta>\n');
    }

    buildOPFMetadata(start_tag, has_obfuscated_fonts) {
        has_obfuscated_fonts = has_obfuscated_fonts || false;

        const metadata = this.metadata;
        const k8resc = this.k8resc;

        const META_TAGS = ['Drm Server Id', 'Drm Commerce Id', 'Drm Ebookbase Book Id', 'ASIN', 'ThumbOffset', 'Fake Cover',
                           'Creator Software', 'Creator Major Version', 'Creator Minor Version', 'Creator Build Number',
                           'Watermark', 'Clipping Limit', 'Publisher Limit', 'Text to Speech Disabled', 'CDE Type',
                           'Updated Title', 'Font Signature (hex)', 'Tamper Proof Keys (hex)'];

        const self = this;

        function handleTag(data, metadata, key, tag, attrib) {
            attrib = attrib || {};
            if (key in metadata) {
                metadata[key].forEach(function(value, i) {
                    const closingTag = tag.split(' ')[0];
                    const attr = attrib[i] || '';
                    const res = '<' + tag + attr + '>' + self.escapeit(value) + '</' + closingTag + '>\n';
                    data.push(res);
                });
                delete metadata[key];
            }
        }

        function handleMetaPairs(data, metadata, key, name) {
            if (key in metadata) {
                metadata[key].forEach(function(value) {
                    const res = '<meta name="' + name + '" content="' + self.escapeit(value, EXTRA_ENTITIES) + '" />\n';
                    data.push(res);
                });
                delete metadata[key];
            }
        }

        const data = [];
        data.push(start_tag + '\n');
        if ('Title' in metadata) {
            handleTag(data, metadata, 'Title', 'dc:title', this.title_attrib);
        } else {
            data.push('<dc:title>Untitled</dc:title>\n');
        }
        handleTag(data, metadata, 'Language', 'dc:language');
        if ('UniqueID' in metadata) {
            handleTag(data, metadata, 'UniqueID', 'dc:identifier id="uid"');
        } else {
            data.push('<dc:identifier id="uid">0</dc:identifier>\n');
        }

        if (this.target_epubver === '3') {
            this.createMetaTag(data, 'dcterms:modified', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
        }

        if (this.isK8 && has_obfuscated_fonts) {
            if (this.target_epubver === '3') {
                data.push('<dc:identifier>urn:uuid:' + this.BookId + '</dc:identifier>\n');
            } else {
                data.push('<dc:identifier opf:scheme="UUID">urn:uuid:' + this.BookId + '</dc:identifier>\n');
            }
        }

        handleTag(data, metadata, 'Creator', 'dc:creator', this.creator_attrib);
        handleTag(data, metadata, 'Contributor', 'dc:contributor');
        handleTag(data, metadata, 'Publisher', 'dc:publisher', this.publisher_attrib);
        handleTag(data, metadata, 'Source', 'dc:source');
        handleTag(data, metadata, 'Type', 'dc:type');
        if (this.target_epubver === '3') {
            if ('ISBN' in metadata) {
                metadata['ISBN'].forEach(function(value) {
                    const res = '<dc:identifier>urn:isbn:' + self.escapeit(value) + '</dc:identifier>\n';
                    data.push(res);
                });
                delete metadata['ISBN'];
            }
        } else {
            handleTag(data, metadata, 'ISBN', 'dc:identifier opf:scheme="ISBN"');
        }
        if ('Subject' in metadata) {
            let codeList;
            if ('SubjectCode' in metadata) {
                codeList = metadata['SubjectCode'];
                delete metadata['SubjectCode'];
            } else {
                codeList = null;
            }
            for (let i = 0; i < metadata['Subject'].length; i++) {
                if (codeList && i < codeList.length) {
                    data.push('<dc:subject BASICCode="' + codeList[i] + '">');
                } else {
                    data.push('<dc:subject>');
                }
                data.push(this.escapeit(metadata['Subject'][i]) + '</dc:subject>\n');
            }
            delete metadata['Subject'];
        }
        handleTag(data, metadata, 'Description', 'dc:description');
        if (this.target_epubver === '3') {
            if ('Published' in metadata) {
                metadata['Published'].forEach(function(value) {
                    const res = '<dc:date>' + self.escapeit(value) + '</dc:date>\n';
                    data.push(res);
                });
                delete metadata['Published'];
            }
        } else {
            handleTag(data, metadata, 'Published', 'dc:date opf:event="publication"');
        }
        handleTag(data, metadata, 'Rights', 'dc:rights');

        if (this.epubver === 'F') {
            if (this.extra_attributes.length > 0 || (k8resc !== null && k8resc.extra_attributes.length > 0)) {
                data.push('<!-- THE FOLLOWINGS ARE REQUIRED TO INSERT INTO <dc:xxx> MANUALLY\n');
                if (this.extra_attributes.length > 0) {
                    data.push.apply(data, this.extra_attributes);
                }
                if (k8resc !== null && k8resc.extra_attributes.length > 0) {
                    data.push.apply(data, k8resc.extra_attributes);
                }
                data.push('-->\n');
            }
        } else {
            if (this.exth_solved_refines_metadata.length > 0) {
                data.push('<!-- Refines MetaData from EXTH -->\n');
                data.push.apply(data, this.exth_solved_refines_metadata);
            }
            if (this.exth_refines_metadata.length > 0 || (k8resc !== null && k8resc.refines_metadata.length > 0)) {
                data.push('<!-- THE FOLLOWINGS ARE REQUIRED TO EDIT IDS MANUALLY\n');
                if (this.exth_refines_metadata.length > 0) {
                    data.push.apply(data, this.exth_refines_metadata);
                }
                if (k8resc !== null && k8resc.refines_metadata.length > 0) {
                    data.push.apply(data, k8resc.refines_metadata);
                }
                data.push('-->\n');
            }
        }

        if (k8resc !== null && k8resc.extra_metadata.length > 0) {
            data.push('<!-- Extra MetaData from RESC\n');
            data.push.apply(data, k8resc.extra_metadata);
            data.push('-->\n');
        }

        if ('CoverOffset' in metadata) {
            const imageNumber = parseInt(metadata['CoverOffset'][0], 10);
            this.covername = this.rscnames[imageNumber];
            if (this.covername === null || this.covername === undefined) {
                console.log('Error: Cover image ' + imageNumber + ' was not recognized as a valid image');
            } else {
                data.push('<meta name="cover" content="' + this.cover_id + '" />\n');
                this.used[this.covername] = 'used';
            }
            delete metadata['CoverOffset'];
        }

        handleMetaPairs(data, metadata, 'Codec', 'output encoding');
        handleTag(data, metadata, 'DictInLanguage', 'DictionaryInLanguage');
        handleTag(data, metadata, 'DictOutLanguage', 'DictionaryOutLanguage');
        handleMetaPairs(data, metadata, 'RegionMagnification', 'RegionMagnification');
        handleMetaPairs(data, metadata, 'book-type', 'book-type');
        handleMetaPairs(data, metadata, 'zero-gutter', 'zero-gutter');
        handleMetaPairs(data, metadata, 'zero-margin', 'zero-margin');
        handleMetaPairs(data, metadata, 'primary-writing-mode', 'primary-writing-mode');
        handleMetaPairs(data, metadata, 'fixed-layout', 'fixed-layout');
        handleMetaPairs(data, metadata, 'orientation-lock', 'orientation-lock');
        handleMetaPairs(data, metadata, 'original-resolution', 'original-resolution');

        handleMetaPairs(data, metadata, 'Review', 'review');
        handleMetaPairs(data, metadata, 'Imprint', 'imprint');
        handleMetaPairs(data, metadata, 'Adult', 'adult');
        handleMetaPairs(data, metadata, 'DictShortName', 'DictionaryVeryShortName');

        if ('Price' in metadata && 'Currency' in metadata) {
            const priceList = metadata['Price'];
            const currencyList = metadata['Currency'];
            if (priceList.length !== currencyList.length) {
                console.log('Error: found ' + priceList.length + ' price entries, but ' + currencyList.length + ' currency entries.');
            } else {
                for (let i = 0; i < priceList.length; i++) {
                    data.push('<SRP Currency="' + currencyList[i] + '">' + priceList[i] + '</SRP>\n');
                }
            }
            delete metadata['Price'];
            delete metadata['Currency'];
        }

        if (this.target_epubver === '3') {
            if (this.exth_fixedlayout_metadata.length > 0) {
                data.push('<!-- EPUB3 MetaData converted from EXTH -->\n');
                data.push.apply(data, this.exth_fixedlayout_metadata);
            }
        }

        data.push(BEGIN_INFO_ONLY + '\n');
        if ('ThumbOffset' in metadata) {
            const imageNumber = parseInt(metadata['ThumbOffset'][0], 10);
            let imageName;
            try {
                imageName = this.rscnames[imageNumber];
            } catch (e) {
                console.log('Number given for Cover Thumbnail is out of range: ' + imageNumber);
                imageName = null;
            }
            if (imageName === null || imageName === undefined) {
                console.log('Error: Cover Thumbnail image ' + imageNumber + ' was not recognized as a valid image');
            } else {
                data.push('<meta name="Cover ThumbNail Image" content="' + 'Images/' + imageName + '" />\n');
                this.used[imageName] = 'not used';
            }
            delete metadata['ThumbOffset'];
        }
        META_TAGS.forEach(function(metaName) {
            if (metaName in metadata) {
                metadata[metaName].forEach(function(value) {
                    data.push('<meta name="' + metaName + '" content="' + self.escapeit(value, EXTRA_ENTITIES) + '" />\n');
                });
                delete metadata[metaName];
            }
        });
        const remainingKeys = Object.keys(metadata);
        remainingKeys.forEach(function(key) {
            metadata[key].forEach(function(value) {
                data.push('<meta name="' + key + '" content="' + self.escapeit(value, EXTRA_ENTITIES) + '" />\n');
            });
            delete metadata[key];
        });
        data.push(END_INFO_ONLY + '\n');
        data.push('</metadata>\n');
        return data;
    }

    buildOPFManifest(ncxname, navname) {
        const k8resc = this.k8resc;
        const cover_id = this.cover_id;
        const hasK8RescSpine = k8resc !== null && k8resc.hasSpine();
        this.ncxname = ncxname;
        this.navname = navname;

        const data = [];
        data.push('<manifest>\n');
        const media_map = {
            '.jpg'  : 'image/jpeg',
            '.jpeg' : 'image/jpeg',
            '.png'  : 'image/png',
            '.gif'  : 'image/gif',
            '.svg'  : 'image/svg+xml',
            '.xhtml': 'application/xhtml+xml',
            '.html' : 'text/html',
            '.pdf'  : 'application/pdf',
            '.ttf'  : 'application/x-font-ttf',
            '.otf'  : 'application/x-font-opentype',
            '.css'  : 'text/css',
        };
        const spinerefs = [];

        let idcnt = 0;
        for (const [key, dir, fname] of this.fileinfo) {
            const ext = path.extname(fname).toLowerCase();
            let media = media_map[ext];
            let ref = 'item' + idcnt;
            if (hasK8RescSpine) {
                if (key !== null && key in k8resc.spine_idrefs) {
                    ref = k8resc.spine_idrefs[key];
                }
            }
            let properties = '';
            const fpath = dir !== '' ? dir + '/' + fname : fname;
            data.push('<item id="' + ref + '" media-type="' + media + '" href="' + fpath + '" ' + properties + '/>\n');

            if (ext === '.xhtml' || ext === '.html') {
                spinerefs.push(ref);
            }
            idcnt += 1;
        }

        for (const fname of this.rscnames) {
            if (fname !== null) {
                if ((this.used[fname] || 'not used') === 'not used') {
                    continue;
                }
                const ext = path.extname(fname).toLowerCase();
                let media = media_map[ext] || ext.slice(1);
                let properties = '';
                let ref;
                if (fname === this.covername) {
                    ref = cover_id;
                    if (this.target_epubver === '3') {
                        properties = 'properties="cover-image"';
                    }
                } else {
                    ref = 'item' + idcnt;
                }
                if (ext === '.ttf' || ext === '.otf') {
                    if (this.isK8) {
                        const fpath = 'Fonts/' + fname;
                        data.push('<item id="' + ref + '" media-type="' + media + '" href="' + fpath + '" ' + properties + '/>\n');
                    }
                } else {
                    const fpath = 'Images/' + fname;
                    data.push('<item id="' + ref + '" media-type="' + media + '" href="' + fpath + '" ' + properties + '/>\n');
                }
                idcnt += 1;
            }
        }

        if (this.target_epubver === '3' && navname !== null && navname !== undefined) {
            data.push('<item id="nav" media-type="application/xhtml+xml" href="Text/' + navname + '" properties="nav"/>\n');
        }
        if (this.has_ncx && ncxname !== null && ncxname !== undefined) {
            data.push('<item id="ncx" media-type="application/x-dtbncx+xml" href="' + ncxname + '" />\n');
        }
        if (this.pagemap !== '') {
            data.push('<item id="map" media-type="application/oebs-page-map+xml" href="page-map.xml" />\n');
        }
        data.push('</manifest>\n');
        return [data, spinerefs];
    }

    buildOPFSpine(spinerefs, isNCX) {
        const k8resc = this.k8resc;
        const hasK8RescSpine = k8resc !== null && k8resc.hasSpine();
        const data = [];
        let ppd = '';
        if (this.isK8 && this.page_progression_direction !== null) {
            ppd = ' page-progression-direction="' + this.page_progression_direction + '"';
        }
        let ncx = '';
        if (isNCX) {
            ncx = ' toc="ncx"';
        }
        let map = '';
        if (this.pagemap !== '') {
            map = ' page-map="map"';
        }
        let spine_start_tag;
        if (this.epubver === 'F') {
            if (ppd) {
                ppd = '<!--' + ppd + ' -->';
            }
            spine_start_tag = '<spine' + map + ncx + '>' + ppd + '\n';
        } else {
            spine_start_tag = '<spine' + ppd + map + ncx + '>\n';
        }
        data.push(spine_start_tag);

        if (hasK8RescSpine) {
            for (const key of k8resc.spine_order) {
                const idref = k8resc.spine_idrefs[key];
                const attribs = k8resc.spine_pageattributes[key];
                let tag = '<itemref idref="' + idref + '"';
                for (const [aname, val] of Object.entries(attribs)) {
                    if (this.epubver === 'F' && aname === 'properties') {
                        continue;
                    }
                    if (val !== null && val !== undefined) {
                        tag += ' ' + aname + '="' + val + '"';
                    }
                }
                tag += '/>';
                if (this.epubver === 'F' && 'properties' in attribs) {
                    const val = attribs['properties'];
                    if (val !== null && val !== undefined) {
                        tag += '<!-- properties="' + val + '" -->';
                    }
                }
                tag += '\n';
                data.push(tag);
            }
        } else {
            let start = 0;
            const [key, dir, fname] = this.fileinfo[0];
            if (key !== null && key === 'coverpage') {
                const entry = spinerefs[start];
                data.push('<itemref idref="' + entry + '" linear="no"/>\n');
                start += 1;
            }
            for (let i = start; i < spinerefs.length; i++) {
                data.push('<itemref idref="' + spinerefs[i] + '"/>\n');
            }
        }
        data.push('</spine>\n');
        return data;
    }

    buildMobi7OPF() {
        console.log('Building an opf for mobi7/azw4.');
        const data = [];
        data.push('<?xml version="1.0" encoding="utf-8"?>\n');
        data.push('<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid">\n');
        const metadata_tag = '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">';
        const opf_metadata = this.buildOPFMetadata(metadata_tag);
        data.push.apply(data, opf_metadata);
        let ncxname;
        if (this.has_ncx) {
            ncxname = 'toc.ncx';
        } else {
            ncxname = null;
        }
        const [opf_manifest, spinerefs] = this.buildOPFManifest(ncxname);
        data.push.apply(data, opf_manifest);
        const opf_spine = this.buildOPFSpine(spinerefs, this.has_ncx);
        data.push.apply(data, opf_spine);
        data.push('<tours>\n</tours>\n');
        if (!this.printReplica) {
            const guide = '<guide>\n' + this.guidetext + '</guide>\n';
            data.push(guide);
        }
        data.push('</package>\n');
        return data.join('');
    }

    buildEPUBOPF(has_obfuscated_fonts) {
        has_obfuscated_fonts = has_obfuscated_fonts || false;
        console.log('Building an opf for mobi8 using epub version: ', this.target_epubver);
        let has_ncx, has_guide, ncxname, navname, packageTag, tours, metadata_tag;
        if (this.target_epubver === '2') {
            has_ncx = this.has_ncx;
            has_guide = true;
            ncxname = TOC_NCX;
            navname = null;
            packageTag = '<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid">\n';
            tours = '<tours>\n</tours>\n';
            metadata_tag = '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">';
        } else {
            has_ncx = EPUB3_WITH_NCX;
            has_guide = EPUB3_WITH_GUIDE;
            ncxname = null;
            if (has_ncx) {
                ncxname = TOC_NCX;
            }
            navname = NAVIGATION_DOCUMENT;
            packageTag = '<package version="3.0" xmlns="http://www.idpf.org/2007/opf" prefix="rendition: http://www.idpf.org/vocab/rendition/#" unique-identifier="uid">\n';
            tours = '';
            metadata_tag = '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">';
        }

        const data = [];
        data.push('<?xml version="1.0" encoding="utf-8"?>\n');
        data.push(packageTag);
        const opf_metadata = this.buildOPFMetadata(metadata_tag, has_obfuscated_fonts);
        data.push.apply(data, opf_metadata);
        const [opf_manifest, spinerefs] = this.buildOPFManifest(ncxname, navname);
        data.push.apply(data, opf_manifest);
        const opf_spine = this.buildOPFSpine(spinerefs, has_ncx);
        data.push.apply(data, opf_spine);
        data.push(tours);
        if (has_guide) {
            const guide = '<guide>\n' + this.guidetext + '</guide>\n';
            data.push(guide);
        }
        data.push('</package>\n');
        return data.join('');
    }

    writeOPF(has_obfuscated_fonts) {
        has_obfuscated_fonts = has_obfuscated_fonts || false;
        if (this.isK8) {
            const data = this.buildEPUBOPF(has_obfuscated_fonts);
            const outopf = path.join(this.files.k8oebps, EPUB_OPF);
            fs.writeFileSync(pathof(outopf), data, 'utf8');
            return this.BookId;
        } else {
            const data = this.buildMobi7OPF();
            const outopf = path.join(this.files.mobi7dir, 'content.opf');
            fs.writeFileSync(pathof(outopf), data, 'utf8');
            return 0;
        }
    }

    getBookId() {
        return this.BookId;
    }

    getNCXName() {
        return this.ncxname;
    }

    getNAVName() {
        return this.navname;
    }

    getEPUBVersion() {
        return this.target_epubver;
    }

    hasNCX() {
        return this.ncxname !== null && this.has_ncx;
    }

    hasNAV() {
        return this.navname !== null;
    }

    autodetectEPUBVersion() {
        const metadata = this.metadata;
        const k8resc = this.k8resc;
        let epubver = '2';
        if ('true' === (metadata['fixed-layout'] || [''])[0].toLowerCase()) {
            epubver = '3';
        } else if (['portrait', 'landscape'].indexOf((metadata['orientation-lock'] || [''])[0].toLowerCase()) !== -1) {
            epubver = '3';
        } else if (this.page_progression_direction === 'rtl') {
            epubver = '3';
        } else if (EXTH_TITLE_FURIGANA in metadata) {
            epubver = '3';
        } else if (EXTH_CREATOR_FURIGANA in metadata) {
            epubver = '3';
        } else if (EXTH_PUBLISHER_FURIGANA in metadata) {
            epubver = '3';
        } else if (k8resc !== null && k8resc.needEPUB3()) {
            epubver = '3';
        }
        return epubver;
    }

    defineRefinesID() {
        const metadata = this.metadata;

        let needRefinesId = false;
        if (this.k8resc !== null) {
            needRefinesId = this.k8resc.hasRefines();
        }

        if ((needRefinesId || EXTH_TITLE_FURIGANA in metadata) && 'Title' in metadata) {
            const arr = metadata['Title'];
            for (let i = 0; i < arr.length; i++) {
                this.title_id[i] = 'title' + String(i+1).padStart(2, '0');
            }
        }

        if ((needRefinesId || EXTH_CREATOR_FURIGANA in metadata) && 'Creator' in metadata) {
            const arr = metadata['Creator'];
            for (let i = 0; i < arr.length; i++) {
                this.creator_id[i] = 'creator' + String(i+1).padStart(2, '0');
            }
        }

        if ((needRefinesId || EXTH_PUBLISHER_FURIGANA in metadata) && 'Publisher' in metadata) {
            const arr = metadata['Publisher'];
            for (let i = 0; i < arr.length; i++) {
                this.publisher_id[i] = 'publisher' + String(i+1).padStart(2, '0');
            }
        }
    }

    processRefinesMetadata() {
        const metadata = this.metadata;

        const refines_list = [
            [EXTH_TITLE_FURIGANA, this.title_id, this.title_attrib, 'title00'],
            [EXTH_CREATOR_FURIGANA, this.creator_id, this.creator_attrib, 'creator00'],
            [EXTH_PUBLISHER_FURIGANA, this.publisher_id, this.publisher_attrib, 'publisher00']
        ];

        let create_refines_metadata = false;
        const firstColumn = lzip(...refines_list)[0];
        for (const EXTH of firstColumn) {
            if (EXTH in metadata) {
                create_refines_metadata = true;
                break;
            }
        }
        if (create_refines_metadata) {
            for (const [EXTH, id, attrib, defaultid] of refines_list) {
                if (this.target_epubver === '3') {
                    for (const [i, value] of Object.entries(id)) {
                        attrib[i] = ' id="' + value + '"';
                    }

                    if (EXTH in metadata) {
                        if (metadata[EXTH].length === 1 && Object.keys(id).length === 1) {
                            this.createMetaTag(this.exth_solved_refines_metadata, 'file-as', metadata[EXTH][0], id[0]);
                        } else {
                            metadata[EXTH].forEach((value, i) => {
                                this.createMetaTag(this.exth_refines_metadata, 'file-as', value, (i in id ? id[i] : defaultid));
                            });
                        }
                    }
                } else {
                    if (EXTH in metadata) {
                        if (metadata[EXTH].length === 1 && Object.keys(id).length === 1) {
                            const attr = ' opf:file-as="' + metadata[EXTH][0] + '"';
                            attrib[0] = attr;
                        } else {
                            metadata[EXTH].forEach((value, i) => {
                                const attr = ' id="#' + (i in id ? id[i] : defaultid) + '" opf:file-as="' + value + '"\n';
                                this.extra_attributes.push(attr);
                            });
                        }
                    }
                }
            }
        }
    }

    createMetadataForFixedlayout() {
        const metadata = this.metadata;

        if ('fixed-layout' in metadata) {
            const fixedlayout = metadata['fixed-layout'][0];
            const content = {'true': 'pre-paginated'}[fixedlayout.toLowerCase()] || 'reflowable';
            this.createMetaTag(this.exth_fixedlayout_metadata, 'rendition:layout', content);
        }

        if ('orientation-lock' in metadata) {
            const content = metadata['orientation-lock'][0].toLowerCase();
            if (content === 'portrait' || content === 'landscape') {
                this.createMetaTag(this.exth_fixedlayout_metadata, 'rendition:orientation', content);
            }
        }

        if ('original-resolution' in metadata) {
            const resolution = metadata['original-resolution'][0].toLowerCase();
            const [width, height] = resolution.split('x');
            if (/^\d+$/.test(width) && parseInt(width, 10) > 0 && /^\d+$/.test(height) && parseInt(height, 10) > 0) {
                const viewport = 'width=' + width + ', height=' + height;
                this.createMetaTag(this.exth_fixedlayout_metadata, 'rendition:viewport', viewport);
            }
        }
    }
}

module.exports = { OPFProcessor };
