/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  glob<T = string>(
    pattern: string,
    options?: { eager?: boolean; import?: string; query?: string },
  ): Record<string, () => Promise<{ default: T; [key: string]: unknown }>>
}

declare module '*.css' {}
