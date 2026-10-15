// Turns thrown errors into JSON responses. Internal details are logged, never sent.

// Connection, authentication, and TLS failures between the app and its database.
const DB_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  '28P01',
  '28000',
  '3D000',
  'XX000',
]);
function isDatabaseUnavailable(err) {
  return (
    DB_ERROR_CODES.has(err.code) || /certificate|self.signed|PEM|Connection terminated|timeout exceeded/i.test(err.message || '')
  );
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'The request could not be read.' });
  }
  if (err.expose && err.status) return res.status(err.status).json({ error: err.message });
  if (isDatabaseUnavailable(err)) {
    console.error(`[error] database unavailable on ${req.method} ${req.path}`, err);
    return res
      .status(503)
      .json({ error: 'We could not reach our database just now, so nothing was saved. Please try again in a few minutes.' });
  }
  console.error(`[error] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
}
