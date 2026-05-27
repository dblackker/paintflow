import { generateKeyPairSync } from 'node:crypto';

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});

const publicJwk = publicKey.export({ format: 'jwk' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const x = Buffer.from(publicJwk.x, 'base64url');
const y = Buffer.from(publicJwk.y, 'base64url');
const vapidPublicKey = base64Url(Buffer.concat([Buffer.from([0x04]), x, y]));

if (process.argv.includes('--public-only')) {
  console.log(vapidPublicKey);
  process.exit(0);
}

console.log('VAPID_PUBLIC_KEY=');
console.log(vapidPublicKey);
console.log('');
console.log('VAPID_PRIVATE_KEY=');
console.log(privatePem);
console.log('Set VAPID_PRIVATE_KEY as a Worker secret. Do not commit it.');
