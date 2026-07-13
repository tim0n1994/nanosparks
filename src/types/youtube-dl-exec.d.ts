declare module 'youtube-dl-exec' {
  function youtubedl(url: string, options?: Record<string, unknown>): Promise<void>;
  export default youtubedl;
}
