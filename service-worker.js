// background/service-worker.js
// Gere OAuth HubSpot + tous les appels API CRM

import { getToken, saveToken, clearToken, isAuthenticated } from '../utils/storage.js';
import { HubSpotAPI } from '../utils/hubspot-api.js';

// ⚠️ Remplace par ton Client ID HubSpot (developers.hubspot.com)
const HUBSPOT_CLIENT_ID = '049bb399-8111-4f37-8890-2a05880ff1ff';

// URL du backend Vercel pour l'echange de code OAuth
const TOKEN_EXCHANGE_URL = 'https://linkedin-to-hubspot.vercel.app/api/exchange-token';

const SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write'
].join(' ');

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    CREATE_IN_HUBSPOT: () => handleCreateInHubSpot(message.payload),
    CHECK_AUTH:        () => isAuthenticated(),
    LAUNCH_AUTH:       () => launchOAuthFlow(),
    LOGOUT:            () => clearToken().then(() => ({ success: true }))
  };

  const handler = handlers[message.action];
  if (handler) {
    handler().then(sendResponse).catch(err => {
      console.error('[HubSpot Extension]', message.action, err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // reponse async obligatoire
  }
});

// ─── OAUTH FLOW ───────────────────────────────────────────────────────────────

async function launchOAuthFlow() {
  const redirectUri = chrome.identity.getRedirectURL('hubspot');

  const authUrl = new URL('https://app.hubspot.com/oauth/authorize');
  authUrl.searchParams.set('client_id', HUBSPOT_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES);

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    });
  } catch (err) {
    throw new Error('AUTH_CANCELLED');
  }

  const code = new URL(responseUrl).searchParams.get('code');
  if (!code) throw new Error('NO_AUTH_CODE');

  // Echange code <-> token via backend securise
  const tokenRes = await fetch(TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri })
  });

  if (!tokenRes.ok) throw new Error('TOKEN_EXCHANGE_FAILED');

  const { access_token, expires_in, hub_id } = await tokenRes.json();
  await saveToken(access_token, expires_in, hub_id);
  return { success: true, portalId: hub_id };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

async function handleCreateInHubSpot(profileData) {
  let token = await getToken();

  if (!token) {
    try {
      await launchOAuthFlow();
      token = await getToken();
      if (!token) return { success: false, error: 'AUTH_REQUIRED' };
    } catch {
      return { success: false, error: 'AUTH_REQUIRED' };
    }
  }

  return processCreation(token, profileData);
}

async function processCreation(token, profileData) {
  const api = new HubSpotAPI(token);

  try {
    // 1. Entreprise
    let companyResult = null;
    if (profileData.companyName) {
      companyResult = await api.findOrCreateCompany({
        companyName: profileData.companyName,
        companyLinkedinUrl: profileData.companyLinkedinUrl
      });
    }

    // 2. Contact
    const contactResult = await api.findOrCreateContact(profileData);

    // 3. Association
    if (contactResult.id && companyResult?.id) {
      await api.associateContactToCompany(contactResult.id, companyResult.id);
    }

    return {
      success: true,
      contact: {
        id: contactResult.id,
        created: contactResult.created,
        updated: contactResult.updated
      },
      company: companyResult ? {
        id: companyResult.id,
        created: companyResult.created
      } : null
    };
  } catch (err) {
    if (err.message === 'TOKEN_EXPIRED') {
      await clearToken();
      return { success: false, error: 'TOKEN_EXPIRED' };
    }
    throw err;
  }
}
