/// <reference types="vite/client" />
/// <reference types="chrome-types" />

interface ImportMetaEnv {
  readonly MODE: 'development' | 'production';
  // add more env vars here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
