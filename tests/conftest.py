import pytest
import os
from pathlib import Path
from datetime import date, timedelta
from database.connection import set_db_path, init_db, get_conn
from database.repositories import add_employee, add_shift, add_allocation, add_assignment

@pytest.fixture(autouse=True)
def setup_in_memory_db():
    """Redireciona e inicializa o banco SQLite em arquivo temporário para isolamento total nos testes."""
    db_file = Path("tests/test_escala.db")
    if db_file.exists():
        try:
            db_file.unlink()
        except Exception:
            pass
            
    set_db_path(str(db_file.resolve()))
    init_db()
    
    # 1. Popula funcionários de teste
    # PAOs (Pilotos de Apoio)
    add_employee("PAO SILVA", "PAO", seniority=1, fixed_shift_code=None, is_fixed_shift=0, notes="Mock PAO 1")
    add_employee("PAO SANTOS", "PAO", seniority=2, fixed_shift_code=None, is_fixed_shift=0, notes="Mock PAO 2")
    add_employee("PAO OLIVEIRA", "PAO", seniority=3, fixed_shift_code=None, is_fixed_shift=0, notes="Mock PAO 3")
    
    # APAOs (Auxiliares de Piloto de Apoio)
    add_employee("APAO LIMA", "APAO", seniority=1, fixed_shift_code=None, is_fixed_shift=0, notes="Mock APAO 1")
    add_employee("APAO COSTA", "APAO", seniority=2, fixed_shift_code=None, is_fixed_shift=0, notes="Mock APAO 2")
    
    yield
    
    # Tenta remover o arquivo após o teste
    if db_file.exists():
        try:
            db_file.unlink()
        except Exception:
            pass
