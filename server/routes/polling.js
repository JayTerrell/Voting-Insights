import { Router } from 'express';
import * as polling from '../services/polling.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { cleanText, ValidationError } from '../lib/validation.js';

const MINUTES_15 = 15 * 60 * 1000;
export const pollingRoutes = Router();

function readAddress(req) {
  const address = cleanText(req.query.address, 200);
  if (address.length < 5) throw new ValidationError('Please enter a street address, city, and ZIP code.');
  return address;
}

pollingRoutes.get('/geocode', rateLimit('geocode', 60, MINUTES_15), async (req, res) => {
  const hit = await polling.geocode(readAddress(req)).catch(() => null);
  if (!hit) return res.status(404).json({ error: 'We could not find that address. Check the street, city, and ZIP code.' });
  res.json(hit);
});

// The county a point falls in. Coordinates are used once and never stored.
pollingRoutes.get('/county', rateLimit('county', 60, MINUTES_15), async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'A location is needed.' });
  }
  const hit = await polling.countyAt(lat, lng).catch(() => null);
  if (!hit) return res.status(404).json({ error: 'We could not tell which county that is in.' });
  res.json(hit);
});

pollingRoutes.get('/polling/lookup', rateLimit('polling-lookup', 30, MINUTES_15), async (req, res) => {
  if (!polling.civicConfigured()) return res.status(503).json({ error: 'Address lookup is not available yet.' });
  try {
    res.json(await polling.lookup(readAddress(req)));
  } catch (err) {
    console.error('[polling] lookup failed:', err.message);
    res.status(502).json({ error: 'The polling place lookup is not responding. Please use your county link instead.' });
  }
});
