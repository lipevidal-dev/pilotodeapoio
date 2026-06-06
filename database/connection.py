import sqlite3
import shutil
from pathlib import Path
from datetime import datetime
import pandas as pd

# Caminhos padrão do banco de dados local
USER_HOME = Path.home()
PERSIST_DIR = USER_HOME / "Sistema_Escala_PAO_APAO_Dados"
PERSIST_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_DB_PATH = PERSIST_DIR / "escala.db"
BACKUP_DIR = PERSIST_DIR / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# Caminho ativo (pode ser substituído em testes unitários por :memory:)
_active_db_path = DEFAULT_DB_PATH

def set_db_path(path):
    """Define o caminho do banco de dados ativo (útil para testes com :memory:)."""
    global _active_db_path
    _active_db_path = path

def get_db_path():
    """Retorna o caminho do banco de dados ativo."""
    return _active_db_path

def backup_db(reason="auto"):
    """Cria um backup de segurança do banco sqlite local atual."""
    active_path = get_db_path()
    # Não faz backup para bancos em memória
    if str(active_path) == ":memory:" or not Path(active_path).exists():
        return None
    try:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = BACKUP_DIR / f"escala_backup_{reason}_{stamp}.db"
        shutil.copy2(active_path, dest)
        return dest
    except Exception:
        return None

def get_conn():
    """Retorna uma conexão sqlite3 com row_factory configurada."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    return conn

def execute(sql, params=()):
    """Executa um comando SQL (INSERT/UPDATE/DELETE) e realiza commit."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        conn.commit()
    finally:
        conn.close()

def query_df(sql, params=()):
    """Executa uma query SQL e retorna os dados em um DataFrame do Pandas."""
    conn = get_conn()
    try:
        df = pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()
    return df

def ensure_column(table, column, definition):
    """Garante de forma segura que uma coluna específica exista em uma tabela."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({table})")
        cols = [row[1] for row in cur.fetchall()]
        if column not in cols:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            conn.commit()
    finally:
        conn.close()

def init_db():
    """Inicializa as tabelas do banco de dados sqlite por meio de migrações estruturadas."""
    from database.migrations import run_migrations
    conn = get_conn()
    try:
        run_migrations(conn)
    finally:
        conn.close()
