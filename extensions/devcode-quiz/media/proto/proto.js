// DEV CODE - Modo Protótipo: editor visual estilo Figma (simplificado, sem IA).
(function () {
	'use strict';
	const vscode = acquireVsCodeApi();
	const PRESETS = { mobile: { w: 390, h: 844, label: 'Mobile' }, desktop: { w: 1440, h: 900, label: 'Desktop' } };
	const FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Impact'];
	const ICONS = { frame: '#', rect: '▭', ellipse: '◯', line: '╱', text: 'T', image: '🖼' };
	const TYPE_NAMES = { frame: 'Frame', rect: 'Retângulo', ellipse: 'Elipse', line: 'Linha', text: 'Texto', image: 'Imagem' };

	let model = null;
	let selection = new Set();
	let tool = 'select';
	let view = { zoom: 0.6, x: 80, y: 60 };
	let images = {};
	let editingTextId = null;
	let renamingId = null;
	let fitted = false;
	let spaceDown = false;
	let commitTimer = null;

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

	// ------------------------------------------------------------------ comunicação
	function commit(immediate) {
		clearTimeout(commitTimer);
		const send = () => vscode.postMessage({ type: 'edit', model });
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
		} else if (msg.type === 'imagePicked') {
			addImage(msg.src);
		}
	});
	function requestImages() {
		const srcs = [];
		walk(n => { if (n.type === 'image' && n.src && !images[n.src]) { srcs.push(n.src); } });
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
			h('button', { class: 'tool', onclick: () => vscode.postMessage({ type: 'pickImage' }), title: 'Inserir imagem da pasta do projeto' }, '🖼 Imagem'),
			h('div', { class: 'spacer' }),
			h('button', { class: 'tool', onclick: () => zoomBy(1 / 1.2), title: 'Diminuir zoom (-)' }, '−'),
			zoomEl = h('div', { class: 'zoom' }),
			h('button', { class: 'tool', onclick: () => zoomBy(1.2), title: 'Aumentar zoom (+)' }, '+'),
			h('button', { class: 'tool', onclick: fitAll, title: 'Ajustar à tela (Shift+1)' }, '⤢ Ajustar'),
		);
		layersEl = h('div', { class: 'panel' });
		stage = h('div', { class: 'stage' });
		world = h('div', { class: 'world' });
		overlay = h('div', { class: 'overlay' });
		hintEl = h('div', { class: 'hint', style: { display: 'none' } });
		stage.append(world, overlay, hintEl);
		propsEl = h('div', { class: 'panel right' });
		app.append(tb, layersEl, stage, propsEl);
		bindStage();
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

	// ------------------------------------------------------------------ desenho do documento
	function nodeStyle(n, offX, offY) {
		const b = bbox(n);
		const s = {
			left: `${b.x - offX}px`, top: `${b.y - offY}px`, width: `${b.w}px`, height: `${b.h}px`,
			opacity: n.opacity ?? 1, transform: n.rotation ? `rotate(${n.rotation}deg)` : '',
			display: n.visible === false ? 'none' : '',
		};
		if (n.shadow?.on) { s.boxShadow = `${n.shadow.x}px ${n.shadow.y}px ${n.shadow.blur}px ${n.shadow.color}`; }
		return s;
	}
	function renderNode(n, offX, offY) {
		const el = h('div', { class: `node ${n.type}`, 'data-id': n.id });
		Object.assign(el.style, nodeStyle(n, offX, offY));
		switch (n.type) {
			case 'frame':
				Object.assign(el.style, { background: n.fill, borderRadius: `${n.radius || 0}px`, overflow: n.clip === false ? 'visible' : 'hidden', boxShadow: '0 1px 3px #0002' });
				for (const c of n.children || []) { el.append(renderNode(c, n.x, n.y)); }
				break;
			case 'rect':
			case 'ellipse':
				Object.assign(el.style, {
					background: n.fill || 'transparent',
					border: n.strokeWidth ? `${n.strokeWidth}px solid ${n.stroke}` : 'none',
					borderRadius: n.type === 'ellipse' ? '50%' : `${n.radius || 0}px`,
				});
				break;
			case 'line': {
				const b = bbox(n);
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				svg.setAttribute('width', b.w); svg.setAttribute('height', b.h); svg.style.overflow = 'visible';
				const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
				ln.setAttribute('x1', n.x - b.x); ln.setAttribute('y1', n.y - b.y);
				ln.setAttribute('x2', n.x + n.w - b.x); ln.setAttribute('y2', n.y + n.h - b.y);
				ln.setAttribute('stroke', n.stroke); ln.setAttribute('stroke-width', n.strokeWidth || 2); ln.setAttribute('stroke-linecap', 'round');
				svg.append(ln); el.append(svg);
				break;
			}
			case 'text':
				Object.assign(el.style, {
					color: n.color, fontSize: `${n.fontSize}px`, fontWeight: n.fontWeight, fontFamily: `'${n.fontFamily}', sans-serif`,
					textAlign: n.align, lineHeight: n.lineHeight || 1.25, letterSpacing: `${n.letterSpacing || 0}px`,
					fontStyle: n.italic ? 'italic' : 'normal', textDecoration: n.underline ? 'underline' : 'none',
					background: n.fill && n.fill !== 'transparent' ? n.fill : '',
				});
				el.textContent = n.text;
				if (editingTextId === n.id) { el.contentEditable = 'true'; }
				break;
			case 'image':
				Object.assign(el.style, { borderRadius: `${n.radius || 0}px`, overflow: 'hidden', background: '#ddd' });
				if (images[n.src]) { const img = h('img', { src: images[n.src], draggable: 'false' }); img.style.objectFit = n.fit || 'cover'; el.append(img); }
				break;
		}
		return el;
	}

	function render() {
		if (!model || !world) { return; }
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
		zoomEl.textContent = `${Math.round(view.zoom * 100)}%`;
		renderOverlay();
		renderLayers();
		renderProps();
		if (editingTextId) {
			const el = world.querySelector(`[data-id="${editingTextId}"]`);
			if (el && document.activeElement !== el) { el.focus(); placeCaretAtEnd(el); }
		}
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
		const nodes = selected();
		if (!nodes.length || editingTextId) { return; }
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
	function renderLayers() {
		layersEl.innerHTML = '';
		layersEl.append(h('h3', {}, 'Camadas'));
		if (!model.nodes.length) { layersEl.append(h('div', { class: 'empty' }, 'Nenhuma camada. Comece criando um Frame Mobile (F) ou Desktop (D).')); return; }
		const addRows = (list, depth, parent) => {
			for (let i = list.length - 1; i >= 0; i--) {
				const n = list[i];
				const row = h('div', {
					class: `layer ${selection.has(n.id) ? 'selected' : ''} ${n.visible === false ? 'hidden' : ''}`,
					style: { paddingLeft: `${8 + depth * 16}px` },
					onclick: e => { selectId(n.id, e.shiftKey); },
					ondblclick: () => { renamingId = n.id; renderLayers(); },
				},
				h('span', { class: 'ico' }, ICONS[n.type]),
				h('span', { class: 'name' }, renamingId === n.id ? renameInput(n) : n.name),
				h('button', { class: 'act', title: 'Mover para cima', onclick: e => { e.stopPropagation(); reorder(n.id, 1); } }, '▲'),
				h('button', { class: 'act', title: 'Mover para baixo', onclick: e => { e.stopPropagation(); reorder(n.id, -1); } }, '▼'),
				h('button', { class: `act ${n.locked ? 'on' : ''}`, title: n.locked ? 'Destravar' : 'Travar', onclick: e => { e.stopPropagation(); n.locked = !n.locked; commit(true); render(); } }, n.locked ? '🔒' : '🔓'),
				h('button', { class: `act ${n.visible === false ? 'on' : ''}`, title: n.visible === false ? 'Mostrar' : 'Ocultar', onclick: e => { e.stopPropagation(); n.visible = n.visible === false; commit(true); render(); } }, n.visible === false ? '🙈' : '👁'),
				);
				layersEl.append(row);
				if (n.children) { addRows(n.children, depth + 1, n); }
			}
		};
		addRows(model.nodes, 0, null);
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
		inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isNaN(v)) { setProp(obj, key, opts.min !== undefined ? Math.max(opts.min, v) : v, opts.after); } });
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
		obj[key] = value;
		if (after) { after(); }
		commit();
		const keepFocus = document.activeElement;
		world.innerHTML = '';
		for (const n of model.nodes) { world.append(renderNode(n, 0, 0)); }
		render();
		if (keepFocus && propsEl.contains(keepFocus) === false && keepFocus.id) { keepFocus.focus(); }
	}
	function section(title, ...rows) { return h('div', { class: 'section' }, h('h3', {}, title), ...rows); }

	function renderProps() {
		// não reconstrói o painel enquanto o aluno digita num campo dele
		if (propsEl.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') { return; }
		propsEl.innerHTML = '';
		const nodes = selected();
		if (!nodes.length) {
			propsEl.append(section('Protótipo',
				h('div', { class: 'empty' }, 'Crie um frame (a "tela") e desenhe dentro dele. Clique numa camada para editar os estilos.'),
				h('div', { class: 'btnrow' },
					h('button', { class: 'btn primary', onclick: () => addFrame('mobile') }, '📱 + Frame Mobile'),
					h('button', { class: 'btn primary', onclick: () => addFrame('desktop') }, '🖥 + Frame Desktop')),
			), section('Atalhos', h('div', { class: 'empty', style: { whiteSpace: 'pre-line' } },
				'V mover · F frame mobile · D frame desktop\nR retângulo · O elipse · L linha · T texto\nDelete apagar · Ctrl+D duplicar\nSetas mover 1px (Shift = 10px)\nCtrl+Z desfazer · Ctrl+Y refazer\nCtrl+roda do mouse = zoom · Espaço+arrastar = mover a tela\nShift+1 ajustar à tela · Duplo clique no texto = editar')));
			return;
		}
		if (nodes.length > 1) {
			propsEl.append(section(`${nodes.length} camadas selecionadas`,
				h('div', { class: 'btnrow' },
					...[['⇤ Esquerda', 'left'], ['↔ Centro', 'hcenter'], ['⇥ Direita', 'right'], ['⤒ Topo', 'top'], ['↕ Meio', 'vcenter'], ['⤓ Base', 'bottom']]
						.map(([t, a]) => h('button', { class: 'btn', onclick: () => align(a) }, t))),
				h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: removeSelected }, '🗑 Apagar'))));
			return;
		}
		const n = nodes[0];
		const geo = section(TYPE_NAMES[n.type],
			h('div', { class: 'row one' }, h('div', { class: 'field' }, h('label', {}, 'Nome'), (() => { const i = h('input', { value: n.name }); i.addEventListener('change', () => setProp(n, 'name', i.value.trim() || n.name)); i.addEventListener('keydown', e => e.stopPropagation()); return i; })())),
			h('div', { class: 'row' }, num('X', n, 'x', { after: () => moveChildrenTo(n) }), num('Y', n, 'y', { after: () => moveChildrenTo(n) })),
			h('div', { class: 'row' }, num('L', n, 'w', { title: 'Largura', min: n.type === 'line' ? undefined : 1 }), num('A', n, 'h', { title: 'Altura', min: n.type === 'line' ? undefined : 1 })),
			n.type !== 'frame' ? h('div', { class: 'row' }, num('↻', n, 'rotation', { title: 'Rotação (graus)' }), num('%', n, 'opacity', { step: 0.05, min: 0, title: 'Opacidade (0 a 1)', after: () => { n.opacity = Math.min(1, n.opacity); } })) : null,
		);
		propsEl.append(geo);
		if (n.type === 'frame') {
			propsEl.append(section('Frame',
				h('div', { class: 'row one' }, select('Tamanho', n, 'preset', [['mobile', 'Mobile (390 × 844)'], ['desktop', 'Desktop (1440 × 900)'], ['custom', 'Personalizado']])),
				h('div', { class: 'row one' }, color('Fundo', n, 'fill')),
				h('div', { class: 'row' }, num('◜', n, 'radius', { min: 0, title: 'Arredondamento dos cantos' })),
				h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: n.clip !== false }); c.addEventListener('change', () => setProp(n, 'clip', c.checked)); return c; })(), 'Cortar o conteúdo que sai do frame'),
				h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: () => exportFrame(n) }, '⬇ Exportar PNG')),
			));
			const sel = propsEl.querySelector('select');
			sel.addEventListener('change', () => { const p = PRESETS[n.preset]; if (p) { n.w = p.w; n.h = p.h; commit(true); render(); } });
		}
		if (n.type === 'rect' || n.type === 'ellipse') {
			propsEl.append(section('Preenchimento', h('div', { class: 'row one' }, color('Cor', n, 'fill'))));
			propsEl.append(section('Borda', h('div', { class: 'row one' }, color('Cor', n, 'stroke')), h('div', { class: 'row' }, num('Esp.', n, 'strokeWidth', { min: 0, title: 'Espessura' }), n.type === 'rect' ? num('◜', n, 'radius', { min: 0, title: 'Arredondamento' }) : null)));
		}
		if (n.type === 'line') {
			propsEl.append(section('Linha', h('div', { class: 'row one' }, color('Cor', n, 'stroke')), h('div', { class: 'row' }, num('Esp.', n, 'strokeWidth', { min: 1 }))));
		}
		if (n.type === 'text') {
			const ta = h('textarea', {}, n.text);
			ta.addEventListener('input', () => setProp(n, 'text', ta.value));
			ta.addEventListener('keydown', e => e.stopPropagation());
			propsEl.append(section('Texto',
				h('div', { class: 'row one' }, h('div', { class: 'field tall' }, ta)),
				h('div', { class: 'row one' }, select('Fonte', n, 'fontFamily', FONTS.map(f => [f, f]))),
				h('div', { class: 'row' }, num('Tam.', n, 'fontSize', { min: 1 }), select('Peso', n, 'fontWeight', [[300, 'Fino'], [400, 'Normal'], [500, 'Médio'], [600, 'Semi'], [700, 'Negrito'], [900, 'Black']])),
				h('div', { class: 'row one' }, color('Cor', n, 'color')),
				h('div', { class: 'row' }, num('↕', n, 'lineHeight', { step: 0.05, min: 0.5, title: 'Altura da linha' }), num('↔', n, 'letterSpacing', { step: 0.1, title: 'Espaçamento entre letras' })),
				h('div', { class: 'btnrow' },
					...[['left', '⇤'], ['center', '↔'], ['right', '⇥'], ['justify', '☰']].map(([a, t]) => h('button', { class: `btn ${n.align === a ? 'on' : ''}`, onclick: () => setProp(n, 'align', a) }, t)),
					h('button', { class: `btn ${n.italic ? 'on' : ''}`, onclick: () => setProp(n, 'italic', !n.italic), style: { fontStyle: 'italic' } }, 'I'),
					h('button', { class: `btn ${n.underline ? 'on' : ''}`, onclick: () => setProp(n, 'underline', !n.underline), style: { textDecoration: 'underline' } }, 'S')),
				h('div', { class: 'row one' }, color('Fundo', n, 'fill')),
			));
		}
		if (n.type === 'image') {
			propsEl.append(section('Imagem',
				h('div', { class: 'row one' }, h('div', { class: 'field' }, h('label', {}, 'Arquivo'), h('input', { value: n.src, disabled: true }))),
				h('div', { class: 'row' }, select('Ajuste', n, 'fit', [['cover', 'Preencher'], ['contain', 'Caber'], ['fill', 'Esticar']]), num('◜', n, 'radius', { min: 0 })),
				h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { replacingImage = n.id; vscode.postMessage({ type: 'pickImage' }); } }, 'Trocar imagem')),
			));
		}
		if (n.type !== 'line' && n.type !== 'frame') {
			n.shadow = n.shadow || { on: false, x: 0, y: 4, blur: 12, color: '#00000033' };
			propsEl.append(section('Sombra',
				h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: !!n.shadow.on }); c.addEventListener('change', () => setProp(n.shadow, 'on', c.checked)); return c; })(), 'Ativar sombra'),
				n.shadow.on ? h('div', { class: 'row three' }, num('X', n.shadow, 'x'), num('Y', n.shadow, 'y'), num('⊙', n.shadow, 'blur', { min: 0, title: 'Desfoque' })) : null,
				n.shadow.on ? h('div', { class: 'row one' }, color('Cor', n.shadow, 'color')) : null,
			));
		}
		propsEl.append(h('div', { class: 'btnrow', style: { paddingTop: '10px' } },
			h('button', { class: 'btn', onclick: duplicateSelected }, '⧉ Duplicar'),
			h('button', { class: 'btn', onclick: removeSelected }, '🗑 Apagar')));
	}
	let replacingImage = null;

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
	let lastFramePos = new Map();
	function moveChildrenTo(frame) {
		if (!frame.children) { return; }
		const prev = lastFramePos.get(frame.id);
		if (prev) { for (const c of frame.children) { moveNode(c, frame.x - prev.x, frame.y - prev.y); } }
		lastFramePos.set(frame.id, { x: frame.x, y: frame.y });
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
	function addImage(src) {
		if (replacingImage) {
			const n = find(replacingImage)?.node; replacingImage = null;
			if (n) { n.src = src; requestImages(); commit(true); render(); }
			return;
		}
		const r = stage.getBoundingClientRect();
		const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
		const n = { id: uid(), type: 'image', name: src.split('/').pop(), src, fit: 'cover', x: round(c.x - 100), y: round(c.y - 75), w: 200, h: 150, radius: 0, opacity: 1, rotation: 0, visible: true, locked: false };
		insert(n, c.x, c.y);
		requestImages(); commit(true); render();
	}
	function removeSelected() {
		for (const id of selection) { const f = find(id); if (f && !f.node.locked) { f.list.splice(f.list.indexOf(f.node), 1); } }
		selection.clear(); commit(true); render();
	}
	function duplicateSelected() {
		const copies = [];
		for (const n of selected()) {
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
		const nodes = selected().filter(n => !n.locked); const b = unionBox(nodes);
		for (const n of nodes) {
			const nb = bbox(n); let dx = 0, dy = 0;
			if (mode === 'left') { dx = b.x - nb.x; } if (mode === 'right') { dx = b.x + b.w - (nb.x + nb.w); } if (mode === 'hcenter') { dx = b.x + b.w / 2 - (nb.x + nb.w / 2); }
			if (mode === 'top') { dy = b.y - nb.y; } if (mode === 'bottom') { dy = b.y + b.h - (nb.y + nb.h); } if (mode === 'vcenter') { dy = b.y + b.h / 2 - (nb.y + nb.h / 2); }
			moveNode(n, dx, dy);
		}
		commit(true); render();
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

		stage.addEventListener('dblclick', e => {
			const el = e.target.closest('[data-id]');
			if (!el) { return; }
			const n = find(el.dataset.id)?.node;
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

			if (tool === 'frame-mobile' || tool === 'frame-desktop') { addFrame(tool === 'frame-mobile' ? 'mobile' : 'desktop', w); return; }
			if (tool === 'text') {
				const n = { id: uid(), type: 'text', name: nextName('text'), text: 'Texto', x: round(w.x), y: round(w.y), w: 200, h: 40, fontSize: 24, fontWeight: 400, fontFamily: 'Segoe UI', color: '#111111', align: 'left', lineHeight: 1.25, letterSpacing: 0, fill: 'transparent', opacity: 1, rotation: 0, visible: true, locked: false };
				insert(n, w.x, w.y); editingTextId = n.id; setTool('select'); commit(true); render();
				const el = world.querySelector(`[data-id="${n.id}"]`); if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
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
				let id = el.dataset.id;
				// clicar num filho seleciona o filho; clicar no fundo do frame seleciona o frame
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
				const dx = w.x - drag.last.x, dy = w.y - drag.last.y;
				if (!drag.moved && Math.hypot(w.x - drag.sx, w.y - drag.sy) * view.zoom < 3) { return; }
				drag.moved = true; drag.last = { x: w.x, y: w.y };
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
			} else if (drag.kind === 'resize') { commit(true); }
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
		const el = world.querySelector(`[data-id="${editingTextId}"]`);
		const n = find(editingTextId)?.node;
		if (el && n) {
			n.text = el.innerText.replace(/\n$/, '');
			n.w = Math.max(n.w, Math.ceil(el.scrollWidth)); n.h = Math.max(Math.ceil(el.scrollHeight), n.fontSize * (n.lineHeight || 1.25));
			if (!n.text.trim()) { const f = find(n.id); f.list.splice(f.list.indexOf(n), 1); selection.delete(n.id); }
		}
		editingTextId = null; commit(true); render();
	}

	// ------------------------------------------------------------------ teclado
	window.addEventListener('keydown', e => {
		if (e.key === ' ' && !editingTextId && !isTyping(e)) { spaceDown = true; stage?.classList.add('space'); e.preventDefault(); return; }
		if (editingTextId) { if (e.key === 'Escape') { finishTextEdit(); } return; }
		if (isTyping(e) || !model) { return; }
		const ctrl = e.ctrlKey || e.metaKey;
		if (ctrl && (e.key === 'z' || e.key === 'y' || e.key === 'Z')) { return; } // desfazer/refazer: o próprio editor faz
		if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
		if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selection = new Set(model.nodes.map(n => n.id)); render(); return; }
		if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
		if (e.key === 'Escape') { selection.clear(); setTool('select'); render(); return; }
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

	// ------------------------------------------------------------------ exportar PNG
	async function loadBitmap(src) {
		const uri = images[src]; if (!uri) { return null; }
		try { const blob = await (await fetch(uri)).blob(); return await createImageBitmap(blob); } catch { return null; }
	}
	function roundRect(ctx, x, y, w, h, r) {
		r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
		ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
	}
	function wrapLines(ctx, text, maxW) {
		const out = [];
		for (const para of String(text).split('\n')) {
			let line = '';
			for (const word of para.split(' ')) {
				const test = line ? `${line} ${word}` : word;
				if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else { line = test; }
			}
			out.push(line);
		}
		return out;
	}
	async function drawNode(ctx, n, ox, oy) {
		if (n.visible === false) { return; }
		const b = bbox(n); const x = b.x - ox, y = b.y - oy;
		ctx.save();
		ctx.globalAlpha *= n.opacity ?? 1;
		if (n.rotation) { ctx.translate(x + b.w / 2, y + b.h / 2); ctx.rotate(n.rotation * Math.PI / 180); ctx.translate(-(x + b.w / 2), -(y + b.h / 2)); }
		if (n.shadow?.on) { ctx.shadowOffsetX = n.shadow.x; ctx.shadowOffsetY = n.shadow.y; ctx.shadowBlur = n.shadow.blur; ctx.shadowColor = n.shadow.color; }
		if (n.type === 'rect' || n.type === 'ellipse') {
			if (n.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + b.w / 2, y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); } else { roundRect(ctx, x, y, b.w, b.h, n.radius); }
			if (n.fill && n.fill !== 'transparent') { ctx.fillStyle = n.fill; ctx.fill(); }
			if (n.strokeWidth) { ctx.shadowColor = 'transparent'; ctx.lineWidth = n.strokeWidth; ctx.strokeStyle = n.stroke; ctx.stroke(); }
		} else if (n.type === 'line') {
			ctx.beginPath(); ctx.moveTo(n.x - ox, n.y - oy); ctx.lineTo(n.x + n.w - ox, n.y + n.h - oy);
			ctx.lineCap = 'round'; ctx.lineWidth = n.strokeWidth || 2; ctx.strokeStyle = n.stroke; ctx.stroke();
		} else if (n.type === 'text') {
			if (n.fill && n.fill !== 'transparent') { ctx.fillStyle = n.fill; ctx.fillRect(x, y, b.w, b.h); }
			ctx.shadowColor = n.shadow?.on ? n.shadow.color : 'transparent';
			ctx.font = `${n.italic ? 'italic ' : ''}${n.fontWeight} ${n.fontSize}px '${n.fontFamily}', sans-serif`;
			ctx.fillStyle = n.color; ctx.textBaseline = 'top';
			const lh = n.fontSize * (n.lineHeight || 1.25);
			const lines = wrapLines(ctx, n.text, b.w);
			lines.forEach((ln, i) => {
				const w = ctx.measureText(ln).width;
				const tx = n.align === 'center' ? x + (b.w - w) / 2 : n.align === 'right' ? x + b.w - w : x;
				ctx.fillText(ln, tx, y + i * lh + (lh - n.fontSize) / 2);
				if (n.underline) { ctx.fillRect(tx, y + i * lh + (lh + n.fontSize) / 2, w, Math.max(1, n.fontSize / 14)); }
			});
		} else if (n.type === 'image') {
			const bmp = await loadBitmap(n.src);
			roundRect(ctx, x, y, b.w, b.h, n.radius); ctx.save(); ctx.clip();
			if (bmp) {
				let dw = b.w, dh = b.h, dx = x, dy = y;
				if (n.fit !== 'fill') {
					const s = (n.fit === 'contain' ? Math.min : Math.max)(b.w / bmp.width, b.h / bmp.height);
					dw = bmp.width * s; dh = bmp.height * s; dx = x + (b.w - dw) / 2; dy = y + (b.h - dh) / 2;
				}
				ctx.drawImage(bmp, dx, dy, dw, dh);
			} else { ctx.fillStyle = '#ddd'; ctx.fillRect(x, y, b.w, b.h); }
			ctx.restore();
		}
		ctx.restore();
	}
	async function exportFrame(f) {
		try {
			const scale = 2;
			const canvas = document.createElement('canvas');
			canvas.width = f.w * scale; canvas.height = f.h * scale;
			const ctx = canvas.getContext('2d');
			ctx.scale(scale, scale);
			roundRect(ctx, 0, 0, f.w, f.h, f.radius); ctx.save(); ctx.clip();
			ctx.fillStyle = f.fill || '#fff'; ctx.fillRect(0, 0, f.w, f.h);
			for (const c of f.children || []) { await drawNode(ctx, c, f.x, f.y); }
			ctx.restore();
			vscode.postMessage({ type: 'exportPng', name: f.name, data: canvas.toDataURL('image/png') });
		} catch (err) { vscode.postMessage({ type: 'error', message: `Não foi possível exportar: ${err.message}` }); }
	}

	window.addEventListener('resize', () => render());
	vscode.postMessage({ type: 'ready' });
})();
