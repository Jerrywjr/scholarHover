let creating: Promise<void> | undefined;

/** Metadata parsing and model generation share Chrome's single offscreen document. */
export function ensureOffscreenDocument(): Promise<void> {
  return creating ??= (async () => {
    const exists = async () => (await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    })).length > 0;
    if (await exists()) return;
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Parse the linked paper HTML without executing page scripts, and run long model requests in a worker.',
      });
    } catch (error) { if (!await exists()) throw error; }
  })().finally(() => { creating = undefined; });
}
