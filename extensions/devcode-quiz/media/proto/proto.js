// DEV CODE - Modo Protótipo: editor visual estilo Figma (simplificado, sem IA).
(function () {
	'use strict';
	const vscode = acquireVsCodeApi();
	const PRESETS = { mobile: { w: 390, h: 844, label: 'Mobile' }, desktop: { w: 1440, h: 900, label: 'Desktop' } };
	const ICONS = { frame: '#', group: '▣', rect: '▭', ellipse: '◯', line: '╱', text: 'T', image: '🖼' };
	const TYPE_NAMES = { frame: 'Frame', group: 'Grupo', rect: 'Retângulo', ellipse: 'Elipse', line: 'Linha', text: 'Texto', image: 'Imagem' };
	const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
	const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

	let model = null;
	let selection = new Set();
	let tool = 'select';
	let view = { zoom: 0.6, x: 80, y: 60 };
	let images = {};
	let editingTextId = null;
	let renamingId = null;
	let cropMode = null;
	let gridsVisible = vscode.getState?.()?.gridsVisible !== false;
	let fitted = false;
	let spaceDown = false;
	let commitTimer = null;
	/** camadas abertas/fechadas no painel (frames abertos e grupos fechados por padrão) */
	const layerOpen = new Map();
	let lastSelKey = '';
	/** arrasto de camadas no painel: { ids } */
	let layerDrag = null;

	// ------------------------------------------------------------------ util
	const $ = (sel, root = document) => root.querySelector(sel);
	const h = (tag, attrs = {}, ...children) => {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) {
			if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); }
			else if (k.startsWith('on')) { el.addEventListener(k.slice(2).toLowerCase(), v); }
			else if (k === 'class') { el.className = v; }
			else if (v !== undefined && v !== null && v !== false) { el.setAttribute(k, v === true ? '' : v); }
		}
		for (const c of children.flat()) { if (c !== null && c !== undefined && c !== false) { el.append(c.nodeType ? c : document.createTextNode(String(c))); } }
		return el;
	};
	const uid = () => Math.random().toString(36).slice(2, 9);
	const round = v => Math.round(v);
	const clone = o => JSON.parse(JSON.stringify(o));
	const emptyVariables = () => ({ colors: [], numbers: [] });
	function variableList(kind) { return model?.variables?.[kind === 'color' ? 'colors' : 'numbers'] || []; }
	function resolveColor(value, fallback = '#000000') {
		if (value && typeof value === 'object' && value.var) { return variableList('color').find(v => v.id === value.var)?.value ?? fallback; }
		return value ?? fallback;
	}
	function resolveNum(value, fallback = 0) {
		if (value && typeof value === 'object' && value.var) { value = variableList('number').find(v => v.id === value.var)?.value; }
		const n = Number(value);
		return Number.isFinite(n) ? n : fallback;
	}
	function legacyFills(n) {
		if (n.type === 'image') {
			const fills = [{ id: `legacy-image-${n.id}`, type: 'image', opacity: 1, visible: true, blend: '', image: { src: n.src, mode: n.fit === 'fill' ? 'stretch' : (n.fit || 'cover'), position: n.imagePosition || 'center', transform: n.imageTransform || null, adjustments: n.imageAdjustments || {} } }];
			const backgroundType = n.fillType || 'solid';
			if (backgroundType !== 'none' && !(backgroundType === 'solid' && (n.fill ?? 'transparent') === 'transparent')) { fills.push({ id: `legacy-fill-${n.id}`, type: backgroundType, color: n.fill ?? 'transparent', opacity: 1, visible: true, blend: '', gradient: n.gradient ? clone(n.gradient) : undefined }); }
			return fills;
		}
		const type = n.fillType || 'solid';
		if (type === 'none') { return []; }
		return [{ id: `legacy-fill-${n.id}`, type, color: n.fill ?? (n.type === 'frame' ? '#FFFFFF' : 'transparent'), opacity: 1, visible: true, blend: '', gradient: n.gradient ? clone(n.gradient) : undefined }];
	}
	function getFills(n) { return Array.isArray(n.fills) ? n.fills : legacyFills(n); }
	function ensureFills(n) { if (!Array.isArray(n.fills)) { n.fills = legacyFills(n); } return n.fills; }
	function fillAt(n, key, index) { const fills = ensureFills(n); return fills.find(f => f.id === key) || fills[index]; }
	function gradientCss(fill) {
		const g = fill.gradient || {};
		const stops = (g.stops || [{ color: '#D10A0A', pos: 0 }, { color: '#111111', pos: 100 }]).map(s => {
			const raw = resolveColor(s.color), c = DevStyle.parseColor(raw), opacity = resolveNum(s.opacity ?? 1, 1);
			const color = c.raw ? (opacity >= 1 ? raw : `color-mix(in srgb, ${raw} ${opacity * 100}%, transparent)`) : DevStyle.toColor(c.hex, c.a * opacity);
			return `${color} ${resolveNum(s.pos, 0)}%`;
		}).join(', ');
		if (fill.type === 'radial') { return `radial-gradient(${g.shape || 'circle'} at center, ${stops})`; }
		if (fill.type === 'conic') { return `conic-gradient(from ${resolveNum(g.angle, 0)}deg, ${stops})`; }
		return `linear-gradient(${resolveNum(g.angle, 180)}deg, ${stops})`;
	}
	// ---- SVG: trocar as cores (o arquivo continua igual; a troca fica no protótipo)
	const svgTexts = {};
	const svgLoading = new Set();
	const isSvg = src => /\.svg$/i.test(src || '');
	function loadSvg(src) {
		if (!isSvg(src) || svgTexts[src] !== undefined || svgLoading.has(src) || !images[src]) { return; }
		svgLoading.add(src);
		fetch(images[src]).then(r => r.text()).then(text => { svgTexts[src] = text; }).catch(() => { svgTexts[src] = ''; }).finally(() => { svgLoading.delete(src); render(); });
	}
	const NAMED = { black: '#000000', white: '#FFFFFF', red: '#FF0000', blue: '#0000FF', green: '#008000', gray: '#808080', grey: '#808080', yellow: '#FFFF00', orange: '#FFA500' };
	function normHex(c) {
		c = String(c).trim().toLowerCase();
		if (NAMED[c]) { return NAMED[c]; }
		const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
		if (!m) { return null; }
		const h6 = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
		return '#' + h6.toUpperCase();
	}
	const COLOR_RE = /(fill|stroke|stop-color|color)\s*(=\s*["']|:\s*)(#[0-9a-fA-F]{3,6}\b|[a-zA-Z]+)/g;
	/** Cores usadas no SVG; '__padrao' = preenchimento padrão (preto) dos desenhos sem cor. */
	function svgColors(src) {
		const text = svgTexts[src];
		if (!text) { return []; }
		const found = new Set();
		for (const m of text.matchAll(COLOR_RE)) { const hex = normHex(m[3]); if (hex) { found.add(hex); } }
		const rootFill = /<svg[^>]*\sfill\s*=/.test(text);
		if (!rootFill) { found.add('__padrao'); }
		return [...found];
	}
	function recolorSvg(text, map) {
		let out = text.replace(COLOR_RE, (all, prop, sep, value) => {
			const hex = normHex(value);
			const to = hex && map[hex] ? resolveColor(map[hex], hex) : null;
			return to ? `${prop}${sep}${to}` : all;
		});
		if (map.__padrao) { out = out.replace(/<svg\b/, `<svg fill="${resolveColor(map.__padrao, '#000000')}"`); }
		return out;
	}
	const recolorCache = new Map();
	/** URI da imagem para desenhar: SVG com cores trocadas vira data: URL. */
	function imageUri(src, image) {
		const uri = images[src];
		if (!uri || !isSvg(src)) { return uri; }
		loadSvg(src);
		const map = image?.svgColors;
		if (!map || !Object.keys(map).length || !svgTexts[src]) { return uri; }
		const key = src + JSON.stringify(map) + JSON.stringify(model.variables || {});
		if (!recolorCache.has(key)) {
			if (recolorCache.size > 200) { recolorCache.clear(); }
			recolorCache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(recolorSvg(svgTexts[src], map)));
		}
		return recolorCache.get(key);
	}
	function fillImageTransform(n, fill) { return fill.image?.transform || (n.type === 'image' ? n.imageTransform : null); }
	function appendFillLayers(el, n) {
		const fills = getFills(n);
		for (let i = fills.length - 1; i >= 0; i--) {
			const fill = fills[i];
			if (fill.visible === false || fill.type === 'none') { continue; }
			const layer = h('div', { class: 'fill-layer', 'data-fill-id': fill.id || `fill-${i}` });
			Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', borderRadius: 'inherit', pointerEvents: 'none', opacity: String(resolveNum(fill.opacity ?? 1, 1)), mixBlendMode: fill.blend || 'normal' });
			if (fill.type === 'image') {
				const image = fill.image || {};
				const src = image.src || (n.type === 'image' ? n.src : '');
				const uri = imageUri(src, image);
				if (!uri) { layer.style.backgroundColor = '#ddd'; }
				else if (image.mode === 'tile') {
					const scale = Math.max(1, resolveNum(image.scale, 100));
					layer.style.backgroundImage = `url("${uri}")`;
					layer.style.backgroundRepeat = 'repeat';
					layer.style.backgroundSize = `${scale}% auto`;
					layer.style.filter = DevStyle.imageFilterCss(image.adjustments || {});
				} else if (uri) {
					const img = h('img', { src: uri, draggable: 'false', alt: '' });
					img.style.position = 'absolute'; img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.pointerEvents = 'none';
					img.style.filter = DevStyle.imageFilterCss(image.adjustments || {});
					const transform = fillImageTransform(n, fill);
					if (image.mode === 'crop' && transform) {
						Object.assign(img.style, { left: `${resolveNum(transform.x)}px`, top: `${resolveNum(transform.y)}px`, width: `${Math.max(1, resolveNum(transform.w, n.w))}px`, height: `${Math.max(1, resolveNum(transform.h, n.h))}px`, objectFit: 'fill' });
					} else {
					Object.assign(img.style, { left: '0', top: '0', width: '100%', height: '100%', objectFit: image.mode === 'contain' ? 'contain' : image.mode === 'stretch' ? 'fill' : ['none', 'scale-down'].includes(image.mode) ? image.mode : 'cover', objectPosition: image.position || 'center' });
					}
					if (image.rotation) { img.style.transform = `rotate(${resolveNum(image.rotation)}deg)`; img.style.transformOrigin = 'center'; }
					layer.append(img);
				}
			} else if (fill.type === 'linear' || fill.type === 'radial' || fill.type === 'conic') { layer.style.background = gradientCss(fill); }
			else { layer.style.backgroundColor = resolveColor(fill.color, 'transparent'); }
			el.append(layer);
		}
	}

	function walk(fn, nodes = model.nodes, parent = null) {
		for (const n of nodes) {
			if (fn(n, parent, nodes) === false) { return false; }
			if (n.children && walk(fn, n.children, n) === false) { return false; }
		}
	}
	function find(id) { let r = null; walk((n, p, arr) => { if (n.id === id) { r = { node: n, parent: p, list: arr }; return false; } }); return r; }
	function selected() { return [...selection].map(id => find(id)?.node).filter(Boolean); }
	function bbox(n) {
		if (n.type === 'line') { return { x: Math.min(n.x, n.x + n.w), y: Math.min(n.y, n.y + n.h), w: Math.abs(n.w) || 1, h: Math.abs(n.h) || 1 }; }
		return { x: n.x, y: n.y, w: n.w, h: n.h };
	}
	function unionBox(nodes) {
		const bs = nodes.map(bbox);
		const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
		return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y };
	}
	function nextName(type) {
		let count = 0;
		walk(n => { if (n.type === type) { count++; } });
		return `${TYPE_NAMES[type]} ${count + 1}`;
	}
	/** Caminho da raiz até o nó (inclusive): [frame?, grupo?, …, nó]. */
	function pathTo(id) {
		const out = [];
		const rec = nodes => {
			for (const n of nodes) {
				out.push(n);
				if (n.id === id || (n.children && rec(n.children))) { return true; }
				out.pop();
			}
			return false;
		};
		return rec(model.nodes) ? out : [];
	}
	const isContainer = n => n.type === 'frame' || n.type === 'group';
	/** Selecionados sem os que já vêm junto com um pai selecionado. */
	function topLevelSelected() {
		return selected().filter(n => !pathTo(n.id).slice(0, -1).some(a => selection.has(a.id)));
	}
	function docOrder(nodes) {
		const order = new Map(); let i = 0;
		walk(n => { order.set(n.id, i++); });
		return [...nodes].sort((a, b) => order.get(a.id) - order.get(b.id));
	}
	/** Grupos "abertos": os que contêm algo selecionado (clicar dentro deles seleciona o filho). */
	function enteredGroups() {
		const s = new Set();
		for (const id of selection) { for (const a of pathTo(id).slice(0, -1)) { s.add(a.id); } }
		return s;
	}
	/** Clique no canvas: o alvo é o grupo mais externo ainda não "aberto"; senão, a própria camada. */
	function pickTarget(id) {
		const entered = enteredGroups();
		for (const n of pathTo(id)) { if (n.type === 'group' && !entered.has(n.id)) { return n.id; } }
		return id;
	}
	/** A caixa do grupo é sempre a união dos filhos (coordenadas absolutas, como nos frames); grupo vazio some. */
	function syncGroups(nodes = model.nodes) {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const n = nodes[i];
			if (n.children) { syncGroups(n.children); }
			if (n.type !== 'group') { continue; }
			if (!n.children || !n.children.length) { nodes.splice(i, 1); selection.delete(n.id); continue; }
			const vis = n.children.filter(c => c.visible !== false);
			const b = unionBox(vis.length ? vis : n.children);
			n.x = b.x; n.y = b.y; n.w = b.w; n.h = b.h;
		}
	}
	/** Redimensiona um grupo escalando os filhos (orig = cópia do grupo antes de mexer). */
	function scaleGroup(g, orig, x, y, w, h) {
		const sx = orig.w ? w / orig.w : 1, sy = orig.h ? h / orig.h : 1;
		const map = (cur, org) => {
			cur.x = round(x + (org.x - orig.x) * sx); cur.y = round(y + (org.y - orig.y) * sy);
			cur.w = cur.type === 'line' ? round(org.w * sx) : Math.max(1, round(org.w * sx));
			cur.h = cur.type === 'line' ? round(org.h * sy) : Math.max(1, round(org.h * sy));
			(cur.children || []).forEach((c, i) => { if (org.children?.[i]) { map(c, org.children[i]); } });
		};
		map(g, orig);
	}

	// ------------------------------------------------------------------ comunicação
	function commit(immediate) {
		clearTimeout(commitTimer);
		if (model) { syncGroups(); }
		const send = () => { if (model) { syncGroups(); } vscode.postMessage({ type: 'edit', model }); };
		if (immediate) { send(); } else { commitTimer = setTimeout(send, 250); }
	}
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg.type === 'load') {
			if (!msg.model) { renderError(msg.error); return; }
			model = msg.model;
			model.nodes = model.nodes || [];
			selection = new Set([...selection].filter(id => find(id)));
			requestImages();
			if (!fitted) { fitted = true; buildUI(); fitAll(); }
			render();
		} else if (msg.type === 'images') {
			Object.assign(images, msg.map);
			render();
		} else if (msg.type === 'imagesAdded') {
			onImagesAdded(msg);
		}
	});
	function requestImages() {
		const srcs = [];
		walk(n => {
			for (const fill of getFills(n)) {
				const src = fill.image?.src || (n.type === 'image' && fill.type === 'image' ? n.src : '');
				if (fill.type === 'image' && src && !images[src]) { srcs.push(src); }
			}
		});
		if (srcs.length) { vscode.postMessage({ type: 'resolveImages', srcs }); }
	}

	// ------------------------------------------------------------------ UI base
	let stage, world, overlay, layersEl, propsEl, zoomEl, hintEl;
	function renderError(text) { document.getElementById('app').innerHTML = ''; document.getElementById('app').append(h('div', { class: 'error' }, text)); }

	function buildUI() {
		const app = document.getElementById('app');
		app.innerHTML = '';
		const tb = h('div', { class: 'toolbar' },
			h('div', { class: 'brand' }, 'DEV ', h('span', {}, 'CODE'), h('span', { class: 'long', style: { color: '#fff' } }, ' · Protótipo')),
			toolBtn('select', '➤ Mover', 'V'),
			toolBtn('frame-mobile', '📱 Frame Mobile', 'F'),
			toolBtn('frame-desktop', '🖥 Frame Desktop', 'D'),
			h('div', { class: 'sep' }),
			toolBtn('rect', '▭ Retângulo', 'R'),
			toolBtn('ellipse', '◯ Elipse', 'O'),
			toolBtn('line', '╱ Linha', 'L'),
			toolBtn('text', 'T Texto', 'T'),
			h('button', { class: 'tool', onclick: () => vscode.postMessage({ type: 'pickImage' }), title: 'Inserir imagem de qualquer pasta (é copiada para a pasta "imagens" do projeto). Também dá para arrastar imagens do Windows para a tela.' }, '🖼 Imagem'),
			h('div', { class: 'sep' }),
			h('button', { class: 'tool', onclick: groupSelected, title: 'Agrupar as camadas selecionadas (Ctrl+G)' }, '▣ Agrupar'),
			h('button', { class: 'tool', onclick: ungroupSelected, title: 'Desagrupar (Ctrl+Shift+G)' }, '⊟ Desagrupar'),
			h('button', { class: `tool ${gridsVisible ? 'active' : ''}`, 'data-grid-toggle': '1', onclick: toggleGrids, title: 'Mostrar ou ocultar grades (Ctrl+Shift+4)' }, '\u25A6 Grades'),
			h('button', { class: 'tool', onclick: openVariables, title: 'Variáveis de cor e número' }, '\u25C6 Variáveis'),
			h('div', { class: 'spacer' }),
			h('div', { class: 'tb-right' },
				h('button', { class: 'tool', onclick: () => zoomBy(1 / 1.2), title: 'Diminuir zoom (-)' }, '−'),
				zoomEl = h('div', { class: 'zoom' }),
				h('button', { class: 'tool', onclick: () => zoomBy(1.2), title: 'Aumentar zoom (+)' }, '+'),
				h('button', { class: 'tool', onclick: fitAll, title: 'Ajustar à tela (Shift+1)' }, '⤢'),
				h('div', { class: 'sep' }),
				h('button', { class: 'tool', 'data-side-toggle': 'left', onclick: () => toggleSide('left'), title: 'Ocultar ou mostrar o painel de Camadas (Ctrl+Alt+1)' }, '◧ Camadas'),
				h('button', { class: 'tool', 'data-side-toggle': 'right', onclick: () => toggleSide('right'), title: 'Ocultar ou mostrar o painel de Propriedades (Ctrl+Alt+2)' }, '◨ Propriedades'),
				h('button', { class: 'tool present-btn', onclick: () => setPresent(true), title: 'Apresentar: mostra só o layout (Ctrl+Enter). Esc sai.' }, '▶ Apresentar'),
			),
		);
		layersEl = h('div', { class: 'panel' });
		stage = h('div', { class: 'stage' });
		world = h('div', { class: 'world' });
		overlay = h('div', { class: 'overlay' });
		hintEl = h('div', { class: 'hint', style: { display: 'none' } });
		stage.append(world, overlay, hintEl);
		propsEl = h('div', { class: 'panel right' });
		// abinhas e barra de apresentação ficam FORA do stage (o stage captura o mouse para arrastar a tela)
		const edgeL = h('button', { class: 'edge-tab left', 'data-edge': 'left', onclick: () => toggleSide('left') });
		const edgeR = h('button', { class: 'edge-tab right', 'data-edge': 'right', onclick: () => toggleSide('right') });
		const presentBar = h('div', { class: 'present-bar' },
			h('span', {}, 'Modo apresentação'),
			h('button', { onclick: fitAll, title: 'Ajustar à tela (Shift+1)' }, '⤢ Ajustar'),
			h('button', { class: 'primary', onclick: () => setPresent(false), title: 'Sair da apresentação (Esc)' }, '✕ Sair', h('kbd', {}, 'Esc')),
		);
		app.append(tb, layersEl, stage, propsEl, edgeL, edgeR, presentBar);
		applyUiMode(false);
		bindStage();
		bindLayerDnd();
	}
	function toolBtn(id, label, key) {
		return h('button', { class: 'tool', 'data-tool': id, onclick: () => setTool(id), title: `${label} (${key})` }, label, h('kbd', {}, key));
	}
	function setTool(t) {
		tool = t;
		document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
		stage.classList.toggle('drawing', t !== 'select');
		const hints = {
			'frame-mobile': 'Clique na área de desenho para criar um frame Mobile (390 × 844)',
			'frame-desktop': 'Clique na área de desenho para criar um frame Desktop (1440 × 900)',
			rect: 'Clique e arraste para desenhar um retângulo (Shift = quadrado)',
			ellipse: 'Clique e arraste para desenhar uma elipse (Shift = círculo)',
			line: 'Clique e arraste para desenhar uma linha (Shift = reta)',
			text: 'Clique para escrever um texto',
		};
		hintEl.textContent = hints[t] || '';
		hintEl.style.display = hints[t] ? '' : 'none';
	}
	// painéis: cada lado se oculta sozinho; apresentação esconde tudo e volta como estava
	const savedUi = vscode.getState?.() || {};
	let hideLeft = !!savedUi.hideLeft, hideRight = !!savedUi.hideRight, presenting = false;
	let presentTimer;
	function saveUi() { vscode.setState?.({ ...(vscode.getState?.() || {}), gridsVisible, hideLeft, hideRight }); }
	function toggleSide(side) {
		if (presenting) { setPresent(false); }
		if (side === 'left') { hideLeft = !hideLeft; } else { hideRight = !hideRight; }
		saveUi();
		applyUiMode(true);
	}
	function setPresent(on) {
		presenting = on;
		if (on) { selection.clear(); setTool('select'); }
		applyUiMode(true, on);
	}
	function applyUiMode(refresh, refit) {
		const app = document.getElementById('app');
		const left = hideLeft || presenting, right = hideRight || presenting;
		app.classList.toggle('hide-left', left);
		app.classList.toggle('hide-right', right);
		app.classList.toggle('ui-present', presenting);
		document.querySelector('[data-side-toggle="left"]')?.classList.toggle('active', hideLeft);
		document.querySelector('[data-side-toggle="right"]')?.classList.toggle('active', hideRight);
		const eL = document.querySelector('[data-edge="left"]'), eR = document.querySelector('[data-edge="right"]');
		if (eL) { eL.textContent = left ? '›' : '‹'; eL.title = left ? 'Mostrar o painel de Camadas' : 'Ocultar o painel de Camadas'; }
		if (eR) { eR.textContent = right ? '‹' : '›'; eR.title = right ? 'Mostrar o painel de Propriedades' : 'Ocultar o painel de Propriedades'; }
		if (presenting) { wakePresentBar(); }
		if (refresh) { requestAnimationFrame(() => { if (refit) { fitAll(); } else { render(); } }); }
	}
	function wakePresentBar() {
		const bar = document.querySelector('.present-bar');
		if (!bar) { return; }
		bar.classList.add('show');
		clearTimeout(presentTimer);
		presentTimer = setTimeout(() => { if (!bar.matches(':hover')) { bar.classList.remove('show'); } }, 2500);
	}
	window.addEventListener('mousemove', () => { if (presenting) { wakePresentBar(); } });
	function toggleGrids() { gridsVisible = !gridsVisible; saveUi(); document.querySelector('[data-grid-toggle]')?.classList.toggle('active', gridsVisible); render(); }

	// ------------------------------------------------------------------ desenho do documento
	function nodeStyle(n, offX, offY) {
		const b = bbox(n);
		return { left: `${b.x - offX}px`, top: `${b.y - offY}px`, width: `${b.w}px`, height: `${b.h}px`, display: n.visible === false ? 'none' : '' };
	}
	function renderNode(n, offX, offY) {
		const el = h('div', { class: `node ${n.type}`, 'data-id': n.id });
		// posicionamento inline: a exportação PNG não leva o proto.css junto
		el.style.position = 'absolute';
		Object.assign(el.style, nodeStyle(n, offX, offY));
		DevStyle.apply(el, n, { resolveColor, resolveNum, renderFillStack: true });
		appendFillLayers(el, n);
		if (n.visible === false) { el.style.display = 'none'; }
		switch (n.type) {
			case 'frame':
			case 'group':
				// filhos com coordenadas absolutas: posicionados relativos à caixa do pai
				for (const c of n.children || []) { el.append(renderNode(c, n.x, n.y)); }
				break;
			case 'line': {
				const b = bbox(n);
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				svg.setAttribute('width', b.w); svg.setAttribute('height', b.h); svg.style.overflow = 'visible';
				const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
				ln.setAttribute('x1', n.x - b.x); ln.setAttribute('y1', n.y - b.y);
				ln.setAttribute('x2', n.x + n.w - b.x); ln.setAttribute('y2', n.y + n.h - b.y);
				ln.setAttribute('stroke', resolveColor(n.stroke, '#111111')); ln.setAttribute('stroke-width', resolveNum(n.strokeWidth, 2)); ln.setAttribute('stroke-linecap', 'round');
				if (n.dash) { ln.setAttribute('stroke-dasharray', n.dash); }
				svg.append(ln); el.append(svg);
				break;
			}
			case 'text':
				el.append(h('span', { class: 'text-content', style: { display: 'block', position: 'relative', zIndex: '1', overflow: n.ellipsis ? 'hidden' : '', textOverflow: n.ellipsis ? 'ellipsis' : '', whiteSpace: 'inherit' } }, n.text));
				if (editingTextId === n.id) { el.firstChild.contentEditable = 'true'; }
				break;
			case 'image':
				break;
		}
		return el;
	}

	function render() {
		if (!model || !world) { return; }
		syncGroups();
		world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
		world.innerHTML = '';
		for (const n of model.nodes) {
			if (n.type === 'frame' && n.visible !== false) {
				const label = h('div', { class: `frame-label ${selection.has(n.id) ? 'sel' : ''}`, 'data-id': n.id, 'data-label': '1' }, n.name);
				Object.assign(label.style, { left: `${n.x}px`, top: `${n.y}px`, transform: `translateY(-100%) scale(${1 / view.zoom})`, paddingBottom: '4px' });
				world.append(label);
			}
			world.append(renderNode(n, 0, 0));
		}
		if (gridsVisible) { for (const frame of model.nodes.filter(n => n.type === 'frame' && n.visible !== false)) { const grid = renderLayoutGrid(frame); if (grid) { world.append(grid); } } }
		zoomEl.textContent = `${Math.round(view.zoom * 100)}%`;
		renderOverlay();
		renderLayers();
		renderProps();
		if (editingTextId) {
			const el = world.querySelector(`[data-id="${editingTextId}"] .text-content`);
			if (el && document.activeElement !== el) { el.focus(); placeCaretAtEnd(el); }
		}
	}
	function gridRects(frame, grid) {
		const vertical = grid.type !== 'rows';
		const extent = vertical ? frame.w : frame.h;
		const margin = Math.max(0, resolveNum(grid.margin, 0)), gutter = Math.max(0, resolveNum(grid.gutter, 0));
		const count = Math.max(1, Math.round(resolveNum(grid.count, 12)));
		const inner = Math.max(1, extent - margin * 2);
		let size = Math.max(1, resolveNum(grid.size, 8));
		if (grid.type !== 'grid') {
			const fixed = grid.align !== 'stretch';
			size = fixed ? Math.max(1, resolveNum(grid.width, vertical ? 80 : 8)) : Math.max(1, (inner - gutter * (count - 1)) / count);
		}
		const total = count * size + gutter * (count - 1);
		let start = margin + resolveNum(grid.offset, 0);
		if (grid.type === 'columns' && grid.align === 'center' || grid.type === 'rows' && grid.align === 'center') { start = (extent - total) / 2 + resolveNum(grid.offset, 0); }
		if (grid.type === 'columns' && grid.align === 'right' || grid.type === 'rows' && grid.align === 'bottom') { start = extent - margin - total + resolveNum(grid.offset, 0); }
		if (grid.type === 'grid') { start = resolveNum(grid.offset, 0); }
		return { vertical, extent, count, size, gutter, start };
	}
	function renderLayoutGrid(frame) {
		if (!gridsVisible || !frame.layoutGrids?.some(g => g.visible !== false)) { return null; }
		const overlayGrid = h('div', { class: 'layout-grid-overlay', 'data-frame-grid': frame.id });
		Object.assign(overlayGrid.style, { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.w}px`, height: `${frame.h}px` });
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', frame.w); svg.setAttribute('height', frame.h); svg.setAttribute('viewBox', `0 0 ${frame.w} ${frame.h}`);
		for (const grid of frame.layoutGrids) {
			if (grid.visible === false) { continue; }
			const color = grid.color || '#FF000019';
			if (grid.type === 'grid' || grid.preset === 'rows8') {
				const size = Math.max(1, resolveNum(grid.size, 8)), offset = resolveNum(grid.offset, 0);
				for (let x = ((offset % size) + size) % size; grid.type === 'grid' && x <= frame.w; x += size) {
					const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('y1', '0'); line.setAttribute('y2', frame.h); line.setAttribute('stroke', color); svg.append(line);
				}
				for (let y = ((offset % size) + size) % size; y <= frame.h; y += size) {
					const line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); line.setAttribute('y1', y); line.setAttribute('y2', y); line.setAttribute('x1', '0'); line.setAttribute('x2', frame.w); line.setAttribute('stroke', color); svg.append(line);
				}
				continue;
			}
			const geom = gridRects(frame, grid);
			for (let i = 0; i < geom.count; i++) {
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				const pos = geom.start + i * (geom.size + geom.gutter);
				if (geom.vertical) { rect.setAttribute('x', pos); rect.setAttribute('y', '0'); rect.setAttribute('width', geom.size); rect.setAttribute('height', frame.h); }
				else { rect.setAttribute('x', '0'); rect.setAttribute('y', pos); rect.setAttribute('width', frame.w); rect.setAttribute('height', geom.size); }
				rect.setAttribute('fill', color); svg.append(rect);
			}
		}
		overlayGrid.append(svg); return overlayGrid;
	}
	function gridSnapLines(frame, axis) {
		const lines = [];
		for (const grid of frame.layoutGrids || []) {
			if (grid.visible === false) { continue; }
			if (grid.type === 'grid' || grid.preset === 'rows8') {
				const size = Math.max(1, resolveNum(grid.size, 8)), offset = resolveNum(grid.offset, 0), extent = axis === 'x' ? frame.w : frame.h;
				if (grid.type === 'grid' || axis === 'y') { for (let p = ((offset % size) + size) % size; p <= extent; p += size) { lines.push((axis === 'x' ? frame.x : frame.y) + p); } }
			} else {
				const geom = gridRects(frame, grid);
				if ((axis === 'x') !== geom.vertical) { continue; }
				for (let i = 0; i < geom.count; i++) {
					const p = (axis === 'x' ? frame.x : frame.y) + geom.start + i * (geom.size + geom.gutter);
					lines.push(p, p + geom.size);
				}
			}
		}
		return lines;
	}
	function snapAxis(start, size, delta, lines, threshold) {
		let best = delta, distance = threshold;
		for (const line of lines) {
			for (const edge of [start + delta, start + delta + size]) {
				const d = line - edge;
				if (Math.abs(d) < distance) { distance = Math.abs(d); best = delta + d; }
			}
		}
		return best;
	}
	function snappedDelta(n, dx, dy, alt) {
		if (alt || !gridsVisible) { return { x: dx, y: dy }; }
		const path = pathTo(n.id), frame = path.slice(0, -1).reverse().find(a => a.type === 'frame') || frameAt(n.x + n.w / 2, n.y + n.h / 2);
		if (!frame?.layoutGrids?.some(g => g.visible !== false)) { return { x: dx, y: dy }; }
		const threshold = 6 / view.zoom;
		return { x: snapAxis(n.x, n.w, dx, gridSnapLines(frame, 'x'), threshold), y: snapAxis(n.y, n.h, dy, gridSnapLines(frame, 'y'), threshold) };
	}
	function snapBox(n, box, alt) {
		if (alt || !gridsVisible) { return box; }
		const path = pathTo(n.id), frame = path.slice(0, -1).reverse().find(a => a.type === 'frame') || frameAt(box.x + box.w / 2, box.y + box.h / 2);
		if (!frame?.layoutGrids?.some(g => g.visible !== false)) { return box; }
		const threshold = 6 / view.zoom;
		for (const axis of ['x', 'y']) {
			const start = axis === 'x' ? box.x : box.y, size = axis === 'x' ? box.w : box.h;
			const lines = gridSnapLines(frame, axis); let best = null, distance = threshold;
			for (const line of lines) {
				const ds = Math.abs(line - start), de = Math.abs(line - (start + size));
				if (ds < distance) { distance = ds; best = { edge: 'start', line }; }
				if (de < distance) { distance = de; best = { edge: 'end', line }; }
			}
			if (best) {
				if (axis === 'x' && best.edge === 'start') { const end = box.x + box.w; box.x = best.line; box.w = Math.max(1, end - box.x); }
				else if (axis === 'x') { box.w = Math.max(1, best.line - box.x); }
				else if (best.edge === 'start') { const end = box.y + box.h; box.y = best.line; box.h = Math.max(1, end - box.y); }
				else { box.h = Math.max(1, best.line - box.y); }
			}
		}
		return box;
	}
	function placeCaretAtEnd(el) {
		const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
		const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
	}

	// ------------------------------------------------------------------ seleção (overlay)
	function toScreen(x, y) { return { x: x * view.zoom + view.x, y: y * view.zoom + view.y }; }
	function toWorld(cx, cy) { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom }; }

	function renderOverlay() {
		overlay.innerHTML = '';
		if (cropMode) { renderCropOverlay(); return; }
		const nodes = selected();
		if (!nodes.length || editingTextId) { return; }
		// contorno tracejado do grupo em que estamos "dentro"
		const parents = new Set(nodes.map(n => find(n.id)?.parent).filter(p => p && p.type === 'group'));
		for (const g of parents) {
			const gp = toScreen(g.x, g.y);
			overlay.append(h('div', { class: 'groupbox', style: { left: `${gp.x}px`, top: `${gp.y}px`, width: `${g.w * view.zoom}px`, height: `${g.h * view.zoom}px` } }));
		}
		const b = unionBox(nodes);
		const p = toScreen(b.x, b.y);
		const box = h('div', { class: 'selbox' });
		Object.assign(box.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${b.w * view.zoom}px`, height: `${b.h * view.zoom}px` });
		overlay.append(box);
		if (nodes.length === 1) {
			const W = b.w * view.zoom, H = b.h * view.zoom;
			const pos = { nw: [0, 0], n: [W / 2, 0], ne: [W, 0], e: [W, H / 2], se: [W, H], s: [W / 2, H], sw: [0, H], w: [0, H / 2] };
			const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
			for (const [k, [x, y]] of Object.entries(pos)) {
				const hd = h('div', { class: 'handle', 'data-handle': k });
				Object.assign(hd.style, { left: `${p.x + x}px`, top: `${p.y + y}px`, cursor: cursors[k] });
				overlay.append(hd);
			}
		}
	}

	// ------------------------------------------------------------------ camadas
	const isOpen = n => layerOpen.has(n.id) ? layerOpen.get(n.id) : n.type === 'frame';
	function renderLayers() {
		layersEl.innerHTML = '';
		layersEl.append(h('h3', {}, 'Camadas'));
		if (!model.nodes.length) { layersEl.append(h('div', { class: 'empty' }, 'Nenhuma camada. Comece criando um Frame Mobile (F) ou Desktop (D).')); return; }
		// quando a seleção muda, abre os grupos/frames que contêm a camada selecionada
		const key = [...selection].join(',');
		if (key !== lastSelKey) {
			lastSelKey = key;
			for (const id of selection) { for (const a of pathTo(id).slice(0, -1)) { layerOpen.set(a.id, true); } }
		}
		const list = h('div', { class: 'layers' });
		const addRows = (nodes, depth) => {
			for (let i = nodes.length - 1; i >= 0; i--) {
				const n = nodes[i];
				const open = isContainer(n) && isOpen(n);
				const hasKids = isContainer(n) && n.children?.length > 0;
				const row = h('div', {
					class: `layer ${selection.has(n.id) ? 'selected' : ''} ${n.visible === false ? 'hidden' : ''}`,
					'data-id': n.id, 'data-depth': depth, draggable: renamingId === n.id ? undefined : 'true',
					style: { paddingLeft: `${4 + depth * 14}px` },
					onclick: e => { selectId(n.id, e.shiftKey); },
					ondblclick: () => { renamingId = n.id; renderLayers(); },
				},
				h('span', { class: 'twisty', title: hasKids ? (open ? 'Recolher' : 'Expandir') : '', onclick: e => { if (!hasKids) { return; } e.stopPropagation(); layerOpen.set(n.id, !open); renderLayers(); } }, hasKids ? (open ? '▾' : '▸') : ''),
				h('span', { class: 'ico' }, ICONS[n.type]),
				h('span', { class: 'name' }, renamingId === n.id ? renameInput(n) : n.name),
				h('button', { class: 'act', title: 'Mover para cima', onclick: e => { e.stopPropagation(); reorder(n.id, 1); } }, '▲'),
				h('button', { class: 'act', title: 'Mover para baixo', onclick: e => { e.stopPropagation(); reorder(n.id, -1); } }, '▼'),
				h('button', { class: `act ${n.locked ? 'on' : ''}`, title: n.locked ? 'Destravar' : 'Travar', onclick: e => { e.stopPropagation(); n.locked = !n.locked; commit(true); render(); } }, n.locked ? '🔒' : '🔓'),
				h('button', { class: `act ${n.visible === false ? 'on' : ''}`, title: n.visible === false ? 'Mostrar' : 'Ocultar', onclick: e => { e.stopPropagation(); n.visible = n.visible === false; commit(true); render(); } }, n.visible === false ? '🙈' : '👁'),
				);
				list.append(row);
				if (open) { addRows(n.children, depth + 1); }
			}
		};
		addRows(model.nodes, 0);
		list.append(h('div', { class: 'drop-line', style: { display: 'none' } }));
		layersEl.append(list);
	}

	// ---- arrastar camadas no painel: ordem (z) e entrar/sair de frames e grupos
	function bindLayerDnd() {
		layersEl.addEventListener('dragstart', e => {
			const row = e.target.closest?.('.layer[data-id]');
			if (!row) { return; }
			const id = row.dataset.id;
			const ids = selection.has(id) ? docOrder(topLevelSelected()).map(n => n.id) : [id];
			layerDrag = { ids };
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('application/x-devproto-layer', ids.join(','));
			for (const r of layersEl.querySelectorAll('.layer[data-id]')) { if (ids.includes(r.dataset.id)) { r.classList.add('dragging'); } }
		});
		layersEl.addEventListener('dragover', e => {
			if (!layerDrag) { return; }
			const t = layerDropTarget(e);
			showLayerDrop(t);
			e.preventDefault();
			e.dataTransfer.dropEffect = t ? 'move' : 'none';
		});
		layersEl.addEventListener('dragleave', e => { if (layerDrag && !layersEl.contains(e.relatedTarget)) { showLayerDrop(null); } });
		layersEl.addEventListener('drop', e => {
			if (!layerDrag) { return; }
			e.preventDefault();
			const t = layerDropTarget(e), ids = layerDrag.ids;
			layerDrag = null; showLayerDrop(null);
			if (t) { moveLayers(ids, t); } else { renderLayers(); }
		});
		layersEl.addEventListener('dragend', () => { if (layerDrag) { layerDrag = null; renderLayers(); } });
	}
	/** @returns {{ mode: 'above'|'below'|'inside'|'root-bottom', id?: string, row?: HTMLElement } | null} */
	function layerDropTarget(e) {
		const rows = [...layersEl.querySelectorAll('.layer[data-id]')];
		if (!rows.length) { return null; }
		let row = e.target.closest?.('.layer[data-id]');
		let t;
		if (!row) {
			// abaixo da última linha: vai para o fundo da raiz
			const last = rows[rows.length - 1];
			if (e.clientY < last.getBoundingClientRect().bottom) { return null; }
			t = { mode: 'root-bottom' };
		} else {
			const n = find(row.dataset.id)?.node;
			if (!n) { return null; }
			const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
			let mode;
			if (isContainer(n)) { mode = y < 0.25 ? 'above' : (y > 0.75 && !(isOpen(n) && n.children?.length)) ? 'below' : 'inside'; }
			else { mode = y < 0.5 ? 'above' : 'below'; }
			t = { mode, id: n.id, row };
		}
		return validLayerDrop(layerDrag.ids, t) ? t : null;
	}
	function validLayerDrop(ids, t) {
		const moving = ids.map(id => find(id)?.node).filter(Boolean);
		if (!moving.length) { return false; }
		if (t.mode === 'root-bottom') { return true; }
		if (ids.includes(t.id)) { return false; }
		const dest = t.mode === 'inside' ? find(t.id).node : find(t.id).parent; // null = raiz
		if (dest && pathTo(dest.id).some(a => ids.includes(a.id))) { return false; } // dentro de si mesmo
		if (dest && moving.some(m => m.type === 'frame')) { return false; } // frames ficam na raiz
		return true;
	}
	function showLayerDrop(t) {
		const line = layersEl.querySelector('.drop-line');
		layersEl.querySelectorAll('.drop-inside').forEach(r => r.classList.remove('drop-inside'));
		if (!line) { return; }
		if (!t || t.mode === 'inside') { line.style.display = 'none'; if (t) { t.row.classList.add('drop-inside'); } return; }
		let top, depth = 0;
		if (t.mode === 'root-bottom') { const rows = layersEl.querySelectorAll('.layer[data-id]'); const last = rows[rows.length - 1]; top = last.offsetTop + last.offsetHeight; }
		else { top = t.row.offsetTop + (t.mode === 'below' ? t.row.offsetHeight : 0); depth = +t.row.dataset.depth || 0; }
		Object.assign(line.style, { display: '', top: `${top}px`, left: `${24 + depth * 14}px` });
	}
	function moveLayers(ids, t) {
		const moving = docOrder(ids.map(id => find(id)?.node).filter(Boolean));
		for (const m of moving) { const f = find(m.id); f.list.splice(f.list.indexOf(m), 1); }
		let list, index;
		if (t.mode === 'root-bottom') { list = model.nodes; index = 0; }
		else if (t.mode === 'inside') { const c = find(t.id).node; list = c.children = c.children || []; index = list.length; layerOpen.set(c.id, true); }
		else { const f = find(t.id); list = f.list; index = f.list.indexOf(f.node) + (t.mode === 'above' ? 1 : 0); }
		list.splice(index, 0, ...moving);
		selection = new Set(moving.map(m => m.id));
		commit(true); render();
	}
	function renameInput(n) {
		const inp = h('input', { value: n.name });
		const done = save => { if (save && inp.value.trim()) { n.name = inp.value.trim(); commit(true); } renamingId = null; render(); };
		inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { done(true); } if (e.key === 'Escape') { done(false); } });
		inp.addEventListener('blur', () => done(true));
		setTimeout(() => { inp.focus(); inp.select(); }, 0);
		return inp;
	}
	function reorder(id, dir) {
		const f = find(id); if (!f) { return; }
		const i = f.list.indexOf(f.node), j = i + dir;
		if (j < 0 || j >= f.list.length) { return; }
		[f.list[i], f.list[j]] = [f.list[j], f.list[i]];
		commit(true); render();
	}

	// ------------------------------------------------------------------ propriedades
	function num(label, obj, key, opts = {}) {
		const inp = h('input', { type: 'number', value: round(obj[key] ?? 0), step: opts.step || 1, min: opts.min });
		inp.addEventListener('input', () => {
			let v = parseFloat(inp.value);
			if (isNaN(v)) { return; }
			if (opts.min !== undefined) { v = Math.max(opts.min, v); }
			if (opts.apply) { opts.apply(v); commit(); render(); } else { setProp(obj, key, v, opts.after); }
		});
		inp.addEventListener('keydown', e => e.stopPropagation());
		return h('div', { class: 'field', title: opts.title || '' }, h('label', {}, label), inp);
	}
	function color(label, obj, key) {
		const val = obj[key] && obj[key] !== 'transparent' ? obj[key] : '#000000';
		const pick = h('input', { type: 'color', value: val.slice(0, 7) });
		const txt = h('input', { value: obj[key] || 'transparent' });
		pick.addEventListener('input', () => { txt.value = pick.value; setProp(obj, key, pick.value); });
		txt.addEventListener('change', () => setProp(obj, key, txt.value.trim() || 'transparent'));
		txt.addEventListener('keydown', e => e.stopPropagation());
		return h('div', { class: 'field' }, h('label', {}, label), pick, txt);
	}
	function select(label, obj, key, options) {
		const sel = h('select', {}, ...options.map(([v, t]) => h('option', { value: v, selected: String(obj[key]) === String(v) }, t)));
		sel.addEventListener('change', () => setProp(obj, key, isNaN(+sel.value) || sel.value === '' ? sel.value : +sel.value));
		return h('div', { class: 'field' }, h('label', {}, label), sel);
	}
	function setProp(obj, key, value, after) {
		if (value === undefined) { delete obj[key]; } else { obj[key] = value; }
		if (after) { after(); }
		commit();
		render();
	}
	function section(title, ...rows) { return h('div', { class: 'section' }, h('h3', {}, title), ...rows); }
	let activeModal = null;
	function variableCssName(name) { return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'variavel'; }
	function variablesCss() {
		const vars = { colors: model?.variables?.colors || [], numbers: model?.variables?.numbers || [] };
		const lines = [...vars.colors, ...vars.numbers].map(v => `  --${variableCssName(v.name)}: ${v.value};`);
		return `:root {\n${lines.join('\n')}\n}`;
	}
	function modal(title, width = 440) {
		activeModal?.remove();
		const back = h('div', { class: 'modal-backdrop' });
		const box = h('div', { class: 'modal', style: { width: `${width}px` } }, h('div', { class: 'modal-title' }, title));
		box.addEventListener('keydown', e => e.stopPropagation());
		back.append(box); back.addEventListener('pointerdown', e => { if (e.target === back) { back.remove(); if (activeModal === back) { activeModal = null; } } });
		document.body.append(back); activeModal = back;
		return { back, box };
	}
	function saveVariableChange() { commit(); render(); }
	function replaceVariableBindings(id, value, obj = model) {
		if (!obj || typeof obj !== 'object') { return; }
		for (const key of Object.keys(obj)) {
			const current = obj[key];
			if (current && typeof current === 'object' && current.var === id) { obj[key] = clone(value); }
			else if (current && typeof current === 'object') { replaceVariableBindings(id, value, current); }
		}
	}
	function confirmDeleteVariable(v, kind) {
		const { back, box } = modal('Excluir variável?', 360);
		box.append(h('p', {}, `“${v.name}” está vinculada a campos. Ao excluir, os campos receberão o valor atual (${v.value}).`),
			h('div', { class: 'modal-actions' },
				h('button', { class: 'btn', onclick: () => { back.remove(); activeModal = null; openVariables(); } }, 'Cancelar'),
				h('button', { class: 'btn primary', onclick: () => {
					replaceVariableBindings(v.id, v.value);
					model.variables[kind] = model.variables[kind].filter(x => x.id !== v.id);
					back.remove(); activeModal = null; saveVariableChange(); openVariables();
				} }, 'Excluir')));
	}
	function openCssModal() {
		const { box } = modal('Ver como CSS', 520);
		const css = h('textarea', { class: 'css-preview', readonly: true }, variablesCss());
		box.append(css, h('div', { class: 'modal-actions' },
			h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(css.value); toast('CSS copiado.'); } catch { toast('Não foi possível copiar o CSS neste contexto.'); } } }, 'Copiar CSS'),
			h('button', { class: 'btn primary', onclick: () => { activeModal?.remove(); activeModal = null; openVariables(); } }, 'Voltar')));
	}
	function openVariables() {
		const vars = { colors: model.variables?.colors || [], numbers: model.variables?.numbers || [] };
		const { box } = modal('Variáveis', 520);
		const list = h('div', { class: 'variable-list' });
		const addRow = (items, kind, title) => {
			list.append(h('div', { class: 'variable-group-title' }, title));
			for (const v of items) {
				const name = h('input', { value: v.name, title: `CSS: --${variableCssName(v.name)}` });
				name.addEventListener('change', () => { v.name = name.value.trim() || v.name; name.title = `CSS: --${variableCssName(v.name)}`; hint.textContent = `--${variableCssName(v.name)}`; saveVariableChange(); });
				name.addEventListener('keydown', e => e.stopPropagation());
				const value = h('input', { type: kind === 'color' ? 'color' : 'number', value: kind === 'color' ? String(v.value || '#000000').slice(0, 7) : v.value, step: kind === 'number' ? 0.1 : undefined });
				value.addEventListener('input', () => { v.value = kind === 'number' ? Number(value.value) : value.value; saveVariableChange(); });
				const hint = h('span', { class: 'variable-css-hint' }, `--${variableCssName(v.name)}`);
				list.append(h('div', { class: 'variable-row' }, name, value, hint, h('button', { class: 'btn mini', title: 'Excluir', onclick: () => confirmDeleteVariable(v, kind === 'color' ? 'colors' : 'numbers') }, '×')));
			}
		};
		addRow(vars.colors, 'color', 'Cores'); addRow(vars.numbers, 'number', 'Números');
		if (!vars.colors.length && !vars.numbers.length) { list.append(h('div', { class: 'empty' }, 'Crie variáveis para reutilizar cores e medidas no protótipo.')); }
		box.append(list, h('div', { class: 'modal-actions' },
			h('button', { class: 'btn', onclick: () => { model.variables = { colors: model.variables?.colors || [], numbers: model.variables?.numbers || [] }; model.variables.colors.push({ id: uid(), name: `cor/${model.variables.colors.length + 1}`, value: '#D10A0A' }); saveVariableChange(); openVariables(); } }, '+ Cor'),
			h('button', { class: 'btn', onclick: () => { model.variables = { colors: model.variables?.colors || [], numbers: model.variables?.numbers || [] }; model.variables.numbers.push({ id: uid(), name: `espacamento/${model.variables.numbers.length + 1}`, value: 8 }); saveVariableChange(); openVariables(); } }, '+ Número'),
			h('button', { class: 'btn', onclick: openCssModal }, 'Ver como CSS'),
			h('button', { class: 'btn primary', onclick: () => { activeModal?.remove(); activeModal = null; } }, 'Fechar')));
	}
	function bindField(obj, key, kind, anchor) {
		const current = obj[key];
		if (current && typeof current === 'object' && current.var) {
			obj[key] = kind === 'color' ? resolveColor(current) : resolveNum(current);
			commit(true); render(); return;
		}
		const values = variableList(kind);
		if (!values.length) { openVariables(); toast('Crie uma variável deste tipo e vincule o campo.'); return; }
		const pop = h('div', { class: 'variable-pop' });
		for (const v of values) {
			pop.append(h('button', { class: 'variable-option', onclick: e => { e.stopPropagation(); obj[key] = { var: v.id }; pop.remove(); commit(true); render(); } },
				kind === 'color' ? h('span', { class: 'variable-swatch', style: { background: resolveColor({ var: v.id }) } }) : null,
				v.name, h('span', { class: 'variable-css-hint' }, `--${variableCssName(v.name)}`)));
		}
		pop.append(h('button', { class: 'variable-option create', onclick: e => { e.stopPropagation(); pop.remove(); openVariables(); } }, '+ Gerenciar variáveis'));
		document.body.append(pop);
		const r = anchor?.getBoundingClientRect();
		Object.assign(pop.style, { left: `${Math.max(8, Math.min(window.innerWidth - 250, r?.left || 8))}px`, top: `${Math.min(window.innerHeight - 260, (r?.bottom || 32) + 4)}px` });
		setTimeout(() => document.addEventListener('pointerdown', function close(e) { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', close); } }), 0);
	}
	function variableContext(n) {
		return {
			variables: model.variables || emptyVariables(), resolveColor, resolveNum, bindField,
			canBind: (obj, key, kind) => kind === 'color' || (kind === 'number' && (['radius', 'strokeWidth', 'fontSize', 'gap'].includes(String(key)) || (Array.isArray(obj) && (obj === n.padding || obj === n.radii || obj === n.borderSides)))),
		};
	}
	function updateFill(n, key, index, change) {
		const fill = fillAt(n, key, index);
		if (!fill) { return; }
		fill.id = fill.id || uid(); change(fill); commit(); render();
	}
	function addFill(n, type = 'solid', index = 0) {
		const fill = { id: uid(), type, color: '#D10A0A', opacity: 1, visible: true, blend: '' };
		if (type === 'linear' || type === 'radial' || type === 'conic') { fill.gradient = { angle: type === 'conic' ? 0 : 180, shape: 'circle', stops: [{ color: '#D10A0A', pos: 0, opacity: 1 }, { color: '#111111', pos: 100, opacity: 1 }] }; }
		if (type === 'image') { fill.image = { src: '', mode: 'cover', scale: 100, transform: null, adjustments: {} }; }
		const fills = ensureFills(n); fills.splice(Math.max(0, Math.min(index, fills.length)), 0, fill); commit(true); render();
		return fill;
	}
	function addImageOverlay(n, key, index, gradient) {
		const fills = ensureFills(n);
		const above = fills.findIndex(f => f.id === key);
		const fill = gradient
			? { id: uid(), type: 'linear', opacity: 1, visible: true, blend: '', gradient: { angle: 180, stops: [{ color: '#000000', pos: 0, opacity: 0 }, { color: '#000000', pos: 100, opacity: 0.7 }] } }
			: { id: uid(), type: 'solid', color: '#000000', opacity: 0.4, visible: true, blend: '' };
		fills.splice(above >= 0 ? above : index, 0, fill); commit(true); render();
	}
	function imagePickerForFill(n, fill, index) {
		const actual = fillAt(n, fill.id || `fill-${index}`, index);
		if (!actual) { return; }
		actual.id = actual.id || uid(); actual.type = 'image'; actual.image = actual.image || { src: '', mode: 'cover', scale: 100, transform: null, adjustments: {} };
		vscode.postMessage({ type: 'pickImage', replace: n.id, fillId: actual.id });
	}
	function svgColorEditor(n, key, index, image) {
		const src = image.src || (n.type === 'image' ? n.src : '');
		if (!isSvg(src)) { return null; }
		loadSvg(src);
		const colors = svgColors(src);
		if (!colors.length) { return h('div', { class: 'hint-line' }, svgTexts[src] === undefined ? 'Lendo as cores do SVG…' : 'Este SVG não tem cores editáveis.'); }
		const map = image.svgColors || {};
		return h('div', { class: 'svg-colors' },
			h('div', { class: 'svg-colors-head' }, h('strong', {}, 'Cores do SVG'), Object.keys(map).length ? h('button', { class: 'btn mini', onclick: () => updateFill(n, key, index, f => { delete f.image.svgColors; }) }, 'Restaurar') : null),
			...colors.map(orig => {
				const holder = { c: map[orig] ?? (orig === '__padrao' ? '#000000' : orig) };
				return h('div', { class: 'svg-color-row' },
					h('span', { class: 'svg-orig', title: orig === '__padrao' ? 'Cor padrão (partes sem cor definida)' : `Cor original ${orig}`, style: { background: orig === '__padrao' ? '#000000' : orig } }),
					h('span', { class: 'svg-arrow' }, '→'),
					customColor(orig === '__padrao' ? 'Padrão' : '', holder, 'c', orig === '__padrao' ? '#000000' : orig,
						v => updateFill(n, key, index, f => { f.image.svgColors = { ...(f.image.svgColors || {}), [orig]: v }; }),
						anchor => { const f = fillAt(n, key, index); f.image.svgColors = f.image.svgColors || {}; if (f.image.svgColors[orig] === undefined) { f.image.svgColors[orig] = orig === '__padrao' ? '#000000' : orig; } bindField(f.image.svgColors, orig, 'color', anchor); }));
			}));
	}
	function customNum(label, obj, key, options = {}) {
		const bound = !!obj[key]?.var;
		const value = resolveNum(obj[key], options.def ?? 0);
		const input = h('input', { type: 'number', value, step: options.step || 1, min: options.min, max: options.max, disabled: bound });
		input.addEventListener('input', () => { const v = Number(input.value); if (!Number.isFinite(v)) { return; } options.set ? options.set(v) : setProp(obj, key, v); });
		input.addEventListener('keydown', e => e.stopPropagation());
		return h('div', { class: 'field', title: options.title || '' }, h('label', {}, label), input, options.unit ? h('span', { class: 'unit' }, options.unit) : null, options.bind ? bindingControl(obj, key, 'number', options.bind) : null);
	}
	function customColor(label, obj, key, fallback = '#000000', onSet, onBind) {
		const bound = !!obj[key]?.var;
		const value = resolveColor(obj[key], fallback);
		const color = h('input', { type: 'color', value: String(value).startsWith('#') ? String(value).slice(0, 7) : fallback, disabled: bound });
		const text = h('input', { class: 'color-text', value: bound ? 'variável' : String(value), disabled: bound, spellcheck: 'false' });
		const save = value => onSet ? onSet(value) : setProp(obj, key, value);
		color.addEventListener('input', () => { text.value = color.value; save(color.value); });
		text.addEventListener('change', () => save(text.value.trim() || fallback));
		text.addEventListener('keydown', e => e.stopPropagation());
		return h('div', { class: 'field' }, h('label', {}, label), color, text, bindingControl(obj, key, 'color', onBind));
	}
	function fillSelect(label, obj, key, options, apply) {
		const sel = h('select', {}, ...options.map(([value, title]) => h('option', { value, selected: String(obj[key] ?? '') === String(value) }, title)));
		sel.addEventListener('change', () => { const value = sel.value; sel.blur(); apply(value); });
		return h('div', { class: 'field' }, h('label', {}, label), sel);
	}
	function bindingControl(obj, key, kind, onBind) {
		const bound = obj[key] && typeof obj[key] === 'object' && obj[key].var;
		const item = bound ? variableList(kind).find(v => v.id === obj[key].var) : null;
		return h('span', { class: 'binding-tools' },
			bound ? h('span', { class: 'binding-chip', title: item?.name || '' }, `◆ ${item?.name || 'variável'}`) : null,
			h('button', { class: 'bind-btn', title: bound ? 'Desvincular variável' : 'Vincular a uma variável', onclick: e => { e.stopPropagation(); onBind ? onBind(e.currentTarget) : bindField(obj, key, kind, e.currentTarget); } }, bound ? '×' : '◆'));
	}
	function cropTarget() {
		const n = cropMode && find(cropMode.nodeId)?.node;
		const fill = n && getFills(n).find(f => f.id === cropMode.fillId);
		return n && fill ? { node: n, fill } : null;
	}
	function exitCrop() { if (!cropMode) { return; } cropMode = null; render(); }
	async function imageDimensions(url) {
		return new Promise(resolve => {
			const img = new Image(); const timer = setTimeout(() => resolve({ w: 200, h: 150 }), 3000);
			img.onload = () => { clearTimeout(timer); resolve({ w: img.naturalWidth || 200, h: img.naturalHeight || 150 }); };
			img.onerror = () => { clearTimeout(timer); resolve({ w: 200, h: 150 }); }; img.src = url;
		});
	}
	async function enterCrop(n, fill, index) {
		const actual = fillAt(n, fill.id || `fill-${index}`, index);
		if (!actual) { return; }
		actual.id = actual.id || uid(); actual.type = 'image'; actual.image = actual.image || { src: '', mode: 'cover', scale: 100, adjustments: {} };
		if (!actual.image.src) { imagePickerForFill(n, actual, index); return; }
		let transform = fillImageTransform(n, actual);
		if (!transform || !transform.w || !transform.h) {
			const src = images[actual.image.src];
			const natural = await imageDimensions(src);
			const ratio = natural.w / natural.h, boxRatio = n.w / Math.max(1, n.h);
			const w = ratio > boxRatio ? n.h * ratio : n.w;
			const hgt = ratio > boxRatio ? n.h : n.w / ratio;
			transform = { x: round((n.w - w) / 2), y: round((n.h - hgt) / 2), w: round(w), h: round(hgt) };
			actual.image.transform = transform;
			if (n.type === 'image') { n.imageTransform = clone(transform); }
		}
		actual.image.mode = 'crop';
		cropMode = { nodeId: n.id, fillId: actual.id }; selection = new Set([n.id]); editingTextId = null;
		commit(true); render();
	}
	function renderCropOverlay() {
		const target = cropTarget(); if (!target || !stage) { cropMode = null; return; }
		const { node: n, fill } = target;
		const transform = fillImageTransform(n, fill) || { x: 0, y: 0, w: n.w, h: n.h };
		const src = imageUri(fill.image?.src || '', fill.image);
		if (!src) { return; }
		const p = toScreen(n.x, n.y), ip = toScreen(n.x + transform.x, n.y + transform.y);
		const W = n.w * view.zoom, H = n.h * view.zoom, iW = transform.w * view.zoom, iH = transform.h * view.zoom;
		const ui = h('div', { class: 'crop-ui', 'data-crop-ui': '1' });
		const img = h('img', { class: 'crop-full-image', src, draggable: 'false', alt: '' });
		Object.assign(img.style, { left: `${ip.x}px`, top: `${ip.y}px`, width: `${iW}px`, height: `${iH}px`, filter: DevStyle.imageFilterCss(fill.image.adjustments || {}) });
		if (fill.image.rotation) { img.style.transform = `rotate(${resolveNum(fill.image.rotation)}deg)`; img.style.transformOrigin = 'center'; }
		ui.append(img);
		const imageRect = h('div', { class: 'crop-image-rect', style: { left: `${ip.x}px`, top: `${ip.y}px`, width: `${iW}px`, height: `${iH}px` } });
		imageRect.append(h('div', { class: 'crop-image-hit', 'data-crop-move': '1', title: 'Arraste para reposicionar a imagem' }));
		for (const [handle, x, y] of [['nw', 0, 0], ['ne', iW, 0], ['se', iW, iH], ['sw', 0, iH]]) {
			imageRect.append(h('div', { class: 'crop-handle image-handle', 'data-crop-image-handle': handle, style: { left: `${x}px`, top: `${y}px` } }));
		}
		ui.append(imageRect);
		const windowBox = h('div', { class: 'crop-window', style: { left: `${p.x}px`, top: `${p.y}px`, width: `${W}px`, height: `${H}px` } });
		if (n.type === 'ellipse') { windowBox.style.borderRadius = '50%'; }
		else { windowBox.style.borderRadius = `${resolveNum(n.radius) * view.zoom}px`; }
		for (const [handle, x, y] of [['nw', 0, 0], ['n', W / 2, 0], ['ne', W, 0], ['e', W, H / 2], ['se', W, H], ['s', W / 2, H], ['sw', 0, H], ['w', 0, H / 2]]) {
			windowBox.append(h('div', { class: 'crop-handle window-handle', 'data-crop-window-handle': handle, style: { left: `${x}px`, top: `${y}px` } }));
		}
		ui.append(windowBox, h('div', { class: 'crop-label', style: { left: `${p.x}px`, top: `${p.y + H + 10}px` } }, 'Arraste a imagem ou ajuste o recorte · Enter/Esc para concluir'));
		overlay.append(ui);
	}
	function fillStackSection(n) {
		if (n.type === 'line' || n.type === 'group') { return null; }
		const fills = getFills(n);
		const rows = [];
		for (const [index, fill] of fills.entries()) {
			const key = fill.id || `fill-${index}`;
			const head = h('div', { class: 'fill-head' },
				h('strong', {}, `${fill.type === 'image' ? 'Imagem' : fill.type === 'linear' ? 'Degradê linear' : fill.type === 'radial' ? 'Degradê radial' : fill.type === 'conic' ? 'Degradê cônico' : 'Cor sólida'} ${index + 1}`),
				h('button', { class: 'btn mini', title: fill.visible === false ? 'Mostrar preenchimento' : 'Ocultar preenchimento', onclick: () => updateFill(n, key, index, f => { f.visible = f.visible === false; }) }, fill.visible === false ? '◉' : '◌'),
				h('button', { class: 'btn mini', title: 'Trazer para cima', disabled: index === 0, onclick: () => { const stack = ensureFills(n); const [item] = stack.splice(index, 1); stack.splice(index - 1, 0, item); commit(true); render(); } }, '↑'),
				h('button', { class: 'btn mini', title: 'Enviar para baixo', disabled: index === fills.length - 1, onclick: () => { const stack = ensureFills(n); const [item] = stack.splice(index, 1); stack.splice(index + 1, 0, item); commit(true); render(); } }, '↓'),
				h('button', { class: 'btn mini', title: 'Remover preenchimento', onclick: () => { const stack = ensureFills(n); stack.splice(index, 1); commit(true); render(); } }, '×'));
			const type = h('select', {}, ...[['solid', 'Cor sólida'], ['linear', 'Degradê linear'], ['radial', 'Degradê radial'], ['conic', 'Degradê cônico'], ['image', 'Imagem']].map(([v, label]) => h('option', { value: v, selected: fill.type === v }, label)));
			type.addEventListener('change', () => { type.blur(); updateFill(n, key, index, f => {
				f.type = type.value;
				if (['linear', 'radial', 'conic'].includes(f.type)) { f.gradient = f.gradient || { angle: 180, shape: 'circle', stops: [{ color: '#FFFFFF', pos: 0, opacity: 1 }, { color: '#000000', pos: 100, opacity: 1 }] }; }
				if (f.type === 'image') { f.image = f.image || { src: '', mode: 'cover', scale: 100, transform: null, adjustments: {} }; }
				if (f.type === 'solid') { f.color = f.color || '#D10A0A'; }
			}); });
			const fields = [head, h('div', { class: 'row one' }, h('div', { class: 'field' }, h('label', {}, 'Tipo'), type)),
				h('div', { class: 'row' }, customNum('Opac.', fill, 'opacity', { min: 0, max: 1, step: 0.01, def: 1, set: v => updateFill(n, key, index, f => { f.opacity = v; }) }), fillSelect('Mescl.', fill, 'blend', [['', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Tela'], ['overlay', 'Sobrepor'], ['darken', 'Escurecer'], ['lighten', 'Clarear'], ['soft-light', 'Luz suave'], ['difference', 'Diferença']], v => updateFill(n, key, index, f => { f.blend = v; })) )];
			if (fill.type === 'solid') { fields.push(h('div', { class: 'row one' }, customColor('Cor', fill, 'color', '#D10A0A', v => updateFill(n, key, index, f => { f.color = v; }), anchor => { const f = fillAt(n, key, index); bindField(f, 'color', 'color', anchor); }))); }
			if (['linear', 'radial', 'conic'].includes(fill.type)) {
				fill.gradient = fill.gradient || { angle: 180, shape: 'circle', stops: [{ color: '#FFFFFF', pos: 0, opacity: 1 }, { color: '#000000', pos: 100, opacity: 1 }] };
				if (fill.type !== 'radial') { fields.push(h('div', { class: 'row one' }, customNum('Ângulo', fill.gradient, 'angle', { min: 0, max: 360, set: v => updateFill(n, key, index, f => { f.gradient.angle = v; }) }))); }
				else { fields.push(h('div', { class: 'row one' }, fillSelect('Forma', fill.gradient, 'shape', [['circle', 'Círculo'], ['ellipse', 'Elipse']], v => updateFill(n, key, index, f => { f.gradient.shape = v; })))); }
				for (const [si, stop] of fill.gradient.stops.entries()) {
					fields.push(h('div', { class: 'gradient-stop' },
						customColor(`${si + 1}`, stop, 'color', '#000000', v => updateFill(n, key, index, f => { f.gradient.stops[si].color = v; }), anchor => { const f = fillAt(n, key, index); bindField(f.gradient.stops[si], 'color', 'color', anchor); }),
						customNum('%', stop, 'pos', { min: 0, max: 100, set: v => updateFill(n, key, index, f => { f.gradient.stops[si].pos = v; }) }),
						customNum('α', stop, 'opacity', { min: 0, max: 1, step: 0.05, def: 1, set: v => updateFill(n, key, index, f => { f.gradient.stops[si].opacity = v; }) }),
						fill.gradient.stops.length > 2 ? h('button', { class: 'btn mini', title: 'Remover cor', onclick: () => updateFill(n, key, index, f => { f.gradient.stops.splice(si, 1); }) }, '×') : null));
				}
				fields.push(h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => updateFill(n, key, index, f => { f.gradient.stops.push({ color: '#FFFFFF', pos: 50, opacity: 1 }); f.gradient.stops.sort((a, b) => a.pos - b.pos); }) }, '+ Cor no degradê')));
			}
			if (fill.type === 'image') {
				fill.image = fill.image || { src: '', mode: 'cover', scale: 100, transform: null, adjustments: {} };
				const image = fill.image;
				fields.push(h('div', { class: 'row one' }, h('div', { class: 'field' }, h('label', {}, 'Arquivo'), h('input', { value: image.src || '', disabled: true }), h('button', { class: 'btn mini', onclick: () => imagePickerForFill(n, fill, index) }, image.src ? 'Trocar' : 'Escolher'))),
					h('div', { class: 'row one' }, fillSelect('Ajuste', image, 'mode', [['cover', 'Preencher'], ['contain', 'Caber'], ['crop', 'Cortar'], ['tile', 'Lado a lado'], ['stretch', 'Esticar'], ['none', 'Tamanho original'], ['scale-down', 'Reduzir se precisar']], v => v === 'crop' ? enterCrop(n, fill, index) : updateFill(n, key, index, f => { f.image.mode = v; }))),
					image.mode === 'tile' ? h('div', { class: 'row one' }, customNum('Escala', image, 'scale', { min: 1, max: 500, unit: '%', def: 100 })) : null,
					h('div', { class: 'btnrow' },
						h('button', { class: 'btn', disabled: !image.src, onclick: () => enterCrop(n, fill, index) }, 'Cortar'),
						h('button', { class: 'btn', onclick: () => updateFill(n, key, index, f => { f.image.rotation = ((resolveNum(f.image.rotation) + 90) % 360); }) }, '↻ Girar 90°'),
						h('button', { class: 'btn', onclick: () => addImageOverlay(n, key, index, false) }, '+ Sobreposição (overlay)'),
						h('button', { class: 'btn', onclick: () => addImageOverlay(n, key, index, true) }, '+ Degradê por cima')),
						svgColorEditor(n, key, index, image),
						h('div', { class: 'row one' }, h('div', { class: 'image-adjustments' },
							h('strong', {}, 'Ajustes da imagem'),
						...[["exposure", "Exposição", -1, 1, 0.05], ["contrast", "Contraste", 0, 200, 1], ["saturation", "Saturação", 0, 200, 1], ["temperature", "Temperatura", -100, 100, 1], ["tint", "Matiz / tint", -180, 180, 1], ["highlights", "Realces", -100, 100, 1], ["shadows", "Sombras", -100, 100, 1]].map(([prop, label, min, max, step]) => {
							const value = h('span', { class: 'unit' }, String(image.adjustments?.[prop] ?? (prop === 'contrast' || prop === 'saturation' ? 100 : 0)));
							const input = h('input', { type: 'range', min, max, step, value: image.adjustments?.[prop] ?? (prop === 'contrast' || prop === 'saturation' ? 100 : 0) });
							input.addEventListener('input', () => { value.textContent = input.value; updateFill(n, key, index, f => { f.image.adjustments = f.image.adjustments || {}; f.image.adjustments[prop] = Number(input.value); }); });
							return h('div', { class: 'adjustment-row' }, h('label', {}, label), input, value);
						}))))
			}
			rows.push(h('div', { class: 'fill-card' }, ...fields));
		}
		rows.push(h('div', { class: 'btnrow' },
			h('button', { class: 'btn', title: 'Adicionar preenchimento acima', onclick: () => addFill(n, 'solid', 0) }, '+ Adicionar preenchimento'),
			h('button', { class: 'btn', onclick: () => addFill(n, 'linear', 0) }, '+ Degradê')));
		return section(n.type === 'text' ? 'Preenchimento' : 'Preenchimento', ...rows);
	}
	function gridPreset(frame, preset) {
		const mobile = frame.preset === 'mobile' || frame.w <= 480;
		const base = { visible: true, color: '#FF000019', type: 'columns', count: mobile ? 4 : 12, gutter: mobile ? 16 : 20, margin: mobile ? 16 : 20, offset: 0, align: 'stretch', width: 0 };
		if (preset === 'grid8') { Object.assign(base, { type: 'grid', size: 8 }); }
		if (preset === 'columns') { Object.assign(base, { type: 'columns', count: 12, gutter: 20, margin: 20, align: 'stretch' }); }
		if (preset === 'mobile') { Object.assign(base, { type: 'columns', count: 4, gutter: 16, margin: 16, align: 'stretch' }); }
		if (preset === 'rows8') { Object.assign(base, { type: 'rows', preset: 'rows8', size: 8, count: 0, gutter: 0, margin: 0, offset: 0, align: 'top', width: 0 }); }
		frame.layoutGrids = frame.layoutGrids || [];
		frame.layoutGrids.push(base); commit(true); render();
	}
	function gridColorField(grid, index) {
		const c = DevStyle.parseColor(grid.color || '#FF000019');
		const pick = h('input', { type: 'color', value: c.hex });
		const alpha = h('input', { type: 'range', min: 0, max: 100, value: Math.round(c.a * 100), title: 'Opacidade da cor' });
		const save = () => { grid.color = DevStyle.toColor(pick.value, Math.max(0, Math.min(100, Number(alpha.value))) / 100); commit(); render(); };
		pick.addEventListener('input', save); alpha.addEventListener('input', save);
		return h('div', { class: 'field' }, h('label', {}, 'Cor'), pick, alpha);
	}
	function layoutGridSection(frame) {
		const grids = frame.layoutGrids || [];
		const rows = [];
		for (const [index, grid] of grids.entries()) {
			const type = grid.type || 'columns';
			const head = h('div', { class: 'grid-head' },
				h('strong', {}, type === 'grid' ? 'Grade' : type === 'rows' ? 'Linhas' : 'Colunas'),
				h('button', { class: 'btn mini', title: grid.visible === false ? 'Mostrar grade' : 'Ocultar grade', onclick: () => { grid.visible = grid.visible === false; commit(true); render(); } }, grid.visible === false ? '◉' : '◌'),
				h('button', { class: 'btn mini', title: 'Remover grade', onclick: () => { frame.layoutGrids.splice(index, 1); commit(true); render(); } }, '×'));
			const typeSel = fillSelect('Tipo', grid, 'type', [['grid', 'Grade'], ['columns', 'Colunas'], ['rows', 'Linhas']], v => { grid.type = v; delete grid.preset; commit(true); render(); });
			const card = [head, h('div', { class: 'row one' }, typeSel), h('div', { class: 'row one' }, gridColorField(grid, index))];
			if (grid.type === 'grid' || grid.preset === 'rows8') { card.push(h('div', { class: 'row one' }, customNum('Tamanho', grid, 'size', { min: 1, def: 8 }))); }
			else {
				card.push(h('div', { class: 'row' }, customNum('Qtd.', grid, 'count', { min: 1, max: 100, def: 12 }), customNum(grid.type === 'rows' ? 'Espaço' : 'Espaço', grid, 'gutter', { min: 0, def: 20 })));
				card.push(h('div', { class: 'row' }, customNum('Margem', grid, 'margin', { min: 0, def: 20 }), customNum('Desloc.', grid, 'offset', { def: 0 })));
				const aligns = grid.type === 'rows' ? [['stretch', 'Esticar'], ['top', 'Topo'], ['center', 'Centro'], ['bottom', 'Base']] : [['stretch', 'Esticar'], ['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']];
				card.push(h('div', { class: 'row' }, fillSelect('Alinhar', grid, 'align', aligns, v => { grid.align = v; commit(true); render(); }), grid.align !== 'stretch' ? customNum(grid.type === 'rows' ? 'Altura' : 'Largura', grid, 'width', { min: 1, def: 80 }) : h('div')));
			}
			rows.push(h('div', { class: 'grid-card' }, ...card));
		}
		const preset = h('select', {}, h('option', { value: '' }, 'Presets…'), h('option', { value: 'grid8' }, 'Grade 8px'), h('option', { value: 'columns' }, '12 colunas'), h('option', { value: 'mobile' }, '4 colunas (mobile)'), h('option', { value: 'rows8' }, 'Linhas 8px'));
		preset.addEventListener('change', () => { const value = preset.value; preset.blur(); if (value) { gridPreset(frame, value); } });
		return section('Grade de layout', ...rows, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => gridPreset(frame, frame.preset === 'mobile' || frame.w <= 480 ? 'mobile' : 'columns') }, '+ Adicionar'), h('div', { class: 'field' }, h('label', {}, 'Preset'), preset)));
	}

	function renderProps(force) {
		// não reconstrói o painel enquanto o aluno digita num campo dele
		if (!force && propsEl.contains(document.activeElement) && !['BUTTON'].includes(document.activeElement.tagName)) { return; }
		const scroll = propsEl.scrollTop;
		propsEl.innerHTML = '';
		const nodes = selected();
		if (!nodes.length) {
			propsEl.append(section('Protótipo',
				h('div', { class: 'empty' }, 'Crie um frame (a "tela") e desenhe dentro dele. Clique numa camada para editar os estilos.'),
				h('div', { class: 'btnrow' },
					h('button', { class: 'btn primary', onclick: () => addFrame('mobile') }, '📱 + Frame Mobile'),
					h('button', { class: 'btn primary', onclick: () => addFrame('desktop') }, '🖥 + Frame Desktop')),
			), section('Atalhos', h('div', { class: 'empty', style: { whiteSpace: 'pre-line' } },
				'V mover · F frame mobile · D frame desktop\nR retângulo · O elipse · L linha · T texto\nDelete apagar · Ctrl+D duplicar\nCtrl+G agrupar · Ctrl+Shift+G desagrupar\nEnter ou duplo clique numa imagem = modo Cortar · arraste para reposicionar; Esc/Enter conclui\nCtrl+Shift+4 ou ▦ Grades = mostrar/ocultar grades\nCtrl+Alt+1 ou ◧ Camadas · Ctrl+Alt+2 ou ◨ Propriedades = ocultar/mostrar cada painel (ou as abinhas nas bordas)\nCtrl+\\ = ocultar/mostrar os dois painéis\nCtrl+Enter ou ▶ Apresentar = só o layout na tela (Esc sai)\nAlt+arrastar = desativar encaixe\nClique duplo num grupo = selecionar dentro dele · Esc = voltar ao grupo\nSetas mover 1px (Shift = 10px)\nCtrl+Z desfazer · Ctrl+Y refazer\nCtrl+roda do mouse = zoom · Espaço+arrastar = mover a tela\nShift+1 ajustar à tela · Duplo clique no texto = editar\nArraste camadas no painel para mudar a ordem ou colocar dentro de frames/grupos\nArraste imagens do Windows Explorer para a tela')));
			return;
		}
		if (nodes.length > 1) {
			propsEl.append(section(`${nodes.length} camadas selecionadas`,
				h('div', { class: 'btnrow' },
					...[['⇤ Esquerda', 'left'], ['↔ Centro', 'hcenter'], ['⇥ Direita', 'right'], ['⤒ Topo', 'top'], ['↕ Meio', 'vcenter'], ['⤓ Base', 'bottom']]
						.map(([t, a]) => h('button', { class: 'btn', onclick: () => align(a) }, t))),
				h('div', { class: 'btnrow' },
					h('button', { class: 'btn primary', onclick: groupSelected, title: 'Ctrl+G' }, '▣ Agrupar'),
					nodes.some(x => x.type === 'group') ? h('button', { class: 'btn', onclick: ungroupSelected, title: 'Ctrl+Shift+G' }, '⊟ Desagrupar') : null,
					h('button', { class: 'btn', onclick: removeSelected }, '🗑 Apagar'))));
			return;
		}
		const n = nodes[0];
		const moveTo = key => v => moveNode(n, key === 'x' ? v - n.x : 0, key === 'y' ? v - n.y : 0);
		const sizeTo = key => v => {
			if (n.type === 'group') { scaleGroup(n, clone(n), n.x, n.y, key === 'w' ? Math.max(1, v) : n.w, key === 'h' ? Math.max(1, v) : n.h); }
			else { n[key] = v; }
		};
		propsEl.append(section(TYPE_NAMES[n.type],
			h('div', { class: 'row one' }, h('div', { class: 'field' }, h('label', {}, 'Nome'), (() => { const i = h('input', { value: n.name }); i.addEventListener('change', () => setProp(n, 'name', i.value.trim() || n.name)); i.addEventListener('keydown', e => e.stopPropagation()); return i; })())),
			h('div', { class: 'row' }, num('X', n, 'x', { apply: moveTo('x') }), num('Y', n, 'y', { apply: moveTo('y') })),
			h('div', { class: 'row' }, num('L', n, 'w', { title: 'Largura', min: n.type === 'line' ? undefined : 1, apply: sizeTo('w') }), num('A', n, 'h', { title: 'Altura', min: n.type === 'line' ? undefined : 1, apply: sizeTo('h') })),
		));
		if (n.type === 'group') {
			let count = 0; walk(() => { count++; }, n.children);
			propsEl.append(section('Grupo',
				h('div', { class: 'empty' }, `${count} camada(s). Clique duplo no grupo (na tela) para selecionar uma camada dentro dele.`),
				h('div', { class: 'btnrow' },
					h('button', { class: 'btn', onclick: ungroupSelected, title: 'Ctrl+Shift+G' }, '⊟ Desagrupar'),
					h('button', { class: 'btn primary', onclick: () => exportFrame(n) }, '⬇ Exportar PNG')),
			));
		}
		if (n.type === 'frame') {
			propsEl.append(section('Frame',
				h('div', { class: 'row one' }, select('Tamanho', n, 'preset', [['mobile', 'Mobile (390 × 844)'], ['desktop', 'Desktop (1440 × 900)'], ['custom', 'Personalizado']])),
				h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: n.clip !== false }); c.addEventListener('change', () => setProp(n, 'clip', c.checked)); return c; })(), 'Cortar o conteúdo que sai do frame'),
				h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: () => exportFrame(n) }, '⬇ Exportar PNG')),
			));
			const sel = propsEl.querySelector('select');
			sel.addEventListener('change', () => { const p = PRESETS[n.preset]; if (p) { n.w = p.w; n.h = p.h; commit(true); render(); } });
			propsEl.append(layoutGridSection(n));
		}
		if (n.type === 'text') {
			const ta = h('textarea', {}, n.text);
			ta.addEventListener('input', () => setProp(n, 'text', ta.value));
			ta.addEventListener('keydown', e => e.stopPropagation());
			propsEl.append(section('Conteúdo', h('div', { class: 'row one' }, h('div', { class: 'field tall' }, ta))));
		}
		const fillSection = fillStackSection(n);
		if (fillSection) { propsEl.append(fillSection); }
		// estilos completos (CSS): aparência, preenchimento, borda, cantos, padding, sombras, contorno, tipografia, filtros, CSS livre
		const refresh = () => { document.activeElement?.blur?.(); renderProps(true); };
		propsEl.append(...DevStyle.panel(n, (obj, key, value) => setProp(obj, key, value), refresh, variableContext(n)));
		propsEl.append(h('div', { class: 'btnrow', style: { paddingTop: '10px' } },
			h('button', { class: 'btn', onclick: duplicateSelected }, '⧉ Duplicar'),
			n.type !== 'frame' ? h('button', { class: 'btn', onclick: groupSelected, title: 'Ctrl+G' }, '▣ Agrupar') : null,
			h('button', { class: 'btn', onclick: removeSelected }, '🗑 Apagar')));
		propsEl.scrollTop = scroll;
	}

	// ------------------------------------------------------------------ operações
	function selectId(id, add) {
		if (add) { selection.has(id) ? selection.delete(id) : selection.add(id); } else { selection = new Set([id]); }
		editingTextId = null;
		render();
	}
	function moveNode(n, dx, dy) {
		n.x = round(n.x + dx); n.y = round(n.y + dy);
		for (const c of n.children || []) { moveNode(c, dx, dy); }
	}
	function frameAt(x, y) {
		for (let i = model.nodes.length - 1; i >= 0; i--) {
			const f = model.nodes[i];
			if (f.type === 'frame' && f.visible !== false && x >= f.x && y >= f.y && x <= f.x + f.w && y <= f.y + f.h) { return f; }
		}
		return null;
	}
	function insert(node, x, y) {
		const frame = node.type === 'frame' ? null : frameAt(x, y);
		(frame ? frame.children : model.nodes).push(node);
		selection = new Set([node.id]);
		return node;
	}
	function addFrame(preset, at) {
		const p = PRESETS[preset];
		let x = at?.x, y = at?.y;
		// não deixa um frame novo nascer em cima de outro: vai para a direita do último
		const overlaps = x !== undefined && model.nodes.some(f => f.type === 'frame' && x < f.x + f.w && x + p.w > f.x && y < f.y + f.h && y + p.h > f.y);
		if (x === undefined || overlaps) {
			const right = model.nodes.filter(n => n.type === 'frame').reduce((m, f) => Math.max(m, f.x + f.w), -100);
			x = right + 100; y = 0;
		}
		const f = { id: uid(), type: 'frame', name: `${nextName('frame').replace('Frame', 'Tela')} (${p.label})`, preset, x: round(x), y: round(y), w: p.w, h: p.h, fill: '#FFFFFF', radius: 0, opacity: 1, visible: true, locked: false, clip: true, children: [] };
		model.nodes.push(f);
		selection = new Set([f.id]);
		commit(true); setTool('select'); render();
		if (!at) { focusNode(f); }
	}
	// ---- imagens: escolhidas no seletor ou soltas na tela (o arquivo já foi copiado para imagens/)
	function naturalSize(url, max) {
		const fallback = { w: 200, h: 150 };
		return new Promise(res => {
			if (!url) { res(fallback); return; }
			const img = new Image();
			const t = setTimeout(() => res(fallback), 3000);
			img.onload = () => {
				clearTimeout(t);
				const w = img.naturalWidth, hh = img.naturalHeight;
				if (!w || !hh) { res(fallback); return; }
				const s = Math.min(1, max / Math.max(w, hh));
				res({ w: Math.max(1, round(w * s)), h: Math.max(1, round(hh * s)) });
			};
			img.onerror = () => { clearTimeout(t); res(fallback); };
			img.src = url;
		});
	}
	async function onImagesAdded(msg) {
		const items = msg.items || [];
		for (const it of items) { if (it.uri) { images[it.src] = it.uri; } }
		if (msg.replace) {
			const n = find(msg.replace)?.node;
			if (n && items[0]) {
				if (msg.fillId) {
					const fills = ensureFills(n);
					const fill = fills.find(f => f.id === msg.fillId);
					if (fill) {
						fill.type = 'image'; fill.image = { ...(fill.image || {}), src: items[0].src };
						if (n.type === 'image') { n.src = items[0].src; }
					}
				} else { n.src = items[0].src; }
				requestImages(); commit(true); render();
			}
			return;
		}
		let at = msg.at;
		if (!at) { const r = stage.getBoundingClientRect(); at = toWorld(r.left + r.width / 2, r.top + r.height / 2); }
		const frame = frameAt(at.x, at.y);
		const max = frame ? Math.max(40, Math.min(400, frame.w * 0.8)) : 400;
		const ids = [];
		for (const [i, it] of items.entries()) {
			const size = await naturalSize(it.uri, max);
			const cx = at.x + i * 24, cy = at.y + i * 24;
			const n = { id: uid(), type: 'image', name: it.src.split('/').pop(), src: it.src, fit: 'cover', x: round(cx - size.w / 2), y: round(cy - size.h / 2), w: size.w, h: size.h, radius: 0, opacity: 1, rotation: 0, visible: true, locked: false };
			insert(n, cx, cy); // dentro do frame sob o ponto, se houver
			ids.push(n.id);
		}
		if (!ids.length) { return; }
		selection = new Set(ids); editingTextId = null;
		setTool('select'); requestImages(); commit(true); render();
	}
	const readBase64 = file => new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
		r.onerror = () => rej(r.error);
		r.readAsDataURL(file);
	});
	let toastTimer;
	function toast(text) {
		stage.querySelector('.toast')?.remove();
		const el = h('div', { class: 'toast' }, text);
		stage.append(el);
		clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3500);
	}
	function removeSelected() {
		for (const id of selection) { const f = find(id); if (f && !f.node.locked) { f.list.splice(f.list.indexOf(f.node), 1); } }
		selection.clear(); commit(true); render();
	}
	function duplicateSelected() {
		const copies = [];
		for (const n of topLevelSelected()) {
			const f = find(n.id);
			const c = clone(n);
			const reid = x => { x.id = uid(); (x.children || []).forEach(reid); };
			reid(c);
			c.name = `${n.name} (cópia)`;
			moveNode(c, n.type === 'frame' ? n.w + 60 : 20, n.type === 'frame' ? 0 : 20);
			f.list.splice(f.list.indexOf(n) + 1, 0, c);
			copies.push(c.id);
		}
		selection = new Set(copies); commit(true); render();
	}
	function align(mode) {
		const nodes = topLevelSelected().filter(n => !n.locked); if (!nodes.length) { return; }
		const b = unionBox(nodes);
		for (const n of nodes) {
			const nb = bbox(n); let dx = 0, dy = 0;
			if (mode === 'left') { dx = b.x - nb.x; } if (mode === 'right') { dx = b.x + b.w - (nb.x + nb.w); } if (mode === 'hcenter') { dx = b.x + b.w / 2 - (nb.x + nb.w / 2); }
			if (mode === 'top') { dy = b.y - nb.y; } if (mode === 'bottom') { dy = b.y + b.h - (nb.y + nb.h); } if (mode === 'vcenter') { dy = b.y + b.h / 2 - (nb.y + nb.h / 2); }
			moveNode(n, dx, dy);
		}
		commit(true); render();
	}
	// ---- grupos
	function groupSelected() {
		if (!model) { return; }
		const nodes = docOrder(topLevelSelected());
		if (!nodes.length) { toast('Selecione as camadas que quer agrupar (Shift+clique ou arraste uma seleção).'); return; }
		if (nodes.some(n => n.type === 'frame')) { toast('Frames não podem ser agrupados. Selecione as camadas dentro (ou fora) dos frames.'); return; }
		// o grupo fica no lugar (lista e posição na pilha) da camada mais acima; as outras vêm para dentro dele
		const top = nodes[nodes.length - 1];
		const tf = find(top.id);
		const g = { id: uid(), type: 'group', name: nextName('group'), x: 0, y: 0, w: 0, h: 0, opacity: 1, visible: true, locked: false, children: [] };
		tf.list.splice(tf.list.indexOf(top), 1, g);
		for (const n of nodes.slice(0, -1)) { const f = find(n.id); f.list.splice(f.list.indexOf(n), 1); }
		g.children = nodes;
		selection = new Set([g.id]); editingTextId = null;
		commit(true); render();
	}
	function ungroupSelected() {
		if (!model) { return; }
		const groups = topLevelSelected().filter(n => n.type === 'group');
		if (!groups.length) { toast('Selecione um grupo para desagrupar.'); return; }
		const ids = [];
		for (const g of groups) {
			const f = find(g.id); if (!f) { continue; }
			const op = g.opacity ?? 1;
			for (const c of g.children) {
				// o que estava no grupo passa para os filhos, para o visual não mudar
				if (op !== 1) { c.opacity = +((c.opacity ?? 1) * op).toFixed(3); }
				if (g.visible === false) { c.visible = false; }
				if (g.locked) { c.locked = true; }
				ids.push(c.id);
			}
			f.list.splice(f.list.indexOf(g), 1, ...g.children);
		}
		selection = new Set(ids); commit(true); render();
	}

	// ------------------------------------------------------------------ zoom
	function zoomAt(factor, cx, cy) {
		const z = Math.min(8, Math.max(0.05, view.zoom * factor));
		const r = stage.getBoundingClientRect();
		const px = cx - r.left, py = cy - r.top;
		view.x = px - (px - view.x) * (z / view.zoom); view.y = py - (py - view.y) * (z / view.zoom);
		view.zoom = z; render();
	}
	function zoomBy(f) { const r = stage.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); }
	function focusBox(b) {
		const r = stage.getBoundingClientRect();
		const z = Math.min(2, Math.max(0.05, Math.min((r.width - 120) / b.w, (r.height - 120) / b.h)));
		view.zoom = z; view.x = (r.width - b.w * z) / 2 - b.x * z; view.y = (r.height - b.h * z) / 2 - b.y * z; render();
	}
	function focusNode(n) { focusBox(bbox(n)); }
	function fitAll() { if (model.nodes.length) { focusBox(unionBox(model.nodes)); } else { render(); } }

	// ------------------------------------------------------------------ mouse
	function bindStage() {
		let drag = null;
		stage.addEventListener('wheel', e => {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) { zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); }
			else { view.x -= e.deltaX; view.y -= e.deltaY; render(); }
		}, { passive: false });

		// arrastar imagens do Windows para a tela: copia para imagens/ e insere no ponto solto
		const hasFiles = e => [...(e.dataTransfer?.types || [])].some(t => t === 'Files' || t === 'text/uri-list');
		stage.addEventListener('dragover', e => { if (!hasFiles(e)) { return; } e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; stage.classList.add('dropping'); });
		stage.addEventListener('dragleave', e => { if (e.target === stage || !stage.contains(e.relatedTarget)) { stage.classList.remove('dropping'); } });
		stage.addEventListener('drop', async e => {
			if (!hasFiles(e)) { return; }
			e.preventDefault(); stage.classList.remove('dropping');
			const at = toWorld(e.clientX, e.clientY);
			const list = [...(e.dataTransfer.files || [])].filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name));
			const uris = list.length ? [] : (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).filter(u => u && !u.startsWith('#'));
			if (!list.length && !uris.length) { toast('Só imagens PNG, JPG, GIF, WEBP ou SVG podem ser soltas aqui.'); return; }
			try {
				const files = await Promise.all(list.map(async f => ({ name: f.name, data: await readBase64(f) })));
				toast('Copiando a imagem para a pasta "imagens"…');
				vscode.postMessage({ type: 'saveImages', files, uris, at });
			} catch (err) { toast(`Não foi possível ler a imagem: ${err.message}`); }
		});

		stage.addEventListener('dblclick', e => {
			const el = e.target.closest('[data-id]');
			if (!el) { return; }
			const n = find(el.dataset.id)?.node;
			// duplo clique num grupo: entra nele e seleciona a camada sob o cursor
			const target = pickTarget(el.dataset.id);
			if (target !== el.dataset.id && find(target)?.node?.type === 'group') {
				const path = pathTo(el.dataset.id);
				const gi = path.findIndex(x => x.id === target);
				selection = new Set([path[gi + 1]?.id || el.dataset.id]); render(); return;
			}
			const imageFill = n && getFills(n).map((f, i) => ({ fill: f, index: i })).find(x => x.fill.type === 'image' && x.fill.visible !== false);
			if (imageFill && !el.dataset.label) { enterCrop(n, imageFill.fill, imageFill.index); return; }
			if (n?.type === 'text' && !n.locked) { editingTextId = n.id; selection = new Set([n.id]); render(); }
			if (n?.type === 'frame' && el.dataset.label) { renamingId = n.id; render(); }
		});

		stage.addEventListener('pointerdown', e => {
			if (editingTextId && !e.target.closest(`[data-id="${editingTextId}"]`)) { finishTextEdit(); }
			if (editingTextId) { return; }
			const w = toWorld(e.clientX, e.clientY);
			if (e.button === 1 || spaceDown) { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; stage.classList.add('panning'); stage.setPointerCapture(e.pointerId); return; }
			if (e.button !== 0) { return; }
			stage.setPointerCapture(e.pointerId);
			if (cropMode) {
				const target = cropTarget();
				const imageHandle = e.target.closest('[data-crop-image-handle]');
				const windowHandle = e.target.closest('[data-crop-window-handle]');
				if (target && imageHandle) { drag = { kind: 'crop-image-resize', handle: imageHandle.dataset.cropImageHandle, nodeId: target.node.id, fillId: target.fill.id, orig: clone(fillImageTransform(target.node, target.fill)), sx: w.x, sy: w.y }; return; }
				if (target && e.target.closest('[data-crop-move]')) { drag = { kind: 'crop-image-move', nodeId: target.node.id, fillId: target.fill.id, orig: clone(fillImageTransform(target.node, target.fill)), sx: w.x, sy: w.y }; return; }
				if (target && windowHandle) { drag = { kind: 'crop-window-resize', handle: windowHandle.dataset.cropWindowHandle, nodeId: target.node.id, fillId: target.fill.id, origNode: clone(target.node), orig: clone(fillImageTransform(target.node, target.fill)), sx: w.x, sy: w.y }; return; }
				if (!e.target.closest('[data-crop-ui]')) { exitCrop(); }
			}

			if (tool === 'frame-mobile' || tool === 'frame-desktop') { addFrame(tool === 'frame-mobile' ? 'mobile' : 'desktop', w); return; }
			if (tool === 'text') {
				const n = { id: uid(), type: 'text', name: nextName('text'), text: 'Texto', x: round(w.x), y: round(w.y), w: 200, h: 40, fontSize: 24, fontWeight: 400, fontFamily: 'Inter', color: '#111111', align: 'left', lineHeight: 1.25, letterSpacing: 0, fill: 'transparent', opacity: 1, rotation: 0, visible: true, locked: false };
				insert(n, w.x, w.y); editingTextId = n.id; setTool('select'); commit(true); render();
				const el = world.querySelector(`[data-id="${n.id}"] .text-content`); if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
				return;
			}
			if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
				const base = { id: uid(), type: tool, name: nextName(tool), x: round(w.x), y: round(w.y), w: 0, h: 0, opacity: 1, rotation: 0, visible: true, locked: false };
				if (tool === 'line') { Object.assign(base, { stroke: '#111111', strokeWidth: 2 }); }
				else { Object.assign(base, { fill: tool === 'rect' ? '#D9D9D9' : '#D10A0A', stroke: '#111111', strokeWidth: 0, radius: 0 }); }
				insert(base, w.x, w.y);
				drag = { kind: 'draw', node: base, sx: w.x, sy: w.y };
				render(); return;
			}

			// ferramenta Mover
			const handle = e.target.closest('[data-handle]');
			if (handle) {
				const n = selected()[0];
				drag = { kind: 'resize', handle: handle.dataset.handle, node: n, orig: clone(n), sx: w.x, sy: w.y };
				return;
			}
			const el = e.target.closest('[data-id]');
			if (el) {
				// clicar num filho de grupo seleciona o grupo (duplo clique "entra" no grupo)
				const id = pickTarget(el.dataset.id);
				const n = find(id)?.node;
				if (!selection.has(id)) { selection = e.shiftKey ? new Set([...selection, id]) : new Set([id]); }
				else if (e.shiftKey) { selection.delete(id); }
				const movable = selected().filter(x => !x.locked);
				drag = { kind: 'move', sx: w.x, sy: w.y, last: { x: w.x, y: w.y }, nodes: movable, moved: false };
				render(); void n; return;
			}
			if (!e.shiftKey) { selection.clear(); }
			drag = { kind: 'marquee', sx: w.x, sy: w.y, base: new Set(selection) };
			render();
		});

		stage.addEventListener('pointermove', e => {
			if (!drag) { return; }
			const w = toWorld(e.clientX, e.clientY);
			if (drag.kind === 'pan') { view.x = drag.vx + (e.clientX - drag.sx); view.y = drag.vy + (e.clientY - drag.sy); render(); return; }
			if (drag.kind === 'crop-image-move' || drag.kind === 'crop-image-resize' || drag.kind === 'crop-window-resize') {
				const n = find(drag.nodeId)?.node, fill = n && getFills(n).find(f => f.id === drag.fillId);
				if (!n || !fill) { return; }
				let transform = clone(drag.orig);
				if (drag.kind === 'crop-image-move') {
					transform.x = round(drag.orig.x + w.x - drag.sx); transform.y = round(drag.orig.y + w.y - drag.sy);
				} else if (drag.kind === 'crop-image-resize') {
					const hd = drag.handle, anchorX = hd.includes('w') ? drag.orig.x + drag.orig.w : drag.orig.x, anchorY = hd.includes('n') ? drag.orig.y + drag.orig.h : drag.orig.y;
					const px = w.x - n.x, py = w.y - n.y;
					const scale = Math.max(Math.abs(anchorX - px) / Math.max(1, drag.orig.w), Math.abs(anchorY - py) / Math.max(1, drag.orig.h), 0.02);
					transform.w = round(Math.max(1, drag.orig.w * scale)); transform.h = round(Math.max(1, drag.orig.h * scale));
					transform.x = round(hd.includes('w') ? anchorX - transform.w : anchorX); transform.y = round(hd.includes('n') ? anchorY - transform.h : anchorY);
				} else {
					const o = drag.origNode, hd = drag.handle, dx = w.x - drag.sx, dy = w.y - drag.sy;
					let x = o.x, y = o.y, W = o.w, H = o.h;
					if (hd.includes('e')) { W = o.w + dx; } if (hd.includes('s')) { H = o.h + dy; }
					if (hd.includes('w')) { W = o.w - dx; x = o.x + dx; } if (hd.includes('n')) { H = o.h - dy; y = o.y + dy; }
					W = Math.max(1, W); H = Math.max(1, H);
					({ x, y, w: W, h: H } = snapBox(n, { x, y, w: W, h: H }, e.altKey));
					Object.assign(n, { x: round(x), y: round(y), w: round(W), h: round(H) });
					transform.x = round(o.x + drag.orig.x - n.x); transform.y = round(o.y + drag.orig.y - n.y);
					if (n.type === 'frame') { n.preset = 'custom'; }
				}
				fill.image.transform = transform; if (n.type === 'image') { n.imageTransform = clone(transform); }
				render(); return;
			}
			if (drag.kind === 'draw') {
				const n = drag.node; let dx = w.x - drag.sx, dy = w.y - drag.sy;
				if (n.type === 'line') {
					if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) { dy = 0; } else { dx = 0; } }
					n.w = round(dx); n.h = round(dy);
				} else {
					if (e.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
					n.x = round(Math.min(drag.sx, drag.sx + dx)); n.y = round(Math.min(drag.sy, drag.sy + dy)); n.w = round(Math.abs(dx)); n.h = round(Math.abs(dy));
				}
				render(); return;
			}
			if (drag.kind === 'move') {
			let dx = w.x - drag.last.x, dy = w.y - drag.last.y;
				if (!drag.moved && Math.hypot(w.x - drag.sx, w.y - drag.sy) * view.zoom < 3) { return; }
				drag.moved = true; drag.last = { x: w.x, y: w.y };
				if (drag.nodes.length) { ({ x: dx, y: dy } = snappedDelta(drag.nodes[0], dx, dy, e.altKey)); }
				for (const n of drag.nodes) { moveNode(n, dx, dy); }
				render(); return;
			}
			if (drag.kind === 'resize') {
				const n = drag.node, o = drag.orig, hd = drag.handle;
				let dx = w.x - drag.sx, dy = w.y - drag.sy;
				let x = o.x, y = o.y, W = o.w, H = o.h;
				if (hd.includes('e')) { W = o.w + dx; } if (hd.includes('s')) { H = o.h + dy; }
				if (hd.includes('w')) { W = o.w - dx; x = o.x + dx; } if (hd.includes('n')) { H = o.h - dy; y = o.y + dy; }
				if (e.shiftKey && o.w && o.h && hd.length === 2) { const r = o.w / o.h; if (Math.abs(W / r) > Math.abs(H)) { H = W / r; } else { W = H * r; } if (hd.includes('n')) { y = o.y + o.h - H; } if (hd.includes('w')) { x = o.x + o.w - W; } }
				if (n.type !== 'line') { if (W < 1) { W = 1; } if (H < 1) { H = 1; } }
				({ x, y, w: W, h: H } = snapBox(n, { x, y, w: W, h: H }, e.altKey));
				Object.assign(n, { x: round(x), y: round(y), w: round(W), h: round(H) });
				if (n.type === 'frame') { n.preset = 'custom'; }
				render(); return;
			}
			if (drag.kind === 'marquee') {
				const x = Math.min(drag.sx, w.x), y = Math.min(drag.sy, w.y), W = Math.abs(w.x - drag.sx), H = Math.abs(w.y - drag.sy);
				selection = new Set(drag.base);
				walk((n, parent) => {
					if (n.visible === false || n.locked) { return; }
					if (parent && selection.has(parent.id)) { return; }
					const b = bbox(n);
					if (b.x >= x && b.y >= y && b.x + b.w <= x + W && b.y + b.h <= y + H) { selection.add(n.id); }
				});
				render();
				const p = toScreen(x, y);
				overlay.append(Object.assign(h('div', { class: 'marquee' }), { style: `left:${p.x}px;top:${p.y}px;width:${W * view.zoom}px;height:${H * view.zoom}px` }));
			}
		});

		const end = () => {
			if (!drag) { return; }
			stage.classList.remove('panning');
			if (drag.kind === 'draw') {
				const n = drag.node;
				if (n.type !== 'line' && (n.w < 3 || n.h < 3)) { n.w = 100; n.h = 100; }
				if (n.type === 'line' && Math.hypot(n.w, n.h) < 3) { n.w = 120; n.h = 0; }
				setTool('select'); commit(true);
			} else if (drag.kind === 'move' && drag.moved) {
				// ao soltar dentro/fora de um frame, a camada passa a pertencer a ele
				for (const n of drag.nodes) { if (n.type !== 'frame') { reparent(n); } }
				commit(true);
			} else if (drag.kind === 'resize' || drag.kind.startsWith('crop-')) { commit(true); }
			drag = null; render();
		};
		stage.addEventListener('pointerup', end);
		stage.addEventListener('pointercancel', end);
	}
	function reparent(n) {
		const b = bbox(n); const target = frameAt(b.x + b.w / 2, b.y + b.h / 2);
		const f = find(n.id); if (!f) { return; }
		const desired = target ? target.children : model.nodes;
		if (f.list === desired) { return; }
		f.list.splice(f.list.indexOf(n), 1); desired.push(n);
	}
	function finishTextEdit() {
		const box = world.querySelector(`[data-id="${editingTextId}"]`);
		const el = box?.querySelector('.text-content');
		const n = find(editingTextId)?.node;
		if (el && n) {
			n.text = el.innerText.replace(/\n$/, '');
			n.w = Math.max(n.w, Math.ceil(box.scrollWidth)); n.h = Math.max(Math.ceil(box.scrollHeight), n.fontSize * (n.lineHeight || 1.25));
			if (!n.text.trim()) { const f = find(n.id); f.list.splice(f.list.indexOf(n), 1); selection.delete(n.id); }
		}
		editingTextId = null; commit(true); render();
	}

	// ------------------------------------------------------------------ teclado
	window.addEventListener('keydown', e => {
		if (e.key === ' ' && !editingTextId && !isTyping(e)) { spaceDown = true; stage?.classList.add('space'); e.preventDefault(); return; }
		if (editingTextId) { if (e.key === 'Escape') { finishTextEdit(); } return; }
		if (isTyping(e) || !model) { return; }
		if (cropMode && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); exitCrop(); return; }
		const ctrl = e.ctrlKey || e.metaKey;
		if (ctrl && e.altKey && (e.code === 'Digit1' || e.code === 'Numpad1')) { e.preventDefault(); toggleSide('left'); return; }
		if (ctrl && e.altKey && (e.code === 'Digit2' || e.code === 'Numpad2')) { e.preventDefault(); toggleSide('right'); return; }
		if (ctrl && (e.key === '\\' || e.code === 'Backslash' || e.code === 'IntlBackslash')) {
			e.preventDefault();
			if (presenting) { setPresent(false); return; }
			const both = !(hideLeft && hideRight);
			hideLeft = both; hideRight = both; saveUi(); applyUiMode(true); return;
		}
		if (ctrl && e.key === 'Enter') { e.preventDefault(); setPresent(!presenting); return; }
		if (presenting && e.key === 'Escape') { e.preventDefault(); setPresent(false); return; }
		if (ctrl && e.shiftKey && (e.code === 'Digit4' || e.key === '$' || e.key === '4')) { e.preventDefault(); toggleGrids(); return; }
		if (ctrl && (e.key === 'z' || e.key === 'y' || e.key === 'Z')) { return; } // desfazer/refazer: o próprio editor faz
		if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) { ungroupSelected(); } else { groupSelected(); } return; }
		if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
		if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selection = new Set(model.nodes.map(n => n.id)); render(); return; }
		if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
		if (e.key === 'Escape') { selection.clear(); setTool('select'); render(); return; }
		if (e.key === 'Enter' && selected().length === 1) {
			const n = selected()[0], image = getFills(n).map((fill, index) => ({ fill, index })).find(x => x.fill.type === 'image' && x.fill.visible !== false);
			if (image) { e.preventDefault(); enterCrop(n, image.fill, image.index); return; }
		}
		if (e.shiftKey && e.key === '!') { fitAll(); return; }
		if (e.key.startsWith('Arrow')) {
			e.preventDefault(); const s = e.shiftKey ? 10 : 1;
			const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
			for (const n of selected()) { if (!n.locked) { moveNode(n, d[0], d[1]); } }
			commit(); render(); return;
		}
		if (e.key === '+' || e.key === '=') { zoomBy(1.2); return; }
		if (e.key === '-') { zoomBy(1 / 1.2); return; }
		if (ctrl || e.altKey) { return; }
		const map = { v: 'select', f: 'frame-mobile', d: 'frame-desktop', r: 'rect', o: 'ellipse', l: 'line', t: 'text' };
		if (map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); }
	});
	window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; stage?.classList.remove('space'); } });
	function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }

	// ------------------------------------------------------------------ exportar PNG (fiel ao CSS)
	async function exportFrame(f) {
		try {
			const el = renderNode(f, f.x, f.y);
			const families = new Set();
			walk(n => { if (n.type === 'text' && n.fontFamily) { families.add(n.fontFamily); } }, f.children || []);
			const data = await DevStyle.exportElement(el, f.w, f.h, [...families]);
			vscode.postMessage({ type: 'exportPng', name: f.name, data });
		} catch (err) { vscode.postMessage({ type: 'error', message: `Não foi possível exportar: ${err.message}` }); }
	}

	document.addEventListener('paste', e => e.preventDefault(), true);
	document.addEventListener('pointerdown', e => { if (cropMode && stage && !stage.contains(e.target)) { exitCrop(); } }, true);
	window.addEventListener('resize', () => render());
	vscode.postMessage({ type: 'ready' });
})();
