/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_URL?: string;
  // Add other env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly hot?: {
    accept(callback?: () => void): void;
    accept(dep: string, callback?: () => void): void;
    accept(deps: string[], callback?: (modules: any[]) => void): void;
    dispose(callback: (data: any) => void): void;
    decline(): void;
    invalidate(): void;
    data: any;
  };
  readonly glob: <T = any>(pattern: string, options?: { eager?: boolean; query?: string; import?: string | 'default' }) => Record<string, T>;
}
