function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildCacheKey(prefix: string, name: string, achievement: string): string {
  const namePart = slug(name);
  const achPart  = slug(achievement);
  const suffix   = '.png';
  const base     = `${prefix}${namePart}-${achPart}`;
  const full     = `${base}${suffix}`;

  if (full.length <= 512) {
    return full;
  }

  // Truncate achPart until key fits
  const maxAchLen = 512 - prefix.length - namePart.length - 1 - suffix.length;
  const truncated = achPart.slice(0, Math.max(0, maxAchLen));
  return `${prefix}${namePart}-${truncated}${suffix}`;
}

export async function getCached(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const result = await bucket.get(key);
  if (result === null) return null;
  return new Uint8Array(await result.arrayBuffer());
}

export async function putCached(bucket: R2Bucket, key: string, png: Uint8Array): Promise<void> {
  await bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } });
}
