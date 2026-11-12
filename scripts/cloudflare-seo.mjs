const SOURCE_ORIGIN = 'https://thelogbook.web.app';

function exactTargetOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('Cloudflare SEO target must be an exact HTTPS origin');
  }
  return value;
}

function rebaseSourceUrl(raw, path, target) {
  const url = new URL(raw);
  if (url.href !== SOURCE_ORIGIN + path) {
    throw new Error('Unexpected SEO URL origin or path');
  }
  return target + path;
}

// SEO inputs are first-party build artifacts. Parse the complete URL, not a
// substring that can also appear in an attacker-controlled host or query.
export function rewriteCloudflareSeo(file, content, targetOrigin) {
  const target = exactTargetOrigin(targetOrigin);
  let count = 0;
  let result;
  if (file === 'robots.txt') {
    result = content.replace(/^Sitemap:[ \t]*(\S+)[ \t]*$/gm, (_line, raw) => {
      count++;
      return 'Sitemap: ' + rebaseSourceUrl(raw, '/sitemap.xml', target);
    });
  } else if (file === 'sitemap.xml') {
    result = content.replace(/<loc>([^<]*)<\/loc>/g, (_loc, raw) => {
      count++;
      return '<loc>' + rebaseSourceUrl(raw, '/', target) + '</loc>';
    });
  } else {
    throw new Error('Unexpected SEO build artifact');
  }
  if (count !== 1) throw new Error('Expected exactly one canonical SEO URL in ' + file);
  return result;
}

export function assertCloudflareHtmlOrigin(html, targetOrigin) {
  const target = exactTargetOrigin(targetOrigin);
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?\s*>/i);
  if (!match || new URL(match[1]).href !== target + '/') {
    throw new Error('Cloudflare app shell canonical origin incorrect');
  }
  for (const attribute of html.matchAll(/\b(?:href|content)="(https?:\/\/[^"]+)"/g)) {
    if (new URL(attribute[1]).origin === SOURCE_ORIGIN) {
      throw new Error('Cloudflare app shell still references the retired frontend origin');
    }
  }
}
