import crypto from 'crypto';

function genHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function genBase64(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64');
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

const hex32 = genHex(32);
const b6432 = genBase64(32);

console.log('ENCRYPTION_SECRET candidates:');
console.log(pad('hex32:', 10) + hex32);
console.log(pad('base64:', 10) + b6432);
console.log('Choose one and set ENCRYPTION_SECRET in your .env');
