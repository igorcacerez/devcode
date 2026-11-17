/*---------------------------------------------------------------------------------------------
 *  DEV CODE - gerador de perguntas sobre o código do aluno (100% offline, sem IA).
 *  Analisa o texto com regras simples e cria perguntas de múltipla escolha sobre
 *  sintaxe, lógica e estrutura do código que o próprio aluno escreveu.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const PY_LIKE = new Set(['python']);
const C_LIKE = new Set(['c', 'cpp', 'java', 'csharp', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'go', 'php', 'rust', 'kotlin', 'dart', 'swift']);

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function shuffle(arr) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
	return a;
}

/** Monta uma pergunta com a resposta correta + distratores únicos (até 4 opções). */
function makeQuestion(kind, line, text, correct, distractors) {
	const opts = [String(correct)];
	for (const d of distractors) {
		const s = String(d);
		if (!opts.includes(s) && opts.length < 4) { opts.push(s); }
	}
	if (opts.length < 2) { return undefined; }
	return { kind, line, text, correct: String(correct), options: shuffle(opts) };
}

function numericDistractors(n) {
	return shuffle([n + 1, n - 1, n + 2, n * 2, n - 2, n + 10].filter(x => x >= 0 && x !== n));
}

/** Remove comentários e strings para análise estrutural (mantém o número de linhas). */
function stripLine(line, lang) {
	let l = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
	if (PY_LIKE.has(lang)) { l = l.replace(/#.*$/, ''); }
	else { l = l.replace(/\/\/.*$/, ''); }
	return l;
}

// ----------------------------------------------------------------------------------------------

function analyzeFunctions(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const l = stripLine(raw, lang);
		let m;
		if (PY_LIKE.has(lang)) {
			m = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(l);
		} else {
			m = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(l)
				|| /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/.exec(l)
				|| /^\s*(?:public|private|protected|static|final|virtual|override|async|inline|\s)*[A-Za-z_][\w<>\[\],\s*&:]*?\s+\**([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const\s*)?\{?\s*$/.exec(l)
				|| /^\s*func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(l);
		}
		if (m && !/^(if|for|while|switch|catch|return|else|new|sizeof)$/.test(m[1])) {
			const params = m[2].split(',').map(p => p.trim()).filter(p => p && p !== 'void' && p !== 'self' && p !== 'this');
			out.push({ name: m[1], params: params.length, line: i });
		}
	});
	return out;
}

function rangeCount(start, stop, step) {
	if (step === 0) { return undefined; }
	const n = Math.ceil((stop - start) / step);
	return n > 0 ? n : 0;
}

function analyzeLoops(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const l = stripLine(raw, lang);
		if (PY_LIKE.has(lang)) {
			const m = /^\s*for\s+([A-Za-z_]\w*)\s+in\s+range\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?(?:,\s*(-?\d+)\s*)?\)/.exec(l);
			if (m) {
				const a = m[3] === undefined ? 0 : +m[2];
				const b = m[3] === undefined ? +m[2] : +m[3];
				const s = m[4] === undefined ? 1 : +m[4];
				const count = rangeCount(a, b, s);
				if (count !== undefined && count <= 1000) {
					out.push({ variable: m[1], count, last: count > 0 ? a + (count - 1) * s : undefined, line: i });
				}
			}
		} else {
			const m = /\bfor\s*\(\s*(?:int|let|var|long|auto|size_t)?\s*([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*;\s*\1\s*(<=|<|>=|>)\s*(-?\d+)\s*;\s*(?:\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)|(\+\+|--)\s*\1)\s*\)/.exec(l)
				|| /^\s*for\s+([A-Za-z_]\w*)\s*:=\s*(-?\d+)\s*;\s*\1\s*(<=|<|>=|>)\s*(-?\d+)\s*;\s*\1(\+\+|--|\s*\+=\s*\d+|\s*-=\s*\d+)/.exec(l);
			if (m) {
				const a = +m[2];
				const op = m[3];
				let b = +m[4];
				const inc = (m[5] || m[6]).replace(/\s/g, '');
				let step = inc === '++' ? 1 : inc === '--' ? -1 : inc.startsWith('+=') ? +inc.slice(2) : -inc.slice(2);
				if (op === '<=') { b += 1; } else if (op === '>=') { b -= 1; }
				const count = (op.startsWith('<') && step > 0) || (op.startsWith('>') && step < 0) ? rangeCount(a, b, step) : undefined;
				if (count !== undefined && count <= 1000) {
					out.push({ variable: m[1], count, last: count > 0 ? a + (count - 1) * step : undefined, line: i });
				}
			}
		}
	});
	return out;
}

const COMPARISON_OPS = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];

function analyzeConditions(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const l = stripLine(raw, lang);
		const m = /^\s*(?:\}\s*)?(if|elif|else\s+if|while)\b\s*\(?(.*)$/.exec(l);
		if (!m) { return; }
		const cond = m[2];
		const op = COMPARISON_OPS.find(o => cond.includes(o));
		if (op) {
			out.push({ keyword: m[1].replace(/\s+/, ' '), op, line: i });
		}
	});
	return out;
}

function literalType(value, lang) {
	const v = value.trim().replace(/;$/, '');
	if (/^(true|false|True|False)$/.test(v)) { return 'Lógico (booleano)'; }
	if (/^-?\d+$/.test(v)) { return 'Inteiro'; }
	if (/^-?\d*\.\d+[fFdD]?$/.test(v)) { return 'Real (decimal / ponto flutuante)'; }
	if (/^(["'`]).*\1$/.test(v)) { return lang === 'c' || lang === 'cpp' ? (v.startsWith('\'') ? 'Caractere' : 'Texto (string)') : 'Texto (string)'; }
	if (/^\[.*\]$/.test(v) || /^\{.*\}$/.test(v) && lang !== 'python') { return 'Lista / vetor (array)'; }
	if (/^\[.*\]$/.test(v)) { return 'Lista / vetor (array)'; }
	return undefined;
}

const TYPE_OPTIONS = ['Inteiro', 'Real (decimal / ponto flutuante)', 'Texto (string)', 'Lógico (booleano)', 'Lista / vetor (array)'];

function analyzeAssignments(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const m = /^\s*(?:(?:const|let|var|final|static|auto|int|long|short|float|double|char|bool|boolean|String|string|str)\s+)*(?:[A-Za-z_][\w<>\[\]]*\s+)?([A-Za-z_]\w*)\s*(?::\s*[\w\[\]]+\s*)?=\s*([^=].*?)\s*;?\s*$/.exec(raw);
		if (!m || /^(if|for|while|return)$/.test(m[1])) { return; }
		const type = literalType(m[2], lang);
		if (type) { out.push({ name: m[1], value: m[2].replace(/;$/, '').trim(), type, line: i }); }
	});
	return out;
}

/** Expressões aritméticas só com literais inteiros: x = 7 % 3 + 2 */
function analyzeArithmetic(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const m = /^\s*(?:(?:const|let|var|int|long|auto)\s+)?([A-Za-z_]\w*)\s*=\s*([\d\s+\-*%/()]+?)\s*;?\s*$/.exec(raw);
		if (!m || !/[+\-*%/]/.test(m[2]) || /^\s*-?\d+\s*$/.test(m[2])) { return; }
		let expr = m[2];
		const py = PY_LIKE.has(lang);
		if (py && /(^|[^/])\/([^/]|$)/.test(expr)) { return; } // divisão real em Python: pula
		if (/\*\*/.test(expr)) { return; }
		try {
			// divisão inteira: // em Python, / em linguagens tipadas
			const tokens = expr.match(/\d+|\/\/|[+\-*%/()]/g);
			if (!tokens || tokens.join('') !== expr.replace(/\s/g, '')) { return; }
			const js = tokens.map(t => (t === '//' || (!py && t === '/')) ? '|IDIV|' : t).join(' ');
			const value = evalInt(js, py);
			if (Number.isFinite(value) && Math.abs(value) < 1e9) {
				out.push({ name: m[1], expr: expr.trim(), value, line: i });
			}
		} catch { /* ignora */ }
	});
	return out;
}

/** Avaliador minimalista (shunting-yard) para + - * % e divisão inteira. */
function evalInt(src, py) {
	const toks = src.split(/\s+/).filter(Boolean);
	const prec = { '+': 1, '-': 1, '*': 2, '%': 2, '|IDIV|': 2 };
	const outQ = [], ops = [];
	for (const t of toks) {
		if (/^\d+$/.test(t)) { outQ.push(+t); }
		else if (t === '(') { ops.push(t); }
		else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') { outQ.push(ops.pop()); } ops.pop(); }
		else { while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) { outQ.push(ops.pop()); } ops.push(t); }
	}
	while (ops.length) { outQ.push(ops.pop()); }
	const st = [];
	for (const t of outQ) {
		if (typeof t === 'number') { st.push(t); continue; }
		const b = st.pop(), a = st.pop();
		if (a === undefined || b === undefined) { throw new Error('expr'); }
		switch (t) {
			case '+': st.push(a + b); break;
			case '-': st.push(a - b); break;
			case '*': st.push(a * b); break;
			case '%': if (b === 0) { throw new Error('div0'); } st.push(py ? ((a % b) + b) % b : a % b); break;
			case '|IDIV|': if (b === 0) { throw new Error('div0'); } st.push(py ? Math.floor(a / b) : Math.trunc(a / b)); break;
		}
	}
	if (st.length !== 1) { throw new Error('expr'); }
	return st[0];
}

const STRUCTURES = {
	loop: 'Laço de repetição',
	cond: 'Estrutura condicional (decisão)',
	func: 'Definição de função / método',
	assign: 'Atribuição de valor a variável',
	output: 'Saída de dados (imprimir na tela)',
	input: 'Entrada de dados (ler do teclado)',
	ret: 'Retorno de função',
	import: 'Importação de biblioteca / módulo',
};

function classifyLine(raw, lang) {
	const l = stripLine(raw, lang).trim();
	if (!l || /^[{}();]*$/.test(l)) { return undefined; }
	if (/^(import|from\s+\S+\s+import|#include|using\s+[\w.]+;|require\s*\(|package\s)/.test(l) || /=\s*require\(/.test(l)) { return 'import'; }
	if (/^(\}\s*)?(for|while|do|foreach)\b/.test(l)) { return 'loop'; }
	if (/^(\}\s*)?(if|elif|else\s+if|switch|match)\b/.test(l)) { return 'cond'; }
	if (/^(def|function|func|fn)\s/.test(l) || /^(public|private|protected|static).*\(.*\)\s*\{?$/.test(l)) { return 'func'; }
	if (/^return\b/.test(l)) { return 'ret'; }
	if (/\b(input|scanf|readline|readLine|nextInt|nextLine|ReadLine|prompt|cin\s*>>)\b/.test(raw)) { return 'input'; }
	if (/\b(print|printf|println|console\.log|System\.out|Console\.Write|cout|puts|echo|fmt\.Print)/.test(l)) { return 'output'; }
	if (/^[\w\s<>\[\]:]*\b[A-Za-z_]\w*\s*(\[[^\]]*\])?\s*([+\-*/%]?=)(?!=)/.test(l)) { return 'assign'; }
	return undefined;
}

function analyzeStructures(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const kind = classifyLine(raw, lang);
		if (kind) { out.push({ kind, line: i }); }
	});
	return out;
}

function analyzeOutputs(lines, lang) {
	const out = [];
	lines.forEach((raw, i) => {
		const m = /\b(?:print|println|printf|console\.log|System\.out\.println|System\.out\.print|Console\.WriteLine|puts)\s*\(\s*(["'])((?:\\.|(?!\1).){1,60})\1\s*\)/.exec(raw);
		if (m && !/[{%]/.test(m[2])) { out.push({ text: m[2], line: i }); }
	});
	return out;
}

// ----------------------------------------------------------------------------------------------

function snippet(lines, line) {
	return `linha ${line + 1}: ${lines[line].trim()}`;
}

/**
 * Gera uma pergunta para o documento. Retorna {kind,line,text,correct,options}
 */
function generateQuestion(code, languageId) {
	const lang = languageId;
	const lines = code.split(/\r?\n/);
	const candidates = [];

	for (const f of analyzeLoops(lines, lang)) {
		candidates.push(() => makeQuestion('loop', f.line, `Quantas vezes o laço da ${snippet(lines, f.line)} executa o seu bloco?`, f.count, numericDistractors(f.count)));
		if (f.last !== undefined) {
			candidates.push(() => makeQuestion('loop', f.line, `No laço da ${snippet(lines, f.line)}, qual é o ÚLTIMO valor de \`${f.variable}\` dentro do bloco?`, f.last, [f.last + 1, f.last - 1, f.last + 2, f.last * 2].filter(x => x !== f.last)));
		}
		weight(candidates, 2);
	}
	for (const a of analyzeArithmetic(lines, lang)) {
		candidates.push(() => makeQuestion('arith', a.line, `Qual valor a variável \`${a.name}\` recebe na ${snippet(lines, a.line)}?`, a.value, numericDistractors(a.value).concat([-a.value])));
		weight(candidates, 2);
	}
	const funcs = analyzeFunctions(lines, lang);
	for (const f of funcs) {
		candidates.push(() => makeQuestion('func', f.line, `Quantos parâmetros a função \`${f.name}\` (${snippet(lines, f.line)}) recebe?`, f.params, numericDistractors(f.params).concat([0, 1, 2, 3])));
	}
	for (const c of analyzeConditions(lines, lang)) {
		const names = { '==': 'igual a', '===': 'estritamente igual a', '!=': 'diferente de', '!==': 'estritamente diferente de', '>': 'maior que', '<': 'menor que', '>=': 'maior ou igual a', '<=': 'menor ou igual a' };
		const correct = `${c.op}  (${names[c.op]})`;
		const isJs = lang.includes('script');
		const others = shuffle(Object.keys(names).filter(o => o !== c.op && (o.length < 3 || isJs))).map(o => `${o}  (${names[o]})`);
		candidates.push(() => makeQuestion('cond', c.line, `Na ${snippet(lines, c.line)}, qual operador de comparação é usado na condição?`, correct, others));
		const kw = c.keyword === 'while' ? STRUCTURES.loop : STRUCTURES.cond;
		candidates.push(() => makeQuestion('struct', c.line, `O que a ${snippet(lines, c.line)} representa?`, kw, shuffle(Object.values(STRUCTURES))));
	}
	for (const a of analyzeAssignments(lines, lang)) {
		candidates.push(() => makeQuestion('type', a.line, `Qual é o TIPO do valor guardado em \`${a.name}\` na ${snippet(lines, a.line)}?`, a.type, shuffle(TYPE_OPTIONS)));
	}
	for (const o of analyzeOutputs(lines, lang)) {
		const variants = [o.text.toUpperCase(), o.text.split('').reverse().join(''), `"${o.text}"`, o.text.replace(/\s+/g, ''), o.text + '!'];
		candidates.push(() => makeQuestion('output', o.line, `O que a ${snippet(lines, o.line)} mostra na tela?`, o.text, shuffle(variants)));
	}
	if (/javascript|typescript/.test(lang)) { addReactQuestions(lines, candidates); }
	if (lang === 'html') { addHtmlQuestions(lines, candidates); }
	if (lang === 'css' || lang === 'html') { addCssQuestions(lines, candidates); }

	for (const s of (lang === 'html' || lang === 'css') ? [] : analyzeStructures(lines, lang)) {
		candidates.push(() => makeQuestion('struct', s.line, `Qual estrutura / comando é usado na ${snippet(lines, s.line)}?`, STRUCTURES[s.kind], shuffle(Object.values(STRUCTURES))));
	}

	// Tenta candidatos aleatórios até achar um válido
	const pool = shuffle(candidates);
	for (const make of pool) {
		const q = make();
		if (q) { return q; }
	}

	// Fallback: contagem de linhas de código
	const nonEmpty = lines.filter(l => stripLine(l, lang).trim().length > 0).length;
	if (nonEmpty === 0) { return undefined; }
	return makeQuestion('lines', 0, 'Quantas linhas NÃO vazias de código o seu programa possui?', nonEmpty, numericDistractors(nonEmpty));
}

// ------------------------------------------ React / React Native ------------------------------------------

const RN_COMPONENTS = {
	View: 'Contêiner/caixa que agrupa outros componentes (como uma div)',
	Text: 'Mostra um texto na tela',
	Image: 'Mostra uma imagem',
	TextInput: 'Campo para o usuário digitar',
	Button: 'Botão simples',
	Pressable: 'Área que responde ao toque',
	TouchableOpacity: 'Área tocável que fica transparente ao ser pressionada',
	ScrollView: 'Área com rolagem',
	FlatList: 'Lista otimizada de itens (renderiza só o que está visível)',
	SafeAreaView: 'Contêiner que respeita a área segura (entalhe/barra do celular)',
	StatusBar: 'Controla a barra de status do celular',
	Switch: 'Botão liga/desliga',
};

function addReactQuestions(lines, candidates) {
	const setters = [];
	const states = [];
	lines.forEach((raw, i) => {
		const st = /const\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*(?:React\.)?useState\s*\(\s*([^)]*?)\s*\)/.exec(raw);
		if (st) { states.push({ name: st[1], setter: st[2], init: st[3], line: i }); setters.push(st[2]); }
	});
	for (const s of states) {
		if (s.init !== '') {
			const t = literalType(s.init, 'javascript');
			const pool = ['0', '""', 'true', 'false', '[]', '{}', 'null', '1', s.init + '1'];
			candidates.push(() => makeQuestion('react', s.line, `Na ${snippet(lines, s.line)}, qual é o VALOR INICIAL do estado \`${s.name}\`?`, s.init, shuffle(pool)));
			if (t) {
				candidates.push(() => makeQuestion('react', s.line, `Na ${snippet(lines, s.line)}, qual é o TIPO do valor inicial do estado \`${s.name}\`?`, t, shuffle(TYPE_OPTIONS)));
			}
		}
		candidates.push(() => makeQuestion('react', s.line, `Na ${snippet(lines, s.line)}, qual função deve ser chamada para ALTERAR o estado \`${s.name}\`?`, s.setter,
			shuffle([s.name, `set_${s.name}`, 'useState', 'setState', `update${s.name}`, ...setters.filter(x => x !== s.setter)])));
		candidates.push(() => makeQuestion('react', s.line, `O que acontece com a tela quando \`${s.setter}\` é chamada com um valor novo?`, 'O componente é renderizado de novo com o novo valor',
			['Nada, a tela só muda se recarregar a página', 'A variável muda mas a tela continua igual', 'O aplicativo reinicia']));
	}
	lines.forEach((raw, i) => {
		const tag = /<([A-Z]\w*)\b/.exec(raw);
		if (tag && RN_COMPONENTS[tag[1]]) {
			candidates.push(() => makeQuestion('react', i, `Na ${snippet(lines, i)}, para que serve o componente <${tag[1]}>?`, RN_COMPONENTS[tag[1]],
				shuffle(Object.keys(RN_COMPONENTS).filter(k => k !== tag[1]).map(k => RN_COMPONENTS[k]))));
		}
		const ev = /\b(onClick|onPress|onChange|onChangeText|onSubmit)\s*=\s*\{/.exec(raw);
		if (ev) {
			const EV = { onClick: 'Quando o elemento é clicado', onPress: 'Quando o elemento é tocado/pressionado', onChange: 'Quando o valor do campo muda', onChangeText: 'Quando o texto digitado muda', onSubmit: 'Quando o formulário é enviado' };
			candidates.push(() => makeQuestion('react', i, `Na ${snippet(lines, i)}, quando a função passada em \`${ev[1]}\` é executada?`, EV[ev[1]],
				shuffle(Object.values(EV).filter(v => v !== EV[ev[1]]).concat(['Assim que o componente é criado']))));
		}
		const prop = /function\s+([A-Z]\w*)\s*\(\s*\{\s*([^}]+)\}\s*\)/.exec(raw);
		if (prop) {
			const n = prop[2].split(',').map(x => x.trim()).filter(Boolean).length;
			candidates.push(() => makeQuestion('react', i, `Quantas PROPS o componente \`${prop[1]}\` (${snippet(lines, i)}) recebe?`, n, numericDistractors(n)));
		}
	});
}

// ------------------------------------------ HTML / CSS ------------------------------------------

const TAG_MEANING = {
	h1: 'Título principal da página', h2: 'Subtítulo (título de nível 2)', h3: 'Título de nível 3', p: 'Parágrafo de texto',
	a: 'Link (hiperligação)', img: 'Imagem', ul: 'Lista não ordenada (com marcadores)', ol: 'Lista ordenada (numerada)',
	li: 'Item de uma lista', div: 'Bloco/contêiner genérico', span: 'Trecho de texto em linha (contêiner inline)',
	form: 'Formulário', input: 'Campo de entrada de dados', button: 'Botão', table: 'Tabela', tr: 'Linha de uma tabela',
	td: 'Célula de uma tabela', th: 'Célula de cabeçalho da tabela', link: 'Vincula um arquivo externo (ex.: CSS)',
	script: 'Inclui/executa JavaScript', title: 'Título que aparece na aba do navegador', meta: 'Metadados da página',
	header: 'Cabeçalho da página/seção', footer: 'Rodapé da página/seção', nav: 'Área de navegação (menu)',
	section: 'Seção temática da página', article: 'Conteúdo independente (artigo)', label: 'Rótulo de um campo de formulário',
	select: 'Lista de seleção (caixa de opções)', textarea: 'Campo de texto com várias linhas', br: 'Quebra de linha',
	strong: 'Texto com forte importância (negrito)', em: 'Texto com ênfase (itálico)', main: 'Conteúdo principal da página',
	body: 'Corpo (conteúdo visível) da página', head: 'Cabeçalho do documento (informações, não visível)',
};

function addHtmlQuestions(lines, candidates) {
	const allTags = Object.keys(TAG_MEANING);
	lines.forEach((raw, i) => {
		const tagM = /<([a-zA-Z][\w-]*)\b([^>]*)>/.exec(raw);
		if (!tagM) { return; }
		const tag = tagM[1].toLowerCase();
		if (TAG_MEANING[tag] && !['html', 'head', 'body'].includes(tag)) {
			candidates.push(() => makeQuestion('html', i, `Para que serve a tag usada na ${snippet(lines, i)}?`, TAG_MEANING[tag],
				shuffle(allTags.filter(t => t !== tag).map(t => TAG_MEANING[t]))));
		}
		const attrM = /\b([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/.exec(tagM[2]);
		if (attrM) {
			const attr = attrM[1].toLowerCase();
			const ATTR_POOL = ['href', 'src', 'class', 'id', 'alt', 'type', 'name', 'value', 'rel', 'style', 'placeholder', 'for', 'lang', 'charset', 'content'];
			candidates.push(() => makeQuestion('html', i, `Na ${snippet(lines, i)}, qual ATRIBUTO recebe o valor "${attrM[2]}"?`, attr,
				shuffle(ATTR_POOL.filter(a => a !== attr))));
		}
		// contagem de itens de lista / estrutura aninhada
		if (tag === 'ul' || tag === 'ol') {
			let n = 0;
			for (let k = i + 1; k < lines.length && !new RegExp(`</${tag}>`, 'i').test(lines[k]); k++) {
				n += (lines[k].match(/<li\b/gi) || []).length;
			}
			if (n > 0) {
				candidates.push(() => makeQuestion('html', i, `Quantos itens (<li>) a lista que começa na ${snippet(lines, i)} possui?`, n, numericDistractors(n)));
			}
		}
	});
}

const CSS_PROPS = ['color', 'background-color', 'font-size', 'margin', 'padding', 'border', 'width', 'height', 'display',
	'text-align', 'font-family', 'font-weight', 'position', 'justify-content', 'align-items', 'gap', 'flex-direction', 'border-radius'];

function addCssQuestions(lines, candidates) {
	lines.forEach((raw, i) => {
		const sel = /^\s*([.#]?[a-zA-Z][\w-]*)\s*\{/.exec(raw);
		if (sel) {
			const s = sel[1];
			const name = s.replace(/^[.#]/, '');
			const opts = {
				'.': `Elementos com a classe "${name}"`,
				'#': `O elemento com o id "${name}"`,
				'': `Todos os elementos <${name}>`,
			};
			const correct = opts[s[0] === '.' || s[0] === '#' ? s[0] : ''];
			candidates.push(() => makeQuestion('css', i, `Na ${snippet(lines, i)}, o que o seletor \`${s}\` seleciona?`, correct,
				shuffle([...Object.values(opts), 'Todos os elementos da página'])));
		}
		const decl = /^\s*([a-z-]+)\s*:\s*([^;{}]+);/.exec(raw);
		if (decl) {
			const prop = decl[1];
			candidates.push(() => makeQuestion('css', i, `Na ${snippet(lines, i)}, qual PROPRIEDADE CSS está sendo alterada?`, prop,
				shuffle(CSS_PROPS.filter(p => p !== prop))));
			const unit = /^-?\d+(\.\d+)?(px|em|rem|%|vh|vw)$/.exec(decl[2].trim());
			if (unit) {
				const UNITS = { px: 'Pixels (tamanho fixo)', em: 'Relativo ao tamanho da fonte do elemento pai', rem: 'Relativo ao tamanho da fonte da raiz (html)', '%': 'Porcentagem do elemento pai', vh: 'Porcentagem da altura da tela', vw: 'Porcentagem da largura da tela' };
				candidates.push(() => makeQuestion('css', i, `Na ${snippet(lines, i)}, o que significa a unidade "${unit[2]}"?`, UNITS[unit[2]],
					shuffle(Object.values(UNITS).filter(u => u !== UNITS[unit[2]]))));
			}
		}
	});
}

/** Duplica os últimos candidatos adicionados para dar mais peso a perguntas de lógica. */
function weight(candidates, times) {
	const last = candidates[candidates.length - 1];
	for (let i = 1; i < times; i++) { candidates.push(last); }
}

module.exports = { generateQuestion, _internal: { analyzeLoops, analyzeArithmetic, analyzeFunctions, analyzeConditions, analyzeAssignments, analyzeStructures, evalInt } };
