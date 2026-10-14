// Turns thrown errors into JSON responses. Internal details are logged, never sent.

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'The request could not be read.' });
  }
  if (err.expose && err.status) return res.status(err.status).json({ error: err.message });
  console.error(`[error] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
}
