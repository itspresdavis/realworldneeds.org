(() => {
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
})();
