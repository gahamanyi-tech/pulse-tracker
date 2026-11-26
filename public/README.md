# World Bank Project Pulse (`pulse-tracker`)

A multi-node Node.js and Express web application that queries and normalizes World Bank development project data, provides per-node response caching and sorting, and runs behind an Nginx reverse proxy and HAProxy round-robin load balancer.

## Architecture Overview

Traffic enters through the HAProxy load balancer on port `80` and distributes across backend web nodes usinf round-robin scheduling. Each web node runs Nginx on port `80` as a reverse proxy forwarding requests to a PM2-managed Node.js/Express service on `127.0.0.1:3000`.

```text
Client / Curl / Browser
        |
    7270-lb-01 (18.171.184.104)
    HAProxy (:80, round-robin)
       |--> 7270-web-01 (3.8.236.35) --> Nginx (:80) --> PM2 pulse-app (:3000, SERVER_NAME=Web01)
       |--> 7270-web-02 (52.56.146.23) --> Nginx (:80) --> PM2 pulse-app (:3000, SERVER_NAME=Web02)

```

### Key Design Notes
* **Reverse Proxy + App port:** Because port `3000` is restricted between hosts, each web server listens on port `80` via Nginx and proxies to `http://127.0.0.1:3000`.
* **Per-Node Caching:** Each `pulse-app` instance maintains an in-memory `Map` cache (`CACHE_TTL_MS`, default `300000` ms / 5 minutes). Consecutive requests to the same backend node return `"cached": true`, while round-robin requests hitting an uncached node populates tat node's cache (`"cached": false`).

---

## Tech Stack

* **Runtime & Framework:** Node.js, Express
* **Process Manager:** PM2 (`pulse-app`)
* **Reverse Proxy:** Nginx
* **Load Balancer:** HAProxy (`roundrobin`)
* **External Data Source:** World Bank Projects API (`https://search.worldbank.org/api/v2/projects`)

---

## Environment Variables

Create a `.env` file in the project root (do not commit `.env` secrets to version control):

```env
PORT=3000
SERVER_NAME=Web01
CACHE_TTL_MS=300000
API_BASE_URL=[https://search.worldbank.og/api/v2/projects](https://search.worldbank.org/api/v2/projects)
API_KEY=
```

| Variable | Default | Description
|  :---    |  :---   |
| `PORT`   | `3000` | Port Express Listens on locally |
| `SERVER_NAME`  | `Web02`  | Node identifier returned in API responses (`Web01`, `Web02`) |
| `CACHE_TTL_MS` | `300000` | Cache lifetime in milliseconds (5 minutes) |
| `API_BASE_URL` | `https://search.worldbank.org/api/v2/projects` | Upstream World Bank API endpoint |
| `API_KEY` | *(empty)* | Optional API Key placeholder |

---

# Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:** 
   ```bash
   cp .env.example .env  # or create .env with the values above
   ```
3. **Start the server:**
   ```bash
   npm start
   # or for development with file watching:
   npm run dev
   ```
4. **Test locally:**
   ```bash
   curl -s http://localhost:3000/api/health
   curl -s "http://localhost:3000/api/projects?q=water&rows=5"
   ```

---

## API Endpoints 

### `GET /api/health`
Returns service health and runtime metadata for the node serving the request.

**Example Response:**
```json
{
    "status": "ok",
    "server": "Web01",
    "port": 3000,
    "uptimeSeconds": 2548,
    "timestamp": "2026-11-23T13:05:27:204"
}
```

### `GET /api/projects`
Fetches and normalizes project records from the world bank API with optional search, country filtering, row limits, and sorting.

**Query Parameters:**
* `q` - Search keyword (`qterm`)
* `country` - ISO country code (`countrycode_exact`, uppercased automatically)
* `rows` - Number of rows to return (`1` to `100`, default `20`)
* `sort` - Sort order: `relevance` (default), `commitment_desc`, `commitment_asc`, or `title_asc`

**Example Request:**
```bash
curl -s "http://localhost/api/projects?q=water&rows=5&sort=commitment_desc"
```

---

## Multi-Node Deployment & Operations

### 1. Web Nodes (`7270-web-01` & `7270-web-02`)
On each web server:
1. Clone or pull the repository into `~/pulse-tracker` and run `npm install`.
2. Set `SERVER_NAME=Web01` on `7270-web-01` and `SERVER_NAME=Web02` on `7270-web-02` in `.env`.
3. Run with PM2:
   ```bash
   pm2 start server.js --name pulse-app --update-env
   pm2 save
   ```
4. Configure Nginx (`/etc/nginx/sites-available/default`) to reverse-proxy portr `80` to `http://127.0.0.1:3000`, validate with `sudo nginx -t`, and reload Nginx.

### 2. Load Balancer (`7270-l-01`)
Configure `/etc/haproxy/haproxy.cfg` with round-robin balancing across both web nodes on port `80`:

```haproxy
frontend www-http
   bind *:80
   default_backend web-backend

backend web-backend   
    balance roundrobin
    server 7270-web-01 3.8.236.35:80 check
    server 7270-web-02 52.56.146.23:80 check
```

Validate and reload HAProxy;
```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
sudo systemctl reload haproxy
```

## 3. Verification & Failover Testing

* **Round-robin health check (on `7270-lb-01`):**
```bash
for i in {1..6}; do curl -s http://localhost/api/health; echo ""; done
```

* **Failover check:**
Stop `pulse-app` on one web node (`pm2 stop pulse-app`), verify `7270-lb-01` continues returning `200 OK` from the healthy node, then bring the stopped node back up (`pm2 start pulse-app`).
    
Demo Video: https://youtu.be/j_R7xw4BUk0

