/**
 * Netlify Function: sheet-data
 * Reads live data from the Ascend Pod Google Sheet and returns
 * parsed JSON for the dashboard's three live tabs.
 *
 * Required env variable (set in Netlify dashboard → Site → Environment Variables):
 *   GOOGLE_SERVICE_ACCOUNT_KEY  — the full contents of your service account JSON key file
 *
 * Usage:
 *   GET /.netlify/functions/sheet-data?tab=pod-coaching
 *   GET /.netlify/functions/sheet-data?tab=load-balancing
 *   GET /.netlify/functions/sheet-data?tab=pipeline
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = '1Lk3gn7XbntuQ1HVIcfqumtZ0j5PWEls6d-V9vz1x9iI';

const TAB_MAP = {
  'pod-coaching':   'Pod Coaching',
  'load-balancing': 'Load Balancing',
  'pipeline':       'BD Pipeline 2026',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
  'Cache-Control':                'no-cache, no-store, must-revalidate',
};

// ── Auth ─────────────────────────────────────────────────────────────────────

function getSheetsClient() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getRows(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return res.data.values || [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function str(v) {
  return String(v == null ? '' : v).trim();
}

function parseMoney(v) {
  const s = str(v).replace(/[$,]/g, '');
  if (!s || s === '-' || s === 'TBD') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function cleanDash(v) {
  const s = str(v);
  return s === '-' ? '' : s.replace(/^\*/, '').trim();
}

const TODAY = new Date().toISOString().slice(0, 10);

// ── Pod Coaching ─────────────────────────────────────────────────────────────
//
// Sheet structure:
//   Row 0:  header (Company, Coachee Name, Title, Email, Status, Trium OM, Sched Contact, ...)
//   Then:   "DOUG" (section header in col 0)
//           "Airtable Sessions View - Doug" (skip)
//           "", Pareto Health, Maeve O'Meara, ... (data row, col 0 empty)
//   Then:   "MICHELLE", ...etc...
//   Then:   "Inactive" → stop

function parsePodCoaching(rows) {
  const KNOWN_COACHES = new Set(['DOUG', 'MICHELLE', 'AUSTIN', 'REBECCA', 'TRICE', 'GAUTAM']);
  const coaches = [];
  let currentCoach = null;

  for (const row of rows) {
    const col0 = str(row[0]);
    const col1 = str(row[1]);

    // Stop at the bottom "Inactive" catch-all block (these have no coach)
    if (col0 === 'Inactive') break;

    // Coach section header
    if (KNOWN_COACHES.has(col0.toUpperCase())) {
      const name = col0.charAt(0).toUpperCase() + col0.slice(1).toLowerCase();
      currentCoach = { coach: name, coachees: [] };
      coaches.push(currentCoach);
      continue;
    }

    if (!currentCoach) continue;

    // Skip non-data rows
    if (!col1) continue;
    if (col0.toLowerCase().includes('airtable') || col1.toLowerCase().includes('airtable')) continue;
    if (col1 === 'Company') continue; // header row

    const company           = col1;
    const name              = str(row[2]);
    const title             = str(row[3]);
    const status            = str(row[5]);
    const triumOM           = str(row[6]);
    const schedulingContact = str(row[7]) || 'Direct';

    if (company && name) {
      currentCoach.coachees.push({ company, name, title, status, triumOM, schedulingContact });
    }
  }

  return { lastUpdated: TODAY, coaches };
}

// ── Load Balancing ───────────────────────────────────────────────────────────
//
// Sheet structure:
//   Section 1 — people summary (after "ACTIVE Client Load" header row)
//   Section 2 — ASCEND POD client table
//   Section 3 — OUTSIDE OF POD client table
//   Section 4 — COACHING-ONLY (skip)

function parseLoadBalancing(rows) {
  const people  = [];
  const clients = [];
  let section   = null;

  for (const row of rows) {
    const col1 = str(row[1]);

    // ── Section detection ──
    if (col1 === 'ACTIVE Client Load') { section = 'people';  continue; }
    if (col1 === 'ASCEND POD')         { section = 'ascend';  continue; }
    if (col1 === 'OUTSIDE OF POD')     { section = 'outside'; continue; }
    if (col1.startsWith('COACHING-ONLY')) { section = null; continue; }

    // Skip header/label rows
    if (!col1) continue;
    if (col1 === 'ACTIVE CLIENT' || col1 === 'Status' || col1.includes("Seat A (")) continue;
    if (col1 === 'Coachee Details' || col1.startsWith('See ')) continue;

    if (section === 'people') {
      const name = col1;
      people.push({
        name,
        seatA:               parseInt(row[2]) || 0,
        seatB:               parseInt(row[3]) || 0,
        principal:           parseInt(row[4]) || 0,  // Seat C maps to principal in some layouts
        cx:                  parseInt(row[4]) || 0,
        om:                  parseInt(row[5]) || 0,
        strategyEngagements: parseInt(row[6]) || 0,
        coachees:            parseInt(row[7]) || 0,
      });
    }

    if (section === 'ascend' || section === 'outside') {
      const name   = col1;
      const status = str(row[2]);
      if (!name || status === 'Status') continue;

      clients.push({
        name,
        status,
        seatA:       cleanDash(row[3]),
        seatB:       cleanDash(row[4]),
        principal:   '',
        cx:          cleanDash(row[5]),
        om:          cleanDash(row[6]),
        coachingOps: cleanDash(row[7]),
        coachOther:  '',
        notes:       cleanDash(row[8]),
        outsidePod:  section === 'outside',
      });
    }
  }

  return { lastUpdated: TODAY, people, clients };
}

// ── BD Pipeline 2026 ─────────────────────────────────────────────────────────
//
// Sheet structure:
//   Several header/summary rows at the top
//   Data table starts with the row where col 1 === "Client / Prospect"
//   Each deal row: col1=name, col2=owner, col3=totalRev, col4=podPct,
//                  col5=status, col6=rum2026, col7=rum2027,
//                  col8=projected2026, col9=projected2027

function parsePipeline(rows) {
  let headerIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    if (str(rows[i][1]) === 'Client / Prospect') {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) {
    return { lastUpdated: TODAY, summary: {}, deals: [] };
  }

  const deals = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row    = rows[i];
    const name   = str(row[1]);
    const owner  = str(row[2]);
    const status = str(row[5]);

    if (!name || !owner) continue;

    const rum2026       = parseMoney(row[6]);
    const rum2027       = parseMoney(row[7]);
    const projected2026 = parseMoney(row[8]);
    const projected2027 = parseMoney(row[9]);

    deals.push({
      name,
      owner,
      totalRev:    parseMoney(row[3]),
      podPct:      parseInt(str(row[4]).replace('%', '')) || 0,
      status,
      rum2026,
      rum2027,
      projected2026,
      projected2027,
    });
  }

  const booked2026    = deals.reduce((s, d) => s + d.rum2026,       0);
  const proj2026      = deals.reduce((s, d) => s + d.projected2026, 0);
  const booked2027    = deals.reduce((s, d) => s + d.rum2027,       0);
  const proj2027      = deals.reduce((s, d) => s + d.projected2027, 0);

  return {
    lastUpdated: TODAY,
    summary: {
      booked2026,
      projected2026: proj2026,
      total2026:     booked2026 + proj2026,
      booked2027,
      projected2027: proj2027,
    },
    deals,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const tab = str((event.queryStringParameters || {}).tab);

  if (!TAB_MAP[tab]) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Unknown tab "${tab}". Valid: ${Object.keys(TAB_MAP).join(', ')}` }),
    };
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY env variable is not set.' }),
    };
  }

  try {
    const sheets = getSheetsClient();
    const rows   = await getRows(sheets, TAB_MAP[tab]);

    let data;
    if (tab === 'pod-coaching')   data = parsePodCoaching(rows);
    if (tab === 'load-balancing') data = parseLoadBalancing(rows);
    if (tab === 'pipeline')       data = parsePipeline(rows);

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
  } catch (err) {
    console.error(`[sheet-data/${tab}]`, err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
