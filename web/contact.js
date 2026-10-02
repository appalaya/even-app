/**
 * The contact page (contact.html; README.md, "Contact page"). Loaded as a module from this site; the rules it uses
 * (reading an invite, the group id, the request body) are in contact-lib.js, which has no DOM and is tested in Node.
 *
 * What leaves the browser: GET /api/contact/config, and one POST /api/contact per send with the purpose, the
 * message, an email only if one was typed, and for a report the group's id and server. Never the invite link: the
 * moment it is pasted it is taken out of the text field (takeInvite), and only the id and server it names are kept.
 * Text is only ever inserted with textContent.
 *
 * Cloudflare Turnstile's api.js is the one script from elsewhere, and it runs in this page. So this file loads it,
 * and only once no invite can be on the page: when a report names its group (from the app, or from a pasted link
 * already read and cleared), or when a help or feedback message is typed or sent. The link field then closes for
 * good; another link takes a reload.
 */
import {
  cleanText,
  contactBody,
  DEFAULT_SERVER,
  InviteError,
  MAX_MESSAGE_LENGTH,
  outcome,
  readFragment,
  REPORT_PREFIX_MAX,
  reportMessage,
  serverLabel,
  shortGroupId,
  takeInvite,
} from './contact-lib.js';

const CONFIG_URL = '/api/contact/config';
const CONTACT_URL = '/api/contact';
const SEND_TIMEOUT_MS = 30_000;
/** Turnstile's api.js at the exact URL Cloudflare requires (never proxied or cached). Added by loadTurnstile only. */
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const $ = (id) => document.getElementById(id);
const form = $('form');
const link = $('link');
const reason = $('reason');
const details = $('details');
const message = $('message');
const email = $('email');
const send = $('send');
const alertBox = $('alert');

/** What the page says when a send cannot go through (ContactWeb board, "Failed"). */
const FAILURES = {
  network: 'Couldn’t send. Check your connection and try again.',
  turnstile: 'The bot check didn’t finish. Try it again.',
  rate_limited: 'Couldn’t send. Try again in a minute.',
  unavailable: 'Couldn’t send. Try again later.',
};

/**
 * A pasted link the app would not accept, worded as the app words a pasted code (src/features/join/invite.ts,
 * problemMessage): cut short, damaged or not an invite reads as incomplete; a newer invite version asks for a newer Even.
 */
const INVITE_INCOMPLETE = 'That link isn’t complete. Copy it again.';
const INVITE_NEWER = 'This invite needs a newer Even.';

/** The line above the link field while it is open (as in contact.html), and once Turnstile has closed it. */
const LINK_HINT = 'Paste the group’s link. This page reads it, then clears it.';
const LINK_CLOSED = 'To use a different link, reload this page.';

const MESSAGE_HINTS = {
  help: 'What happened, and what did you expect? Your phone and Even version help.',
  feedback: 'What would make Even better for you?',
};

const SENT = {
  report: {
    title: 'Report sent',
    text: 'Thanks. If the group is on our server and breaks our terms, we block it. We can’t see inside it, so we can’t tell you more than that.',
  },
  message: {
    title: 'Message sent',
    text: 'Thanks. If you left an email, we’ll reply there.',
  },
};

const otherServerText = (target) =>
  `This group is on ${serverLabel(target.server)}. We can’t act on it, but we’ll read your report.`;
const pathServerText = (target) =>
  `This group is on ${serverLabel(target.server)}. This form can’t take reports for a server with a path; tell whoever runs it.`;

// ---------- state ----------

/** The group named by the app's fragment, or null. */
let prefill = null;
/** The pasted link, read: { target } or { problem }, or null. Only this is kept; the link itself is not. */
let pasted = null;
/** The latest reading of the pasted link, awaited before a send. */
let reading = Promise.resolve();
let readingSeq = 0;
let widgetId = null;
/** Turnstile's api.js once added: resolves to true when it has loaded. Reset after a failed load, to retry. */
let turnstileScript = null;
/** True from the moment api.js is first added; the link field stays closed from then on. */
let turnstileStarted = false;
/** The config route's answer, once; retried on the next send if it failed. */
let setup = null;
let setupFailure = null;
let sending = false;

const purpose = () => form.elements.namedItem('purpose').value;

// ---------- the form's sections ----------

function show(element, visible) {
  element.hidden = !visible;
  if (element instanceof HTMLFieldSetElement) element.disabled = !visible;
}

function applyPurpose() {
  const current = purpose();
  const report = current === 'report';
  show($('report-fields'), report);
  show($('message-fields'), !report);
  $('handle').hidden = !report;
  send.textContent = report ? 'Send report' : 'Send';
  if (!report) message.placeholder = MESSAGE_HINTS[current];
  showPrefill();
  renderLink();
  clearAlert();
  startTurnstileWhenReady();
}

function showPrefill() {
  show($('paste'), prefill === null);
  $('prefilled').hidden = prefill === null;
  if (prefill === null) return;
  $('prefill-id').textContent = shortGroupId(prefill.groupId);
  $('prefill-id').title = prefill.groupId;
  $('prefill-server').textContent = serverLabel(prefill.server);
  const note = $('prefill-note');
  note.textContent = !prefill.reportable
    ? pathServerText(prefill)
    : prefill.appalaya
      ? ''
      : otherServerText(prefill);
  note.hidden = note.textContent === '';
}

/** #purpose=help, #purpose=feedback, #purpose=report&id=…&server=… (the app opens the page this way). */
function applyFragment() {
  const fragment = readFragment(location.hash);
  if (fragment.purpose !== null) {
    for (const radio of form.elements.namedItem('purpose'))
      radio.checked = radio.value === fragment.purpose;
  }
  prefill = fragment.purpose === 'report' ? fragment.target : null;
  applyPurpose();
}

// ---------- the pasted invite link ----------

/** The link field: open until Turnstile is added to the page, then closed (disabled and empty) for good. */
function renderLink() {
  link.disabled = turnstileStarted;
  $('link-hint').textContent = turnstileStarted ? LINK_CLOSED : LINK_HINT;
  renderDerived();
}

function renderDerived() {
  const box = $('derived');
  const text = $('derived-text');
  text.replaceChildren();
  link.setCustomValidity('');
  if (pasted === null) {
    box.hidden = true;
    return;
  }
  let problem = false;
  if (pasted.problem !== undefined) {
    problem = true;
    text.textContent = pasted.problem;
  } else if (!pasted.target.reportable) {
    problem = true;
    text.textContent = pathServerText(pasted.target);
  } else if (!pasted.target.appalaya) {
    text.textContent = otherServerText(pasted.target);
  } else {
    const id = document.createElement('code');
    id.textContent = shortGroupId(pasted.target.groupId);
    id.title = pasted.target.groupId;
    text.append(
      'We’ll receive the group id ',
      id,
      ` on ${serverLabel(DEFAULT_SERVER)}, never its key or contents.`,
    );
  }
  if (problem) link.setCustomValidity(text.textContent);
  box.classList.toggle('is-problem', problem);
  $('derived-ok').hidden = problem;
  $('derived-problem').hidden = !problem;
  box.hidden = false;
}

/** Takes the link out of the field at once (takeInvite empties it before anything is awaited), then reads it. */
async function readPasted() {
  const seq = ++readingSeq;
  let result = null;
  try {
    const target = await takeInvite(link);
    result = target === null ? null : { target };
  } catch (error) {
    const newer = error instanceof InviteError && error.code === 'version';
    result = { problem: newer ? INVITE_NEWER : INVITE_INCOMPLETE };
  }
  if (seq !== readingSeq) return;
  pasted = result;
  renderDerived();
  startTurnstileWhenReady();
}

// ---------- Turnstile ----------

/**
 * Adds Turnstile's api.js to the page, once (again only after a failed load). The script runs with the page's own
 * access, so the link field is emptied and closed first, and no invite can be pasted while it is here.
 */
function loadTurnstile() {
  if (turnstileScript === null) {
    turnstileStarted = true;
    link.value = '';
    renderLink();
    turnstileScript = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_URL;
      script.async = true;
      script.addEventListener('load', () => resolve(true));
      script.addEventListener('error', () => resolve(false));
      document.head.append(script);
    });
  }
  return turnstileScript;
}

/**
 * Renders the widget once the form needs no invite: a report whose group is known and can be sent, or a help or
 * feedback message being typed. Before that, nothing from Cloudflare is on the page.
 */
function startTurnstileWhenReady() {
  if (turnstileStarted) return;
  const ready =
    purpose() === 'report'
      ? (prefill ?? pasted?.target)?.reportable === true
      : message.value.trim() !== '';
  if (!ready) return;
  ensureWidget().then((shown) => {
    if (!shown) showAlert(setupFailure ?? 'unavailable');
  });
}

async function loadConfig() {
  let response;
  try {
    response = await fetch(CONFIG_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return { failure: 'network' };
  }
  let config = null;
  try {
    config = await response.json();
  } catch {
    config = null;
  }
  if (
    !response.ok ||
    config === null ||
    typeof config.turnstileSiteKey !== 'string' ||
    config.turnstileSiteKey === '' ||
    typeof config.turnstileAction !== 'string'
  ) {
    return { failure: 'unavailable' };
  }
  return { config };
}

/**
 * Loads Turnstile if it is not here yet and renders the widget once, with the site key and action the Worker serves.
 * Resolves to true when it is there. Call it only when no invite can be on the page (startTurnstileWhenReady, submit).
 */
async function ensureWidget() {
  if (widgetId !== null) return true;
  setup ??= loadConfig();
  const [result, loaded] = await Promise.all([setup, loadTurnstile()]);
  if (result.failure !== undefined) {
    setup = null;
    setupFailure = result.failure;
    return false;
  }
  if (!loaded || typeof window.turnstile?.render !== 'function') {
    turnstileScript = null;
    setupFailure = 'network';
    return false;
  }
  const max = Number.isInteger(result.config.maxMessageLength)
    ? result.config.maxMessageLength
    : MAX_MESSAGE_LENGTH;
  message.maxLength = max;
  details.maxLength = Math.max(0, max - REPORT_PREFIX_MAX);
  if (widgetId === null) {
    widgetId = window.turnstile.render($('turnstile'), {
      sitekey: result.config.turnstileSiteKey,
      action: result.config.turnstileAction,
      theme: 'auto',
      size: 'normal',
      'response-field': false,
      callback: () => {
        if (alertBox.dataset.kind === 'turnstile') clearAlert();
      },
    });
  }
  setupFailure = null;
  return true;
}

// ---------- sending ----------

function showAlert(kind, text = FAILURES[kind]) {
  alertBox.dataset.kind = kind;
  $('alert-text').textContent = text;
  alertBox.hidden = false;
}

function clearAlert() {
  delete alertBox.dataset.kind;
  alertBox.hidden = true;
}

/** The report's group, or null after pointing the person at what is missing. */
async function reportTarget() {
  if (prefill !== null) {
    if (prefill.reportable) return prefill;
    showAlert('server', pathServerText(prefill));
    return null;
  }
  await reading;
  if (pasted?.target?.reportable) return pasted.target;
  if (turnstileStarted) {
    showAlert('link', LINK_CLOSED);
    return null;
  }
  link.focus();
  form.reportValidity();
  return null;
}

async function submit(event) {
  event.preventDefault();
  if (sending) return;
  clearAlert();
  const current = purpose();

  let target = null;
  let text;
  if (current === 'report') {
    target = await reportTarget();
    if (target === null) return;
    text = reportMessage(reason.value, details.value);
  } else {
    text = cleanText(message.value);
    if (text === '') {
      message.value = '';
      form.reportValidity();
      return;
    }
  }

  if (!(await ensureWidget())) {
    showAlert(setupFailure ?? 'unavailable');
    return;
  }
  const token = window.turnstile.getResponse(widgetId);
  if (typeof token !== 'string' || token === '') {
    showAlert('turnstile');
    return;
  }

  sending = true;
  send.disabled = true;
  form.setAttribute('aria-busy', 'true');
  let result;
  try {
    const response = await fetch(CONTACT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        contactBody({
          purpose: current,
          message: text,
          email: email.value,
          target,
          turnstileToken: token,
        }),
      ),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    result = outcome(response.status, body);
  } catch {
    result = 'network';
  } finally {
    // A token is good for one siteverify, whatever the answer: a fresh challenge for the next send.
    window.turnstile.reset(widgetId);
    sending = false;
    send.disabled = false;
    form.removeAttribute('aria-busy');
  }

  if (result === 'sent') showSent(current);
  else showAlert(result);
}

function showSent(sentPurpose) {
  const copy = sentPurpose === 'report' ? SENT.report : SENT.message;
  $('sent-title').textContent = copy.title;
  $('sent-text').textContent = copy.text;
  form.hidden = true;
  $('sent').hidden = false;
  $('sent').focus();
}

function sendAnother() {
  const current = purpose();
  form.reset();
  for (const radio of form.elements.namedItem('purpose')) radio.checked = radio.value === current;
  pasted = null;
  renderDerived();
  $('sent').hidden = true;
  form.hidden = false;
  applyPurpose();
  form.querySelector('input[name="purpose"]:checked').focus();
}

// ---------- start ----------

// A link the browser put back in the field (a restored page) is taken out and read before anything else runs.
if (link.value !== '') reading = readPasted();

form.addEventListener('change', (event) => {
  if (event.target.name === 'purpose') applyPurpose();
});
link.addEventListener('input', () => {
  reading = readPasted();
});
message.addEventListener('input', startTurnstileWhenReady);
form.addEventListener('submit', submit);
$('again').addEventListener('click', sendAnother);
window.addEventListener('hashchange', applyFragment);

setup = loadConfig();
applyFragment();
form.hidden = false;
