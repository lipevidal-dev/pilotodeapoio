export class PublishedScheduleCannotRegenerateError extends Error {
  readonly code = "PUBLISHED_SCHEDULE";
  constructor(year: number, month: number) {
    super(
      `Escala ${year}-${String(month).padStart(2, "0")} está publicada. Arquivar ou despublicar antes de regenerar.`,
    );
    this.name = "PublishedScheduleCannotRegenerateError";
  }
}

export class ScheduleMonthNotFoundError extends Error {
  readonly code = "SCHEDULE_NOT_FOUND";
  constructor(id: string) {
    super(`Escala não encontrada: ${id}`);
    this.name = "ScheduleMonthNotFoundError";
  }
}

export class ScheduleNotPublishedError extends Error {
  readonly code = "NOT_PUBLISHED";
  constructor(year: number, month: number) {
    super(`Não há escala publicada para ${year}-${String(month).padStart(2, "0")}.`);
    this.name = "ScheduleNotPublishedError";
  }
}

export class ScheduleCannotPublishError extends Error {
  readonly code = "CANNOT_PUBLISH";
  constructor(message: string) {
    super(message);
    this.name = "ScheduleCannotPublishError";
  }
}

export interface CriticalViolationDto {
  level: "CRITICAL";
  ruleCode: string;
  message: string;
  date: string;
  employee: string;
  detail: string;
}

export class PublishedScheduleCannotBeClearedError extends Error {
  readonly code = "PUBLISHED_SCHEDULE_CANNOT_BE_CLEARED";
  constructor() {
    super("Escala publicada não pode ser limpa. Arquivar ou despublicar antes.");
    this.name = "PublishedScheduleCannotBeClearedError";
  }
}

export class ScheduleNotGeneratedError extends Error {
  readonly code = "SCHEDULE_NOT_GENERATED";
  constructor(status: string) {
    super(`Somente escalas com status GENERATED podem ser limpas (atual: ${status}).`);
    this.name = "ScheduleNotGeneratedError";
  }
}

export class PublishBlockedCriticalViolationsError extends Error {
  readonly code = "PUBLISH_BLOCKED_CRITICAL_VIOLATIONS";
  constructor(readonly criticalViolations: CriticalViolationDto[]) {
    super("A escala possui violações críticas e não pode ser publicada.");
    this.name = "PublishBlockedCriticalViolationsError";
  }
}
