// §8.8: attachment storage. Files are written to disk immediately on
// upload (before they're attached to any submission) and referenced by
// fileId from then on — the "orphan sweep" exists because that upload
// can outlive the form the user abandoned without saving.

import { ObjectId } from 'mongodb';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../db/connection.js';
import { env } from '../config/env.js';
import { HttpError } from '../lib/httpError.js';
import { checkMagicBytes } from '../domain/fileValidation.js';

// Never accepted, regardless of what a field's own `accept` list says.
const DANGEROUS_EXT = ['exe', 'bat', 'sh', 'js', 'html', 'htm', 'svg', 'zip', 'rar', 'com', 'cmd', 'msi'];

function collection() {
  return getDb().collection('files');
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'ไม่พบไฟล์');
  return new ObjectId(id);
}

export async function saveUploadedFile({ buffer, originalName, uploadedBy, allowedExts }) {
  const ext = path.extname(originalName).replace(/^\./, '').toLowerCase();
  if (!ext) throw new HttpError(400, 'ไฟล์ต้องมีนามสกุล');
  if (DANGEROUS_EXT.includes(ext)) throw new HttpError(400, `ไม่รับไฟล์ประเภท .${ext}`);
  if (allowedExts && !allowedExts.includes(ext)) {
    throw new HttpError(400, `รับเฉพาะไฟล์ประเภท: ${allowedExts.join(', ')}`);
  }
  if (buffer.length > env.maxFileMb * 1024 * 1024) {
    throw new HttpError(400, `ไฟล์ต้องไม่เกิน ${env.maxFileMb} MB`);
  }
  if (!checkMagicBytes(buffer, ext)) {
    throw new HttpError(400, 'เนื้อไฟล์ไม่ตรงกับนามสกุลที่แจ้ง');
  }

  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const relDir = path.join(yyyy, mm);
  const absDir = path.join(env.uploadDir, relDir);
  await fs.mkdir(absDir, { recursive: true });
  const diskName = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(absDir, diskName), buffer);

  const doc = {
    originalName,
    size: buffer.length,
    mime: mimeFor(ext),
    ext,
    path: path.join(relDir, diskName),
    uploadedBy,
    uploadedAt: now,
    submissionId: null,
    elementId: null,
  };
  const { insertedId } = await collection().insertOne(doc);
  return { fileId: insertedId.toString(), name: originalName, size: buffer.length, mime: doc.mime };
}

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
  txt: 'text/plain',
};
function mimeFor(ext) {
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

// Called from submissions.js when saving/submitting a `file`-type field's
// value: turns a client-supplied list of fileIds into resolved, permission
// -checked metadata, and marks each file as belonging to this submission.
export async function attachFilesToSubmission(fileIds, { submissionId, elementId, empId }) {
  if (fileIds.length === 0) return [];
  const ids = fileIds.map(toObjectId);
  const docs = await collection().find({ _id: { $in: ids } }).toArray();
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));

  const resolved = [];
  for (const fileId of fileIds) {
    const doc = byId.get(fileId);
    if (!doc) throw new HttpError(400, 'ไม่พบไฟล์ที่แนบ (อาจถูกลบไปแล้ว)');
    const alreadyMine = doc.submissionId === submissionId || doc.uploadedBy === empId;
    if (!alreadyMine) throw new HttpError(403, 'ไม่มีสิทธิ์ใช้ไฟล์นี้');
    resolved.push(doc);
  }

  await collection().updateMany(
    { _id: { $in: ids } },
    { $set: { submissionId, elementId } },
  );

  return resolved.map((d) => ({ fileId: d._id.toString(), name: d.originalName, size: d.size, mime: d.mime }));
}

// Permission check duplicated (small) rather than importing submissions.js,
// to avoid a models/files.js <-> models/submissions.js import cycle.
async function canAccessFile(doc, empId) {
  if (!doc.submissionId) return doc.uploadedBy === empId;
  const submission = await getDb().collection('submissions').findOne({ _id: toObjectId(doc.submissionId) });
  if (!submission) return false;
  if (submission.submitter.emp_id === empId) return true;
  return (submission.rounds ?? []).some((round) =>
    (round.steps ?? []).some((step) => step.approvers.some((a) => a.emp_id === empId)),
  );
}

export async function getFileForDownload(fileId, empId) {
  const doc = await collection().findOne({ _id: toObjectId(fileId) });
  if (!doc) throw new HttpError(404, 'ไม่พบไฟล์');
  if (!(await canAccessFile(doc, empId))) throw new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้');
  return doc;
}

export function absolutePathFor(doc) {
  return path.join(env.uploadDir, doc.path);
}

// §8.8: only while the submission is still a draft, and only the uploader.
export async function deleteFile(fileId, empId) {
  const doc = await collection().findOne({ _id: toObjectId(fileId) });
  if (!doc) return;
  if (doc.uploadedBy !== empId) throw new HttpError(403, 'ไม่มีสิทธิ์ลบไฟล์นี้');
  if (doc.submissionId) {
    const submission = await getDb().collection('submissions').findOne({ _id: toObjectId(doc.submissionId) });
    if (submission && submission.status !== 'draft') {
      throw new HttpError(409, 'ลบไฟล์ได้เฉพาะตอนคำร้องยังเป็นร่าง');
    }
  }
  await fs.unlink(absolutePathFor(doc)).catch(() => {});
  await collection().deleteOne({ _id: doc._id });
}

// Daily job (§8.8): disk files with no submission after 24h are cleaned up.
export async function sweepOrphanFiles() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const orphans = await collection().find({ submissionId: null, uploadedAt: { $lt: cutoff } }).toArray();
  for (const doc of orphans) {
    await fs.unlink(absolutePathFor(doc)).catch(() => {});
    await collection().deleteOne({ _id: doc._id });
  }
  return orphans.length;
}
