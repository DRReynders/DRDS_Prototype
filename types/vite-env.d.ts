// Ambient types for the ROOT TypeScript project only.
//
// test/delivery-resilience.ts imports the website's Snapshot client so the real
// streaming and recovery logic can be exercised offline. That pulls
// website/src/lib/config.ts into this project, which reads `import.meta.env` —
// a Vite construct the backend's tsconfig knows nothing about.
//
// Declaring it here keeps two things true at once:
//
//   · `import.meta.env.DEV` stays written EXACTLY that way in config.ts, which
//     is what lets Vite replace it with `false` in a production build and strip
//     the dev-only localhost fallback out of the shipped bundle. Reading it
//     through a variable defeats that and ships a dev URL to real visitors.
//   · the backend `tsc --noEmit` still typechecks that file.
//
// Scoped to this project on purpose: `astro check` runs against
// website/tsconfig.json, which never sees this file and keeps using Astro's own
// (more precise) declaration.
interface ImportMeta {
  readonly env: Record<string, unknown> & { readonly DEV?: boolean };
}
