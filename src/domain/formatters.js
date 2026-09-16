// Small display-only formatters shared across views.

// §3.6: "ตัวเลขเงินแสดง 1,234.50" — comma thousands separator, fixed
// decimal places.
export function formatNumber(value, decimals = 0) {
  const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
