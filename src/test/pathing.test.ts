import assert from 'assert';
import test from 'node:test';
import {
    buildAssetRelativePath,
    buildMarkdownImageSnippet,
    buildMarkdownImageText,
    bytesToHex,
    createRandomPngFileName,
    pickUniquePngFileName,
    UniqueFileNameError
} from '../pathing';

test('bytesToHex formats bytes as lowercase two-character hex', () => {
    assert.strictEqual(bytesToHex(new Uint8Array([0, 1, 15, 16, 255])), '00010f10ff');
});

test('createRandomPngFileName uses 8 random bytes and png extension', () => {
    const fileName = createRandomPngFileName(size => {
        assert.strictEqual(size, 8);
        return new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    assert.strictEqual(fileName, '0001020304050607.png');
});

test('buildAssetRelativePath always uses markdown-friendly posix separators', () => {
    assert.strictEqual(buildAssetRelativePath('abc.png'), 'assets/abc.png');
});

test('buildMarkdownImageText creates the final markdown text', () => {
    assert.strictEqual(buildMarkdownImageText('assets/abc.png'), '![image](assets/abc.png)');
});

test('buildMarkdownImageSnippet selects alt text after paste', () => {
    assert.strictEqual(buildMarkdownImageSnippet('assets/abc.png'), '![${1:image}](assets/abc.png)');
});

test('pickUniquePngFileName retries collisions', async () => {
    const candidates = ['first.png', 'second.png'];
    const fileName = await pickUniquePngFileName(
        name => name === 'first.png',
        () => candidates.shift() ?? 'unexpected.png'
    );

    assert.strictEqual(fileName, 'second.png');
});

test('pickUniquePngFileName throws after max attempts', async () => {
    await assert.rejects(
        () => pickUniquePngFileName(() => true, () => 'same.png', 2),
        UniqueFileNameError
    );
});
