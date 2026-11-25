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
        cacheEntries: cache.size,
        timestamp: new Date().toISOString()
    });
});

function normalizeProject(item) {
    const rawMoney =
    item.totalcommamt ?? item.currcommamt ?? item.commamt ?? item.lendprojectcost ?? '0';
   const commitmentUsd = Number(String(rawMoney).replace(/[^0-9]/g, '')) || 0;
   
   const sector =
     (Array.isArray(item.mjsector_namecode) && item.mjsector_namecode[0]?.name) ||
     (Array.isArray(item.sector_namecode) && item.sector_namecode[0]?.name) ||
     (typeof item.sector1 === 'string' && item.sector1.trim()) ||
     (item.sector1 && typeof item.sector1 === 'object' && item.sector1.Name) ||
     (Array.isArray(item.mjtheme_namecode) && item.mjtheme_namecode[0]?.name) ||
        (Array.isArray(item.theme_list) && item.theme_list[0]?.name) ||
     'General';

     const country =
       item.countryshortname ||
       (Array.isArray(item.countryname) ? item.countryname[0] : item.countryname) ||
       'Unknown';

     return {
        id: String(item.id),
        title: String(item.project_name || 'Untitled Project').trim(),
        country: String(country).trim(),
        status: String(item.projectstatusdisplay || 'Unknown').trim(),
        sector: String(sector).trim(),
        commitmentUsd,
        approvalDate: item.boardapprovaldate || '',
        url:
          item.url ||
          `https://projects.worldbank.org/en/projects-operations/project-detail/${item.id}`

     };

}

app.get('/api/projects', async (req, res) => {
    const query = String(req.query.q || '').trim();
    const country = String(req.query.country || '').trim();
    const rows = Math.min(Math.max(Number(req.query.rows) || 40, 1), 100);

    const cacheKey = JSON.stringify({query: query.toLowerCase(), country, rows });
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return res.json({
            source: 'cache',
            cached: true,
            server: SERVER_NAME,
            fetchedAt: new Date(cached.timestamp).toISOString(),
            count: cached.projects.length,
            projects: cached.projects
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
        const response = await fetch(url.toString(), {
            signal: controller.signal,
            headers: { Accept: 'application/json'}
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`World Bank API responded with status ${response.status}`);
        }

        const raw = await response.json();
        const rawProjects = raw && typeof raw.projects === 'object' ? raw.projects : {};

        const projects = Object.values(rawProjects)
          .filter((item) => item && typeof item === 'object' && item.id)
          .map(normalizeProject);

        cache.set(cacheKey, { timestamp: Date.now(), projects});

        return res.json({
            source: 'live-api',
            cached: false,
            server: SERVER_NAME,
            fetchedAt: new Date().toISOString(),
            count: projects.length,
            projects
        });
    } catch (err) {
      clearTimeout(timeout);
      console.error(`[${SERVER_NAME}] API error:`, err.message);

      if (cached) {
        return res.json({
            source: 'stale-cache',
            cached: true,
            server: SERVER_NAME,
            warning: 'Live API unavailable. Showing previously cached results',
            fetchedAt: new Date(cached.timestamp).toISOString(),
            count: cached.projects.length,
            projects: cached.projects
        });
      }

      const isTimeout = err && err.name === 'AbortError';
      return res.status(isTimeout ? 504: 502).json({
        error: isTimeout
           ? 'The World Bank API took too long to respond.'
           : 'Unable to get project data from the World Bank API right now.',
          details: err && err.message ? err.message : 'Unexpected error',
          server: SERVER_NAME 
      });
      
    }
     
});

app.use((req, res) => {
    res.status(404).json({error: 'Not found', server: SERVER_NAME});
});

app.use((err, req, res, next) =>{
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error', server: SERVER_NAME});
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`${SERVER_NAME} listening on http://0.0.0.0:${PORT}`);
});
