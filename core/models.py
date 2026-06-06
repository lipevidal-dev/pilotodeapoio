from dataclasses import dataclass, asdict
from typing import Optional, Any
import sqlite3

@dataclass
class Employee:
    id: int
    name: str
    role: str
    seniority: int
    fixed_shift_code: Optional[str] = None
    is_fixed_shift: bool = False
    active: bool = True
    no_flight: bool = False
    no_flight_start: Optional[str] = None
    no_flight_end: Optional[str] = None
    no_flight_indefinite: bool = False
    notes: str = ""

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> 'Employee':
        """Constrói um Employee a partir de um sqlite3.Row."""
        return cls(
            id=int(row["id"]),
            name=str(row["name"]),
            role=str(row["role"]),
            seniority=int(row["seniority"]),
            fixed_shift_code=row["fixed_shift_code"],
            is_fixed_shift=bool(row["is_fixed_shift"]),
            active=bool(row["active"]),
            no_flight=bool(row["no_flight"]),
            no_flight_start=row["no_flight_start"],
            no_flight_end=row["no_flight_end"],
            no_flight_indefinite=bool(row["no_flight_indefinite"]),
            notes=str(row["notes"] or ""),
        )

    def to_dict(self) -> dict[str, Any]:
        """Converte o modelo de domínio em dicionário para compatibilidade legada."""
        d = asdict(self)
        # Ajusta chaves para bater exatamente com a nomenclatura esperada pelo validador core/rules
        d["nome"] = self.name
        d["cargo"] = self.role
        d["senioridade"] = self.seniority
        d["turno_fixo"] = self.fixed_shift_code
        d["fixo"] = 1 if self.is_fixed_shift else 0
        d["ativo"] = 1 if self.active else 0
        d["sem_voo"] = 1 if self.no_flight else 0
        d["sem_voo_inicio"] = self.no_flight_start
        d["sem_voo_fim"] = self.no_flight_end
        d["sem_voo_indeterminado"] = 1 if self.no_flight_indefinite else 0
        d["observacao"] = self.notes
        return d


@dataclass
class Shift:
    id: int
    code: str
    role: str
    name: str
    start_time: str
    end_time: str
    min_staff: int = 1
    max_staff: int = 1
    active: bool = True
    no_fds: bool = False

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> 'Shift':
        """Constrói um Shift a partir de um sqlite3.Row."""
        return cls(
            id=int(row["id"]),
            code=str(row["code"]),
            role=str(row["role"]),
            name=str(row["name"]),
            start_time=str(row["start_time"]),
            end_time=str(row["end_time"]),
            min_staff=int(row["min_staff"]),
            max_staff=int(row["max_staff"]),
            active=bool(row["active"]),
            no_fds=bool(row.get("no_fds", 0)),
        )

    def to_dict(self) -> dict[str, Any]:
        """Converte o turno em dicionário compatível com lógica legada de validação."""
        d = asdict(self)
        d["codigo"] = self.code
        d["cargo"] = self.role
        d["nome"] = self.name
        d["inicio"] = self.start_time
        d["fim"] = self.end_time
        d["minimo"] = self.min_staff
        d["maximo"] = self.max_staff
        d["ativo"] = 1 if self.active else 0
        d["no_fds"] = 1 if self.no_fds else 0
        return d
