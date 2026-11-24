// DEV CODE - Editor de diagramas (estilo Microsoft Visio).
// Formas (estênceis) à esquerda, página no centro, propriedades à direita.
// Ligações em ângulo reto que acompanham as formas; texto desenhado em SVG puro (exporta para PNG/SVG).
(() => {
	const vscode = acquireVsCodeApi();
	const NS = 'http://www.w3.org/2000/svg';
	const GRID = 10;
	const app = document.getElementById('app');

	// ------------------------------------------------------------------ estado
	let model; let docName = 'diagrama';
	let pageIndex = 0;
	let selection = new Set();      // ids de formas e ligações
	let view = { x: 40, y: 40, z: 1 };
	let drag;                        // operação de arrastar em andamento
	let hoverShape;                  // forma sob o mouse (mostra os pontos de ligação)
	let editing;                     // edição de texto em andamento
	let clipboard;                   // copiar/colar interno (formas)
	let linkPreset = 'seta';
	let commitTimer;
	let spaceDown = false;

	const page = () => model.pages[pageIndex];
	const uid = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	const snap = v => Math.round(v / GRID) * GRID;
	const byId = id => page().shapes.find(s => s.id === id);
	const linkById = id => page().links.find(l => l.id === id);
	const el = (tag, attrs = {}, parent) => {
		const n = document.createElementNS(NS, tag);
		for (const [k, v] of Object.entries(attrs)) { if (v !== undefined && v !== null) { n.setAttribute(k, v); } }
		if (parent) { parent.appendChild(n); }
		return n;
	};
	const h = (tag, attrs = {}, html) => {
		const n = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) { if (k === 'class') { n.className = v; } else { n.setAttribute(k, v); } }
		if (html !== undefined) { n.innerHTML = html; }
		return n;
	};
	const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

	function commit() {
		clearTimeout(commitTimer);
		commitTimer = setTimeout(() => vscode.postMessage({ type: 'edit', model }), 120);
	}

	// ------------------------------------------------------------------ estênceis
	const FLOW = { fill: '#E8F1FB', stroke: '#2B6CB0' };
	const STENCILS = [
		{
			id: 'fluxo', title: 'Fluxograma', items: [
				{ kind: 'terminal', label: 'Início / Fim', w: 140, h: 50, text: 'Início', fill: '#E3F6E8', stroke: '#2F855A' },
				{ kind: 'process', label: 'Processo', w: 150, h: 70, text: 'Processo', ...FLOW },
				{ kind: 'decision', label: 'Decisão', w: 150, h: 100, text: 'Condição?', fill: '#FFF6DB', stroke: '#B7791F' },
				{ kind: 'io', label: 'Entrada / Saída', w: 160, h: 70, text: 'Ler dados', fill: '#F1E9FB', stroke: '#6B46C1' },
				{ kind: 'document', label: 'Documento', w: 150, h: 80, text: 'Relatório', ...FLOW },
				{ kind: 'subprocess', label: 'Sub-processo', w: 160, h: 70, text: 'Função', ...FLOW },
				{ kind: 'preparation', label: 'Preparação', w: 160, h: 70, text: 'i = 0', ...FLOW },
				{ kind: 'database', label: 'Banco de dados', w: 110, h: 90, text: 'Banco', fill: '#E6FFFA', stroke: '#2C7A7B' },
				{ kind: 'connector', label: 'Conector', w: 50, h: 50, text: 'A', ...FLOW },
			],
		},
		{
			id: 'uml', title: 'Diagrama de Classes (UML)', items: [
				{ kind: 'class', label: 'Classe', w: 200, title: 'Pessoa', attrs: '- nome: String\n- idade: int', methods: '+ getNome(): String\n+ setNome(nome: String): void', fill: '#FFFFFF', stroke: '#2D3748', head: '#FDEBD0' },
				{ kind: 'class', label: 'Interface', w: 200, stereotype: 'interface', title: 'Autenticavel', attrs: '', methods: '+ autenticar(senha: String): boolean', fill: '#FFFFFF', stroke: '#2D3748', head: '#E2F0D9' },
				{ kind: 'class', label: 'Classe abstrata', w: 200, abstract: true, title: 'Animal', attrs: '# nome: String', methods: '+ emitirSom(): void', fill: '#FFFFFF', stroke: '#2D3748', head: '#DDEBF7' },
				{ kind: 'class', label: 'Enum', w: 160, stereotype: 'enumeration', title: 'Status', attrs: 'ATIVO\nINATIVO', methods: '', fill: '#FFFFFF', stroke: '#2D3748', head: '#FCE4EC' },
				{ kind: 'package', label: 'Pacote', w: 220, h: 150, text: 'modelo', fill: '#F7FAFC', stroke: '#4A5568' },
				{ kind: 'note', label: 'Nota', w: 160, h: 80, text: 'Observação', fill: '#FFF9C4', stroke: '#C9A400' },
			],
		},
		{
			id: 'banco', title: 'Banco de Dados (DER)', items: [
				{ kind: 'table', label: 'Tabela', w: 220, title: 'cliente', rows: 'id INT PK\nnome VARCHAR(100)\nemail VARCHAR(150)\ncidade_id INT FK', fill: '#FFFFFF', stroke: '#2C5282', head: '#2C5282' },
				{ kind: 'entity', label: 'Entidade', w: 140, h: 60, text: 'Cliente', fill: '#EBF8FF', stroke: '#2C5282' },
				{ kind: 'relationship', label: 'Relacionamento', w: 140, h: 80, text: 'compra', fill: '#FFF5F5', stroke: '#C53030' },
				{ kind: 'attribute', label: 'Atributo', w: 120, h: 50, text: 'nome', fill: '#FFFFFF', stroke: '#2C5282' },
				{ kind: 'attribute', label: 'Atributo chave', w: 120, h: 50, text: 'id', key: true, fill: '#FFFFFF', stroke: '#2C5282' },
				{ kind: 'entity', label: 'Entidade fraca', w: 140, h: 60, text: 'Dependente', weak: true, fill: '#EBF8FF', stroke: '#2C5282' },
			],
		},
		{
			id: 'caso', title: 'Casos de Uso', items: [
				{ kind: 'actor', label: 'Ator', w: 60, h: 110, text: 'Usuário', fill: '#FFFFFF', stroke: '#2D3748' },
				{ kind: 'usecase', label: 'Caso de uso', w: 170, h: 70, text: 'Fazer login', fill: '#F0FFF4', stroke: '#2F855A' },
				{ kind: 'boundary', label: 'Sistema', w: 300, h: 340, text: 'Sistema', fill: '#FFFFFF', stroke: '#4A5568' },
			],
		},
		{
			id: 'basico', title: 'Formas básicas', items: [
				{ kind: 'rect', label: 'Retângulo', w: 140, h: 80, text: '', fill: '#FFFFFF', stroke: '#2D3748' },
				{ kind: 'rounded', label: 'Arredondado', w: 140, h: 80, text: '', fill: '#FFFFFF', stroke: '#2D3748' },
				{ kind: 'ellipse', label: 'Elipse', w: 120, h: 80, text: '', fill: '#FFFFFF', stroke: '#2D3748' },
				{ kind: 'triangle', label: 'Triângulo', w: 110, h: 90, text: '', fill: '#FFFFFF', stroke: '#2D3748' },
				{ kind: 'hexagon', label: 'Hexágono', w: 130, h: 80, text: '', fill: '#FFFFFF', stroke: '#2D3748' },
				{ kind: 'text', label: 'Texto', w: 160, h: 40, text: 'Texto', fill: 'none', stroke: 'none' },
			],
		},
	];

	const LINK_PRESETS = {
		seta: { label: 'Seta', start: 'none', end: 'arrow', dash: false },
		linha: { label: 'Linha', start: 'none', end: 'none', dash: false },
		tracejada: { label: 'Seta tracejada', start: 'none', end: 'arrow', dash: true },
		associacao: { label: 'Associação', start: 'none', end: 'open', dash: false, group: 'UML' },
		heranca: { label: 'Herança', start: 'none', end: 'triangle', dash: false, group: 'UML' },
		implementacao: { label: 'Implementação', start: 'none', end: 'triangle', dash: true, group: 'UML' },
		dependencia: { label: 'Dependência', start: 'none', end: 'open', dash: true, group: 'UML' },
		agregacao: { label: 'Agregação', start: 'diamond', end: 'none', dash: false, group: 'UML' },
		composicao: { label: 'Composição', start: 'diamondFilled', end: 'none', dash: false, group: 'UML' },
		um_um: { label: '1 : 1', start: 'one', end: 'one', dash: false, group: 'Banco' },
		um_n: { label: '1 : N', start: 'one', end: 'many', dash: false, group: 'Banco' },
		n_n: { label: 'N : N', start: 'many', end: 'many', dash: false, group: 'Banco' },
		zero_n: { label: '0 : N', start: 'one', end: 'zeroMany', dash: false, group: 'Banco' },
	};
	const MARKERS = [['none', 'Nenhuma'], ['arrow', 'Seta cheia'], ['open', 'Seta aberta'], ['triangle', 'Triângulo (herança)'], ['diamond', 'Losango vazio'], ['diamondFilled', 'Losango cheio'], ['one', 'Um (‖)'], ['zeroOne', 'Zero ou um (o|)'], ['many', 'Um ou muitos (|<)'], ['zeroMany', 'Zero ou muitos (o<)']];
	const SWATCHES = ['#FFFFFF', '#E8F1FB', '#E3F6E8', '#FFF6DB', '#F1E9FB', '#FFF5F5', '#E6FFFA', '#FFF9C4', '#EDF2F7', '#FDEBD0', '#2B6CB0', '#2F855A', '#B7791F', '#C53030', '#6B46C1', '#2D3748', 'none'];

	// ------------------------------------------------------------------ medidas de texto
	const measureCtx = document.createElement('canvas').getContext('2d');
	const FONT = 'Segoe UI, Arial, sans-serif';
	function textWidth(t, size, bold, italic) {
		measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${FONT}`;
		return measureCtx.measureText(t).width;
	}
	function wrap(text, maxW, size, bold) {
		const out = [];
		for (const para of String(text ?? '').split('\n')) {
			let line = '';
			for (const word of para.split(/\s+/)) {
				if (!word) { continue; }
				const tryLine = line ? `${line} ${word}` : word;
				if (line && textWidth(tryLine, size, bold) > maxW) { out.push(line); line = word; } else { line = tryLine; }
			}
			out.push(line);
		}
		return out;
	}

	// ------------------------------------------------------------------ geometria das formas
	const LINE_H = 18;
	function classLayout(s) {
		const header = (s.stereotype ? 16 : 0) + 30;
		const attrs = s.attrs ? s.attrs.split('\n') : [];
		const methods = s.methods ? s.methods.split('\n') : [];
		const attrH = Math.max(1, attrs.length) * LINE_H + 10;
		const methH = s.kind === 'class' && s.stereotype === 'enumeration' && !methods.length ? 0 : Math.max(1, methods.length) * LINE_H + 10;
		return { header, attrs, methods, attrH, methH, h: header + attrH + methH };
	}
	function tableLayout(s) {
		const rows = (s.rows || '').split('\n').filter(r => r.trim()).map(r => {
			const parts = r.trim().split(/\s+/);
			const flags = parts.filter(p => /^(PK|FK|UK|NN)$/i.test(p)).map(p => p.toUpperCase());
			const rest = parts.filter(p => !/^(PK|FK|UK|NN)$/i.test(p));
			return { name: rest[0] || '', type: rest.slice(1).join(' '), flags };
		});
		return { rows, header: 32, h: 32 + Math.max(1, rows.length) * 22 + 8 };
	}
	/** Altura real (classe e tabela crescem sozinhas conforme as linhas). */
	function shapeH(s) {
		if (s.kind === 'class') { return classLayout(s).h; }
		if (s.kind === 'table') { return tableLayout(s).h; }
		return s.h;
	}
	const box = s => ({ x: s.x, y: s.y, w: s.w, h: shapeH(s) });

	/** Ponto de ligação de um lado da forma. */
	function anchor(s, side) {
		const b = box(s);
		switch (side) {
			case 'top': return { x: b.x + b.w / 2, y: b.y };
			case 'bottom': return { x: b.x + b.w / 2, y: b.y + b.h };
			case 'left': return { x: b.x, y: b.y + b.h / 2 };
			default: return { x: b.x + b.w, y: b.y + b.h / 2 };
		}
	}
	const NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
	function autoSides(a, b) {
		const A = box(a), B = box(b);
		const dx = (B.x + B.w / 2) - (A.x + A.w / 2), dy = (B.y + B.h / 2) - (A.y + A.h / 2);
		// quando há espaço vertical entre as formas, ligar por cima/baixo (fluxograma); senão pelos lados
		const vGap = dy > 0 ? B.y - (A.y + A.h) : A.y - (B.y + B.h);
		const hGap = dx > 0 ? B.x - (A.x + A.w) : A.x - (B.x + B.w);
		if (vGap > 20 && vGap >= hGap) { return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']; }
		if (hGap > 20) { return dx > 0 ? ['right', 'left'] : ['left', 'right']; }
		return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']);
	}
	/** Pontos da ligação (ortogonal "cotovelo" ou reta). */
	function linkPoints(l, overrideTo) {
		const a = byId(l.from); const b = overrideTo ? null : byId(l.to);
		if (!a || (!b && !overrideTo)) { return null; }
		let sa, sb;
		if (b) { [sa, sb] = autoSides(a, b); } else { sa = 'right'; sb = 'left'; }
		if (l.fromSide && l.fromSide !== 'auto') { sa = l.fromSide; }
		if (b && l.toSide && l.toSide !== 'auto') { sb = l.toSide; }
		const p0 = anchor(a, sa);
		const p3 = b ? anchor(b, sb) : overrideTo;
		if (l.route === 'straight' || !b) {
			if (!b) { const best = nearestSide(a, overrideTo); return [anchor(a, best), p3]; }
			return [p0, p3];
		}
		// formas quase alinhadas: linha reta em vez de um "degrau" de poucos pixels
		const vA = sa === 'top' || sa === 'bottom', vB = sb === 'top' || sb === 'bottom';
		if (vA && vB && Math.abs(p0.x - p3.x) < 12 && (sa === 'bottom') === (p3.y > p0.y)) { return [p0, { x: p0.x, y: p3.y }]; }
		if (!vA && !vB && Math.abs(p0.y - p3.y) < 12 && (sa === 'right') === (p3.x > p0.x)) { return [p0, { x: p3.x, y: p0.y }]; }
		const off = 22;
		const p1 = { x: p0.x + NORMAL[sa][0] * off, y: p0.y + NORMAL[sa][1] * off };
		const p2 = { x: p3.x + NORMAL[sb][0] * off, y: p3.y + NORMAL[sb][1] * off };
		const hA = sa === 'left' || sa === 'right', hB = sb === 'left' || sb === 'right';
		let mid;
		if (hA && hB) { const mx = (p1.x + p2.x) / 2; mid = [{ x: mx, y: p1.y }, { x: mx, y: p2.y }]; }
		else if (!hA && !hB) { const my = (p1.y + p2.y) / 2; mid = [{ x: p1.x, y: my }, { x: p2.x, y: my }]; }
		else if (hA) { mid = [{ x: p2.x, y: p1.y }]; }
		else { mid = [{ x: p1.x, y: p2.y }]; }
		return simplify([p0, p1, ...mid, p2, p3]);
	}
	function nearestSide(s, p) {
		let best = 'right', d = Infinity;
		for (const side of ['top', 'bottom', 'left', 'right']) { const q = anchor(s, side); const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < d) { d = dd; best = side; } }
		return best;
	}
	function simplify(pts) {
		const out = [];
		for (const p of pts) {
			const last = out[out.length - 1];
			if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) { continue; }
			out.push(p);
			while (out.length >= 3) {
				const [a, b, c] = out.slice(-3);
				const col = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
				if (col) { out.splice(out.length - 2, 1); } else { break; }
			}
		}
		return out;
	}
	function midOf(pts) {
		let total = 0; const segs = [];
		for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(d); total += d; }
		let half = total / 2;
		for (let i = 1; i < pts.length; i++) {
			if (half <= segs[i - 1]) { const t = segs[i - 1] ? half / segs[i - 1] : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; }
			half -= segs[i - 1];
		}
		return pts[0];
	}

	// ------------------------------------------------------------------ desenho das formas (SVG)
	function textBlock(g, lines, cx, cy, size, color, opts = {}) {
		const total = lines.length * size * 1.25;
		let y = cy - total / 2 + size * 0.95;
		for (const line of lines) {
			const t = el('text', { x: cx, y, 'font-size': size, 'font-family': FONT, fill: color, 'text-anchor': opts.anchor || 'middle', 'font-weight': opts.bold ? 'bold' : undefined, 'font-style': opts.italic ? 'italic' : undefined, 'text-decoration': opts.underline ? 'underline' : undefined }, g);
			t.textContent = line;
			if (opts.underline) { const w = textWidth(line, size, opts.bold); el('line', { x1: cx - w / 2, x2: cx + w / 2, y1: y + 3, y2: y + 3, stroke: color, 'stroke-width': 1 }, g); }
			y += size * 1.25;
		}
	}

	function drawShape(s, parent) {
		const g = el('g', { 'data-id': s.id, class: 'shape' }, parent);
		const b = box(s);
		const { x, y, w } = b; const hh = b.h;
		const fill = s.fill ?? '#FFFFFF', stroke = s.stroke ?? '#2D3748', sw = s.strokeWidth ?? 1.6;
		const color = s.color || '#1A202C', size = s.fontSize || 14;
		const base = { fill, stroke, 'stroke-width': sw, 'stroke-dasharray': s.dash ? '6 4' : undefined };
		const pts = arr => arr.map(p => p.join(',')).join(' ');
		let textArea = { x: x + 8, y: y + 4, w: w - 16, h: hh - 8 };
		switch (s.kind) {
			case 'terminal': el('rect', { x, y, width: w, height: hh, rx: hh / 2, ...base }, g); textArea = { x: x + hh / 3, y, w: w - hh / 1.5, h: hh }; break;
			case 'process': case 'rect': case 'entity':
				el('rect', { x, y, width: w, height: hh, rx: s.kind === 'process' ? 3 : 0, ...base }, g);
				if (s.weak) { el('rect', { x: x + 5, y: y + 5, width: w - 10, height: hh - 10, fill: 'none', stroke, 'stroke-width': sw }, g); }
				break;
			case 'rounded': el('rect', { x, y, width: w, height: hh, rx: 14, ...base }, g); break;
			case 'decision': case 'relationship':
				el('polygon', { points: pts([[x + w / 2, y], [x + w, y + hh / 2], [x + w / 2, y + hh], [x, y + hh / 2]]), ...base }, g);
				textArea = { x: x + w / 4, y: y + hh / 4, w: w / 2, h: hh / 2 }; break;
			case 'io': { const k = Math.min(24, w / 5); el('polygon', { points: pts([[x + k, y], [x + w, y], [x + w - k, y + hh], [x, y + hh]]), ...base }, g); textArea = { x: x + k, y, w: w - 2 * k, h: hh }; break; }
			case 'document': { const wv = Math.min(14, hh / 5); el('path', { d: `M${x},${y} H${x + w} V${y + hh - wv} C${x + w * 0.75},${y + hh - wv * 2.4} ${x + w * 0.25},${y + hh + wv * 0.6} ${x},${y + hh - wv} Z`, ...base }, g); textArea = { x: x + 8, y, w: w - 16, h: hh - wv }; break; }
			case 'subprocess': el('rect', { x, y, width: w, height: hh, ...base }, g); el('line', { x1: x + 12, x2: x + 12, y1: y, y2: y + hh, stroke, 'stroke-width': sw }, g); el('line', { x1: x + w - 12, x2: x + w - 12, y1: y, y2: y + hh, stroke, 'stroke-width': sw }, g); textArea = { x: x + 16, y, w: w - 32, h: hh }; break;
			case 'preparation': case 'hexagon': { const k = Math.min(26, w / 4); el('polygon', { points: pts([[x + k, y], [x + w - k, y], [x + w, y + hh / 2], [x + w - k, y + hh], [x + k, y + hh], [x, y + hh / 2]]), ...base }, g); textArea = { x: x + k, y, w: w - 2 * k, h: hh }; break; }
			case 'database': { const ry = Math.min(14, hh / 6); el('path', { d: `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} V${y + hh - ry} A${w / 2},${ry} 0 0 1 ${x},${y + hh - ry} Z`, ...base }, g); el('path', { d: `M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`, fill: 'none', stroke, 'stroke-width': sw }, g); textArea = { x: x + 6, y: y + ry * 2, w: w - 12, h: hh - ry * 3 }; break; }
			case 'connector': case 'ellipse': case 'usecase': case 'attribute': el('ellipse', { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2, ...base }, g); textArea = { x: x + w * 0.15, y: y + hh * 0.15, w: w * 0.7, h: hh * 0.7 }; break;
			case 'triangle': el('polygon', { points: pts([[x + w / 2, y], [x + w, y + hh], [x, y + hh]]), ...base }, g); textArea = { x: x + w / 4, y: y + hh / 2, w: w / 2, h: hh / 2 }; break;
			case 'note': { const f = 14; el('path', { d: `M${x},${y} H${x + w - f} L${x + w},${y + f} V${y + hh} H${x} Z`, ...base }, g); el('path', { d: `M${x + w - f},${y} V${y + f} H${x + w}`, fill: 'none', stroke, 'stroke-width': sw }, g); break; }
			case 'text': el('rect', { x, y, width: w, height: hh, fill: 'transparent', stroke: 'none' }, g); break;
			case 'package': el('rect', { x, y, width: Math.min(90, w * 0.45), height: 22, ...base }, g); el('rect', { x, y: y + 22, width: w, height: hh - 22, ...base }, g); textArea = { x: x + 6, y: y + 2, w: Math.min(90, w * 0.45) - 12, h: 20, top: true }; break;
			case 'boundary': el('rect', { x, y, width: w, height: hh, ...base }, g); textArea = { x: x + 8, y: y + 6, w: w - 16, h: 24, top: true }; break;
			case 'actor': {
				const cx = x + w / 2, r = Math.min(w, hh) * 0.16, body = hh - 30;
				el('circle', { cx, cy: y + r + 1, r, fill, stroke, 'stroke-width': sw }, g);
				el('path', { d: `M${cx},${y + 2 * r + 1} V${y + body * 0.62} M${x + 4},${y + body * 0.36} H${x + w - 4} M${cx},${y + body * 0.62} L${x + 6},${y + body} M${cx},${y + body * 0.62} L${x + w - 6},${y + body}`, fill: 'none', stroke, 'stroke-width': sw + 0.4, 'stroke-linecap': 'round' }, g);
				el('rect', { x, y, width: w, height: hh, fill: 'transparent', stroke: 'none' }, g);
				textArea = { x: x - 40, y: y + body + 2, w: w + 80, h: 26 }; break;
			}
			case 'class': return drawClass(s, g, b), g;
			case 'table': return drawTable(s, g, b), g;
		}
		if (s.text) {
			const lines = wrap(s.text, Math.max(20, textArea.w), size, s.bold);
			const cy = textArea.top ? textArea.y + (lines.length * size * 1.25) / 2 : textArea.y + textArea.h / 2;
			textBlock(g, lines, textArea.x + textArea.w / 2, cy, size, color, { bold: s.bold || s.kind === 'terminal' || s.kind === 'boundary' || s.kind === 'package', italic: s.italic, underline: s.key });
		}
		return g;
	}

	function drawClass(s, g, b) {
		const L = classLayout(s); const { x, y, w } = b;
		const stroke = s.stroke ?? '#2D3748', sw = s.strokeWidth ?? 1.6, size = s.fontSize || 13;
		el('rect', { x, y, width: w, height: L.h, fill: s.fill ?? '#fff', stroke, 'stroke-width': sw, rx: 2 }, g);
		el('rect', { x, y, width: w, height: L.header, fill: s.head || '#FDEBD0', stroke, 'stroke-width': sw, rx: 2 }, g);
		let ty = y + 8;
		if (s.stereotype) { const t = el('text', { x: x + w / 2, y: ty + 10, 'font-size': 11, 'font-family': FONT, 'text-anchor': 'middle', fill: '#4A5568' }, g); t.textContent = `«${s.stereotype}»`; ty += 16; }
		const tt = el('text', { x: x + w / 2, y: ty + 14, 'font-size': size + 1, 'font-family': FONT, 'text-anchor': 'middle', 'font-weight': 'bold', 'font-style': s.abstract ? 'italic' : undefined, fill: s.color || '#1A202C' }, g);
		tt.textContent = s.title || 'Classe';
		let yy = y + L.header;
		for (const line of L.attrs) { const t = el('text', { x: x + 8, y: yy + 5 + LINE_H * 0.8, 'font-size': size, 'font-family': FONT, fill: s.color || '#1A202C' }, g); t.textContent = line; yy += LINE_H; }
		yy = y + L.header + L.attrH;
		if (L.methH) {
			el('line', { x1: x, x2: x + w, y1: yy, y2: yy, stroke, 'stroke-width': sw }, g);
			for (const line of L.methods) { const t = el('text', { x: x + 8, y: yy + 5 + LINE_H * 0.8, 'font-size': size, 'font-family': FONT, fill: s.color || '#1A202C' }, g); t.textContent = line; yy += LINE_H; }
		}
		el('line', { x1: x, x2: x + w, y1: y + L.header, y2: y + L.header, stroke, 'stroke-width': sw }, g);
	}

	function drawTable(s, g, b) {
		const L = tableLayout(s); const { x, y, w } = b;
		const stroke = s.stroke ?? '#2C5282', sw = s.strokeWidth ?? 1.6, size = s.fontSize || 13, head = s.head || '#2C5282';
		el('rect', { x, y, width: w, height: L.h, fill: s.fill ?? '#fff', stroke, 'stroke-width': sw, rx: 4 }, g);
		el('path', { d: `M${x},${y + L.header} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + w - 4} Q${x + w},${y} ${x + w},${y + 4} V${y + L.header} Z`, fill: head, stroke, 'stroke-width': sw }, g);
		const tt = el('text', { x: x + w / 2, y: y + 21, 'font-size': size + 1, 'font-family': FONT, 'text-anchor': 'middle', 'font-weight': 'bold', fill: '#fff' }, g);
		tt.textContent = s.title || 'tabela';
		let yy = y + L.header + 4;
		for (const r of L.rows) {
			const isPk = r.flags.includes('PK'), isFk = r.flags.includes('FK');
			if (r.flags.length) {
				const badge = r.flags.filter(f => f === 'PK' || f === 'FK').join(',') || r.flags[0];
				const bt = el('text', { x: x + 8, y: yy + 15, 'font-size': 10, 'font-family': FONT, 'font-weight': 'bold', fill: isPk ? '#B7791F' : isFk ? '#2B6CB0' : '#718096' }, g); bt.textContent = badge;
			}
			const nt = el('text', { x: x + 44, y: yy + 15, 'font-size': size, 'font-family': FONT, 'font-weight': isPk ? 'bold' : undefined, 'text-decoration': isPk ? 'underline' : undefined, fill: s.color || '#1A202C' }, g); nt.textContent = r.name;
			const ty = el('text', { x: x + w - 8, y: yy + 15, 'font-size': size - 1, 'font-family': FONT, 'text-anchor': 'end', fill: '#718096' }, g); ty.textContent = r.type;
			yy += 22;
		}
	}

	// ------------------------------------------------------------------ desenho das ligações
	function drawMarker(g, kind, p, from, stroke, sw) {
		if (!kind || kind === 'none') { return; }
		const ang = Math.atan2(p.y - from.y, p.x - from.x) * 180 / Math.PI;
		const m = el('g', { transform: `translate(${p.x},${p.y}) rotate(${ang})` }, g);
		const line = { fill: 'none', stroke, 'stroke-width': sw, 'stroke-linejoin': 'round' };
		switch (kind) {
			case 'arrow': el('path', { d: 'M0,0 L-12,-6 L-12,6 Z', fill: stroke, stroke, 'stroke-width': 1 }, m); break;
			case 'open': el('path', { d: 'M-12,-6 L0,0 L-12,6', ...line }, m); break;
			case 'triangle': el('path', { d: 'M0,0 L-15,-9 L-15,9 Z', fill: '#fff', stroke, 'stroke-width': sw }, m); break;
			case 'diamond': el('path', { d: 'M0,0 L-10,-6 L-20,0 L-10,6 Z', fill: '#fff', stroke, 'stroke-width': sw }, m); break;
			case 'diamondFilled': el('path', { d: 'M0,0 L-10,-6 L-20,0 L-10,6 Z', fill: stroke, stroke, 'stroke-width': sw }, m); break;
			case 'one': el('path', { d: 'M-8,-7 V7 M-14,-7 V7', ...line }, m); break;
			case 'zeroOne': el('path', { d: 'M-8,-7 V7', ...line }, m); el('circle', { cx: -18, cy: 0, r: 5, fill: '#fff', stroke, 'stroke-width': sw }, m); break;
			case 'many': el('path', { d: 'M0,-8 L-12,0 L0,8 M-14,-7 V7', ...line }, m); break;
			case 'zeroMany': el('path', { d: 'M0,-8 L-12,0 L0,8', ...line }, m); el('circle', { cx: -18, cy: 0, r: 5, fill: '#fff', stroke, 'stroke-width': sw }, m); break;
		}
	}
	function trimFor(kind) { return { arrow: 11, triangle: 14, diamond: 19, diamondFilled: 19 }[kind] || 0; }

	function drawLink(l, parent) {
		const pts = linkPoints(l);
		if (!pts || pts.length < 2) { return; }
		const g = el('g', { 'data-link': l.id, class: 'link' }, parent);
		const stroke = l.stroke || '#2D3748', sw = l.strokeWidth || 1.6;
		// recua a linha para a ponta de seta não ficar coberta
		const draw = pts.map(p => ({ ...p }));
		const cut = (i, j, d) => { const a = draw[i], b = draw[j]; const len = Math.hypot(a.x - b.x, a.y - b.y) || 1; const t = Math.min(d, len - 1) / len; a.x += (b.x - a.x) * t; a.y += (b.y - a.y) * t; };
		if (trimFor(l.end)) { cut(draw.length - 1, draw.length - 2, trimFor(l.end)); }
		if (trimFor(l.start)) { cut(0, 1, trimFor(l.start)); }
		const d = 'M' + draw.map(p => `${p.x},${p.y}`).join(' L');
		el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 12, class: 'hit' }, g);
		el('path', { d, fill: 'none', stroke, 'stroke-width': sw, 'stroke-dasharray': l.dash ? '7 5' : undefined, 'stroke-linejoin': 'round' }, g);
		drawMarker(g, l.end, pts[pts.length - 1], pts[pts.length - 2], stroke, sw);
		drawMarker(g, l.start, pts[0], pts[1], stroke, sw);
		const label = (txt, p, dx, dy, anchorTxt) => {
			if (!txt) { return; }
			const t = el('text', { x: p.x + dx, y: p.y + dy, 'font-size': 12, 'font-family': FONT, fill: l.color || '#1A202C', 'text-anchor': anchorTxt || 'middle', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 4, 'stroke-linejoin': 'round' }, g);
			t.textContent = txt;
		};
		if (l.text) { const m = midOf(pts); label(l.text, m, 0, 4); }
		const endLabel = (txt, p, q) => { if (!txt) { return; } const horiz = Math.abs(p.y - q.y) < 1; label(txt, p, horiz ? (q.x > p.x ? 14 : -14) : 10, horiz ? -8 : (q.y > p.y ? 22 : -12), horiz ? (q.x > p.x ? 'start' : 'end') : 'start'); };
		endLabel(l.startText, pts[0], pts[1]);
		endLabel(l.endText, pts[pts.length - 1], pts[pts.length - 2]);
		return g;
	}

	// ------------------------------------------------------------------ interface
	app.innerHTML = `
		<div class="toolbar">
			<span class="brand">DEV <span>CODE</span> <small>Diagramas</small></span>
			<span class="sep"></span>
			<label class="tb-label" title="Tipo de ligação usado ao puxar de um ponto azul">Ligação:</label>
			<select id="linkPreset" class="tb-select"></select>
			<span class="sep"></span>
			<button class="tool" data-cmd="dup" title="Duplicar (Ctrl+D)">⧉ Duplicar</button>
			<button class="tool" data-cmd="del" title="Excluir (Delete)">🗑 Excluir</button>
			<button class="tool" data-cmd="front" title="Trazer para frente">⬆ Frente</button>
			<button class="tool" data-cmd="back" title="Enviar para trás">⬇ Trás</button>
			<span class="sep"></span>
			<button class="tool" data-cmd="alignL" title="Alinhar à esquerda">⇤</button>
			<button class="tool" data-cmd="alignC" title="Centralizar">↔</button>
			<button class="tool" data-cmd="alignT" title="Alinhar no topo">⤒</button>
			<button class="tool" data-cmd="alignM" title="Alinhar ao meio">↕</button>
			<span class="spacer"></span>
			<button class="tool" data-cmd="zoomOut" title="Diminuir zoom (-)">−</button>
			<span class="zoom" id="zoomLabel">100%</span>
			<button class="tool" data-cmd="zoomIn" title="Aumentar zoom (+)">+</button>
			<button class="tool" data-cmd="fit" title="Ver tudo (Shift+1)">⛶ Ajustar</button>
			<span class="sep"></span>
			<button class="tool primary" data-cmd="png" title="Exportar a página como imagem PNG">⤓ PNG</button>
			<button class="tool" data-cmd="svg" title="Exportar a página como SVG">⤓ SVG</button>
		</div>
		<div class="panel left">
			<input id="search" class="search" placeholder="🔍 Procurar formas">
			<div id="stencils"></div>
			<div class="help">
				<b>Como usar</b>
				<p>1. Arraste uma forma para a página.</p>
				<p>2. Passe o mouse na forma e puxe um <span class="dot"></span> azul até outra forma para ligar.</p>
				<p>3. Dê dois cliques para escrever.</p>
			</div>
		</div>
		<div class="stage" id="stage">
			<svg id="svg" xmlns="${NS}"><g id="world"><rect id="paper"></rect><g id="grid"></g><g id="links"></g><g id="shapes"></g><g id="overlay"></g></g></svg>
			<div class="empty" id="empty"><div class="big">🧩</div><b>Página vazia</b><span>Arraste formas da esquerda para começar o seu diagrama.</span></div>
		</div>
		<div class="panel right" id="props"></div>
		<div class="pages" id="pages"></div>
		<div class="ctx" id="ctx" hidden></div>
	`;
	const svg = document.getElementById('svg'), world = document.getElementById('world');
	const gLinks = document.getElementById('links'), gShapes = document.getElementById('shapes'), gOverlay = document.getElementById('overlay');
	const stage = document.getElementById('stage');
	const props = document.getElementById('props');

	// lista de tipos de ligação
	(() => {
		const sel = document.getElementById('linkPreset');
		let html = ''; let group = '';
		for (const [k, p] of Object.entries(LINK_PRESETS)) {
			if ((p.group || '') !== group) { if (group) { html += '</optgroup>'; } group = p.group || ''; if (group) { html += `<optgroup label="${group}">`; } }
			html += `<option value="${k}">${p.label}</option>`;
		}
		sel.innerHTML = html + (group ? '</optgroup>' : '');
		sel.addEventListener('change', () => { linkPreset = sel.value; });
	})();

	// miniaturas dos estênceis (mesmo desenho das formas)
	function stencilThumb(item) {
		const s = { id: 'thumb', x: 0, y: 0, h: 60, ...item };
		const bw = s.w, bh = shapeH(s);
		const svgT = document.createElementNS(NS, 'svg');
		svgT.setAttribute('viewBox', `-4 -4 ${bw + 8} ${bh + 8}`);
		svgT.setAttribute('class', 'thumb');
		drawShape({ ...s, text: s.kind === 'actor' ? '' : s.text, fontSize: s.kind === 'class' || s.kind === 'table' ? 13 : 16 }, svgT);
		return svgT;
	}
	function renderStencils(filter = '') {
		const root = document.getElementById('stencils'); root.innerHTML = '';
		const q = filter.trim().toLowerCase();
		for (const cat of STENCILS) {
			const items = cat.items.filter(i => !q || (i.label + ' ' + cat.title).toLowerCase().includes(q));
			if (!items.length) { continue; }
			const sec = h('details', { class: 'cat', open: '' });
			sec.appendChild(h('summary', {}, esc(cat.title)));
			const grid = h('div', { class: 'grid' });
			for (const item of items) {
				const b = h('div', { class: 'stencil', draggable: 'false', title: `Arraste para a página: ${item.label}` });
				b.appendChild(stencilThumb(item));
				b.appendChild(h('span', {}, esc(item.label)));
				b.addEventListener('pointerdown', e => startStencilDrag(e, item));
				b.addEventListener('dblclick', () => addShape(item));
				grid.appendChild(b);
			}
			sec.appendChild(grid);
			root.appendChild(sec);
		}
	}
	document.getElementById('search').addEventListener('input', e => renderStencils(e.target.value));

	// ------------------------------------------------------------------ coordenadas
	function toWorld(cx, cy) {
		const r = svg.getBoundingClientRect();
		return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
	}
	function applyView() {
		world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.z})`);
		document.getElementById('zoomLabel').textContent = `${Math.round(view.z * 100)}%`;
		stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
		stage.style.backgroundSize = `${GRID * view.z * 2}px ${GRID * view.z * 2}px`;
	}
	function zoomAt(f, cx, cy) {
		const r = svg.getBoundingClientRect();
		const z = Math.min(4, Math.max(0.2, view.z * f));
		const px = cx - r.left, py = cy - r.top;
		view.x = px - (px - view.x) * (z / view.z); view.y = py - (py - view.y) * (z / view.z); view.z = z;
		applyView(); renderOverlay();
	}
	function bounds(shapes) {
		if (!shapes.length) { return null; }
		let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
		for (const s of shapes) { const b = box(s); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h + (s.kind === 'actor' ? 26 : 0)); }
		return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
	}
	function fitAll() {
		const b = bounds(page().shapes); const r = svg.getBoundingClientRect();
		if (!b) { view = { x: 40, y: 40, z: 1 }; applyView(); return; }
		const z = Math.min(1.5, Math.max(0.2, Math.min((r.width - 80) / b.w, (r.height - 80) / b.h)));
		view = { z, x: (r.width - b.w * z) / 2 - b.x * z, y: (r.height - b.h * z) / 2 - b.y * z };
		applyView(); renderOverlay();
	}

	// ------------------------------------------------------------------ render
	function render() {
		if (!model) { return; }
		gLinks.innerHTML = ''; gShapes.innerHTML = '';
		for (const s of page().shapes) { drawShape(s, gShapes); }
		for (const l of page().links) { drawLink(l, gLinks); }
		document.getElementById('empty').style.display = page().shapes.length ? 'none' : '';
		renderOverlay(); renderProps(); renderPages();
	}
	function renderOverlay() {
		gOverlay.innerHTML = '';
		if (!model) { return; }
		const z = view.z;
		for (const id of selection) {
			const s = byId(id);
			if (s) {
				const b = box(s);
				el('rect', { x: b.x - 3 / z, y: b.y - 3 / z, width: b.w + 6 / z, height: b.h + 6 / z, class: 'sel-box', 'stroke-width': 1.5 / z }, gOverlay);
				if (selection.size === 1) {
					const fixedH = s.kind === 'class' || s.kind === 'table';
					const handles = fixedH ? [['e', b.x + b.w, b.y + b.h / 2], ['w', b.x, b.y + b.h / 2]] : [['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y], ['e', b.x + b.w, b.y + b.h / 2], ['se', b.x + b.w, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['sw', b.x, b.y + b.h], ['w', b.x, b.y + b.h / 2]];
					for (const [dir, hx, hy] of handles) { el('rect', { x: hx - 4 / z, y: hy - 4 / z, width: 8 / z, height: 8 / z, class: 'handle', 'data-handle': dir, 'stroke-width': 1 / z, style: `cursor:${dir}-resize` }, gOverlay); }
				}
			}
			const l = linkById(id);
			if (l) {
				const pts = linkPoints(l);
				if (pts) {
					el('path', { d: 'M' + pts.map(p => `${p.x},${p.y}`).join(' L'), class: 'sel-link', 'stroke-width': 4 / z }, gOverlay);
					for (const [end, p] of [['from', pts[0]], ['to', pts[pts.length - 1]]]) { el('circle', { cx: p.x, cy: p.y, r: 5 / z, class: 'link-end', 'data-end': end, 'stroke-width': 1.5 / z }, gOverlay); }
				}
			}
		}
		// pontos azuis de ligação na forma sob o mouse
		const target = hoverShape && byId(hoverShape);
		if (target && !(drag && drag.type === 'move')) {
			for (const side of ['top', 'right', 'bottom', 'left']) {
				const p = anchor(target, side);
				el('circle', { cx: p.x, cy: p.y, r: 6 / z, class: 'port', 'data-port': side, 'data-shape': target.id, 'stroke-width': 1.5 / z }, gOverlay);
			}
		}
		if (drag?.type === 'link' && drag.pts) {
			el('path', { d: 'M' + drag.pts.map(p => `${p.x},${p.y}`).join(' L'), class: 'ghost-link', 'stroke-width': 2 / z }, gOverlay);
			if (drag.over) { const b = box(byId(drag.over)); el('rect', { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, class: 'drop-target', 'stroke-width': 2 / z }, gOverlay); }
		}
		if (drag?.type === 'marquee') {
			const r = drag.rect; el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'marquee', 'stroke-width': 1 / z }, gOverlay);
		}
		for (const g of drag?.guides || []) { el('line', { ...g, class: 'guide', 'stroke-width': 1 / z }, gOverlay); }
	}

	function renderPages() {
		const bar = document.getElementById('pages');
		bar.innerHTML = '';
		model.pages.forEach((p, i) => {
			const t = h('button', { class: `page-tab${i === pageIndex ? ' on' : ''}`, title: 'Clique para abrir · dois cliques para renomear' }, esc(p.name));
			t.addEventListener('click', () => { if (pageIndex !== i) { pageIndex = i; selection.clear(); render(); fitAll(); } });
			t.addEventListener('dblclick', () => renamePage(i));
			t.addEventListener('contextmenu', e => { e.preventDefault(); showMenu(e.clientX, e.clientY, [['Renomear página', () => renamePage(i)], ['Duplicar página', () => duplicatePage(i)], model.pages.length > 1 ? ['Excluir página', () => deletePage(i)] : null]); });
			bar.appendChild(t);
		});
		const add = h('button', { class: 'page-add', title: 'Nova página' }, '＋ Página');
		add.addEventListener('click', () => { model.pages.push({ id: uid('p'), name: `Página ${model.pages.length + 1}`, shapes: [], links: [] }); pageIndex = model.pages.length - 1; selection.clear(); commit(); render(); });
		bar.appendChild(add);
	}
	function renamePage(i) {
		const tab = document.getElementById('pages').children[i];
		const inp = h('input', { class: 'page-input', value: model.pages[i].name });
		tab.replaceWith(inp); inp.focus(); inp.select();
		const done = ok => { if (ok && inp.value.trim()) { model.pages[i].name = inp.value.trim(); commit(); } renderPages(); };
		inp.addEventListener('keydown', e => { if (e.key === 'Enter') { done(true); } if (e.key === 'Escape') { done(false); } e.stopPropagation(); });
		inp.addEventListener('blur', () => done(true));
	}
	function duplicatePage(i) {
		const copy = JSON.parse(JSON.stringify(model.pages[i])); copy.id = uid('p'); copy.name += ' (cópia)';
		const map = {};
		for (const s of copy.shapes) { const n = uid('s'); map[s.id] = n; s.id = n; }
		for (const l of copy.links) { l.id = uid('l'); l.from = map[l.from]; l.to = map[l.to]; }
		model.pages.splice(i + 1, 0, copy); pageIndex = i + 1; commit(); render();
	}
	let confirmSeq = 0; const confirms = {};
	function ask(message, button) { const id = ++confirmSeq; vscode.postMessage({ type: 'confirm', id, message, button }); return new Promise(r => { confirms[id] = r; }); }
	async function deletePage(i) {
		if (model.pages[i].shapes.length && !await ask(`Excluir a página "${model.pages[i].name}" e tudo que está nela?`, 'Excluir')) { return; }
		model.pages.splice(i, 1); pageIndex = Math.min(pageIndex, model.pages.length - 1); selection.clear(); commit(); render();
	}

	// ------------------------------------------------------------------ propriedades
	function renderProps() {
		const sel = [...selection];
		const shapes = sel.map(byId).filter(Boolean), links = sel.map(linkById).filter(Boolean);
		if (editing) { return; }
		if (!shapes.length && !links.length) {
			props.innerHTML = `<h3>Página</h3>
				<label>Nome<input data-page="name" value="${esc(page().name)}"></label>
				<p class="muted">${page().shapes.length} forma(s), ${page().links.length} ligação(ões).</p>
				<h3>Atalhos</h3>
				<ul class="keys"><li><kbd>Dois cliques</kbd> escrever texto</li><li><kbd>Ctrl+D</kbd> duplicar</li><li><kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copiar formas</li><li><kbd>Delete</kbd> excluir</li><li><kbd>Ctrl+Z</kbd> desfazer</li><li><kbd>Setas</kbd> mover (Shift = 10)</li><li><kbd>Ctrl+roda</kbd> zoom</li><li><kbd>Espaço+arrastar</kbd> mover a página</li><li><kbd>Ctrl+A</kbd> selecionar tudo</li></ul>`;
			props.querySelector('[data-page]').addEventListener('input', e => { page().name = e.target.value; commit(); renderPages(); });
			return;
		}
		let html = '';
		if (shapes.length === 1) {
			const s = shapes[0];
			if (s.kind === 'class') {
				html += `<h3>Classe</h3>
					<label>Nome<input data-f="title" value="${esc(s.title)}"></label>
					<label>Estereótipo<select data-f="stereotype"><option value="">(nenhum)</option>${['interface', 'enumeration', 'abstract'].map(o => `<option ${s.stereotype === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
					<label class="check"><input type="checkbox" data-f="abstract" ${s.abstract ? 'checked' : ''}> Abstrata (nome em itálico)</label>
					<label>Atributos <small>um por linha · + público, - privado, # protegido</small><textarea data-f="attrs" rows="5" spellcheck="false">${esc(s.attrs)}</textarea></label>
					<label>Métodos <small>um por linha</small><textarea data-f="methods" rows="5" spellcheck="false">${esc(s.methods)}</textarea></label>
					<div class="row2"><label>Cabeçalho${colorInput('head', s.head)}</label></div>`;
			} else if (s.kind === 'table') {
				html += `<h3>Tabela</h3>
					<label>Nome da tabela<input data-f="title" value="${esc(s.title)}"></label>
					<label>Colunas <small>uma por linha: <b>nome TIPO PK/FK</b></small><textarea data-f="rows" rows="9" spellcheck="false">${esc(s.rows)}</textarea></label>
					<p class="muted">Exemplo: <code>id INT PK</code>, <code>cliente_id INT FK</code>. Ligue as tabelas com <b>1 : N</b> na barra de cima.</p>
					<div class="row2"><label>Cabeçalho${colorInput('head', s.head)}</label></div>`;
			} else {
				html += `<h3>Texto</h3><label><textarea data-f="text" rows="3">${esc(s.text)}</textarea></label>`;
			}
		}
		if (shapes.length) {
			const s = shapes[0];
			html += `<h3>Aparência</h3>
				<div class="label">Preenchimento</div>${swatches('fill', s.fill)}
				<div class="label">Borda</div>${swatches('stroke', s.stroke)}
				<div class="row2">
					<label>Espessura<select data-f="strokeWidth">${[1, 1.6, 2.5, 4].map(v => `<option value="${v}" ${(s.strokeWidth ?? 1.6) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
					<label>Tamanho do texto<select data-f="fontSize">${[11, 12, 13, 14, 16, 18, 22, 28].map(v => `<option ${(s.fontSize || (s.kind === 'class' || s.kind === 'table' ? 13 : 14)) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
				</div>
				<div class="row2"><label>Cor do texto${colorInput('color', s.color || '#1A202C')}</label>
				<label class="check"><input type="checkbox" data-f="bold" ${s.bold ? 'checked' : ''}> Negrito</label></div>
				<label class="check"><input type="checkbox" data-f="dash" ${s.dash ? 'checked' : ''}> Borda tracejada</label>`;
			if (shapes.length === 1) {
				const b = box(s);
				html += `<h3>Posição</h3><div class="row4"><label>X<input type="number" data-f="x" value="${Math.round(b.x)}"></label><label>Y<input type="number" data-f="y" value="${Math.round(b.y)}"></label><label>L<input type="number" data-f="w" value="${Math.round(b.w)}"></label>${s.kind === 'class' || s.kind === 'table' ? '' : `<label>A<input type="number" data-f="h" value="${Math.round(b.h)}"></label>`}</div>`;
			} else {
				html += `<p class="muted">${shapes.length} formas selecionadas: as mudanças valem para todas.</p>`;
			}
		}
		if (links.length) {
			const l = links[0];
			html += `<h3>Ligação</h3>
				<label>Tipo<select data-l="preset"><option value="">(personalizado)</option>${Object.entries(LINK_PRESETS).map(([k, p]) => `<option value="${k}" ${matchesPreset(l) === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
				<label>Texto no meio<input data-l="text" value="${esc(l.text)}" placeholder="ex.: Sim / Não"></label>
				<div class="row2"><label>Texto no início<input data-l="startText" value="${esc(l.startText)}" placeholder="ex.: 1"></label><label>Texto no fim<input data-l="endText" value="${esc(l.endText)}" placeholder="ex.: *"></label></div>
				<div class="row2"><label>Ponta inicial<select data-l="start">${MARKERS.map(([k, t]) => `<option value="${k}" ${(l.start || 'none') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
				<label>Ponta final<select data-l="end">${MARKERS.map(([k, t]) => `<option value="${k}" ${(l.end || 'none') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
				<div class="row2"><label>Traçado<select data-l="route"><option value="ortho" ${l.route !== 'straight' ? 'selected' : ''}>Em ângulo reto</option><option value="straight" ${l.route === 'straight' ? 'selected' : ''}>Reta</option></select></label>
				<label class="check"><input type="checkbox" data-l="dash" ${l.dash ? 'checked' : ''}> Tracejada</label></div>
				<div class="row2"><label>Sai por<select data-l="fromSide">${sideOptions(l.fromSide)}</select></label><label>Chega por<select data-l="toSide">${sideOptions(l.toSide)}</select></label></div>
				<div class="label">Cor</div>${swatches('lstroke', l.stroke || '#2D3748')}
				<button class="btn sec" data-cmd="swap">⇄ Inverter direção</button>`;
		}
		html += `<button class="btn danger" data-cmd="del">🗑 Excluir selecionado(s)</button>`;
		props.innerHTML = html;
	}
	const sideOptions = v => [['auto', 'Automático'], ['top', 'Cima'], ['right', 'Direita'], ['bottom', 'Baixo'], ['left', 'Esquerda']].map(([k, t]) => `<option value="${k}" ${(v || 'auto') === k ? 'selected' : ''}>${t}</option>`).join('');
	const colorInput = (f, v) => `<input type="color" data-f="${f}" value="${/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000'}">`;
	function swatches(f, cur) {
		return `<div class="swatches">${SWATCHES.map(c => `<button class="sw${(cur || '').toLowerCase() === c.toLowerCase() ? ' on' : ''}${c === 'none' ? ' none' : ''}" data-sw="${f}" data-color="${c}" title="${c === 'none' ? 'Sem cor' : c}" style="${c === 'none' ? '' : `background:${c}`}"></button>`).join('')}<input type="color" data-sw-custom="${f}" value="${/^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#ffffff'}" title="Outra cor"></div>`;
	}
	function matchesPreset(l) {
		for (const [k, p] of Object.entries(LINK_PRESETS)) { if ((l.start || 'none') === p.start && (l.end || 'none') === p.end && !!l.dash === p.dash) { return k; } }
		return '';
	}
	function selectedShapes() { return [...selection].map(byId).filter(Boolean); }
	function selectedLinks() { return [...selection].map(linkById).filter(Boolean); }

	function onPropInput(e) {
		const t = e.target;
		if (t.dataset.f) {
			const f = t.dataset.f;
			for (const s of selectedShapes()) {
				let v = t.type === 'checkbox' ? t.checked : t.value;
				if (['x', 'y', 'w', 'h', 'fontSize', 'strokeWidth'].includes(f)) { v = Number(v); if (!Number.isFinite(v)) { continue; } if ((f === 'w' || f === 'h') && v < 20) { v = 20; } }
				if (f === 'stereotype' && v === 'abstract') { s.abstract = true; }
				s[f] = v === '' && f === 'stereotype' ? undefined : v;
			}
			commit(); redrawKeepProps();
		} else if (t.dataset.l) {
			const f = t.dataset.l;
			for (const l of selectedLinks()) {
				if (f === 'preset') { const p = LINK_PRESETS[t.value]; if (p) { l.start = p.start; l.end = p.end; l.dash = p.dash; } }
				else if (f === 'dash') { l.dash = t.checked; }
				else { l[f] = t.value; }
			}
			commit(); if (f === 'preset' || e.type === 'change') { render(); } else { redrawKeepProps(); }
		} else if (t.dataset.swCustom) {
			setColor(t.dataset.swCustom, t.value);
		}
	}
	function redrawKeepProps() {
		gLinks.innerHTML = ''; gShapes.innerHTML = '';
		for (const s of page().shapes) { drawShape(s, gShapes); }
		for (const l of page().links) { drawLink(l, gLinks); }
		renderOverlay();
	}
	function setColor(f, c) {
		if (f === 'lstroke') { for (const l of selectedLinks()) { l.stroke = c; } }
		else { for (const s of selectedShapes()) { s[f] = c; } }
		commit(); render();
	}
	props.addEventListener('input', e => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') { onPropInput(e); } });
	props.addEventListener('change', e => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') { onPropInput(e); } else if (e.target.dataset.swCustom || e.target.type === 'color') { render(); } });
	props.addEventListener('click', e => {
		const sw = e.target.closest('[data-sw]'); if (sw) { setColor(sw.dataset.sw, sw.dataset.color); return; }
		const c = e.target.closest('[data-cmd]'); if (c) { command(c.dataset.cmd); }
	});

	// ------------------------------------------------------------------ comandos
	function command(cmd) {
		const shapes = selectedShapes();
		switch (cmd) {
			case 'del': removeSelected(); break;
			case 'dup': duplicateSelected(); break;
			case 'front': case 'back': {
				const ids = new Set(shapes.map(s => s.id));
				const rest = page().shapes.filter(s => !ids.has(s.id));
				page().shapes = cmd === 'front' ? [...rest, ...shapes] : [...shapes, ...rest];
				commit(); render(); break;
			}
			case 'alignL': case 'alignC': case 'alignT': case 'alignM': {
				if (shapes.length < 2) { break; }
				const b = bounds(shapes);
				for (const s of shapes) {
					const sb = box(s);
					if (cmd === 'alignL') { s.x = b.x; }
					if (cmd === 'alignC') { s.x = snap(b.x + b.w / 2 - sb.w / 2); }
					if (cmd === 'alignT') { s.y = b.y; }
					if (cmd === 'alignM') { s.y = snap(b.y + b.h / 2 - sb.h / 2); }
				}
				commit(); render(); break;
			}
			case 'swap': for (const l of selectedLinks()) { [l.from, l.to] = [l.to, l.from]; [l.start, l.end] = [l.end, l.start]; [l.startText, l.endText] = [l.endText, l.startText]; [l.fromSide, l.toSide] = [l.toSide, l.fromSide]; } commit(); render(); break;
			case 'zoomIn': { const r = svg.getBoundingClientRect(); zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); break; }
			case 'zoomOut': { const r = svg.getBoundingClientRect(); zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); break; }
			case 'fit': fitAll(); break;
			case 'png': exportPage('png'); break;
			case 'svg': exportPage('svg'); break;
		}
	}
	document.querySelector('.toolbar').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) { command(b.dataset.cmd); } });

	function addShape(item, at) {
		const r = svg.getBoundingClientRect();
		const c = at || toWorld(r.left + r.width / 2, r.top + r.height / 2);
		const { label, ...props0 } = item;
		const s = { id: uid('s'), ...JSON.parse(JSON.stringify(props0)), h: item.h || 60 };
		s.x = snap(c.x - s.w / 2); s.y = snap(c.y - shapeH(s) / 2);
		page().shapes.push(s);
		selection = new Set([s.id]);
		commit(); render();
		return s;
	}
	function removeSelected() {
		if (!selection.size) { return; }
		page().shapes = page().shapes.filter(s => !selection.has(s.id));
		const alive = new Set(page().shapes.map(s => s.id));
		page().links = page().links.filter(l => !selection.has(l.id) && alive.has(l.from) && alive.has(l.to));
		selection.clear(); commit(); render();
	}
	function copySelected() {
		const shapes = selectedShapes(); if (!shapes.length) { return false; }
		const ids = new Set(shapes.map(s => s.id));
		clipboard = { shapes: JSON.parse(JSON.stringify(shapes)), links: JSON.parse(JSON.stringify(page().links.filter(l => ids.has(l.from) && ids.has(l.to)))) };
		return true;
	}
	function pasteClipboard(offset = 20) {
		if (!clipboard) { return; }
		const map = {}; const newSel = new Set();
		for (const s of clipboard.shapes) { const n = { ...JSON.parse(JSON.stringify(s)), id: uid('s') }; map[s.id] = n.id; n.x += offset; n.y += offset; page().shapes.push(n); newSel.add(n.id); }
		for (const l of clipboard.links) { page().links.push({ ...JSON.parse(JSON.stringify(l)), id: uid('l'), from: map[l.from], to: map[l.to] }); }
		for (const s of clipboard.shapes) { s.x += offset; s.y += offset; }
		selection = newSel; commit(); render();
	}
	function duplicateSelected() { const saved = clipboard; if (copySelected()) { pasteClipboard(); } clipboard = saved; }

	// ------------------------------------------------------------------ arrastar do estêncil
	function startStencilDrag(e, item) {
		e.preventDefault();
		const ghost = h('div', { class: 'drag-ghost' });
		ghost.appendChild(stencilThumb(item));
		document.body.appendChild(ghost);
		const move = ev => { ghost.style.left = `${ev.clientX - 30}px`; ghost.style.top = `${ev.clientY - 30}px`; };
		move(e);
		const up = ev => {
			window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ghost.remove();
			const r = svg.getBoundingClientRect();
			if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { addShape(item, toWorld(ev.clientX, ev.clientY)); }
		};
		window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
	}

	// ------------------------------------------------------------------ mouse na página
	function shapeAt(p, except) {
		const list = page().shapes;
		for (let i = list.length - 1; i >= 0; i--) {
			const s = list[i]; if (s.id === except) { continue; }
			const b = box(s);
			// contêineres (sistema, pacote) só pela borda/título, para não cobrir o que está dentro
			if (s.kind === 'boundary' || s.kind === 'package') {
				const inside = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
				const edge = inside && (p.y <= b.y + 30 || p.x <= b.x + 8 || p.x >= b.x + b.w - 8 || p.y >= b.y + b.h - 8);
				if (edge) { return s; } continue;
			}
			if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h + (s.kind === 'actor' ? 26 : 0)) { return s; }
		}
		return null;
	}

	svg.addEventListener('pointerdown', e => {
		hideMenu();
		if (editing) { finishEdit(true); }
		const p = toWorld(e.clientX, e.clientY);
		if (e.button === 1 || spaceDown) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; svg.setPointerCapture(e.pointerId); stage.classList.add('panning'); return; }
		if (e.button !== 0) { return; }
		// duplo clique detectado aqui: o redesenho do 1º clique troca os elementos e o "dblclick" nativo se perde
		const now = Date.now();
		if (lastDown && now - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6) {
			lastDown = undefined; e.preventDefault(); onDoubleClick(e); return;
		}
		lastDown = { t: now, x: e.clientX, y: e.clientY };
		const t = e.target;
		if (t.dataset.port) {
			const l = { id: uid('l'), from: t.dataset.shape, fromSide: t.dataset.port, ...presetProps() };
			drag = { type: 'link', link: l, pts: [anchor(byId(l.from), l.fromSide), p] };
			svg.setPointerCapture(e.pointerId); renderOverlay(); return;
		}
		if (t.dataset.handle) {
			const s = byId([...selection][0]);
			drag = { type: 'resize', dir: t.dataset.handle, s, start: p, orig: { x: s.x, y: s.y, w: s.w, h: shapeH(s) } };
			svg.setPointerCapture(e.pointerId); return;
		}
		if (t.dataset.end) {
			const l = linkById([...selection][0]);
			drag = { type: 'relink', link: l, end: t.dataset.end, pts: null };
			svg.setPointerCapture(e.pointerId); return;
		}
		const linkG = t.closest('[data-link]');
		if (linkG) {
			const id = linkG.dataset.link;
			if (e.shiftKey) { selection.has(id) ? selection.delete(id) : selection.add(id); } else { selection = new Set([id]); }
			render(); return;
		}
		const s = shapeAt(p);
		if (s) {
			if (e.shiftKey || e.ctrlKey) { selection.has(s.id) ? selection.delete(s.id) : selection.add(s.id); render(); return; }
			if (!selection.has(s.id)) { selection = new Set([s.id]); }
			// arrastar um contêiner leva junto o que está dentro dele
			const moving = new Set(selectedShapes().map(x => x.id));
			for (const c of selectedShapes()) {
				if (c.kind === 'boundary' || c.kind === 'package') { const cb = box(c); for (const o of page().shapes) { const ob = box(o); if (o !== c && ob.x >= cb.x && ob.y >= cb.y && ob.x + ob.w <= cb.x + cb.w && ob.y + ob.h <= cb.y + cb.h) { moving.add(o.id); } } }
			}
			drag = { type: 'move', start: p, items: [...moving].map(id => { const o = byId(id); return { s: o, x: o.x, y: o.y }; }), moved: false };
			svg.setPointerCapture(e.pointerId); render(); return;
		}
		if (!e.shiftKey) { selection.clear(); }
		drag = { type: 'marquee', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, base: new Set(selection) };
		svg.setPointerCapture(e.pointerId); render();
	});
	function presetProps() { const p = LINK_PRESETS[linkPreset] || LINK_PRESETS.seta; return { start: p.start, end: p.end, dash: p.dash }; }

	svg.addEventListener('pointermove', e => {
		const p = toWorld(e.clientX, e.clientY);
		if (!drag) {
			const over = e.target.dataset?.port ? e.target.dataset.shape : shapeAt(p)?.id;
			if (over !== hoverShape) { hoverShape = over; renderOverlay(); }
			return;
		}
		switch (drag.type) {
			case 'pan': view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; applyView(); break;
			case 'move': {
				let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
				if (!drag.moved && Math.hypot(dx, dy) * view.z < 3) { return; }
				drag.moved = true;
				// encaixe na grade pela primeira forma + guias de alinhamento com as outras
				const lead = drag.items[0];
				let nx = snap(lead.x + dx), ny = snap(lead.y + dy);
				drag.guides = [];
				const lb = { w: box(lead.s).w, h: box(lead.s).h };
				const others = page().shapes.filter(o => !drag.items.some(i => i.s === o));
				for (const o of others) {
					const ob = box(o);
					const ocx = ob.x + ob.w / 2, ocy = ob.y + ob.h / 2;
					if (Math.abs(lead.x + dx + lb.w / 2 - ocx) < 6) { nx = ocx - lb.w / 2; drag.guides.push({ x1: ocx, x2: ocx, y1: Math.min(ob.y, ny) - 20, y2: Math.max(ob.y + ob.h, ny + lb.h) + 20 }); }
					if (Math.abs(lead.y + dy + lb.h / 2 - ocy) < 6) { ny = ocy - lb.h / 2; drag.guides.push({ y1: ocy, y2: ocy, x1: Math.min(ob.x, nx) - 20, x2: Math.max(ob.x + ob.w, nx + lb.w) + 20 }); }
				}
				dx = nx - lead.x; dy = ny - lead.y;
				for (const it of drag.items) { it.s.x = it.x + dx; it.s.y = it.y + dy; }
				redrawKeepProps(); break;
			}
			case 'resize': {
				const { dir, s, orig } = drag; const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
				let { x, y, w, h: hh } = orig;
				if (dir.includes('e')) { w = orig.w + dx; }
				if (dir.includes('w')) { w = orig.w - dx; x = orig.x + dx; }
				if (dir.includes('s')) { hh = orig.h + dy; }
				if (dir.includes('n')) { hh = orig.h - dy; y = orig.y + dy; }
				if (e.shiftKey && dir.length === 2) { const r = orig.w / orig.h; if (w / hh > r) { w = hh * r; } else { hh = w / r; } if (dir.includes('w')) { x = orig.x + orig.w - w; } if (dir.includes('n')) { y = orig.y + orig.h - hh; } }
				w = Math.max(30, snap(w)); hh = Math.max(24, snap(hh)); x = snap(x); y = snap(y);
				s.x = x; s.w = w; if (s.kind !== 'class' && s.kind !== 'table') { s.y = y; s.h = hh; }
				redrawKeepProps(); break;
			}
			case 'link': case 'relink': {
				const l = drag.link;
				const fixedId = drag.type === 'relink' ? (drag.end === 'from' ? l.to : l.from) : l.from;
				const target = shapeAt(p, fixedId);
				drag.over = target?.id;
				hoverShape = target?.id;
				const fixed = byId(fixedId);
				if (target) { const tmp = { ...l, from: fixedId, to: target.id, fromSide: drag.type === 'relink' ? 'auto' : l.fromSide, toSide: 'auto' }; drag.pts = linkPoints(tmp); }
				else { drag.pts = [anchor(fixed, nearestSide(fixed, p)), p]; }
				renderOverlay(); break;
			}
			case 'marquee': {
				const x = Math.min(p.x, drag.start.x), y = Math.min(p.y, drag.start.y);
				drag.rect = { x, y, w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
				selection = new Set(drag.base);
				for (const s of page().shapes) { const b = box(s); if (b.x >= x && b.y >= y && b.x + b.w <= x + drag.rect.w && b.y + b.h <= y + drag.rect.h) { selection.add(s.id); } }
				renderOverlay(); break;
			}
		}
	});
	svg.addEventListener('pointerup', e => {
		if (!drag) { return; }
		const d = drag; drag = undefined; stage.classList.remove('panning');
		if (d.type === 'move' && d.moved) { commit(); }
		if (d.type === 'resize') { commit(); }
		if (d.type === 'link') {
			if (d.over && d.over !== d.link.from) {
				d.link.to = d.over;
				const toSide = e.target.dataset?.port && e.target.dataset.shape === d.over ? e.target.dataset.port : 'auto';
				d.link.toSide = toSide;
				page().links.push(d.link); selection = new Set([d.link.id]); commit();
			} else if (!d.over) {
				// soltou no vazio: cria uma forma igual à de origem já ligada (como no Visio)
				const src = byId(d.link.from); const p = toWorld(e.clientX, e.clientY);
				if (Math.hypot(p.x - anchor(src, d.link.fromSide).x, p.y - anchor(src, d.link.fromSide).y) > 40) {
					const { id, x, y, ...rest } = JSON.parse(JSON.stringify(src));
					const n = { id: uid('s'), ...rest, x: 0, y: 0 };
					if (n.kind === 'class') { n.title = 'NovaClasse'; n.attrs = ''; n.methods = ''; } else if (n.kind === 'table') { n.title = 'nova_tabela'; n.rows = 'id INT PK'; } else if (n.kind !== 'actor') { n.text = ''; }
					n.x = snap(p.x - n.w / 2); n.y = snap(p.y - shapeH(n) / 2);
					page().shapes.push(n); d.link.to = n.id; d.link.toSide = 'auto'; d.link.fromSide = 'auto';
					page().links.push(d.link); selection = new Set([n.id]); commit();
				}
			}
		}
		if (d.type === 'relink' && d.over) {
			if (d.end === 'from') { d.link.from = d.over; d.link.fromSide = 'auto'; } else { d.link.to = d.over; d.link.toSide = 'auto'; }
			commit();
		}
		render();
	});
	svg.addEventListener('pointerleave', () => { if (!drag && hoverShape) { hoverShape = undefined; renderOverlay(); } });
	svg.addEventListener('wheel', e => {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) { zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY); return; }
		view.x -= e.shiftKey ? e.deltaY : e.deltaX; view.y -= e.shiftKey ? 0 : e.deltaY; applyView();
	}, { passive: false });

	// ------------------------------------------------------------------ edição de texto (dois cliques)
	let lastDown;
	function onDoubleClick(e) {
		const p = toWorld(e.clientX, e.clientY);
		const linkG = e.target.closest('[data-link]');
		if (linkG) { startEdit({ link: linkById(linkG.dataset.link), field: 'text' }, e.clientX, e.clientY); return; }
		const s = shapeAt(p);
		if (!s) {
			// dois cliques no vazio: cria um processo (atalho rápido)
			addShape(STENCILS[0].items[1], p); return;
		}
		let field = 'text';
		if (s.kind === 'class') { const L = classLayout(s); const ry = p.y - s.y; field = ry < L.header ? 'title' : ry < L.header + L.attrH ? 'attrs' : 'methods'; }
		if (s.kind === 'table') { field = p.y - s.y < 32 ? 'title' : 'rows'; }
		startEdit({ shape: s, field });
	}
	function startEdit(target, cx, cy) {
		if (editing) { finishEdit(true); }
		const r = svg.getBoundingClientRect();
		const ta = h('textarea', { class: 'inline-edit', spellcheck: 'false' });
		let left, top, w, hh;
		if (target.shape) {
			const s = target.shape, b = box(s);
			left = r.left + view.x + b.x * view.z; top = r.top + view.y + b.y * view.z; w = b.w * view.z; hh = b.h * view.z;
			if (s.kind === 'class' || s.kind === 'table') {
				const L = s.kind === 'class' ? classLayout(s) : null;
				if (target.field === 'title') { hh = (L ? L.header : 32) * view.z; }
				else if (target.field === 'attrs') { top += L.header * view.z; hh = Math.max(L.attrH, 60) * view.z; }
				else if (target.field === 'methods') { top += (L.header + L.attrH) * view.z; hh = Math.max(L.methH, 60) * view.z; }
				else { top += 32 * view.z; hh = Math.max(hh - 32 * view.z, 80); }
				ta.classList.add('left');
			}
			if (s.kind === 'actor') { top += (b.h - 26) * view.z; hh = 30; left -= 40; w += 80; }
			hh = Math.max(hh, 34); w = Math.max(w, 120);
			ta.value = s[target.field] || '';
		} else {
			left = cx - 90; top = cy - 18; w = 180; hh = 36; ta.value = target.link.text || '';
		}
		Object.assign(ta.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${hh}px`, fontSize: `${Math.max(12, 13 * view.z)}px` });
		document.body.appendChild(ta);
		ta.focus(); ta.select();
		editing = { target, ta };
		ta.addEventListener('keydown', ev => {
			ev.stopPropagation();
			if (ev.key === 'Escape') { finishEdit(false); }
			if (ev.key === 'Enter' && (ev.ctrlKey || target.field === 'title' || target.link)) { ev.preventDefault(); finishEdit(true); }
		});
		ta.addEventListener('paste', ev => ev.preventDefault()); // colar continua bloqueado aqui
		ta.addEventListener('blur', () => finishEdit(true));
	}
	function finishEdit(save) {
		if (!editing) { return; }
		const { target, ta } = editing; editing = undefined;
		if (save) {
			if (target.shape) { target.shape[target.field] = ta.value.replace(/\s+$/, target.field === 'title' ? '' : ''); }
			else { target.link.text = ta.value.trim(); }
			commit();
		}
		ta.remove(); render();
	}

	// ------------------------------------------------------------------ menu de contexto
	const ctx = document.getElementById('ctx');
	function showMenu(x, y, items) {
		ctx.innerHTML = ''; ctx.hidden = false;
		for (const it of items.filter(Boolean)) {
			if (it === '-') { ctx.appendChild(h('hr')); continue; }
			const b = h('button', {}, it[0]); b.addEventListener('click', () => { hideMenu(); it[1](); }); ctx.appendChild(b);
		}
		ctx.style.left = `${Math.min(x, innerWidth - 190)}px`; ctx.style.top = `${Math.min(y, innerHeight - ctx.offsetHeight - 8)}px`;
	}
	function hideMenu() { ctx.hidden = true; }
	svg.addEventListener('contextmenu', e => {
		e.preventDefault();
		const p = toWorld(e.clientX, e.clientY);
		const linkG = e.target.closest('[data-link]');
		const s = !linkG && shapeAt(p);
		if (linkG && !selection.has(linkG.dataset.link)) { selection = new Set([linkG.dataset.link]); render(); }
		if (s && !selection.has(s.id)) { selection = new Set([s.id]); render(); }
		if (!selection.size) {
			showMenu(e.clientX, e.clientY, [clipboard ? ['Colar', () => { pasteClipboard(0); const b = bounds(selectedShapes()); const dx = snap(p.x - b.x), dy = snap(p.y - b.y); for (const x of selectedShapes()) { x.x += dx; x.y += dy; } commit(); render(); }] : null, ['Selecionar tudo', () => { selection = new Set(page().shapes.map(x => x.id)); render(); }], ['Ajustar à tela', fitAll]]);
			return;
		}
		showMenu(e.clientX, e.clientY, [
			s ? ['Editar texto', () => startEdit({ shape: s, field: s.kind === 'class' || s.kind === 'table' ? 'title' : 'text' })] : null,
			linkG ? ['Editar texto da ligação', () => startEdit({ link: linkById(linkG.dataset.link), field: 'text' }, e.clientX, e.clientY)] : null,
			selectedShapes().length ? ['Copiar', copySelected] : null,
			['Duplicar', duplicateSelected],
			'-',
			['Trazer para frente', () => command('front')],
			['Enviar para trás', () => command('back')],
			'-',
			['Excluir', removeSelected],
		]);
	});
	window.addEventListener('pointerdown', e => { if (!ctx.contains(e.target)) { hideMenu(); } }, true);

	// ------------------------------------------------------------------ teclado
	const isTyping = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
	window.addEventListener('keydown', e => {
		if (!model || editing) { return; }
		if (e.key === ' ' && !isTyping(e)) { spaceDown = true; stage.classList.add('space'); e.preventDefault(); return; }
		if (isTyping(e)) { return; }
		const ctrl = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (ctrl && (k === 'z' || k === 'y')) { return; } // desfazer/refazer: o próprio editor faz
		if (ctrl && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
		if (ctrl && k === 'c') { e.preventDefault(); copySelected(); return; }
		if (ctrl && k === 'x') { e.preventDefault(); if (copySelected()) { removeSelected(); } return; }
		if (ctrl && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
		if (ctrl && k === 'a') { e.preventDefault(); selection = new Set(page().shapes.map(s => s.id)); render(); return; }
		if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
		if (e.key === 'Escape') { selection.clear(); render(); return; }
		if (e.key === 'F2' || e.key === 'Enter') { const s = selectedShapes()[0]; if (s) { e.preventDefault(); startEdit({ shape: s, field: s.kind === 'class' || s.kind === 'table' ? 'title' : 'text' }); } return; }
		if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) { fitAll(); return; }
		if (e.key.startsWith('Arrow')) {
			e.preventDefault(); const st = e.shiftKey ? 10 : 1;
			const [dx, dy] = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
			for (const s of selectedShapes()) { s.x += dx; s.y += dy; }
			commit(); redrawKeepProps(); return;
		}
		if (!ctrl && (e.key === '+' || e.key === '=')) { command('zoomIn'); return; }
		if (!ctrl && e.key === '-') { command('zoomOut'); return; }
	});
	window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; stage.classList.remove('space'); } });
	// colar de fora continua bloqueado: só o copiar/colar interno de formas (Ctrl+C / Ctrl+V)
	window.addEventListener('paste', e => { e.preventDefault(); });

	// ------------------------------------------------------------------ exportar
	function exportSvgString() {
		const b = bounds(page().shapes) || { x: 0, y: 0, w: 100, h: 100 };
		const pad = 30;
		const out = document.createElementNS(NS, 'svg');
		out.setAttribute('xmlns', NS);
		out.setAttribute('width', Math.ceil(b.w + pad * 2)); out.setAttribute('height', Math.ceil(b.h + pad * 2));
		out.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`);
		el('rect', { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, fill: '#ffffff' }, out);
		const gl = el('g', {}, out), gs = el('g', {}, out);
		for (const s of page().shapes) { drawShape(s, gs); }
		for (const l of page().links) { drawLink(l, gl); }
		out.querySelectorAll('.hit').forEach(n => n.remove());
		// ligações por cima das formas só quando cruzam; padrão Visio: linhas embaixo
		out.insertBefore(gl, gs);
		return { text: new XMLSerializer().serializeToString(out), w: b.w + pad * 2, h: b.h + pad * 2 };
	}
	async function exportPage(format) {
		if (!page().shapes.length) { vscode.postMessage({ type: 'error', message: 'A página está vazia: não há nada para exportar.' }); return; }
		const name = `${docName} - ${page().name}`;
		const { text, w, h: height } = exportSvgString();
		if (format === 'svg') { vscode.postMessage({ type: 'export', format: 'svg', name, data: text }); return; }
		try {
			const scale = 2;
			const img = new Image();
			img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
			await img.decode();
			const c = document.createElement('canvas'); c.width = Math.ceil(w * scale); c.height = Math.ceil(height * scale);
			const g2 = c.getContext('2d'); g2.scale(scale, scale); g2.drawImage(img, 0, 0);
			vscode.postMessage({ type: 'export', format: 'png', name, data: c.toDataURL('image/png') });
		} catch (err) { vscode.postMessage({ type: 'error', message: `Não foi possível exportar: ${err.message}` }); }
	}

	// ------------------------------------------------------------------ mensagens da extensão
	let firstLoad = true;
	window.addEventListener('message', e => {
		const msg = e.data;
		if (msg.type === 'confirmed') { confirms[msg.id]?.(msg.ok); delete confirms[msg.id]; return; }
		if (msg.type !== 'load') { return; }
		if (!msg.model) { app.innerHTML = `<div class="fatal">⚠ ${esc(msg.error)}</div>`; return; }
		model = msg.model; docName = msg.name || docName;
		for (const p of model.pages) { p.shapes ||= []; p.links ||= []; }
		if (!model.pages.length) { model.pages.push({ id: 'p1', name: 'Página 1', shapes: [], links: [] }); }
		pageIndex = Math.min(pageIndex, model.pages.length - 1);
		for (const id of [...selection]) { if (!byId(id) && !linkById(id)) { selection.delete(id); } }
		render();
		if (firstLoad) { firstLoad = false; applyView(); if (page().shapes.length) { requestAnimationFrame(fitAll); } }
	});
	window.addEventListener('resize', () => renderOverlay());

	renderStencils();
	applyView();
	vscode.postMessage({ type: 'ready' });
})();
