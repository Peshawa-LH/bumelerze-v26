// Metro bundler config — only needed for one thing so far: registering
// `.sqlite` as a bundled binary asset extension so Metro's bundler treats
// `assets/catalog/bumelerze-catalog.sqlite` (the regional-catalog wave's
// bundled Kurdistan/Iraq earthquake database, features/catalog/db.ts) like
// an image or font rather than trying to parse it as source code. Expo's
// default asset extension list doesn't include database file extensions.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push("db", "sqlite");

module.exports = config;
