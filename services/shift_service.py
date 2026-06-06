import re
from typing import Tuple, List, Optional
from core.models import Shift
from database.repositories import (
    add_shift as db_add_shift,
    update_shift as db_update_shift,
    delete_shift as db_delete_shift,
    get_active_shifts
)

def validate_hhmm(time_str: str) -> bool:
    """Verifica se uma string está no formato hh:mm válido."""
    if not time_str or not isinstance(time_str, str):
        return False
    return bool(re.match(r"^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$", time_str.strip()))

class ShiftService:
    """Serviço que gerencia o ciclo de vida e as validações de turnos de trabalho."""

    @staticmethod
    def create_shift(
        code: str,
        role: str,
        name: str,
        start_time: str,
        end_time: str,
        min_staff: int,
        max_staff: int,
        no_fds: bool = False
    ) -> Tuple[bool, str]:
        """Adiciona um novo turno realizando validações operacionais de formato e regras."""
        code = code.strip().upper()
        role = role.strip().upper()
        name = name.strip()
        start_time = start_time.strip()
        end_time = end_time.strip()

        if not code:
            return False, "O código do turno é obrigatório."
        if not name:
            return False, "O nome do turno é obrigatório."
        if role not in ["PAO", "APAO", "PAO FCF"]:
            return False, "Cargo inválido. Deve ser PAO, APAO ou PAO FCF."
        
        if not validate_hhmm(start_time):
            return False, f"Horário de início inválido: '{start_time}'. Use o formato HH:MM."
        if not validate_hhmm(end_time):
            return False, f"Horário de fim inválido: '{end_time}'. Use o formato HH:MM."

        if min_staff < 0:
            return False, "O staff mínimo não pode ser menor que zero."
        if max_staff < min_staff:
            return False, "O staff máximo não pode ser menor que o staff mínimo."

        try:
            db_add_shift(
                code=code,
                role=role,
                name=name,
                start_time=start_time,
                end_time=end_time,
                min_staff=min_staff,
                max_staff=max_staff,
                no_fds=1 if no_fds else 0
            )
            return True, "Turno cadastrado com sucesso."
        except Exception as e:
            return False, f"Erro ao persistir turno: {str(e)}"

    @staticmethod
    def update_shift(
        code: str,
        role: str,
        name: str,
        start_time: str,
        end_time: str,
        min_staff: int,
        max_staff: int,
        no_fds: bool = False
    ) -> Tuple[bool, str]:
        """Atualiza um turno existente realizando validações de formato e regras."""
        code = code.strip().upper()
        role = role.strip().upper()
        name = name.strip()
        start_time = start_time.strip()
        end_time = end_time.strip()

        if not code:
            return False, "O código do turno é obrigatório."
        if not name:
            return False, "O nome do turno é obrigatório."
        if role not in ["PAO", "APAO", "PAO FCF"]:
            return False, "Cargo inválido. Deve ser PAO, APAO ou PAO FCF."

        if not validate_hhmm(start_time):
            return False, f"Horário de início inválido: '{start_time}'. Use o formato HH:MM."
        if not validate_hhmm(end_time):
            return False, f"Horário de fim inválido: '{end_time}'. Use o formato HH:MM."

        if min_staff < 0:
            return False, "O staff mínimo não pode ser menor que zero."
        if max_staff < min_staff:
            return False, "O staff máximo não pode ser menor que o staff mínimo."

        try:
            db_update_shift(
                code=code,
                role=role,
                name=name,
                start_time=start_time,
                end_time=end_time,
                min_staff=min_staff,
                max_staff=max_staff,
                no_fds=1 if no_fds else 0
            )
            return True, "Turno atualizado com sucesso."
        except Exception as e:
            return False, f"Erro ao atualizar turno: {str(e)}"

    @staticmethod
    def delete_shift(code: str) -> Tuple[bool, str]:
        """Exclui o turno do sistema de forma segura (soft-delete)."""
        code = code.strip().upper()
        if not code:
            return False, "O código do turno é obrigatório."
        try:
            db_delete_shift(code)
            return True, "Turno excluído com sucesso (backup gerado)."
        except Exception as e:
            return False, f"Erro ao excluir turno: {str(e)}"

    @staticmethod
    def get_all_shifts() -> List[Shift]:
        """Retorna todos os turnos ativos."""
        return get_active_shifts()
