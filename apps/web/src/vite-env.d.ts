/// <reference types="vite/client" />

// Build-time settings. Everything here is bundled into the browser: never put secrets here.
interface ImportMetaEnv {
  /** Address of the Bitsomeggle server, e.g. https://bitsomeggle.onrender.com */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
