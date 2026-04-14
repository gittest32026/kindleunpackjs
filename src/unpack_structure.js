/**
 * unpack_structure.js
 * JavaScript equivalent of Python unpack_structure.py
 * Handles output directory structure and EPUB creation
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { pathof } = require('./unipath');
const { mangleFonts } = require('./mobi_utils');

class UnpackException extends Error {}

class fileNames {
    constructor(infile, outdir) {
        this.infile = infile;
        this.outdir = outdir;
        if (!fs.existsSync(pathof(this.outdir))) {
            fs.mkdirSync(pathof(this.outdir), { recursive: true });
        }
        this.mobi7dir = path.join(this.outdir, 'mobi7');
        if (!fs.existsSync(pathof(this.mobi7dir))) {
            fs.mkdirSync(pathof(this.mobi7dir), { recursive: true });
        }
        this.imgdir = path.join(this.mobi7dir, 'Images');
        if (!fs.existsSync(pathof(this.imgdir))) {
            fs.mkdirSync(pathof(this.imgdir), { recursive: true });
        }
        this.hdimgdir = path.join(this.outdir, 'HDImages');
        if (!fs.existsSync(pathof(this.hdimgdir))) {
            fs.mkdirSync(pathof(this.hdimgdir), { recursive: true });
        }
        this.outbase = path.join(this.outdir, path.parse(infile).name);
    }

    getInputFileBasename() {
        return path.parse(path.basename(this.infile)).name;
    }

    makeK8Struct() {
        this.k8dir = path.join(this.outdir, 'mobi8');
        if (!fs.existsSync(pathof(this.k8dir))) {
            fs.mkdirSync(pathof(this.k8dir), { recursive: true });
        }
        this.k8metainf = path.join(this.k8dir, 'META-INF');
        if (!fs.existsSync(pathof(this.k8metainf))) {
            fs.mkdirSync(pathof(this.k8metainf), { recursive: true });
        }
        this.k8oebps = path.join(this.k8dir, 'OEBPS');
        if (!fs.existsSync(pathof(this.k8oebps))) {
            fs.mkdirSync(pathof(this.k8oebps), { recursive: true });
        }
        this.k8images = path.join(this.k8oebps, 'Images');
        if (!fs.existsSync(pathof(this.k8images))) {
            fs.mkdirSync(pathof(this.k8images), { recursive: true });
        }
        this.k8fonts = path.join(this.k8oebps, 'Fonts');
        if (!fs.existsSync(pathof(this.k8fonts))) {
            fs.mkdirSync(pathof(this.k8fonts), { recursive: true });
        }
        this.k8styles = path.join(this.k8oebps, 'Styles');
        if (!fs.existsSync(pathof(this.k8styles))) {
            fs.mkdirSync(pathof(this.k8styles), { recursive: true });
        }
        this.k8text = path.join(this.k8oebps, 'Text');
        if (!fs.existsSync(pathof(this.k8text))) {
            fs.mkdirSync(pathof(this.k8text), { recursive: true });
        }
    }

    zipUpDir(myzip, tdir, localname) {
        let currentdir = tdir;
        if (localname !== '') {
            currentdir = path.join(currentdir, localname);
        }
        const list = fs.readdirSync(pathof(currentdir));
        for (const file of list) {
            const afilename = file;
            const localfilePath = path.join(localname, afilename).replace(/\\/g, '/');
            const realfilePath = path.join(currentdir, file);
            const stat = fs.statSync(pathof(realfilePath));
            if (stat.isFile()) {
                myzip.addLocalFile(pathof(realfilePath), path.dirname(localfilePath), path.basename(localfilePath));
            } else if (stat.isDirectory()) {
                this.zipUpDir(myzip, tdir, path.join(localname, afilename));
            }
        }
    }

    makeEPUB(usedmap, obfuscate_data, uid) {
        const bname = path.join(this.k8dir, this.getInputFileBasename() + '.epub');
        
        let key = uid;
        if (typeof key === 'string') {
            key = Buffer.from(key, 'ascii');
        }
        if (obfuscate_data && obfuscate_data.length > 0) {
            const hexStr = key.toString().replace(/[^a-fA-F0-9]/g, '');
            key = Buffer.from((hexStr + hexStr).slice(0, 32), 'hex');
        }

        const imgnames = fs.readdirSync(pathof(this.imgdir));
        for (const name of imgnames) {
            if (usedmap[name] === 'used') {
                const filein = path.join(this.imgdir, name);
                let fileout;
                if (name.endsWith('.ttf')) {
                    fileout = path.join(this.k8fonts, name);
                } else if (name.endsWith('.otf')) {
                    fileout = path.join(this.k8fonts, name);
                } else if (name.endsWith('.failed')) {
                    fileout = path.join(this.k8fonts, name);
                } else {
                    fileout = path.join(this.k8images, name);
                }
                let data = fs.readFileSync(pathof(filein));
                if (obfuscate_data && obfuscate_data.includes(name)) {
                    data = mangleFonts(key, data);
                }
                fs.writeFileSync(pathof(fileout), data);
                if (name.endsWith('.ttf') || name.endsWith('.otf')) {
                    fs.unlinkSync(pathof(filein));
                }
            }
        }

        let container = '<?xml version="1.0" encoding="UTF-8"?>\n';
        container += '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n';
        container += '    <rootfiles>\n';
        container += '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>';
        container += '    </rootfiles>\n</container>\n';
        const fileoutContainer = path.join(this.k8metainf, 'container.xml');
        fs.writeFileSync(pathof(fileoutContainer), Buffer.from(container, 'utf-8'));

        if (obfuscate_data && obfuscate_data.length > 0) {
            let encryption = '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" \
xmlns:enc="http://www.w3.org/2001/04/xmlenc#" xmlns:deenc="http://ns.adobe.com/digitaleditions/enc">\n';
            for (const font of obfuscate_data) {
                encryption += '  <enc:EncryptedData>\n';
                encryption += '    <enc:EncryptionMethod Algorithm="http://ns.adobe.com/pdf/enc#RC"/>\n';
                encryption += '    <enc:CipherData>\n';
                encryption += '      <enc:CipherReference URI="OEBPS/Fonts/' + font + '"/>\n';
                encryption += '    </enc:CipherData>\n';
                encryption += '  </enc:EncryptedData>\n';
            }
            encryption += '</encryption>\n';
            const fileoutEncryption = path.join(this.k8metainf, 'encryption.xml');
            fs.writeFileSync(pathof(fileoutEncryption), Buffer.from(encryption, 'utf-8'));
        }

        const zip = new AdmZip();
        
        // add the mimetype file uncompressed
        const mimetype = Buffer.from('application/epub+zip');
        const fileoutMimetype = path.join(this.k8dir, 'mimetype');
        fs.writeFileSync(pathof(fileoutMimetype), mimetype);
        zip.addFile('mimetype', mimetype, '', 0);
        
        this.zipUpDir(zip, this.k8dir, 'META-INF');
        this.zipUpDir(zip, this.k8dir, 'OEBPS');
        
        zip.writeZip(pathof(bname));
    }
}

module.exports = {
    UnpackException,
    fileNames
};
