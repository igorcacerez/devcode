// DEV CODE - Protótipo: sistema de estilos (CSS completo), fontes do Google e exportação fiel.
window.DevStyle = (function () {
	'use strict';

	// ================================================================== cores
	function parseColor(c) {
		if (!c || c === 'transparent') { return { hex: '#000000', a: 0 }; }
		let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
		if (m) { return { hex: `#${m[1]}`, a: m[2] ? parseInt(m[2], 16) / 255 : 1 }; }
		m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
		if (m) { return { hex: `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`, a: 1 }; }
		m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/i.exec(c);
		if (m) {
			const hx = [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
			const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
			return { hex: `#${hx}`, a };
		}
		return { hex: '#000000', a: 1, raw: c };
	}
	function toColor(hex, a) { return a >= 1 ? hex.toUpperCase() : `${hex.toUpperCase()}${Math.round(Math.max(0, a) * 255).toString(16).padStart(2, '0').toUpperCase()}`; }

	// ================================================================== CSS a partir do modelo
	const SYSTEM_FONTS = new Set(['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Impact', 'sans-serif', 'serif', 'monospace']);

	function fillCss(n) {
		const type = n.fillType || 'solid';
		if (type === 'none') { return 'transparent'; }
		if (type === 'linear' || type === 'radial') {
			const stops = (n.gradient?.stops?.length ? n.gradient.stops : [{ color: '#D10A0A', pos: 0 }, { color: '#111111', pos: 100 }]).map(s => `${s.color} ${s.pos}%`).join(', ');
			return type === 'linear' ? `linear-gradient(${n.gradient?.angle ?? 180}deg, ${stops})` : `radial-gradient(${n.gradient?.shape || 'circle'} at center, ${stops})`;
		}
		return n.fill || 'transparent';
	}
	function shadowsOf(n) {
		const list = Array.isArray(n.shadows) ? n.shadows : [];
		if (!list.length && n.shadow?.on) { return [{ x: n.shadow.x, y: n.shadow.y, blur: n.shadow.blur, spread: 0, color: n.shadow.color, inset: false }]; }
		return list;
	}
	function filterCss(f = {}) {
		const parts = [];
		if (f.blur) { parts.push(`blur(${f.blur}px)`); }
		if (f.brightness !== undefined && f.brightness !== 100) { parts.push(`brightness(${f.brightness}%)`); }
		if (f.contrast !== undefined && f.contrast !== 100) { parts.push(`contrast(${f.contrast}%)`); }
		if (f.saturate !== undefined && f.saturate !== 100) { parts.push(`saturate(${f.saturate}%)`); }
		if (f.grayscale) { parts.push(`grayscale(${f.grayscale}%)`); }
		if (f.sepia) { parts.push(`sepia(${f.sepia}%)`); }
		if (f.invert) { parts.push(`invert(${f.invert}%)`); }
		if (f.hueRotate) { parts.push(`hue-rotate(${f.hueRotate}deg)`); }
		return parts.join(' ');
	}

	/** Aplica todos os estilos do nó (caixa + texto + CSS personalizado) no elemento. */
	function apply(el, n) {
		const s = el.style;
		const isBox = n.type !== 'line';
		s.opacity = n.opacity ?? 1;
		const tr = [];
		if (n.rotation) { tr.push(`rotate(${n.rotation}deg)`); }
		if (n.skewX) { tr.push(`skewX(${n.skewX}deg)`); }
		if (n.skewY) { tr.push(`skewY(${n.skewY}deg)`); }
		if (n.flipX) { tr.push('scaleX(-1)'); }
		if (n.flipY) { tr.push('scaleY(-1)'); }
		s.transform = tr.join(' ');
		s.mixBlendMode = n.blend || '';
		s.filter = filterCss(n.filters);
		s.backdropFilter = n.backdropBlur ? `blur(${n.backdropBlur}px)` : '';
		if (isBox) {
			s.background = n.type === 'text' && (!n.fillType || n.fillType === 'solid') && (!n.fill || n.fill === 'transparent') ? '' : fillCss(n);
			// borda (estilo/cor comuns, espessura geral ou por lado)
			const bw = n.strokeWidth || 0, bs = n.borderStyle || 'solid', bc = n.stroke || '#111111';
			if (n.borderSides) {
				const [t, r, b, l] = n.borderSides;
				s.borderTop = `${t}px ${bs} ${bc}`; s.borderRight = `${r}px ${bs} ${bc}`; s.borderBottom = `${b}px ${bs} ${bc}`; s.borderLeft = `${l}px ${bs} ${bc}`;
			} else { s.border = bw ? `${bw}px ${bs} ${bc}` : 'none'; }
			// cantos
			if (n.type === 'ellipse') { s.borderRadius = '50%'; }
			else if (n.radii) { s.borderRadius = n.radii.map(r => `${r}px`).join(' '); }
			else { s.borderRadius = `${n.radius || 0}px`; }
			// sombras
			const sh = shadowsOf(n);
			s.boxShadow = sh.map(x => `${x.inset ? 'inset ' : ''}${x.x}px ${x.y}px ${x.blur}px ${x.spread || 0}px ${x.color}`).join(', ') + (n.type === 'frame' && !sh.length ? '0 1px 3px #0002' : '');
			// contorno (outline)
			s.outline = n.outline?.width ? `${n.outline.width}px ${n.outline.style || 'solid'} ${n.outline.color || '#0D99FF'}` : '';
			s.outlineOffset = n.outline?.offset ? `${n.outline.offset}px` : '';
			s.padding = n.padding ? n.padding.map(p => `${p}px`).join(' ') : '';
			s.boxSizing = 'border-box';
		}
		if (n.type === 'text') {
			s.color = n.color; s.fontSize = `${n.fontSize}px`; s.fontWeight = n.fontWeight;
			s.fontFamily = `'${n.fontFamily}', ${n.fontFallback || 'sans-serif'}`;
			s.fontStyle = n.italic ? 'italic' : 'normal';
			s.lineHeight = n.lineHeight || 1.25; s.letterSpacing = `${n.letterSpacing || 0}px`; s.wordSpacing = n.wordSpacing ? `${n.wordSpacing}px` : '';
			s.textAlign = n.align || 'left'; s.textTransform = n.transform || 'none'; s.textIndent = n.textIndent ? `${n.textIndent}px` : '';
			const deco = [n.underline && 'underline', n.lineThrough && 'line-through', n.overline && 'overline'].filter(Boolean);
			s.textDecorationLine = deco.join(' ') || 'none'; s.textDecorationStyle = n.decorationStyle || 'solid';
			s.textDecorationColor = n.decorationColor || ''; s.textDecorationThickness = n.decorationThickness ? `${n.decorationThickness}px` : '';
			s.textShadow = (n.textShadows || []).map(t => `${t.x}px ${t.y}px ${t.blur}px ${t.color}`).join(', ');
			s.display = 'flex'; s.flexDirection = 'column';
			s.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[n.vAlign || 'top'];
			s.whiteSpace = n.noWrap ? 'nowrap' : 'pre-wrap';
			s.overflow = n.overflow || 'visible';
			s.textOverflow = n.ellipsis ? 'ellipsis' : '';
			ensureFont(n.fontFamily);
		}
		if (n.type === 'image') { s.overflow = 'hidden'; }
		if (n.type === 'frame') { s.overflow = n.clip === false ? 'visible' : 'hidden'; }
		// CSS personalizado (qualquer propriedade CSS)
		if (n.css) {
			for (const decl of String(n.css).split(';')) {
				const i = decl.indexOf(':');
				if (i > 0) { try { s.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim().replace(/\s*!important$/, '')); } catch { /* ignora */ } }
			}
		}
	}

	// ================================================================== fontes do Google
	let FONT_LIST = [];
	const fontInfo = new Map();
	const loadedFonts = new Set();
	const previewFonts = new Set();
	fetch(window.__DEVCODE_FONTS_URL).then(r => r.json()).then(list => {
		FONT_LIST = list.map(([family, cat, weights, italic, axis]) => ({ family, cat, weights, italic, axis }));
		FONT_LIST.forEach(f => fontInfo.set(f.family, f));
	}).catch(() => { /* sem lista: só fontes do sistema */ });

	function cssUrl(family, opts = {}) {
		const f = fontInfo.get(family);
		const fam = encodeURIComponent(family).replace(/%20/g, '+');
		if (opts.text) { return `https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(opts.text)}&display=swap`; }
		if (!f) { return `https://fonts.googleapis.com/css2?family=${fam}&display=swap`; }
		const w = f.axis ? [`${f.axis[0]}..${f.axis[1]}`] : (f.weights.length ? f.weights : [400]);
		const spec = f.italic ? `ital,wght@${w.map(x => `0,${x}`).join(';')};${w.map(x => `1,${x}`).join(';')}` : `wght@${w.join(';')}`;
		return `https://fonts.googleapis.com/css2?family=${fam}:${spec}&display=swap`;
	}
	function addCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); }
	function ensureFont(family) {
		if (!family || SYSTEM_FONTS.has(family) || loadedFonts.has(family)) { return; }
		loadedFonts.add(family); addCss(cssUrl(family));
	}
	function previewFont(family) {
		if (SYSTEM_FONTS.has(family) || loadedFonts.has(family) || previewFonts.has(family)) { return; }
		previewFonts.add(family); addCss(cssUrl(family, { text: family }));
	}
	const CAT = { Sa: 'Sem serifa', Se: 'Serifa', Di: 'Decorativa', Ha: 'Manuscrita', Mo: 'Monoespaçada' };

	// ================================================================== campos do painel
	function make(tag, attrs = {}, ...kids) {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) {
			if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); }
			else if (k.startsWith('on')) { el.addEventListener(k.slice(2).toLowerCase(), v); }
			else if (k === 'class') { el.className = v; }
			else if (v !== undefined && v !== null && v !== false) { el.setAttribute(k, v === true ? '' : v); }
		}
		for (const c of kids.flat()) { if (c !== null && c !== undefined && c !== false) { el.append(c.nodeType ? c : document.createTextNode(String(c))); } }
		return el;
	}
	const stop = e => e.stopPropagation();

	function Fields(set) {
		const F = {};
		F.section = (title, ...rows) => make('div', { class: 'section' }, make('h3', {}, title), ...rows);
		F.row = (...items) => make('div', { class: `row ${items.length === 1 ? 'one' : items.length === 3 ? 'three' : items.length === 4 ? 'four' : ''}` }, ...items);
		F.num = (label, obj, key, o = {}) => {
			const inp = make('input', { type: 'number', value: obj[key] ?? o.def ?? 0, step: o.step || 1, min: o.min, max: o.max, onkeydown: stop });
			inp.addEventListener('input', () => { let v = parseFloat(inp.value); if (isNaN(v)) { return; } if (o.min !== undefined) { v = Math.max(o.min, v); } if (o.max !== undefined) { v = Math.min(o.max, v); } set(obj, key, v); });
			return make('div', { class: 'field', title: o.title || '' }, make('label', {}, label), inp, o.unit ? make('span', { class: 'unit' }, o.unit) : null);
		};
		F.range = (label, obj, key, o) => {
			const val = obj[key] ?? o.def;
			const out = make('span', { class: 'unit' }, `${val}${o.unit || ''}`);
			const inp = make('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, value: val, onkeydown: stop });
			inp.addEventListener('input', () => { out.textContent = `${inp.value}${o.unit || ''}`; set(obj, key, +inp.value); });
			return make('div', { class: 'field', title: o.title || '' }, make('label', {}, label), inp, out);
		};
		F.color = (label, obj, key, o = {}) => {
			const c = parseColor(obj[key] ?? o.def);
			const pick = make('input', { type: 'color', value: c.hex });
			const alpha = make('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(c.a * 100), title: 'Opacidade da cor (%)', class: 'alpha', onkeydown: stop });
			const commitColor = () => set(obj, key, toColor(pick.value, Math.min(100, Math.max(0, +alpha.value || 0)) / 100));
			pick.addEventListener('input', () => { if (+alpha.value === 0) { alpha.value = 100; } commitColor(); });
			alpha.addEventListener('input', commitColor);
			return make('div', { class: 'field' }, make('label', {}, label), pick, make('span', { class: 'hex' }, c.hex.toUpperCase()), alpha, make('span', { class: 'unit' }, '%'));
		};
		F.select = (label, obj, key, options, o = {}) => {
			const sel = make('select', { onkeydown: stop }, ...options.map(([v, t]) => make('option', { value: v, selected: String(obj[key] ?? o.def) === String(v) }, t)));
			sel.addEventListener('change', () => set(obj, key, isNaN(+sel.value) || sel.value === '' ? sel.value : +sel.value));
			return make('div', { class: 'field' }, make('label', {}, label), sel);
		};
		F.check = (label, obj, key) => {
			const c = make('input', { type: 'checkbox', checked: !!obj[key] });
			c.addEventListener('change', () => set(obj, key, c.checked));
			return make('label', { class: 'check' }, c, label);
		};
		F.toggle = (text, obj, key, title) => make('button', { class: `btn ${obj[key] ? 'on' : ''}`, title: title || '', onclick: () => set(obj, key, !obj[key]) }, text);
		F.btn = (text, onclick, cls = '') => make('button', { class: `btn ${cls}`, onclick }, text);
		return F;
	}

	// ================================================================== seletor de fontes
	function fontPicker(n, set) {
		const btn = make('button', { class: 'btn font-btn', style: { fontFamily: `'${n.fontFamily}', sans-serif` } }, n.fontFamily, make('span', { class: 'caret' }, '▾'));
		ensureFont(n.fontFamily);
		btn.addEventListener('click', () => {
			const pop = make('div', { class: 'font-pop' });
			const search = make('input', { placeholder: `Buscar entre ${FONT_LIST.length + SYSTEM_FONTS.size - 3} fontes…`, onkeydown: e => { stop(e); if (e.key === 'Escape') { pop.remove(); } } });
			const cats = make('select', { onkeydown: stop }, make('option', { value: '' }, 'Todas'), ...Object.entries(CAT).map(([k, v]) => make('option', { value: k }, v)), make('option', { value: 'sys' }, 'Do sistema'));
			const list = make('div', { class: 'font-list' });
			const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { previewFont(en.target.dataset.f); io.unobserve(en.target); } }), { root: list });
			const draw = () => {
				const q = search.value.trim().toLowerCase();
				const all = [...[...SYSTEM_FONTS].filter(f => !/serif|monospace/.test(f) || f.includes(' ')).map(f => ({ family: f, cat: 'sys' })), ...FONT_LIST];
				const items = all.filter(f => (!q || f.family.toLowerCase().includes(q)) && (!cats.value || f.cat === cats.value)).slice(0, 150);
				list.innerHTML = '';
				for (const f of items) {
					const it = make('div', { class: `font-item ${f.family === n.fontFamily ? 'on' : ''}`, 'data-f': f.family, style: { fontFamily: `'${f.family}', sans-serif` }, onclick: () => { ensureFont(f.family); set(n, 'fontFamily', f.family); pop.remove(); } },
						f.family, make('span', { class: 'font-cat' }, f.cat === 'sys' ? 'sistema' : CAT[f.cat] || ''));
					list.append(it); io.observe(it);
				}
				if (!items.length) { list.append(make('div', { class: 'empty' }, 'Nenhuma fonte encontrada.')); }
			};
			search.addEventListener('input', draw); cats.addEventListener('change', draw);
			pop.append(make('div', { class: 'font-head' }, search, cats), list);
			document.body.append(pop);
			const r = btn.getBoundingClientRect();
			Object.assign(pop.style, { top: `${Math.min(r.bottom + 4, window.innerHeight - 420)}px`, right: '12px' });
			draw(); search.focus();
			setTimeout(() => document.addEventListener('pointerdown', function close(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', close); } }), 0);
		});
		return make('div', { class: 'field' }, make('label', {}, 'Fonte'), btn);
	}

	// ================================================================== painel de estilos
	const BORDER_STYLES = [['solid', 'Sólida'], ['dashed', 'Tracejada'], ['dotted', 'Pontilhada'], ['double', 'Dupla'], ['groove', 'Entalhe'], ['ridge', 'Relevo'], ['inset', 'Interna'], ['outset', 'Externa']];
	const BLENDS = [['', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Tela'], ['overlay', 'Sobrepor'], ['darken', 'Escurecer'], ['lighten', 'Clarear'], ['color-dodge', 'Subexposição'], ['color-burn', 'Superexposição'], ['hard-light', 'Luz forte'], ['soft-light', 'Luz suave'], ['difference', 'Diferença'], ['exclusion', 'Exclusão'], ['hue', 'Matiz'], ['saturation', 'Saturação'], ['color', 'Cor'], ['luminosity', 'Luminosidade']];

	/**
	 * Monta as seções de estilo para o nó.
	 * @param set  (obj, key, value) => void   grava + redesenha
	 * @param refresh () => void               reconstrói o painel (ex.: ao adicionar uma sombra)
	 */
	function panel(n, set, refresh) {
		const F = Fields(set);
		const out = [];
		const setR = (o, k, v) => { set(o, k, v); refresh(); };
		const FR = Fields(setR);

		// ---- Aparência (todos, inclusive frames e imagens)
		out.push(F.section('Aparência',
			F.row(F.range('Opacidade', n, 'opacity', { min: 0, max: 1, step: 0.01, def: 1, title: 'Opacidade do elemento inteiro' })),
			F.row(F.select('Mesclagem', n, 'blend', BLENDS, { def: '' })),
			n.type !== 'frame' ? F.row(F.num('↻', n, 'rotation', { title: 'Rotação', unit: '°' }), F.num('Inc. X', n, 'skewX', { title: 'Inclinação horizontal', unit: '°' }), F.num('Inc. Y', n, 'skewY', { title: 'Inclinação vertical', unit: '°' })) : null,
			n.type !== 'frame' ? make('div', { class: 'btnrow' }, F.toggle('⇋ Espelhar H', n, 'flipX'), F.toggle('⇵ Espelhar V', n, 'flipY')) : null,
		));
		if (n.type === 'line') {
			out.push(F.section('Linha', F.row(F.color('Cor', n, 'stroke', { def: '#111111' })), F.row(F.num('Esp.', n, 'strokeWidth', { min: 1, unit: 'px' }))));
		} else {
			// ---- Preenchimento (cor sólida, degradê linear/radial ou nenhum)
			const fillType = n.fillType || 'solid';
			const fillRows = [FR.row(FR.select('Tipo', n, 'fillType', [['solid', 'Cor sólida'], ['linear', 'Degradê linear'], ['radial', 'Degradê radial'], ['none', 'Nenhum']], { def: 'solid' }))];
			if (fillType === 'solid') { fillRows.push(F.row(F.color('Cor', n, 'fill', { def: '#D9D9D9' }))); }
			if (fillType === 'linear' || fillType === 'radial') {
				n.gradient = n.gradient || { angle: 180, shape: 'circle', stops: [{ color: '#D10A0A', pos: 0 }, { color: '#111111', pos: 100 }] };
				if (fillType === 'linear') { fillRows.push(F.row(F.num('Ângulo', n.gradient, 'angle', { unit: '°' }))); }
				else { fillRows.push(F.row(F.select('Forma', n.gradient, 'shape', [['circle', 'Círculo'], ['ellipse', 'Elipse']]))); }
				n.gradient.stops.forEach((s, i) => fillRows.push(make('div', { class: 'row stop' }, F.color(`${i + 1}`, s, 'color'), F.num('', s, 'pos', { min: 0, max: 100, unit: '%' }),
					n.gradient.stops.length > 2 ? make('button', { class: 'btn mini', title: 'Remover cor', onclick: () => { n.gradient.stops.splice(i, 1); setR(n, 'gradient', n.gradient); } }, '✕') : null)));
				fillRows.push(make('div', { class: 'btnrow' }, F.btn('+ Cor no degradê', () => { n.gradient.stops.push({ color: '#FFFFFF', pos: 50 }); n.gradient.stops.sort((a, b) => a.pos - b.pos); setR(n, 'gradient', n.gradient); })));
			}
			out.push(F.section(n.type === 'text' ? 'Fundo do texto' : 'Preenchimento', ...fillRows));

			// ---- Borda
			const perSide = !!n.borderSides;
			out.push(F.section('Borda',
				F.row(F.color('Cor', n, 'stroke', { def: '#111111' })),
				F.row(F.select('Estilo', n, 'borderStyle', BORDER_STYLES, { def: 'solid' })),
				perSide
					? F.row(F.num('⬆', n.borderSides, 0, { min: 0, title: 'Topo' }), F.num('➡', n.borderSides, 1, { min: 0, title: 'Direita' }), F.num('⬇', n.borderSides, 2, { min: 0, title: 'Base' }), F.num('⬅', n.borderSides, 3, { min: 0, title: 'Esquerda' }))
					: F.row(F.num('Esp.', n, 'strokeWidth', { min: 0, unit: 'px', title: 'Espessura' })),
				make('div', { class: 'btnrow' }, F.btn(perSide ? 'Mesma espessura em todos os lados' : 'Espessura por lado', () => setR(n, 'borderSides', perSide ? undefined : [n.strokeWidth || 1, n.strokeWidth || 1, n.strokeWidth || 1, n.strokeWidth || 1]))),
			));

			// ---- Cantos
			if (n.type !== 'ellipse') {
				const perCorner = !!n.radii;
				out.push(F.section('Cantos arredondados',
					perCorner
						? F.row(F.num('↖', n.radii, 0, { min: 0, title: 'Superior esquerdo' }), F.num('↗', n.radii, 1, { min: 0, title: 'Superior direito' }), F.num('↘', n.radii, 2, { min: 0, title: 'Inferior direito' }), F.num('↙', n.radii, 3, { min: 0, title: 'Inferior esquerdo' }))
						: F.row(F.num('Raio', n, 'radius', { min: 0, unit: 'px' })),
					make('div', { class: 'btnrow' }, F.btn(perCorner ? 'Mesmo raio nos 4 cantos' : 'Raio por canto', () => setR(n, 'radii', perCorner ? undefined : [n.radius || 0, n.radius || 0, n.radius || 0, n.radius || 0]))),
				));
			}

			// ---- Espaçamento interno (padding)
			if (n.type === 'text' || n.type === 'rect' || n.type === 'frame') {
				n.padding = n.padding || [0, 0, 0, 0];
				out.push(F.section('Espaçamento interno (padding)', F.row(F.num('⬆', n.padding, 0, { min: 0 }), F.num('➡', n.padding, 1, { min: 0 }), F.num('⬇', n.padding, 2, { min: 0 }), F.num('⬅', n.padding, 3, { min: 0 }))));
			}

			// ---- Sombras (várias, externas ou internas)
			if (n.shadow?.on && !n.shadows) { n.shadows = [{ x: n.shadow.x, y: n.shadow.y, blur: n.shadow.blur, spread: 0, color: n.shadow.color, inset: false }]; delete n.shadow; }
			n.shadows = n.shadows || [];
			out.push(F.section('Sombras',
				...n.shadows.map((s, i) => make('div', { class: 'shadow-box' },
					F.row(F.num('X', s, 'x'), F.num('Y', s, 'y'), F.num('Desf.', s, 'blur', { min: 0 }), F.num('Exp.', s, 'spread')),
					F.row(F.color('Cor', s, 'color')),
					make('div', { class: 'btnrow' }, F.toggle('Sombra interna', s, 'inset'), make('button', { class: 'btn', onclick: () => { n.shadows.splice(i, 1); setR(n, 'shadows', n.shadows); } }, '✕ Remover')))),
				make('div', { class: 'btnrow' }, F.btn('+ Adicionar sombra', () => { n.shadows.push({ x: 0, y: 4, blur: 12, spread: 0, color: '#00000040', inset: false }); setR(n, 'shadows', n.shadows); })),
			));

			// ---- Contorno (outline)
			n.outline = n.outline || { width: 0, style: 'solid', color: '#0D99FF', offset: 0 };
			out.push(F.section('Contorno (outline)',
				F.row(F.num('Esp.', n.outline, 'width', { min: 0, unit: 'px' }), F.num('Distância', n.outline, 'offset', { unit: 'px' })),
				F.row(F.select('Estilo', n.outline, 'style', BORDER_STYLES)), F.row(F.color('Cor', n.outline, 'color')),
			));
		}

		// ---- Texto
		if (n.type === 'text') {
			n.textShadows = n.textShadows || [];
			out.push(F.section('Tipografia',
				F.row(fontPicker(n, set)),
				F.row(F.num('Tam.', n, 'fontSize', { min: 1, unit: 'px' }), F.select('Peso', n, 'fontWeight', [[100, 'Thin 100'], [200, 'Extra Light 200'], [300, 'Light 300'], [400, 'Regular 400'], [500, 'Medium 500'], [600, 'Semibold 600'], [700, 'Bold 700'], [800, 'Extra Bold 800'], [900, 'Black 900']])),
				F.row(F.color('Cor', n, 'color', { def: '#111111' })),
				F.row(F.num('Altura linha', n, 'lineHeight', { step: 0.05, min: 0.5 }), F.num('Letras', n, 'letterSpacing', { step: 0.1, unit: 'px', title: 'Espaçamento entre letras' })),
				F.row(F.num('Palavras', n, 'wordSpacing', { unit: 'px', title: 'Espaçamento entre palavras' }), F.num('Recuo', n, 'textIndent', { unit: 'px', title: 'Recuo da primeira linha' })),
				make('div', { class: 'label-row' }, 'Alinhamento'),
				make('div', { class: 'btnrow' },
					...[['left', '⇤ Esq.'], ['center', '↔ Centro'], ['right', '⇥ Dir.'], ['justify', '☰ Justif.']].map(([a, t]) => make('button', { class: `btn ${(n.align || 'left') === a ? 'on' : ''}`, onclick: () => setR(n, 'align', a) }, t))),
				make('div', { class: 'btnrow' },
					...[['top', '⤒ Topo'], ['middle', '↕ Meio'], ['bottom', '⤓ Base']].map(([a, t]) => make('button', { class: `btn ${(n.vAlign || 'top') === a ? 'on' : ''}`, onclick: () => setR(n, 'vAlign', a) }, t))),
				make('div', { class: 'label-row' }, 'Estilo'),
				make('div', { class: 'btnrow' },
					make('button', { class: `btn ${n.italic ? 'on' : ''}`, style: { fontStyle: 'italic' }, onclick: () => setR(n, 'italic', !n.italic) }, 'Itálico'),
					make('button', { class: `btn ${n.underline ? 'on' : ''}`, style: { textDecoration: 'underline' }, onclick: () => setR(n, 'underline', !n.underline) }, 'Sublinhado'),
					make('button', { class: `btn ${n.lineThrough ? 'on' : ''}`, style: { textDecoration: 'line-through' }, onclick: () => setR(n, 'lineThrough', !n.lineThrough) }, 'Tachado'),
					make('button', { class: `btn ${n.overline ? 'on' : ''}`, style: { textDecoration: 'overline' }, onclick: () => setR(n, 'overline', !n.overline) }, 'Sobrelinha')),
				(n.underline || n.lineThrough || n.overline) ? F.row(F.select('Linha', n, 'decorationStyle', [['solid', 'Sólida'], ['dashed', 'Tracejada'], ['dotted', 'Pontilhada'], ['double', 'Dupla'], ['wavy', 'Ondulada']], { def: 'solid' }), F.num('Esp.', n, 'decorationThickness', { min: 0, unit: 'px' })) : null,
				(n.underline || n.lineThrough || n.overline) ? F.row(F.color('Cor linha', n, 'decorationColor', { def: n.color })) : null,
				F.row(F.select('Caixa', n, 'transform', [['none', 'Normal'], ['uppercase', 'MAIÚSCULAS'], ['lowercase', 'minúsculas'], ['capitalize', 'Primeira Maiúscula']], { def: 'none' })),
				make('div', { class: 'btnrow' }, F.toggle('Não quebrar linha', n, 'noWrap'), F.toggle('Reticências (…)', n, 'ellipsis', 'Corta o texto que não cabe com "…"')),
			));
			out.push(F.section('Sombra do texto',
				...n.textShadows.map((s, i) => make('div', { class: 'shadow-box' },
					F.row(F.num('X', s, 'x'), F.num('Y', s, 'y'), F.num('Desf.', s, 'blur', { min: 0 })),
					F.row(F.color('Cor', s, 'color')),
					make('div', { class: 'btnrow' }, make('button', { class: 'btn', onclick: () => { n.textShadows.splice(i, 1); setR(n, 'textShadows', n.textShadows); } }, '✕ Remover')))),
				make('div', { class: 'btnrow' }, F.btn('+ Adicionar sombra no texto', () => { n.textShadows.push({ x: 0, y: 2, blur: 4, color: '#00000059' }); setR(n, 'textShadows', n.textShadows); })),
			));
		}

		// ---- Filtros (todos)
		n.filters = n.filters || {};
		out.push(F.section('Filtros',
			F.row(F.range('Desfoque', n.filters, 'blur', { min: 0, max: 40, def: 0, unit: 'px' })),
			F.row(F.range('Brilho', n.filters, 'brightness', { min: 0, max: 200, def: 100, unit: '%' })),
			F.row(F.range('Contraste', n.filters, 'contrast', { min: 0, max: 200, def: 100, unit: '%' })),
			F.row(F.range('Saturação', n.filters, 'saturate', { min: 0, max: 300, def: 100, unit: '%' })),
			F.row(F.range('Preto e branco', n.filters, 'grayscale', { min: 0, max: 100, def: 0, unit: '%' })),
			F.row(F.range('Sépia', n.filters, 'sepia', { min: 0, max: 100, def: 0, unit: '%' })),
			F.row(F.range('Inverter', n.filters, 'invert', { min: 0, max: 100, def: 0, unit: '%' })),
			F.row(F.range('Matiz', n.filters, 'hueRotate', { min: 0, max: 360, def: 0, unit: '°' })),
			n.type !== 'line' ? F.row(F.range('Desfoque do fundo', n, 'backdropBlur', { min: 0, max: 40, def: 0, unit: 'px', title: 'Efeito "vidro fosco": desfoca o que está atrás' })) : null,
		));

		// ---- CSS personalizado: qualquer propriedade CSS
		const ta = make('textarea', { placeholder: 'Qualquer CSS, uma propriedade por linha. Ex.:\ncursor: pointer;\nborder-image: linear-gradient(red, blue) 1;\nclip-path: polygon(50% 0, 100% 100%, 0 100%);', spellcheck: 'false', onkeydown: stop }, n.css || '');
		ta.addEventListener('input', () => set(n, 'css', ta.value));
		out.push(F.section('CSS personalizado', make('div', { class: 'row one' }, make('div', { class: 'field tall' }, ta)),
			make('div', { class: 'empty' }, 'Use para qualquer propriedade CSS que não esteja nos campos acima.')));
		return out;
	}

	// ================================================================== exportação fiel (HTML/CSS → PNG)
	async function toDataUrl(url) {
		const blob = await (await fetch(url)).blob();
		return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
	}
	async function embedFonts(families) {
		let css = '';
		for (const f of families) {
			if (SYSTEM_FONTS.has(f)) { continue; }
			try {
				let text = await (await fetch(cssUrl(f))).text();
				const urls = [...new Set([...text.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
				for (const u of urls) { text = text.split(u).join(await toDataUrl(u)); }
				css += text;
			} catch { /* sem internet: usa a fonte de reserva */ }
		}
		return css;
	}
	/**
	 * @param frameEl elemento do frame já renderizado (clone sem transformações de visualização)
	 */
	async function exportElement(frameEl, w, h, families, scale = 2) {
		const node = frameEl.cloneNode(true);
		node.style.left = '0px'; node.style.top = '0px'; node.style.position = 'relative';
		// imagens viram data URL (o SVG não pode carregar recursos externos)
		for (const img of node.querySelectorAll('img')) { try { img.src = await toDataUrl(img.src); } catch { /* ignora */ } }
		const fontCss = await embedFonts(families);
		const html = new XMLSerializer().serializeToString(node);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;position:relative;margin:0"><style>${fontCss.replace(/</g, '\\3c ')}</style>${html.replace(/^<div xmlns="http:\/\/www.w3.org\/1999\/xhtml"/, '<div')}</div></foreignObject></svg>`;
		const img = new Image();
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		await img.decode();
		const canvas = document.createElement('canvas');
		canvas.width = w * scale; canvas.height = h * scale;
		const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
		return canvas.toDataURL('image/png');
	}

	return { apply, panel, ensureFont, exportElement, parseColor, toColor };
})();
