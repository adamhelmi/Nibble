// server/index.js
// --- bootstrap + env ----------------------------------------------------------
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env that sits next to this file (no CWD ambiguity)
dotenv.config({ path: path.join(__dirname, '.env') });

// --- express ------------------------------------------------------------------
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.options('*', cors()); // preflight

// --- config -------------------------------------------------------------------
const PORT = process.env.PORT || 5057;
const CLIENT_ID = process.env.KROGER_CLIENT_ID;
const CLIENT_SECRET = process.env.KROGER_CLIENT_SECRET;

// Default to CERTIFICATION; override via .env when ready for prod
const KROGER_API_BASE =
  (process.env.KROGER_API_BASE?.replace(/\/+$/, '')) || 'https://api-ce.kroger.com/v1';

console.log('[server] CWD =', process.cwd());
console.log('[server] env loaded =', {
  hasClientId: !!CLIENT_ID,
  hasSecret: !!CLIENT_SECRET,
  port: PORT,
  base: KROGER_API_BASE
});

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('[server] Missing KROGER_CLIENT_ID / KROGER_CLIENT_SECRET in .env');
}

// --- in-memory caches ---------------------------------------------------------
let tokenCache = { access_token: null, exp: 0 };  // { token, expiry ms }
const storeCache = new Map();  // key: zip -> store[]
const priceCache = new Map();  // key: `${zip}|${q}|${limit}` -> result

// --- helpers ------------------------------------------------------------------
function errorPayload(e) {
  const status = e?.response?.status ?? 500;
  const data = e?.response?.data ?? e?.toString?.() ?? null;
  const msg = e?.message ?? String(e);

  console.error('[server] ERROR', {
    status,
    msg,
    data,
    url: e?.config?.url,
    method: e?.config?.method,
    params: e?.config?.params,
    headers: e?.response?.headers
  });

  return { status, message: msg, data };
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.access_token && tokenCache.exp > now + 60_000) {
    return tokenCache.access_token;
  }
  try {
    const resp = await axios.post(
      `${KROGER_API_BASE}/connect/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'product.compact'
      }),
      {
        auth: { username: CLIENT_ID, password: CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    );
    const { access_token, expires_in } = resp.data;
    tokenCache = { access_token, exp: now + (expires_in * 1000) };
    return access_token;
  } catch (e) {
    throw { __kroger_token_error: true, ...errorPayload(e) };
  }
}

async function getStoresByZip(zip) {
  if (storeCache.has(zip)) return storeCache.get(zip);
  try {
    const token = await getToken();
    const resp = await axios.get(`${KROGER_API_BASE}/locations`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        'filter.chain': 'Kroger',
        'filter.zipCode.near': zip,
        'filter.limit': 25
      },
      timeout: 10000
    });
    const stores = (resp.data?.data || []).map(s => ({
      id: s.locationId,
      name: s.name,
      address: s.address?.addressLine1,
      zipcode: s.address?.postalCode
    }));
    storeCache.set(zip, stores);
    return stores;
  } catch (e) {
    throw { __kroger_store_error: true, zip, ...errorPayload(e) };
  }
}

async function searchProducts({ q, zip, limit = 10 }) {
  const cacheKey = `${zip}|${q}|${limit}`;
  if (priceCache.has(cacheKey)) return priceCache.get(cacheKey);
  try {
    const token = await getToken();
    const stores = await getStoresByZip(zip);
    if (!stores.length) return { products: [], store: null };

    const storeId = stores[0].id;
    const resp = await axios.get(`${KROGER_API_BASE}/products`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        'filter.locationId': storeId,
        'filter.term': q,
        'filter.limit': limit
      },
      timeout: 12000
    });

    const products = (resp.data?.data || []).map(p => {
      const item = p?.items?.[0];
      const size = item?.size;
      const price = item?.price?.regular;
      const promo = item?.price?.promo;
      return {
        upc: p.upc,
        description: p.description,
        category: p.categories?.[0] || null,
        size,
        price,
        promo,
        unitPrice: price ?? promo ?? null,
        unitPriceDisplay: null,
        packageSize: size ?? null
      };
    });

    const out = { store: stores[0], products };
    priceCache.set(cacheKey, out);
    return out;
  } catch (e) {
    throw { __kroger_product_error: true, q, zip, ...errorPayload(e) };
  }
}

// --- routes -------------------------------------------------------------------
app.get('/health', async (_req, res) => {
  try {
    const token = await getToken();
    res.json({
      ok: true,
      token: token ? 'ok' : 'missing',
      uptime: process.uptime()
    });
  } catch (e) {
    const payload = errorPayload(e);
    res.status(payload.status).json({ ok: false, error: payload, uptime: process.uptime() });
  }
});

app.get('/stores/nearest', async (req, res) => {
  try {
    const zip = String(req.query.zip || '');
    if (!zip) return res.status(400).json({ error: { message: 'zip required' } });
    const stores = await getStoresByZip(zip);
    res.json({ stores });
  } catch (e) {
    const payload = errorPayload(e);
    res.status(payload.status).json({ error: payload });
  }
});

app.get('/pricing/search', async (req, res) => {
  console.log('[pricing/search]', { ip: req.ip, q: req.query.q, zip: req.query.zip, limit: req.query.limit });
  try {
    const q = String(req.query.q || '');
    const zip = String(req.query.zip || '');
    const limit = Number(req.query.limit || 10);
    if (!q || !zip) return res.status(400).json({ error: { message: 'q and zip are required' } });

    const result = await searchProducts({ q, zip, limit });
    res.json(result);
  } catch (e) {
    const payload = errorPayload(e);
    res.status(payload.status).json({ error: payload });
  }
});

// --- start --------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] pricing proxy on http://0.0.0.0:${PORT}`);
});
