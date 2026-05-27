# Ascend Pod Dashboard

Internal Trium dashboard for the Ascend pod — BD pipeline, load balancing, coaching engagements, and travel.

---

## What's in here

```
ascend-pod-site/
├── index.html                  Main site (single-page app, 4 tabs)
├── netlify.toml                Netlify build + function config
├── fonts/                      Trium typefaces + logo (committed to repo)
├── data/
│   ├── load-balancing.json     Project runway data — edit to update
│   ├── pod-coaching.json       Coaching engagements — edit to update
│   └── travel.json             Where in the World calendar — edit to update
└── netlify/
    └── functions/
        └── hubspot-deals.js    Server-side HubSpot API proxy
```

---

## Setup: GitHub + Netlify (one time)

### 1. Create a GitHub repo

1. Go to github.com → New repository
2. Name it `ascend-pod-dashboard` (or whatever you prefer)
3. Set it to **Private**
4. Upload all the files from this folder (drag and drop into the repo, or use GitHub Desktop)

### 2. Deploy to Netlify

1. Go to app.netlify.com → Add new site → Import from Git
2. Connect your GitHub account and choose the repo
3. Build settings should auto-populate from `netlify.toml` — leave them as-is
4. Click **Deploy site**

Netlify will give you a URL like `https://ascend-pod-xxxxxx.netlify.app`. You can set a custom domain in Site settings → Domain management.

### 3. Add the HubSpot API key

The BD Pipeline tab pulls live deals from HubSpot. To connect it:

1. In HubSpot, go to **Settings → Integrations → Private Apps**
2. Create a new private app with these scopes: `crm.objects.deals.read`, `crm.objects.owners.read`
3. Copy the access token
4. In Netlify: go to **Site → Environment variables → Add variable**
   - Key: `HUBSPOT_API_KEY`
   - Value: (paste your token)
5. Trigger a redeploy (Deploys → Trigger deploy)

### 4. (Optional) Map HubSpot owner IDs to pod members

If the pipeline tab shows "Other" instead of Doug/Michelle/Rebecca/Trice, you need to map HubSpot user IDs:

1. In HubSpot, go to Settings → Users & Teams. Find each person's user ID (visible in the URL when you click their profile)
2. Add these as Netlify env variables:
   - `HUBSPOT_OWNER_DOUG` → Doug's HubSpot user ID
   - `HUBSPOT_OWNER_MICHELLE` → Michelle's HubSpot user ID
   - `HUBSPOT_OWNER_REBECCA` → Rebecca's HubSpot user ID
   - `HUBSPOT_OWNER_TRICE` → Trice's HubSpot user ID
3. Redeploy

---

## Keeping data current

### BD Pipeline (automatic)
Pulls live from HubSpot every time the page loads. No manual updates needed.

### Load Balancing, Pod Coaching, Where in the World (manual)
These three tabs read from JSON files in the `data/` folder. To update them:

1. Open the relevant file in GitHub (`data/load-balancing.json`, etc.)
2. Click the pencil icon to edit
3. Make your changes and commit
4. Netlify will automatically redeploy within ~1 minute

**Tip:** If you want to sync from Google Sheets automatically, you can set up a Sheets → GitHub Action that exports the relevant tab as JSON on a schedule. Ask your Trium ops team about this.

---

## Load Balancing data format

Each partner has a `projects` array. The key fields:

| Field | Description |
|---|---|
| `client` | Client name |
| `description` | Short description |
| `rum2026` | 2026 revenue under management (dollars) |
| `endDate` | Contract end date (YYYY-MM-DD) |
| `quarter` | `Q2`, `Q3`, `Q4`, or `Q1 2027` |
| `status` | `active_priority`, `active`, or `proposal` |

## Travel calendar format

Each week has a `locations` object keyed by partner name:

```json
{
  "weekStart": "2026-06-01",
  "weekLabel": "Jun 1–5",
  "locations": {
    "Doug":     { "city": "Dallas, TX",        "home": false, "note": "HealthEquity onsite" },
    "Michelle": { "city": "San Francisco, CA",  "home": true,  "note": "" }
  }
}
```

Set `"home": true` for home-base weeks, `false` when traveling.

---

## Confidentiality

This site has no authentication built in. If you use Netlify's free tier, the URL is publicly accessible (but unguessable). For a private deployment, enable **Netlify Identity** or **Password protection** under Site settings → Access control.

---

*The Trium Group · Ascend Pod · Confidential*
