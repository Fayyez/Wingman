/** Client-side PII redaction applied before text leaves the device (03 §5.1 step 3). */

const URL_RE = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const CNIC_RE = /(?<!\d)\d{5}-\d{7}-\d(?!\d)/g;
const AADHAAR_RE = /(?<![\d-])[2-9]\d{3}[ ]\d{4}[ ]\d{4}(?![\d-])/g;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

const PK_INTL = /(?<![\w+])(?:\+|00)92[\s-]?\(?0?\)?3\d{2}[\s-]?\d{7}(?!\d)/g;
const PK_LOCAL = /(?<![\w+])03\d{2}[\s-]?\d{7}(?!\d)/g;
const IN_INTL = /(?<![\w+])(?:\+|00)91[\s-]?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const IN_LOCAL = /(?<![\w+])(?:0?[6-9]\d{4}[\s-]\d{5}|0?[6-9]\d{9})(?![\d])/g;
const GENERIC_INTL = /(?<![\w+])\+\d[\d\s().-]{7,18}\d(?!\d)/g;

function isSensitiveUrl(url: string): boolean {
  const stripped = url.replace(/[.,!?)\]]+$/, '');
  if (/[?#]/.test(stripped)) return true;
  // long opaque path segment => likely a token / private link
  return stripped.split('/').some((seg) => /^[A-Za-z0-9_-]{24,}$/.test(seg));
}

export function redact(text: string): string {
  if (!text) return text;
  let out = text.replace(URL_RE, (m) => {
    if (!isSensitiveUrl(m)) return m;
    const trail = /[.,!?)\]]+$/.exec(m)?.[0] ?? '';
    return '<URL>' + trail;
  });
  if (out.includes('@')) out = out.replace(EMAIL_RE, '<EMAIL>'); // guard: the regex is quadratic on long words
  out = out.replace(CNIC_RE, '<ID>');
  out = out.replace(AADHAAR_RE, (m) => (/^(19|20)\d\d /.test(m) ? m : '<ID>'));
  out = out.replace(PAN_RE, '<ID>');
  out = out.replace(PK_INTL, '<PHONE>').replace(PK_LOCAL, '<PHONE>');
  out = out.replace(IN_INTL, '<PHONE>').replace(IN_LOCAL, '<PHONE>');
  out = out.replace(GENERIC_INTL, (m) => {
    const digits = m.replace(/\D/g, '').length;
    return digits >= 8 && digits <= 15 ? '<PHONE>' : m;
  });
  return out;
}
