(() => {
  const doc = document.documentElement;
  doc.classList.remove('no-js');
  doc.classList.add('js');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('[data-site-header]');
  let frameRequested = false;

  const syncHeader = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
  };

  const requestFrame = (callback) => {
    if (frameRequested) return;
    frameRequested = true;
    window.requestAnimationFrame(() => {
      callback();
      frameRequested = false;
    });
  };

  syncHeader();
  window.addEventListener('scroll', () => requestFrame(syncHeader), { passive: true });

  const drawerDetails = Array.from(document.querySelectorAll('.mobile-menu, .cart-drawer'));
  const previousFocus = new WeakMap();
  const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const syncOpenState = () => {
    const hasOpenDrawer = drawerDetails.some((details) => details.open);
    document.body.classList.toggle('menu-open', hasOpenDrawer);
    drawerDetails.forEach((details) => {
      const summary = details.querySelector(':scope > summary');
      if (summary) {
        summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
        if (details.classList.contains('mobile-menu')) summary.setAttribute('aria-label', details.open ? 'Close menu' : 'Open menu');
        if (details.classList.contains('cart-drawer')) summary.setAttribute('aria-label', details.open ? 'Close cart' : 'Open cart');
      }
    });
  };

  drawerDetails.forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        previousFocus.set(details, document.activeElement);
        drawerDetails.forEach((other) => {
          if (other !== details) other.open = false;
        });
        window.setTimeout(() => {
          const panel = details.querySelector('.mobile-menu__panel, .cart-drawer__panel');
          const firstControl = panel && panel.querySelector(focusableSelector);
          if (firstControl) firstControl.focus({ preventScroll: true });
        }, 0);
      } else {
        const returnTarget = previousFocus.get(details);
        if (returnTarget && typeof returnTarget.focus === 'function') returnTarget.focus({ preventScroll: true });
      }
      syncOpenState();
    });

    details.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !details.open) return;
      const panel = details.querySelector('.mobile-menu__panel, .cart-drawer__panel');
      if (!panel) return;
      const controls = Array.from(panel.querySelectorAll(focusableSelector)).filter((control) => control.offsetParent !== null);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  });
  syncOpenState();

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-close-details]');
    if (closeButton) {
      const details = closeButton.closest('details');
      if (details) details.open = false;
      return;
    }

    const menuLink = event.target.closest('.mobile-menu__links a');
    if (menuLink) {
      const menu = menuLink.closest('details');
      if (menu) menu.open = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openDrawer = drawerDetails.find((details) => details.open);
    if (openDrawer) {
      openDrawer.open = false;
      return;
    }
    document.querySelectorAll('details[open]').forEach((details) => {
      details.open = false;
    });
  });

  const revealTargets = document.querySelectorAll('[data-reveal]');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((target) => target.classList.add('is-visible'));
  } else {
    revealTargets.forEach((target) => target.classList.add('will-reveal'));
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    revealTargets.forEach((target) => revealObserver.observe(target));
  }

  const processSteps = document.querySelectorAll('[data-process-step]');
  if (processSteps.length && 'IntersectionObserver' in window) {
    const processLinks = document.querySelectorAll('[data-process-link]');
    const visibleSteps = new Set();
    const activateProcessStep = (activeStep) => {
      processLinks.forEach((link) => {
        if (link.dataset.processLink === activeStep) link.setAttribute('aria-current', 'step');
        else link.removeAttribute('aria-current');
      });
    };
    const processObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visibleSteps.add(entry.target);
        else visibleSteps.delete(entry.target);
      });
      const viewportFocus = window.innerHeight * 0.42;
      const visible = Array.from(visibleSteps).sort((a, b) => {
        return Math.abs(a.getBoundingClientRect().top - viewportFocus) - Math.abs(b.getBoundingClientRect().top - viewportFocus);
      })[0];
      if (visible) activateProcessStep(visible.dataset.processStep);
    }, { rootMargin: '-30% 0px -50% 0px', threshold: 0 });
    processSteps.forEach((step) => processObserver.observe(step));
    processLinks.forEach((link) => {
      link.addEventListener('click', () => activateProcessStep(link.dataset.processLink));
    });
  }

  const progress = document.querySelector('[data-article-progress]');
  const article = document.querySelector('.article-page');
  if (progress && article) {
    const syncProgress = () => {
      const articleTop = article.offsetTop;
      const available = Math.max(article.offsetHeight - window.innerHeight, 1);
      const read = Math.min(Math.max((window.scrollY - articleTop) / available, 0), 1);
      progress.style.width = `${read * 100}%`;
    };
    syncProgress();
    window.addEventListener('scroll', () => window.requestAnimationFrame(syncProgress), { passive: true });
    window.addEventListener('resize', syncProgress);
  }

  document.querySelectorAll('[data-copy-link]').forEach((button) => {
    button.addEventListener('click', async () => {
      const original = button.textContent;
      try {
        await navigator.clipboard.writeText(window.location.href);
        button.textContent = 'Link copied';
      } catch (error) {
        button.textContent = 'Copy unavailable';
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1800);
    });
  });

  document.querySelectorAll('[data-auto-submit]').forEach((control) => {
    control.addEventListener('change', () => {
      if (control.form) control.form.submit();
    });
  });

  document.querySelectorAll('[data-product-form]').forEach((form) => {
    const variantData = form.querySelector('[data-product-variants]');
    const variantInput = form.querySelector('[data-variant-id]');
    const optionControls = Array.from(form.querySelectorAll('[data-product-option]'));
    const price = form.closest('.product-buybox')?.querySelector('[data-product-price]');
    const addButton = form.querySelector('[data-add-to-cart]');
    const status = form.querySelector('[data-variant-status]');
    if (!variantData || !variantInput || !optionControls.length) return;

    let variants = [];
    try {
      variants = JSON.parse(variantData.textContent);
    } catch (error) {
      return;
    }

    const currency = form.dataset.currency || 'USD';
    const locale = form.dataset.locale || 'en-US';
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency });

    const syncVariant = () => {
      const selected = optionControls.map((control) => control.value);
      const variant = variants.find((item) => item.options.every((option, index) => option === selected[index]));
      if (!variant) {
        variantInput.value = '';
        if (addButton) {
          addButton.disabled = true;
          addButton.textContent = 'Unavailable';
        }
        if (status) status.textContent = 'This combination is unavailable.';
        return;
      }

      variantInput.value = variant.id;
      if (price) price.textContent = money.format(variant.price / 100);
      if (addButton) {
        addButton.disabled = !variant.available;
        addButton.textContent = variant.available ? 'Add to cart' : 'Out of stock';
      }
      if (status) status.textContent = variant.available ? 'Available' : 'This option is out of stock.';

      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
    };

    optionControls.forEach((control) => control.addEventListener('change', syncVariant));
    syncVariant();
  });
})();
