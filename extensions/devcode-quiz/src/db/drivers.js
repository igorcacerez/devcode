/*---------------------------------------------------------------------------------------------
 *  DEV CODE - Banco de Dados: drivers (Firebird, MySQL, PostgreSQL) com interface única.
 *
 *  conexão = {
 *    query(sql)  -> { columns: string[], rows: any[][], affected?: number }
 *    tables(), views(), triggers(), procedures(), sequences()
 *    columns(table), primaryKey(table), foreignKeys(table), indexes(table), tableTriggers(table)
 *    ddl(table) -> string,   close()
 *  }
 *--------------------------------------------------------------------------------------------*/
'use strict';

const TYPES = { firebird: 'Firebird', mysql: 'MySQL', postgres: 'PostgreSQL', sqlite: 'SQLite' };

// ============================================================================ util
function normalizeRows(objRows, fields) {
	const columns = fields || (objRows[0] ? Object.keys(objRows[0]) : []);
	const rows = objRows.map(r => columns.map(c => toCell(r[c])));
	return { columns, rows };
}
function toCell(v) {
	if (v === null || v === undefined) { return null; }
	if (Buffer.isBuffer(v)) { return v.length > 64 ? `[binário ${v.length} bytes]` : v.toString('utf8'); }
	if (v instanceof Date) { return isNaN(v) ? String(v) : v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, ''); }
	if (typeof v === 'object') { return JSON.stringify(v); }
	if (typeof v === 'bigint') { return v.toString(); }
	return v;
}
const trim = s => (typeof s === 'string' ? s.trim() : s);

// ============================================================================ Firebird
const FB_TYPES = { 7: 'SMALLINT', 8: 'INTEGER', 10: 'FLOAT', 12: 'DATE', 13: 'TIME', 14: 'CHAR', 16: 'BIGINT', 23: 'BOOLEAN', 24: 'DECFLOAT(16)', 25: 'DECFLOAT(34)', 26: 'INT128', 27: 'DOUBLE PRECISION', 28: 'TIME WITH TIME ZONE', 29: 'TIMESTAMP WITH TIME ZONE', 35: 'TIMESTAMP', 37: 'VARCHAR', 261: 'BLOB' };

async function connectFirebird(cfg) {
	const Firebird = require('node-firebird');
	const options = {
		host: cfg.host || '127.0.0.1', port: +cfg.port || 3050, database: cfg.database,
		user: cfg.user || 'SYSDBA', password: cfg.password ?? 'masterkey',
		lowercase_keys: false, role: null, pageSize: 4096, retryConnectionInterval: 1000, blobAsText: true, encoding: 'UTF8',
		wireCrypt: Firebird.WIRE_CRYPT_ENABLE ?? undefined,
	};
	const db = await new Promise((resolve, reject) => Firebird.attach(options, (err, d) => err ? reject(err) : resolve(d)));
	const raw = (sql, params = []) => new Promise((resolve, reject) => {
		db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err, tr) => {
			if (err) { return reject(err); }
			tr.query(sql, params, (err2, result, meta) => {
				if (err2) { return tr.rollback(() => reject(err2)); }
				tr.commit(err3 => err3 ? reject(err3) : resolve({ result, meta }));
			});
		});
	});
	const rows = async (sql, params) => { const { result } = await raw(sql, params); return (Array.isArray(result) ? result : result ? [result] : []).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trim(v)]))); };
	const col = async (sql, params) => (await rows(sql, params)).map(r => Object.values(r)[0]);

	const columns = async table => (await rows(`
		SELECT rf.RDB$FIELD_NAME AS NAME, f.RDB$FIELD_TYPE AS FTYPE, f.RDB$FIELD_SUB_TYPE AS SUBTYPE, f.RDB$FIELD_LENGTH AS FLEN,
		       f.RDB$CHARACTER_LENGTH AS CLEN, f.RDB$FIELD_PRECISION AS FPREC, f.RDB$FIELD_SCALE AS FSCALE,
		       COALESCE(rf.RDB$NULL_FLAG, f.RDB$NULL_FLAG, 0) AS NOTNULL, CAST(rf.RDB$DEFAULT_SOURCE AS VARCHAR(500)) AS DEF,
		       f.RDB$COMPUTED_SOURCE AS COMPUTED
		FROM RDB$RELATION_FIELDS rf JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = rf.RDB$FIELD_SOURCE
		WHERE rf.RDB$RELATION_NAME = ? ORDER BY rf.RDB$FIELD_POSITION`, [table])).map(r => {
		let type = FB_TYPES[r.FTYPE] || `TIPO ${r.FTYPE}`;
		if (r.FSCALE < 0 && [7, 8, 16, 26].includes(r.FTYPE)) { type = `${r.SUBTYPE === 2 ? 'DECIMAL' : 'NUMERIC'}(${r.FPREC},${-r.FSCALE})`; }
		else if (r.FTYPE === 37 || r.FTYPE === 14) { type += `(${r.CLEN ?? r.FLEN})`; }
		else if (r.FTYPE === 261) { type += r.SUBTYPE === 1 ? ' SUB_TYPE TEXT' : ' SUB_TYPE BINARY'; }
		return { name: r.NAME, type, nullable: !r.NOTNULL, default: r.DEF ? String(r.DEF).replace(/^DEFAULT\s+/i, '') : null };
	});
	const primaryKey = async table => col(`
		SELECT s.RDB$FIELD_NAME FROM RDB$RELATION_CONSTRAINTS rc JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
		WHERE rc.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'PRIMARY KEY' ORDER BY s.RDB$FIELD_POSITION`, [table]);
	const foreignKeys = async table => {
		const r = await rows(`
			SELECT rc.RDB$CONSTRAINT_NAME AS NAME, s.RDB$FIELD_NAME AS COL, refrc.RDB$RELATION_NAME AS REFTABLE, refs.RDB$FIELD_NAME AS REFCOL,
			       ref.RDB$UPDATE_RULE AS UPD, ref.RDB$DELETE_RULE AS DEL
			FROM RDB$RELATION_CONSTRAINTS rc
			JOIN RDB$REF_CONSTRAINTS ref ON ref.RDB$CONSTRAINT_NAME = rc.RDB$CONSTRAINT_NAME
			JOIN RDB$RELATION_CONSTRAINTS refrc ON refrc.RDB$CONSTRAINT_NAME = ref.RDB$CONST_NAME_UQ
			JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = rc.RDB$INDEX_NAME
			JOIN RDB$INDEX_SEGMENTS refs ON refs.RDB$INDEX_NAME = refrc.RDB$INDEX_NAME AND refs.RDB$FIELD_POSITION = s.RDB$FIELD_POSITION
			WHERE rc.RDB$RELATION_NAME = ? AND rc.RDB$CONSTRAINT_TYPE = 'FOREIGN KEY' ORDER BY rc.RDB$CONSTRAINT_NAME, s.RDB$FIELD_POSITION`, [table]);
		return groupFk(r.map(x => ({ name: x.NAME, column: x.COL, refTable: x.REFTABLE, refColumn: x.REFCOL, onUpdate: x.UPD, onDelete: x.DEL })));
	};
	const indexes = async table => groupIdx((await rows(`
		SELECT i.RDB$INDEX_NAME AS NAME, s.RDB$FIELD_NAME AS COL, COALESCE(i.RDB$UNIQUE_FLAG, 0) AS UNQ
		FROM RDB$INDICES i JOIN RDB$INDEX_SEGMENTS s ON s.RDB$INDEX_NAME = i.RDB$INDEX_NAME
		WHERE i.RDB$RELATION_NAME = ? ORDER BY i.RDB$INDEX_NAME, s.RDB$FIELD_POSITION`, [table])).map(x => ({ name: x.NAME, column: x.COL, unique: !!x.UNQ })));
	const TRIGGER_TYPES = { 1: 'BEFORE INSERT', 2: 'AFTER INSERT', 3: 'BEFORE UPDATE', 4: 'AFTER UPDATE', 5: 'BEFORE DELETE', 6: 'AFTER DELETE' };
	const triggerRows = async where => (await rows(`
		SELECT RDB$TRIGGER_NAME AS NAME, RDB$RELATION_NAME AS TBL, RDB$TRIGGER_TYPE AS TTYPE, RDB$TRIGGER_SEQUENCE AS SEQ, RDB$TRIGGER_INACTIVE AS INACTIVE,
		       CAST(RDB$TRIGGER_SOURCE AS VARCHAR(8000)) AS SRC
		FROM RDB$TRIGGERS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ${where} ORDER BY RDB$TRIGGER_NAME`, where ? undefined : [])).map(r => ({
		name: r.NAME, table: r.TBL, timing: TRIGGER_TYPES[r.TTYPE] || `tipo ${r.TTYPE}`, active: !r.INACTIVE,
		source: `CREATE OR ALTER TRIGGER ${r.NAME}${r.TBL ? ` FOR ${r.TBL}` : ''}\n${r.INACTIVE ? 'INACTIVE' : 'ACTIVE'} ${TRIGGER_TYPES[r.TTYPE] || ''} POSITION ${r.SEQ ?? 0}\n${r.SRC || ''}`,
	}));

	return {
		type: 'firebird',
		async query(sql) {
			const { result, meta } = await raw(sql);
			if (Array.isArray(result)) {
				const fields = meta?.length ? meta.map(m => m.alias || m.field) : undefined;
				return normalizeRows(result, fields);
			}
			if (result && typeof result === 'object') { return normalizeRows([result]); }
			return { columns: [], rows: [], affected: undefined };
		},
		tables: () => col('SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL ORDER BY 1'),
		views: () => col('SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NOT NULL ORDER BY 1'),
		procedures: () => col('SELECT RDB$PROCEDURE_NAME FROM RDB$PROCEDURES WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1'),
		sequences: () => col('SELECT RDB$GENERATOR_NAME FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1'),
		triggers: () => triggerRows(''),
		tableTriggers: table => triggerRows(`AND RDB$RELATION_NAME = '${String(table).replace(/'/g, '\'\'')}'`),
		columns, primaryKey, foreignKeys, indexes,
		async procedureSource(name) {
			// VARCHAR(8000): em UTF8 cada caractere ocupa até 4 bytes e o limite do Firebird é 32765 bytes
			const r = await rows('SELECT CAST(RDB$PROCEDURE_SOURCE AS VARCHAR(8000)) AS SRC FROM RDB$PROCEDURES WHERE RDB$PROCEDURE_NAME = ?', [name]);
			const params = await rows(`SELECT p.RDB$PARAMETER_NAME AS NAME, p.RDB$PARAMETER_TYPE AS PTYPE, f.RDB$FIELD_TYPE AS FTYPE, f.RDB$FIELD_SUB_TYPE AS SUBTYPE,
				f.RDB$FIELD_LENGTH AS FLEN, f.RDB$CHARACTER_LENGTH AS CLEN, f.RDB$FIELD_PRECISION AS FPREC, f.RDB$FIELD_SCALE AS FSCALE
				FROM RDB$PROCEDURE_PARAMETERS p JOIN RDB$FIELDS f ON f.RDB$FIELD_NAME = p.RDB$FIELD_SOURCE
				WHERE p.RDB$PROCEDURE_NAME = ? ORDER BY p.RDB$PARAMETER_TYPE, p.RDB$PARAMETER_NUMBER`, [name]).catch(() => []);
			const typeOf = r => {
				let t = FB_TYPES[r.FTYPE] || 'VARCHAR(100)';
				if (r.FSCALE < 0 && [7, 8, 16, 26].includes(r.FTYPE)) { t = `${r.SUBTYPE === 2 ? 'DECIMAL' : 'NUMERIC'}(${r.FPREC},${-r.FSCALE})`; }
				else if (r.FTYPE === 37 || r.FTYPE === 14) { t += `(${r.CLEN ?? r.FLEN})`; }
				return t;
			};
			const list = k => params.filter(p => p.PTYPE === k).map(p => `  ${String(p.NAME).trim()} ${typeOf(p)}`).join(',\n');
			const inp = list(0), out = list(1);
			return `CREATE OR ALTER PROCEDURE ${name}${inp ? ` (
${inp}
)` : ''}${out ? `
RETURNS (
${out}
)` : ''}
AS
${r[0]?.SRC || ''}`;
		},
		async viewSource(name) {
			const r = await rows('SELECT CAST(RDB$VIEW_SOURCE AS VARCHAR(8000)) AS SRC FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?', [name]);
			return `CREATE OR ALTER VIEW ${name} AS
${r[0]?.SRC || ''}`;
		},
		limitSql: (table, n) => `SELECT FIRST ${n} * FROM ${quoteFb(table)}`,
		countSql: table => `SELECT COUNT(*) AS TOTAL FROM ${quoteFb(table)}`,
		ddl: table => buildDdl(table, columns, primaryKey, foreignKeys, quoteFb),
		close: () => new Promise(r => db.detach(() => r())),
	};
}
const quoteFb = n => (/^[A-Z_][A-Z0-9_$]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`);

// ============================================================================ MySQL
async function connectMySQL(cfg) {
	const mysql = require('mysql2/promise');
	const conn = await mysql.createConnection({
		host: cfg.host || '127.0.0.1', port: +cfg.port || 3306, user: cfg.user || 'root', password: cfg.password || '',
		database: cfg.database || undefined, multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 10000,
	});
	const rows = async (sql, params) => (await conn.query(sql, params))[0];
	const db = () => cfg.database;
	const columns = async table => (await rows(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [table]))
		.map(r => ({ name: r.COLUMN_NAME, type: `${r.COLUMN_TYPE.toUpperCase()}${r.EXTRA ? ` ${r.EXTRA.toUpperCase()}` : ''}`, nullable: r.IS_NULLABLE === 'YES', default: r.COLUMN_DEFAULT }));
	const primaryKey = async table => (await rows(`SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`, [table])).map(r => r.COLUMN_NAME);
	const foreignKeys = async table => groupFk((await rows(`SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
		FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
		  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
		WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [table]))
		.map(r => ({ name: r.CONSTRAINT_NAME, column: r.COLUMN_NAME, refTable: r.REFERENCED_TABLE_NAME, refColumn: r.REFERENCED_COLUMN_NAME, onUpdate: r.UPDATE_RULE, onDelete: r.DELETE_RULE })));
	const indexes = async table => groupIdx((await rows(`SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [table])).map(r => ({ name: r.INDEX_NAME, column: r.COLUMN_NAME, unique: !+r.NON_UNIQUE })));
	const triggerRows = async table => (await rows(`SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS
		WHERE TRIGGER_SCHEMA = DATABASE() ${table ? 'AND EVENT_OBJECT_TABLE = ?' : ''} ORDER BY TRIGGER_NAME`, table ? [table] : []))
		.map(r => ({ name: r.TRIGGER_NAME, table: r.EVENT_OBJECT_TABLE, timing: `${r.ACTION_TIMING} ${r.EVENT_MANIPULATION}`, active: true,
			source: `CREATE TRIGGER ${r.TRIGGER_NAME} ${r.ACTION_TIMING} ${r.EVENT_MANIPULATION} ON ${r.EVENT_OBJECT_TABLE}\nFOR EACH ROW\n${r.ACTION_STATEMENT}` }));
	return {
		type: 'mysql',
		async query(sql) {
			const [result, fields] = await conn.query(sql);
			if (Array.isArray(result)) {
				if (Array.isArray(result[0]) || (result.length && result[0]?.constructor?.name === 'ResultSetHeader')) { return normalizeRows(Array.isArray(result[0]) ? result[0] : [], fields?.[0]?.map?.(f => f.name)); }
				return normalizeRows(result, fields?.map(f => f.name));
			}
			return { columns: [], rows: [], affected: result.affectedRows, info: result.info || (result.insertId ? `id gerado: ${result.insertId}` : '') };
		},
		tables: async () => (await rows(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1`)).map(r => r.TABLE_NAME),
		views: async () => (await rows(`SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1`)).map(r => r.TABLE_NAME),
		procedures: async () => (await rows(`SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY 1`)).map(r => r.ROUTINE_NAME),
		sequences: async () => [],
		triggers: () => triggerRows(),
		tableTriggers: table => triggerRows(table),
		columns, primaryKey, foreignKeys, indexes,
		async procedureSource(name) { const r = await rows(`SHOW CREATE PROCEDURE \`${name}\``).catch(() => rows(`SHOW CREATE FUNCTION \`${name}\``)); return r[0]?.['Create Procedure'] || r[0]?.['Create Function'] || ''; },
		async viewSource(name) { const r = await rows(`SHOW CREATE VIEW \`${name}\``); return r[0]?.['Create View'] || ''; },
		async ddl(table) { const r = await rows(`SHOW CREATE TABLE \`${table.replace(/`/g, '``')}\``); return `${r[0]?.['Create Table'] || ''};`; },
		limitSql: (table, n) => `SELECT * FROM \`${table}\` LIMIT ${n}`,
		countSql: table => `SELECT COUNT(*) AS TOTAL FROM \`${table}\``,
		databases: async () => (await rows('SHOW DATABASES')).map(r => r.Database),
		close: () => conn.end().catch(() => undefined),
		database: db,
	};
}

// ============================================================================ PostgreSQL
async function connectPostgres(cfg) {
	const { Client } = require('pg');
	const client = new Client({ host: cfg.host || '127.0.0.1', port: +cfg.port || 5432, user: cfg.user || 'postgres', password: cfg.password || '', database: cfg.database || 'postgres', connectionTimeoutMillis: 10000 });
	await client.connect();
	const schema = cfg.schema || 'public';
	const rows = async (sql, params) => (await client.query(sql, params)).rows;
	const columns = async table => (await rows(`SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
		FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, table]))
		.map(r => ({ name: r.column_name, type: `${r.data_type.toUpperCase()}${r.character_maximum_length ? `(${r.character_maximum_length})` : r.data_type === 'numeric' && r.numeric_precision ? `(${r.numeric_precision},${r.numeric_scale})` : ''}`, nullable: r.is_nullable === 'YES', default: r.column_default }));
	const primaryKey = async table => (await rows(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		WHERE i.indrelid = ($1 || '.' || quote_ident($2))::regclass AND i.indisprimary`, [schema, table])).map(r => r.attname);
	const foreignKeys = async table => groupFk((await rows(`SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column, rc.update_rule, rc.delete_rule
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
		JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
		JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
		WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`, [schema, table]))
		.map(r => ({ name: r.constraint_name, column: r.column_name, refTable: r.ref_table, refColumn: r.ref_column, onUpdate: r.update_rule, onDelete: r.delete_rule })));
	const indexes = async table => (await rows(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY 1`, [schema, table]))
		.map(r => ({ name: r.indexname, columns: (/\(([^)]+)\)/.exec(r.indexdef)?.[1] || '').split(',').map(s => s.trim()), unique: /UNIQUE/i.test(r.indexdef) }));
	const triggerRows = async table => (await rows(`SELECT t.tgname, c.relname, pg_get_triggerdef(t.oid, true) AS def, t.tgenabled
		FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE NOT t.tgisinternal AND n.nspname = $1 ${table ? 'AND c.relname = $2' : ''} ORDER BY 1`, table ? [schema, table] : [schema]))
		.map(r => ({ name: r.tgname, table: r.relname, timing: (/(BEFORE|AFTER|INSTEAD OF)\s+(.+?)\s+ON/i.exec(r.def) || []).slice(1).join(' '), active: r.tgenabled !== 'D', source: r.def }));
	return {
		type: 'postgres',
		async query(sql) {
			const res = await client.query({ text: sql, rowMode: 'array' });
			const last = Array.isArray(res) ? res[res.length - 1] : res;
			if (last.fields?.length) { return { columns: last.fields.map(f => f.name), rows: last.rows.map(r => r.map(toCell)) }; }
			return { columns: [], rows: [], affected: last.rowCount ?? undefined, info: last.command };
		},
		tables: async () => (await rows(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`, [schema])).map(r => r.table_name),
		views: async () => (await rows(`SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY 1`, [schema])).map(r => r.table_name),
		procedures: async () => (await rows(`SELECT DISTINCT routine_name FROM information_schema.routines WHERE routine_schema = $1 ORDER BY 1`, [schema])).map(r => r.routine_name),
		sequences: async () => (await rows(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY 1`, [schema])).map(r => r.sequence_name),
		triggers: () => triggerRows(),
		tableTriggers: table => triggerRows(table),
		columns, primaryKey, foreignKeys, indexes,
		async procedureSource(name) { const r = await rows(`SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = $2 LIMIT 1`, [schema, name]); return r[0]?.def || ''; },
		async viewSource(name) { const r = await rows(`SELECT pg_get_viewdef(($1 || '.' || quote_ident($2))::regclass, true) AS def`, [schema, name]); return `CREATE OR REPLACE VIEW ${name} AS\n${r[0]?.def || ''}`; },
		ddl: table => buildDdl(table, columns, primaryKey, foreignKeys, n => `"${n.replace(/"/g, '""')}"`),
		limitSql: (table, n) => `SELECT * FROM "${table}" LIMIT ${n}`,
		countSql: table => `SELECT COUNT(*) AS total FROM "${table}"`,
		close: () => client.end().catch(() => undefined),
	};
}

// ============================================================================ comum
function groupFk(list) {
	const map = new Map();
	for (const f of list) {
		if (!map.has(f.name)) { map.set(f.name, { name: f.name, columns: [], refTable: f.refTable, refColumns: [], onUpdate: f.onUpdate, onDelete: f.onDelete }); }
		map.get(f.name).columns.push(f.column); map.get(f.name).refColumns.push(f.refColumn);
	}
	return [...map.values()];
}
function groupIdx(list) {
	const map = new Map();
	for (const i of list) {
		if (!map.has(i.name)) { map.set(i.name, { name: i.name, columns: [], unique: i.unique }); }
		map.get(i.name).columns.push(i.column);
	}
	return [...map.values()];
}
async function buildDdl(table, columns, primaryKey, foreignKeys, q) {
	const [cols, pk, fks] = await Promise.all([columns(table), primaryKey(table), foreignKeys(table)]);
	const lines = cols.map(c => `  ${q(c.name)} ${c.type}${c.default !== null && c.default !== undefined ? ` DEFAULT ${c.default}` : ''}${c.nullable ? '' : ' NOT NULL'}`);
	if (pk.length) { lines.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`); }
	for (const f of fks) {
		lines.push(`  CONSTRAINT ${q(f.name)} FOREIGN KEY (${f.columns.map(q).join(', ')}) REFERENCES ${q(f.refTable)} (${f.refColumns.map(q).join(', ')})${f.onDelete && f.onDelete !== 'RESTRICT' && f.onDelete !== 'NO ACTION' ? ` ON DELETE ${f.onDelete}` : ''}${f.onUpdate && f.onUpdate !== 'RESTRICT' && f.onUpdate !== 'NO ACTION' ? ` ON UPDATE ${f.onUpdate}` : ''}`);
	}
	return `CREATE TABLE ${q(table)} (\n${lines.join(',\n')}\n);`;
}

/** Divide um script em instruções, respeitando strings, comentários e SET TERM (Firebird). */
function splitStatements(script, dialect) {
	const out = [];
	let term = ';';
	let buf = '';
	let start = 0;
	let i = 0;
	const push = end => { const sql = buf.trim(); if (sql) { out.push({ sql, start, end }); } buf = ''; };
	while (i < script.length) {
		if (!buf.trim()) { start = i; }
		const rest = script.slice(i);
		const setTerm = dialect === 'firebird' && !buf.trim() && /^\s*SET\s+TERM\s+(\S+)\s*(\S+)/i.exec(rest);
		if (setTerm) {
			const full = setTerm[0];
			// "SET TERM ^ ;"  /  "SET TERM ; ^"
			term = setTerm[1];
			i += full.length; buf = '';
			continue;
		}
		const ch = script[i];
		if (ch === '\'' || ch === '"' || (ch === '`' && dialect === 'mysql')) {
			const end = script.indexOf(ch, i + 1);
			const j = end < 0 ? script.length : end + 1;
			buf += script.slice(i, j); i = j; continue;
		}
		if (rest.startsWith('--') || (dialect === 'mysql' && rest.startsWith('#'))) {
			const end = script.indexOf('\n', i); const j = end < 0 ? script.length : end;
			buf += script.slice(i, j); i = j; continue;
		}
		if (rest.startsWith('/*')) {
			const end = script.indexOf('*/', i + 2); const j = end < 0 ? script.length : end + 2;
			buf += script.slice(i, j); i = j; continue;
		}
		if (dialect === 'postgres' && rest.startsWith('$$')) {
			const end = script.indexOf('$$', i + 2); const j = end < 0 ? script.length : end + 2;
			buf += script.slice(i, j); i = j; continue;
		}
		if (rest.startsWith(term)) { push(i); i += term.length; continue; }
		buf += ch; i++;
	}
	push(script.length);
	// remove instruções que são só comentário
	return out.filter(s => s.sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim());
}

// ============================================================================ SQLite (node:sqlite, embutido no Node do DEV CODE)
async function connectSQLite(cfg) {
	const { DatabaseSync } = require('node:sqlite');
	const conn = new DatabaseSync(cfg.database);
	conn.exec('PRAGMA foreign_keys = ON');
	const q = n => `"${String(n).replace(/"/g, '""')}"`;
	const rows = (sql, params = []) => conn.prepare(sql).all(...params);
	const names = type => rows(`SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY 1`, [type]).map(r => r.name);
	const columns = async table => rows(`PRAGMA table_info(${q(table)})`).map(r => ({ name: r.name, type: r.type || 'ANY', nullable: !r.notnull && !r.pk, default: r.dflt_value }));
	const primaryKey = async table => rows(`PRAGMA table_info(${q(table)})`).filter(r => r.pk).sort((a, b) => a.pk - b.pk).map(r => r.name);
	const foreignKeys = async table => groupFk(rows(`PRAGMA foreign_key_list(${q(table)})`).map(r => ({ name: `fk_${table}_${r.id}`, column: r.from, refTable: r.table, refColumn: r.to, onUpdate: r.on_update, onDelete: r.on_delete })));
	const indexes = async table => rows(`PRAGMA index_list(${q(table)})`).map(i => ({ name: i.name, columns: rows(`PRAGMA index_info(${q(i.name)})`).map(c => c.name), unique: !!i.unique }));
	const triggerRows = async table => rows(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ${table ? 'AND tbl_name = ?' : ''} ORDER BY 1`, table ? [table] : [])
		.map(r => ({ name: r.name, table: r.tbl_name, timing: (/\b(BEFORE|AFTER|INSTEAD OF)\s+(INSERT|UPDATE|DELETE)/i.exec(r.sql) || []).slice(1).join(' ').toUpperCase(), active: true, source: `${r.sql};` }));
	const source = name => rows(`SELECT sql FROM sqlite_master WHERE name = ?`, [name])[0]?.sql || '';
	return {
		type: 'sqlite',
		async query(sql) {
			const st = conn.prepare(sql);
			const cols = st.columns();
			if (cols.length) {
				st.setReturnArrays?.(true);
				const data = st.all();
				return { columns: cols.map(c => c.name), rows: data.map(r => (Array.isArray(r) ? r : Object.values(r)).map(toCell)) };
			}
			const res = st.run();
			return { columns: [], rows: [], affected: Number(res.changes), info: res.lastInsertRowid ? `id gerado: ${res.lastInsertRowid}` : '' };
		},
		tables: async () => names('table'),
		views: async () => names('view'),
		procedures: async () => [],
		sequences: async () => [],
		triggers: () => triggerRows(),
		tableTriggers: table => triggerRows(table),
		columns, primaryKey, foreignKeys, indexes,
		async procedureSource() { return ''; },
		async viewSource(name) { return `${source(name)};`; },
		async ddl(table) { return `${source(table)};`; },
		limitSql: (table, n) => `SELECT * FROM ${q(table)} LIMIT ${n}`,
		countSql: table => `SELECT COUNT(*) AS TOTAL FROM ${q(table)}`,
		close: async () => { try { conn.close(); } catch { } },
	};
}

async function connect(cfg) {
	switch (cfg.type) {
		case 'firebird': return connectFirebird(cfg);
		case 'mysql': return connectMySQL(cfg);
		case 'postgres': return connectPostgres(cfg);
		case 'sqlite': return connectSQLite(cfg);
		default: throw new Error(`Tipo de banco desconhecido: ${cfg.type}`);
	}
}

module.exports = { connect, splitStatements, TYPES };
