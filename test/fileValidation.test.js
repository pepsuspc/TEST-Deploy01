import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMagicBytes } from '../src/domain/fileValidation.js';

test('pdf: real %PDF header passes, other content fails', () => {
  assert.equal(checkMagicBytes(Buffer.from('%PDF-1.4 blah'), 'pdf'), true);
  assert.equal(checkMagicBytes(Buffer.from('MZ\x90\x00 this is actually an exe'), 'pdf'), false);
});

test('jpg: FF D8 FF header passes, plain text does not', () => {
  assert.equal(checkMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'jpg'), true);
  assert.equal(checkMagicBytes(Buffer.from('not a jpeg'), 'jpg'), false);
});

test('an .exe renamed to .pdf is caught by magic bytes, not the extension', () => {
  const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // "MZ..." real PE header
  assert.equal(checkMagicBytes(exeHeader, 'pdf'), false);
});

test('webp: RIFF....WEBP header required', () => {
  const good = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  assert.equal(checkMagicBytes(good, 'webp'), true);
  assert.equal(checkMagicBytes(Buffer.from('not webp at all'), 'webp'), false);
});

test('csv/txt have no magic-byte check (plain text has no universal signature)', () => {
  assert.equal(checkMagicBytes(Buffer.from('a,b,c\n1,2,3'), 'csv'), true);
  assert.equal(checkMagicBytes(Buffer.from('hello world'), 'txt'), true);
});
