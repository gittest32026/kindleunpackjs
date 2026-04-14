# kindleunpackjs Usage Guide

## Installation

```bash
npm install kindleunpackjs
```

## Unpack a MOBI File

### CommonJS (`require`)

```javascript
const { unpackBook } = require('kindleunpackjs');

try {
  unpackBook('path/to/book.mobi', 'path/to/output_dir');
  console.log('Unpacking completed');
} catch (e) {
  console.error('Unpacking failed:', e.message);
}
```

### ES Module (`import`)

```javascript
import { unpackBook } from 'kindleunpackjs';

try {
  unpackBook('path/to/book.mobi', 'path/to/output_dir');
  console.log('Unpacking completed');
} catch (e) {
  console.error('Unpacking failed:', e.message);
}
```

## Advanced Options

Full signature of `unpackBook`:

```javascript
unpackBook(infile, outdir, apnxfile, epubver, use_hd, dodump, dowriteraw, dosplitcombos);
```

- `infile` *(string)*: Path to the input `.mobi`, `.azw`, `.azw3`, or `.prc` file.
- `outdir` *(string)*: Path to the output directory.
- `apnxfile` *(string | null)*: Optional path to an associated `.apnx` file. Default is `null`.
- `epubver` *(string)*: Target epub version. Default is `'2'`.
- `use_hd` *(boolean)*: Overwrite reduced-resolution images with HD images if present. Default is `false`.
- `dodump` *(boolean)*: Dump headers and debug info. Default is `false`.
- `dowriteraw` *(boolean)*: Write raw data to the output folder. Default is `false`.
- `dosplitcombos` *(boolean)*: Split combo mobis into mobi7 and mobi8. Default is `false`.
