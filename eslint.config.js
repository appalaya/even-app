// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierPlugin = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

// Every colour is a semantic token (design.md "Theme tokens"). Literal colours may appear only in
// src/theme/; everywhere else in src/ they are an error. Hex and rgb()/rgba()/hsl()/hsla() are caught
// anywhere inside a string or template literal; named colours when they are the whole string.
const COLOR_MESSAGE =
  'Literal colours live only in src/theme/. Use a semantic token from useTheme() instead.';
const HEX_OR_FUNCTION = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(/`;
const NAMED_COLORS = [
  'white',
  'black',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'gray',
  'grey',
  'silver',
  'gold',
  'navy',
  'teal',
  'maroon',
  'olive',
  'lime',
  'aqua',
  'cyan',
  'magenta',
  'fuchsia',
  'indigo',
  'violet',
  'lightgray',
  'lightgrey',
  'darkgray',
  'darkgrey',
];
const NAMED = `/^\\s*(${NAMED_COLORS.join('|')})\\s*$/i`;

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'warn',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${HEX_OR_FUNCTION}]`, message: COLOR_MESSAGE },
        { selector: `Literal[value=${NAMED}]`, message: COLOR_MESSAGE },
        { selector: `TemplateElement[value.raw=${HEX_OR_FUNCTION}]`, message: COLOR_MESSAGE },
        {
          selector: `TemplateLiteral[expressions.length=0] > TemplateElement[value.raw=${NAMED}]`,
          message: COLOR_MESSAGE,
        },
      ],
    },
  },
  {
    // packages/core is plain TypeScript with its own checks (npm run check inside it).
    ignores: ['dist/*', 'packages/**', 'ios/**', 'android/**', '.expo/**'],
  },
]);
