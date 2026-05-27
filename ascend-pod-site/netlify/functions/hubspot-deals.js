/**
 * Netlify Function: hubspot-deals
 * Proxies HubSpot CRM API calls so the API key stays server-side.
 *
 * Required env variable (set in Netlify dashboard → Site → Environment Variables):
 *   HUBSPOT_API_KEY  — your HubSpot Private App access token
 *
 * Optional env variables (set to comma-separated HubSpot owner IDs for your pod):
 *   HUBSPOT_OWNER_DOUG
 *   HUBSPOT_OWNER_MICHELLE
 *   HUBSPOT_OWNER_REBECCA
 *   HUBSPOT_OWNER_TRICE
 *
 * Endpoint: GET /.netlify/functions/hubspot-deals
 * Query params:
 *   ?stage=all|open|won|lost     (default: all open stages)
 *   ?owner=doug|michelle|rebecca|trice|all   (default: all)
 */

const HUBSPOT_API_BASE = 'https://api.hubapi.com';

// Map display names to env-var owner IDs (optional filtering)
const OWNER_MAP = {
  doug:     process.env.HUBSPOT_OWNER_DOUG,
  michelle: process.env.HUBSPOT_OWNER_MICHELLE,
  rebecca:  process.env.HUBSPOT_OWNER_REBECCA,
  trice:    process.env.HUBSPOT_OWNER_TRICE,
};

// Deal properties to pull from HubSpot
const DEAL_PROPERTIES = [
  'dealname',
  'amount',
  'dealstage',
  'closedate',
  'createdate',
  'hubspot_owner_id',
  'pipeline',
  'hs_deal_stage_probability',
  'description',
  'deal_currency_code',
  // Add any custom properties here, e.g. 'pod_percentage'
].join(',');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    // Diagnostic: list all env var NAMES (not values) to confirm what Netlify is passing
    const envKeys = Object.keys(process.env).filter(k => !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('token') && !k.toLowerCase().includes('key') && !k.toLowerCase().includes('pass'));
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'HUBSPOT_API_KEY environment variable is not set.',
        hint: 'Check that the variable name is exactly HUBSPOT_API_KEY (all caps, underscores) and that you triggered a redeploy after adding it.',
        otherEnvVarsPresent: envKeys.sort(),
      }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const ownerFilter = params.owner || 'all';

    // Build filter groups for the deals search
    const filterGroups = [];

    // Filter by pipeline stage (exclude closed lost by default)
    if (params.stage !== 'all') {
      filterGroups.push({
        filters: [
          {
            propertyName: 'dealstage',
            operator: 'NEQ',
            value: 'closedlost',
          },
        ],
      });
    }

    // Filter by owner if specified
    if (ownerFilter !== 'all') {
      const ownerId = OWNER_MAP[ownerFilter.toLowerCase()];
      if (ownerId) {
        filterGroups.push({
          filters: [
            {
              propertyName: 'hubspot_owner_id',
              operator: 'EQ',
              value: ownerId,
            },
          ],
        });
      }
    }

    // Fetch deals from HubSpot Deals Search API
    const searchBody = {
      filterGroups: filterGroups.length > 0 ? filterGroups : undefined,
      properties: DEAL_PROPERTIES.split(','),
      sorts: [{ propertyName: 'closedate', direction: 'ASCENDING' }],
      limit: 200,
    };

    // Detect key type: Private App tokens start with "pat-"; legacy personal keys do not.
    // Private App → Authorization: Bearer header
    // Legacy personal API key → ?hapikey= query param
    const isPrivateApp = apiKey.startsWith('pat-');
    const authHeader = isPrivateApp ? { Authorization: `Bearer ${apiKey}` } : {};
    const keyParam = isPrivateApp ? '' : `?hapikey=${encodeURIComponent(apiKey)}`;

    const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals/search${keyParam}`, {
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: `HubSpot API error: ${response.status}`, detail: errorText }),
      };
    }

    const data = await response.json();

    // Fetch owner names to map IDs → display names
    const ownerIds = [...new Set(
      data.results
        .map(d => d.properties.hubspot_owner_id)
        .filter(Boolean)
    )];

    let ownerNames = {};
    if (ownerIds.length > 0) {
      const ownersRes = await fetch(`${HUBSPOT_API_BASE}/crm/v3/owners?limit=100${isPrivateApp ? '' : `&hapikey=${encodeURIComponent(apiKey)}`}`, {
        headers: { ...authHeader },
      });
      if (ownersRes.ok) {
        const ownersData = await ownersRes.json();
        for (const owner of ownersData.results || []) {
          ownerNames[owner.id] = `${owner.firstName} ${owner.lastName}`.trim();
        }
      }
    }

    // Normalize deals for the frontend
    const deals = data.results.map(deal => {
      const p = deal.properties;
      const ownerId = p.hubspot_owner_id;
      const ownerName = ownerNames[ownerId] || 'Unknown';

      // Map owner name to pod member (first name match)
      let podMember = 'Other';
      for (const [key, id] of Object.entries(OWNER_MAP)) {
        if (id && String(id) === String(ownerId)) {
          podMember = key.charAt(0).toUpperCase() + key.slice(1);
          break;
        }
      }
      // Fallback: fuzzy match on first name
      if (podMember === 'Other') {
        const first = ownerName.split(' ')[0].toLowerCase();
        if (OWNER_MAP[first] !== undefined || ['doug', 'michelle', 'rebecca', 'trice'].includes(first)) {
          podMember = first.charAt(0).toUpperCase() + first.slice(1);
        }
      }

      return {
        id: deal.id,
        name: p.dealname || 'Unnamed Deal',
        amount: p.amount ? parseFloat(p.amount) : null,
        stage: p.dealstage || '',
        closeDate: p.closedate || null,
        createDate: p.createdate || null,
        ownerId,
        ownerName,
        podMember,
        probability: p.hs_deal_stage_probability ? parseFloat(p.hs_deal_stage_probability) : null,
        description: p.description || '',
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        deals,
        total: data.total,
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal error', detail: err.message }),
    };
  }
};
