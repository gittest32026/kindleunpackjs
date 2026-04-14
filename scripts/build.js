const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');
const rootPkg = require('../package.json');

// Clean and create dist
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

const obfuscatorOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

async function bundleAndObfuscate(format, outfile) {
    const tmpFile = path.join(distDir, `.tmp-${format}.js`);

    await esbuild.build({
        entryPoints: [path.join(srcDir, 'kindleunpack.js')],
        bundle: true,
        platform: 'node',
        target: 'node14',
        format,
        outfile: tmpFile,
        minify: false,
        external: ['adm-zip']
    });

    const code = fs.readFileSync(tmpFile, 'utf-8');
    const obfuscationResult = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions);
    fs.writeFileSync(outfile, obfuscationResult.getObfuscatedCode(), 'utf-8');
    fs.unlinkSync(tmpFile);
}

async function build() {
    await bundleAndObfuscate('cjs', path.join(distDir, 'kindleunpack.cjs'));
    await bundleAndObfuscate('esm', path.join(distDir, 'kindleunpack.mjs'));

    const distPkg = {
        name: rootPkg.name,
        version: rootPkg.version,
        description: rootPkg.description,
        main: 'kindleunpack.cjs',
        exports: {
            '.': {
                require: './kindleunpack.cjs',
                import: './kindleunpack.mjs'
            }
        },
        dependencies: rootPkg.dependencies
    };

    fs.writeFileSync(
        path.join(distDir, 'package.json'),
        JSON.stringify(distPkg, null, 2) + '\n'
    );

    console.log('Build completed. Output in dist/');
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
