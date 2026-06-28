import assert from 'assert';
import path from 'path';
import test from 'node:test';
import { I18nManager, normalizeLocale, resolveSupportedLocale } from '../i18n/I18nManager';

test('normalizeLocale lowercases and normalizes separators', () => {
    assert.strictEqual(normalizeLocale('JA_JP'), 'ja-jp');
});

test('resolveSupportedLocale handles direct and regional locales', () => {
    assert.strictEqual(resolveSupportedLocale('ja-JP'), 'ja');
    assert.strictEqual(resolveSupportedLocale('en-US'), 'en');
    assert.strictEqual(resolveSupportedLocale('pt-PT'), 'pt-br');
});

test('resolveSupportedLocale maps Chinese variants', () => {
    assert.strictEqual(resolveSupportedLocale('zh-Hant-TW'), 'zh-tw');
    assert.strictEqual(resolveSupportedLocale('zh-Hans-CN'), 'zh-cn');
    assert.strictEqual(resolveSupportedLocale('zh'), 'zh-cn');
});

test('resolveSupportedLocale returns null for unsupported locales', () => {
    assert.strictEqual(resolveSupportedLocale('nl-NL'), null);
});

test('I18nManager loads locale messages and substitutes params', () => {
    const localesDir = path.join(process.cwd(), 'out', 'i18n', 'locales');
    const i18n = new I18nManager(localesDir);

    i18n.initialize('ja-JP');

    assert.strictEqual(i18n.getCurrentLocale(), 'ja');
    assert.strictEqual(i18n.t('paste.title'), '画像をassetsに貼り付け');
    assert.strictEqual(i18n.t('missing.key'), 'missing.key');
});
