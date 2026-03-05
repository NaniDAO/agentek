/**
 * Throws an error if the fetch response is not OK.
 */
export async function assertOkResponse(
  response: Response,
  context: string,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`${context}: ${response.status} ${response.statusText}`);
  }
}
