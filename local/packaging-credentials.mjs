import { loadApiToken, saveApiToken } from './jira-credentials.mjs';

// Authentication is a runtime concern. Optional local migration must never
// prevent generating a portable app or put credentials inside its output.
export async function prepareLocalCredentials({ releaseBuild = process.env.PJB_RELEASE_BUILD === '1', load = loadApiToken, save = saveApiToken, warn = console.warn } = {}) {
  if (releaseBuild) return;
  try {
    const credential = await load();
    if (credential) await save(credential.token);
  } catch {
    // Do not print the original error: it may contain sensitive input.
    warn('Jira credentials were not copied into private storage on this PC. Packaging will continue. Check config/credentials.json against config/credentials.example.json, or enter your API token in the app. No credentials are included in the package.');
  }
}
