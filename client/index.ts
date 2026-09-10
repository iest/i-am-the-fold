import { isValidFold, solveWork } from "../util-client";

const settings = document.querySelector<HTMLScriptElement>(
  "script[data-fold-worker]",
);
const marker = document.getElementById("current-fold");
const fold = window.innerHeight;

function solveInWorker(challenge: string): Promise<string | null> {
  const workerUrl = settings?.dataset.foldWorker;
  if (!window.Worker || !workerUrl) return solveWork(challenge);
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { type: "module" });
    const timeout = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, 11000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(typeof event.data === "string" ? event.data : null);
    };
    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(error);
    };
    worker.postMessage(challenge);
  });
}

async function saveFold() {
  const response = await fetch("/api", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to request challenge");
  const { challenge, token } = await response.json();
  if (typeof challenge !== "string" || typeof token !== "string") return;
  const proof = await solveInWorker(challenge);
  if (proof === null) return;
  const saved = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fold, proof, token }),
  });
  if (!saved.ok && saved.status !== 403) throw new Error("Unable to save fold");
}

const topLevel = window.top === window.self;
if (topLevel && marker && isValidFold(fold)) {
  marker.style.top = `${fold}px`;
  marker.querySelector("span")!.textContent = String(fold);
  marker.hidden = false;
  void saveFold().catch((error) => console.error("Error saving fold", error));
}

const posthogKey = settings?.dataset.posthogKey;
if (topLevel && posthogKey) {
  const startAnalytics = () => {
    void import("./analytics")
      .then(({ startAnalytics }) => startAnalytics(posthogKey))
      .catch((error) => console.error("Unable to start analytics", error));
  };
  if (document.readyState === "complete") startAnalytics();
  else window.addEventListener("load", startAnalytics, { once: true });
}
