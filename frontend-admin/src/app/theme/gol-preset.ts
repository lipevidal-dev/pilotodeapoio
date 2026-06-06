import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

/** Preset PrimeNG com laranja GOL como cor primária. */
export const GolPreset = definePreset(Aura, {
  primitive: {
    orange: {
      50: '#fff4ed',
      100: '#ffe4d1',
      200: '#ffc9a3',
      300: '#ffa66b',
      400: '#f97a2e',
      500: '#f15a22',
      600: '#d94e1a',
      700: '#b33d15',
      800: '#8f3216',
      900: '#742b15',
      950: '#3f1309',
    },
  },
  semantic: {
    primary: {
      50: '{orange.50}',
      100: '{orange.100}',
      200: '{orange.200}',
      300: '{orange.300}',
      400: '{orange.400}',
      500: '{orange.500}',
      600: '{orange.600}',
      700: '{orange.700}',
      800: '{orange.800}',
      900: '{orange.900}',
      950: '{orange.950}',
    },
  },
});
