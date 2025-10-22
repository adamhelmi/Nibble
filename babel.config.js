// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    // The preset already wires up expo-router; no plugins needed.
    presets: ['babel-preset-expo'],
  };
};
