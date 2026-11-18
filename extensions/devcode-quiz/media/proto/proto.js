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
			h('button', { class: 'tool', onclick: () => vscode.postMessage({ type: 'pickImage' }), title: 'Inserir imagem de qualquer pasta (é copiada para a pasta "imagens" do projeto). Também dá para arrastar imagens do Windows para a tela.' }, '🖼 Imagem'),
			h('div', { class: 'sep' }),
			h('button', { class: 'tool', onclick: groupSelected, title: 'Agrupar as camadas selecionadas (Ctrl+G)' }, '▣ Agrupar'),
			h('button', { class: 'tool', onclick: ungroupSelected, title: 'Desagrupar (Ctrl+Shift+G)' }, '⊟ Desagrupar'),
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
		DevStyle.apply(el, n);
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
				ln.setAttribute('stroke', n.stroke); ln.setAttribute('stroke-width', n.strokeWidth || 2); ln.setAttribute('stroke-linecap', 'round');
				if (n.dash) { ln.setAttribute('stroke-dasharray', n.dash); }
				svg.append(ln); el.append(svg);
				break;
			}
			case 'text':
				el.append(h('span', { class: 'text-content', style: { display: 'block', overflow: n.ellipsis ? 'hidden' : '', textOverflow: n.ellipsis ? 'ellipsis' : '', whiteSpace: 'inherit' } }, n.text));
				if (editingTextId === n.id) { el.firstChild.contentEditable = 'true'; }
				break;
			case 'image':
				if (images[n.src]) {
					const img = h('img', { src: images[n.src], draggable: 'false' });
					Object.assign(img.style, { width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
					img.style.objectFit = n.fit || 'cover'; img.style.objectPosition = n.imagePosition || 'center';
					el.append(img);
				} else { el.style.background = el.style.background || '#ddd'; }
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
		zoomEl.textContent = `${Math.round(view.zoom * 100)}%`;
		renderOverlay();
		renderLayers();
		renderProps();
		if (editingTextId) {
			const el = world.querySelector(`[data-id="${editingTextId}"] .text-content`);
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
				'V mover · F frame mobile · D frame desktop\nR retângulo · O elipse · L linha · T texto\nDelete apagar · Ctrl+D duplicar\nCtrl+G agrupar · Ctrl+Shift+G desagrupar\nClique duplo num grupo = selecionar dentro dele · Esc = voltar ao grupo\nSetas mover 1px (Shift = 10px)\nCtrl+Z desfazer · Ctrl+Y refazer\nCtrl+roda do mouse = zoom · Espaço+arrastar = mover a tela\nShift+1 ajustar à tela · Duplo clique no texto = editar\nArraste camadas no painel para mudar a ordem ou colocar dentro de frames/grupos\nArraste imagens do Windows Explorer para a tela')));
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
		}
		if (n.type === 'text') {
			const ta = h('textarea', {}, n.text);
			ta.addEventListener('input', () => setProp(n, 'text', ta.value));
			ta.addEventListener('keydown', e => e.stopPropagation());
			propsEl.append(section('Conteúdo', h('div', { class: 'row one' }, h('div', { class: 'field tall' }, ta))));
		}
		if (n.type === 'image') {
			propsEl.append(section('Imagem',
				h('div', { class: 'row one' }, h('div', { class: 'field' }, h('label', {}, 'Arquivo'), h('input', { value: n.src, disabled: true }))),
				h('div', { class: 'row' }, select('Ajuste', n, 'fit', [['cover', 'Preencher'], ['contain', 'Caber'], ['fill', 'Esticar'], ['none', 'Tamanho original'], ['scale-down', 'Reduzir se precisar']]),
					select('Posição', n, 'imagePosition', [['center', 'Centro'], ['top', 'Topo'], ['bottom', 'Base'], ['left', 'Esquerda'], ['right', 'Direita']])),
				h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => vscode.postMessage({ type: 'pickImage', replace: n.id }) }, 'Trocar imagem')),
			));
		}
		// estilos completos (CSS): aparência, preenchimento, borda, cantos, padding, sombras, contorno, tipografia, filtros, CSS livre
		const refresh = () => { document.activeElement?.blur?.(); renderProps(true); };
		propsEl.append(...DevStyle.panel(n, (obj, key, value) => setProp(obj, key, value), refresh));
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
			if (n && items[0]) { n.src = items[0].src; requestImages(); commit(true); render(); }
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
		const ctrl = e.ctrlKey || e.metaKey;
		if (ctrl && (e.key === 'z' || e.key === 'y' || e.key === 'Z')) { return; } // desfazer/refazer: o próprio editor faz
		if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) { ungroupSelected(); } else { groupSelected(); } return; }
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

	window.addEventListener('resize', () => render());
	vscode.postMessage({ type: 'ready' });
})();
