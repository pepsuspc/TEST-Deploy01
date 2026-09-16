import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { saveUploadedFile, getFileForDownload, absolutePathFor, deleteFile } from '../models/files.js';
import { getSubmissionById, elementsFor } from '../models/submissions.js';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';

// Memory storage: files.js decides the final disk path itself (after
// validation passes) rather than trusting multer's own disk storage to
// land bytes before we've even checked them.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFileMb * 1024 * 1024 + 1024 }, // + slack so our own MB-exact check gives the real message
});

export const filesRouter = Router();

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// §15 test 18 (a Thai filename with spaces must round-trip unchanged):
// multer's underlying multipart parser (busboy) decodes every part header
// — including the filename — as Latin-1 by default, per the old RFC 2388.
// Real browsers (and curl, and Node's own fetch/FormData) all send the
// filename as raw UTF-8 bytes now, so a name like "ทดสอบ ไฟล์.pdf" arrives
// byte-for-byte correct but gets *misread* one byte at a time as Latin-1,
// producing mojibake ("à¸..."). Found live: a fresh-clone walkthrough
// downloaded a file and got back a name that was neither the original nor
// obviously broken-looking in a raw HTTP response — decoding the actual
// stored bytes was what showed it was corrupted, not the download step.
// Re-decoding here (Latin-1 bytes -> UTF-8 text) undoes exactly that
// mis-decode; it's a no-op for a pure-ASCII filename either way.
export function fixMultipartFilename(name) {
  return Buffer.from(name, 'latin1').toString('utf8');
}

// §8.8 upload flow: one file per request, immediately on selection —
// not deferred to when the form itself is saved.
filesRouter.post(
  '/upload',
  (req, res, next) => upload.single('file')(req, res, (err) => (err ? next(mapMulterError(err)) : next())),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'ไม่มีไฟล์');
    const { submissionId, elementId } = req.body;
    let allowedExts = null;
    if (submissionId && elementId) {
      const submission = await getSubmissionById(submissionId).catch(() => null);
      if (submission) {
        const els = await elementsFor(submission);
        const el = els.find((e) => e.id === elementId);
        if (el?.type === 'file') allowedExts = el.props.accept;
      }
    }
    const result = await saveUploadedFile({
      buffer: req.file.buffer,
      originalName: fixMultipartFilename(req.file.originalname),
      uploadedBy: req.user.emp_id,
      allowedExts,
    });
    res.json(result);
  }),
);

function mapMulterError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return new HttpError(400, `ไฟล์ต้องไม่เกิน ${env.maxFileMb} MB`);
  return new HttpError(400, 'อัปโหลดไม่สำเร็จ');
}

// §8.8: only through this route — never serve UPLOAD_DIR as static files.
filesRouter.get(
  '/:fileId',
  asyncHandler(async (req, res) => {
    const doc = await getFileForDownload(req.params.fileId, req.user.emp_id);
    const encoded = encodeURIComponent(doc.originalName);
    const disposition = doc.mime.startsWith('image/') ? 'inline' : 'attachment';
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encoded}`);
    fs.createReadStream(absolutePathFor(doc)).pipe(res);
  }),
);

filesRouter.post(
  '/:fileId/delete',
  asyncHandler(async (req, res) => {
    await deleteFile(req.params.fileId, req.user.emp_id);
    res.json({ ok: true });
  }),
);
