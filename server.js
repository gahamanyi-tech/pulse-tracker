require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SERVER_NAME = process.env.SERVER_NAME || 'Web01';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 300000;
const API_BASE_URL =
  process.env.API_BASE_URL || 'https://search.worldbank.org/api/v2/projects';

const cache = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: SERVER_NAME,
    port: PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/projects', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const country = String(req.query.country || '').trim();
  const sortBy = String(req.query.sort || 'relevance').trim();
  const rows = Math.min(Math.max(Number(req.query.rows) || 20, 1), 100);

  const cacheKey = JSON.stringify({ query, country, sortBy, rows });
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({
      ...cached.data,
      cached: true,
      servedBy: SERVER_NAME
    });
  }

  const url = new URL(API_BASE_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('rows', String(rows));
  if (query) url.searchParams.set('qterm', query);
  if (country) url.searchParams.set('countrycode_exact', country.toUpperCase());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({
        error: 'Upstream API error',
        message: `World Bank API responded with status ${response.status}`,
        servedBy: SERVER_NAME
      });
    }

    const raw = await response.json();
    const rawProjects = raw && typeof raw.projects === 'object' ? raw.projects : {};

    let projects = Object.values(rawProjects)
      .filter((item) => item && typeof item === 'object' && item.id)
      .map((item) => {
        const commitmentRaw = String(item.currcommamt || item.commamt || '0').replace(/,/g, '');
        const commitment = Number(commitmentRaw) || 0;
        return {
          id: item.id,
          title: item.project_name || 'Untitled Project',
          country: item.countryshortname || (Array.isArray(item.countryname) ? item.countryname[0] : item.countryname) || 'Unknown',
          status: item.projectstatusdisplay || 'Unknown',
          sector: Array.isArray(item.mjsector_namecode) && item.mjsector_namecode[0]
            ? item.mjsector_namecode[0].name
            : 'General',
          commitment,
          boardApprovalDate: item.boardapprovaldate || ''
        };
      });

    if (sortBy === 'commitment_desc') {
      projects.sort((a, b) => b.commitment - a.commitment);
    } else if (sortBy === 'commitment_asc') {
      projects.sort((a, b) => a.commitment - b.commitment);
    } else if (sortBy === 'title_asc') {
      projects.sort((a, b) => a.title.localeCompare(b.title));
    }

    const payload = {
      count: projects.length,
      projects,
      servedBy: SERVER_NAME
    };

    cache.set(cacheKey, { timestamp: Date.now(), data: payload });
    return res.json({ ...payload, cached: false });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err && err.name === 'AbortError';
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout ? 'Upstream request timed out' : 'Failed to reach external API',
      message: err && err.message ? err.message : 'Unexpected error',
      servedBy: SERVER_NAME
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', servedBy: SERVER_NAME });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error', servedBy: SERVER_NAME });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${SERVER_NAME} listening on http://0.0.0.0:${PORT}`);
});
