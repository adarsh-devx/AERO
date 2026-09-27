/**
 * Utility to extract a safe, sanitized host name from an audio URI.
 * Strictly prevents leaking query parameters, auth tokens, signatures, or local directory paths.
 */
export function sanitizeStreamHost(uri: string): string {
  if (!uri || typeof uri !== 'string') {
    return 'Unknown';
  }

  const trimmed = uri.trim();
  if (trimmed.startsWith('content://')) {
    return 'Android MediaStore';
  }

  if (trimmed.startsWith('file://') || trimmed.startsWith('/')) {
    return 'Local Storage';
  }

  try {
    const match = /^https?:\/\/([^/?#:]+)(?::(\d+))?/i.exec(trimmed);
    if (match && match[1]) {
      const hostname = match[1];
      const port = match[2] ? `:${match[2]}` : '';
      return `${hostname}${port}`;
    }
  } catch {
    // Fall through to fallback
  }

  return 'Remote Stream';
}
