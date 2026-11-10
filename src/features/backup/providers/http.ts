function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Bounded exponential backoff for transient provider failures (429 / 5xx /
 * network). Request bodies are Blobs or strings in this project, so retries
 * can safely re-send the same body.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 2,
): Promise<Response> {
  let attempt = 0
  for (;;) {
    try {
      const response = await fetch(input, init)
      const transient = response.status === 429 || response.status >= 500
      if (transient && attempt < retries) {
        await wait(500 * 2 ** attempt + Math.random() * 250)
        attempt += 1
        continue
      }
      return response
    } catch (error) {
      if (attempt >= retries) throw error
      await wait(500 * 2 ** attempt + Math.random() * 250)
      attempt += 1
    }
  }
}
