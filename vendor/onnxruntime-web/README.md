# ONNX Runtime Web 1.30.0 (그대로 넣은 파일)

글공장 1.5.1 '원본 보존 합성'의 배경 지우기(U²-Netp)를 이 기기 브라우저에서 돌리려고 넣었어. 화면 보안 정책(CSP)이 같은 주소(`'self'`)의 스크립트만 받아서, 다른 사이트(CDN)에서 받지 않고 앱과 같이 둠.

- 출처: npm `onnxruntime-web@1.30.0` 의 `dist/ort.wasm.bundle.min.mjs`, `dist/ort-wasm-simd-threaded.wasm` (고치지 않음)
- 라이선스: MIT (`LICENSE` — Copyright (c) Microsoft Corporation). 원래 저장소 https://github.com/microsoft/onnxruntime
- SHA-256
  - `ort.wasm.bundle.min.mjs` 11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90
  - `ort-wasm-simd-threaded.wasm` 3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2
- 쓰는 방법: `cutout.js` 가 `numThreads = 1`(GitHub Pages 는 여러 스레드를 못 씀), `wasmBinary` 로 직접 넘김. 처음 한 번 받아서 이 기기의 캐시(Cache Storage `gf-cutout-v1`)에 둠
- WebAssembly 를 돌리려고 `index.html` 의 CSP `script-src` 에 `'wasm-unsafe-eval'` 을 더함 (`'unsafe-eval'` 은 아님 — 자바스크립트 eval 은 여전히 막힘)
