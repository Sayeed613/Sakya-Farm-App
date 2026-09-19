/**
 * Expo's preset wires the React Native transform, the JSX runtime and the
 * `expo-router` entry resolution. NativeWind adds its JSX transform on top
 * (className -> style), and reanimated needs its Babel plugin last.
 */
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: ['react-native-worklets/plugin'],
  };
};
