export function invoiceFileType(bytes: Uint8Array): 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
