// §8.8: "ตรวจทั้งนามสกุลและ magic bytes ... ไม่เชื่อ Content-Type ที่ client
// ส่ง". A renamed .exe claiming to be .pdf must fail here even though its
// extension and even a spoofed Content-Type header both look fine.

const SIGNATURES = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  gif: [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  // xlsx/docx are zip containers (OOXML); xls/doc are legacy OLE compound
  // files. Neither format distinguishes further by magic bytes alone —
  // deeper structural validation is out of scope here.
  xlsx: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]],
  docx: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  doc: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

function startsWithAny(buffer, signatures) {
  return signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}

export function checkMagicBytes(buffer, ext) {
  if (ext === 'webp') return checkWebp(buffer);
  const sigs = SIGNATURES[ext];
  if (!sigs) return true; // csv/txt: no reliable magic number for plain text
  return startsWithAny(buffer, sigs);
}

function checkWebp(buffer) {
  if (buffer.length < 12) return false;
  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');
  return riff === 'RIFF' && webp === 'WEBP';
}
