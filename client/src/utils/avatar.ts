/**
 * Converts a stored avatar value (raw base64 or data URI) to a safe data URI src.
 * Strips all whitespace (including \r\n from base64 line-wrapping or PNG headers)
 * to prevent ERR_INVALID_URL when used as an <img src>.
 */
export function toAvatarSrc(data: string | null | undefined): string | null {
  if (!data) return null;
  const clean = data.replace(/\s/g, '');
  if (!clean) return null;
  if (clean.startsWith('data:')) return clean;
  return `data:image/jpeg;base64,${clean}`;
}
