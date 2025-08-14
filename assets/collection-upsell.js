// assets/collection-upsell.js — v11
// - Adds base + selected upsells with /cart/add.js (single request)
// - Refreshes cart sections via Section Rendering API
// - Dispatches 'cart:update' with /cart.js so Horizon opens the drawer

(() => {
  const sections = document.querySelectorAll('[id^="collection-upsell-"]');
  if (!sections.length) return;

  const rootUrl = (window.Shopify?.routes?.root) || '/';
  const getCartAddUrl = () => (window.routes?.cart_add_url) || '/cart/add.js';

  const formatMoney = (cents) => {
    try {
      if (typeof Shopify !== 'undefined' && typeof Shopify.formatMoney === 'function') {
        const fmt = (window.theme && window.theme.moneyFormat) ||
                    (window.Shopify && window.Shopify.money_format);
        if (fmt) return Shopify.formatMoney(cents, fmt);
      }
    } catch (e) {}
    const currency = (window.Shopify?.currency?.active) || 'USD';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents || 0) / 100);
  };

  const escapeHtml = (str) => {
    if (str == null) return '';
    return String(str)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  };

  // Section Rendering API refresh
  const refreshSections = async (idsCsv) => {
    const ids = (idsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return { replaced: [] };

    const url = `${rootUrl}?sections=${encodeURIComponent(ids.join(','))}&_=${Date.now()}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) return { replaced: [] };
    const json = await res.json();

    const replaced = [];
    const runInlineScripts = (container) => {
      container.querySelectorAll('script').forEach((old) => {
        const s = document.createElement('script');
        [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
        if (!s.src) s.textContent = old.textContent;
        old.replaceWith(s);
      });
    };

    ids.forEach((id) => {
      const html = json[id];
      const current = document.getElementById(`shopify-section-${id}`);
      if (html && current) {
        current.innerHTML = html;
        runInlineScripts(current);
        replaced.push(id);
      }
    });

    document.dispatchEvent(new CustomEvent('cart:updated'));
    document.dispatchEvent(new CustomEvent('theme:cart:change'));
    document.dispatchEvent(new CustomEvent('cart:refresh'));
    try { window.HorizonCart?.init?.(); } catch (e) {}

    return { replaced };
  };

  sections.forEach((section) => {
    const modal = section.querySelector('[data-upsell-modal]');
    const dialog = modal.querySelector('.upsell-modal__dialog');
    const backdrop = modal.querySelector('.upsell-modal__backdrop');

    const eyebrow = modal.querySelector('[data-eyebrow]');
    const baseProductEl = modal.querySelector('[data-base-product]');
    const carousel = modal.querySelector('[data-upsell-carousel]');
    const subtotalEl = modal.querySelector('[data-subtotal]');
    const confirmBtn = modal.querySelector('[data-confirm-add]');

    const refreshIds = section.getAttribute('data-refresh-sections') || '';
    const modalHeading = section.getAttribute('data-modal-heading') || 'Complete your look';

    const state = { base: null, upsells: [] };
    eyebrow.textContent = modalHeading;

    const openModal = () => { modal.hidden = false; document.body.style.overflow = 'hidden'; };
    const closeModal = () => { modal.hidden = true;  document.body.style.overflow = ''; };

    // Backdrop & X close
    backdrop.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeModal(); }, true);
    dialog.addEventListener('click', (e) => {
      if (e.target.matches('[data-modal-close]')) { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
      e.stopPropagation();
    });

    // Open trigger
    section.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-modal]');
      if (!trigger || !section.contains(trigger)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      const card = trigger.closest('.product-card');
      const jsonEl = card?.querySelector('.product-upsell-data');
      if (!jsonEl) return;

      try {
        const data = JSON.parse(jsonEl.textContent);
        state.base = {
          title: data.title,
          imageUrl: data.imageUrl,
          variantId: Number(data.variantId),
          variantPrice: Number(data.variantPrice),
          sku: data.sku
        };
        state.upsells = (data.upsells || []).map(u => ({
          ...u,
          variantId: Number(u.variantId),
          price: Number(u.price),
          selected: false
        }));
        renderModal();
        openModal();
      } catch (err) { console.error('Upsell modal data parse error', err); }
    }, true);

    // Toggle upsells
    carousel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-toggle-upsell]');
      if (!btn) return;
      e.preventDefault();
      const vid = Number(btn.getAttribute('data-variant-id'));
      const idx = state.upsells.findIndex(u => u.variantId === vid);
      if (idx > -1) {
        state.upsells[idx].selected = !state.upsells[idx].selected;
        renderUpsells();
        renderSubtotal();
      }
    });

    // Confirm add
    confirmBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      confirmBtn.disabled = true;

      try {
        const items = [
          { id: state.base.variantId, quantity: 1 },
          ...state.upsells.filter(u => u.selected).map(u => ({ id: u.variantId, quantity: 1 }))
        ];
        if (!items.length) { closeModal(); return; }

        // Close modal first
        closeModal();

        // Add all items
        const res = await fetch(getCartAddUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ items })
        });
        if (!res.ok) {
          let errMsg = 'Add to cart failed';
          try { const j = await res.json(); if (j?.description) errMsg = j.description; } catch {}
          throw new Error(errMsg);
        }

        // Refresh cart sections
        await refreshSections(refreshIds);

        // Dispatch Horizon cart event
        const cart = await fetch(`${rootUrl}cart.js?_${Date.now()}`, { credentials: 'same-origin' }).then(r => r.json());
        const evt = new CustomEvent('cart:update', {
          bubbles: true,
          detail: { resource: cart, sourceId: 'upsell-modal', data: { source: 'upsell-modal', variantId: state.base.variantId } }
        });
        document.dispatchEvent(evt);

      } catch (err) {
        console.error(err);
        alert('Sorry—could not add to cart. ' + (err?.message || ''));
      } finally {
        confirmBtn.disabled = false;
      }
    });

    // ---------- Renderers ----------
    function renderModal() {
      baseProductEl.innerHTML = `
        <div class="base">
          ${state.base.imageUrl ? `<img src="${state.base.imageUrl}" alt="">` : ''}
          <div>
            <h3 id="upsellModalTitle" style="margin:0 0 4px 0; font-size:clamp(1.25rem,1rem + .8vw,1.9rem);">${escapeHtml(state.base.title)}</h3>
            <div class="sku" style="opacity:.8;">SKU: ${escapeHtml(state.base.sku || '—')}</div>
            <div class="price">${formatMoney(state.base.variantPrice)}</div>
          </div>
        </div>`;
      renderUpsells();
      renderSubtotal();
    }

    function renderUpsells() {
      if (!state.upsells.length) {
        carousel.innerHTML = `<p class="muted">No upsell products.</p>`;
        return;
      }
      carousel.innerHTML = state.upsells.map(u => `
        <div class="upsell-row ${u.available ? '' : 'is-disabled'}">
          <div class="media">${u.imageUrl ? `<img src="${u.imageUrl}" alt="">` : ''}</div>
          <div class="info">
            <div class="title">${escapeHtml(u.title)}</div>
            <div class="price">${formatMoney(u.price)}</div>
          </div>
          <div class="spacer"></div>
          <button class="button" type="button" data-toggle-upsell data-variant-id="${u.variantId}" ${u.available ? '' : 'disabled'}>
            ${u.selected ? 'Unselect' : 'Select'}
          </button>
        </div>
      `).join('');
    }

    function renderSubtotal() {
      const upsellTotal = state.upsells.filter(u => u.selected).reduce((sum, u) => sum + (u.price || 0), 0);
      const total = (state.base.variantPrice || 0) + upsellTotal;
      subtotalEl.textContent = formatMoney(total);
    }
  });
})();
