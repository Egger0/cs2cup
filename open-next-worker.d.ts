declare module '*/.open-next/worker.js' {
  const generatedWorker: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
  }
  export default generatedWorker
}
