const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = signatureHeader.split(';').reduce<Record<string, string[]>>((result, part) => {
    const separator = part.indexOf('=');
    if (separator === -1) return result;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    (result[key] ??= []).push(value);
    return result;
  }, {});

  const timestamp = Number(parts.ts?.[0]);
  const signatures = parts.h1 ?? [];
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  // Paddle's SDK uses five seconds. Thirty seconds keeps replay protection while
  // allowing for edge cold starts and minor clock skew.
  if (Math.abs(nowSeconds - timestamp) > 30) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}:${rawBody}`),
  );
  const expected = bytesToHex(new Uint8Array(signature));

  return signatures.some((candidate) => timingSafeEqual(expected, candidate));
}
