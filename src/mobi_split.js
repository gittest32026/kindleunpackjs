/**
 * mobi_split.js
 * JavaScript equivalent of Python mobi_split.py
 * Splits combination MOBI7/MOBI8 files into standalone files
 */

const fs = require('fs');
const { pathof } = require('./unipath');

// Important PDB header offsets
const unique_id_seed = 68;
const number_of_pdb_records = 76;

// Important PalmDoc header offsets
const first_pdb_record = 78;

// Important rec0 offsets
const mobi_header_base = 16;
const mobi_header_length = 20;
const mobi_version = 36;
const title_offset = 84;
const first_resc_record = 108;
const last_content_index = 194;
const kf8_fdst_index = 192;
const fcis_index = 200;
const flis_index = 208;
const srcs_index = 224;
const srcs_count = 228;
const datp_index = 256;
const hufftbloff = 120;

function getint(datain, ofs, sz = 'L') {
    if (sz === 'L') {
        return datain.readUInt32BE(ofs);
    } else if (sz === 'H') {
        return datain.readUInt16BE(ofs);
    }
    return 0;
}

function writeint(datain, ofs, n, len = 'L') {
    const buf = Buffer.from(datain);
    if (len === 'L') {
        buf.writeUInt32BE(n, ofs);
    } else {
        buf.writeUInt16BE(n, ofs);
    }
    return buf;
}

function getsecaddr(datain, secno) {
    const nsec = getint(datain, number_of_pdb_records, 'H');
    if (secno < 0 || secno >= nsec) {
        throw new Error('secno ' + secno + ' out of range (nsec=' + nsec + ')');
    }
    const secstart = getint(datain, first_pdb_record + secno * 8);
    let secend;
    if (secno === nsec - 1) {
        secend = datain.length;
    } else {
        secend = getint(datain, first_pdb_record + (secno + 1) * 8);
    }
    return [secstart, secend];
}

function readsection(datain, secno) {
    const [secstart, secend] = getsecaddr(datain, secno);
    return datain.slice(secstart, secend);
}

function writesection(datain, secno, secdata) {
    const nsec = getint(datain, number_of_pdb_records, 'H');
    const [zerosecstart] = getsecaddr(datain, 0);
    const [secstart, secend] = getsecaddr(datain, secno);
    const dif = secdata.length - (secend - secstart);
    const datalst = [];
    
    datalst.push(datain.slice(0, unique_id_seed));
    const buf1 = Buffer.allocUnsafe(4);
    buf1.writeUInt32BE(2 * nsec + 1);
    datalst.push(buf1);
    datalst.push(datain.slice(unique_id_seed + 4, number_of_pdb_records));
    const buf2 = Buffer.allocUnsafe(2);
    buf2.writeUInt16BE(nsec);
    datalst.push(buf2);
    
    const newstart = zerosecstart;
    for (let i = 0; i < secno; i++) {
        const ofs = getint(datain, first_pdb_record + i * 8);
        const flgval = getint(datain, first_pdb_record + i * 8 + 4);
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofs, 0);
        b.writeUInt32BE(flgval, 4);
        datalst.push(b);
    }
    {
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(secstart, 0);
        b.writeUInt32BE(2 * secno, 4);
        datalst.push(b);
    }
    for (let i = secno + 1; i < nsec; i++) {
        let ofs = getint(datain, first_pdb_record + i * 8);
        const flgval = getint(datain, first_pdb_record + i * 8 + 4);
        ofs = ofs + dif;
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofs, 0);
        b.writeUInt32BE(flgval, 4);
        datalst.push(b);
    }
    const lpad = newstart - (first_pdb_record + 8 * nsec);
    if (lpad > 0) {
        datalst.push(Buffer.alloc(lpad, 0));
    }
    datalst.push(datain.slice(zerosecstart, secstart));
    datalst.push(secdata);
    datalst.push(datain.slice(secend));
    return Buffer.concat(datalst);
}

function nullsection(datain, secno) {
    const nsec = getint(datain, number_of_pdb_records, 'H');
    const [secstart, secend] = getsecaddr(datain, secno);
    const [zerosecstart] = getsecaddr(datain, 0);
    const dif = secend - secstart;
    const datalst = [];
    
    datalst.push(datain.slice(0, first_pdb_record));
    for (let i = 0; i < secno + 1; i++) {
        const ofs = getint(datain, first_pdb_record + i * 8);
        const flgval = getint(datain, first_pdb_record + i * 8 + 4);
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofs, 0);
        b.writeUInt32BE(flgval, 4);
        datalst.push(b);
    }
    for (let i = secno + 1; i < nsec; i++) {
        let ofs = getint(datain, first_pdb_record + i * 8);
        const flgval = getint(datain, first_pdb_record + i * 8 + 4);
        ofs = ofs - dif;
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofs, 0);
        b.writeUInt32BE(flgval, 4);
        datalst.push(b);
    }
    const lpad = zerosecstart - (first_pdb_record + 8 * nsec);
    if (lpad > 0) {
        datalst.push(Buffer.alloc(lpad, 0));
    }
    datalst.push(datain.slice(zerosecstart, secstart));
    datalst.push(datain.slice(secend));
    return Buffer.concat(datalst);
}

function deletesectionrange(datain, firstsec, lastsec) {
    const [firstsecstart] = getsecaddr(datain, firstsec);
    const [, lastsecend] = getsecaddr(datain, lastsec);
    const [zerosecstart] = getsecaddr(datain, 0);
    const dif = lastsecend - firstsecstart + 8 * (lastsec - firstsec + 1);
    const nsec = getint(datain, number_of_pdb_records, 'H');
    const datalst = [];
    
    datalst.push(datain.slice(0, unique_id_seed));
    const buf1 = Buffer.allocUnsafe(4);
    buf1.writeUInt32BE(2 * (nsec - (lastsec - firstsec + 1)) + 1);
    datalst.push(buf1);
    datalst.push(datain.slice(unique_id_seed + 4, number_of_pdb_records));
    const buf2 = Buffer.allocUnsafe(2);
    buf2.writeUInt16BE(nsec - (lastsec - firstsec + 1));
    datalst.push(buf2);
    const newstart = zerosecstart - 8 * (lastsec - firstsec + 1);
    
    for (let i = 0; i < firstsec; i++) {
        let ofs = getint(datain, first_pdb_record + i * 8);
        const flgval = getint(datain, first_pdb_record + i * 8 + 4);
        ofs = ofs - 8 * (lastsec - firstsec + 1);
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofs, 0);
        b.writeUInt32BE(flgval, 4);
        datalst.push(b);
    }
    for (let i = lastsec + 1; i < nsec; i++) {
        let ofs = getint(datain, first_pdb_record + i * 8);
        const flgval = getint(datain, first_pdb_record + i * 8 + 4);
        ofs = ofs - dif;
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofs, 0);
        b.writeUInt32BE(2 * (i - (lastsec - firstsec + 1)), 4);
        datalst.push(b);
    }
    const lpad = newstart - (first_pdb_record + 8 * (nsec - (lastsec - firstsec + 1)));
    if (lpad > 0) {
        datalst.push(Buffer.alloc(lpad, 0));
    }
    datalst.push(datain.slice(zerosecstart, firstsecstart));
    datalst.push(datain.slice(lastsecend));
    return Buffer.concat(datalst);
}

function get_exth_params(rec0) {
    const ebase = mobi_header_base + getint(rec0, mobi_header_length);
    const elen = getint(rec0, ebase + 4);
    const enum_ = getint(rec0, ebase + 8);
    return [ebase, elen, enum_];
}

function write_exth(rec0, exth_num, exth_bytes) {
    let [ebase, elen, enum_] = get_exth_params(rec0);
    let ebase_idx = ebase + 12;
    let enum_idx = enum_;
    while (enum_idx > 0) {
        const exth_id = getint(rec0, ebase_idx);
        if (exth_id === exth_num) {
            const dif = exth_bytes.length + 8 - getint(rec0, ebase_idx + 4);
            let newrec0 = Buffer.from(rec0);
            if (dif !== 0) {
                newrec0 = writeint(newrec0, title_offset, getint(newrec0, title_offset) + dif);
            }
            const parts = [];
            parts.push(newrec0.slice(0, ebase + 4));
            const b1 = Buffer.allocUnsafe(4);
            b1.writeUInt32BE(elen + exth_bytes.length + 8 - getint(rec0, ebase_idx + 4));
            parts.push(b1);
            const b2 = Buffer.allocUnsafe(4);
            b2.writeUInt32BE(enum_);
            parts.push(b2);
            parts.push(rec0.slice(ebase + 12, ebase_idx + 4));
            const b3 = Buffer.allocUnsafe(4);
            b3.writeUInt32BE(exth_bytes.length + 8);
            parts.push(b3);
            parts.push(exth_bytes);
            parts.push(rec0.slice(ebase_idx + getint(rec0, ebase_idx + 4)));
            return Buffer.concat(parts);
        }
        enum_idx -= 1;
        ebase_idx += getint(rec0, ebase_idx + 4);
    }
    return rec0;
}

function read_exth(rec0, exth_num) {
    const exth_values = [];
    let [ebase, elen, enum_] = get_exth_params(rec0);
    ebase += 12;
    while (enum_ > 0) {
        const exth_id = getint(rec0, ebase);
        if (exth_id === exth_num) {
            exth_values.push(rec0.slice(ebase + 8, ebase + getint(rec0, ebase + 4)));
        }
        enum_ -= 1;
        ebase += getint(rec0, ebase + 4);
    }
    return exth_values;
}

function del_exth(rec0, exth_num) {
    let [ebase, elen, enum_] = get_exth_params(rec0);
    let ebase_idx = ebase + 12;
    let enum_idx = 0;
    while (enum_idx < enum_) {
        const exth_id = getint(rec0, ebase_idx);
        const exth_size = getint(rec0, ebase_idx + 4);
        if (exth_id === exth_num) {
            let newrec0 = Buffer.from(rec0);
            newrec0 = writeint(newrec0, title_offset, getint(newrec0, title_offset) - exth_size);
            const part1 = newrec0.slice(0, ebase_idx);
            const part2 = newrec0.slice(ebase_idx + exth_size);
            const mid1 = Buffer.allocUnsafe(4);
            mid1.writeUInt32BE(elen - exth_size);
            const mid2 = Buffer.allocUnsafe(4);
            mid2.writeUInt32BE(enum_ - 1);
            return Buffer.concat([part1, mid1, mid2, part2.slice(ebase + 12 - ebase_idx)]);
        }
        enum_idx += 1;
        ebase_idx += exth_size;
    }
    return rec0;
}

class mobi_split {
    constructor(infile) {
        const datain = fs.readFileSync(pathof(infile));
        const datain_rec0 = readsection(datain, 0);
        const ver = getint(datain_rec0, mobi_version);
        this.combo = (ver !== 8);
        if (!this.combo) {
            return;
        }
        const exth121 = read_exth(datain_rec0, 121);
        if (exth121.length === 0) {
            this.combo = false;
            return;
        } else {
            const datain_kf8 = exth121[0].readUInt32BE(0);
            if (datain_kf8 === 0xffffffff) {
                this.combo = false;
                return;
            }
            this.datain_kf8 = datain_kf8;
        }
        const datain_kfrec0 = readsection(datain, this.datain_kf8);

        // Create standalone mobi7
        const num_sec = getint(datain, number_of_pdb_records, 'H');
        this.result_file7 = deletesectionrange(datain, this.datain_kf8 - 1, num_sec - 2);
        
        const srcs = getint(datain_rec0, srcs_index);
        const num_srcs = getint(datain_rec0, srcs_count);
        let new_rec0 = Buffer.from(datain_rec0);
        if (srcs !== 0xffffffff && num_srcs > 0) {
            this.result_file7 = deletesectionrange(this.result_file7, srcs, srcs + num_srcs - 1);
            new_rec0 = writeint(new_rec0, srcs_index, 0xffffffff);
            new_rec0 = writeint(new_rec0, srcs_count, 0);
        }
        
        new_rec0 = write_exth(new_rec0, 121, Buffer.from([0xff, 0xff, 0xff, 0xff]));
        new_rec0 = write_exth(new_rec0, 129, Buffer.alloc(0));
        
        let fval = new_rec0.readUInt32BE(0x80);
        fval = fval & 0x07FF;
        const fvalBuf = Buffer.allocUnsafe(4);
        fvalBuf.writeUInt32BE(fval);
        new_rec0 = Buffer.concat([new_rec0.slice(0, 0x80), fvalBuf, new_rec0.slice(0x84)]);
        
        this.result_file7 = writesection(this.result_file7, 0, new_rec0);

        const firstimage = getint(new_rec0, first_resc_record);
        let lastimage = getint(new_rec0, last_content_index, 'H');
        if (lastimage === 0xffff) {
            const ofs_list = [[fcis_index, 'L'], [flis_index, 'L'], [datp_index, 'L'], [hufftbloff, 'L']];
            for (const [ofs, sz] of ofs_list) {
                const n = getint(new_rec0, ofs, sz);
                if (n > 0 && n < lastimage) {
                    lastimage = n - 1;
                }
            }
        }
        console.log("First Image, last Image", firstimage, lastimage);

        for (let i = firstimage; i < lastimage; i++) {
            const imgsec = readsection(this.result_file7, i);
            const sig = imgsec.slice(0, 4).toString('ascii');
            if (sig === 'RESC' || sig === 'FONT') {
                this.result_file7 = nullsection(this.result_file7, i);
            }
        }

        // Create standalone mobi8
        this.result_file8 = deletesectionrange(datain, 0, this.datain_kf8 - 1);
        const target = getint(datain_kfrec0, first_resc_record);
        this.result_file8 = insertsectionrange(datain, firstimage, lastimage, this.result_file8, target);
        let new_kfrec0 = readsection(this.result_file8, 0);

        const kf8starts = read_exth(new_kfrec0, 116);
        let kf8start_count = kf8starts.length;
        while (kf8start_count > 1) {
            kf8start_count -= 1;
            new_kfrec0 = del_exth(new_kfrec0, 116);
        }

        const countBuf = Buffer.allocUnsafe(4);
        countBuf.writeUInt32BE(lastimage - firstimage + 1);
        new_kfrec0 = write_exth(new_kfrec0, 125, countBuf);

        let fval8 = new_kfrec0.readUInt32BE(0x80);
        fval8 = fval8 & 0x1FFF;
        fval8 |= 0x0800;
        const fval8Buf = Buffer.allocUnsafe(4);
        fval8Buf.writeUInt32BE(fval8);
        new_kfrec0 = Buffer.concat([new_kfrec0.slice(0, 0x80), fval8Buf, new_kfrec0.slice(0x84)]);

        const ofs_list = [[kf8_fdst_index, 'L'], [fcis_index, 'L'], [flis_index, 'L'], [datp_index, 'L'], [hufftbloff, 'L']];
        for (const [ofs, sz] of ofs_list) {
            const n = getint(new_kfrec0, ofs, sz);
            if (n !== 0xffffffff) {
                new_kfrec0 = writeint(new_kfrec0, ofs, n + lastimage - firstimage + 1, sz);
            }
        }
        this.result_file8 = writesection(this.result_file8, 0, new_kfrec0);
    }

    getResult8() {
        return this.result_file8;
    }

    getResult7() {
        return this.result_file7;
    }
}

function insertsectionrange(sectionsource, firstsec, lastsec, sectiontarget, targetsec) {
    const nsec = getint(sectiontarget, number_of_pdb_records, 'H');
    const [zerosecstart] = getsecaddr(sectiontarget, 0);
    const [insstart] = getsecaddr(sectiontarget, targetsec);
    const nins = lastsec - firstsec + 1;
    const [srcstart] = getsecaddr(sectionsource, firstsec);
    const [, srcend] = getsecaddr(sectionsource, lastsec);
    const newstart = zerosecstart + 8 * nins;
    const datalst = [];

    datalst.push(sectiontarget.slice(0, unique_id_seed));
    const buf1 = Buffer.allocUnsafe(4);
    buf1.writeUInt32BE(2 * (nsec + nins) + 1);
    datalst.push(buf1);
    datalst.push(sectiontarget.slice(unique_id_seed + 4, number_of_pdb_records));
    const buf2 = Buffer.allocUnsafe(2);
    buf2.writeUInt16BE(nsec + nins);
    datalst.push(buf2);

    for (let i = 0; i < targetsec; i++) {
        const ofs = getint(sectiontarget, first_pdb_record + i * 8);
        const flgval = getint(sectiontarget, first_pdb_record + i * 8 + 4);
        const ofsnew = ofs + 8 * nins;
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofsnew, 0);
        b.writeUInt32BE(flgval, 4);
        datalst.push(b);
    }

    const srcstart0 = getint(sectionsource, first_pdb_record + firstsec * 8);
    for (let i = 0; i < nins; i++) {
        const isrcstart = getint(sectionsource, first_pdb_record + (firstsec + i) * 8);
        const ofsnew = insstart + (isrcstart - srcstart0) + 8 * nins;
        const flgvalnew = 2 * (targetsec + i);
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofsnew, 0);
        b.writeUInt32BE(flgvalnew, 4);
        datalst.push(b);
    }

    const dif = srcend - srcstart;
    for (let i = targetsec; i < nsec; i++) {
        const ofs = getint(sectiontarget, first_pdb_record + i * 8);
        const flgval = getint(sectiontarget, first_pdb_record + i * 8 + 4);
        const ofsnew = ofs + dif + 8 * nins;
        const flgvalnew = 2 * (i + nins);
        const b = Buffer.allocUnsafe(8);
        b.writeUInt32BE(ofsnew, 0);
        b.writeUInt32BE(flgvalnew, 4);
        datalst.push(b);
    }

    const lpad = newstart - (first_pdb_record + 8 * (nsec + nins));
    if (lpad > 0) {
        datalst.push(Buffer.alloc(lpad, 0));
    }
    datalst.push(sectiontarget.slice(zerosecstart, insstart));
    datalst.push(sectionsource.slice(srcstart, srcend));
    datalst.push(sectiontarget.slice(insstart));
    return Buffer.concat(datalst);
}

module.exports = {
    mobi_split
};
