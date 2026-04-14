/**
 * mobi_html.js
 * JavaScript equivalent of Python mobi_html.py
 * HTML/XHTML processing for MOBI files
 */

const { utf8Str } = require('./compatibility_utils');
const { fromBase32 } = require('./mobi_utils');

class HTMLProcessor {
    constructor(files, metadata, rscnames) {
        this.files = files;
        this.metadata = metadata;
        this.rscnames = rscnames;
        this.used = {};
        for (const name of rscnames) {
            this.used[name] = 'used';
        }
    }

    findAnchors(rawtext, indx_data, positionMap) {
        console.log("Find link anchors");
        const rawtextStr = rawtext.toString('latin1');
        const linkPattern = /<[^<>]+filepos=['"]*(\d+)[^<>]*>/gi;
        let posLinks = [];
        for (const m of rawtextStr.matchAll(linkPattern)) {
            posLinks.push(parseInt(m[1], 10));
        }
        if (indx_data) {
            const posIndx = indx_data.filter(e => e.pos > 0).map(e => e.pos);
            posLinks = Array.from(new Set(posLinks.concat(posIndx)));
        }

        for (const position of posLinks) {
            const anchor = utf8Str('<a id="filepos' + position + '" />');
            if (position in positionMap) {
                positionMap[position] = Buffer.concat([positionMap[position], anchor]);
            } else {
                positionMap[position] = anchor;
            }
        }

        console.log("Insert data into html");
        let pos = 0;
        const lastPos = rawtext.length;
        const dataList = [];
        for (const end of Object.keys(positionMap).map(Number).sort((a, b) => a - b)) {
            if (end === 0 || end > lastPos) {
                continue;
            }
            dataList.push(rawtext.slice(pos, end));
            dataList.push(positionMap[end]);
            pos = end;
        }
        dataList.push(rawtext.slice(pos));
        const srctext = Buffer.concat(dataList);
        this.srctext = srctext;
        this.indx_data = indx_data;
        return srctext;
    }

    insertHREFS() {
        let srctext = this.srctext;
        const rscnames = this.rscnames;
        const metadata = this.metadata;

        console.log("Insert hrefs into html");
        let srctextStr = srctext.toString('latin1');
        const linkPattern = /<a([^>]*?)filepos=['"]*0*(\d+)['"]*([^>]*?)>/gi;
        srctextStr = srctextStr.replace(linkPattern, '<a$1href="#filepos$2"$3>');
        srctext = Buffer.from(srctextStr, 'latin1');

        console.log("Remove empty anchors from html");
        srctextStr = srctext.toString('latin1');
        srctextStr = srctextStr.replace(/<a\s*\/>/gi, '');
        srctextStr = srctextStr.replace(/<a\s*>\s*<\/a>/gi, '');
        srctext = Buffer.from(srctextStr, 'latin1');

        console.log("Insert image references into html");
        const imagePattern = /(<img.*?>)/gi;
        const imageIndexPattern = /recindex=['"]*([0-9]+)['"]*/gi;
        srctextStr = srctext.toString('latin1');
        const srcpieces = srctextStr.split(imagePattern);

        for (let i = 1; i < srcpieces.length; i += 2) {
            let tag = srcpieces[i];
            tag = tag.replace(imageIndexPattern, (match, g1) => {
                const imageNumber = parseInt(g1, 10);
                const imageName = rscnames[imageNumber - 1];
                if (imageName === null || imageName === undefined) {
                    console.log("Error: Referenced image " + imageNumber + " was not recognized as a valid image");
                    return match;
                }
                return 'src="Images/' + imageName + '"';
            });
            srcpieces[i] = tag;
        }
        srctext = Buffer.from(srcpieces.join(''), 'latin1');

        if ('Codec' in metadata) {
            const codec = metadata['Codec'][0];
            const metaTag = '<meta http-equiv="content-type" content="text/html; charset=' + codec + '" />';
            srctext = Buffer.concat([srctext.slice(0, 12), utf8Str(metaTag), srctext.slice(12)]);
        }
        return [srctext, this.used];
    }
}

class XHTMLK8Processor {
    constructor(rscnames, k8proc, viewport = null) {
        this.rscnames = rscnames;
        this.k8proc = k8proc;
        this.viewport = viewport;
        this.used = {};
    }

    buildXHTML() {
        const posfidPattern = /(<a.*?href=.*?>)/gi;
        const posfidIndexPattern = /['"]kindle:pos:fid:([0-9|A-V]+):off:([0-9|A-V]+).*?["']/gi;

        const parts = [];
        console.log("Building proper xhtml for each file");
        for (let i = 0; i < this.k8proc.getNumberOfParts(); i++) {
            let part = this.k8proc.getPart(i);
            const [partnum, dir, filename, beg, end, aidtext] = this.k8proc.getPartInfo(i);

            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(posfidPattern);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];
                if (tag.startsWith('<')) {
                    tag = tag.replace(posfidIndexPattern, (match, g1, g2) => {
                        const posfid = g1;
                        const offset = g2;
                        const [filename, idtag] = this.k8proc.getIDTagByPosFid(posfid, offset);
                        if (idtag.toString('latin1') === '') {
                            return '"' + filename + '"';
                        }
                        return '"' + filename + '#' + idtag.toString('latin1') + '"';
                    });
                    srcpieces[j] = tag;
                }
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts.push(part);
        }

        const findTagWithAidPattern = /(<[^>]*\said\s*=[^>]*>)/gi;
        const withinTagAidPositionPattern = /\said\s*=['"]([^'"]*)['"]/gi;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(findTagWithAidPattern);
            for (let j = 0; j < srcpieces.length; j++) {
                let tag = srcpieces[j];
                if (tag.startsWith('<')) {
                    tag = tag.replace(withinTagAidPositionPattern, (match, g1) => {
                        const aid = g1;
                        if (this.k8proc.linked_aids.has(aid)) {
                            return ' id="aid-' + aid + '"';
                        }
                        return '';
                    });
                    srcpieces[j] = tag;
                }
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts[i] = part;
        }

        const findTagWithAmznPageBreakPattern = /(<[^>]*\sdata-AmznPageBreak=[^>]*>)/gi;
        const withinTagAmznPageBreakPattern = /\sdata-AmznPageBreak=['"]([^'"]*)['"]/gi;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(findTagWithAmznPageBreakPattern);
            for (let j = 0; j < srcpieces.length; j++) {
                let tag = srcpieces[j];
                if (tag.startsWith('<')) {
                    tag = tag.replace(withinTagAmznPageBreakPattern, (match, g1) => {
                        return ' style="page-break-after:' + g1 + '"';
                    });
                    srcpieces[j] = tag;
                }
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts[i] = part;
        }

        const flows = [null];
        const flowinfo = [[null, null, null, null]];

        const imgPattern = /(<[img\s|image\s][^>]*>)/gi;
        const imgIndexPattern = /[('"]kindle:embed:([0-9|A-V]+)[^'"]*['")]/gi;

        const tagPattern = /(<[^>]*>)/g;
        const flowPattern = /['"]kindle:flow:([0-9|A-V]+)\?mime=([^'"]+)['"]/gi;

        const urlPattern = /(url\(.*?\))/gi;
        const urlImgIndexPattern = /[('"]kindle:embed:([0-9|A-V]+)\?mime=image\/[^\)]*["')]/gi;
        const fontIndexPattern = /[('"]kindle:embed:([0-9|A-V]+)["')]/gi;
        const urlCssIndexPattern = /kindle:flow:([0-9|A-V]+)\?mime=text\/css[^\)]*/gi;
        const urlSvgImagePattern = /kindle:flow:([0-9|A-V]+)\?mime=image\/svg\+xml[^\)]*/gi;

        for (let i = 1; i < this.k8proc.getNumberOfFlows(); i++) {
            const [ftype, format, dir, filename] = this.k8proc.getFlowInfo(i);
            let flowpart = this.k8proc.getFlow(i);

            let flowpartStr = flowpart.toString('latin1');
            let srcpieces = flowpartStr.split(imgPattern);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];
                if (tag.startsWith('<im')) {
                    tag = tag.replace(imgIndexPattern, (match, g1) => {
                        const imageNumber = fromBase32(g1);
                        const imageName = this.rscnames[imageNumber - 1];
                        if (imageName !== null && imageName !== undefined) {
                            this.used[imageName] = 'used';
                            return '"../Images/' + imageName + '"';
                        }
                        console.log("Error: Referenced image " + imageNumber + " was not recognized as a valid image in " + tag);
                        return match;
                    });
                    srcpieces[j] = tag;
                }
            }
            flowpart = Buffer.from(srcpieces.join(''), 'latin1');

            flowpartStr = flowpart.toString('latin1');
            srcpieces = flowpartStr.split(urlPattern);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];

                tag = tag.replace(urlImgIndexPattern, (match, g1) => {
                    const imageNumber = fromBase32(g1);
                    const imageName = this.rscnames[imageNumber - 1];
                    const osep = match.slice(0, 1);
                    const csep = match.slice(-1);
                    if (imageName !== null && imageName !== undefined) {
                        const replacement = osep + '../Images/' + imageName + csep;
                        this.used[imageName] = 'used';
                        return replacement;
                    }
                    console.log("Error: Referenced image " + imageNumber + " was not recognized as a valid image in " + tag);
                    return match;
                });

                tag = tag.replace(fontIndexPattern, (match, g1) => {
                    const fontNumber = fromBase32(g1);
                    const fontName = this.rscnames[fontNumber - 1];
                    const osep = match.slice(0, 1);
                    const csep = match.slice(-1);
                    if (fontName === null || fontName === undefined) {
                        console.log("Error: Referenced font " + fontNumber + " was not recognized as a valid font in " + tag);
                        return match;
                    }
                    const replacement = osep + '../Fonts/' + fontName + csep;
                    this.used[fontName] = 'used';
                    return replacement;
                });

                tag = tag.replace(urlCssIndexPattern, (match, g1) => {
                    const num = fromBase32(g1);
                    const [typ, fmt, pdir, fnm] = this.k8proc.getFlowInfo(num);
                    this.used[fnm] = 'used';
                    return '"../' + pdir + '/' + fnm + '"';
                });

                tag = tag.replace(urlSvgImagePattern, (match, g1) => {
                    const num = fromBase32(g1);
                    const [typ, fmt, pdir, fnm] = this.k8proc.getFlowInfo(num);
                    this.used[fnm] = 'used';
                    return '"../' + pdir + '/' + fnm + '"';
                });

                srcpieces[j] = tag;
            }
            flowpart = Buffer.from(srcpieces.join(''), 'latin1');
            flows.push(flowpart);
        }

        const tagPattern2 = /(<[^>]*>)/g;
        const flowPattern2 = /['"]kindle:flow:([0-9|A-V]+)\?mime=([^'"]+)['"]/gi;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            const [partnum, dir, filename, beg, end, aidtext] = this.k8proc.partinfo[i];

            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(tagPattern2);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];
                if (tag.startsWith('<')) {
                    tag = tag.replace(flowPattern2, (match, g1, g2) => {
                        const num = fromBase32(g1);
                        if (num > 0 && num < this.k8proc.flowinfo.length) {
                            const [typ, fmt, pdir, fnm] = this.k8proc.getFlowInfo(num);
                            const flowpart = flows[num];
                            if (fmt.toString('latin1') === 'inline') {
                                return flowpart.toString('latin1');
                            }
                            this.used[fnm] = 'used';
                            return '"../' + pdir + '/' + fnm + '"';
                        }
                        console.log("warning: ignoring non-existent flow link", tag, " value 0x" + num.toString(16));
                        return match;
                    });
                    srcpieces[j] = tag;
                }
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts[i] = part;
        }

        const stylePattern = /(<[a-zA-Z0-9]+\s[^>]*style\s*=\s*[^>]*>)/gi;
        const imgIndexPattern2 = /[('"]kindle:embed:([0-9|A-V]+)[^'"]*['")]/gi;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            const [partnum, dir, filename, beg, end, aidtext] = this.k8proc.partinfo[i];

            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(stylePattern);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];
                if (tag.includes('kindle:embed')) {
                    tag = tag.replace(imgIndexPattern2, (match, g1) => {
                        const imageNumber = fromBase32(g1);
                        const imageName = this.rscnames[imageNumber - 1];
                        const osep = match.slice(0, 1);
                        const csep = match.slice(-1);
                        if (imageName !== null && imageName !== undefined) {
                            this.used[imageName] = 'used';
                            return osep + '../Images/' + imageName + csep;
                        }
                        console.log("Error: Referenced image " + imageNumber + " in style url was not recognized in " + tag);
                        return match;
                    });
                    srcpieces[j] = tag;
                }
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts[i] = part;
        }

        const imgPattern3 = /(<[img\s|image\s][^>]*>)/gi;
        const imgIndexPattern3 = /['"]kindle:embed:([0-9|A-V]+)[^'"]*['"]/gi;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            const [partnum, dir, filename, beg, end, aidtext] = this.k8proc.partinfo[i];

            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(imgPattern3);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];
                if (tag.startsWith('<im')) {
                    tag = tag.replace(imgIndexPattern3, (match, g1) => {
                        const imageNumber = fromBase32(g1);
                        const imageName = this.rscnames[imageNumber - 1];
                        if (imageName !== null && imageName !== undefined) {
                            this.used[imageName] = 'used';
                            return '"../Images/' + imageName + '"';
                        }
                        console.log("Error: Referenced image " + imageNumber + " was not recognized as a valid image in " + tag);
                        return match;
                    });
                    srcpieces[j] = tag;
                }
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts[i] = part;
        }

        const tagPattern3 = /(<[^>]*>)/g;
        const liValuePattern = /\svalue\s*=\s*['"][^'"]*['"]/gi;
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i];
            const [partnum, dir, filename, beg, end, aidtext] = this.k8proc.partinfo[i];

            let partStr = part.toString('latin1');
            const srcpieces = partStr.split(tagPattern3);
            for (let j = 1; j < srcpieces.length; j += 2) {
                let tag = srcpieces[j];
                if (tag.startsWith('<svg') || tag.startsWith('<SVG')) {
                    tag = tag.replace(/preserveaspectratio/g, 'preserveAspectRatio');
                    tag = tag.replace(/viewbox/g, 'viewBox');
                } else if (tag.startsWith('<li ') || tag.startsWith('<LI ')) {
                    tag = tag.replace(liValuePattern, '');
                }
                srcpieces[j] = tag;
            }
            part = Buffer.from(srcpieces.join(''), 'latin1');
            parts[i] = part;
        }

        if (this.viewport) {
            const injectedMeta = Buffer.concat([
                utf8Str('<meta name="viewport" content="'),
                utf8Str(this.viewport),
                utf8Str('"/>\n')
            ]);
            const viewportPattern = /<meta\s[^>]*name\s*=\s*["'][^"'>]*viewport["'][^>]*>/gi;
            for (let i = 0; i < parts.length; i++) {
                let part = parts[i];
                const partStr = part.toString('latin1');
                if (partStr.search(viewportPattern) === -1) {
                    const endheadpos = part.indexOf('</head>');
                    if (endheadpos >= 0) {
                        part = Buffer.concat([part.slice(0, endheadpos), injectedMeta, part.slice(endheadpos)]);
                    }
                }
                parts[i] = part;
            }
        }

        this.k8proc.setFlows(flows);
        this.k8proc.setParts(parts);

        return this.used;
    }
}

module.exports = {
    HTMLProcessor,
    XHTMLK8Processor
};
