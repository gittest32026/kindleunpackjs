/**
 * mobi_cover.js
 * JavaScript equivalent of Python mobi_cover.py
 * Cover page generation and image type/size detection
 */

const fs = require('fs');
const path = require('path');
const { unicodeStr } = require('./compatibility_utils');
const { pathof, relpath } = require('./unipath');
const imghdr = require('./imghdr');

const USE_SVG_WRAPPER = true;
const FORCE_DEFAULT_TITLE = false;
const COVER_PAGE_FINENAME = 'cover_page.xhtml';
const DEFAULT_TITLE = 'Cover';
const MAX_WIDTH = 4096;
const MAX_HEIGHT = 4096;

function get_image_type(imgname, imgdata = null) {
    let imgtype = unicodeStr(imghdr.what(pathof(imgname), imgdata));

    // imghdr only checks for JFIF or Exif JPEG files. Apparently, there are some
    // with only the magic JPEG bytes out there...
    // ImageMagick handles those, so, do it too.
    if (imgtype === null) {
        if (imgdata === null) {
            imgdata = fs.readFileSync(pathof(imgname));
        }
        if (imgdata[0] === 0xFF && imgdata[1] === 0xD8) {
            // Get last non-null bytes
            let last = imgdata.length;
            while (imgdata[last - 1] === 0x00) {
                last -= 1;
            }
            // Be extra safe, check the trailing bytes, too.
            if (imgdata[last - 2] === 0xFF && imgdata[last - 1] === 0xD9) {
                imgtype = "jpeg";
            }
        }
    }
    return imgtype;
}

function get_image_size(imgname, imgdata = null) {
    let fhandle = null;
    let head;
    if (imgdata === null) {
        fhandle = fs.openSync(pathof(imgname), 'r');
        head = Buffer.alloc(24);
        fs.readSync(fhandle, head, 0, 24, 0);
    } else {
        head = imgdata.slice(0, 24);
    }
    if (head.length !== 24) {
        if (fhandle !== null) {
            fs.closeSync(fhandle);
        }
        return;
    }

    const imgtype = get_image_type(imgname, imgdata);
    let width, height;
    if (imgtype === 'png') {
        const check = head.readInt32BE(4);
        if (check !== 0x0d0a1a0a) {
            if (fhandle !== null) {
                fs.closeSync(fhandle);
            }
            return;
        }
        width = head.readInt32BE(16);
        height = head.readInt32BE(20);
    } else if (imgtype === 'gif') {
        width = head.readUInt16LE(6);
        height = head.readUInt16LE(8);
    } else if (imgtype === 'jpeg' && imgdata === null) {
        try {
            let pos = 0;
            let size = 2;
            let ftype = 0;
            const byteBuf = Buffer.alloc(1);
            const twoByteBuf = Buffer.alloc(2);
            while (!(0xc0 <= ftype && ftype <= 0xcf)) {
                pos += size;
                fs.readSync(fhandle, byteBuf, 0, 1, pos);
                pos += 1;
                while (byteBuf[0] === 0xff) {
                    fs.readSync(fhandle, byteBuf, 0, 1, pos);
                    pos += 1;
                }
                ftype = byteBuf[0];
                fs.readSync(fhandle, twoByteBuf, 0, 2, pos);
                size = twoByteBuf.readUInt16BE(0) - 2;
                pos += 2;
            }
            // We are at a SOFn block
            pos += 1;  // Skip `precision' byte.
            fs.readSync(fhandle, twoByteBuf, 0, 2, pos);
            height = twoByteBuf.readUInt16BE(0);
            pos += 2;
            fs.readSync(fhandle, twoByteBuf, 0, 2, pos);
            width = twoByteBuf.readUInt16BE(0);
        } catch (e) {
            if (fhandle !== null) {
                fs.closeSync(fhandle);
            }
            return;
        }
    } else if (imgtype === 'jpeg' && imgdata !== null) {
        try {
            let pos = 0;
            let size = 2;
            let ftype = 0;
            while (!(0xc0 <= ftype && ftype <= 0xcf)) {
                pos += size;
                let byte = imgdata[pos];
                pos += 1;
                while (byte === 0xff) {
                    byte = imgdata[pos];
                    pos += 1;
                }
                ftype = byte;
                size = imgdata.readUInt16BE(pos) - 2;
                pos += 2;
            }
            // We are at a SOFn block
            pos += 1;  // Skip `precision' byte.
            height = imgdata.readUInt16BE(pos);
            pos += 2;
            width = imgdata.readUInt16BE(pos);
            pos += 2;
        } catch (e) {
            if (fhandle !== null) {
                fs.closeSync(fhandle);
            }
            return;
        }
    } else {
        if (fhandle !== null) {
            fs.closeSync(fhandle);
        }
        return;
    }

    if (fhandle !== null) {
        fs.closeSync(fhandle);
    }
    return [width, height];
}

class CoverProcessor {

    constructor(files, metadata, rscnames, imgname = null, imgdata = null) {
        this.files = files;
        this.metadata = metadata;
        this.rscnames = rscnames;
        this.cover_page = COVER_PAGE_FINENAME;
        this.use_svg = USE_SVG_WRAPPER;  // Use svg wrapper.
        this.lang = metadata.Language ? metadata.Language[0] : 'en';
        // This should ensure that if the methods to find the cover image's
        // dimensions should fail for any reason, the SVG routine will not be used.
        [this.width, this.height] = [-1, -1];
        if (FORCE_DEFAULT_TITLE) {
            this.title = DEFAULT_TITLE;
        } else {
            this.title = metadata.Title ? metadata.Title[0] : DEFAULT_TITLE;
        }

        this.cover_image = null;
        if (imgname !== null) {
            this.cover_image = imgname;
        } else if ('CoverOffset' in metadata) {
            const imageNumber = parseInt(metadata.CoverOffset[0], 10);
            const cover_image = this.rscnames[imageNumber];
            if (cover_image !== null && cover_image !== undefined) {
                this.cover_image = cover_image;
            } else {
                console.log('Warning: Cannot identify the cover image.');
            }
        }
        if (this.use_svg) {
            try {
                if (imgdata === null) {
                    const fname = path.join(files.imgdir, this.cover_image);
                    [this.width, this.height] = get_image_size(fname);
                } else {
                    [this.width, this.height] = get_image_size(null, imgdata);
                }
            } catch (e) {
                this.use_svg = false;
            }
            const width = this.width;
            const height = this.height;
            if (width < 0 || height < 0 || width > MAX_WIDTH || height > MAX_HEIGHT) {
                this.use_svg = false;
            }
        }
    }

    getImageName() {
        return this.cover_image;
    }

    getXHTMLName() {
        return this.cover_page;
    }

    buildXHTML() {
        console.log('Building a cover page.');
        const files = this.files;
        const cover_image = this.cover_image;
        const title = this.title;
        const lang = this.lang;

        const image_dir = path.normalize(relpath(files.k8images, files.k8text));
        const image_path = path.join(image_dir, cover_image).replace(/\\/g, '/');

        let data;
        if (!this.use_svg) {
            data = '';
            data += '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>';
            data += '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"';
            data += ` xml:lang="${lang}">\n`;
            data += `<head>\n<title>${title}</title>\n`;
            data += '<style type="text/css">\n';
            data += 'body {\n  margin: 0;\n  padding: 0;\n  text-align: center;\n}\n';
            data += 'div {\n  height: 100%;\n  width: 100%;\n  text-align: center;\n  page-break-inside: avoid;\n}\n';
            data += 'img {\n  display: inline-block;\n  height: 100%;\n  margin: 0 auto;\n}\n';
            data += '</style>\n</head>\n';
            data += '<body><div>\n';
            data += `  <img src="${image_path}" alt=""/>\n`;
            data += '</div></body>\n</html>';
        } else {
            const width = this.width;
            const height = this.height;
            const viewBox = `0 0 ${width} ${height}`;

            data = '';
            data += '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>';
            data += '<html xmlns="http://www.w3.org/1999/xhtml"';
            data += ` xml:lang="${lang}">\n`;
            data += `<head>\n  <title>${title}</title>\n`;
            data += '<style type="text/css">\n';
            data += 'svg {padding: 0pt; margin:0pt}\n';
            data += 'body { text-align: center; padding:0pt; margin: 0pt; }\n';
            data += '</style>\n</head>\n';
            data += '<body>\n  <div>\n';
            data += '    <svg xmlns="http://www.w3.org/2000/svg" height="100%" preserveAspectRatio="xMidYMid meet"';
            data += ` version="1.1" viewBox="${viewBox}" width="100%" xmlns:xlink="http://www.w3.org/1999/xlink">\n`;
            data += `      <image height="${height}" width="${width}" xlink:href="${image_path}"/>\n`;
            data += '    </svg>\n';
            data += '  </div>\n</body>\n</html>';
        }
        return data;
    }

    writeXHTML() {
        const files = this.files;
        const cover_page = this.cover_page;

        const data = this.buildXHTML();

        const outfile = path.join(files.k8text, cover_page);
        if (fs.existsSync(pathof(outfile))) {
            console.log(`Warning: ${cover_page} already exists.`);
            fs.unlinkSync(pathof(outfile));
        }
        fs.writeFileSync(pathof(outfile), data, 'utf-8');
    }

    guide_toxml() {
        const files = this.files;
        const text_dir = relpath(files.k8text, files.k8oebps);
        const data = `<reference type="cover" title="Cover" href="${text_dir}/${this.cover_page}" />\n`;
        return data;
    }
}

module.exports = {
    CoverProcessor,
    get_image_type
};
