/// Visually flag intra-document anchor links whose targets don't exist.
export function flagBrokenAnchors(root: HTMLElement): void {
  const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]');
  anchors.forEach(a => {
    const href = a.getAttribute('href') ?? '';
    if (href.length <= 1) return;
    const id = decodeURIComponent(href.slice(1));
    if (document.getElementById(id)) {
      a.classList.remove('mv-broken');
    } else {
      a.classList.add('mv-broken');
      a.title = `Broken link: no section with id "${id}"`;
    }
  });
}