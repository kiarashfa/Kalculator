// Google Analytics 4 loader — the ONLY place the measurement ID is written.
// Every page (index.html, 404.html) includes this with a plain
// `<script async src="analytics.js"></script>`, so changing the property is a
// one-line edit here. The ID is public by design; it ships in page source.
const GA_ID = 'G-R78PLNGXSS';

const s = document.createElement('script');
s.async = true;
s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
document.head.appendChild(s);

window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_ID);
