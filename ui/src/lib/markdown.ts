import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

// Fix 132: add rel="noopener noreferrer" to outbound (http/https) links.
// In the Tauri webview a link click took the whole app to that address; rel is a
// security layer, while the actual behavior (opening in an external browser) is
// provided by the delegated click interceptor in ChatThread + the Rust
// on_navigation guard. Internal anchors (#hash or scheme-less) are left untouched.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return;
  const href = node.getAttribute("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Converts agent replies from markdown -> safe HTML (heading/list/table/code).
export function renderMarkdown(text: string): string {
  if (!text) return "";
  let html = marked.parse(text, { async: false }) as string;
  // Copy button on code blocks: each <pre> is wrapped in a .code-block wrapper,
  // with a .code-copy button added in front. DOMPurify allows button + class +
  // data-* + type + aria/title; no onclick — the click is caught by the
  // document-wide delegated listener below (Claude Code style).
  html = html.replace(
    /<pre>/g,
    '<div class="code-block"><button class="code-copy" type="button" data-copy aria-label="Copy" title="Copy"></button><pre>',
  );
  html = html.replace(/<\/pre>/g, "</pre></div>");
  return DOMPurify.sanitize(html);
}

// Single document-wide listener: on a .code-copy click it copies the sibling
// <pre> text to the clipboard and applies a temporary .copied marker to the
// button. Works everywhere renderMarkdown is rendered (chat, reports,
// cross-agent); no per-component wiring needed.
function copyText(text: string): void {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  } catch {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* silent */
  }
}

if (
  typeof document !== "undefined" &&
  !(window as unknown as { __codeCopyWired?: boolean }).__codeCopyWired
) {
  (window as unknown as { __codeCopyWired?: boolean }).__codeCopyWired = true;
  document.addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest?.(".code-copy");
    if (!btn) return;
    const wrap = btn.closest(".code-block");
    const code = wrap?.querySelector("pre")?.textContent ?? "";
    if (!code) return;
    e.preventDefault();
    e.stopPropagation();
    copyText(code);
    btn.classList.add("copied");
    window.setTimeout(() => btn.classList.remove("copied"), 1400);
  });
}
