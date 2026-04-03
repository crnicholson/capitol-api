'use strict';
require('dotenv').config();

const express = require('express');
const dataService = require('./dataService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/status — cache + fetch status
app.get('/api/status', (req, res) => {
  res.json(dataService.getStatus());
});

// POST /api/refresh — manually trigger a cache refresh
app.post('/api/refresh', (req, res) => {
  dataService.startFetch();
  res.json({ message: 'Cache refresh started.' });
});

/*
  GET /api/trades — main query endpoint
  All params are optional and combinable.

  FILTER params:
    state      — 2-letter state code             e.g. state=CA
    party      — party name or partial            e.g. party=Democrat
    person     — partial name match               e.g. person=Pelosi
    ticker     — exact ticker symbol              e.g. ticker=AAPL
    type       — transaction type code or category e.g. type=P  type=buy
    category   — buy|sell|exchange|gift|etc       e.g. category=sell
    from       — ISO date lower bound (trade date) e.g. from=2025-01-01
    to         — ISO date upper bound (trade date) e.g. to=2025-12-31

  SORT params:
    sort       — date|oldest|newest|amount|largest|name|ticker|filingdate (default: date/newest)
    order      — asc|desc  (default: desc for date/amount, asc for name/ticker)

  PAGINATION params:
    limit      — max results to return
    offset     — skip N results (for pagination)

  SHORTCUT params:
    recent=N   — returns N most recently *filed* trades (overrides sort/pagination)
*/
app.get('/api/trades', (req, res) => {
  try {
    const result = dataService.getTrades(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trades/download — download full dataset as JSON file
app.get('/api/trades/download', (req, res) => {
  try {
    const result = dataService.getTrades(req.query);
    res.setHeader('Content-Disposition', 'attachment; filename="trades.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found. See /api/trades and /api/status.' });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Capitol API listening on http://localhost:${PORT}`);
  console.log(`Years: ${process.env.YEARS_START || 2025}–${process.env.YEARS_END || 2026}`);
  dataService.initialize();
});
