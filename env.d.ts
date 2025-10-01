/// <reference types="vite/client" />
/// <reference types="chrome-types" />

interface ImportMetaEnv {
  readonly MODE: 'development' | 'production';
  // add more env vars here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __IS_DEV__: boolean;
declare const __VERSION__: string;
declare const __GIT_HASH__: string;
