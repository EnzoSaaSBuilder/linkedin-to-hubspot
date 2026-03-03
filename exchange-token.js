// api/exchange-token.js
// Vercel Serverless Function - Echange du code OAuth contre un access_token
// Le client_secret ne se trouve QUE dans les variables d'environnement Vercel
// et n'est jamais expose dans l'extension Chrome.

export default async function handler(req, res) {
  // CORS : autorise uniquement les extensions Chrome
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, redirectUri } = req.body;

  if (!code || !redirectUri) {
    return res.status(400).json({ error: 'Missing code or redirectUri' });
  }

  try {
    const tokenResponse = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     process.env.HUBSPOT_CLIENT_ID,     // Variable Vercel
        client_secret: process.env.HUBSPOT_CLIENT_SECRET, // Variable Vercel - JAMAIS dans l'extension
        redirect_uri:  redirectUri,
        code
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('HubSpot token error:', errText);
      return res.status(400).json({ error: 'Token exchange failed' });
    }

    const tokenData = await tokenResponse.json();

    // Recuperer le portal ID depuis l'access token
    const infoResponse = await fetch('https://api.hubapi.com/oauth/v1/access-tokens/' + tokenData.access_token);
    const infoData = infoResponse.ok ? await infoResponse.json() : {};

    return res.status(200).json({
      access_token: tokenData.access_token,
      expires_in:   tokenData.expires_in,
      hub_id:       infoData.hub_id || null
    });

  } catch (err) {
    console.error('Exchange token error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
