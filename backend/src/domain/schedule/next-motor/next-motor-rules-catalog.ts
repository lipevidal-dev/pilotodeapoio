export type NextMotorRuleCategory =
  | "bloqueios"
  | "preferencias"
  | "cobertura"
  | "pao"
  | "apao"
  | "validacao";

export interface NextMotorRuleDefinition {
  id: string;
  label: string;
  description: string;
  category: NextMotorRuleCategory;
  defaultEnabled: boolean;
  /** Regra inviolável — não pode ser desativada na UI. */
  locked: boolean;
}

export const NEXT_MOTOR_RULES_CATALOG: readonly NextMotorRuleDefinition[] = [
  {
    id: "calendar_blocks",
    label: "Bloqueios de calendário",
    description: "Férias, folgas pedidas, voos e cadastros operacionais bloqueiam alocação de turno.",
    category: "bloqueios",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "locked_preallocations",
    label: "Pré-alocações fixas",
    description: "Respeita pré-alocações travadas antes da geração automática.",
    category: "bloqueios",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "cross_month_12h",
    label: "Descanso 12h entre meses",
    description: "Considera turnos do último dia do mês anterior ao validar descanso mínimo.",
    category: "bloqueios",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "fcf_weekday_shift",
    label: "Preferência FCF por dia",
    description: "Funcionários FCF recebem o turno desejado nos dias da semana configurados.",
    category: "preferencias",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "shift_restrictions",
    label: "Restrições de turno",
    description: "Não aloca turnos marcados como restritos no cadastro do funcionário.",
    category: "preferencias",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "preferred_shifts",
    label: "Preferência principal de turno",
    description:
      "Respeita T6/T7/T8/T9 conforme preferência no cadastro do funcionário (inclui T9 como turno normal).",
    category: "preferencias",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "coverage_t6",
    label: "Cobertura T6",
    description: "Garante ao menos um PAO em T6 nos dias exigidos.",
    category: "cobertura",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "coverage_t7",
    label: "Cobertura T7",
    description: "Garante ao menos um PAO em T7 nos dias exigidos.",
    category: "cobertura",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "coverage_t8",
    label: "Cobertura T8",
    description: "Garante ao menos um PAO em T8 nos dias exigidos.",
    category: "cobertura",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "coverage_t9",
    label: "Cobertura T9",
    description:
      "Garante cobertura T9 nos dias exigidos. Quem recebe T9 é definido no cadastro do funcionário.",
    category: "cobertura",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "t8_t8_nd",
    label: "T8, T8, ND",
    description: "Após dois T8 consecutivos, aplica ND no terceiro dia.",
    category: "pao",
    defaultEnabled: true,
    locked: true,
  },
  {
    id: "min_12h_rest",
    label: "12h entre turnos",
    description: "Respeita intervalo mínimo de 12 horas entre turnos consecutivos.",
    category: "pao",
    defaultEnabled: true,
    locked: true,
  },
  {
    id: "max_6_consecutive",
    label: "Máximo 6 dias consecutivos",
    description: "Limita sequências de dias trabalhados a no máximo 6.",
    category: "pao",
    defaultEnabled: true,
    locked: true,
  },
  {
    id: "pao_meta_turnos",
    label: "PAO — meta de turnos",
    description: "Busca atingir a meta de turnos alocados por PAO no mês (valor configurável).",
    category: "pao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "pao_meta_dias_trabalhados",
    label: "PAO — meta de dias trabalhados",
    description:
      "Busca atingir a meta de dias produtivos por PAO (turnos + atividades operacionais).",
    category: "pao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "pao_espacamento_turnos",
    label: "PAO — espaçamento entre turnos",
    description:
      "Deixa N dias em branco entre turnos alocados no mês; dias já ocupados são pulados.",
    category: "pao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "pao_10_folgas",
    label: "PAO — 10 folgas",
    description: "Busca atingir 10 folgas por PAO no mês.",
    category: "pao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "pao_1_folga_social",
    label: "PAO — 1 folga social",
    description: "Aloca folga social (fim de semana) conforme regra operacional.",
    category: "pao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "apao_regime_6x1",
    label: "APAO — regime 6x1",
    description: "Aplica escala 6x1 para auxiliares após geração PAO.",
    category: "apao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "apao_folga_agrupada",
    label: "APAO — folga agrupada",
    description: "Distribui folgas agrupadas (FA) para APAO.",
    category: "apao",
    defaultEnabled: true,
    locked: false,
  },
  {
    id: "can_work_gate",
    label: "Validação can_work",
    description: "Nunca ignora can_work / elegibilidade para preencher lacunas.",
    category: "validacao",
    defaultEnabled: true,
    locked: true,
  },
  {
    id: "no_generic_nd_fill",
    label: "Sem ND genérico",
    description: "ND só via regra T8/T8 ou reparo oficial — nunca ND em buraco arbitrário.",
    category: "validacao",
    defaultEnabled: true,
    locked: true,
  },
] as const;

export type NextMotorRuleId = (typeof NEXT_MOTOR_RULES_CATALOG)[number]["id"];

const catalogById = new Map(NEXT_MOTOR_RULES_CATALOG.map((r) => [r.id, r]));

export function defaultNextMotorEnabledMap(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const rule of NEXT_MOTOR_RULES_CATALOG) {
    out[rule.id] = rule.defaultEnabled;
  }
  return out;
}

export function mergeNextMotorEnabled(
  stored: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const merged = defaultNextMotorEnabledMap();
  if (!stored) return merged;
  for (const rule of NEXT_MOTOR_RULES_CATALOG) {
    if (typeof stored[rule.id] === "boolean") {
      merged[rule.id] = rule.locked ? true : stored[rule.id];
    }
  }
  for (const [id, enabled] of Object.entries(stored)) {
    if (id.startsWith("pao_shift_rule__") && typeof enabled === "boolean") {
      merged[id] = enabled;
    }
  }
  return merged;
}

export function sanitizeNextMotorPatch(
  patch: Record<string, boolean>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(patch)) {
    const def = catalogById.get(id);
    if (def) {
      if (!def.locked) out[id] = Boolean(enabled);
      continue;
    }
    if (id.startsWith("pao_shift_rule__")) {
      out[id] = Boolean(enabled);
    }
  }
  return out;
}

export interface NextMotorRuleView {
  id: string;
  label: string;
  description: string;
  category: NextMotorRuleCategory;
  enabled: boolean;
  locked: boolean;
}

export function buildNextMotorRulesView(
  enabledMap: Record<string, boolean>,
): NextMotorRuleView[] {
  return NEXT_MOTOR_RULES_CATALOG.map((rule) => ({
    id: rule.id,
    label: rule.label,
    description: rule.description,
    category: rule.category,
    enabled: enabledMap[rule.id] ?? rule.defaultEnabled,
    locked: rule.locked,
  }));
}

export const NEXT_MOTOR_CATEGORY_LABELS: Record<NextMotorRuleCategory, string> = {
  bloqueios: "Bloqueios",
  preferencias: "Preferências",
  cobertura: "Cobertura PAO",
  pao: "Metas e regras PAO",
  apao: "Regras APAO",
  validacao: "Validação",
};

export const NEXT_MOTOR_CONFIG_KEY = "next_motor_rules";
