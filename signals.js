// SIGNALS — the interest categories (interests.js) that orbit the core in Beyond.
// beyond.js draws them in the ASCII canvas; this module layers a real <button> over each one, so they
// work with Tab, screen readers and touch, and runs the EB//OS panel that lists a category's items.
// On phones the buttons drop out of orbit into a 2-column list under the core (see style.css).

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createSignals({ layer, panel, body, closeBtn, interests, beyond }) {
  let openIdx = -1, shown = false;

  const buttons = interests.map((sg, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'signal';
    b.style.setProperty('--c', sg.color);
    b.setAttribute('aria-label', `Open ${sg.label}, ${sg.items.length} item${sg.items.length === 1 ? '' : 's'}`);
    b.setAttribute('aria-controls', panel.id);
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = `<span class="signal-key" aria-hidden="true">${i + 1}</span><span class="signal-label" aria-hidden="true">${esc(sg.label)}</span>`;
    b.addEventListener('pointerenter', () => beyond.hover(i));
    b.addEventListener('pointerleave', () => beyond.hover(-1));
    b.addEventListener('focus', () => beyond.hover(i));
    b.addEventListener('blur', () => beyond.hover(-1));
    b.addEventListener('click', () => (openIdx === i ? close() : open(i)));
    layer.appendChild(b);
    return b;
  });

  function render(i) {
    const sg = interests[i];
    const n = sg.items.length;
    body.innerHTML = `<div class="d-wrap">
      <div class="d-kicker">SIGNAL ${pad(i + 1)} · ${pad(n)} ITEM${n === 1 ? '' : 'S'}</div>
      <h2 class="d-title" id="signalTitle" tabindex="-1">${esc(sg.label)}</h2>
      <ul class="sp-list">${sg.items.map((it, k) => `
        <li><span class="sp-n">${pad(k + 1)}</span><div>
          ${it.prompt ? `<div class="sp-prompt">${esc(it.prompt)}</div>` : ''}<div class="sp-name">${esc(it.name)}</div>${it.note ? `<div class="sp-note">${esc(it.note)}</div>` : ''}
        </div></li>`).join('')}
      </ul>
      <div class="pager">
        <button type="button" data-step="-1">◂ PREV</button>
        <button type="button" data-step="1">NEXT ▸</button>
      </div>
    </div>`;
  }

  function open(i) {
    if (i < 0 || i >= interests.length || !beyond.atCore) return;
    if (openIdx >= 0) buttons[openIdx].setAttribute('aria-expanded', 'false');
    openIdx = i;
    render(i);
    panel.style.setProperty('--c', interests[i].color);
    panel.classList.add('open');
    panel.removeAttribute('inert');
    panel.setAttribute('aria-hidden', 'false');
    buttons[i].setAttribute('aria-expanded', 'true');
    beyond.select(i);
    body.querySelector('#signalTitle').focus({ preventScroll: true });
  }

  function close({ restoreFocus = true } = {}) {
    if (openIdx < 0) return;
    const i = openIdx;
    openIdx = -1;
    panel.classList.remove('open');
    panel.setAttribute('inert', '');
    panel.setAttribute('aria-hidden', 'true');
    buttons[i].setAttribute('aria-expanded', 'false');
    beyond.select(-1);
    if (restoreFocus && shown) buttons[i].focus({ preventScroll: true });
  }

  body.addEventListener('click', (e) => {
    const step = e.target.closest('button[data-step]')?.dataset.step;
    if (step) open((openIdx + Number(step) + interests.length) % interests.length);
  });
  closeBtn.addEventListener('click', () => close());

  // called by beyond.js every frame with where each satellite is
  let mode = '';
  function update({ sats, arrive, atCore, mobile }) {
    const show = atCore && arrive > 0.5;
    if (show !== shown) {
      shown = show;
      layer.classList.toggle('show', show);
      layer.toggleAttribute('inert', !show); // hidden signals can't be tabbed to
      if (!show) { close({ restoreFocus: false }); beyond.hover(-1); }
    }
    const m = mobile ? 'grid' : 'orbit';
    if (m !== mode) {
      mode = m;
      layer.classList.toggle('grid', mobile);
      if (mobile) buttons.forEach((b) => (b.style.transform = ''));
    }
    if (!mobile && show) {
      for (let i = 0; i < buttons.length; i++) {
        buttons[i].style.transform = `translate(${sats[i].x.toFixed(1)}px, ${sats[i].y.toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
  }

  // leaving Beyond or replaying: close quietly, forget any hover and hide the signals straight away
  // (the frame loop that normally hides them stops when Beyond closes)
  function reset() {
    close({ restoreFocus: false });
    beyond.hover(-1);
    shown = false;
    layer.classList.remove('show');
    layer.setAttribute('inert', '');
  }

  return { update, open, close, reset, get isOpen() { return openIdx >= 0; } };
}
