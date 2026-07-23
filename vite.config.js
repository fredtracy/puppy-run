import { defineConfig } from 'vite';

export default defineConfig({
  base: '/puppy-run/',
  server: {
    // Fixed and reserved so it never collides with other local projects'
    // dev servers, and strictPort so it fails loudly instead of silently
    // drifting to a different port if something else is already on it.
    port: 7331,
    strictPort: true,
  },
});
