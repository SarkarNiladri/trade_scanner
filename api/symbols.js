import { SYMBOLS_100 } from './_lib/data.js';

export default function handler(req, res) {
  res.status(200).json({ symbols: SYMBOLS_100 });
}