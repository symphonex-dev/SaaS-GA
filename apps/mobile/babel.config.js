/**
 * NativeWind v4 : le preset Expo doit produire des éléments JSX typés par
 * NativeWind (`jsxImportSource`), et le preset NativeWind transforme les
 * classes utilitaires en styles React Native.
 */
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
  };
};
