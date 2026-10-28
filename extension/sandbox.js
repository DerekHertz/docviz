// Receives one model-written HTML document from the card and replaces itself
// with it. A tiny reporter is appended so the card can size the frame.
const REPORTER = '<script>(() => {' +
  "const post = () => parent.postMessage({ docvizHeight: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*');" +
  "new ResizeObserver(post).observe(document.documentElement); addEventListener('load', post); post();" +
  '})();<\/script>';

addEventListener('message', (e) => {
  if (e.source !== parent || typeof e.data?.html !== 'string') return;
  document.open();
  document.write(e.data.html + REPORTER);
  document.close();
});
