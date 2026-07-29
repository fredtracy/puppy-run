import { defineConfig } from 'vite';

export default defineConfig({
  base: '/puppy-run/',
  build: {
    // main.js uses top-level await to hand the main thread back to the loading
    // screen mid-build (see the `await`s around generateWorld). Vite's default
    // target is es2020, which predates it and fails the build outright.
    target: 'esnext',
  },
  server: {
    // Fixed and reserved so it never collides with other local projects'
    // dev servers, and strictPort so it fails loudly instead of silently
    // drifting to a different port if something else is already on it.
    port: 7331,
    strictPort: true,
  },
});
