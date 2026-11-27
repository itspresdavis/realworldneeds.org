// Read the saved language before the shared header paints. No network or cookies.
try {
  const language = localStorage.getItem('rwn-language');
  if (language === 'en' || language === 'es') document.documentElement.lang = language;
} catch { /* English remains usable when browser storage is unavailable. */ }
