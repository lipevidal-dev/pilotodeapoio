import type { ManualEditConflict } from "../../domain/schedule/manual-edit-types.js";

export class ManualEditBlockedError extends Error {
  readonly code = "MANUAL_EDIT_BLOCKED";
  constructor(readonly conflicts: ManualEditConflict[]) {
    super(conflicts[0]?.message ?? "Edição manual bloqueada por conflito.");
    this.name = "ManualEditBlockedError";
  }
}

export class SchedulePublishedCannotEditError extends Error {
  readonly code = "PUBLISHED_SCHEDULE_CANNOT_EDIT";
  constructor() {
    super("Escala publicada não pode ser editada manualmente.");
    this.name = "SchedulePublishedCannotEditError";
  }
}
