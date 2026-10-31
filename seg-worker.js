// seg-worker.js — 배경 지우기(U²-Netp)를 화면과 따로 돌리는 일꾼 (1.5.2)
// 화면(메인 스레드)이 받아서 해시를 확인한 모델·실행기 파일을 넘겨주면, 여기서만 계산해 — 처리하는 동안 화면이 멈추지 않게.
// 취소는 화면이 이 일꾼을 끝내는(terminate) 방식이라 계산 중간에도 바로 멈춤. 사진은 이 기기 밖으로 나가지 않음.
import * as ort from './vendor/onnxruntime-web/ort.wasm.bundle.min.mjs';
import { segInput, probToMap, mapToMask, twoPassMap, maskQuality, SEG_SIZE } from './cutout.js?v=1.5.2';

let session = null;
const runModel = async (rgba, w, h) => {
  const input = segInput(rgba, w, h);
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SEG_SIZE, SEG_SIZE]) });
  return res[session.outputNames[0]].data;
};
self.onmessage = async (ev) => {
  const m = ev.data || {};
  try {
    if (m.type === 'init') {
      ort.env.wasm.numThreads = 1; // GitHub Pages 는 여러 스레드를 못 씀 (cross-origin isolation 없음)
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = m.wasm;
      session = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      self.postMessage({ type: 'ready', id: m.id });
      return;
    }
    if (m.type === 'mask') {
      if (!session) throw new Error('not_ready');
      const t0 = performance.now();
      const { rgba, w, h } = m;
      const r = m.refine ? await twoPassMap(rgba, w, h, runModel) : { map: probToMap(await runModel(rgba, w, h), SEG_SIZE, w, h), refined: false };
      const mask = mapToMask(r.map, rgba, w, h);
      const quality = maskQuality(mask, w, h, rgba);
      self.postMessage({ type: 'mask', id: m.id, mask, quality, refined: r.refined, skip: r.skip || '', agree: r.agree == null ? null : r.agree, ms: Math.round(performance.now() - t0) }, [mask.buffer]);
      return;
    }
    throw new Error('unknown');
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String((e && e.message) || e) });
  }
};
