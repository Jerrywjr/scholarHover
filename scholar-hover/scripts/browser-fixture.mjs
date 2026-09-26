import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Headless Chrome cannot answer its native optional-host permission dialog.
 * Copy the exact built extension into a disposable profile and pre-grant HTTPS
 * hosts in that fixture's manifest. Code, routing, scripting, UI, IDB and model
 * worker stay unchanged. This does NOT verify the native permission dialog.
 * Popup permission request/denial behavior has separate DOM tests.
 */
export async function prepareBrowserFixture(profile) {
  const extension = path.join(profile, 'extension');
  await cp(path.resolve('dist'), extension, { recursive: true });
  const filename = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  manifest.host_permissions = [...new Set([...manifest.host_permissions, 'https://*/*'])];
  await writeFile(filename, JSON.stringify(manifest, null, 2));
  return extension;
}

/** Explicit activation via the real trusted popup RPC; no production test hook. */
export async function enableHoverFixture(context, extensionId) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const result = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'SET_HOVER_ENABLED', enabled: true }));
  if (!result?.ok || !result.data.enabled) throw new Error(`Could not enable hover fixture: ${result?.error ?? 'unexpected state'}`);
  await popup.close();
}
