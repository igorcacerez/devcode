# DEV CODE - kernel Python para os notebooks (estilo Google Colab).
# Protocolo: uma mensagem JSON por linha.
#   entrada (stdin):  {"type":"exec","id":..,"code":..} | {"type":"input_reply","value":..}
#   saída (stdout):   stream | result | image | error | input_request | done | ready
# As variáveis ficam vivas entre as células (mesmo dicionário de globals), como no Colab.
import ast
import base64
import builtins
import io
import json
import linecache
import os
import sys
import traceback
import warnings

os.environ.setdefault('MPLBACKEND', 'Agg')
warnings.filterwarnings('ignore', message='.*non-interactive.*')
warnings.filterwarnings('ignore', message='.*FigureCanvasAgg.*')

_proto_out = sys.__stdout__
_proto_in = sys.__stdin__
_send_lock = None
CELL_FILE = '<célula>'


def send(msg):
    _proto_out.write(json.dumps(msg, ensure_ascii=False) + '\n')
    _proto_out.flush()


class Stream(io.TextIOBase):
    def __init__(self, name):
        self.name = name

    def writable(self):
        return True

    def write(self, text):
        if text:
            send({'type': 'stream', 'name': self.name, 'text': text})
        return len(text)

    def flush(self):
        pass

    @property
    def encoding(self):
        return 'utf-8'


def devcode_input(prompt=''):
    sys.stdout.flush()
    send({'type': 'input_request', 'prompt': str(prompt)})
    while True:
        line = _proto_in.readline()
        if not line:
            raise EOFError('entrada encerrada')
        msg = json.loads(line)
        if msg.get('type') == 'input_reply':
            value = msg.get('value', '')
            # ecoa o que foi digitado, igual ao terminal/Colab
            send({'type': 'stream', 'name': 'stdout', 'text': str(prompt) + value + '\n', 'echo': True})
            return value
        if msg.get('type') == 'interrupt':
            raise KeyboardInterrupt()


user_globals = {'__name__': '__main__', '__builtins__': builtins}
builtins.input = devcode_input


def send_figures():
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    try:
        for num in plt.get_fignums():
            fig = plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
            send({'type': 'image', 'mime': 'image/png', 'data': base64.b64encode(buf.getvalue()).decode('ascii')})
        plt.close('all')
    except Exception:
        pass


HINTS = {
    'ZeroDivisionError': 'Divisão por zero: o divisor não pode ser 0.',
    'NameError': 'Nome não definido: a variável/função foi criada antes? Confira a escrita (maiúsculas/minúsculas).',
    'SyntaxError': 'Erro de sintaxe: confira dois-pontos (:), parênteses e aspas.',
    'IndentationError': 'Erro de indentação: os blocos (if, for, def…) precisam estar alinhados com espaços.',
    'TypeError': 'Tipos incompatíveis: ex.: somar texto com número. Use int(), float() ou str() para converter.',
    'ValueError': 'Valor inválido: ex.: int("abc"). Confira o que foi digitado.',
    'IndexError': 'Índice fora da lista: lembre que o primeiro índice é 0 e o último é len(lista) - 1.',
    'KeyError': 'Chave inexistente no dicionário.',
    'AttributeError': 'Esse tipo de valor não tem esse método/atributo.',
    'ModuleNotFoundError': 'Biblioteca não instalada: instale no terminal com pip install <nome>.',
    'RecursionError': 'A função chamou ela mesma vezes demais (falta um caso de parada?).',
}


def run_cell(code):
    linecache.cache[CELL_FILE] = (len(code), None, [line + '\n' for line in code.splitlines()], CELL_FILE)
    tree = ast.parse(code, filename=CELL_FILE, mode='exec')
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(tree.body.pop().value)
    exec(compile(tree, CELL_FILE, 'exec'), user_globals)
    if last_expr is not None:
        value = eval(compile(last_expr, CELL_FILE, 'eval'), user_globals)
        if value is not None:
            user_globals['_'] = value
            send({'type': 'result', 'text': repr(value)})


def format_error(exc):
    tb = traceback.extract_tb(exc.__traceback__)
    # esconde as linhas internas do kernel: mostra só o que veio da célula do aluno
    tb = [f for f in tb if f.filename == CELL_FILE] or tb[-1:]
    lines = []
    for frame in tb:
        lines.append(f'  Linha {frame.lineno}' + (f', em {frame.name}' if frame.name != '<module>' else ''))
        if frame.line:
            lines.append(f'    {frame.line}')
    if isinstance(exc, SyntaxError):
        lines = [f'  Linha {exc.lineno}', f'    {(exc.text or "").rstrip()}', '    ' + ' ' * max((exc.offset or 1) - 1, 0) + '^']
    return '\n'.join(lines)


def main():
    sys.stdout = Stream('stdout')
    sys.stderr = Stream('stderr')
    send({'type': 'ready', 'version': sys.version.split()[0]})
    for line in _proto_in:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get('type') != 'exec':
            continue
        ok = True
        try:
            run_cell(msg.get('code', ''))
        except KeyboardInterrupt:
            ok = False
            send({'type': 'error', 'ename': 'KeyboardInterrupt', 'evalue': 'Execução interrompida', 'traceback': ''})
        except BaseException as exc:  # noqa: BLE001 - mostramos qualquer erro do aluno
            ok = False
            if isinstance(exc, SystemExit):
                send({'type': 'stream', 'name': 'stdout', 'text': f'[programa encerrado: exit({exc.code})]\n'})
                ok = True
            else:
                name = type(exc).__name__
                hint = HINTS.get(name, '')
                send({'type': 'error', 'ename': name, 'evalue': str(exc), 'traceback': format_error(exc) + (f'\n\n💡 {hint}' if hint else '')})
        finally:
            try:
                sys.stdout.flush()
            except Exception:
                pass
            send_figures()
            send({'type': 'done', 'id': msg.get('id'), 'ok': ok})


if __name__ == '__main__':
    main()
