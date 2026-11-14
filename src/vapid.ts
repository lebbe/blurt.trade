import { createECDH, generateKeyPairSync } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// The VAPID key pair that signs our pushes (src/push.ts): checks and making one. On its
// own, with node:crypto only, so src/config.ts can check the keys without loading the app.

const base64url = /^[A-Za-z0-9_-]+$/

// The problem with the key pair, if any (src/config.ts reports it at startup).
export function vapidProblem(publicKey: string, privateKey: string): string | undefined {
  if (!base64url.test(publicKey) || !base64url.test(privateKey)) {
    return 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be base64url (npm run vapid-keys)'
  }
  const pub = Buffer.from(publicKey, 'base64url')
  const priv = Buffer.from(privateKey, 'base64url')
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) {
    return 'VAPID_PUBLIC_KEY must be an uncompressed P-256 point (65 bytes) and VAPID_PRIVATE_KEY 32 bytes (npm run vapid-keys)'
  }
  const ecdh = createECDH('prime256v1')
  try {
    ecdh.setPrivateKey(priv)
  } catch {
    return 'VAPID_PRIVATE_KEY is not a valid P-256 private key'
  }
  if (!ecdh.getPublicKey().equals(pub)) {
    return 'VAPID_PUBLIC_KEY is not the public key of VAPID_PRIVATE_KEY'
  }
  return undefined
}

// A fresh pair, for VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = privateKey.export({ format: 'jwk' })
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x as string, 'base64url'),
    Buffer.from(jwk.y as string, 'base64url'),
  ])
  return { publicKey: point.toString('base64url'), privateKey: jwk.d as string }
}

// `npm run vapid-keys`: prints a new key pair for the env file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { publicKey, privateKey } = generateVapidKeys()
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`)
}
