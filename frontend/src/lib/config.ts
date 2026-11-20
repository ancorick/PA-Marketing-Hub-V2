/** The frontend talks to the backend only through its API; the address comes from VITE_API_URL. */
function readApiUrl(): string {
  const value = import.meta.env.VITE_API_URL?.trim();
  if (!value) {
    throw new Error('VITE_API_URL is not set. Copy frontend/.env.example to .env.local or set it on Netlify.');
  }
  return value.replace(/\/+$/, '');
}

export const API_URL = readApiUrl();
