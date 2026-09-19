export async function requestJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal.reason);
  if (options.signal?.aborted) relayAbort();
  else options.signal?.addEventListener("abort", relayAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const result = response.status === 204 ? {} : await response.json();
    return { response, result };
  } catch (error) {
    if (timedOut) throw new Error("The server took too long to respond. Check the connection and refresh the latest records before retrying.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
  }
}
