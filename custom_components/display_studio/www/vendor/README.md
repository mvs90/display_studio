hls.js 1.7.3, light ESM build, vendored unchanged from the official npm package.

Source: https://github.com/video-dev/hls.js/tree/v1.7.3
Package: https://registry.npmjs.org/hls.js/-/hls.js-1.7.3.tgz
License: see hls-LICENSE and hls-APACHE-2.0.txt (the distributed bundle retains its license notices).

SHA-256 hls-1.7.3.light.min.mjs: c60e98c83e5b2ce6875ea6ca27e51f63b7a6f00e9d9b64b588c92261bd69d439

Only the admin camera preview imports this build, lazily when opening a live camera. MSE playback is preferred; native HLS is used on engines without MSE support. No CDN or network dependency at runtime.
