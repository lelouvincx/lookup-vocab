const $ = (selector) => document.querySelector(selector);
let state,
  revealed = false,
  view = "review",
  busy = false,
  pending = null,
  pairingToken = null;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (at) =>
  new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
async function api(path, data) {
  const response = await fetch(
    "/api/" + path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Request failed. Refresh and try again.");
  return result;
}
async function action(work, message = "") {
  if (busy) return;
  busy = true;
  $("#error").hidden = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await work();
    if (message) $("#notice").textContent = message;
  } catch (error) {
    $("#error").hidden = false;
    $("#error").textContent = error.message;
  } finally {
    busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
// A failed request keeps its ID and payload. Retry cannot introduce a second lookup/review.
async function send(path, payload) {
  const signature = path + JSON.stringify(payload);
  if (!pending || pending.signature !== signature)
    pending = {
      signature,
      path,
      payload: { eventId: crypto.randomUUID(), ...payload },
    };
  const result = await api(path, pending.payload);
  pending = null;
  return result;
}
async function load() {
  const previous = state?.queue[0];
  state = await api("state");
  if (
    previous?.id !== state.queue[0]?.id ||
    previous?.version !== state.queue[0]?.version
  )
    revealed = false;
  $("#mode").textContent = state.local
    ? "Local development"
    : "Public access · Anyone can edit";
  $("#limit").value = state.dailyLimit;
  render();
}
function render() {
  $("#summary").innerHTML =
    `<span><svg class="icon" aria-hidden="true"><use href="#clock-icon"/></svg><strong>${state.dueCount}</strong> due</span><span><svg class="icon" aria-hidden="true"><use href="#add-icon"/></svg><strong>${state.newRemaining}</strong> new slots</span><span><svg class="icon" aria-hidden="true"><use href="#check-icon"/></svg><strong>${state.reviewed}</strong> reviewed</span>`;
  const card = state.queue[0];
  const box = $("#flashcard");
  box.setAttribute("aria-busy", "false");
  box.classList.toggle("empty", !card);
  if (!card) {
    const future = state.cards
      .filter((c) => c.status === "active" && c.introduced !== null)
      .sort((a, b) => a.due - b.due)[0];
    box.innerHTML = `<div class="empty-art"><svg class="icon" aria-hidden="true"><use href="#${state.cards.length ? "check-icon" : "book"}"/></svg></div><h2>${state.cards.length ? "You’re up to date" : "Your first word starts here"}</h2><p>${future ? `Next review: ${date(future.due)}. Come back when it’s time.` : state.cards.length ? "No cards available right now. Your new-card allowance resets at midnight." : "Save a word you’ve met, then make it part of your vocabulary."}</p><button id="empty-add" class="primary">Add a card</button>`;
    $("#empty-add").onclick = () => switchView("add");
  } else {
    const days = [1, 3, 7, 14, 30][Math.min(card.step, 4)];
    box.innerHTML = `<div class="card-meta"><span>${card.introduced === null ? "New card" : "Due review"}</span><span>${card.lookups} lookup${card.lookups === 1 ? "" : "s"}</span></div><div class="source" lang="en">${escape(card.source)}</div>${revealed ? `<div class="answer"><span>Vietnamese</span><p lang="vi">${escape(card.translation)}</p></div><div class="actions"><button id="forgot">Forgot<small>Again in 10 minutes</small></button><button class="primary" id="remembered">Remembered<small>In ${days} day${days === 1 ? "" : "s"}</small></button></div>` : '<button id="reveal" class="primary">Reveal meaning</button>'}`;
    if (revealed) {
      for (const grade of ["forgot", "remembered"])
        $("#" + grade).onclick = () =>
          action(async () => {
            await send("reviews", {
              cardId: card.id,
              version: card.version,
              grade,
            });
            revealed = false;
            await load();
          }, "Review saved");
    } else
      $("#reveal").onclick = () => {
        revealed = true;
        render();
        $("#remembered").focus();
      };
  }
  renderLibrary();
  $("#tokens").innerHTML = state.tokens
    .map(
      (t) =>
        `<div class="token-row"><span>Paired ${date(t.created)} · ${t.revoked ? "Revoked" : "Active"}</span>${t.revoked ? "" : `<button data-revoke="${escape(t.id)}">Revoke</button>`}</div>`,
    )
    .join("");
  document.querySelectorAll("[data-revoke]").forEach(
    (b) =>
      (b.onclick = () =>
        action(async () => {
          await send("tokens/revoke", { tokenId: b.dataset.revoke });
          await load();
        }, "Pairing token revoked")),
  );
}
function renderLibrary() {
  if (!state) return;
  const query = $("#search").value.toLocaleLowerCase();
  const status = $("#status").value;
  const cards = state.cards.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      (c.source + " " + c.translation).toLocaleLowerCase().includes(query),
  );
  $("#cards").innerHTML = cards.length
    ? cards
        .map(
          (c) =>
            `<article class="library-card"><h2 lang="en">${escape(c.source)}</h2><p lang="vi">${escape(c.translation)}</p><p class="hint">${c.status === "deleted" ? "Removed from deck" : escape(c.status)} · ${c.lookups} lookups · ${c.introduced === null ? "Not reviewed yet" : `Next review ${date(c.due)}`}</p>${c.status === "active" ? `<button data-card="${escape(c.id)}" data-status="suspended">Suspend</button>` : `<button data-card="${escape(c.id)}" data-status="active">Restore card</button>`}${c.status === "deleted" ? "" : `<button class="danger" data-card="${escape(c.id)}" data-status="deleted">Remove from deck</button>`}</article>`,
        )
        .join("")
    : "<p>No matching cards. Try another search or status.</p>";
  document.querySelectorAll("[data-card]").forEach(
    (b) =>
      (b.onclick = () =>
        action(async () => {
          await send("cards", {
            cardId: b.dataset.card,
            status: b.dataset.status,
          });
          await load();
        }, "Card updated")),
  );
}
function switchView(next) {
  view = next;
  $("#notice").textContent = "";
  $("#error").hidden = true;
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== view));
  document
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.dataset.view === view
        ? b.setAttribute("aria-current", "page")
        : b.removeAttribute("aria-current"),
    );
  if (view !== "settings") {
    $("#pair-result").hidden = true;
    $("#paired-token").value = "";
  }
}
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
$("#refresh").onclick = () => action(load);
$("#search").oninput = renderLibrary;
$("#status").onchange = renderLibrary;
$("#add-form").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    const values = Object.fromEntries(new FormData(e.target));
    // Timestamp is stable while retrying the same form content.
    const signature = JSON.stringify(values);
    if (e.target.dataset.signature !== signature) {
      e.target.dataset.signature = signature;
      e.target.dataset.capturedAt = new Date().toISOString();
    }
    await send("manual", {
      ...values,
      sourceLanguage: "en",
      targetLanguage: "vi",
      capturedAt: e.target.dataset.capturedAt,
    });
    e.target.reset();
    delete e.target.dataset.signature;
    await load();
    switchView("review");
  }, "Card saved");
};
$("#limit-form").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    await send("settings", { dailyLimit: Number($("#limit").value) });
    await load();
  }, "Daily limit saved");
};
$("#pair").onclick = () =>
  action(async () => {
    if (!pairingToken) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      pairingToken = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    }
    await send("tokens", { token: pairingToken });
    $("#paired-token").value = pairingToken;
    $("#pair-result").hidden = false;
    pairingToken = null;
    await load();
  }, "Token created. Copy it into your extension.");
$("#hide-token").onclick = () => {
  $("#paired-token").value = "";
  $("#pair-result").hidden = true;
};
$("#backup").onclick = () =>
  action(async () => {
    const backup = await api("backup");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `lookup-${state.day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "Backup downloaded");
$("#restore").onchange = (e) =>
  action(async () => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4_900_000)
      throw new Error("Backup exceeds 4.9 MB. Use a smaller backup.");
    if (
      !confirm(
        "Replace all cards and review history with this backup? Download a current backup first.",
      )
    )
      return;
    const backup = JSON.parse(await file.text());
    await send("restore", { backup });
    await load();
    e.target.value = "";
  }, "Backup restored");
document.addEventListener(
  "blur",
  (e) => {
    if (e.target.matches?.("input,textarea"))
      e.target.setAttribute(
        "aria-invalid",
        String(e.target.matches(":user-invalid")),
      );
  },
  true,
);
document.addEventListener("input", (e) => {
  if (e.target.getAttribute?.("aria-invalid") === "true")
    e.target.setAttribute(
      "aria-invalid",
      String(e.target.matches(":user-invalid")),
    );
});
// Reopening the review screen picks up desktop captures without polling or touching intake forms.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && view === "review" && !busy)
    action(load);
});
window.addEventListener("focus", () => {
  if (view === "review" && !busy) action(load);
});
action(load);
