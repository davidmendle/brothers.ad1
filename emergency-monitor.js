const labels = { fire: "Fire", water: "Water", storm: "Storm", rescue: "Rescue", hazardous_material: "Hazardous material", other: "Other" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const time = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not received";

export function createEmergencyMonitor({ request, getContext, createDispatch, notify }) {
  let host = null;
  let identity = "";
  let controller;
  let timer;
  let status = null;
  let incidents = [];
  let selectedId = "";
  let busy = false;
  let loading = false;
  let lastRefresh = "";
  let error = "";
  let generation = 0;

  function selected() { return incidents.find((item) => item.id === selectedId); }
  function updateMessage() {
    if (!host?.isConnected) return;
    const node = host.querySelector("[data-emergency-status]");
    node.textContent = error || (loading ? "Checking feed..." : !status?.runtime?.available
      ? "Shared incident storage is unavailable. Account connection required."
      : status.configurationValid === false ? "Incident feed configuration is invalid. Manual incident entry is available."
      : !status.configured ? "No radio or dispatch feed connected. Manual incident entry is available."
      : `Connected to incident storage. Last checked ${time(lastRefresh)}.`);
    node.classList.toggle("emergency-error", Boolean(error || (status && !status.runtime?.available)));
    host.querySelector('[data-emergency-action="refresh"]').disabled = loading || busy;
    host.querySelectorAll("[data-emergency-manual] input, [data-emergency-manual] select, [data-emergency-manual] textarea, [data-emergency-manual] button")
      .forEach((node) => { node.disabled = busy || !status?.runtime?.available; });
  }

  function paintList() {
    if (!host?.isConnected) return;
    host.querySelector("[data-emergency-count]").textContent = `${incidents.length} recent incident${incidents.length === 1 ? "" : "s"}`;
    host.querySelector("[data-emergency-list]").innerHTML = incidents.length ? incidents.map((item) => `
      <button type="button" class="emergency-incident${item.id === selectedId ? " selected" : ""}" data-emergency-action="select" data-id="${esc(item.id)}" aria-pressed="${item.id === selectedId}">
        <span class="emergency-incident-heading"><strong>${esc(labels[item.type] || item.type)}</strong><span class="emergency-badge">${esc(item.reviewStatus)}</span></span>
        <span>${esc(item.location)}</span><small>${esc(item.sourceLabel)} | ${esc(time(item.occurredAt))}</small>
      </button>`).join("") : '<p class="emergency-empty">No incidents received.</p>';
  }

  function paintSources() {
    const node = host?.querySelector("[data-emergency-sources]");
    if (!node) return;
    const sources = status?.sources || [];
    const signature = JSON.stringify(sources);
    if (node.dataset.signature === signature) return;
    node.dataset.signature = signature;
    node.innerHTML = sources.map((source) => `
      <div class="emergency-source"><div><strong>${esc(source.label)}</strong><span>${esc(source.area)}</span></div>
        ${source.streamUrl ? `<audio controls preload="none" referrerpolicy="no-referrer" aria-label="${esc(source.label)} radio audio" src="${esc(source.streamUrl)}"></audio>` : "<span>Dispatch data feed</span>"}
      </div>`).join("");
  }

  function paintDetail() {
    if (!host?.isConnected) return;
    const item = selected();
    const detail = host.querySelector("[data-emergency-detail]");
    if (!item) { detail.innerHTML = '<p class="emergency-empty">Select an incident to review.</p>'; return; }
    const contactId = detail.querySelector('[name="contactId"]')?.value || "";
    const context = getContext();
    detail.innerHTML = `
      <h3>${esc(labels[item.type] || item.type)} incident</h3>
      <dl class="emergency-facts">
        <div><dt>Location</dt><dd>${esc(item.location)}</dd></div>
        <div><dt>Reported</dt><dd>${esc(time(item.occurredAt))}</dd></div>
        <div><dt>Units</dt><dd>${esc((item.units || []).join(", ") || "Not supplied")}</dd></div>
        <div><dt>Source</dt><dd>${esc(item.sourceLabel)} | ${esc(item.eventId)}</dd></div>
      </dl>
      <p class="emergency-summary">${esc(item.summary || "No incident summary supplied.")}</p>
      ${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source report</a>` : ""}
      <div class="emergency-review">
        <span class="emergency-badge">${esc(item.reviewStatus)}</span>
        ${!item.linkedRecordId ? `<button type="button" data-emergency-action="review" ${busy ? "disabled" : ""}>Mark reviewed</button><button type="button" data-emergency-action="dismiss" ${busy ? "disabled" : ""}>Dismiss</button>` : '<strong>Saved to dispatch workspace</strong>'}
      </div>
      ${!item.linkedRecordId ? `<form data-emergency-dispatch>
        <label><span>Existing customer (optional)</span><select name="contactId"><option value="">No customer selected</option>${(context.contacts || []).map((contact) => `<option value="${esc(contact.id)}"${contact.id === contactId ? " selected" : ""}>${esc(contact.name)}${contact.property ? ` | ${esc(contact.property)}` : ""}</option>`).join("")}</select></label>
        <button type="submit" ${busy || item.reviewStatus !== "reviewed" || !context.writable ? "disabled" : ""}>Create dispatch record</button>
      </form>` : `<a href="#module/routeplanner">Open route planning</a>`}`;
  }

  async function refresh() {
    if (!host?.isConnected || loading || busy || document.visibilityState === "hidden") return;
    const version = generation;
    loading = true;
    controller = new AbortController();
    const signal = controller.signal;
    updateMessage();
    try {
      const nextStatus = await request("/api/emergency/status", { signal });
      const next = nextStatus.runtime?.available ? await request("/api/emergency/incidents?limit=100", { signal }) : { incidents: [] };
      if (version !== generation) return;
      status = nextStatus;
      const previous = selected();
      incidents = next.incidents || [];
      if (!selected()) selectedId = incidents[0]?.id || "";
      lastRefresh = new Date().toISOString();
      error = "";
      paintList();
      paintSources();
      // Refresh the inbox without disturbing a customer selection or manual draft.
      if (!previous || previous.id !== selectedId || previous.reviewStatus !== selected()?.reviewStatus || previous.linkedRecordId !== selected()?.linkedRecordId) paintDetail();
    } catch (cause) {
      if (version !== generation || signal.aborted) return;
      error = cause.message || "Incident feed could not be refreshed.";
    } finally {
      if (version === generation) {
        loading = false;
        updateMessage();
        clearTimeout(timer);
        timer = setTimeout(refresh, 15000);
      }
    }
  }

  async function mutate(operation) {
    if (busy) return;
    controller?.abort();
    clearTimeout(timer);
    const version = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    const isCurrent = () => version === generation && !signal.aborted;
    loading = false;
    busy = true;
    error = "";
    updateMessage();
    paintDetail();
    try { await operation(isCurrent, signal); }
    catch (cause) { if (isCurrent()) error = cause.message || "Incident could not be saved."; }
    finally {
      if (version === generation) {
        busy = false;
        paintList();
        paintDetail();
        updateMessage();
        timer = setTimeout(refresh, 15000);
      }
    }
  }

  function onClick(event) {
    const button = event.target.closest("[data-emergency-action]");
    if (!button || !host.contains(button)) return;
    const action = button.dataset.emergencyAction;
    if (action === "refresh") return refresh();
    if (busy) return;
    if (action === "select") { selectedId = button.dataset.id; paintList(); paintDetail(); return; }
    const item = selected();
    if (!item) return;
    if (action === "review" || action === "dismiss") return mutate(async (isCurrent, signal) => {
      const result = await request(`/api/emergency/incidents/${encodeURIComponent(item.id)}`, {
        method: "PATCH", signal, body: JSON.stringify({ reviewStatus: action === "review" ? "reviewed" : "dismissed" })
      });
      if (!isCurrent()) return;
      Object.assign(item, result.incident);
    });
  }

  function onSubmit(event) {
    const form = event.target.closest("[data-emergency-manual], [data-emergency-dispatch]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.hasAttribute("data-emergency-manual")) return mutate(async (isCurrent, signal) => {
      const payload = Object.fromEntries(data);
      payload.units = String(payload.units || "").split(",").map((v) => v.trim()).filter(Boolean);
      payload.occurredAt = new Date(payload.occurredAt).toISOString();
      if (!payload.sourceUrl) delete payload.sourceUrl;
      const result = await request("/api/emergency/incidents", { method: "POST", signal, body: JSON.stringify(payload) });
      if (!isCurrent()) return;
      const next = await request("/api/emergency/incidents?limit=100", { signal });
      if (!isCurrent()) return;
      selectedId = result.id;
      incidents = next.incidents || [];
      form.reset();
      notify(result.duplicate ? "Incident already exists" : "Incident saved for review");
    });
    const item = selected();
    if (!item || item.reviewStatus !== "reviewed") return;
    return mutate(async (isCurrent, signal) => {
      const recordId = await createDispatch(item, String(data.get("contactId") || ""));
      if (!isCurrent()) return;
      const result = await request(`/api/emergency/incidents/${encodeURIComponent(item.id)}`, {
        method: "PATCH", signal, body: JSON.stringify({ linkedRecordId: recordId, reviewStatus: "linked" })
      });
      if (!isCurrent()) return;
      Object.assign(item, result.incident);
      notify("Incident linked to dispatch and route planning");
    });
  }

  function onMediaError(event) {
    if (event.target.tagName === "AUDIO") {
      error = "The radio stream is unavailable. Incident records remain accessible.";
      updateMessage();
    }
  }

  function attach(nextHost) {
    const context = getContext();
    if (!nextHost || !context.allowed) { detach(); return; }
    if (context.identity !== identity) {
      detach();
      identity = context.identity;
      status = null; incidents = []; selectedId = ""; lastRefresh = ""; error = "";
    }
    if (host === nextHost) return;
    detach();
    host = nextHost;
    host.innerHTML = `
      <div class="panel-head"><div><h2>Emergency response monitor</h2><span data-emergency-count>Recent incidents</span></div><button type="button" data-emergency-action="refresh">Refresh feed</button></div>
      <p data-emergency-status role="status"></p>
      <div data-emergency-sources></div>
      <div class="emergency-layout"><div data-emergency-list class="emergency-list" aria-label="Recent emergency incidents"></div><div data-emergency-detail class="emergency-detail"></div></div>
      <details class="emergency-manual"><summary>Log a reported incident</summary>
        <form data-emergency-manual class="form-grid">
          <label><span>Incident reference</span><input name="eventId" required maxlength="160" /></label>
          <label><span>Incident type</span><select name="type">${Object.entries(labels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
          <label><span>Location</span><input name="location" required maxlength="300" /></label>
          <label><span>Reported at</span><input name="occurredAt" type="datetime-local" required /></label>
          <label><span>Responding units</span><input name="units" maxlength="600" placeholder="Engine 1, Ladder 2" /></label>
          <label><span>Source report URL</span><input name="sourceUrl" type="url" placeholder="https://" /></label>
          <label class="full"><span>Incident summary</span><textarea name="summary" maxlength="2000" rows="3"></textarea></label>
          <button type="submit">Save incident</button>
        </form>
      </details>`;
    host.addEventListener("click", onClick);
    host.addEventListener("submit", onSubmit);
    host.addEventListener("error", onMediaError, true);
    paintList(); paintSources(); paintDetail();
    refresh();
  }

  function detach() {
    generation += 1;
    clearTimeout(timer);
    controller?.abort();
    loading = false; busy = false;
    if (host) {
      host.removeEventListener("click", onClick);
      host.removeEventListener("submit", onSubmit);
      host.removeEventListener("error", onMediaError, true);
      host.querySelectorAll("audio").forEach((audio) => audio.pause());
    }
    host = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") clearTimeout(timer);
    else refresh();
  });
  return { attach, detach };
}
