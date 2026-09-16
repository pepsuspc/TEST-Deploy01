import test from 'node:test';
import assert from 'node:assert/strict';
import { fixMultipartFilename } from '../src/routes/files.routes.js';

// §15 test 18: busboy (multer's underlying parser) decodes multipart part
// headers as Latin-1 by default, so a UTF-8 filename arrives byte-correct
// but misread one byte at a time. Found live via a real curl/fetch upload
// during the final chunk-4 walkthrough — this reproduces that exact
// mojibake from the raw bytes rather than typing Thai text through a
// terminal (which can itself mangle the invisible control-range bytes
// that a Latin-1 misread of Thai UTF-8 produces).
test('fixMultipartFilename: undoes a Latin-1 misread of a UTF-8 Thai filename with spaces', () => {
  const original = 'ทดสอบ ไฟล์ แนบ.pdf';
  const mojibake = Buffer.from(original, 'utf8').toString('latin1');
  assert.equal(fixMultipartFilename(mojibake), original);
});

test('fixMultipartFilename: is a no-op for a pure-ASCII filename', () => {
  assert.equal(fixMultipartFilename('quarterly-report.pdf'), 'quarterly-report.pdf');
});

test('fixMultipartFilename: handles a filename with both Thai and ASCII', () => {
  const original = 'MEMO-2569-ใบขออนุมัติ (final) v2.pdf';
  const mojibake = Buffer.from(original, 'utf8').toString('latin1');
  assert.equal(fixMultipartFilename(mojibake), original);
});
