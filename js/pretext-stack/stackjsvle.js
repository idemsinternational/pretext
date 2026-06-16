/**
 * stackjsvle.js — PreTeXt port of the STACK iframe VLE communication layer.
 *
 * Key differences from the original Moodle version:
 *
 * 1. IFRAMES/INPUTS/INPUTS_INPUT_EVENT are now per-question Maps keyed by
 *    question boundary id (e.g. "q1_boundary"), not global objects.
 *    This prevents cross-question interference when multiple Parson's/drag-drop
 *    questions are active on the same page simultaneously.
 *
 * 2. vle_get_question_boundary() finds the PreTeXt question container
 *    (id ending in "_boundary", set by createQuestionBlocks) instead of
 *    Moodle's ".formulation" class which does not exist in PreTeXt.
 *
 * 3. vle_get_input_element() searches by name="stackapi_input_{name}" which
 *    matches the renderInputs=inputPrefix convention in stackapicalls.js.
 *    Search is scoped to the question boundary to avoid cross-question matches.
 *
 * 4. vle_update_dom() uses MathJax.typesetPromise() instead of Moodle's
 *    CustomEvents.notifyFilterContentUpdated() which does not exist in PreTeXt.
 *
 * 5. NEW: vle_reset_question_registry(boundaryId) — clears all per-question
 *    registry state (iframes, input listener maps) for a question before it
 *    is re-rendered (e.g. "Show new example question"). Without this, a
 *    freshly created iframe that reuses the same iframe id AND the same
 *    input element id as the previous instance will be considered "already
 *    registered" by the stale Q_INPUTS map. The 'register-input-listener'
 *    handler then `return`s early without ever posting back the
 *    'initial-input' response, and the iframe's STACK-JS client times out
 *    after 5s with "No response to input registration of ... in 5s." and
 *    never renders its drag-and-drop UI. Calling this before createIframes()
 *    on every render prevents that stale state from persisting.
 *
 * @copyright  2023 Aalto University
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

'use strict';

// Per-question registries — keyed by question boundary element id.
// Each question gets its own isolated IFRAMES, INPUTS, INPUTS_INPUT_EVENT map.
const QUESTION_IFRAMES = {};          // { boundaryId: { iframeId: iframeElement } }
const QUESTION_INPUTS = {};           // { boundaryId: { inputId: [iframeId, ...] } }
const QUESTION_INPUTS_INPUT_EVENT = {}; // { boundaryId: { inputId: [iframeId, ...] } }
const IFRAME_TO_BOUNDARY = {};        // { iframeId: boundaryId } — reverse lookup

// Legacy global IFRAMES still needed by create_iframe which registers new iframes.
let IFRAMES = {};

let DISABLE_CHANGES = false;

function getQuestionRegistry(boundaryId) {
  if (!QUESTION_IFRAMES[boundaryId]) {
    QUESTION_IFRAMES[boundaryId] = {};
    QUESTION_INPUTS[boundaryId] = {};
    QUESTION_INPUTS_INPUT_EVENT[boundaryId] = {};
  }
  return {
    iframes: QUESTION_IFRAMES[boundaryId],
    inputs: QUESTION_INPUTS[boundaryId],
    inputsInputEvent: QUESTION_INPUTS_INPUT_EVENT[boundaryId]
  };
}

/**
 * Clear all registry state associated with a question boundary.
 *
 * Called by stackapicalls.js immediately before re-rendering a question's
 * iframes (initial render, "Show new example question", or any re-render
 * that calls createIframes() again for the same boundary).
 *
 * This:
 *  - removes stale IFRAMES[...] entries for any iframe ids previously
 *    registered under this boundary (so a reused iframe id starts "fresh")
 *  - removes stale IFRAME_TO_BOUNDARY[...] entries for those iframe ids
 *  - resets QUESTION_IFRAMES / QUESTION_INPUTS / QUESTION_INPUTS_INPUT_EVENT
 *    for this boundary to empty objects
 *
 * Without this, a new iframe instance that reuses the same iframe id and
 * the same input element id as a previous instance is treated by the
 * 'register-input-listener' handler as "already registered" (since
 * Q_INPUTS[input.id] still contains that iframe id from the previous
 * instance), causing the handler to return early without ever sending the
 * 'initial-input' response. The iframe then times out after 5 seconds.
 */
function vle_reset_question_registry(boundaryId) {
  if (QUESTION_IFRAMES[boundaryId]) {
    for (const iframeId of Object.keys(QUESTION_IFRAMES[boundaryId])) {
      delete IFRAMES[iframeId];
      delete IFRAME_TO_BOUNDARY[iframeId];
    }
  }
  QUESTION_IFRAMES[boundaryId] = {};
  QUESTION_INPUTS[boundaryId] = {};
  QUESTION_INPUTS_INPUT_EVENT[boundaryId] = {};
}

function vle_get_question_boundary(element) {
  let iter = element;
  while (iter) {
    if (iter.id && iter.id.endsWith('_boundary')) {
      return iter;
    }
    if (iter.classList) {
      if (iter.classList.contains('formulation')) return iter;
      if (iter.classList.contains('que') && iter.classList.contains('stack')) return iter;
    }
    iter = iter.parentElement;
  }
  return null;
}

function vle_get_element(id) {
  return document.getElementById(id);
}

/**
 * Returns an input element scoped to the question that contains srciframe.
 * Searches by name="stackapi_input_{name}" which matches renderInputs=inputPrefix.
 * Scoped to the question boundary to prevent cross-question matches.
 */
function vle_get_input_element(name, srciframe) {
  const boundaryId = IFRAME_TO_BOUNDARY[srciframe];
  let scope = document;
  if (boundaryId) {
    const boundary = document.getElementById(boundaryId);
    if (boundary) scope = boundary;
  }

  // Primary: exact name match for "stackapi_input_{name}"
  let possible = scope.querySelector(`input[name="stackapi_input_${name}"]`);
  if (possible) return possible;
  possible = scope.querySelector(`textarea[name="stackapi_input_${name}"]`);
  if (possible) return possible;
  possible = scope.querySelector(`select[name="stackapi_input_${name}"]`);
  if (possible) return possible;

  // Secondary: name ends with the input name (handles _val variants)
  possible = scope.querySelector(`input[name$="_${name}"]`);
  if (possible && possible.type !== 'radio') return possible;
  possible = scope.querySelector(`input[name$="_${name}"][type=radio]`);
  if (possible) return possible;
  possible = scope.querySelector(`select[name$="_${name}"]`);
  if (possible) return possible;

  // Fallback: search whole document if boundary search failed
  if (scope !== document) {
    possible = document.querySelector(`input[name="stackapi_input_${name}"]`);
    if (possible) return possible;
    possible = document.querySelector(`textarea[name="stackapi_input_${name}"]`);
    if (possible) return possible;
  }

  return null;
}

function vle_update_input(inputelement) {
  inputelement.dispatchEvent(new Event('change'));
  inputelement.dispatchEvent(new Event('input'));
}

//Triggers MathJax re-typesetting on the modified element.

function vle_update_dom(modifiedsubtreerootelement) {
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise([modifiedsubtreerootelement])
      .catch(err => console.log('MathJax error in vle_update_dom:', err.message));
  } else if (window.MathJax && MathJax.typeset) {
    MathJax.typeset([modifiedsubtreerootelement]);
  }
}

function vle_html_sanitize(src) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(src, "text/html");
  for (const el of doc.querySelectorAll('script, style')) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const {name, value} of el.attributes) {
      if (is_evil_attribute(name, value)) el.removeAttribute(name);
    }
  }
  return doc.body;
}

function is_evil_attribute(name, value) {
  const lcname = name.toLowerCase();
  if (lcname.startsWith('on')) return true;
  if (lcname === 'src' || lcname.endsWith('href')) {
    const lcvalue = value.replace(/\s+/g, '').toLowerCase();
    if (lcvalue.includes('javascript:') || lcvalue.includes('data:text')) return true;
  }
  return false;
}

//Message handling

window.addEventListener("message", (e) => {
  if (!(typeof e.data === 'string' || e.data instanceof String)) return;

  let msg = null;
  try { msg = JSON.parse(e.data); } catch (e) { return; }

  if (!(('version' in msg) && msg.version.startsWith('STACK-JS'))) return;
  if (!(('src' in msg) && ('type' in msg) && (msg.src in IFRAMES))) return;

  // Get the per-question registry for this iframe
  const boundaryId = IFRAME_TO_BOUNDARY[msg.src];
  if (boundaryId) getQuestionRegistry(boundaryId);
  const Q_IFRAMES = QUESTION_IFRAMES[boundaryId] || IFRAMES;
  const Q_INPUTS = QUESTION_INPUTS[boundaryId] || {};
  const Q_INPUTS_INPUT_EVENT = QUESTION_INPUTS_INPUT_EVENT[boundaryId] || {};

  let element = null;
  let input = null;
  const response = { version: 'STACK-JS:1.1.0' };

  switch (msg.type) {
  case 'register-input-listener':
    input = vle_get_input_element(msg.name, msg.src);
    if (input === null) {
      response.type = 'error';
      response.msg = 'Failed to connect to input: "' + msg.name + '"';
      response.tgt = msg.src;
      IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
      return;
    }

    response.type = 'initial-input';
    response.name = msg.name;
    response.tgt = msg.src;

    if (input.nodeName.toLowerCase() === 'select') {
      response.value = input.value;
      response['input-type'] = 'select';
      response['input-readonly'] = input.hasAttribute('disabled');
    } else if (input.type === 'checkbox') {
      response.value = input.checked;
      response['input-type'] = 'checkbox';
      response['input-readonly'] = input.hasAttribute('disabled');
    } else {
      response.value = input.value;
      response['input-type'] = input.type;
      response['input-readonly'] = input.hasAttribute('readonly');
    }
    if (input.type === 'radio') {
      response['input-readonly'] = input.hasAttribute('disabled');
      response.value = '';
      for (const inp of document.querySelectorAll('input[type=radio][name=' + CSS.escape(input.name) + ']')) {
        if (inp.checked) response.value = inp.value;
      }
    }

    if (input.id in Q_INPUTS) {
      if (!Q_INPUTS[input.id].includes(msg.src)) {
        if (input.type !== 'radio') {
          Q_INPUTS[input.id].push(msg.src);
        } else {
          for (const inp of document.querySelectorAll('input[type=radio][name=' + CSS.escape(input.name) + ']')) {
            if (!(inp.id in Q_INPUTS)) Q_INPUTS[inp.id] = [];
            if (!Q_INPUTS[inp.id].includes(msg.src)) Q_INPUTS[inp.id].push(msg.src);
          }
        }
      }
      // Always send the initial-input response, even if this iframe/input
      // pair was already registered (e.g. duplicate registration request).
      IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
    } else {
      if (input.type !== 'radio') {
        Q_INPUTS[input.id] = [msg.src];
        input.addEventListener('change', () => {
          if (DISABLE_CHANGES) return;
          const resp = { version: 'STACK-JS:1.0.0', type: 'changed-input', name: msg.name };
          resp['value'] = input.type === 'checkbox' ? input.checked : input.value;
          for (const tgt of Q_INPUTS[input.id]) {
            resp['tgt'] = tgt;
            if (IFRAMES[tgt]) IFRAMES[tgt].contentWindow.postMessage(JSON.stringify(resp), '*');
          }
        });
      } else {
        const radgroup = document.querySelectorAll('input[type=radio][name=' + CSS.escape(input.name) + ']');
        for (const inp of radgroup) Q_INPUTS[inp.id] = [msg.src];
        radgroup.forEach(inp => {
          inp.addEventListener('change', () => {
            if (DISABLE_CHANGES || !inp.checked) return;
            const resp = { version: 'STACK-JS:1.0.0', type: 'changed-input', name: msg.name, value: inp.value };
            for (const tgt of Q_INPUTS[inp.id]) {
              resp['tgt'] = tgt;
              if (IFRAMES[tgt]) IFRAMES[tgt].contentWindow.postMessage(JSON.stringify(resp), '*');
            }
          });
        });
      }

      if (('track-input' in msg) && msg['track-input'] && input.type !== 'radio') {
        if (input.id in Q_INPUTS_INPUT_EVENT) {
          if (!Q_INPUTS_INPUT_EVENT[input.id].includes(msg.src)) {
            Q_INPUTS_INPUT_EVENT[input.id].push(msg.src);
          }
        } else {
          Q_INPUTS_INPUT_EVENT[input.id] = [msg.src];
          input.addEventListener('input', () => {
            if (DISABLE_CHANGES) return;
            const resp = { version: 'STACK-JS:1.0.0', type: 'changed-input', name: msg.name };
            resp['value'] = input.type === 'checkbox' ? input.checked : input.value;
            for (const tgt of Q_INPUTS_INPUT_EVENT[input.id]) {
              resp['tgt'] = tgt;
              if (IFRAMES[tgt]) IFRAMES[tgt].contentWindow.postMessage(JSON.stringify(resp), '*');
            }
          });
        }
      }

      IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
    }
    break;

  case 'changed-input':
    input = vle_get_input_element(msg.name, msg.src);
    if (input === null) {
      IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify({
        version: 'STACK-JS:1.0.0', type: 'error',
        msg: 'Failed to modify input: "' + msg.name + '"', tgt: msg.src
      }), '*');
      return;
    }
    DISABLE_CHANGES = true;
    if (input.type === 'checkbox') input.checked = msg.value;
    else input.value = msg.value;
    vle_update_input(input);
    DISABLE_CHANGES = false;

    response.type = 'changed-input';
    response.name = msg.name;
    response.value = msg.value;
    if (Q_INPUTS[input.id]) {
      for (const tgt of Q_INPUTS[input.id]) {
        if (tgt !== msg.src && IFRAMES[tgt]) {
          response.tgt = tgt;
          IFRAMES[tgt].contentWindow.postMessage(JSON.stringify(response), '*');
        }
      }
    }
    break;

  case 'toggle-visibility':
    element = vle_get_element(msg.target);
    if (element === null) {
      IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify({
        version: 'STACK-JS:1.0.0', type: 'error',
        msg: 'Failed to find element: "' + msg.target + '"', tgt: msg.src
      }), '*');
      return;
    }
    if (msg.set === 'show') { element.style.display = 'block'; vle_update_dom(element); }
    else if (msg.set === 'hide') element.style.display = 'none';
    break;

  case 'change-content':
    element = vle_get_element(msg.target);
    if (element === null) {
      response.type = 'error';
      response.msg = 'Failed to find element: "' + msg.target + '"';
      response.tgt = msg.src;
      IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
      return;
    }
    element.replaceChildren(vle_html_sanitize(msg.content));
    vle_update_dom(element);
    break;

  case 'get-content':
    element = vle_get_element(msg.target);
    response.type = 'xfer-content';
    response.tgt = msg.src;
    response.target = msg.target;
    response.content = element ? element.innerHTML : null;
    IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
    break;

  case 'resize-frame':
    element = IFRAMES[msg.src].parentElement;
    element.style.width = msg.width;
    element.style.height = msg.height;
    IFRAMES[msg.src].style.width = '100%';
    IFRAMES[msg.src].style.height = '100%';
    vle_update_dom(element);
    break;

  case 'ping':
    response.type = 'ping';
    response.tgt = msg.src;
    IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
    return;

  case 'initial-input':
  case 'error':
    break;

  default:
    response.type = 'error';
    response.msg = 'Unknown message-type: "' + msg.type + '"';
    response.tgt = msg.src;
    IFRAMES[msg.src].contentWindow.postMessage(JSON.stringify(response), '*');
  }
});

function create_iframe(iframeid, content, targetdivid, title, scrolling, evil) {
  const frm = document.createElement('iframe');
  frm.id = iframeid;
  frm.style.width = '100%';
  frm.style.height = '100%';
  frm.style.border = 0;
  if (scrolling === false) {
    frm.scrolling = 'no';
    frm.style.overflow = 'hidden';
  } else {
    frm.scrolling = 'yes';
  }
  frm.title = title;
  frm.referrerpolicy = 'no-referrer';
  if (!evil) frm.sandbox = 'allow-scripts allow-downloads';
  frm.srcdoc = content;

  const targetDiv = document.getElementById(targetdivid);
  targetDiv.replaceChildren(frm);
  IFRAMES[iframeid] = frm;

  // Register this iframe in the per-question registry by finding its question boundary
  const boundary = vle_get_question_boundary(targetDiv);
  if (boundary && boundary.id) {
    IFRAME_TO_BOUNDARY[iframeid] = boundary.id;
    const reg = getQuestionRegistry(boundary.id);
    reg.iframes[iframeid] = frm;
  }
}