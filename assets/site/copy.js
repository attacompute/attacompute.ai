// Accessible Copy-to-Clipboard using Invoker Commands + fallback (MWG: copy-button)
const timers = new WeakMap();
let lastMessage = "";

function legacyCopy(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
  }
}

function report(button, ok) {
  const tip = button.nextElementSibling;
  clearTimeout(timers.get(button));
  button.removeAttribute("data-copied");
  button.removeAttribute("data-failed");
  let message = ok ? "Copied" : "Copy failed";
  if (message === lastMessage) message += "\u00A0";
  lastMessage = message;
  if (tip) tip.textContent = "";
  void button.offsetWidth;
  button.setAttribute(ok ? "data-copied" : "data-failed", "");
  requestAnimationFrame(() => {
    if (tip) tip.textContent = message;
  });
  timers.set(
    button,
    setTimeout(() => {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      if (tip) tip.textContent = "";
    }, 1800)
  );
}

export async function copyFromButton(button, target) {
  const raw = button.dataset.copyValue
    ? button.dataset.copyValue
    : target
      ? target.matches("input, textarea")
        ? target.value
        : target.innerText.trim()
      : "";
  if (!raw) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(raw);
    } else if (!legacyCopy(raw)) {
      throw new Error("Copy failed");
    }
    report(button, true);
  } catch {
    try {
      if (legacyCopy(raw)) {
        report(button, true);
      } else {
        report(button, false);
      }
    } catch {
      report(button, false);
    }
  }
}

export function initCopyButtons() {
  // Capture-phase listener for native Invoker Commands (`command="--copy"`)
  document.addEventListener(
    "command",
    (event) => {
      if (event.command === "--copy") {
        copyFromButton(event.source, event.target);
      }
    },
    true
  );

  // Fallback for browsers without CommandEvent (register only one path)
  if (!("CommandEvent" in window)) {
    document.addEventListener("click", (event) => {
      const button = event.target.closest('button[command="--copy"]');
      if (!button) return;
      const targetId = button.getAttribute("commandfor");
      const target = targetId ? document.getElementById(targetId) : null;
      copyFromButton(button, target);
    });
  }
}
