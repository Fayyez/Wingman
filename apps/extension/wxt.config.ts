import { defineConfig } from 'wxt';

const apiUrl = (process.env.WXT_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const googleEnabled = Boolean(process.env.WXT_GOOGLE_CLIENT_ID);

export default defineConfig({
  // WXT_OUT_DIR lets the E2E build into a separate directory without clobbering the normal build.
  outDir: process.env.WXT_OUT_DIR || '.output',
  manifest: {
    name: 'Wingman',
    description: 'Reply, topic and guide suggestions inside WhatsApp Web. Never sends for you.',
    permissions: googleEnabled ? ['storage', 'identity'] : ['storage'],
    // Only the configured Wingman API origin; no other network access.
    host_permissions: [`${new URL(apiUrl).origin}/*`],
  },
});
