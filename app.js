import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const state = {
  query: "",
  totalHits: 0,
  filteredCount: 0,
  sort: "recommended",
  allItems: [],
  items: [],
  selectedFrame: null,
  currentSource: "idle",
  cameraStream: null,
  faceLandmarker: null,
  faceReady: false,
  lastLandmarks: null,
  dragPointerId: null,
  dragStart: null,
  overlay: {
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    opacity: 0.96,
    imageAspectRatio: 2,
    autoWidth: 0,
    autoAngle: 0,
    assetUrl: "",
    sourceUrl: "",
    pose: null
  },
  renderToken: null,
  selectionToken: null
};

const dom = {
  jumpToCamera: document.querySelector("#jumpToCamera"),
  jumpToCatalog: document.querySelector("#jumpToCatalog"),
  stageSection: document.querySelector("#stageSection"),
  catalogSection: document.querySelector("#catalogSection"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  catalogGrid: document.querySelector("#catalogGrid"),
  catalogLoading: document.querySelector("#catalogLoading"),
  catalogStats: document.querySelector("#catalogStats"),
  prevPageButton: document.querySelector("#prevPageButton"),
  nextPageButton: document.querySelector("#nextPageButton"),
  paginationLabel: document.querySelector("#paginationLabel"),
  photoInput: document.querySelector("#photoInput"),
  cameraButton: document.querySelector("#cameraButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  autoPlaceButton: document.querySelector("#autoPlaceButton"),
  resetAdjustmentsButton: document.querySelector("#resetAdjustmentsButton"),
  statusBanner: document.querySelector("#statusBanner"),
  cameraFeed: document.querySelector("#cameraFeed"),
  photoPreview: document.querySelector("#photoPreview"),
  stagePlaceholder: document.querySelector("#stagePlaceholder"),
  glassesLayer: document.querySelector("#glassesLayer"),
  glassesOverlay: document.querySelector("#glassesOverlay"),
  selectedFrameTitle: document.querySelector("#selectedFrameTitle"),
  selectedFrameMeta: document.querySelector("#selectedFrameMeta"),
  selectedFrameLink: document.querySelector("#selectedFrameLink"),
  productCardTemplate: document.querySelector("#productCardTemplate"),
  scaleSlider: document.querySelector("#scaleSlider"),
  rotationSlider: document.querySelector("#rotationSlider"),
  xSlider: document.querySelector("#xSlider"),
  ySlider: document.querySelector("#ySlider"),
  opacitySlider: document.querySelector("#opacitySlider"),
  scaleValue: document.querySelector("#scaleValue"),
  rotationValue: document.querySelector("#rotationValue"),
  xValue: document.querySelector("#xValue"),
  yValue: document.querySelector("#yValue"),
  opacityValue: document.querySelector("#opacityValue")
};

const SOURCE_EYE_POINTS = {
  left: [33, 133, 159, 145],
  right: [362, 263, 386, 374]
};

const TEMPLE_POINTS = {
  left: [127, 234],
  right: [356, 454]
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function subtractPoint(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: (a.z ?? 0) - (b.z ?? 0)
  };
}

function crossProduct(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!length) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function setStatus(message, tone = "info") {
  dom.statusBanner.textContent = message;
  dom.statusBanner.style.background =
    tone === "warning" ? "rgba(212, 104, 66, 0.10)" : "rgba(31, 94, 99, 0.08)";
  dom.statusBanner.style.borderColor =
    tone === "warning" ? "rgba(212, 104, 66, 0.18)" : "rgba(31, 94, 99, 0.14)";
  dom.statusBanner.style.color = tone === "warning" ? "#9a492d" : "#1f5e63";
}

function updateCatalogMeta() {
  const totalText = state.totalHits.toLocaleString("da-DK");
  const filteredText = state.filteredCount.toLocaleString("da-DK");
  dom.catalogStats.textContent = `Viser ${filteredText} af ${totalText} stel`;
  if (dom.paginationLabel) {
    dom.paginationLabel.textContent =
      state.query.length > 0
        ? `Filter: "${state.query}"`
        : "Hele Synoptik-kataloget er laest ind";
  }
  if (dom.prevPageButton) {
    dom.prevPageButton.disabled = true;
  }
  if (dom.nextPageButton) {
    dom.nextPageButton.disabled = true;
  }
}

function updateSliderLabels() {
  const visibleOffsetX = state.currentSource === "camera" ? -state.overlay.offsetX : state.overlay.offsetX;
  dom.scaleValue.textContent = `${Math.round(state.overlay.scale * 100)}%`;
  dom.rotationValue.textContent = `${state.overlay.rotation.toFixed(1)} deg`;
  dom.xValue.textContent = `${Math.round(visibleOffsetX)} px`;
  dom.yValue.textContent = `${Math.round(state.overlay.offsetY)} px`;
  dom.opacityValue.textContent = `${Math.round(state.overlay.opacity * 100)}%`;
}

function resetAdjustments() {
  state.overlay.scale = 1;
  state.overlay.rotation = 0;
  state.overlay.offsetX = 0;
  state.overlay.offsetY = 0;
  state.overlay.opacity = 0.96;

  dom.scaleSlider.value = String(state.overlay.scale);
  dom.rotationSlider.value = String(state.overlay.rotation);
  dom.xSlider.value = "0";
  dom.ySlider.value = "0";
  dom.opacitySlider.value = String(state.overlay.opacity);

  updateSliderLabels();
  positionGlasses();
}

function formatMeta(item) {
  const bits = [item.color, item.shape, item.frameSize].filter(Boolean);
  if (bits.length === 0 && item.dimensions?.frameWidth) {
    bits.push(`${item.dimensions.frameWidth} mm bredde`);
  }
  return bits.join(" | ");
}

function setActiveSource(source) {
  if (state.currentSource !== source) {
    state.overlay.pose = null;
  }
  state.currentSource = source;
  const showCamera = source === "camera";
  const showPhoto = source === "photo";
  const showOverlay = Boolean(state.selectedFrame && (showCamera || showPhoto));

  dom.cameraFeed.style.display = showCamera ? "block" : "none";
  dom.photoPreview.style.display = showPhoto ? "block" : "none";
  dom.stagePlaceholder.style.display = showCamera || showPhoto ? "none" : "grid";
  dom.glassesLayer.style.display = showOverlay ? "block" : "none";
  dom.glassesLayer.classList.toggle("is-camera", showCamera);
  dom.cameraFeed.classList.toggle("is-camera", showCamera);
  dom.xSlider.value = String(showCamera ? -state.overlay.offsetX : state.overlay.offsetX);
  updateSliderLabels();
}

function getActiveMediaElement() {
  if (state.currentSource === "camera") {
    return dom.cameraFeed;
  }
  if (state.currentSource === "photo") {
    return dom.photoPreview;
  }
  return null;
}

function getDisplayMetrics() {
  const active = getActiveMediaElement();
  if (!active) {
    return null;
  }

  const width = active.clientWidth;
  const height = active.clientHeight;
  if (!width || !height) {
    return null;
  }

  return { width, height };
}

function averagePoints(points) {
  return points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: (sum.z ?? 0) + (point.z ?? 0)
    }),
    { x: 0, y: 0, z: 0 }
  );
}

function getAverageLandmark(landmarks, indices) {
  const total = averagePoints(indices.map((index) => landmarks[index]));
  return {
    x: total.x / indices.length,
    y: total.y / indices.length,
    z: total.z / indices.length
  };
}

function getDistancePx(a, b, width, height) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

function loadImageElement(sourceUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = sourceUrl;
  });
}

async function createTransparentOverlayUrl(sourceUrl) {
  const image = await loadImageElement(sourceUrl);
  const outputWidth = Math.min(image.naturalWidth || 1400, 1400);
  const outputHeight = Math.max(1, Math.round(outputWidth / (image.naturalWidth / image.naturalHeight)));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, outputWidth, outputHeight);

  const imageData = context.getImageData(0, 0, outputWidth, outputHeight);
  const { data } = imageData;
  let minX = outputWidth;
  let minY = outputHeight;
  let maxX = 0;
  let maxY = 0;
  let solidPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    const brightness = (red + green + blue) / 3;
    const colorSpread = Math.max(
      Math.abs(red - green),
      Math.abs(red - blue),
      Math.abs(green - blue)
    );

    let nextAlpha = alpha;
    if (brightness > 244 && colorSpread < 14) {
      nextAlpha = 0;
    } else if (brightness > 232 && colorSpread < 22) {
      nextAlpha = Math.round(alpha * 0.18);
    } else if (brightness > 218 && colorSpread < 28) {
      nextAlpha = Math.round(alpha * 0.42);
    }

    data[index + 3] = nextAlpha;

    if (nextAlpha > 18) {
      const pixelIndex = index / 4;
      const x = pixelIndex % outputWidth;
      const y = Math.floor(pixelIndex / outputWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      solidPixels += 1;
    }
  }

  context.putImageData(imageData, 0, 0);

  if (!solidPixels) {
    return {
      url: sourceUrl,
      aspectRatio: image.naturalWidth / image.naturalHeight
    };
  }

  const padding = 12;
  const cropX = clamp(minX - padding, 0, outputWidth);
  const cropY = clamp(minY - padding, 0, outputHeight);
  const cropWidth = clamp(maxX - minX + padding * 2, 1, outputWidth - cropX);
  const cropHeight = clamp(maxY - minY + padding * 2, 1, outputHeight - cropY);

  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = cropWidth;
  croppedCanvas.height = cropHeight;
  const croppedContext = croppedCanvas.getContext("2d");
  croppedContext.drawImage(
    canvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  return {
    url: croppedCanvas.toDataURL("image/png"),
    aspectRatio: cropWidth / cropHeight
  };
}

async function updateOverlayAsset(item) {
  if (!item) {
    state.overlay.sourceUrl = "";
    state.overlay.assetUrl = "";
    dom.glassesOverlay.removeAttribute("src");
    return;
  }

  const token = `${item.objectId}-${Date.now()}`;
  state.selectionToken = token;
  const preferredUrl = item.overlayImageUrl || item.frontImageUrl;

  state.overlay.sourceUrl = preferredUrl;

  try {
    const processed = await createTransparentOverlayUrl(preferredUrl);
    if (state.selectionToken !== token) {
      return;
    }

    state.overlay.assetUrl = processed.url;
    state.overlay.imageAspectRatio = processed.aspectRatio;
    dom.glassesOverlay.src = processed.url;
  } catch (error) {
    console.warn("Could not prepare transparent overlay asset.", error);
    if (state.selectionToken !== token) {
      return;
    }

    state.overlay.assetUrl = preferredUrl;
    dom.glassesOverlay.src = preferredUrl;
  }
}

async function updateSelectedFrame(item) {
  state.selectedFrame = item;

  if (!item) {
    dom.selectedFrameTitle.textContent = "Ingen brille valgt endnu";
    dom.selectedFrameMeta.textContent = "Vaelg et stel i kataloget for at aktivere overlaegningen.";
    dom.selectedFrameLink.setAttribute("href", "#");
    await updateOverlayAsset(null);
    setActiveSource(state.currentSource);
    return;
  }

  dom.selectedFrameTitle.textContent = item.title;
  dom.selectedFrameMeta.textContent =
    `${formatMeta(item)}${item.header ? ` | ${item.header}` : ""}`.replace(/^\s*\|\s*/, "");
  dom.selectedFrameLink.href = item.productUrl;
  dom.glassesOverlay.alt = item.title;
  dom.glassesOverlay.style.opacity = String(state.overlay.opacity);
  setStatus("Forbereder AR-overlaeg for den valgte brille...");
  await updateOverlayAsset(item);
  setActiveSource(state.currentSource);
  setStatus(
    state.currentSource === "camera"
      ? "Live AR er klar. Bevaeg hovedet langsomt for at se stellet foelge dit ansigt."
      : "AR-overlaegget er klar. Start kameraet eller upload et billede for at proeve stellet."
  );
  positionGlasses();
}

function getSearchHaystack(item) {
  return [
    item.title,
    item.brand,
    item.color,
    item.shape,
    item.frameSize,
    item.segment,
    item.gender,
    item.header,
    item.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getSortedItems(items) {
  const sorted = [...items];

  switch (state.sort) {
    case "titleAsc":
      sorted.sort((a, b) => a.title.localeCompare(b.title, "da"));
      break;
    case "brandAsc":
      sorted.sort((a, b) => `${a.brand} ${a.title}`.localeCompare(`${b.brand} ${b.title}`, "da"));
      break;
    case "priceAsc":
      sorted.sort((a, b) => a.price - b.price);
      break;
    case "priceDesc":
      sorted.sort((a, b) => b.price - a.price);
      break;
    default:
      break;
  }

  return sorted;
}

function applyCatalogFilters() {
  const normalizedQuery = state.query.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? state.allItems.filter((item) => getSearchHaystack(item).includes(normalizedQuery))
    : state.allItems;

  state.items = getSortedItems(filteredItems);
  state.filteredCount = state.items.length;

  if (
    state.selectedFrame &&
    !state.items.some((item) => item.objectId === state.selectedFrame.objectId)
  ) {
    const existing = state.allItems.find((item) => item.objectId === state.selectedFrame.objectId);
    if (existing) {
      void updateSelectedFrame(existing);
    }
  }

  updateCatalogMeta();
  renderCatalog();
}

function renderCatalog() {
  const renderToken = `${Date.now()}-${Math.random()}`;
  state.renderToken = renderToken;
  dom.catalogGrid.innerHTML = "";

  if (state.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "loading-strip";
    empty.textContent = "Ingen stel matchede soegningen. Proev et andet brand, en farve eller en form.";
    dom.catalogGrid.append(empty);
    return;
  }

  let index = 0;
  const chunkSize = 60;

  const renderChunk = () => {
    if (state.renderToken !== renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + chunkSize, state.items.length);

    for (; index < end; index += 1) {
      const item = state.items[index];
      const clone = dom.productCardTemplate.content.cloneNode(true);
      const button = clone.querySelector(".product-select");
      const image = clone.querySelector(".product-image");
      const brand = clone.querySelector(".product-brand");
      const title = clone.querySelector(".product-title");
      const meta = clone.querySelector(".product-meta");
      const price = clone.querySelector(".product-price");

      if (state.selectedFrame?.objectId === item.objectId) {
        button.classList.add("is-active");
      }

      image.src = item.frontImageUrl;
      image.alt = item.title;
      image.loading = "lazy";
      brand.textContent = item.brand || "Synoptik";
      title.textContent = item.title;
      meta.textContent = formatMeta(item);
      price.textContent = item.priceText;

      button.addEventListener("click", async () => {
        await updateSelectedFrame(item);
        renderCatalog();
        if (state.currentSource === "photo") {
          detectFromPhoto();
        }
      });

      fragment.append(clone);
    }

    dom.catalogGrid.append(fragment);

    if (index < state.items.length) {
      requestAnimationFrame(renderChunk);
    }
  };

  requestAnimationFrame(renderChunk);
}

async function fetchCatalog() {
  dom.catalogLoading.classList.remove("hidden");
  dom.catalogGrid.innerHTML = "";

  try {
    const response = await fetch("/api/catalog/all");
    if (!response.ok) {
      throw new Error("Kunne ikke hente hele kataloget.");
    }

    const payload = await response.json();
    state.allItems = payload.items;
    state.totalHits = payload.totalHits;
    state.filteredCount = payload.items.length;
    applyCatalogFilters();
  } catch (error) {
    const failure = document.createElement("div");
    failure.className = "loading-strip";
    failure.textContent = `${error.message} Tjek at serveren kan naa Synoptik-feedet.`;
    dom.catalogGrid.append(failure);
    updateCatalogMeta();
  } finally {
    dom.catalogLoading.classList.add("hidden");
  }
}

async function initFaceLandmarker() {
  try {
    setStatus("Loader ansigtsdetektion, saa stellet kan blive autoplaceret...");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    const commonOptions = {
      runningMode: "IMAGE",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    };

    try {
      state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU"
        }
      });
    } catch (gpuError) {
      console.warn("GPU delegate unavailable, falling back to CPU.", gpuError);
      state.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "CPU"
        }
      });
    }

    state.faceReady = true;
    setStatus(
      "Ansigtsdetektion er klar. Vaelg en brille, og upload derefter et billede eller start kameraet."
    );
  } catch (error) {
    console.error(error);
    state.faceReady = false;
    setStatus(
      "Ansigtsdetektionen kunne ikke loades. Du kan stadig placere brillerne manuelt med sliders og drag.",
      "warning"
    );
  }
}

async function ensureVideoMode() {
  if (!state.faceLandmarker) {
    return;
  }
  await state.faceLandmarker.setOptions({ runningMode: "VIDEO" });
}

async function ensureImageMode() {
  if (!state.faceLandmarker) {
    return;
  }
  await state.faceLandmarker.setOptions({ runningMode: "IMAGE" });
}

function getTrackedPose(landmarks, width, height) {
  const leftEye = getAverageLandmark(landmarks, SOURCE_EYE_POINTS.left);
  const rightEye = getAverageLandmark(landmarks, SOURCE_EYE_POINTS.right);
  const leftTemple = getAverageLandmark(landmarks, TEMPLE_POINTS.left);
  const rightTemple = getAverageLandmark(landmarks, TEMPLE_POINTS.right);
  const bridge = landmarks[168] || landmarks[6] || landmarks[4];
  const forehead = landmarks[10] || bridge;
  const chin = landmarks[152] || bridge;

  const eyeDistancePx = getDistancePx(leftEye, rightEye, width, height);
  const faceWidthPx = getDistancePx(leftTemple, rightTemple, width, height);
  const frameWidth = Number(state.selectedFrame?.dimensions?.frameWidth || 125);
  const widthRatio = clamp(frameWidth / 125, 0.85, 1.15);

  const templeVector = subtractPoint(rightTemple, leftTemple);
  const verticalVector = subtractPoint(chin, forehead);
  const faceNormal = normalizeVector(crossProduct(templeVector, verticalVector));

  const roll =
    radiansToDegrees(
      Math.atan2((rightEye.y - leftEye.y) * height, (rightEye.x - leftEye.x) * width)
    ) + state.overlay.rotation;
  const yaw = clamp(radiansToDegrees(Math.atan2(faceNormal.x, Math.abs(faceNormal.z) + 0.0001)), -32, 32);
  const pitch = clamp(
    -radiansToDegrees(Math.atan2(faceNormal.y, Math.abs(faceNormal.z) + 0.0001)),
    -24,
    24
  );

  const widthFromEyes = eyeDistancePx * 2.05 * widthRatio;
  const widthFromFace = faceWidthPx * 0.98 * widthRatio;
  const trackedWidth = widthFromEyes * 0.62 + widthFromFace * 0.38;

  return {
    centerX: ((leftEye.x + rightEye.x) / 2) * width,
    centerY: ((bridge?.y ?? (leftEye.y + rightEye.y) / 2) * height) + trackedWidth * 0.06,
    width: clamp(trackedWidth, width * 0.18, width * 0.82),
    roll,
    yaw: state.currentSource === "camera" ? -yaw : yaw,
    pitch,
    confidence: clamp(faceWidthPx / (width * 0.33), 0, 1)
  };
}

function getRenderPose(targetPose) {
  if (!targetPose) {
    state.overlay.pose = null;
    return null;
  }

  if (!state.overlay.pose) {
    state.overlay.pose = { ...targetPose };
    return state.overlay.pose;
  }

  const smoothAmount = state.currentSource === "camera" ? 0.26 : 0.7;
  const previousPose = state.overlay.pose;
  state.overlay.pose = {
    centerX: lerp(previousPose.centerX, targetPose.centerX, smoothAmount),
    centerY: lerp(previousPose.centerY, targetPose.centerY, smoothAmount),
    width: lerp(previousPose.width, targetPose.width, smoothAmount),
    roll: lerp(previousPose.roll, targetPose.roll, smoothAmount),
    yaw: lerp(previousPose.yaw, targetPose.yaw, smoothAmount),
    pitch: lerp(previousPose.pitch, targetPose.pitch, smoothAmount),
    confidence: lerp(previousPose.confidence, targetPose.confidence, smoothAmount)
  };

  return state.overlay.pose;
}

function positionGlasses() {
  if (!state.selectedFrame) {
    dom.glassesLayer.style.display = "none";
    return;
  }

  const metrics = getDisplayMetrics();
  if (!metrics) {
    return;
  }

  const { width, height } = metrics;
  let poseTarget = {
    centerX: width / 2,
    centerY: height * 0.43,
    width: width * 0.48,
    roll: state.overlay.rotation,
    yaw: 0,
    pitch: 0,
    confidence: 0.2
  };

  if (state.lastLandmarks) {
    poseTarget = getTrackedPose(state.lastLandmarks, width, height);
  } else if (state.currentSource === "camera") {
    dom.glassesLayer.style.display = "none";
    return;
  }

  const pose = getRenderPose(poseTarget);
  state.overlay.autoWidth = pose.width;
  state.overlay.autoAngle = pose.roll;

  const overlayWidth = pose.width;
  const overlayHeight = overlayWidth / state.overlay.imageAspectRatio;
  const shadowX = pose.yaw * 0.32;
  const shadowY = 14 + Math.abs(pose.pitch) * 0.35;
  const shadowBlur = 24 + Math.abs(pose.yaw) * 0.65;
  const brightness = clamp(1 - Math.abs(pose.yaw) * 0.006 + pose.pitch * 0.003, 0.84, 1.08);
  const saturation = clamp(1 + pose.confidence * 0.03, 1, 1.08);

  dom.glassesLayer.style.display = "block";
  dom.glassesOverlay.style.width = `${overlayWidth}px`;
  dom.glassesOverlay.style.height = `${overlayHeight}px`;
  dom.glassesOverlay.style.left = `${pose.centerX + state.overlay.offsetX}px`;
  dom.glassesOverlay.style.top = `${pose.centerY + state.overlay.offsetY}px`;
  dom.glassesOverlay.style.transform =
    `translate3d(-50%, -50%, 0px) ` +
    `rotateZ(${pose.roll}deg) ` +
    `rotateY(${pose.yaw}deg) ` +
    `rotateX(${pose.pitch}deg) ` +
    `scale(${state.overlay.scale})`;
  dom.glassesOverlay.style.opacity = String(state.overlay.opacity);
  dom.glassesOverlay.style.filter =
    `drop-shadow(${shadowX}px ${shadowY}px ${shadowBlur}px rgba(17, 24, 39, 0.22)) ` +
    `brightness(${brightness}) saturate(${saturation})`;
}

function processDetectionResult(landmarks) {
  state.lastLandmarks = landmarks || null;
  positionGlasses();
}

function detectFromPhoto() {
  if (!state.faceReady || state.currentSource !== "photo" || !state.selectedFrame) {
    positionGlasses();
    return;
  }

  if (!dom.photoPreview.complete) {
    return;
  }

  ensureImageMode()
    .then(() => {
      const result = state.faceLandmarker.detect(dom.photoPreview);
      processDetectionResult(result.faceLandmarks?.[0] || null);
      if (result.faceLandmarks?.length) {
        setStatus("Brillen er autoplaceret på dit billede. Brug sliders eller træk for sidste finish.");
      } else {
        setStatus(
          "Jeg kunne ikke finde et ansigt i billedet. Du kan stadig placere brillerne manuelt.",
          "warning"
        );
      }
    })
    .catch((error) => {
      console.error(error);
      setStatus("Ansigtsdetektionen fejlede på billedet. Manuel justering er stadig mulig.", "warning");
    });
}

async function startCamera() {
  if (state.cameraStream) {
    stopCamera();
  }

  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      },
      audio: false
    });

    dom.cameraFeed.srcObject = state.cameraStream;
    await dom.cameraFeed.play();
    setActiveSource("camera");
    setStatus("Live AR er aktiv. Hold ansigtet i billedet, så følger stellet dine bevægelser.");

    if (state.faceReady) {
      await ensureVideoMode();
      requestAnimationFrame(runCameraLoop);
    }
  } catch (error) {
    console.error(error);
    setStatus(
      "Kameraadgang blev afvist eller er ikke tilgængelig. Prøv i stedet at uploade et billede.",
      "warning"
    );
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
  state.cameraStream = null;
  state.lastLandmarks = null;
  state.overlay.pose = null;
  dom.cameraFeed.pause();
  dom.cameraFeed.srcObject = null;

  if (state.currentSource === "camera") {
    state.currentSource = "idle";
    setActiveSource("idle");
  }
}

function runCameraLoop() {
  if (!state.cameraStream || state.currentSource !== "camera") {
    return;
  }

  try {
    if (state.faceReady && state.selectedFrame) {
      const result = state.faceLandmarker.detectForVideo(dom.cameraFeed, performance.now());
      processDetectionResult(result.faceLandmarks?.[0] || null);
    } else {
      positionGlasses();
    }
  } catch (error) {
    console.error(error);
  }

  requestAnimationFrame(runCameraLoop);
}

function handlePhotoUpload(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  stopCamera();
  const objectUrl = URL.createObjectURL(file);
  dom.photoPreview.onload = () => {
    setActiveSource("photo");
    state.lastLandmarks = null;
    detectFromPhoto();
  };
  dom.photoPreview.src = objectUrl;
  setStatus("Billedet er laest ind. Jeg matcher nu stellet mod dit ansigt...");
}

function bindDrag() {
  dom.glassesOverlay.addEventListener("pointerdown", (event) => {
    if (!state.selectedFrame) {
      return;
    }

    state.dragPointerId = event.pointerId;
    state.dragStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: state.overlay.offsetX,
      offsetY: state.overlay.offsetY
    };

    dom.glassesOverlay.classList.add("dragging");
    dom.glassesOverlay.setPointerCapture(event.pointerId);
  });

  dom.glassesOverlay.addEventListener("pointermove", (event) => {
    if (event.pointerId !== state.dragPointerId || !state.dragStart) {
      return;
    }

    const deltaX = event.clientX - state.dragStart.x;
    const deltaY = event.clientY - state.dragStart.y;
    const adjustedDeltaX = state.currentSource === "camera" ? -deltaX : deltaX;

    state.overlay.offsetX = state.dragStart.offsetX + adjustedDeltaX;
    state.overlay.offsetY = state.dragStart.offsetY + deltaY;

    dom.xSlider.value = String(
      state.currentSource === "camera" ? -state.overlay.offsetX : state.overlay.offsetX
    );
    dom.ySlider.value = String(state.overlay.offsetY);
    updateSliderLabels();
    positionGlasses();
  });

  const stopDragging = (event) => {
    if (event.pointerId !== state.dragPointerId) {
      return;
    }
    dom.glassesOverlay.classList.remove("dragging");
    state.dragPointerId = null;
    state.dragStart = null;
  };

  dom.glassesOverlay.addEventListener("pointerup", stopDragging);
  dom.glassesOverlay.addEventListener("pointercancel", stopDragging);
}

function bindEvents() {
  dom.jumpToCamera?.addEventListener("click", () => {
    dom.stageSection.scrollIntoView({ behavior: "smooth", block: "start" });
    startCamera();
  });

  dom.jumpToCatalog?.addEventListener("click", () => {
    dom.catalogSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = dom.searchInput.value.trim();
    state.sort = dom.sortSelect.value;
    applyCatalogFilters();
  });

  dom.searchInput.addEventListener("input", () => {
    state.query = dom.searchInput.value.trim();
    applyCatalogFilters();
  });

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    applyCatalogFilters();
  });

  dom.photoInput.addEventListener("change", handlePhotoUpload);
  dom.cameraButton.addEventListener("click", startCamera);
  dom.stopCameraButton.addEventListener("click", () => {
    stopCamera();
    setStatus("Kameraet er stoppet. Upload et billede eller start kameraet igen, naar du vil fortsaette.");
  });
  dom.autoPlaceButton.addEventListener("click", () => {
    if (state.currentSource === "photo") {
      detectFromPhoto();
    } else if (state.currentSource === "camera") {
      setStatus("Holder kameraet live. Autoplaceringen opdateres løbende.");
    } else {
      positionGlasses();
    }
  });
  dom.resetAdjustmentsButton.addEventListener("click", resetAdjustments);

  [
    [dom.scaleSlider, "scale"],
    [dom.rotationSlider, "rotation"],
    [dom.xSlider, "offsetX"],
    [dom.ySlider, "offsetY"],
    [dom.opacitySlider, "opacity"]
  ].forEach(([input, key]) => {
    input.addEventListener("input", () => {
      const rawValue = Number(input.value);
      state.overlay[key] =
        key === "offsetX" && state.currentSource === "camera" ? -rawValue : rawValue;
      updateSliderLabels();
      positionGlasses();
    });
  });

  dom.glassesOverlay.addEventListener("load", () => {
    const ratio = dom.glassesOverlay.naturalWidth / dom.glassesOverlay.naturalHeight;
    if (Number.isFinite(ratio) && ratio > 0) {
      state.overlay.imageAspectRatio = ratio;
      positionGlasses();
    }
  });

  dom.glassesOverlay.addEventListener("error", () => {
    if (
      state.selectedFrame?.frontImageUrl &&
      dom.glassesOverlay.src !== state.selectedFrame.frontImageUrl
    ) {
      dom.glassesOverlay.src = state.selectedFrame.frontImageUrl;
    }
  });

  window.addEventListener("resize", () => {
    positionGlasses();
  });

  bindDrag();
}

async function init() {
  bindEvents();
  dom.sortSelect.value = state.sort;
  updateSliderLabels();
  updateCatalogMeta();
  await Promise.all([fetchCatalog(), initFaceLandmarker()]);
}

init();
  updateCatalogMeta();
  await Promise.all([fetchCatalog(), initFaceLandmarker()]);
}

init();
