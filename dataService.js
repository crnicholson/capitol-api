'use strict';
require('dotenv').config();

const axios = require('axios');
const AdmZip = require('adm-zip');
const xml2js = require('xml2js');
const pdfParse = require('pdf-parse');
// No yahoo-finance2 — use Yahoo Finance chart API directly via axios
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'trades.json');
const LEGISLATORS_FILE = path.join(CACHE_DIR, 'legislators.json');
const PROCESSED_FILE = path.join(CACHE_DIR, 'processed.json'); // tracks which docIds are done

const YEARS_START = parseInt(process.env.YEARS_START || '2025');
const YEARS_END = parseInt(process.env.YEARS_END || '2026');
const CACHE_REFRESH_HOURS = parseFloat(process.env.CACHE_REFRESH_HOURS || '0');
const FETCH_DELAY_MS = parseInt(process.env.FETCH_DELAY_MS || '500');
const PRICE_CONCURRENCY = parseInt(process.env.PRICE_CONCURRENCY || '3');

const BASE_URL = 'https://disclosures-clerk.house.gov/public_disc';
const LEGISLATORS_CURRENT_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const LEGISLATORS_HISTORICAL_URL = 'https://unitedstates.github.io/congress-legislators/legislators-historical.json';

// ─── State ─────────────────────────────────────────────────────────────────

let fetchStatus = { running: false, progress: '', error: null, startedAt: null };
let priceCache = {}; // in-memory: ticker+date -> price

// ─── Helpers ───────────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (_) {}
  return fallback;
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// Parse "$1,001 - $15,000" or "Over $5,000,000" into { min, max }
function parseAmountRange(str) {
  if (!str) return { min: null, max: null };
  str = str.replace(/,/g, '');
  const over = str.match(/[Oo]ver\s*\$?([\d]+)/);
  if (over) return { min: parseInt(over[1]), max: null };
  const range = str.match(/\$([\d]+)\s*-\s*\$([\d]+)/);
  if (range) return { min: parseInt(range[1]), max: parseInt(range[2]) };
  const single = str.match(/\$([\d]+)/);
  if (single) return { min: parseInt(single[1]), max: parseInt(single[1]) };
  return { min: null, max: null };
}

// Parse "MM/DD/YYYY" -> "YYYY-MM-DD"
function normalizeDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// ─── Asset Types (from tradetypes.csv) ─────────────────────────────────────

function loadAssetTypes() {
  const csvPath = path.join(__dirname, 'tradetypes.csv');
  const types = {};
  if (!fs.existsSync(csvPath)) return types;
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').slice(1); // skip header
  for (const line of lines) {
    if (!line.trim()) continue;
    // format: symbol,type  (type may contain commas, so only split on first)
    const idx = line.indexOf(',');
    if (idx < 0) continue;
    const symbol = line.slice(0, idx).trim();
    const type = line.slice(idx + 1).trim();
    types[symbol] = type;
  }
  return types;
}

// ─── Transaction Types (hardcoded — these never change) ─────────────────────
// These are the action codes that appear in the PTR PDF (P, S, E, etc.)

const TX_TYPES = {
  'P':           { description: 'Purchase',                              category: 'buy' },
  'S':           { description: 'Sale (Full)',                           category: 'sell' },
  'S (partial)': { description: 'Sale (Partial)',                        category: 'sell' },
  'E':           { description: 'Exchange',                              category: 'exchange' },
  'G':           { description: 'Gift',                                  category: 'gift' },
  'M':           { description: 'Merger / Acquisition',                  category: 'corporate_action' },
  'C':           { description: 'Conversion',                            category: 'corporate_action' },
  'T':           { description: 'Transfer',                              category: 'transfer' },
  'D':           { description: 'Dividend Reinvestment',                 category: 'dividend' },
  'W':           { description: 'Will / Inheritance / Trust Distribution', category: 'inheritance' },
  'HS':          { description: 'Hard Sale',                             category: 'sell' },
  'HE':          { description: 'Hard Exchange',                         category: 'exchange' },
  'HP':          { description: 'Hard Purchase',                         category: 'buy' },
  'O':           { description: 'Other',                                 category: 'other' },
};

let ASSET_TYPES = {};

// ─── Legislators ───────────────────────────────────────────────────────────

async function fetchLegislators() {
  fetchStatus.progress = 'Fetching legislators data...';
  console.log('[legislators] Downloading current + historical legislator data...');
  try {
    const [current, historical] = await Promise.all([
      axios.get(LEGISLATORS_CURRENT_URL, { timeout: 30000 }),
      axios.get(LEGISLATORS_HISTORICAL_URL, { timeout: 30000 }),
    ]);
    const combined = [...current.data, ...historical.data];
    ensureCacheDir();
    saveJson(LEGISLATORS_FILE, combined);
    console.log(`[legislators] Loaded ${current.data.length} current + ${historical.data.length} historical = ${combined.length} total`);
    return combined;
  } catch (err) {
    console.warn('[legislators] Fetch failed, using cached if available:', err.message);
    const cached = loadJson(LEGISLATORS_FILE, []);
    console.log(`[legislators] Using cached: ${cached.length} records`);
    return cached;
  }
}

function parseLegislatorState(stateDst) {
  if (!stateDst) return { state: null, district: null };
  const m = stateDst.match(/^([A-Z]{2})(\d+)?$/);
  if (!m) return { state: stateDst.slice(0, 2), district: null };
  return { state: m[1], district: m[2] ? parseInt(m[2]) : null };
}

function matchLegislator(legislators, firstName, lastName, stateDst) {
  if (!legislators || !legislators.length) return null;
  const { state, district } = parseLegislatorState(stateDst);
  const lastLower = (lastName || '').toLowerCase().trim();
  const firstLower = (firstName || '').toLowerCase().trim().split(/[\s.]+/)[0]; // first token

  // Score each legislator
  let best = null;
  let bestScore = 0;

  for (const leg of legislators) {
    const legLast = (leg.name.last || '').toLowerCase();
    const legFirst = (leg.name.first || '').toLowerCase().split(/[\s.]+/)[0];

    if (legLast !== lastLower) continue;

    let score = 1;
    if (legFirst === firstLower || legFirst.startsWith(firstLower) || firstLower.startsWith(legFirst)) score += 2;

    const terms = leg.terms || [];
    for (const t of terms) {
      if (t.state === state) {
        score += 1;
        if (district && t.district === district) score += 2;
        break;
      }
    }

    if (score > bestScore) { bestScore = score; best = leg; }
  }

  return bestScore >= 2 ? best : null;
}

function extractLegislatorInfo(leg, stateDst) {
  if (!leg) return null;
  const { state, district } = parseLegislatorState(stateDst);

  // Find most recent term with a phone number
  const terms = (leg.terms || []).slice().reverse();
  const latestTerm = terms[0] || {};
  const termWithPhone = terms.find(t => t.phone) || {};

  // Find party from most recent term
  const party = latestTerm.party || null;

  return {
    bioguideId: leg.id?.bioguide || null,
    name: leg.name?.official_full || `${leg.name?.first} ${leg.name?.last}`,
    firstName: leg.name?.first || null,
    lastName: leg.name?.last || null,
    state: state || latestTerm.state || null,
    district: district || latestTerm.district || null,
    party,
    phone: termWithPhone.phone || null,
    gender: leg.bio?.gender || null,
    birthday: leg.bio?.birthday || null,
    terms: leg.terms || [],
  };
}

// ─── PDF Parsing ────────────────────────────────────────────────────────────

async function downloadPdf(docId, year) {
  const url = `${BASE_URL}/ptr-pdfs/${year}/${docId}.pdf`;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(res.data);
  } catch (err) {
    if (err.response?.status === 404) return null; // not a PTR filing
    throw err;
  }
}

function parseTransactionsFromText(rawText, filingInfo) {
  // ── Real PTR PDF format (observed from actual downloads) ────────────────────
  //
  // BOTH old (2018-2021) and new (2022+) formats have CONCATENATED dates:
  //   DATE1DATE2  e.g.  01/02/201901/02/2019  or  03/16/202603/16/2026
  //
  // Old format (all on one line):
  //   DCAmazon.com, Inc. (AMZN) [ST]P01/02/201901/02/2019$1,001 - $15,000
  //   ↑ owner code glued to asset name, [TYPE]TX_TYPE no spaces
  //
  // New format (multi-line asset name):
  //   Amazon.com, Inc. - Common Stock     ← asset name line(s)
  //   (AMZN) [ST]                         ← ticker + type (sometimes same line as name)
  //   S (partial)03/16/202603/16/2026$1,001 - $15,000   ← data line
  //
  // Some PDFs encode the "FILING STATUS" / "SUB-HOLDING OF" labels with null bytes
  // between each letter (e.g. "F\x00I\x00L\x00I\x00N\x00G\x00 \x00S\x00T\x00A\x00T\x00U\x00S\x00:")
  // Stripping nulls first makes those lines readable and filterable.
  //
  // Strategy: work LINE BY LINE.
  //   1. Strip null bytes so metadata labels are legible
  //   2. Find "data lines" — lines containing TX_TYPE + DATE + DATE + $AMOUNT
  //   3. Scan backwards from each data line to collect asset name / type / owner

  const TX_RE = /^(.*?)(P|S\s*\(partial\)|HE|HS|HP|E|G|M|C|T|D|W|O|S)\s*(\d{1,2}\/\d{1,2}\/\d{4})(\d{1,2}\/\d{1,2}\/\d{4})\s*(\$[\d,]+(?:\s*-\s*\$[\d,]+)?|[Oo]ver\s*\$[\d,]+)(.*)$/;

  // Metadata / noise lines that appear between transactions in PTR PDFs.
  // After null-byte stripping, multi-byte labels collapse to e.g. "S O:" or "F S:" (single spaces).
  // Match both the null-stripped form and the original spaced form.
  const NOISE_RE = new RegExp(
    '^(' +
    'Filing\\s*ID' +
    '|F\\s+S\\s*:' +                    // "F S:" = FILING STATUS (null-stripped)
    '|FILINg\\s+STATUS' +
    '|S\\s+O\\s*:' +                    // "S O:" = SUB-HOLDING OF (null-stripped)
    '|SUbHoLDINg' +
    '|Sub.?Holding' +
    '|D\\s*:' +                         // "D:" = Description
    '|Description\\s*:' +
    '|L\\s*:' +                         // "L:" = Location (null-stripped)
    '|LoCATIoN' +
    '|Location\\s*:' +
    '|IDOwnerAsset' +
    '|gfedc' +
    '|nmlkj' +
    '|Gains\\s*>' +
    '|AmountCap' +
    '|DateNotif' +
    '|Initial\\s+Public' +
    '|Certification' +
    '|Clerk\\s+of' +
    '|Legislative\\s+Resource' +
    '|Digitally\\s+Signed' +
    '|Status:' +
    '|State\\/District' +
    ')',
    'i'
  );

  // Section-end markers — stop collecting lines past these
  const SECTION_END_RE = /aSSet\s+claSS|Asset\s+Class|initial\s+public\s+offer|certification\s+and\s+signature/i;

  // Strip null bytes — some PDFs encode label text (FILING STATUS, etc.) with
  // embedded nulls between every character. Stripping makes them match NOISE_RE.
  const lines = rawText.replace(/\x00/g, '').split('\n');
  const trades = [];
  let counter = 0;

  // Find the start of the transactions section
  let txStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/tranSactionS|^T\s+$|IDOwnerAsset/i.test(lines[i])) { txStartLine = i; break; }
  }

  // Find the end of the transactions section
  let txEndLine = lines.length;
  for (let i = txStartLine; i < lines.length; i++) {
    if (SECTION_END_RE.test(lines[i])) { txEndLine = i; break; }
  }

  const txLines = lines.slice(txStartLine, txEndLine);

  for (let i = 0; i < txLines.length; i++) {
    const line = txLines[i].trim();
    const m = TX_RE.exec(line);
    if (!m) continue;

    const [, prefix, rawTxType, rawTradeDate, rawNotifDate, rawAmount] = m;

    // ── Extract [ASSET_TYPE] and asset text ──────────────────────────────────
    // The asset type bracket [XX] is either on this line (in prefix) or on a prior line.

    let assetType = null;
    let assetTextParts = [];

    // Helper: a line is a "stop" — don't include it in asset name and don't scan past it
    const isStop = (l) => !l || NOISE_RE.test(l) || TX_RE.test(l) || /gfedc|nmlkj/.test(l) || /\$[\d,]/.test(l);

    // Does this line's prefix contain [ASSET_TYPE]?
    const bracketInPrefix = prefix.match(/^(.*)\[([A-Z]{2,4})\]\s*$/);
    if (bracketInPrefix) {
      assetType = bracketInPrefix[2];
      if (bracketInPrefix[1].trim()) assetTextParts.push(bracketInPrefix[1].trim());
    } else {
      // Look backward for a line containing [ASSET_TYPE], skipping noise lines
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const prev = txLines[j].trim();
        // If we hit a hard stop (prior tx data line, dollar amount, etc.) give up
        if (TX_RE.test(prev) || /\$[\d,]/.test(prev) || /gfedc/.test(prev)) break;
        // Skip noise lines (don't include, but keep scanning)
        if (!prev || NOISE_RE.test(prev)) continue;

        const bracketAtEnd = prev.match(/^(.*)\[([A-Z]{2,4})\]\s*$/);
        const bracketAlone = prev.match(/^\[([A-Z]{2,4})\]$/);
        const bracketInLine = prev.match(/\[([A-Z]{2,4})\]/);

        if (bracketAtEnd) {
          assetType = bracketAtEnd[2];
          if (bracketAtEnd[1].trim()) assetTextParts.unshift(bracketAtEnd[1].trim());
          for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
            const above = txLines[k].trim();
            if (isStop(above)) break;
            assetTextParts.unshift(above);
          }
          break;
        } else if (bracketAlone) {
          assetType = bracketAlone[1];
          for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
            const above = txLines[k].trim();
            if (isStop(above)) break;
            assetTextParts.unshift(above);
          }
          break;
        } else if (bracketInLine) {
          assetType = bracketInLine[1];
          const beforeBracket = prev.replace(/\[([A-Z]{2,4})\].*$/, '').trim();
          if (beforeBracket) assetTextParts.unshift(beforeBracket);
          for (let k = j - 1; k >= Math.max(0, j - 5); k--) {
            const above = txLines[k].trim();
            if (isStop(above)) break;
            assetTextParts.unshift(above);
          }
          break;
        }
      }
    }

    if (!assetType) continue; // no asset type found — not a transaction line

    // ── Clean up the asset text ──────────────────────────────────────────────
    const assetRaw = assetTextParts.join(' ').trim();

    // Extract ticker: "(AMZN)" or "(BRK.B)" at the end of asset text
    const tickerM = assetRaw.match(/\(([A-Za-z][A-Za-z0-9.\-]{0,6})\)\s*$/);
    const ticker = tickerM ? tickerM[1].toUpperCase() : null;
    const nameAndOwner = tickerM
      ? assetRaw.slice(0, assetRaw.lastIndexOf(tickerM[0])).trim()
      : assetRaw;

    // Extract owner code: in old format it's prepended with NO space (e.g. "DCAmazon.com")
    // Owner codes are exactly 2 uppercase letters (DC, SP, JT, DE, OT)
    // They appear immediately before the asset name with no separator.
    // Heuristic: if text starts with 2 uppercase chars followed by a capital letter of the name,
    //   extract the 2 uppercase chars as owner. Otherwise owner is unknown.
    let owner = null;
    let assetName = nameAndOwner;

    const ownerGlued = nameAndOwner.match(/^([A-Z]{2})([A-Z][a-z].+)$/);    // e.g. DCAmazon.com
    const ownerSpaced = nameAndOwner.match(/^([A-Z]{2,4})\s+(\S.+)$/);       // e.g. DC Amazon.com
    if (ownerGlued) {
      owner = ownerGlued[1];
      assetName = ownerGlued[2];
    } else if (ownerSpaced && /^(DC|SP|JT|DE|OT)$/.test(ownerSpaced[1])) {
      owner = ownerSpaced[1];
      assetName = ownerSpaced[2];
    }

    // ── Build trade object ───────────────────────────────────────────────────
    const txType = rawTxType.trim().replace(/\s+/g, ' ');
    const typeInfo = TX_TYPES[txType] || TX_TYPES['O'] || { description: txType, category: 'other' };
    const amountRange = parseAmountRange(rawAmount);

    // Capital gains: look at what follows on this line or the next
    const after = m[6] || ''; // captured suffix of the data line
    const nextLine = txLines[i + 1] ? txLines[i + 1].trim() : '';
    const capGains = /nmlkji?\s*Yes/i.test(after + nextLine) ? true
      : /gfedc|nmlkji?\s*No/i.test(after + nextLine) ? false
      : null;

    counter++;
    const trade = {
      id: `${filingInfo.docId}-${counter}`,
      owner: owner || 'DC', // default to member (DC) if not detected
      asset: { name: assetName, ticker, type: assetType, typeDescription: ASSET_TYPES[assetType] || null },
      transaction: {
        type: txType,
        description: typeInfo.description,
        category: typeInfo.category,
        tradeDate: normalizeDate(rawTradeDate),
        notificationDate: normalizeDate(rawNotifDate),
        filingDate: normalizeDate(filingInfo.filingDate),
        amount: rawAmount.trim(),
        amountMin: amountRange.min,
        amountMax: amountRange.max,
        capitalGains: capGains,
        price: null,
      },
      filing: {
        docId: filingInfo.docId,
        year: filingInfo.year,
        pdfUrl: `${BASE_URL}/ptr-pdfs/${filingInfo.year}/${filingInfo.docId}.pdf`,
      },
      person: filingInfo.legislatorInfo || null,
    };
    trades.push(trade);
  }

  return trades;
}

// ─── Yahoo Finance (direct chart API) ──────────────────────────────────────

async function getStockPrice(ticker, dateStr) {
  if (!ticker || !dateStr) return null;
  const key = `${ticker}:${dateStr}`;
  if (priceCache[key] !== undefined) return priceCache[key];

  // Yahoo Finance uses hyphens for class shares: BRK.B → BRK-B, BF.B → BF-B
  const yhTicker = ticker.replace(/\.([A-Z])$/, '-$1');

  try {
    // Search a 6-day window centred around the trade date to catch weekends/holidays
    const date = new Date(dateStr + 'T12:00:00Z');
    const p1 = Math.floor(date.getTime() / 1000) - 86400;       // 1 day before
    const p2 = Math.floor(date.getTime() / 1000) + (5 * 86400); // 5 days after
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhTicker)}?interval=1d&period1=${p1}&period2=${p2}`;

    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; capitol-api/1.0)' },
    });

    const result = res.data?.chart?.result?.[0];
    if (!result) { priceCache[key] = null; return null; }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const targetTs = Math.floor(date.getTime() / 1000);

    // Find the first trading day on or after the target date (within window)
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= targetTs - 86400 && closes[i] != null) {
        const price = Math.round(closes[i] * 100) / 100;
        priceCache[key] = price;
        return price;
      }
    }

    priceCache[key] = null;
    return null;
  } catch (err) {
    if (process.env.DEBUG) console.warn(`  [price] ${ticker} fetch error: ${err.message}`);
    priceCache[key] = null;
    return null;
  }
}

// Fetch prices in batches to avoid rate limiting
async function enrichPrices(trades) {
  const stockTrades = trades.filter(t => t.asset.ticker && t.transaction.tradeDate);
  if (stockTrades.length === 0) return;
  console.log(`  [prices] Fetching prices for ${stockTrades.length} stock trades...`);
  let i = 0;
  let fetched = 0;
  let failed = 0;
  while (i < stockTrades.length) {
    const batch = stockTrades.slice(i, i + PRICE_CONCURRENCY);
    await Promise.all(batch.map(async t => {
      const price = await getStockPrice(t.asset.ticker, t.transaction.tradeDate);
      t.transaction.price = price;
      if (price !== null) {
        fetched++;
        console.log(`  [price] ${t.asset.ticker} on ${t.transaction.tradeDate} → $${price.toFixed(2)}`);
      } else {
        failed++;
        console.log(`  [price] ${t.asset.ticker} on ${t.transaction.tradeDate} → not found`);
      }
    }));
    i += PRICE_CONCURRENCY;
    if (i < stockTrades.length) await sleep(300);
  }
  console.log(`  [prices] Done: ${fetched} fetched, ${failed} not found`);
}

// ─── Fetching Pipeline ──────────────────────────────────────────────────────

async function fetchAndParseYear(year, legislators, processedIds) {
  const trades = [];
  fetchStatus.progress = `Downloading ${year} disclosure index...`;

  let xmlContent;
  try {
    const res = await axios.get(`${BASE_URL}/financial-pdfs/${year}FD.zip`, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    const zip = new AdmZip(Buffer.from(res.data));
    const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml') || e.entryName.endsWith('FD.xml'));
    if (!xmlEntry) { console.warn(`No XML found in ${year} zip`); return trades; }
    xmlContent = xmlEntry.getData().toString('utf-8');
  } catch (err) {
    console.warn(`Failed to download ${year} zip:`, err.message);
    return trades;
  }

  // Parse XML
  const parsed = await xml2js.parseStringPromise(xmlContent, { explicitArray: false, trim: true });
  const root = parsed?.FinancialDisclosure || parsed?.NewDataSet || parsed;
  let members = root?.Member || [];
  if (!Array.isArray(members)) members = [members];

  // Only PTR filings (FilingType = P) have trade-level data in ptr-pdfs
  const ptrMembers = members.filter(m => m.FilingType === 'P' && m.DocID);
  const skipCount = ptrMembers.filter(m => processedIds.has(String(m.DocID).trim())).length;
  console.log(`\n[${year}] ${ptrMembers.length} PTR filings found, ${skipCount} already cached, ${ptrMembers.length - skipCount} to process`);
  fetchStatus.progress = `${year}: 0/${ptrMembers.length} PTR filings processed`;

  let yearTradeCount = 0;
  let yearProcessed = 0;

  for (let idx = 0; idx < ptrMembers.length; idx++) {
    const m = ptrMembers[idx];
    const docId = String(m.DocID).trim();

    if (processedIds.has(docId)) continue;

    yearProcessed++;
    const personLabel = `${m.First} ${m.Last} (${m.StateDst || '?'})`;
    fetchStatus.progress = `${year}: ${yearProcessed}/${ptrMembers.length - skipCount} — ${personLabel}`;
    process.stdout.write(`[${year}] [${idx + 1}/${ptrMembers.length}] DocID ${docId} — ${personLabel} ... `);

    try {
      const pdfBuffer = await downloadPdf(docId, year);
      if (!pdfBuffer) {
        console.log('PDF 404 (skip)');
        processedIds.add(docId);
        continue;
      }

      const pdfData = await pdfParse(pdfBuffer);
      const legislator = matchLegislator(legislators, m.First, m.Last, m.StateDst);
      const legislatorInfo = extractLegislatorInfo(legislator, m.StateDst);

      const person = legislatorInfo || {
        bioguideId: null,
        name: `${m.Prefix || ''} ${m.First} ${m.Last}`.trim(),
        firstName: m.First,
        lastName: m.Last,
        state: m.StateDst?.slice(0, 2) || null,
        district: m.StateDst?.length > 2 ? parseInt(m.StateDst.slice(2)) : null,
        party: null,
        phone: null,
        gender: null,
        birthday: null,
        terms: [],
      };

      const filingInfo = { docId, year, filingDate: m.FilingDate, legislatorInfo: person };
      const fileTrades = parseTransactionsFromText(pdfData.text, filingInfo);

      console.log(`${fileTrades.length} trade(s) parsed` + (legislator ? ` | party: ${person.party}` : ' | legislator: not matched'));

      if (fileTrades.length === 0) {
        // Dump first 15 lines of PDF text for debugging
        const debugLines = pdfData.text.split('\n').filter(l => l.trim()).slice(0, 15);
        console.log(`  [debug] PDF text preview (first 15 non-empty lines):`);
        debugLines.forEach((l, i) => console.log(`    ${i + 1}: ${l}`));
      } else {
        fileTrades.forEach(t => {
          const priceNote = t.asset.ticker ? ` [${t.asset.ticker}]` : '';
          console.log(`  → ${t.transaction.type} ${t.asset.name}${priceNote} | ${t.transaction.tradeDate} | ${t.transaction.amount}`);
        });
      }

      trades.push(...fileTrades);
      yearTradeCount += fileTrades.length;
      processedIds.add(docId);

      // Enrich prices immediately for this filing's stock trades
      await enrichPrices(fileTrades);

      // Save incrementally
      const existingCache = loadJson(CACHE_FILE, { metadata: {}, trades: [] });
      existingCache.trades.push(...fileTrades);
      existingCache.metadata.status = 'in_progress';
      existingCache.metadata.lastUpdated = new Date().toISOString();
      saveJson(CACHE_FILE, existingCache);
      saveJson(PROCESSED_FILE, [...processedIds]);

    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      processedIds.add(docId); // skip on repeated errors
    }

    if (idx < ptrMembers.length - 1) await sleep(FETCH_DELAY_MS);
  }

  console.log(`\n[${year}] Complete: ${yearTradeCount} total trades from ${yearProcessed} filings\n`);
  return trades;
}

async function runFullFetch() {
  if (fetchStatus.running) return;
  fetchStatus.running = true;
  fetchStatus.error = null;
  fetchStatus.startedAt = new Date().toISOString();

  ASSET_TYPES = loadAssetTypes();
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Capitol API — Starting data fetch`);
  console.log(`Years: ${YEARS_START}–${YEARS_END} | Delay: ${FETCH_DELAY_MS}ms between PDFs`);
  console.log(`Asset types loaded: ${Object.keys(ASSET_TYPES).length} | Transaction types: ${Object.keys(TX_TYPES).length}`);
  console.log('─'.repeat(60));

  try {
    const legislators = await fetchLegislators();
    const years = [];
    for (let y = YEARS_START; y <= YEARS_END; y++) years.push(y);

    // Load any existing processed set so we can resume an in-progress fetch
    const processedArray = loadJson(PROCESSED_FILE, []);
    const processedIds = new Set(processedArray);

    // Seed processedIds from docIds already represented in the cache — this
    // makes incremental refreshes efficient: only new filings are downloaded
    // instead of re-processing everything from scratch.
    ensureCacheDir();
    const existingCache = loadJson(CACHE_FILE, { metadata: {}, trades: [] });
    let seededFromCache = 0;
    for (const trade of existingCache.trades || []) {
      if (trade.filing?.docId && !processedIds.has(trade.filing.docId)) {
        processedIds.add(trade.filing.docId);
        seededFromCache++;
      }
    }

    if (processedIds.size > 0) {
      console.log(`[incremental] Skipping ${processedIds.size} already-processed filings (${seededFromCache} from cache, ${processedIds.size - seededFromCache} from resume file)`);
    }

    // Init cache metadata (keep existing trades — incremental mode)
    const cacheData = {
      metadata: {
        ...existingCache.metadata,
        years,
        status: 'in_progress',
        lastUpdated: new Date().toISOString(),
      },
      trades: existingCache.trades || [],
    };
    saveJson(CACHE_FILE, cacheData);

    for (const year of years) {
      // prices are now enriched per-filing inside fetchAndParseYear
      await fetchAndParseYear(year, legislators, processedIds);
    }

    // Final save with complete status
    const finalCache = loadJson(CACHE_FILE, { metadata: {}, trades: [] });
    finalCache.metadata.status = 'complete';
    finalCache.metadata.lastUpdated = new Date().toISOString();
    saveJson(CACHE_FILE, finalCache);

    // Clear the processed file — fresh next time
    if (fs.existsSync(PROCESSED_FILE)) fs.unlinkSync(PROCESSED_FILE);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Fetch complete. ${finalCache.trades.length} total trades cached.`);
    console.log('─'.repeat(60));
    fetchStatus.progress = `Complete — ${finalCache.trades.length} trades cached.`;
  } catch (err) {
    fetchStatus.error = err.message;
    console.error('Fetch failed:', err);
  } finally {
    fetchStatus.running = false;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function initialize() {
  ASSET_TYPES = loadAssetTypes();
  ensureCacheDir();

  const cache = loadJson(CACHE_FILE, null);

  if (!cache || !cache.trades || cache.trades.length === 0) {
    console.log('No cache found. Starting initial data fetch...');
    runFullFetch(); // non-blocking
    return;
  }

  if (CACHE_REFRESH_HOURS > 0 && cache.metadata?.lastUpdated) {
    const age = (Date.now() - new Date(cache.metadata.lastUpdated).getTime()) / 3600000;
    if (age >= CACHE_REFRESH_HOURS) {
      console.log(`Cache is ${age.toFixed(1)}h old (limit ${CACHE_REFRESH_HOURS}h). Refreshing...`);
      runFullFetch();
      return;
    }
  }

  console.log(`Cache loaded: ${cache.trades.length} trades.`);

  if (CACHE_REFRESH_HOURS > 0) {
    setInterval(() => {
      console.log('Scheduled cache refresh starting...');
      runFullFetch();
    }, CACHE_REFRESH_HOURS * 3600000);
  }
}

function startFetch() {
  runFullFetch();
}

function getStatus() {
  const cache = loadJson(CACHE_FILE, null);
  return {
    fetchRunning: fetchStatus.running,
    fetchProgress: fetchStatus.progress,
    fetchError: fetchStatus.error,
    fetchStartedAt: fetchStatus.startedAt,
    cacheStatus: cache?.metadata?.status || 'none',
    cacheLastUpdated: cache?.metadata?.lastUpdated || null,
    cacheYears: cache?.metadata?.years || [],
    totalTrades: cache?.trades?.length || 0,
    config: {
      yearsStart: YEARS_START,
      yearsEnd: YEARS_END,
      cacheRefreshHours: CACHE_REFRESH_HOURS,
    },
  };
}

// ─── Query / Filter ─────────────────────────────────────────────────────────

function applyFilters(trades, query) {
  let result = trades;

  if (query.state) {
    const s = query.state.toUpperCase();
    result = result.filter(t => t.person?.state?.toUpperCase() === s);
  }

  if (query.party) {
    const p = query.party.toLowerCase();
    result = result.filter(t => t.person?.party?.toLowerCase().includes(p));
  }

  if (query.person) {
    const p = query.person.toLowerCase();
    result = result.filter(t => t.person?.name?.toLowerCase().includes(p));
  }

  if (query.ticker) {
    const tk = query.ticker.toUpperCase();
    result = result.filter(t => t.asset?.ticker?.toUpperCase() === tk);
  }

  if (query.type) {
    const ty = query.type.toUpperCase();
    result = result.filter(t =>
      t.transaction?.type?.toUpperCase() === ty ||
      t.transaction?.category?.toLowerCase() === query.type.toLowerCase()
    );
  }

  if (query.from) {
    result = result.filter(t => t.transaction?.tradeDate >= query.from);
  }

  if (query.to) {
    result = result.filter(t => t.transaction?.tradeDate <= query.to);
  }

  if (query.category) {
    result = result.filter(t => t.transaction?.category === query.category.toLowerCase());
  }

  return result;
}

function applySort(trades, query) {
  const sort = query.sort || 'date';
  const order = query.order?.toLowerCase() === 'asc' ? 1 : -1;

  return trades.slice().sort((a, b) => {
    switch (sort) {
      case 'date':
      case 'newest':
        return order * ((a.transaction?.tradeDate || '') < (b.transaction?.tradeDate || '') ? 1 : -1);
      case 'oldest':
        return order * ((a.transaction?.tradeDate || '') > (b.transaction?.tradeDate || '') ? 1 : -1);
      case 'amount':
      case 'largest':
        return order * ((b.transaction?.amountMin || 0) - (a.transaction?.amountMin || 0));
      case 'name':
        return order * ((a.person?.name || '').localeCompare(b.person?.name || ''));
      case 'ticker':
        return order * ((a.asset?.ticker || '').localeCompare(b.asset?.ticker || ''));
      case 'filingdate':
        return order * ((a.transaction?.filingDate || '') < (b.transaction?.filingDate || '') ? 1 : -1);
      default:
        return 0;
    }
  });
}

function getTrades(query) {
  const cache = loadJson(CACHE_FILE, { trades: [] });
  let trades = cache.trades || [];

  trades = applyFilters(trades, query);
  trades = applySort(trades, query);

  // recent=N returns the N most recently filed trades
  if (query.recent) {
    const n = parseInt(query.recent) || 20;
    trades = trades
      .slice()
      .sort((a, b) => (b.transaction?.filingDate || '') > (a.transaction?.filingDate || '') ? 1 : -1)
      .slice(0, n);
    return { total: n, trades };
  }

  const total = trades.length;
  const limit = query.limit ? parseInt(query.limit) : undefined;
  const offset = parseInt(query.offset || '0');
  const paginated = limit ? trades.slice(offset, offset + limit) : trades.slice(offset);

  return {
    total,
    offset,
    limit: limit || null,
    returned: paginated.length,
    trades: paginated,
  };
}

module.exports = { initialize, startFetch, getStatus, getTrades };
