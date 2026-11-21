/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "true" shows development aids (Dev inbox) in a demo deploy; never set it in production. */
  readonly VITE_DEMO_MODE?: string;
  /** The Academy website page with the public sign-up form (AUD-20); the top bar links to it when set. */
  readonly VITE_PUBLIC_SIGNUP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
