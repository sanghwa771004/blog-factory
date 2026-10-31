# 배경 지우기 비교 시험 (maskbench) — 1.5.2 (2026-10-31)

이 작업 중에 따로 돌린 비교 시험의 기록이야. **앱과 같은 실행기**(ONNX Runtime Web 1.30.0 wasm, 한 스레드)를 컴퓨터(Node 22)에서 돌렸어. **아이폰 Safari 에서는 재지 않았어.** 합성 그림 점수는 실제 사진 정확도가 아니야.

## 앱에 반영한 것
1. **'정밀하게'(2단계)** — 아래 시험에서 고른 값(여백 = 상자 긴 변×0.12, 작은 덩어리 무시, 잘린 가장자리 16px 섞기, **두 결과가 상자 안에서 90% 넘게 겹칠 때만** 2단계 사용)을 `cutout.js` `twoPassMap` 에 그대로 옮겼어. 옮긴 코드가 시험 코드(`refine.js`)와 합성 24장 모두에서 **같은 결과(차이 0)·같은 판단**인 걸 확인했어 → 합성 평균 IoU 0.790 → 0.798, 경계 점수 0.636 → 0.669, 알파 오차 0.0564 → 0.0550. 기본(한 번)은 그대로, 버튼으로만 (시간 약 2배).
   - 덜 겹쳐서 1단계를 그대로 두면 화면에 '두 번째로 본 결과가 처음과 많이 달라서 … 처음 결과를 그대로 뒀어', 상품이 사진을 거의 채우면 '한 번만 봤어'라고 알려줘. 마스크 기록의 `params.model` 이 `u2netp_2pass` 로 남아.
2. **'간단히'(모델 없이)** — 시험에서 찾은 문제(옆 칸끼리만 비교해서 부드러운 윤곽 틈으로 상품 안까지 번짐 — 합성 24장 중 20장이 거의 0)를 고쳤어. 테두리에서 온 배경 색을 기억하고 천천히만 따라가게 바꿈 (`simpleMask` tol 12·rate 0.02). 같은 합성 24장으로: **단색 스튜디오 배경 8장 IoU 0.13 → 0.64**(경계 점수 0.31 → 0.63), 전체 IoU 0.08 → 0.41, 거의 0인 사진 20 → 2장. 대신 전체 알파 오차는 0.14 → 0.34 로 나빠졌어 — 무늬 있는 배경(벽돌·자갈·사진)에서는 이제 배경을 많이 남기기 때문이야 (예전에는 상품까지 다 지워서 빈 마스크라 오차가 작아 보였어). 둘 다 그런 배경에는 안 맞아 — 화면의 영역 품질 점수(추정)와 분홍색 보기로 확인하고 칠해서 고쳐야 해. 1600×1200 에서 시간은 비슷 (0.22 → 0.24초). 같은 합성 사진으로 값을 골라서 과적합 위험이 있고, 무늬 있는 배경·흰 바탕의 흰 상품은 여전히 안 돼 (화면이 '흰 배경·단색 배경 사진에 맞음'이라고 알려줌).
3. **더 무거운 모델은 안 넣음** — u2net(176MB)·silueta(44MB)는 U²-Netp보다 낫지 않았고, ISNet(179MB)은 평균은 조금 높지만 차이가 통계적으로 확실하지 않고 7배 느리고 메모리가 약 760MB(아이폰 위험)이고 **상업용 라이선스가 확실하지 않아** (학습 데이터가 비상업용). BRIA RMBG 는 비상업 라이선스라 시험도 안 함.

## 반영 안 한 것
- `keepMain` 구멍 메우기 기준(사진의 0.2% 보다 작은 안쪽 구멍 — 1024×768 에서 약 40×40px — 은 메움): 진짜 구멍(바구니 구멍 등)도 메워지지만, 바꾸면 모든 기본 결과가 달라져서 이번엔 그대로. 그런 상품은 '지울 곳 칠하기'로 직접 지워줘.
- 투명한 병·비닐: 모든 모델이 몸통을 불투명하게 남겨서 병 너머의 원래 배경이 같이 붙어 (반투명으로 남기는 기능 없음).
- 털 끝: 모든 모델이 털 뿌리에서 자름.

## 저장소에 넣지 않은 것
시험용 합성 사진·실제 사진·모델 파일(모두 합쳐 400MB 넘음, 일부 라이선스 불명확)과 시험 스크립트는 넣지 않았어. 라이선스 내용은 이 시험에서 공개 문서를 읽고 정리한 것 — 법률 자문이 아니야.

---
## 원문 (시험 보고서, 영어)

## 한국어 요약
- 지금 쓰는 U²-Netp는 그대로 두는 게 맞아. 더 무거운 모델(u2net 176MB, silueta 44MB, ISNet 179MB)은 이 시험에서 확실히 낫지 않았어.
  ISNet이 평균은 조금 높았지만 사진마다 들쭉날쭉하고, 7배쯤 느리고, 라이선스도 애매해(학습 데이터가 비상업용이라 상업용으로는 못 권해).
- '두 번 돌리기'(refine.js)는 기본값 말고 '정밀하게' 버튼으로 넣는 걸 추천해. 경계가 더 정확해지는데(경계 점수 0.636→0.669) 시간이 약 2배야.
  병 뚜껑·바구니 구멍처럼 처음에 놓친 부분을 잘 되찾았고, 결과가 처음과 너무 다르면 처음 결과를 그대로 두는 안전장치가 있어.
- 숫자는 전부 컴퓨터(Node)에서 앱과 같은 엔진으로 잰 거고, 아이폰에서는 직접 못 재봤어. 합성 이미지 점수는 실제 사진 정확도와 같지 않아.

## 1. What was compared
| id | method |
|---|---|
| (a) | current: U²-Netp (320×320), one pass → `probToMap` → `mapToMask` (guided filter, smoothstep 0.3–0.7, `keepMain`) — exactly as cutout.js |
| (b) | U²-Netp two-pass "crop refine" (`refine.js`). Pass 1 on the whole photo → bbox of p ≥ 0.5 (blobs < 4 % of the largest ignored) → grow by margin × longer box side → run again on the crop → paste back → `mapToMask`. 48 variants tested + an agreement gate (§4) |
| (c) | silueta.onnx (rembg v0.0.0; = U²-Net after ONNX Runtime dynamic int8 quantization), same pre-processing as U²-Net |
| (d) | isnet-general-use.onnx (rembg v0.0.0), 1024×1024. Pre-processing per rembg `rembg/sessions/dis_general_use.py`: resize to 1024², divide by max, mean (0.5, 0.5, 0.5), std (1, 1, 1); output 0 `output_image`, min-max. Plus my dynamic int8 copy |
| (e) | u2net.onnx (full, 176 MB), same pre-processing as U²-Netp |
| ref | cutout.js `simpleMask` (border-colour flood fill fallback) |

## 2. Engine and setup
- **Engine:** ONNX Runtime Web 1.30.0 loaded from the app's own `vendor/onnxruntime-web/` (`ort.wasm.bundle.min.mjs` + `ort-wasm-simd-threaded.wasm`, same SHA-256 as `WASM_SHA256`). Run under Node 22.22.0 with `numThreads = 1`, `proxy = false`, `executionProviders ['wasm']`, `graphOptimizationLevel 'all'` — the same settings as `loadSegmenter`.
- **App code:** `cutout.js` and `images.js` were copied unmodified (Node accepts the `?v=1.5.1` import).
- **Pre-processing:** the U²-Net family uses `segInput` itself. ISNet uses a copy with rembg's mean/std/size.
- **Outputs fetched:** the U²-Net family fetches all outputs, as the app does. ISNet fetches only output 0; fetching all 12 outputs gave the same wasm heap (758 MB).
- **Hardware:** Intel Xeon @ 2.1 GHz KVM vCPU, 1 thread used, AVX-512 host. Wasm uses 128-bit SIMD only.
- **Memory measurements:**
  - wasm heap = `WebAssembly.Memory` byteLength, captured by wrapping the constructor. This is the closest proxy for Safari.
  - Peak RSS = `/proc` VmHWM, reset after load. It includes Node itself (~45 MB) and the JS copy of the model bytes.
- **Timing:** median over images, after one warm-up run.
  - "model run" = `session.run`.
  - "full mask" = pre-processing + run(s) + `probToMap`/refine + `mapToMask`.
- `refine.js` pass 1 equals `probToMap` to within 6e-8 on all 33 images (`src/t_refine_eq.mjs`).
- **Container restart:** a restart killed the ISNet fp32 run after 26/33 images. Its synthetic timings come from the per-image log lines (uncontended). The real-set ISNet runs and the two 2-image memory checks were re-run while another job used the second vCPU, so they are about 15 % slower.

## 3. Data
### Synthetic set — with exact ground truth (24 images; NOT real-world accuracy)
- **Categories:** 8 categories × 3 images:
  - glass bottles: clear half-filled / green with label / amber jar
  - clear plastic: PET bottle / food container with candies / iced cup with straw
  - thin: earphones with 2 px cable / handbag with 3 px strap / charger with 4 px cable coil
  - fur: thousands of 0.5–1.25 px strands, 10–46 px long
  - low contrast: white mug on white / terracotta pot on brick / stone vase on gravel
  - reflective metal: environment-reflecting tumbler / kettle with ring handle / ladle
  - complex outlines with holes: scissors / wicker basket with 16, 28 and 44 px holes / slatted chair
  - plain opaque control
- **Sizes:** 1024×768, 768×1024 or 1024×1024 (the app's `workSize` leaves them unchanged).
- **Drawing:** objects are drawn procedurally with 4× supersampled coverage and composited with the over operator.
- **Glass and plastic:** Fresnel-style edge alpha, specular highlights and a refraction displacement of the background.
- **Backgrounds — real images from scikit-image 0.26 (bundled):**
  - textures `brick`, `grass`, `gravel` (tinted, mirror-tiled)
  - photos `coffee`, `chelsea` (cat-fur crop), `rocket`, `motorcycle_left` (cover-resized)
- **Backgrounds — procedural:** 9 of 24 are studio sweeps (gradient + low-frequency noise). `rough_wall` is not bundled in 0.26, so it was not used.
- **Extras:** soft contact shadows on the background (not part of the GT) and sensor noise σ = 2.
- **Two GTs:**
  - the alpha matte (glass bodies 0.16–0.6)
  - the footprint (silhouette coverage; transparent bodies count fully = "what a seller wants kept")
- **Metrics:**
  - IoU@0.5 and boundary F (4-neighbour boundary, 3 px Euclidean tolerance) against footprint ≥ 0.5. This matters only for glass and plastic; for opaque objects the footprint equals the alpha.
  - alpha MAE against the matte.
  - With 3 images per category, the per-category numbers are anecdotes.

### Real photos — no ground truth, visual only (9 images, kept in the scratch folder only)
- scikit-image: `coffee`, `chelsea`, `rocket`, `motorcycle_left`
- rembg repo `examples/`: `animal-3` (lion), `animal-1` (tiger), `food-1` (sushi), `plants-1`, `car-2` (silver car)
- Resized like the app: long side ≤ 1600, area average.

## 4. Two-pass variants (U²-Netp, synthetic)
Baseline (a): IoU 0.7903, BF 0.6360, MAE 0.0564. Grid: margin {0.08, 0.12, 0.20} × blend {replace, replace+16 px feather, max, mean} × pass-2 normalisation {min-max, raw} × crop {tight, square}.

| variant (pass-2 min-max) | ΔIoU vs a (±SE) | ΔBF | comment |
|---|---|---|---|
| tight, replace, m 0.08 / 0.12 / 0.20 | +0.0003 / −0.0002 / +0.0030 | +0.037 / +0.036 / +0.027 | sharper edges; large single-image losses: kettle −0.126 (all variants), scissors −0.150 (m 0.12) |
| tight, max, m 0.12 | −0.0002 | +0.006 | keeps pass-1's blurry rim → no edge gain |
| tight, mean, m 0.12 | −0.0005 | +0.021 | in between |
| square, replace, m 0.12 | +0.031 ±0.025 | +0.031 | gain comes only from 2 images where re-framing made the model switch to the right object (ladle +0.51, scissors +0.27). On the 17 images where pass 1 was right: ΔIoU −0.009, ΔBF −0.003 |

- raw vs min-max: identical (U²-Net outputs already span 0–1).
- Feather 0 vs 16 px: identical within 0.0002.

**Agreement gate** (new, `minAgree`): if IoU(pass 1 ≥ 0.5, pass 2 ≥ 0.5) inside the crop is below the threshold, the model "changed its mind" → keep pass 1. Tight crop, replace, feather 16:

| margin, minAgree | 0 | 0.80 | 0.85 | **0.90** | 0.95 |
|---|---|---|---|---|---|
| m 0.12: ΔIoU | −0.0003 | +0.0066 | +0.0018 | **+0.0071 ±0.0043** | +0.0055 |
| m 0.12: ΔBF | +0.036 | +0.042 | +0.026 | **+0.033** | +0.020 |
| m 0.08: ΔIoU | +0.0002 | +0.0056 | +0.0011 | +0.0061 ±0.0022 | +0.0046 |

**Chosen** (= `refine.js` defaults): margin 0.12, replace, feather 16, min-max, tight crop, minAgree 0.9.
- On images where pass 1 found the product: ΔIoU +0.010, ΔBF +0.046.
- Only one image got worse by more than 0.01 IoU: the white mug on white, −0.032.
- The gate rejected 5/24 crops (agreement 0.57–0.89). That includes the stone vase, where the ungated pass 2 would have gained +0.11; that is the price of the gate.
- 0.9 was picked on these same 24 images. It sits between the kettle (0.866) and the green bottle (0.923), so there is some over-fitting risk. m 0.08 is an equally good choice.

## 5. Results
### Speed and memory (ORT Web wasm, 1 thread, Node; all 33 images unless noted)
| method | file | session load | first run | median model run (synth) | median full mask (synth / real) | wasm heap after load / peak | peak RSS |
|---|---|---|---|---|---|---|---|
| (a) u2netp | 4.6 MB | 0.42 s | 2.1 s | 1.68 s | 1.89 / 1.94 s | 23 / 217 MB | 545 MB |
| (b) u2netp two-pass | same | 0.46 s | 2.1 s | 3.68 s (2 runs) | 3.94 / 2.33 s* | 23 / 217 MB | 530 MB |
| (c) silueta | 44.2 MB | 0.58 s | 3.1 s | 2.71 s | 2.90 / 2.93 s | 127 / 346 MB | 764 MB |
| (d) isnet fp32 | 178.6 MB | 0.8–1.9 s† | 16.3 s† | 12.71 s | 13.02 / 14.87 s† | 446 / 758 MB | 1.0–1.1 GB |
| (d) isnet int8 | 46.2 MB | 0.59 s | 10.0 s | 9.61 s | 9.86 / 9.84 s | 132 / 681 MB | 1.14 GB |
| (e) u2net | 176.0 MB | 0.57 s | 4.4 s | 4.69 s | 4.84 / 4.72 s | 440 / 440 MB | 705 MB |

\* On the real photos pass 2 was skipped for 5/9 (subject fills ≥ 80 % of the frame after the margin) and rejected by the gate for 2/9 (rocket 0.86, plants 0.82). It was applied to 2/9 (sushi, car). On the synthetic set it was applied 15/24, gate-rejected 5/24 and skipped 4/24.

† Measured while another job was running on the second vCPU. The synthetic ISNet times are uncontended.

- ISNet with a pruned single-output graph: wasm peak 744 MB (−15 MB). Not worth it.
- The int8 ISNet does not reduce activation memory (fp32 activations at 1024² dominate).

### Quality — synthetic, overall (mean of 24 images)
| method | IoU@0.5 | boundary F (3 px) | alpha MAE | ΔIoU vs a (±SE; better/worse) | ΔBF vs a (±SE) |
|---|---|---|---|---|---|
| (a) u2netp | 0.790 | 0.636 | 0.0564 | – | – |
| (b) u2netp two-pass | **0.797** | 0.669 | **0.0550** | +0.007 ±0.004 (9/3) | +0.033 ±0.015 |
| (c) silueta | 0.759 | 0.639 | 0.0635 | −0.032 ±0.029 (11/10) | +0.003 ±0.049 |
| (d) isnet fp32 | **0.817** | **0.724** | 0.0658 | +0.026 ±0.039 (18/5) | +0.088 ±0.055 |
| (d) isnet int8 | 0.810 | 0.707 | 0.0660 | +0.020 ±0.038 (15/8) | +0.071 ±0.056 |
| (e) u2net | 0.765 | 0.655 | 0.0641 | −0.025 ±0.026 (10/9) | +0.019 ±0.038 |
| simpleMask | 0.076 | 0.140 | 0.1405 | −0.714 | – |

### Per category (3 images each) — IoU / boundary F
| method | glass | clear plastic | thin | fur | low contrast | metal | holes | plain |
|---|---|---|---|---|---|---|---|---|
| (a) | 0.910 / 0.722 | 0.526 / 0.408 | 0.922 / 0.829 | 0.815 / 0.311 | 0.875 / 0.576 | 0.667 / 0.676 | 0.617 / 0.606 | 0.991 / 0.960 |
| (b) | 0.948 / 0.870 | 0.527 / 0.409 | 0.922 / 0.828 | 0.814 / 0.296 | 0.870 / 0.627 | 0.669 / 0.694 | 0.637 / 0.661 | 0.993 / 0.966 |
| (c) | 0.827 / 0.784 | 0.519 / 0.403 | 0.695 / 0.502 | 0.825 / 0.419 | 0.972 / 0.815 | 0.678 / 0.689 | 0.561 / 0.527 | 0.991 / 0.970 |
| (d) fp32 | 0.791 / 0.716 | 0.532 / 0.613 | 0.953 / 0.863 | 0.812 / 0.373 | 0.828 / 0.617 | 0.838 / 0.786 | 0.785 / 0.846 | 0.995 / 0.977 |
| (d) int8 | 0.784 / 0.714 | 0.537 / 0.619 | 0.946 / 0.871 | 0.812 / 0.374 | 0.811 / 0.527 | 0.813 / 0.729 | 0.785 / 0.847 | 0.995 / 0.978 |
| (e) | 0.827 / 0.786 | 0.521 / 0.404 | 0.753 / 0.682 | 0.818 / 0.338 | 0.976 / 0.845 | 0.667 / 0.694 | 0.568 / 0.531 | 0.992 / 0.962 |

Alpha MAE per category, (a) → (b) → (d): glass 0.068 → 0.063 → 0.141; clear plastic 0.163 → 0.163 → 0.180; holes 0.099 → 0.092 → 0.051. The other categories are below 0.07 for all.

Per-image tables are in `work/results/quality_synth_final.json` (run `src/summarize.py . final`).

## 6. Visual observations (overlays in `out/overlays/`)
In each overlay, removed area is tinted magenta, the mask edge is drawn in cyan, and the second row is a 2× zoom of the yellow box.

### Synthetic
- **Glass / clear plastic:** every model keeps bottle bodies fully opaque. The background seen through the glass therefore gets pasted onto the new AI background; no model outputs partial alpha after `mapToMask`.
  - U²-Netp single pass dropped the dark cap and part of the neck of the green bottle on brick. Two-pass recovered them (IoU 0.919 → 0.990, BF 0.70 → 0.98; `synth_glass_1.png`).
  - The clear food container on gravel is lost by every model (IoU 0.12–0.15; only the candies inside survive).
  - The clear cup in front of the coffee photo: every model also keeps the cup/saucer behind it (0.45–0.50).
- **Fur:** every model places the edge at the base of the hairs, so 15–40 px of hair tips are cut off. BF is 0.30–0.42 for all; two-pass doesn't help (`synth_fur_0.png`).
- **Thin:** U²-Netp keeps the 2 px earphone cable (0.968) and the cable over cat fur (0.824). silueta and u2net lose cable segments (0.44–0.83). ISNet is best (0.89–0.99).
- **Holes:** basket holes of 16 and 28 px stay filled for every model and method. `keepMain` fills enclosed holes smaller than 0.2 % of the image (≈ 1,570 px at 1024×768, i.e. smaller than about 40×40 px) by design. Two-pass opened the 44 px holes (0.844 → 0.906; `synth_holes_1.png`). The scissors are hard for the U²-Net family (0.54–0.71) and easy for ISNet (0.995).
- **Salient distractors (the biggest failures):**
  - Ladle in front of the night rocket scene: all U²-Net-family models select the rocket (IoU 0.01–0.05). ISNet finds the ladle but also keeps the rocket and tower (0.52) (`synth_metal_2.png`).
  - White chair over the coffee photo: everyone keeps the cup (0.23–0.45).
  - Two-pass cannot fix a wrong object choice, and the gate refuses a switch in either direction.
- **Reflective metal:** tumbler and kettle are ≥ 0.98 single pass for all models. The ungated crop pass dropped part of the kettle (−0.126); the gate catches it (agreement 0.866).
- **Low contrast:**
  - white mug on white: fine for all (0.93–0.98).
  - terracotta pot on brick: ISNet merges it into the wall (0.52) while the U²-Net family gets 0.96–0.98.
  - stone vase on gravel: U²-Netp 0.69 vs 0.98 for the others.
- **simpleMask (the "간단히" button):** IoU 0 on 17 of 24 images, even the plain box on a studio sweep. The likely cause, checked on that image: the fill compares each pixel with its neighbour (tolerance 30). A 1-px anti-aliased or shadowed edge of moderate contrast is passed in two half-steps, so the fill leaks into the product. It only works on very hard edges.

### Real photos (no GT)
- **coffee cup, silver car, sushi:** all models are clean; no visible difference between (a) and (b).
- **motorcycle:** U²-Netp keeps the bike but includes a jagged chunk of the garage shelf above the tank. silueta and u2net cut off the mirrors and the top of the headlight. ISNet keeps mirrors and handlebar but also some of the shelf. Spoke gaps are filled by all models.
- **lion:** fine at mane level for all (no strand detail). **ISNet int8 left large grass patches as foreground** around the paws and right flank; fp32 is clean (`real_lion.png`).
- **plants on shelves:** U²-Netp keeps only the top-shelf pots; silueta, u2net and ISNet keep the shelf and the lower plants. ISNet int8 is blotchy across the background (`real_plants.png`).
- **Conclusion on int8:** dynamic int8 quantization of ISNet is not reliable even though its synthetic scores looked close to fp32.

## 7. Recommendation
**Two-pass refine: add it as an optional "정밀하게 (시간 약 2배)" button, not as the default.**
- Why not default:
  - The average IoU gain is small (+0.007).
  - It roughly doubles the time whenever pass 2 runs (1.9 → 3.9 s here; expect a similar ratio on iPhone).
  - On real photos where the product fills the frame it is usually skipped anyway.
- Why it is a good button:
  - Edges are consistently better (BF +0.033 ±0.015; +0.046 when pass 1 had the right object).
  - It recovers missed caps, necks and large holes.
  - The gate prevents object switches.
  - `pushUndo` already exists in product.js, so the user can go back.
- Exact parameters (the `refine.js` defaults): `{ S: 320, thr: 0.5, minFrac: 0.04, margin: 0.12, minSide: 64, square: false, skipAbove: 0.8, blend: 'replace', feather: 16, norm2: 'minmax', minAgree: 0.9 }`. Memory is unchanged (two sequential runs).
- Wiring (seg.run doesn't use `this`):
  ```js
  import { refineTwoPass } from './refine.js?v=…';
  // in autoMask(rgba, w, h, { useModel = true, precise = false })
  const seg = await loadSegmenter();
  const info = {};
  const map = precise ? await refineTwoPass(rgba, w, h, seg.run, { info })
                      : probToMap(await seg.run(rgba, w, h), SEG_SIZE, w, h);
  return { mask: mapToMask(map, rgba, w, h), method: info.used === 'pass2' ? 'auto_u2netp_2pass' : 'auto_u2netp' };
  ```
  `info` = `{ rect, passes, used: 'pass1' | 'pass2', agree }`. If `used === 'pass1'`, the UI can say there was nothing to refine.

**Heavier model as an optional download: none for now.**
- **u2net (176 MB) and silueta (= u2net int8, 44 MB):** not better than U²-Netp here (IoU 0.765 / 0.759 vs 0.790; they lose thin cables and the amber jar). They are 1.5–2.8× slower with a 1.6–2× larger wasm heap. u2net also exceeds GitHub's 100 MB per-file limit.
- **ISNet fp32:**
  - Best mean (IoU 0.817, BF 0.724), but not significant: 18 images better, 5 worse, with large failures on the amber jar (0.50) and pot on brick (0.52).
  - 12.7 s per image and a ~760 MB wasm heap (~1.1 GB process RSS). That is high risk on iPhone Safari, whose per-tab memory ceiling is device-dependent and undocumented.
  - 178.6 MB would have to be split into two chunks under 100 MB to live on GitHub Pages.
  - **The licence is not cleared for commercial use** (see §8).
- **ISNet int8 (46.2 MB):** fits GitHub, but has the same licence problem, real-photo artefacts and a 9.6 s, 681 MB heap.
- If you ever revisit this anyway, the exact ISNet parameters are:
  - input `input_image` 1×3×1024×1024; resize to 1024², divide by max, (x − 0.5) / 1.0
  - `session.run(feeds, ['output_image'])`, min-max, `probToMap(prob, 1024, w, h)`, then `mapToMask`
  - get written permission from the DIS authors first.
- The only commercially clean upgrade paths are a licensed model (e.g. a BRIA commercial agreement; not tested) or a better Apache/MIT model.

**Side findings (untested fixes):**
- `keepMain`'s `holeFrac 0.002` deletes real holes up to about 40×40 px; a smaller value would keep them but fill fewer false holes.
- `simpleMask` should compare against the seed or border colour rather than the neighbour.

## 8. Models — hashes, sizes, licences
All files came from `https://github.com/danielgatis/rembg/releases/download/v0.0.0/<file>`. The MD5s match the checksums in rembg's `rembg/sessions/*.py` (commit c5b48b0). `u2netp.onnx` is byte-identical to the app's file.

| file | bytes | SHA-256 | origin / licence (where verified) | commercial |
|---|---|---|---|---|
| u2netp.onnx | 4,574,861 | 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8 | U²-Net (Qin et al.). `LICENSE` of github.com/xuebinqin/U-2-Net (commit ac7e1c8) = Apache-2.0; README adds no restriction. rembg = MIT | yes |
| u2net.onnx | 175,997,641 | 8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491 | same, Apache-2.0 | yes (but over 100 MB) |
| silueta.onnx | 44,173,029 | 75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb | Kikedao in U-2-Net issue #295: "I used the pretrained model and quantized it using the quantization utils from onnx-runtime … I didn't retrain it"; the graph confirms 119 ConvInteger. No licence stated by its author; it is a mechanical derivative of the Apache-2.0 weights. Cleanest: quantize u2net.onnx yourself | yes, with that caveat |
| isnet-general-use.onnx | 178,648,008 | 60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a | github.com/xuebinqin/DIS (commit b6764e2): `LICENSE.md` is Apache-2.0, but README §7 says "Our code and evaluation metric use Apache License 2.0" — the weights are not named. DIS5K terms: "non-commercial use in research or educational purpose … commercial use of this dataset is prohibited even after copying, editing, processing or any operations of this database" | **not cleared** |
| isnet-general-use.int8.onnx (`work/models/`) | 46,175,406 | 21a3b70c81089a078756e000ff757124cc2843eefc837d52a5c2bd3b2e55cefc | made from `isnet-general-use.1out.onnx` (178,411,324 B, 259c08e3eadce4fa612ba5ef696a3329d25428f9b851fb636ab329daa9b51437) with `quantize_dynamic(weight_type=QUInt8)` (onnxruntime 1.29.0, onnx 1.23.2) | same as ISNet |
| BRIA RMBG-1.4 (not downloaded) | – | – | HF model card: licence "bria-rmbg-1.4", "non-commercial use … Commercial use is subject to a commercial agreement with BRIA" | **no** |
| BRIA RMBG-2.0 (not downloaded) | – | – | HF: CC BY-NC 4.0 ("bria-rmbg-2.0"), "Commercial use is subject to a commercial agreement with BRIA"; rembg README says the same | **no** |

## 9. What I could not test / caveats
- **No iPhone or Safari (JavaScriptCore).**
  - Times and memory come from Node/V8 running the identical wasm on a server vCPU.
  - Recent iPhones should be in the same order of magnitude; older ones slower.
  - Safari's per-tab memory limit was not measured. RSS includes Node and JS-side model bytes; the wasm heap is the better proxy.
- **Synthetic is not real-world accuracy.** Procedural objects, 3 per category, so per-category numbers are anecdotes. Between-model differences (±0.03–0.04 SE) are not significant; only the two-pass boundary gain is about 2 SE.
- **Real-photo check is limited:** 9 photos, visual only, few true e-commerce shots.
- **Not tested:** two-pass with other models; ISNet at a smaller input; fp16; BRIA (licence excludes it anyway).
- **Gate threshold** (0.9) was tuned on the same synthetic set.
- **Container restart:** the ISNet fp32 synthetic timings were recovered from log lines; the ISNet real-set runs and memory checks ran with CPU contention.

## 10. Files (maskbench/)
- `refine.js` — deliverable (pure ES module).
- `out/overlays/synth_*.png` (24), `out/overlays/real_*.png` (9).
- `work/results/quality_{synth,real}_final.json`, `quality_synth_grid.json` (48 variants), `quality_synth_gate.json`.
- `work/perf/*.json`, `work/logs/`.
- `work/models/isnet-general-use.{1out,int8}.onnx`.
- `data/synth/` (images + `.alpha.f32` / `.fp.f32` GT), `data/real/`.
- Scripts in `src/`: `gen_synth.py`, `prep_real.py`, `lib.mjs`, `perf.mjs`, `quality.mjs`, `summarize.py`, `overlays.py`, `make_isnet_variants.py`, `t_refine_eq.mjs`.
