import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';

const locales = [
    'en',
    'ja',
    'ko',
    'vi',
    'zh-cn',
    'zh-tw',
    'es',
    'pt-br',
    'fr',
    'de',
    'hi',
    'id',
    'it',
    'ru',
    'ar',
    'tr'
];

function readJson(filePath: string): Record<string, string> {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, string>;
}

function collectPackageNlsKeys(): string[] {
    const pkg = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
    const keys = new Set<string>();
    const re = /%([^%]+)%/g;

    for (let match; (match = re.exec(pkg));) {
        keys.add(match[1]);
    }

    return [...keys].sort();
}

test('all runtime locales contain the same keys as English', () => {
    const localeDir = path.join(process.cwd(), 'src', 'i18n', 'locales');
    const english = readJson(path.join(localeDir, 'en.json'));
    const englishKeys = Object.keys(english).sort();

    for (const locale of locales) {
        const messages = readJson(path.join(localeDir, `${locale}.json`));
        assert.deepStrictEqual(Object.keys(messages).sort(), englishKeys, `${locale} keys should match English`);
    }
});

test('generated package.nls files contain every package manifest key', () => {
    const keys = collectPackageNlsKeys();
    const files = [
        'package.nls.json',
        ...locales.filter(locale => locale !== 'en').map(locale => `package.nls.${locale}.json`)
    ];

    for (const file of files) {
        const messages = readJson(path.join(process.cwd(), file));
        assert.deepStrictEqual(Object.keys(messages).sort(), keys, `${file} should contain package NLS keys`);
    }
});
