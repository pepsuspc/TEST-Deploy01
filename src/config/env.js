// Loads and validates process.env. Throws with a clear message listing every
// problem at once, instead of dying on the first missing var one at a time.
//
// §3.4 of docs/requirement.md: "ระบบต้อง fail ตอน start พร้อมข้อความชัดเจนถ้า
// ตัวแปรจำเป็นหาย ไม่ใช่พังทีหลังตอนมีคนกดปุ่ม" — fail at start, not later.

function loadEnv() {
  const problems = [];
  const env = process.env;

  function str(name, { required = true } = {}) {
    const value = env[name];
    if (required && (value === undefined || value === '')) {
      problems.push(`${name} is missing`);
      return undefined;
    }
    return value;
  }

  function oneOf(name, allowed) {
    const value = str(name);
    if (value !== undefined && !allowed.includes(value)) {
      problems.push(`${name}="${value}" must be one of: ${allowed.join(', ')}`);
    }
    return value;
  }

  function int(name, { min } = {}) {
    const raw = str(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || (min !== undefined && value < min)) {
      problems.push(`${name}="${raw}" must be an integer${min !== undefined ? ` >= ${min}` : ''}`);
      return undefined;
    }
    return value;
  }

  const appUrl = str('APP_URL');
  const port = int('PORT', { min: 1 });
  const mongodbUri = str('MONGODB_URI');
  const sessionSecret = str('SESSION_SECRET');
  if (sessionSecret && sessionSecret.length < 32) {
    problems.push('SESSION_SECRET must be at least 32 characters long');
  }
  const sellcenterUrl = str('SELLCENTER_URL');
  const authMode = oneOf('AUTH_MODE', ['sso', 'mock']);
  const orgApiMock = env.ORG_API_MOCK === '1';
  const orgApiToken = str('ORG_API_TOKEN', { required: !orgApiMock });
  const adminEmpIds = str('ADMIN_EMP_IDS');
  const uploadDir = str('UPLOAD_DIR');
  const maxFileMb = int('MAX_FILE_MB', { min: 1 });
  const mailMode = oneOf('MAIL_MODE', ['smtp', 'console']);
  if (mailMode === 'smtp') {
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
      str(name);
    }
  }
  const tz = str('TZ');

  if (problems.length > 0) {
    const message = [
      'its-forms cannot start: .env is missing or invalid.',
      ...problems.map((p) => `  - ${p}`),
      'Copy .env.example to .env and fill in the missing values.',
    ].join('\n');
    throw new Error(message);
  }

  return {
    appUrl,
    port,
    mongodbUri,
    sessionSecret,
    sellcenterUrl,
    authMode,
    orgApiMock,
    orgApiToken,
    adminEmpIds: adminEmpIds.split(',').map((s) => s.trim()).filter(Boolean),
    uploadDir,
    maxFileMb,
    mailMode,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    },
    tz,
  };
}

export const env = loadEnv();
