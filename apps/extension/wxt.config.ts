import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Wingman (spike)',
    description: 'M0-03 debug tool: validates the WhatsApp Web adapter. Never sends messages.',
    permissions: ['storage'],
  },
});
