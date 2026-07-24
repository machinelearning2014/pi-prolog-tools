"""
Sandboxed Python executor — adapted from evo-ai's tools/python_executor.py
for use as a pi coding agent custom tool backend.

Usage: python3 sandbox_python.py <code_file>
Reads Python code from the given file, wraps it in sandbox protections,
executes it, and prints a JSON result line to stdout.
"""

import sys
import os
import builtins as _builtins
import signal

TIMEOUT_SECONDS = 30
MAX_OUTPUT = 1_000_000  # 1MB

# ---------------------------------------------------------------------------
# Blocked modules — dangerous for sandboxed execution
# ---------------------------------------------------------------------------
_BLOCKED_MODULES = frozenset({
    "socket", "http", "urllib", "requests",
    "ftplib", "smtplib", "imaplib", "poplib", "telnetlib", "xmlrpc",
    "webbrowser", "antigravity",
    "compileall", "py_compile",
})

# ---------------------------------------------------------------------------
# Phase 1: Trusted library imports — NO restrictions active yet.
# ---------------------------------------------------------------------------
TRUSTED_IMPORTS = """\
import math
import json
import random
from fractions import Fraction
from decimal import Decimal
try:
    import sympy
    from sympy import (
        symbols, Symbol, solve, simplify, expand, factor,
        diff, integrate, limit, series, summation,
        sin, cos, tan, log, exp, sqrt, pi, E, I, oo,
        Rational, Matrix, Eq, Function, Piecewise,
        prime, isprime, factorint, divisors, gcd, lcm,
        N as numerical_eval,
    )
    a, b, c, d, k, m, n, p, q, r, s, t, x, y, z = symbols(
        'a b c d k m n p q r s t x y z'
    )
except ImportError:
    pass
try:
    import numpy as np
except ImportError:
    pass
try:
    import scipy
    import scipy.optimize
    import scipy.integrate
    import scipy.stats
    import scipy.linalg
    import scipy.special
    import scipy.sparse
    import scipy.interpolate
except ImportError:
    pass
try:
    import sklearn
    import sklearn.linear_model
    import sklearn.metrics
    import sklearn.model_selection
    import sklearn.preprocessing
    import sklearn.decomposition
    import sklearn.cluster
    import sklearn.ensemble
except ImportError:
    pass
"""

# ---------------------------------------------------------------------------
# Phase 2: Sandbox restrictions
# ---------------------------------------------------------------------------
SANDBOX_SETUP = """\
import builtins as _builtins

# ---- Import blocklist ----
_BLOCKED_MODULES = """ + repr(set(_BLOCKED_MODULES)) + """

_original_import = _builtins.__import__

def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    top = name.split('.')[0]
    if name in _BLOCKED_MODULES or top in _BLOCKED_MODULES:
        raise ImportError(f"Module '{name}' is not allowed in sandboxed execution")
    return _original_import(name, globals, locals, fromlist, level)

_builtins.__import__ = _restricted_import

# Block dangerous os/sys operations
import os as _os
def _blocked(*a, **kw):
    raise PermissionError("This operation is not allowed in sandboxed execution")

for _attr in ('system', 'popen', 'exec', 'execl', 'execle', 'execlp',
              'execv', 'execve', 'execvp', 'execvpe', 'spawn', 'spawnl',
              'spawnle', 'fork', 'forkpty', 'kill', 'killpg', 'remove',
              'unlink', 'rmdir', 'rename', 'link', 'symlink', 'chdir',
              'chroot', 'chmod', 'chown', 'makedirs', 'mkdir'):
    if hasattr(_os, _attr):
        setattr(_os, _attr, _blocked)

_os.environ = {}

import sys as _sys
_sys.exit = _blocked

# ---- Restrict open() to block file writes ----
_original_open = _builtins.open

def _restricted_open(file, mode='r', *args, **kwargs):
    mode_str = str(mode)
    if any(c in mode_str for c in ('w', 'a', 'x', '+')):
        raise PermissionError("File write operations are not allowed in sandboxed execution")
    return _original_open(file, mode, *args, **kwargs)

_builtins.open = _restricted_open

# Neuter subprocess, shutil, multiprocessing
import subprocess as _subprocess
def _blocked_method(*a, **kw):
    raise PermissionError("This operation is not allowed in sandboxed execution")
_subprocess.run = _blocked_method
_subprocess.call = _blocked_method
_subprocess.check_call = _blocked_method
_subprocess.check_output = _blocked_method
_subprocess.Popen = _blocked_method

import shutil as _shutil
_shutil.rmtree = _blocked_method
_shutil.move = _blocked_method
_shutil.copy = _blocked_method
_shutil.copy2 = _blocked_method
_shutil.copytree = _blocked_method

try:
    import multiprocessing as _mp
    _mp.Process = _blocked_method
    _mp.Pool = _blocked_method
    _mp.set_start_method = _blocked_method
    if hasattr(_mp, 'set_forkserver_preload'):
        _mp.set_forkserver_preload = _blocked_method
except ImportError:
    pass

try:
    import code as _code_mod
    _code_mod.interact = _blocked_method
    _code_mod.InteractiveConsole = _blocked_method
except ImportError:
    pass
"""


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "output": "", "error": "No code file provided"}))
        sys.exit(1)

    code_file = sys.argv[1]
    try:
        with open(code_file, "r", encoding="utf-8") as f:
            user_code = f.read()
    except Exception as e:
        print(json.dumps({"success": False, "output": "", "error": f"Cannot read code file: {e}"}))
        sys.exit(1)

    # Build the full program: trusted imports + sandbox setup + user code
    full_code = TRUSTED_IMPORTS + "\n" + SANDBOX_SETUP + "\n" + user_code

    # Write to a temp file and execute in a subprocess for isolation
    import tempfile
    import subprocess
    import json

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(full_code)
        tmp_path = f.name

    try:
        # Build minimal environment
        keep = {"PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE",
                "VIRTUAL_ENV", "PYTHONPATH"}
        safe_env = {k: v for k, v in os.environ.items() if k in keep}

        proc = subprocess.Popen(
            [sys.executable, "-I", tmp_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=safe_env,
            start_new_session=True,
        )
        try:
            stdout, stderr = proc.communicate(timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            # Kill process tree
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
            try:
                proc.kill()
            except OSError:
                pass
            print(json.dumps({
                "success": False,
                "output": "",
                "error": f"Execution timed out ({TIMEOUT_SECONDS}s limit)",
            }))
            sys.exit(0)

        stderr = stderr.strip()

        # Truncate overly large output
        if len(stdout) > MAX_OUTPUT:
            stdout = stdout[:MAX_OUTPUT] + "\n... [output truncated]"

        if proc.returncode != 0:
            print(json.dumps({
                "success": False,
                "output": stdout.strip(),
                "error": stderr or f"Process exited with code {proc.returncode}",
            }))
        else:
            print(json.dumps({
                "success": True,
                "output": stdout.strip(),
                "error": "",
            }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "output": "",
            "error": f"Execution error: {e}",
        }))
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    main()
