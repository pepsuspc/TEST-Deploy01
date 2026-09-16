// §10.8 "หัวกระดาษ": named letterhead presets an admin manages, referenced
// by a form's `letterheadId` and rendered into the A4 page's header
// (§8.7). The logo is stored as a data: URI directly on the document
// rather than going through files.js/UPLOAD_DIR — it's a small,
// system-level asset with no submission to own it or sweep it as an
// orphan, so the extra machinery there would be pure overhead here.

import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { HttpError } from '../lib/httpError.js';
import { checkMagicBytes } from '../domain/fileValidation.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function collection() {
  return getDb().collection('letterheads');
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'ไม่พบหัวกระดาษ');
  return new ObjectId(id);
}

export function listLetterheads() {
  return collection().find({}).sort({ createdAt: 1 }).toArray();
}

export function getLetterheadById(id) {
  if (!id || !ObjectId.isValid(id)) return null;
  return collection().findOne({ _id: new ObjectId(id) });
}

export async function createLetterhead({ name, companyName, address, phone }) {
  const now = new Date();
  const doc = {
    name,
    companyName: companyName || '',
    address: address || '',
    phone: phone || '',
    logoDataUri: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await collection().insertOne(doc);
  return { ...doc, _id: insertedId };
}

export async function updateLetterhead(id, fields) {
  const set = { updatedAt: new Date() };
  for (const key of ['name', 'companyName', 'address', 'phone']) {
    if (fields[key] !== undefined) set[key] = fields[key];
  }
  await collection().updateOne({ _id: toObjectId(id) }, { $set: set });
  return getLetterheadById(id);
}

export async function setLetterheadEnabled(id, enabled) {
  await collection().updateOne({ _id: toObjectId(id) }, { $set: { enabled, updatedAt: new Date() } });
}

// Magic-byte-checked like an uploaded file (§8.8's rule applies here too —
// don't trust the browser's claimed mime type), just stored inline instead
// of on disk.
export async function setLetterheadLogo(id, buffer, mimeType) {
  const ext = LOGO_TYPES[mimeType];
  if (!ext) throw new HttpError(400, 'โลโก้ต้องเป็น PNG, JPG หรือ WEBP');
  if (buffer.length > MAX_LOGO_BYTES) throw new HttpError(400, 'โลโก้ต้องเล็กกว่า 2 MB');
  if (!checkMagicBytes(buffer, ext)) throw new HttpError(400, 'ไฟล์โลโก้ไม่ถูกต้อง');
  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
  await collection().updateOne({ _id: toObjectId(id) }, { $set: { logoDataUri: dataUri, updatedAt: new Date() } });
  return getLetterheadById(id);
}

export async function deleteLetterhead(id) {
  await collection().deleteOne({ _id: toObjectId(id) });
}
