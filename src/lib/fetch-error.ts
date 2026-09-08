/**
 * Pulls an error message out of a failed response. A crashed route can return
 * an empty body or an HTML error page, so parsing JSON unconditionally throws
 * and loses the real failure.
 */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // Not JSON — fall through to a status-based message.
  }
  return `${fallback} (HTTP ${response.status})`;
}
