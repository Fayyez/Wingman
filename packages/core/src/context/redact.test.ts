import { describe, expect, it } from 'vitest';
import { redact } from './redact';

const changes: [string, string][] = [
  ['call me on +92 300 1234567 ok', 'call me on <PHONE> ok'],
  ['+923001234567', '<PHONE>'],
  ['0300-1234567 hai mera number', '<PHONE> hai mera number'],
  ['03001234567', '<PHONE>'],
  ['0092 321 7654321', '<PHONE>'],
  ['+91 98765 43210 pe call kar', '<PHONE> pe call kar'],
  ['9876543210', '<PHONE>'],
  ['98765 43210', '<PHONE>'],
  ['mera number hai 9123456789 yaar', 'mera number hai <PHONE> yaar'],
  ['+44 7911 123456', '<PHONE>'],
  ['+1 (415) 555-2671', '<PHONE>'],
  ['+971 50 123 4567 is my UAE no', '<PHONE> is my UAE no'],
  ['mail me ayesha.k_92@gmail.com please', 'mail me <EMAIL> please'],
  ['x@y.co.uk', '<EMAIL>'],
  ['CNIC 35202-1234567-1 hai', 'CNIC <ID> hai'],
  ['35202-1234567-1', '<ID>'],
  ['aadhaar 2345 6789 0123 hai', 'aadhaar <ID> hai'],
  ['PAN ABCDE1234F bhej diya', 'PAN <ID> bhej diya'],
  ['https://example.com/reset?token=abc123 dekh', '<URL> dekh'],
  ['check https://insta.com/p/xyz?igsh=MzRlODBiNWFlZA==', 'check <URL>'],
  ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view', '<URL>'],
  ['dekho (https://a.com/x?y=1).', 'dekho (<URL>).'],
  ['www.site.com/login?u=1', '<URL>'],
  ['bhai 03451234567 aur ayesha@mail.com dono note kar lo', 'bhai <PHONE> aur <EMAIL> dono note kar lo'],
];

const unchanged: string[] = [
  'kesa gaya din?',
  'thak gai hun yaar viva ki tension hai',
  'aaj raat 10:30 baje milte hain',
  'meeting at 10:30pm',
  '2026-11-01',
  '4 Nov ko viva hai',
  '12/05/2024',
  'Rs 500 de dena',
  'Rs. 1,500 ka tha',
  'price 25000 hai',
  '₹999 only',
  '$20 bhej do',
  'mujhe 3 din lagenge',
  'room 204 mein aa jao',
  '100 percent sure hun',
  '😂😂 kya baat hai 🔥',
  '❤️❤️',
  'kal 5 baje, phir 7 baje',
  '2024 2025 2026',
  'https://youtube.com',
  'https://example.com/about',
  'ok.',
  'tum kahan ho? main 15 min mein aata hun',
  'Mera roll no 12345 hai',
  'ABCDE ke baad 1234 likho',
  'a@b',
  'tareekh 01-11-2026 hai',
  '1234567',
  'Aaj ka score 3-2 raha',
  'तुम कहाँ हो? मैं 10 मिनट में आता हूँ',
  'kya haal hai, kuch bana? 🙂',
];

describe('redact', () => {
  it.each(changes)('redacts: %s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });
  it.each(unchanged)('leaves unchanged: %s', (input) => {
    expect(redact(input)).toBe(input);
  });
  it('handles empty string', () => {
    expect(redact('')).toBe('');
  });
  it('is idempotent', () => {
    const once = redact('call +92 300 1234567 or a@b.com');
    expect(redact(once)).toBe(once);
  });
});
