import { clientFor, json, readBody, RequestBodyError, requestOrigin, requireUser, sameOrigin } from '../server/supabase.js';
import { personalAccountsEnabled, validatePreferences } from '../server/resource-preferences.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { error: 'Method not allowed.' });
    }
    const url = new URL(req.url, requestOrigin(req));
    if (req.method === 'GET' && url.searchParams.get('action') === 'availability')
      return json(res, 200, { enabled: personalAccountsEnabled() });
    if (req.method === 'POST' && !sameOrigin(req))
      return json(res, 403, { error: 'Open this form on the RWN website and try again.' });
    if (!personalAccountsEnabled()) return json(res, 503, { error: 'Personal accounts are not open yet. Browse the directory without an account.' });
    const client = clientFor(req, res);
    const user = await requireUser(client, res);
    if (!user) return;
    if (req.method === 'GET') {
      const { data, error } = await client.from('rwn_resource_preferences')
        .select('topics,area,consent_version,updated_at').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return json(res, 200, { preferences: data });
    }
    const body = await readBody(req);
    if (body.action === 'clear') {
      const { error } = await client.from('rwn_resource_preferences').delete().eq('user_id', user.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }
    const preferences = body.action === 'save' && validatePreferences(body.preferences);
    if (!preferences) return json(res, 400, { error: 'Choose supported topics, enter a city or U.S. ZIP, and agree to save these answers.' });
    const { error } = await client.from('rwn_resource_preferences').upsert({
      user_id: user.id, ...preferences, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return json(res, 200, { ok: true });
  } catch (error) {
    if (error instanceof RequestBodyError) return json(res, error.status, { error: error.message });
    return json(res, 503, { error: 'Your preferences could not be loaded or saved. Please try again. The directory is still available.' });
  }
}
