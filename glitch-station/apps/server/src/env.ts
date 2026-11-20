export interface Env {
  ROOM: DurableObjectNamespace;
  /** Static client files, served from the same Worker (see wrangler.jsonc). */
  ASSETS?: Fetcher;
  /**
   * Optional comma separated list of origins allowed to open sockets and create
   * rooms, e.g. "https://glitch-station.example.workers.dev". Empty allows any.
   */
  ALLOWED_ORIGINS?: string;
}
