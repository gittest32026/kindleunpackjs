/**
 * kindleunpack.js
 * JavaScript equivalent of Python lib/kindleunpack.py
 * Main orchestrator for unpacking Kindle/MobiPocket ebooks
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { utf8Str, unicodeStr, hexlify } = require('./compatibility_utils');
const { pathof } = require('./unipath');
const { UnpackException, fileNames } = require('./unpack_structure');
const { Sectionizer, describe } = require('./mobi_sectioner');
const { MobiHeader, dump_contexth } = require('./mobi_header');
const { toBase32 } = require('./mobi_utils');
const { OPFProcessor } = require('./mobi_opf');
const { HTMLProcessor, XHTMLK8Processor } = require('./mobi_html');
const { ncxExtract } = require('./mobi_ncx');
const { K8Processor } = require('./mobi_k8proc');
const { mobi_split } = require('./mobi_split');
const { K8RESCProcessor } = require('./mobi_k8resc');
const { NAVProcessor } = require('./mobi_nav');
const { CoverProcessor, get_image_type } = require('./mobi_cover');
const { PageMapProcessor } = require('./mobi_pagemap');
const { dictSupport } = require('./mobi_dict');

let DUMP = false;
let WRITE_RAW_DATA = false;
let SPLIT_COMBO_MOBIS = false;
const CREATE_COVER_PAGE = true;
const EOF_RECORD = Buffer.from('\xe9\x8e\r\n', 'latin1');
const TERMINATION_INDICATOR1 = Buffer.from('\x00', 'latin1');
const TERMINATION_INDICATOR2 = Buffer.from('\x00\x00', 'latin1');
const TERMINATION_INDICATOR3 = Buffer.from('\x00\x00\x00', 'latin1');
const KINDLEGENSRC_FILENAME = 'kindlegensrc.zip';
const KINDLEGENLOG_FILENAME = 'kindlegenbuild.log';
const K8_BOUNDARY = Buffer.from('BOUNDARY', 'latin1');

function processSRCS(i, files, rscnames, sect, data) {
    console.log(`File contains kindlegen source archive, extracting as ${KINDLEGENSRC_FILENAME}`);
    const srcname = path.join(files.outdir, KINDLEGENSRC_FILENAME);
    fs.writeFileSync(pathof(srcname), data.slice(16));
    rscnames.push(null);
    sect.setSectionDescription(i, 'Zipped Source Files');
    return rscnames;
}

function processPAGE(i, files, rscnames, sect, data, mh, pagemapproc) {
    pagemapproc = new PageMapProcessor(mh, data);
    rscnames.push(null);
    sect.setSectionDescription(i, 'PageMap');
    const apnx_meta = {};
    const acr = sect.palmName.toString('latin1').replace(/\x00+$/, '');
    apnx_meta['acr'] = acr;
    apnx_meta['cdeType'] = mh.metadata['cdeType'][0];
    apnx_meta['contentGuid'] = parseInt(mh.metadata['UniqueID'][0], 10).toString(16);
    apnx_meta['asin'] = mh.metadata['ASIN'][0];
    apnx_meta['pageMap'] = pagemapproc.getPageMap();
    if (mh.version === 8) {
        apnx_meta['format'] = 'MOBI_8';
    } else {
        apnx_meta['format'] = 'MOBI_7';
    }
    const apnx_data = pagemapproc.generateAPNX(apnx_meta);
    let outname;
    if (mh.isK8()) {
        outname = path.join(files.outdir, 'mobi8-' + files.getInputFileBasename() + '.apnx');
    } else {
        outname = path.join(files.outdir, 'mobi7-' + files.getInputFileBasename() + '.apnx');
    }
    fs.writeFileSync(pathof(outname), apnx_data);
    return [rscnames, pagemapproc];
}

function processCMET(i, files, rscnames, sect, data) {
    console.log(`File contains kindlegen build log, extracting as ${KINDLEGENLOG_FILENAME}`);
    const srcname = path.join(files.outdir, KINDLEGENLOG_FILENAME);
    fs.writeFileSync(pathof(srcname), data.slice(10));
    rscnames.push(null);
    sect.setSectionDescription(i, 'Kindlegen log');
    return rscnames;
}

function processFONT(i, files, rscnames, sect, data, obfuscate_data, beg, rsc_ptr) {
    let fontname = `font${String(i).padStart(5, '0')}`;
    let ext = '.dat';
    let font_error = false;
    let font_data = data;
    let usize, fflags, dstart, xor_len, xor_start;
    try {
        if (data.length < 24) throw new Error('too short');
        usize = data.readUInt32BE(4);
        fflags = data.readUInt32BE(8);
        dstart = data.readUInt32BE(12);
        xor_len = data.readUInt32BE(16);
        xor_start = data.readUInt32BE(20);
    } catch (e) {
        console.log(`Failed to extract font: ${fontname} from section ${i}`);
        font_error = true;
        ext = '.failed';
    }
    if (!font_error) {
        console.log('Extracting font:', fontname);
        font_data = data.slice(dstart);
        let extent = font_data.length;
        extent = Math.min(extent, 1040);
        if (fflags & 0x0002) {
            const key = data.slice(xor_start, xor_start + xor_len);
            const buf = Buffer.from(font_data);
            for (let n = 0; n < extent; n++) {
                buf[n] ^= key[n % xor_len];
            }
            font_data = buf;
        }
        if (fflags & 0x0001) {
            font_data = zlib.inflateSync(font_data);
        }
        const hdr = font_data.slice(0, 4);
        const hdrHex = hexlify(hdr);
        if (hdr.equals(Buffer.from('\0\1\0\0', 'binary')) || hdr.equals(Buffer.from('true', 'latin1')) || hdr.equals(Buffer.from('ttcf', 'latin1'))) {
            ext = '.ttf';
        } else if (hdr.equals(Buffer.from('OTTO', 'latin1'))) {
            ext = '.otf';
        } else {
            console.log(`Warning: unknown font header ${hdrHex}`);
        }
        if ((ext === '.ttf' || ext === '.otf') && (fflags & 0x0002)) {
            obfuscate_data.push(fontname + ext);
        }
        fontname += ext;
        const outfnt = path.join(files.imgdir, fontname);
        fs.writeFileSync(pathof(outfnt), font_data);
        rscnames.push(fontname);
        sect.setSectionDescription(i, `Font ${fontname}`);
        if (rsc_ptr === -1) {
            rsc_ptr = i - beg;
        }
    }
    return [rscnames, obfuscate_data, rsc_ptr];
}

function processCRES(i, files, rscnames, sect, data, beg, rsc_ptr, use_hd) {
    data = data.slice(12);
    const imgtype = get_image_type(null, data);

    if (imgtype === null) {
        console.log(`Warning: CRES Section ${i} does not contain a recognised resource`);
        rscnames.push(null);
        sect.setSectionDescription(i, `Mysterious CRES data, first four bytes ${describe(data.slice(0, 4))}`);
        if (DUMP) {
            const fname = `unknown${String(i).padStart(5, '0')}.dat`;
            const outname = path.join(files.outdir, fname);
            fs.writeFileSync(pathof(outname), data);
            sect.setSectionDescription(i, `Mysterious CRES data, first four bytes ${describe(data.slice(0, 4))} extracting as ${fname}`);
        }
        rsc_ptr += 1;
        return [rscnames, rsc_ptr];
    }

    let imgname, imgdest;
    if (use_hd) {
        imgname = rscnames[rsc_ptr];
        imgdest = files.imgdir;
    } else {
        imgname = `HDimage${String(i).padStart(5, '0')}.${imgtype}`;
        imgdest = files.hdimgdir;
    }
    console.log(`Extracting HD image: ${imgname} from section ${i}`);
    const outimg = path.join(imgdest, imgname);
    fs.writeFileSync(pathof(outimg), data);
    rscnames.push(null);
    sect.setSectionDescription(i, `Optional HD Image ${imgname}`);
    rsc_ptr += 1;
    return [rscnames, rsc_ptr];
}

function processCONT(i, files, rscnames, sect, data) {
    const dt = data.slice(0, 12);
    if (dt.equals(Buffer.from('CONTBOUNDARY', 'latin1'))) {
        rscnames.push(null);
        sect.setSectionDescription(i, 'CONTAINER BOUNDARY');
    } else {
        sect.setSectionDescription(i, 'CONT Header');
        rscnames.push(null);
        if (DUMP) {
            const cpage = data.readUInt32BE(12);
            const contexth = data.slice(48);
            console.log('\n\nContainer EXTH Dump');
            dump_contexth(cpage, contexth);
            const fname = `CONT_Header${String(i).padStart(5, '0')}.dat`;
            const outname = path.join(files.outdir, fname);
            fs.writeFileSync(pathof(outname), data);
        }
    }
    return rscnames;
}

function processkind(i, files, rscnames, sect, data) {
    const dt = data.slice(0, 12);
    if (dt.equals(Buffer.from('kindle:embed', 'latin1'))) {
        if (DUMP) {
            console.log('\n\nHD Image Container Description String');
            console.log(data);
        }
        sect.setSectionDescription(i, 'HD Image Container Description String');
        rscnames.push(null);
    }
    return rscnames;
}

function processRESC(i, files, rscnames, sect, data, k8resc) {
    if (DUMP) {
        const rescname = `RESC${String(i).padStart(5, '0')}.dat`;
        console.log('Extracting Resource: ', rescname);
        const outrsc = path.join(files.outdir, rescname);
        fs.writeFileSync(pathof(outrsc), data);
    }
    k8resc = new K8RESCProcessor(data.slice(16), DUMP);
    rscnames.push(null);
    sect.setSectionDescription(i, 'K8 RESC section');
    return [rscnames, k8resc];
}

function processImage(i, files, rscnames, sect, data, beg, rsc_ptr, cover_offset, thumb_offset) {
    const imgtype = get_image_type(null, data);
    if (imgtype === null) {
        console.log(`Warning: Section ${i} does not contain a recognised resource`);
        rscnames.push(null);
        sect.setSectionDescription(i, `Mysterious Section, first four bytes ${describe(data.slice(0, 4))}`);
        if (DUMP) {
            const fname = `unknown${String(i).padStart(5, '0')}.dat`;
            const outname = path.join(files.outdir, fname);
            fs.writeFileSync(pathof(outname), data);
            sect.setSectionDescription(i, `Mysterious Section, first four bytes ${describe(data.slice(0, 4))} extracting as ${fname}`);
        }
        return [rscnames, rsc_ptr];
    }

    let imgname = `image${String(i).padStart(5, '0')}.${imgtype}`;
    if (cover_offset !== null && cover_offset !== undefined && i === beg + cover_offset) {
        imgname = `cover${String(i).padStart(5, '0')}.${imgtype}`;
    }
    if (thumb_offset !== null && thumb_offset !== undefined && i === beg + thumb_offset) {
        imgname = `thumb${String(i).padStart(5, '0')}.${imgtype}`;
    }
    console.log(`Extracting image: ${imgname} from section ${i}`);
    const outimg = path.join(files.imgdir, imgname);
    fs.writeFileSync(pathof(outimg), data);
    rscnames.push(imgname);
    sect.setSectionDescription(i, `Image ${imgname}`);
    if (rsc_ptr === -1) {
        rsc_ptr = i - beg;
    }
    return [rscnames, rsc_ptr];
}

function processPrintReplica(metadata, files, rscnames, mh) {
    const rawML = mh.getRawML();
    if (DUMP || WRITE_RAW_DATA) {
        const outraw = path.join(files.outdir, files.getInputFileBasename() + '.rawpr');
        fs.writeFileSync(pathof(outraw), rawML);
    }

    const fileinfo = [];
    console.log('Print Replica ebook detected');
    try {
        const numTables = rawML.readUInt32BE(0x04);
        let tableIndexOffset = 8 + 4 * numTables;
        for (let i = 0; i < numTables; i++) {
            const sectionCount = rawML.readUInt32BE(0x08 + 4 * i);
            for (let j = 0; j < sectionCount; j++) {
                const sectionOffset = rawML.readUInt32BE(tableIndexOffset);
                const sectionLength = rawML.readUInt32BE(tableIndexOffset + 4);
                tableIndexOffset += 8;
                let entryName;
                if (j === 0) {
                    entryName = path.join(files.outdir, files.getInputFileBasename() + `.${String(i + 1).padStart(3, '0')}.pdf`);
                } else {
                    entryName = path.join(files.outdir, files.getInputFileBasename() + `.${String(i + 1).padStart(3, '0')}.${String(j).padStart(3, '0')}.data`);
                }
                fs.writeFileSync(pathof(entryName), rawML.slice(sectionOffset, sectionOffset + sectionLength));
            }
        }
    } catch (e) {
        console.log('Error processing Print Replica: ' + e.message);
    }

    fileinfo.push([null, '', files.getInputFileBasename() + '.pdf']);
    const usedmap = {};
    for (const name of rscnames) {
        if (name !== null) {
            usedmap[name] = 'used';
        }
    }
    const opf = new OPFProcessor(files, metadata, fileinfo, rscnames, false, mh, usedmap);
    opf.writeOPF();
}

function processMobi8(mh, metadata, sect, files, rscnames, pagemapproc, k8resc, obfuscate_data, apnxfile = null, epubver = '2') {
    const rawML = mh.getRawML();
    if (DUMP || WRITE_RAW_DATA) {
        const outraw = path.join(files.k8dir, files.getInputFileBasename() + '.rawml');
        fs.writeFileSync(pathof(outraw), rawML);
    }

    const k8proc = new K8Processor(mh, sect, files, DUMP);
    k8proc.buildParts(rawML);

    let guidetext = unicodeStr(k8proc.getGuideText());

    if (!guidetext && 'StartOffset' in metadata) {
        const starts = metadata['StartOffset'];
        let last_start = parseInt(starts[starts.length - 1], 10);
        if (last_start === 0xffffffff) {
            last_start = 0;
        }
        const [seq, idtext] = k8proc.getFragTblInfo(last_start);
        const [filename, idtag] = k8proc.getIDTagByPosFid(toBase32(seq), Buffer.from('0000000000', 'latin1'));
        let linktgt = filename;
        const idtextStr = unicodeStr(idtag, mh.codec);
        if (idtextStr !== '') {
            linktgt += '#' + idtextStr;
        }
        guidetext += `<reference type="text" href="Text/${linktgt}" />\n`;
    }

    if (apnxfile !== null && pagemapproc === null) {
        const apnxdata = Buffer.concat([Buffer.from('00000000', 'latin1'), fs.readFileSync(pathof(apnxfile))]);
        pagemapproc = new PageMapProcessor(mh, apnxdata);
    }

    let pagemapxml = '';
    if (pagemapproc !== null) {
        pagemapxml = pagemapproc.generateKF8PageMapXML(k8proc);
        const outpm = path.join(files.k8oebps, 'page-map.xml');
        fs.writeFileSync(pathof(outpm), Buffer.from(pagemapxml, 'utf-8'));
        if (DUMP) {
            console.log(pagemapproc.getNames());
            console.log(pagemapproc.getOffsets());
            console.log('\n\nPage Map');
            console.log(pagemapxml);
        }
    }

    console.log('Processing ncx / toc');
    const ncx = new ncxExtract(mh, files);
    const ncx_data = ncx.parseNCX();
    for (let i = 0; i < ncx_data.length; i++) {
        let ncxmap = ncx_data[i];
        const [junk1, junk2, junk3, fid, junk4, off] = ncxmap['pos_fid'].split(':');
        const [filename, idtag] = k8proc.getIDTagByPosFid(fid, off);
        ncxmap['filename'] = filename;
        ncxmap['idtag'] = unicodeStr(idtag);
        ncx_data[i] = ncxmap;
    }

    let viewport = null;
    if ('original-resolution' in metadata) {
        if ('true' === (metadata['fixed-layout'] || [''])[0].toLowerCase()) {
            const resolution = metadata['original-resolution'][0].toLowerCase();
            const [width, height] = resolution.split('x');
            if (/^\d+$/.test(width) && parseInt(width, 10) > 0 && /^\d+$/.test(height) && parseInt(height, 10) > 0) {
                viewport = `width=${width}, height=${height}`;
            }
        }
    }

    console.log('Building an epub-like structure');
    const htmlproc = new XHTMLK8Processor(rscnames, k8proc, viewport);
    const usedmap = htmlproc.buildXHTML();

    const fileinfo = [];
    if (CREATE_COVER_PAGE) {
        const cover = new CoverProcessor(files, metadata, rscnames);
        const cover_img = utf8Str(cover.getImageName());
        let need_to_create_cover_page = false;
        if (cover_img !== null) {
            if (k8resc === null || !k8resc.hasSpine()) {
                const part = k8proc.getPart(0);
                if (part.indexOf(cover_img) === -1) {
                    need_to_create_cover_page = true;
                }
            } else {
                if (!('coverpage' in k8resc.spine_idrefs)) {
                    const part = k8proc.getPart(parseInt(k8resc.spine_order[0], 10));
                    if (part.indexOf(cover_img) === -1) {
                        k8resc.prepend_to_spine('coverpage', 'inserted', 'no', null);
                    }
                }
                if (k8resc.spine_order[0] === 'coverpage') {
                    need_to_create_cover_page = true;
                }
            }
            if (need_to_create_cover_page) {
                const filename = cover.getXHTMLName();
                fileinfo.push(['coverpage', 'Text', filename]);
                guidetext += cover.guide_toxml();
                cover.writeXHTML();
            }
        }
    }

    let n = k8proc.getNumberOfParts();
    for (let i = 0; i < n; i++) {
        const part = k8proc.getPart(i);
        const [skelnum, dir, filename, beg, end, aidtext] = k8proc.getPartInfo(i);
        fileinfo.push([String(skelnum), dir, filename]);
        const fname = path.join(files.k8oebps, dir, filename);
        fs.writeFileSync(pathof(fname), part);
    }
    n = k8proc.getNumberOfFlows();
    for (let i = 1; i < n; i++) {
        const [ptype, pformat, pdir, filename] = k8proc.getFlowInfo(i);
        const flowpart = k8proc.getFlow(i);
        if (pformat === 'file') {
            fileinfo.push([null, pdir, filename]);
            const fname = path.join(files.k8oebps, pdir, filename);
            fs.writeFileSync(pathof(fname), flowpart);
        }
    }

    const metadataCopy = { ...metadata };
    const opf = new OPFProcessor(files, metadataCopy, fileinfo, rscnames, true, mh, usedmap,
                                 pagemapxml, guidetext, k8resc, epubver);
    const uuid = opf.writeOPF(obfuscate_data.length > 0);

    if (opf.hasNCX()) {
        ncx.writeK8NCX(ncx_data, metadata);
    }
    if (opf.hasNAV()) {
        const nav = new NAVProcessor(files);
        nav.writeNAV(ncx_data, guidetext, metadata);
    }

    console.log('Creating an epub-like file');
    files.makeEPUB(usedmap, obfuscate_data, uuid);
}

function processMobi7(mh, metadata, sect, files, rscnames) {
    const rawML = mh.getRawML();
    if (DUMP || WRITE_RAW_DATA) {
        const outraw = path.join(files.mobi7dir, files.getInputFileBasename() + '.rawml');
        fs.writeFileSync(pathof(outraw), rawML);
    }

    const ncx = new ncxExtract(mh, files);
    const ncx_data = ncx.parseNCX();
    ncx.writeNCX(metadata);

    let positionMap = {};

    if (mh.isDictionary()) {
        if (mh.DictInLanguage()) {
            metadata['DictInLanguage'] = [mh.DictInLanguage()];
        }
        if (mh.DictOutLanguage()) {
            metadata['DictOutLanguage'] = [mh.DictOutLanguage()];
        }
        positionMap = new dictSupport(mh, sect).getPositionMap();
    }

    const proc = new HTMLProcessor(files, metadata, rscnames);
    proc.findAnchors(rawML, ncx_data, positionMap);
    const [finalSrctext, usedmap] = proc.insertHREFS();

    const fileinfo = [];
    const fname = 'book.html';
    fileinfo.push([null, '', fname]);
    const outhtml = path.join(files.mobi7dir, fname);
    fs.writeFileSync(pathof(outhtml), finalSrctext);

    let guidetext = Buffer.alloc(0);
    const guidematch = finalSrctext.toString('latin1').match(/<guide>(.*)<\/guide>/is);
    if (guidematch) {
        guidetext = Buffer.from(guidematch[1], 'latin1');
        guidetext = Buffer.from(guidetext.toString('latin1').replace(/\r/g, ''), 'latin1');
        let gt = guidetext.toString('latin1');
        gt = gt.replace(/<REFERENCE/g, '<reference');
        gt = gt.replace(/ HREF=/g, ' href=');
        gt = gt.replace(/ TITLE=/g, ' title=');
        gt = gt.replace(/ TYPE=/g, ' type=');
        guidetext = Buffer.from(gt, 'latin1');
        const refTagPattern = /(<reference [^>]*>)/gi;
        const guidepieces = [];
        let lastIndex = 0;
        const str = guidetext.toString('latin1');
        let m;
        while ((m = refTagPattern.exec(str)) !== null) {
            guidepieces.push(Buffer.from(str.slice(lastIndex, m.index), 'latin1'));
            guidepieces.push(Buffer.from(m[1], 'latin1'));
            lastIndex = m.index + m[0].length;
        }
        guidepieces.push(Buffer.from(str.slice(lastIndex), 'latin1'));
        for (let i = 1; i < guidepieces.length; i += 2) {
            let reftag = guidepieces[i].toString('latin1');
            reftag = reftag.replace(/href\s*=[^'"]*['"][^'"]*['"]/g, '');
            if (!reftag.endsWith('/>')) {
                reftag = reftag.slice(0, -1) + '/>';
            }
            guidepieces[i] = Buffer.from(reftag, 'latin1');
        }
        guidetext = Buffer.concat(guidepieces);
        let gtStr = guidetext.toString('latin1');
        gtStr = gtStr.replace(/filepos=['"]?0*(\d+)['"]?/g, `href="${fileinfo[0][2]}#filepos$1"`);
        guidetext = Buffer.from(gtStr + '\n', 'latin1');
    }

    if ('StartOffset' in metadata) {
        let starting_offset;
        for (const value of metadata['StartOffset']) {
            let v = value;
            if (parseInt(v, 10) === 0xffffffff) {
                v = '0';
            }
            starting_offset = v;
        }
        const metaguidetext = Buffer.from(`<reference type="text" href="${fileinfo[0][2]}#filepos${starting_offset}" />\n`, 'latin1');
        guidetext = Buffer.concat([guidetext, metaguidetext]);
    }

    if (Buffer.isBuffer(guidetext)) {
        guidetext = guidetext.toString(mh.codec === 'windows-1252' ? 'latin1' : mh.codec);
    }

    const opf = new OPFProcessor(files, metadata, fileinfo, rscnames, ncx.isNCX, mh, usedmap, '', guidetext, null, '2');
    opf.writeOPF();
}

function processUnknownSections(mh, sect, files, K8Boundary) {
    if (DUMP) {
        console.log('Unpacking any remaining unknown records');
    }
    const beg = mh.start;
    let end = sect.numSections;
    if (beg < K8Boundary) {
        end = K8Boundary;
    }
    for (let i = beg; i < end; i++) {
        if (sect.sectionDescriptions[i] === '') {
            const data = sect.loadSection(i);
            const type = data.slice(0, 4);
            let description;
            if (type.equals(TERMINATION_INDICATOR3)) {
                description = 'Termination Marker 3 Nulls';
            } else if (type.equals(TERMINATION_INDICATOR2)) {
                description = 'Termination Marker 2 Nulls';
            } else if (type.equals(TERMINATION_INDICATOR1)) {
                description = 'Termination Marker 1 Null';
            } else if (type.equals(Buffer.from('INDX', 'latin1'))) {
                const fname = `Unknown${String(i).padStart(5, '0')}_INDX.dat`;
                description = 'Unknown INDX section';
                if (DUMP) {
                    const outname = path.join(files.outdir, fname);
                    fs.writeFileSync(pathof(outname), data);
                    console.log(`Extracting ${description}: ${fname} from section ${i}`);
                    description += `, extracting as ${fname}`;
                }
            } else {
                const fname = `unknown${String(i).padStart(5, '0')}.dat`;
                description = `Mysterious Section, first four bytes ${describe(data.slice(0, 4))}`;
                if (DUMP) {
                    const outname = path.join(files.outdir, fname);
                    fs.writeFileSync(pathof(outname), data);
                    console.log(`Extracting ${description}: ${fname} from section ${i}`);
                    description += `, extracting as ${fname}`;
                }
            }
            sect.setSectionDescription(i, description);
        }
    }
}

function process_all_mobi_headers(files, apnxfile, sect, mhlst, K8Boundary, k8only = false, epubver = '2', use_hd = false) {
    let rscnames = [];
    let rsc_ptr = -1;
    let k8resc = null;
    let obfuscate_data = [];
    for (const mh of mhlst) {
        let pagemapproc = null;
        let mhname;
        if (mh.isK8()) {
            sect.setSectionDescription(mh.start, 'KF8 Header');
            mhname = path.join(files.outdir, 'header_K8.dat');
            console.log('Processing K8 section of book...');
        } else if (mh.isPrintReplica()) {
            sect.setSectionDescription(mh.start, 'Print Replica Header');
            mhname = path.join(files.outdir, 'header_PR.dat');
            console.log('Processing PrintReplica section of book...');
        } else {
            if (mh.version === 0) {
                sect.setSectionDescription(mh.start, 'PalmDoc Header');
            } else {
                sect.setSectionDescription(mh.start, `Mobipocket ${mh.version} Header`);
            }
            mhname = path.join(files.outdir, 'header.dat');
            console.log(`Processing Mobipocket ${mh.version} section of book...`);
        }

        if (DUMP) {
            fs.writeFileSync(pathof(mhname), mh.header);
        }

        const metadata = mh.getMetaData();
        mh.describeHeader(DUMP);
        if (mh.isEncrypted()) {
            throw new UnpackException('Book is encrypted');
        }

        pagemapproc = null;

        console.log('Unpacking images, resources, fonts, etc');
        const beg = mh.firstresource;
        let end = sect.numSections;
        if (beg < K8Boundary) {
            end = K8Boundary;
        }

        let thumb_offset;
        try {
            thumb_offset = parseInt((metadata['ThumbOffset'] || ['-1'])[0], 10);
        } catch (e) {
            thumb_offset = null;
        }

        let cover_offset = parseInt((metadata['CoverOffset'] || ['-1'])[0], 10);
        if (!CREATE_COVER_PAGE) {
            cover_offset = null;
        }

        for (let i = beg; i < end; i++) {
            const data = sect.loadSection(i);
            const typeStr = data.slice(0, 4).toString('latin1');

            if (typeStr === 'FLIS' || typeStr === 'FCIS' || typeStr === 'FDST' || typeStr === 'DATP') {
                if (DUMP) {
                    let fname = typeStr + String(i).padStart(5, '0');
                    if (mh.isK8()) {
                        fname += '_K8';
                    }
                    fname += '.dat';
                    const outname = path.join(files.outdir, fname);
                    fs.writeFileSync(pathof(outname), data);
                    console.log(`Dumping section ${i} type ${typeStr} to file ${outname} `);
                }
                sect.setSectionDescription(i, `Type ${typeStr}`);
                rscnames.push(null);
            } else if (typeStr === 'SRCS') {
                rscnames = processSRCS(i, files, rscnames, sect, data);
            } else if (typeStr === 'PAGE') {
                [rscnames, pagemapproc] = processPAGE(i, files, rscnames, sect, data, mh, pagemapproc);
            } else if (typeStr === 'CMET') {
                rscnames = processCMET(i, files, rscnames, sect, data);
            } else if (typeStr === 'FONT') {
                [rscnames, obfuscate_data, rsc_ptr] = processFONT(i, files, rscnames, sect, data, obfuscate_data, beg, rsc_ptr);
            } else if (typeStr === 'CRES') {
                [rscnames, rsc_ptr] = processCRES(i, files, rscnames, sect, data, beg, rsc_ptr, use_hd);
            } else if (typeStr === 'CONT') {
                rscnames = processCONT(i, files, rscnames, sect, data);
            } else if (typeStr === 'kind') {
                rscnames = processkind(i, files, rscnames, sect, data);
            } else if (typeStr === '\xa0\xa0\xa0\xa0') {
                sect.setSectionDescription(i, 'Empty_HD_Image/Resource_Placeholder');
                rscnames.push(null);
                rsc_ptr += 1;
            } else if (typeStr === 'RESC') {
                [rscnames, k8resc] = processRESC(i, files, rscnames, sect, data, k8resc);
            } else if (data.equals(EOF_RECORD)) {
                sect.setSectionDescription(i, 'End Of File');
                rscnames.push(null);
            } else if (data.slice(0, 8).equals(K8_BOUNDARY)) {
                sect.setSectionDescription(i, 'BOUNDARY Marker');
                rscnames.push(null);
            } else {
                [rscnames, rsc_ptr] = processImage(i, files, rscnames, sect, data, beg, rsc_ptr, cover_offset, thumb_offset);
            }
        }

        if (mh.isPrintReplica() && !k8only) {
            processPrintReplica(metadata, files, rscnames, mh);
            continue;
        }

        if (mh.isK8()) {
            processMobi8(mh, metadata, sect, files, rscnames, pagemapproc, k8resc, obfuscate_data, apnxfile, epubver);
        } else if (!k8only) {
            processMobi7(mh, metadata, sect, files, rscnames);
        }

        processUnknownSections(mh, sect, files, K8Boundary);
    }
}

function unpackBook(infile, outdir, apnxfile = null, epubver = '2', use_hd = false, dodump = false, dowriteraw = false, dosplitcombos = false) {
    if (DUMP || dodump) {
        DUMP = true;
    }
    if (WRITE_RAW_DATA || dowriteraw) {
        WRITE_RAW_DATA = true;
    }
    if (SPLIT_COMBO_MOBIS || dosplitcombos) {
        SPLIT_COMBO_MOBIS = true;
    }

    infile = unicodeStr(infile);
    outdir = unicodeStr(outdir);
    if (apnxfile !== null) {
        apnxfile = unicodeStr(apnxfile);
    }

    const files = new fileNames(infile, outdir);

    const sect = new Sectionizer(infile);
    const identStr = sect.ident.toString('latin1');
    if (identStr !== 'BOOKMOBI' && identStr !== 'TEXtREAd') {
        throw new UnpackException('Invalid file format');
    }
    if (DUMP) {
        sect.dumpPalmHeader();
    } else {
        console.log(`Palm DB type: ${identStr}, ${sect.numSections} sections.`);
    }

    const mhlst = [];
    let mh = new MobiHeader(sect, 0);
    mhlst.push(mh);
    let K8Boundary = -1;

    let hasK8;
    if (mh.isK8()) {
        console.log('Unpacking a KF8 book...');
        hasK8 = true;
    } else {
        hasK8 = false;
        for (let i = 0; i < sect.sectionOffsets.length - 1; i++) {
            const before = sect.sectionOffsets[i];
            const after = sect.sectionOffsets[i + 1];
            if ((after - before) === 8) {
                const data = sect.loadSection(i);
                if (data.equals(K8_BOUNDARY)) {
                    sect.setSectionDescription(i, 'Mobi/KF8 Boundary Section');
                    mh = new MobiHeader(sect, i + 1);
                    hasK8 = true;
                    mhlst.push(mh);
                    K8Boundary = i;
                    break;
                }
            }
        }
        if (hasK8) {
            console.log(`Unpacking a Combination M${mh.version}/KF8 book...`);
            if (SPLIT_COMBO_MOBIS) {
                const mobisplit = new mobi_split(infile);
                if (mobisplit.combo) {
                    const outmobi7 = path.join(files.outdir, 'mobi7-' + files.getInputFileBasename() + '.mobi');
                    const outmobi8 = path.join(files.outdir, 'mobi8-' + files.getInputFileBasename() + '.azw3');
                    fs.writeFileSync(pathof(outmobi7), mobisplit.getResult7());
                    fs.writeFileSync(pathof(outmobi8), mobisplit.getResult8());
                }
            }
        } else {
            console.log(`Unpacking a Mobipocket ${mh.version} book...`);
        }
    }

    if (hasK8) {
        files.makeK8Struct();
    }

    process_all_mobi_headers(files, apnxfile, sect, mhlst, K8Boundary, false, epubver, use_hd);

    if (DUMP) {
        sect.dumpSectionsInfo();
    }
}

function usage(progname) {
    console.log('');
    console.log('Description:');
    console.log('  Unpacks an unencrypted Kindle/MobiPocket ebook to html and images');
    console.log('  or an unencrypted Kindle/Print Replica ebook to PDF and images');
    console.log('  into the specified output folder.');
    console.log('Usage:');
    console.log(`  ${progname} -r -s -p apnxfile -d -h --epub_version= infile [outdir]`);
    console.log('Options:');
    console.log('    -h                 print this help message');
    console.log('    -i                 use HD Images, if present, to overwrite reduced resolution images');
    console.log('    -s                 split combination mobis into mobi7 and mobi8 ebooks');
    console.log('    -p APNXFILE        path to an .apnx file associated with the azw3 input (optional)');
    console.log('    --epub_version=    specify epub version to unpack to: 2, 3, A (for automatic) or ');
    console.log('                         F (force to fit to epub2 definitions), default is 2');
    console.log('    -d                 dump headers and other info to output and extra files');
    console.log('    -r                 write raw data to the output folder');
}

function main(argv = process.argv) {
    console.log('KindleUnpack v0.83');
    console.log('   Based on initial mobipocket version Copyright © 2009 Charles M. Hannum <root@ihack.net>');
    console.log('   Extensive Extensions and Improvements Copyright © 2009-2020 ');
    console.log('       by:  P. Durrant, K. Hendricks, S. Siebert, fandrieu, DiapDealer, nickredding, tkeo.');
    console.log('   This program is free software: you can redistribute it and/or modify');
    console.log('   it under the terms of the GNU General Public License as published by');
    console.log('   the Free Software Foundation, version 3.');

    const progname = path.basename(argv[0]);
    const args = [];
    const opts = [];
    let i = 1;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const eq = arg.indexOf('=');
            if (eq !== -1) {
                opts.push([arg.slice(0, eq), arg.slice(eq + 1)]);
            } else {
                opts.push([arg, null]);
            }
        } else if (arg.startsWith('-') && arg.length > 1) {
            const flag = arg.slice(0, 2);
            if (arg.length > 2) {
                opts.push([flag, arg.slice(2)]);
            } else if (flag === '-p' && i + 1 < argv.length) {
                opts.push([flag, argv[i + 1]]);
                i += 1;
            } else {
                opts.push([flag, null]);
            }
        } else {
            args.push(arg);
        }
        i += 1;
    }

    if (args.length < 1) {
        usage(progname);
        process.exit(2);
    }

    let apnxfile = null;
    let epubver = '2';
    let use_hd = false;

    for (const [o, a] of opts) {
        if (o === '-h') {
            usage(progname);
            process.exit(0);
        }
        if (o === '-i') {
            use_hd = true;
        }
        if (o === '-d') {
            DUMP = true;
        }
        if (o === '-r') {
            WRITE_RAW_DATA = true;
        }
        if (o === '-s') {
            SPLIT_COMBO_MOBIS = true;
        }
        if (o === '-p') {
            apnxfile = a;
        }
        if (o === '--epub_version') {
            epubver = a || '2';
        }
    }

    let infile, outdir;
    if (args.length > 1) {
        infile = args[0];
        outdir = args[1];
    } else {
        infile = args[0];
        outdir = path.parse(infile).name;
    }

    const infileext = path.extname(infile).toUpperCase();
    if (!['.MOBI', '.PRC', '.AZW', '.AZW3', '.AZW4'].includes(infileext)) {
        console.log('Error: first parameter must be a Kindle/Mobipocket ebook or a Kindle/Print Replica ebook.');
        return 1;
    }

    try {
        console.log('Unpacking Book...');
        unpackBook(infile, outdir, apnxfile, epubver, use_hd);
        console.log('Completed');
    } catch (e) {
        if (e instanceof Error) {
            console.log('Error: ' + e.message);
            console.log(e.stack);
        } else {
            console.log('Error: ' + e);
        }
        return 1;
    }

    return 0;
}

module.exports = {
    unpackBook,
    main,
    UnpackException
};
