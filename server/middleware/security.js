// Security headers for every response. Scripts may only load from this site;
// inline style attributes are allowed because the result bars set their width inline.

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Map images come from Stadia Maps on the Where to Vote page.
  "img-src 'self' data: https://tiles.stadiamaps.com",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Location is allowed on this site only, for sorting polling places by distance.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function securityHeaders(req, res, next) {
  res.set(SECURITY_HEADERS);
  next();
}

// API responses carry personal data and must never be cached by shared caches.
export function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}
