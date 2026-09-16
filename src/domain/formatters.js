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

// §12.3: safely embed a data object into an inline `<script>` block.
// Plain `JSON.stringify` does NOT escape `<`, so a user-entered string
// containing e.g. a form element label of `</script><script>alert(1)` (set
// through the designer, then viewed by anyone who opens that form) would
// close the real script tag early and inject a new one. Every view that
// bootstraps client-side JS with `<%- JSON.stringify(x) %>` uses this
// instead — the `<` escape is invisible to JSON.parse but stops the
// HTML parser from ever seeing a literal `<`.
export function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
