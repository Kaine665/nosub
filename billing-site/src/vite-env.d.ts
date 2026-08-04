/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PADDLE_ENVIRONMENT: 'sandbox' | 'production';
  readonly VITE_PADDLE_CLIENT_TOKEN: string;
  readonly VITE_PADDLE_MONTHLY_PRICE_ID: string;
  readonly VITE_PADDLE_ANNUAL_PRICE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
