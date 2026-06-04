import sqlite3
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

def migrate_v1_base_schema(conn):
    """Criação das tabelas fundamentais."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seniority INTEGER NOT NULL,
            name TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK(role IN ('PAO','APAO','PAO FCF')),
            fixed_shift_code TEXT,
            is_fixed_shift INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            no_flight INTEGER NOT NULL DEFAULT 0,
            no_flight_start TEXT,
            no_flight_end TEXT,
            no_flight_indefinite INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK(role IN ('PAO','APAO','PAO FCF')),
            name TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            min_staff INTEGER NOT NULL DEFAULT 1,
            max_staff INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1,
            no_fds INTEGER NOT NULL DEFAULT 0
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_date TEXT NOT NULL,
            shift_code TEXT NOT NULL,
            employee_id INTEGER NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(employee_id) REFERENCES employees(id),
            UNIQUE(work_date, shift_code, employee_id)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS allocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            alloc_date TEXT NOT NULL,
            alloc_type TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(employee_id) REFERENCES employees(id),
            UNIQUE(employee_id, alloc_date)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS shift_restrictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            shift_code TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(employee_id) REFERENCES employees(id),
            UNIQUE(employee_id, year, month, shift_code)
        )
    """)

def migrate_v2_pao_fcf_constraints(conn):
    """Garante colunas de restrição de voo e turno."""
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(employees)")
    cols = [r[1] for r in cur.fetchall()]
    if "no_flight" not in cols:
        cur.execute("ALTER TABLE employees ADD COLUMN no_flight INTEGER NOT NULL DEFAULT 0")
    if "no_flight_start" not in cols:
        cur.execute("ALTER TABLE employees ADD COLUMN no_flight_start TEXT")
    if "no_flight_end" not in cols:
        cur.execute("ALTER TABLE employees ADD COLUMN no_flight_end TEXT")
    if "no_flight_indefinite" not in cols:
        cur.execute("ALTER TABLE employees ADD COLUMN no_flight_indefinite INTEGER NOT NULL DEFAULT 0")

    cur.execute("PRAGMA table_info(shifts)")
    sh_cols = [r[1] for r in cur.fetchall()]
    if "no_fds" not in sh_cols:
        cur.execute("ALTER TABLE shifts ADD COLUMN no_fds INTEGER NOT NULL DEFAULT 0")

def migrate_v3_default_shifts(conn):
    """Insere os turnos padrão."""
    default_shifts = [
        ("T8", "PAO", "Turno 8 PAO", "22:00", "06:00", 1, 1),
        ("T6", "PAO", "Turno 6 PAO", "06:00", "14:00", 1, 1),
        ("T7", "PAO", "Turno 7 PAO", "14:00", "22:00", 1, 1),
        ("T1", "APAO", "Turno 1 APAO", "00:00", "06:00", 1, 1),
        ("T2", "APAO", "Turno 2 APAO", "06:00", "12:00", 1, 1),
        ("T3", "APAO", "Turno 3 APAO", "12:00", "18:00", 1, 1),
        ("T4", "APAO", "Turno 4 APAO", "18:00", "00:00", 1, 1),
    ]
    cur = conn.cursor()
    for code, role, name, start, end, min_staff, max_staff in default_shifts:
        cur.execute("""
            INSERT OR IGNORE INTO shifts (code, role, name, start_time, end_time, min_staff, max_staff, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        """, (code, role, name, start, end, min_staff, max_staff))
        cur.execute("UPDATE shifts SET min_staff = 1, max_staff = 1 WHERE code = ?", (code,))

def migrate_v4_historical_data_normalization(conn):
    """Normaliza nomes de tipos de folga."""
    cur = conn.cursor()
    cur.execute("UPDATE allocations SET alloc_type = 'FOLGA PEDIDA' WHERE alloc_type = 'FOLGA ESCOLHIDA'")

def migrate_v5_performance_indices(conn):
    """MELHORIA DE VELOCIDADE: Cria índices para buscas rápidas."""
    cur = conn.cursor()
    cur.execute("CREATE INDEX IF NOT EXISTS idx_assignments_date ON assignments(work_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_allocations_date ON allocations(alloc_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_assignments_emp ON assignments(employee_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_allocations_emp ON allocations(employee_id)")

def run_migrations(conn):
    """Executa todas as migrações em ordem."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    """)
    conn.commit()

    cur.execute("SELECT MAX(version) FROM schema_version")
    row = cur.fetchone()
    current_version = row[0] if row and row[0] is not None else 0

    migrations = {
        1: migrate_v1_base_schema,
        2: migrate_v2_pao_fcf_constraints,
        3: migrate_v3_default_shifts,
        4: migrate_v4_historical_data_normalization,
        5: migrate_v5_performance_indices,
    }

    for version in sorted(migrations.keys()):
        if version > current_version:
            logger.info(f"Aplicando migração v{version}...")
            migrations[version](conn)
            cur.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                (version, datetime.now().isoformat())
            )
            conn.commit()