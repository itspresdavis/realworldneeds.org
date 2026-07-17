(() => {
  document.documentElement.classList.remove('no-js');
  document.documentElement.classList.add('js');

  const header = document.querySelector('[data-site-header]');
  const syncHeader = () => {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 10);
  };

  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-close-details]');
    if (!closeButton) return;
    const details = closeButton.closest('details');
    if (details) details.open = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('details[open]').forEach((details) => {
      details.open = false;
    });
  });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const revealTargets = document.querySelectorAll(
      '.rwn-section__inner, .home-hero__copy, .home-hero__media, .product-card, .story-card, .need-card, .launch-state'
    );
    revealTargets.forEach((target) => target.classList.add('will-reveal'));

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

    revealTargets.forEach((target) => observer.observe(target));
  }
})();
