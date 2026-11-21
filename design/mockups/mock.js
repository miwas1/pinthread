// Shared helpers for PinThread mockups. Requires ../../assets/meridian/sheet.js (window.PT_SHEET).
(function () {
  const S = window.PT_SHEET;
  const W = S.width, H = S.height;
  const G = S.geometry;

  const ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    route: '<circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/><path d="M7.5 18.5h6a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7h6" stroke-dasharray="2.5 2.5"/>',
    hold: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M9 12h6"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
    qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>', chevdown: '<path d="M6 9l6 6 6-6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -6)"/>',
    pencil: '<path d="M4 20l1-5L16 4l4 4L9 19z"/>', type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>', at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    hash: '<path d="M9 4L7 20M17 4l-2 16M4.5 9h16M3.5 15h16"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  };
  const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24">${ICONS[n]}</svg>`;

  const STATUS = {
    open: { label: 'Open', color: 'var(--open)' },
    review: { label: 'In review', color: 'var(--review)' },
    blocked: { label: 'Blocked', color: 'var(--blocked)' },
    complete: { label: 'Review complete', color: 'var(--complete)' },
  };

  // Chip glyphs share one shape language with pin glyphs: ring / half / octagon / check.
  function glyph(st) {
    const g = {
      open: '<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2"/>',
      review: '<circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 2a5 5 0 0 0 0 10z" fill="currentColor"/>',
      blocked: '<path d="M4.9 1.5h4.2l3.4 3.4v4.2l-3.4 3.4H4.9L1.5 9.1V4.9z" fill="currentColor"/><path d="M4.5 7h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
      complete: '<circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M4.2 7.2l2 2 3.8-4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    }[st];
    return `<svg class="glyph" viewBox="0 0 14 14">${g}</svg>`;
  }
  const chip = (st, text, cls = '') => `<span class="status ${st} ${cls}">${glyph(st)}${text || STATUS[st].label}</span>`;

  function marker(st) {
    const c = STATUS[st].color;
    const head = st === 'blocked'
      ? `<path d="M11.6 4h10.8l7.6 7.6v10.8l-3 3L17 42.5 7.9 25.4l-3.9-3V11.6z" fill="${c}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`
      : `<path d="M17 42.5S4 28.6 4 17a13 13 0 0 1 26 0c0 11.6-13 25.5-13 25.5z" fill="${c}" stroke="#fff" stroke-width="2"/>`;
    const gl = {
      open: '<circle cx="17" cy="17" r="5.6" fill="none" stroke="#fff" stroke-width="2.6"/>',
      review: '<circle cx="17" cy="17" r="5.6" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M17 11.4a5.6 5.6 0 0 0 0 11.2z" fill="#fff"/>',
      blocked: '<path d="M11.5 17h11" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
      complete: '<path d="M11.2 17.4l4 4 7.6-8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    }[st];
    return `<svg class="marker" viewBox="0 0 34 44">${head}${gl}</svg>`;
  }

  function pinHTML(p, x, y) {
    const st = p.status;
    const label = p.label === false ? '' :
      `<span class="label"><span class="id">${p.id}</span><span class="st">${p.text || STATUS[st].label}</span></span>`;
    const badge = p.badge ? `<span class="badge">${p.badge}</span>` : '';
    return `<div class="pin ${st} ${p.sel ? 'sel' : ''} ${p.pulse ? 'pulse' : ''}" style="left:${x}px;top:${y}px">${p.sel ? '<span class="halo"></span>' : ''}${marker(st)}${badge}${label}</div>`;
  }

  function routeSVG(route, { scale = 1, ghost = false, handles = false } = {}) {
    if (!route) return '';
    const pts = route.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(' ');
    const [sx, sy] = [route[0][0] * W, route[0][1] * H];
    const [ex, ey] = [route.at(-1)[0] * W, route.at(-1)[1] * H];
    const sw = 3.2 / scale, under = 7 / scale, dash = `${9 / scale} ${6 / scale}`;
    const col = ghost ? '#9AA2AE' : 'var(--redline)';
    let s = `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${under}" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>`;
    s += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<circle cx="${sx}" cy="${sy}" r="${4.5 / scale}" fill="${col}" stroke="#fff" stroke-width="${1.5 / scale}"/>`;
    const a = Math.atan2(ey - route.at(-2)[1] * H, ex - route.at(-2)[0] * W);
    const L = 11 / scale;
    s += `<path d="M${ex} ${ey} L${ex - L * Math.cos(a - .45)} ${ey - L * Math.sin(a - .45)} L${ex - L * Math.cos(a + .45)} ${ey - L * Math.sin(a + .45)} Z" fill="${col}" stroke="#fff" stroke-width="${1 / scale}"/>`;
    if (handles) route.forEach(([x, y]) => { s += `<circle cx="${x * W}" cy="${y * H}" r="${5.5 / scale}" fill="#fff" stroke="var(--redline)" stroke-width="${2 / scale}"/>`; });
    return s;
  }

  function layerStyle(layers) {
    if (!layers) return '';
    return Object.entries(layers).filter(([, on]) => !on).map(([k]) => `#layer-${k}{display:none}`).join('');
  }

  // Mount a zoomed view of the sheet into `el`. cx, cy in sheet units; zoom = screen px per sheet unit.
  function mountSheet(el, { cx, cy, zoom, pins = [], route, routeOpts = {}, layers, extra = '' }) {
    const cw = el.clientWidth, ch = el.clientHeight;
    const left = cw / 2 - cx * zoom, top = ch / 2 - cy * zoom;
    const cam = document.createElement('div');
    cam.className = 'cam';
    cam.style.cssText = `width:${W * zoom}px;height:${H * zoom}px;transform:translate(${left}px,${top}px)`;
    cam.innerHTML = `<svg class="sheet" viewBox="0 0 ${W} ${H}"><style>${layerStyle(layers)}</style>${S.inner}</svg>
      <svg class="overlay" viewBox="0 0 ${W} ${H}">${routeSVG(route, { scale: zoom, ...routeOpts })}${extra}</svg>
      ${pins.map(p => { const [nx, ny] = G.pins[p.id].at; return pinHTML(p, nx * W * zoom, ny * H * zoom); }).join('')}`;
    el.prepend(cam);
  }

  // Static crop (for cards, brief, PDF). x,y,w,h in sheet units.
  function crop({ x, y, w, h, route, pinId, pinStatus = 'review', ghostRoute }) {
    const scale = 330 / w; // approximate px per unit at card width
    let ov = '';
    if (ghostRoute) ov += routeSVG(ghostRoute, { scale, ghost: true });
    if (route) ov += routeSVG(route, { scale });
    if (pinId) {
      const [nx, ny] = G.pins[pinId].at; const px = nx * W, py = ny * H; const k = 0.75 / scale * 1.2;
      ov += `<g transform="translate(${px - 17 * k} ${py - 44 * k}) scale(${k})">${marker(pinStatus).replace('<svg class="marker" viewBox="0 0 34 44">', '').replace('</svg>', '')}</g>`;
    }
    return `<svg viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid slice">${S.inner}${ov}</svg>`;
  }

  // Stylised field photo: galvanised duct meeting a steel beam, spray-paint mark. Illustrative stand-in for a real site photo.
  function photo() {
    return `<svg viewBox="0 0 360 200">
      <defs><linearGradient id="ceil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8E959C"/><stop offset="1" stop-color="#B9BEC2"/></linearGradient>
      <linearGradient id="duct" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E4E8EB"/><stop offset=".5" stop-color="#C3CACF"/><stop offset="1" stop-color="#9EA6AC"/></linearGradient>
      <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5E6A78"/><stop offset=".5" stop-color="#788594"/><stop offset="1" stop-color="#55606C"/></linearGradient></defs>
      <rect width="360" height="200" fill="url(#ceil)"/>
      <path d="M0 0h360v22H0z" fill="#7B8288"/>
      <g stroke="#5B6168" stroke-width="2">${[40, 120, 250, 320].map(x => `<line x1="${x}" y1="22" x2="${x}" y2="70"/>`).join('')}</g>
      <path d="M150 0h70l-8 200h-54z" fill="url(#beam)"/><path d="M150 0h70v14h-70z" fill="#4A5561"/><path d="M158 186h54v14h-54z" fill="#4A5561"/>
      <path d="M0 70h162v62H0z" fill="url(#duct)"/><g stroke="#8A9298" stroke-width="1.5">${[30, 75, 120].map(x => `<line x1="${x}" y1="70" x2="${x}" y2="132"/>`).join('')}</g>
      <path d="M158 70l8 -2v66l-8 -2z" fill="#7E878D"/>
      <path d="M213 74h147v58H213z" fill="url(#duct)" opacity=".55"/>
      <path d="M176 96l26 26M202 96l-26 26" stroke="#E5357B" stroke-width="5" stroke-linecap="round"/>
      <circle cx="189" cy="109" r="22" fill="none" stroke="#E5357B" stroke-width="3" stroke-dasharray="5 4"/>
      <rect x="10" y="168" width="104" height="20" rx="4" fill="rgba(17,24,39,.65)"/><text x="18" y="182" font-size="10.5" fill="#fff" font-family="IBM Plex Mono, monospace">IMG_0742 · 07:42</text>
    </svg>`;
  }

  const logo = (size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M12 2.5a6.5 6.5 0 0 1 6.5 6.5c0 4.6-6.5 10.6-6.5 10.6S5.5 13.6 5.5 9A6.5 6.5 0 0 1 12 2.5z" fill="#111827"/><circle cx="12" cy="9" r="2.4" fill="#fff"/><path d="M12 19.6c2.4 2.5 6.6 2.5 9.4.4" stroke="#16A34A" stroke-width="2.1" fill="none" stroke-linecap="round"/></svg>`;

  const av = (initials, disc, mark, cls = '') => `<span class="av ${disc} ${cls}">${initials}${mark ? `<span class="mark ${mark}">${mark === 'ok' ? '<svg viewBox="0 0 10 10"><path d="M2 5.2l2 2 4-4.4"/></svg>' : ''}</span>` : ''}</span>`;

  window.PT = { icon, chip, glyph, marker, mountSheet, crop, photo, logo, av, G, W, H, ROUTE: G.routes['RFI-001/v1'] };
})();
