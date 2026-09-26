// An autonomous browser agent in the style of Browser Use: observe the page,
// let the model pick one action, execute it, feed the outcome back, repeat.
//
// Unlike lib/browser-lister.ts (a fixed Playwright script), nothing here knows
// what the page looks like. Every click and keystroke is chosen by the LLM from
// a numbered list of interactive elements plus an annotated screenshot.
//
// Self-contained on purpose: only `playwright` and `openai` are imported, with no
// `@/` aliases, so a plain Node script (with type stripping) can import it.
// Not wired into the app. See docs/browser-agent.md.
import { chromium } from 'playwright';
import type { BrowserContext, Page, Route } from 'playwright';
import OpenAI from 'openai';

// ---------------------------------------------------------------- types

export type AgentAction = { name: string; args: Record<string, unknown> };

export type AgentStep = {
  step: number;
  url: string;
  title: string;
  /** The model's short explanation for this action. */
  reason: string;
  action: AgentAction | null;
  /** What happened, in words the model saw on the next step. */
  outcome: string;
  error?: string;
  /** JPEG (base64, no prefix) of the page the model was looking at, index badges drawn on. */
  screenshot: string;
  ms: number;
};

export type AgentOptions = {
  /** Natural-language task. */
  goal: string;
  startUrl: string;
  /** Hosts the agent may navigate to and submit to (a host also allows its subdomains). */
  allowedHosts: string[];
  /** Hosts the agent may navigate to and read, but never send a non-GET request to. */
  readOnlyHosts?: string[];
  /** Named files the upload action may attach by name: URL, path relative to startUrl, or data URL. */
  files?: Record<string, string>;
  maxSteps?: number;
  /** Hard wall-clock cap for the whole run. */
  timeoutMs?: number;
  model?: string;
  headless?: boolean;
  /** Screenshot detail sent to the model. */
  imageDetail?: 'low' | 'high' | 'auto';
  viewport?: { width: number; height: number };
  onStep?: (step: AgentStep) => void | Promise<void>;
};

export type AgentResult = {
  success: boolean;
  summary: string;
  /** What the model returned in done(); parsed as JSON when it is JSON. */
  result?: unknown;
  steps: AgentStep[];
  /** JPEG (base64) of the page when the run ended. */
  finalScreenshot?: string;
  finalUrl?: string;
  /** Requests the safety layer refused. */
  blocked: string[];
  ms: number;
};

// ---------------------------------------------------------------- observation (runs in the page)

type ElementInfo = {
  i: number;
  tag: string;
  role?: string;
  type?: string;
  name: string;
  value?: string;
  placeholder?: string;
  options?: string[];
  selected?: string;
  checked?: boolean;
  disabled?: boolean;
  required?: boolean;
  href?: string;
  where: 'in view' | 'above' | 'below';
  /** Something else is drawn on top of its centre (a banner, a modal). */
  covered?: boolean;
};

type Observation = {
  elements: ElementInfo[];
  omitted: number;
  text: string;
  scroll: string;
};

/** Serialised by Playwright and run inside the page. Keep it free of outer references. */
function observePage(opts: { maxElements: number; maxText: number; badges: boolean }): Observation {
  const clean = (s: string | null | undefined, max = 80) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  };
  document.querySelectorAll('[data-agent-id]').forEach((el) => el.removeAttribute('data-agent-id'));
  document.getElementById('__agent_badges')?.remove();

  const selector = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]',
    '[role=option]', '[role=combobox]', '[role=switch]', '[role=textbox]',
    '[contenteditable=""]', '[contenteditable=true]', 'label:has(input[type=file])',
  ].join(',');
  const vh = innerHeight;
  const vw = innerWidth;

  const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const nameOf = (el: HTMLElement): string => {
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (t.trim()) return t;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const t = [...labels].map((l) => l.innerText).join(' ');
      if (t.trim()) return t;
    }
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const t = el.innerText;
      if (t?.trim()) return t;
    }
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt')
      || el.querySelector('img')?.getAttribute('alt') || el.getAttribute('name') || el.id || '';
  };

  const found: { el: HTMLElement; info: ElementInfo; rect: DOMRect }[] = [];
  const seen = new Set<Element>();
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    if (seen.has(node)) continue;
    const isFile = node instanceof HTMLInputElement && node.type === 'file';
    if (node instanceof HTMLInputElement && node.type === 'hidden') continue;
    // File inputs are usually invisible behind a styled label; keep them anyway.
    if (!isFile && !isVisible(node)) continue;
    // A label wrapping a file input is represented by the input itself.
    if (node.tagName === 'LABEL') continue;
    seen.add(node);
    const rect = node.getBoundingClientRect();
    const tag = node.tagName.toLowerCase();
    const info: ElementInfo = {
      i: 0, tag, name: clean(nameOf(node)),
      where: rect.bottom < 0 ? 'above' : rect.top > vh ? 'below' : 'in view',
    };
    const role = node.getAttribute('role');
    if (role) info.role = role;
    if (node instanceof HTMLInputElement) {
      info.type = node.type;
      if (node.type === 'checkbox' || node.type === 'radio') info.checked = node.checked;
      else if (node.type === 'file') info.value = node.files?.length ? [...node.files].map((f) => f.name).join(', ') : '';
      else info.value = clean(node.value, 60);
      if (node.placeholder) info.placeholder = clean(node.placeholder, 40);
      if (node.required) info.required = true;
    } else if (node instanceof HTMLTextAreaElement) {
      info.value = clean(node.value, 60);
      if (node.required) info.required = true;
    } else if (node instanceof HTMLSelectElement) {
      info.options = [...node.options].slice(0, 20).map((o) => clean(o.text || o.value, 40));
      info.selected = clean(node.selectedOptions[0]?.text ?? '', 40);
      if (node.required) info.required = true;
    } else if (node.isContentEditable) {
      info.value = clean(node.innerText, 60);
    }
    if ((node as HTMLButtonElement).disabled) info.disabled = true;
    if (!isFile && info.where === 'in view') {
      const x = Math.min(vw - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(vh - 1, Math.max(0, rect.top + rect.height / 2));
      const top = document.elementFromPoint(x, y);
      if (top && top !== node && !node.contains(top) && !top.contains(node)) info.covered = true;
    }
    if (node instanceof HTMLAnchorElement) {
      try {
        const u = new URL(node.href);
        info.href = clean(u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname, 80);
      } catch { /* odd href */ }
    }
    found.push({ el: node, info, rect });
  }

  // Everything in view first, then what is nearby, in document order within each band.
  const rank = (r: DOMRect) => (r.bottom >= 0 && r.top <= vh ? 0 : Math.abs(r.top < 0 ? r.bottom : r.top - vh) < vh * 2 ? 1 : 2);
  const kept = found
    .map((f, order) => ({ ...f, order, band: rank(f.rect) }))
    .sort((a, b) => a.band - b.band || a.order - b.order)
    .slice(0, opts.maxElements)
    .sort((a, b) => a.order - b.order);
  kept.forEach((f, index) => {
    f.info.i = index + 1;
    f.el.setAttribute('data-agent-id', String(index + 1));
  });

  if (opts.badges) {
    const layer = document.createElement('div');
    layer.id = '__agent_badges';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const colours = ['#e6194b', '#0a6cff', '#3cb44b', '#f58231', '#911eb4', '#008080'];
    for (const f of kept) {
      if (f.info.where !== 'in view' || f.info.covered) continue;
      const r = f.el.getBoundingClientRect();
      const c = colours[f.info.i % colours.length];
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid ${c};outline-offset:-1px`;
      const tag = document.createElement('div');
      tag.textContent = String(f.info.i);
      const top = Math.max(0, Math.min(vh - 16, r.top - 2));
      const left = Math.max(0, Math.min(vw - 22, r.right - 20));
      tag.style.cssText = `position:fixed;left:${left}px;top:${top}px;background:${c};color:#fff;font:bold 11px/14px monospace;padding:0 3px;border-radius:3px`;
      layer.append(box, tag);
    }
    document.documentElement.appendChild(layer);
  }

  // Scroll position of the page, or of the biggest scrolling panel (app shells scroll inside a div).
  let scroller: Element = document.scrollingElement ?? document.documentElement;
  let best = scroller.scrollHeight - scroller.clientHeight;
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollHeight - el.clientHeight <= best || el.clientHeight < 100) continue;
    const s = getComputedStyle(el).overflowY;
    if (s === 'auto' || s === 'scroll') { scroller = el; best = el.scrollHeight - el.clientHeight; }
  }
  const above = Math.round(scroller.scrollTop);
  const below = Math.max(0, Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop));
  const scroll = `${above}px above the fold, ${below}px more below`;

  // Text the user would see: the viewport plus about a screen below, in reading order.
  // Scrolling reveals more, which keeps long pages (search results) from drowning in sidebar text.
  const lines: string[] = [];
  let lastTop = Number.NaN;
  let size = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && size < opts.maxText; node = walker.nextNode()) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,#__agent_badges')) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < -vh * 0.25 || r.top > vh * 2) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
    if (lines.length && Math.abs(r.top - lastTop) < 6) lines[lines.length - 1] += ' ' + t;
    else lines.push(t);
    lastTop = r.top;
    size += t.length + 1;
  }
  const text = lines.join('\n');
  return {
    elements: kept.map((f) => f.info),
    omitted: found.length - kept.length,
    text: text.length > opts.maxText ? text.slice(0, opts.maxText) + '\n…(truncated; scroll for more)' : text,
    scroll,
  };
}

function formatElement(e: ElementInfo): string {
  const kind = e.role ? `${e.tag} role=${e.role}` : e.type ? `${e.tag} type=${e.type}` : e.tag;
  const parts = [`[${e.i}] <${kind}>`, JSON.stringify(e.name)];
  if (e.value !== undefined) parts.push(`value=${JSON.stringify(e.value)}`);
  if (e.placeholder) parts.push(`placeholder=${JSON.stringify(e.placeholder)}`);
  if (e.options) parts.push(`options=${JSON.stringify(e.options)} selected=${JSON.stringify(e.selected)}`);
  if (e.checked !== undefined) parts.push(e.checked ? 'checked' : 'unchecked');
  if (e.href) parts.push(`→ ${e.href}`);
  if (e.required) parts.push('required');
  if (e.disabled) parts.push('disabled');
  if (e.where !== 'in view') parts.push(`(${e.where}, scroll to see)`);
  if (e.covered) parts.push('(covered by something on top)');
  return parts.join(' ');
}

// ---------------------------------------------------------------- actions (OpenAI tools)

const REASON = { type: 'string', description: 'One short sentence: why this action, given what you see.' };
const MEMORY = { type: 'string', description: 'Optional. Facts to remember for later steps (e.g. prices you read). Appended to your notes.' };

function tool(name: string, description: string, props: Record<string, unknown>, required: string[]): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name, description,
      parameters: { type: 'object', properties: { reason: REASON, ...props, memory: MEMORY }, required: ['reason', ...required], additionalProperties: false },
    },
  };
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  tool('click', 'Click the element with this index.', { index: { type: 'integer' } }, ['index']),
  tool('type', 'Type text into an input, textarea or contenteditable. Replaces the current value unless clear is false.',
    { index: { type: 'integer' }, text: { type: 'string' }, clear: { type: 'boolean' } }, ['index', 'text']),
  tool('select', 'Choose an option in a <select> by its visible text.', { index: { type: 'integer' }, option: { type: 'string' } }, ['index', 'option']),
  tool('upload', 'Attach a file to a file input (or the label/button that owns one). source is a named file from the task, an http(s) URL, or a data URL.',
    { index: { type: 'integer' }, source: { type: 'string' } }, ['index', 'source']),
  tool('press', 'Press a key on the focused element, e.g. Enter, Tab, Escape, ArrowDown.', { key: { type: 'string' } }, ['key']),
  tool('scroll', 'Scroll the page (or its main scrolling panel) by about one screen.', { direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']),
  tool('goto', 'Open a URL in the current tab. Only allowed hosts work.', { url: { type: 'string' } }, ['url']),
  tool('wait', 'Wait for the page to update.', { seconds: { type: 'number' } }, ['seconds']),
  tool('done', 'The task is finished (or cannot be finished). Call only after you have seen evidence on the page.',
    { success: { type: 'boolean' }, summary: { type: 'string' }, result: { type: 'string', description: 'The answer the task asked for; JSON text if the task asked for JSON.' } },
    ['success', 'summary']),
  tool('fail', 'Give up: the task is impossible from here.', { reason_failed: { type: 'string' } }, ['reason_failed']),
];

const SYSTEM = `You are a careful browser agent. You operate a real Chromium tab to complete the user's task.

Each turn you get: the task, your notes, a short history of your previous actions and their outcomes, and the current page (URL, title, scroll position, visible text, a numbered list of interactive elements, and a screenshot with the same numbers drawn on it).

Rules:
- Call exactly one tool per turn. Use element indices from the CURRENT list only; they change every turn.
- Prefer the element list for exact values; use the screenshot for layout. Elements marked "(below, scroll to see)" can still be clicked or typed into directly.
- After typing or selecting, check the element list next turn to confirm the value stuck before moving on.
- Before submitting a form, make sure every required field has a value (file inputs show the attached file name).
- If an action fails, read the error and try something different; do not repeat the same failing action more than twice.
- Never sign in, accept cookies, buy, bid, message anyone or submit anything on a site the task calls read-only. Only read it.
- Only call done after the page shows evidence the task is complete, and put the requested data in result.
- Keep reason to one short sentence.`;

// ---------------------------------------------------------------- helpers

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase().replace(/^\*\./, '');
    return h === e || h.endsWith('.' + e);
  });
}

const normalise = (s: string) => s.toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();

async function loadFile(source: string, base: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const data = /^data:([\w/+.-]+)(;base64)?,([\s\S]*)$/.exec(source);
  if (data) {
    const mimeType = data[1];
    const buffer = data[2] ? Buffer.from(data[3], 'base64') : Buffer.from(decodeURIComponent(data[3]));
    return { name: 'upload.' + (mimeType.split('/')[1]?.split('+')[0] || 'bin'), mimeType, buffer };
  }
  const url = new URL(source, base);
  if (!/^https?:$/.test(url.protocol)) throw new Error('upload source must be a named file, an http(s) URL or a data URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`could not download ${url.href}: HTTP ${response.status}`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
  const last = url.pathname.split('/').pop() || 'upload';
  return { name: last.includes('.') ? last : `${last}.${mimeType.split('/')[1]?.split('+')[0] || 'bin'}`, mimeType, buffer: Buffer.from(await response.arrayBuffer()) };
}

const shortArgs = (args: Record<string, unknown>) => {
  const rest = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'reason' && k !== 'memory'));
  const text = JSON.stringify(rest);
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300);

// ---------------------------------------------------------------- the loop

export async function runBrowserAgent(options: AgentOptions): Promise<AgentResult> {
  const {
    goal, startUrl, allowedHosts, readOnlyHosts = [], files = {}, maxSteps = 25, timeoutMs = 6 * 60_000,
    model = process.env.OPENAI_MODEL || 'gpt-5-mini', headless = true, imageDetail = 'auto',
    viewport = { width: 480, height: 860 }, onStep,
  } = options;
  const started = Date.now();
  const deadline = started + timeoutMs;
  const client = new OpenAI();
  const steps: AgentStep[] = [];
  const blocked: string[] = [];
  const notes: string[] = [];
  const navigable = [...allowedHosts, ...readOnlyHosts];

  const readOnlyHere = (url: string) => {
    try { const h = new URL(url).hostname; return hostMatches(h, readOnlyHosts) && !hostMatches(h, allowedHosts); } catch { return false; }
  };
  const startHost = new URL(startUrl).hostname;
  if (!hostMatches(startHost, navigable)) throw new Error(`startUrl host ${startHost} is not in allowedHosts`);

  const browser = await chromium.launch({
    headless,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  let context: BrowserContext | null = null;
  let finish: { success: boolean; summary: string; result?: unknown } | null = null;
  let page: Page;

  try {
    context = await browser.newContext({
      viewport, locale: 'en-GB', acceptDownloads: false, serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });

    // Safety, enforced in code rather than in the prompt:
    // - top-level navigation only to allowedHosts + readOnlyHosts;
    // - no non-GET request (form posts, fetch/XHR writes, beacons) to any host outside allowedHosts.
    await context.route('**/*', (route: Route) => {
      const request = route.request();
      let url: URL;
      try { url = new URL(request.url()); } catch { return route.continue(); }
      if (!/^https?:$/.test(url.protocol)) return route.continue();
      const method = request.method();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !hostMatches(url.hostname, allowedHosts)) {
        blocked.push(`${method} ${url.host}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      let topLevel = false;
      try { topLevel = request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame(); } catch { /* worker request */ }
      if (topLevel && !hostMatches(url.hostname, navigable)) {
        blocked.push(`navigate ${url.host}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    // Element operations fail fast so a stale index costs seconds, not half a minute.
    context.setDefaultTimeout(8_000);
    page = await context.newPage();
    // Popups and target=_blank links become the active tab.
    context.on('page', (opened) => { page = opened; opened.on('close', () => { const pages = context!.pages(); if (pages.length) page = pages[pages.length - 1]; }); });
    // Native dialogs would block the page; dismiss and report them.
    let dialogNote = '';
    const watchDialogs = (p: Page) => p.on('dialog', (d) => { dialogNote = `A ${d.type()} dialog said: ${d.message().slice(0, 200)}`; void d.dismiss().catch(() => {}); });
    watchDialogs(page);
    context.on('page', watchDialogs);

    const settle = async () => {
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {});
      await pause(250);
    };

    // A start page that fails to load (e.g. a blocked third-party site) is shown to the model, not thrown.
    let startNote = '';
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((error) => { startNote = `Opening ${startUrl} failed: ${errorText(error)}`; });
    await settle();

    let modelFailures = 0;
    for (let n = 1; n <= maxSteps && !finish; n++) {
      if (Date.now() > deadline) break;
      const stepStart = Date.now();

      // ---- observe
      let obs: Observation;
      try {
        obs = await page.evaluate(observePage, { maxElements: 120, maxText: 4000, badges: true });
      } catch (error) {
        // Usually a navigation in flight; give it a moment and look again.
        await settle();
        obs = await page.evaluate(observePage, { maxElements: 120, maxText: 4000, badges: true })
          .catch(() => ({ elements: [], omitted: 0, text: `(could not read the page: ${errorText(error)})`, scroll: '' }));
      }
      const shot = (await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null))?.toString('base64') ?? '';
      await page.evaluate(() => document.getElementById('__agent_badges')?.remove()).catch(() => {});
      const url = page.url();
      const title = await page.title().catch(() => '');

      const history = steps.slice(-10).map((s) => `${s.step}. ${s.action ? `${s.action.name}(${shortArgs(s.action.args)})` : '(no action)'} → ${s.error ? 'ERROR: ' + s.error : s.outcome}`);
      const fileNames = Object.keys(files);
      const state = [
        `TASK:\n${goal}`,
        fileNames.length ? `NAMED FILES for upload: ${fileNames.join(', ')}` : '',
        `NOTES:\n${notes.length ? notes.map((x) => '- ' + x).join('\n') : '(none)'}`,
        `HISTORY (step ${n} of max ${maxSteps}):\n${history.length ? history.join('\n') : '(this is the first step)'}`,
        dialogNote,
        n === 1 ? startNote : '',
        `CURRENT PAGE\nURL: ${url}\nTitle: ${title}\nScroll: ${obs.scroll}`,
        readOnlyHere(url) ? 'This site is READ-ONLY for you: anything that would send data (forms, consent buttons, sign-in) is blocked. Read the PAGE TEXT (it includes text under overlays) and scroll; do not click banners or buttons here.' : '',
        `INTERACTIVE ELEMENTS:\n${obs.elements.map(formatElement).join('\n') || '(none found)'}${obs.omitted ? `\n(${obs.omitted} more elements further away; scroll to reach them)` : ''}`,
        `PAGE TEXT:\n${obs.text || '(empty)'}`,
      ].filter(Boolean).join('\n\n');
      dialogNote = '';

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: state }];
      if (shot) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}`, detail: imageDetail } });

      // ---- decide
      const record: AgentStep = { step: n, url, title, reason: '', action: null, outcome: '', screenshot: shot, ms: 0 };
      let call: AgentAction | null = null;
      try {
        const reasoning = /^(gpt-5|o\d)/.test(model) ? { reasoning_effort: 'low' as const } : {};
        const remaining = Math.max(5_000, deadline - Date.now());
        const response = await client.chat.completions.create({
          model, ...reasoning,
          max_completion_tokens: 8_000,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
          tools: TOOLS, tool_choice: 'required', parallel_tool_calls: false,
        }, { timeout: Math.min(120_000, remaining), maxRetries: 1 });
        const toolCall = response.choices[0]?.message?.tool_calls?.find((t) => t.type === 'function');
        if (!toolCall || toolCall.type !== 'function') throw new Error('the model returned no tool call');
        let args: Record<string, unknown>;
        try { args = JSON.parse(toolCall.function.arguments || '{}'); }
        catch { throw new Error(`the model sent arguments that are not JSON: ${toolCall.function.arguments.slice(0, 120)}`); }
        call = { name: toolCall.function.name, args };
        modelFailures = 0;
      } catch (error) {
        modelFailures++;
        record.error = `model: ${errorText(error)}`;
        record.outcome = 'no action taken';
        record.ms = Date.now() - stepStart;
        steps.push(record);
        await onStep?.(record);
        if (modelFailures >= 3) { finish = { success: false, summary: `The model failed three times in a row: ${record.error}` }; }
        continue;
      }

      record.action = call;
      record.reason = typeof call.args.reason === 'string' ? call.args.reason : '';
      if (typeof call.args.memory === 'string' && call.args.memory.trim()) notes.push(call.args.memory.trim().slice(0, 400));

      // ---- act
      try {
        record.outcome = await act(call);
      } catch (error) {
        record.error = errorText(error);
        record.outcome = 'failed';
      }
      record.ms = Date.now() - stepStart;
      steps.push(record);
      await onStep?.(record);
    }

    async function act({ name, args }: AgentAction): Promise<string> {
      const element = async (raw: unknown) => {
        const index = Number(raw);
        if (!Number.isInteger(index) || index < 1) throw new Error(`index must be a positive integer, got ${JSON.stringify(raw)}`);
        const locator = page.locator(`[data-agent-id="${index}"]`);
        if (await locator.count() === 0) throw new Error(`there is no element [${index}] on the current page; use an index from the latest list`);
        return locator.first();
      };
      const before = page.url();
      const moved = () => page.url() !== before ? ` Page is now ${page.url()}` : '';

      switch (name) {
        case 'click': {
          const el = await element(args.index);
          const isFile = await el.evaluate((node) => node instanceof HTMLInputElement && node.type === 'file');
          if (isFile) throw new Error('that is a file input; use upload instead of click');
          try {
            await el.click({ timeout: 5_000 });
          } catch (error) {
            // Something covered it (a banner, a sticky header). Fall back to a DOM click.
            if (!/intercept|not visible|outside of the viewport|timeout/i.test(errorText(error))) throw error;
            await el.evaluate((node) => (node as HTMLElement).click());
          }
          // A click that submits or follows a link often navigates a beat later; give it a moment to start.
          await page.waitForURL((u) => u.href !== before, { timeout: 2_000 }).catch(() => {});
          await settle();
          return `clicked [${args.index}].${moved()}`;
        }
        case 'type': {
          const el = await element(args.index);
          const text = String(args.text ?? '');
          if (args.clear === false) {
            await el.click({ timeout: 5_000 });
            await el.pressSequentially(text, { delay: 20 });
          } else {
            await el.fill(text, { timeout: 5_000 });
          }
          const value = await el.evaluate((node) => (node as HTMLInputElement).value ?? (node as HTMLElement).innerText);
          return `typed into [${args.index}]; its value is now ${JSON.stringify(String(value).slice(0, 100))}`;
        }
        case 'select': {
          const el = await element(args.index);
          const wanted = normalise(String(args.option ?? ''));
          const options = await el.evaluate((node) => node instanceof HTMLSelectElement ? [...node.options].map((o) => ({ label: o.text, value: o.value })) : null);
          if (!options) throw new Error(`[${args.index}] is not a <select>; click it instead`);
          const match = options.find((o) => normalise(o.label) === wanted || normalise(o.value) === wanted)
            ?? options.find((o) => normalise(o.label).includes(wanted) || (wanted && wanted.includes(normalise(o.label)) && normalise(o.label).length > 2));
          if (!match) throw new Error(`no option ${JSON.stringify(args.option)}; options are ${JSON.stringify(options.map((o) => o.label))}`);
          await el.selectOption({ value: match.value }, { timeout: 5_000 });
          return `selected ${JSON.stringify(match.label)} in [${args.index}]`;
        }
        case 'upload': {
          const el = await element(args.index);
          const source = String(args.source ?? '');
          const resolved = files[source] ?? source;
          if (!resolved) throw new Error('source is empty');
          // Accept the input itself, or a label/button that contains or points at one.
          let input = el;
          const isFile = await el.evaluate((node) => node instanceof HTMLInputElement && node.type === 'file');
          if (!isFile) {
            const inner = el.locator('input[type=file]');
            if (await inner.count()) input = inner.first();
            else {
              const all = page.locator('input[type=file]');
              if (await all.count() !== 1) throw new Error(`[${args.index}] is not a file input and there is no single file input to fall back to`);
              input = all.first();
            }
          }
          const file = await loadFile(resolved, page.url());
          await input.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
          await pause(600);
          return `attached ${file.name} (${file.mimeType}, ${Math.round(file.buffer.length / 1024)} KB) to the file input`;
        }
        case 'press': {
          await page.keyboard.press(String(args.key ?? 'Enter'));
          await settle();
          return `pressed ${args.key}.${moved()}`;
        }
        case 'scroll': {
          const dy = (args.direction === 'up' ? -1 : 1) * Math.round(viewport.height * 0.8);
          // Wheel over the middle of the viewport scrolls whatever panel is there, like a person would.
          await page.mouse.move(viewport.width / 2, viewport.height / 2);
          await page.mouse.wheel(0, dy);
          await pause(500);
          return `scrolled ${args.direction}`;
        }
        case 'goto': {
          const target = new URL(String(args.url ?? ''), page.url());
          if (!/^https?:$/.test(target.protocol)) throw new Error('only http(s) URLs');
          if (!hostMatches(target.hostname, navigable)) throw new Error(`${target.hostname} is not an allowed host; allowed: ${navigable.join(', ')}`);
          const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await settle();
          return `opened ${page.url()} (HTTP ${response?.status() ?? '?'})`;
        }
        case 'wait': {
          const seconds = Math.min(10, Math.max(0.5, Number(args.seconds) || 1));
          await pause(seconds * 1000);
          return `waited ${seconds}s`;
        }
        case 'done': {
          let result: unknown = args.result;
          if (typeof result === 'string') { try { result = JSON.parse(result); } catch { /* keep text */ } }
          finish = { success: args.success !== false, summary: String(args.summary ?? ''), result };
          return 'finished';
        }
        case 'fail': {
          finish = { success: false, summary: String(args.reason_failed ?? args.reason ?? 'gave up') };
          return 'gave up';
        }
        default:
          throw new Error(`unknown action ${JSON.stringify(name)}; use one of the provided tools`);
      }
    }

    const outcome = finish as { success: boolean; summary: string; result?: unknown } | null;
    const finalScreenshot = (await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null))?.toString('base64');
    const ended = Date.now() > deadline ? `Timed out after ${Math.round(timeoutMs / 1000)}s.` : `Stopped after ${maxSteps} steps without finishing.`;
    return {
      success: outcome?.success ?? false,
      summary: outcome?.summary ?? ended,
      result: outcome?.result,
      steps, finalScreenshot, finalUrl: page.url(), blocked, ms: Date.now() - started,
    };
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- task preset: list a lot on the demo marketplace

export type ListableLot = {
  id: string;
  name: string;
  condition?: string | null;
  blurb?: string | null;
  image_url?: string | null;
  low?: number | null;
  high?: number | null;
  reserve?: number | null;
};

export type ListPlatform = 'ebay' | 'marketplace';

/** Price range the listing must fall in: the estimate, or around the reserve when there is none. */
export function listingPriceRange(lot: ListableLot): { min: number; max: number; suggested: number } {
  const low = Math.round(Number(lot.low) || 0);
  const high = Math.round(Number(lot.high) || 0);
  if (low > 0 && high >= low) return { min: low, max: high, suggested: Math.round((low + high) / 2) };
  const base = Math.max(1, Math.round(Number(lot.reserve) || low || 5));
  return { min: base, max: Math.max(base, Math.round(base * 2)), suggested: base };
}

/**
 * Everything runBrowserAgent needs to list one lot on a demo marketplace:
 * spread the return value into runBrowserAgent({...listItemGoal(...), onStep}).
 * With checkComps, the agent first reads real eBay UK search results (read-only)
 * to judge the price; that part may fail and the task still succeeds.
 */
export function listItemGoal(lot: ListableLot, platform: ListPlatform, origin: string, opts: { checkComps?: boolean } = {}) {
  const { checkComps = true } = opts;
  const { min, max, suggested } = listingPriceRange(lot);
  const site = platform === 'ebay' ? 'eBay' : 'Facebook Marketplace';
  const title = lot.name.trim().slice(0, 80);
  const sellUrl = `${origin.replace(/\/$/, '')}/mock-marketplace/${platform}/sell?lot=${encodeURIComponent(lot.id)}`;
  const searchUrl = `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(title)}&LH_BIN=1`;
  const files: Record<string, string> = {};
  if (lot.image_url) files['item-photo'] = new URL(lot.image_url, origin).href;

  const goal = [
    `List this item for sale on our demo ${site} sell form. The form is a local simulation; submitting it is safe and intended.`,
    '',
    'Item:',
    `- Name: ${title}`,
    lot.condition ? `- Condition notes: ${lot.condition}` : '',
    lot.blurb ? `- Description: ${lot.blurb}` : '',
    `- Our price estimate: £${min}–£${max}`,
    '',
    'Steps:',
    checkComps
      ? `1. Research (read-only, optional): open ${searchUrl} and read the prices of up to 5 similar items from the page text. Save them with the memory field. Do not click anything on eBay except to scroll. eBay often answers a cold browser with an "Error Page" (HTTP 403): if so, open the same URL again, up to 2 more times. If it still errors, shows a captcha, or you have spent 4 steps there, skip research.`
      : '1. (No price research for this run.)',
    `2. Open the sell form: ${sellUrl}`,
    `3. Fill the title with exactly: ${title}`,
    '4. Choose the condition option that best matches the condition notes (default "Used – good" when unsure).',
    `5. Set the price in whole pounds. It must be between ${min} and ${max}. Use ${suggested} unless the eBay prices you read suggest a different price in that range.`,
    lot.image_url ? '6. Attach the photo: use upload on the photo file input with source "item-photo". Confirm the input now shows a file.' : '6. (No photo available; skip.)',
    `7. Check every field, then click the publish button (${platform === 'ebay' ? '"List it"' : '"Publish"'}).`,
    '8. Wait for the listing page. Its URL contains ?listing=<id>. Confirm it shows the listing is live.',
    '9. Call done with success=true and result as JSON text:',
    '   {"listing_id": "<id from the URL>", "listing_url": "<full URL>", "title": "<title used>", "price": <number>, "condition": "<condition used>", "comps": [<prices you read on eBay, or empty>]}',
    'If the form shows an error, fix the field and publish again.',
  ].filter((line) => line !== '').join('\n');

  const allowedHosts = [new URL(origin).hostname];
  return { goal, startUrl: checkComps ? searchUrl : sellUrl, allowedHosts, readOnlyHosts: checkComps ? ['ebay.co.uk'] : [], files };
}
