import fs from "fs";

const root = process.argv[2] || "/app/dist";

function patch(file, replacements) {
  const path = `${root}/${file}`;
  if (!fs.existsSync(path)) {
    console.log("skip missing", file);
    return;
  }
  let text = fs.readFileSync(path, "utf8");
  const orig = text;
  for (const [needle, repl] of replacements) {
    if (text.includes(repl)) continue;
    if (!text.includes(needle)) {
      console.log("needle missing in", file, JSON.stringify(needle).slice(0, 80));
      continue;
    }
    text = text.replaceAll(needle, repl);
  }
  if (text !== orig) {
    fs.writeFileSync(path, text);
    console.log("patched", file);
  } else {
    console.log("unchanged", file);
  }
}

patch("interfaces/http/dto/manual-schedule-edit.dto.js", [
  ['    "FOLGA",\n    "FS",', '    "FOLGA",\n    "F4",\n    "FS",'],
]);

patch("domain/schedule/manual-edit-types.js", [
  ['    "FOLGA",\n    "FS",', '    "FOLGA",\n    "F4",\n    "FS",'],
  [
    '        case "FOLGA":\n            return "FOLGA";\n        case "FS":',
    '        case "FOLGA":\n            return "FOLGA";\n        case "F4":\n            return "FOLGA 4";\n        case "FS":',
  ],
]);

patch("domain/rules/constants.js", [
  ['    "FOLGA",\n    "FOLGA SOCIAL",', '    "FOLGA",\n    "FOLGA 4",\n    "F4",\n    "FOLGA SOCIAL",'],
]);

patch("domain/schedule/operational-labels.js", [
  [
    '    "FOLGA ESCOLHIDA",\n    CROSS_MONTH_ND_LABEL,',
    '    "FOLGA ESCOLHIDA",\n    "FOLGA 4",\n    "F4",\n    CROSS_MONTH_ND_LABEL,',
  ],
  [
    '    if (upper === "FP" || upper.includes("FOLGA PEDIDA")) {\n        return "FOLGA PEDIDA";\n    }',
    '    if (upper === "FP" || upper.includes("FOLGA PEDIDA")) {\n        return "FOLGA PEDIDA";\n    }\n    if (upper === "F4" || upper === "FOLGA4" || upper === "FOLGA 4") {\n        return "FOLGA 4";\n    }',
  ],
  [
    '        n === "FOLGA" ||\n        n === "FOLGA SOCIAL" ||\n        n === "FOLGA AGRUPADA") {',
    '        n === "FOLGA" ||\n        n === "FOLGA 4" ||\n        n === "F4" ||\n        n === "FOLGA SOCIAL" ||\n        n === "FOLGA AGRUPADA") {',
  ],
  [
    '        normalized === "FOLGA" ||\n        normalized === "FOLGA SOCIAL" ||',
    '        normalized === "FOLGA" ||\n        normalized === "FOLGA 4" ||\n        normalized === "F4" ||\n        normalized === "FOLGA SOCIAL" ||',
  ],
]);

patch("domain/rules/eligibility.js", [
  [
    '            "FOLGA",\n            "FOLGA ESCOLHIDA",\n            "FOLGA SOCIAL",',
    '            "FOLGA",\n            "FOLGA 4",\n            "FOLGA ESCOLHIDA",\n            "FOLGA SOCIAL",',
  ],
]);

patch("domain/schedule/admin-executed-audit.js", [
  [
    '        case "FOLGA":\n            return "F";\n        case "FS":',
    '        case "FOLGA":\n            return "F";\n        case "F4":\n            return "F4";\n        case "FS":',
  ],
]);

patch("application/use-cases/manual-schedule-edit.use-case.js", [
  [
    'else if (n === "FOLGA SOCIAL" || n === "FS")\n                moveType = "FS";\n            else if (n === "FOLGA")',
    'else if (n === "FOLGA SOCIAL" || n === "FS")\n                moveType = "FS";\n            else if (n === "FOLGA 4" || n === "FOLGA4" || n === "F4")\n                moveType = "F4";\n            else if (n === "FOLGA")',
  ],
]);

patch("application/use-cases/shift-swap.use-case.js", [
  [
    '    if (n === "FOLGA SOCIAL" || n === "FS")\n        return "FS";',
    '    if (n === "FOLGA SOCIAL" || n === "FS")\n        return "FS";\n    if (n === "FOLGA 4" || n === "FOLGA4" || n === "F4")\n        return "F4";',
  ],
]);

patch("domain/schedule/clear-generated-policy.js", [
  [
    '    "FOLGA ESCOLHIDA",\n    "SIMULADOR",',
    '    "FOLGA ESCOLHIDA",\n    "FOLGA 4",\n    "F4",\n    "SIMULADOR",',
  ],
]);
