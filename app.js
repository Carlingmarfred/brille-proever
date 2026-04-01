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
    autoAngle: 0
  }
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
  dom.scaleValue.textContent = `${Math.round(state.overlay.scale * 100)}%`;
  dom.rotationValue.textContent = `${state.overlay.rotation.toFixed(1)} deg`;
  dom.xValue.textContent = `${Math.round(state.overlay.offsetX)} px`;
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
  state.currentSource = source;
  const showCamera = source === "camera";
  const showPhoto = source === "photo";
  const showOverlay = Boolean(state.selectedFrame && (showCamera || showPhoto));

  dom.cameraFeed.style.display = showCamera ? "block" : "none";
  dom.photoPreview.style.display = showPhoto ? "block" : "none";
  dom.stagePlaceholder.style.display = showCamera || showPhoto ? "none" : "grid";
  dom.glassesLayer.style.display = showOverlay ? "block" : "none";
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
      y: sum.y + point.y
    }),
    { x: 0, y: 0 }
  );
}

function getAverageLandmark(landmarks, indices) {
  const total = averagePoints(indices.map((index) => landmarks[index]));
  return {
    x: total.x / indices.length,
    y: total.y / indices.length
  };
}

function getDistancePx(a, b, width, height) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

function updateSelectedFrame(item) {
  state.selectedFrame = item;

  if (!item) {
    dom.selectedFrameTitle.textContent = "Ingen brille valgt endnu";
    dom.selectedFrameMeta.textContent = "Vaelg et stel i kataloget for at aktivere overlaegningen.";
    dom.selectedFrameLink.setAttribute("href", "#");
    dom.glassesOverlay.removeAttribute("src");
    setActiveSource(state.currentSource);
    return;
  }

  dom.selectedFrameTitle.textContent = item.title;
  dom.selectedFrameMeta.textContent =
    `${formatMeta(item)}${item.header ? ` | ${item.header}` : ""}`.replace(/^\s*\|\s*/, "");
  dom.selectedFrameLink.href = item.productUrl;

  dom.glassesOverlay.src = item.overlayImageUrl || item.frontImageUrl;
  dom.glassesOverlay.alt = item.title;
  dom.glassesOverlay.style.opacity = String(state.overlay.opacity);
  setActiveSource(state.currentSource);
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
      updateSelectedFrame(existing);
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

      button.addEventListener("click", () => {
        updateSelectedFrame(item);
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

function getAutoPlacement(landmarks, width, height) {
  const leftEye = getAverageLandmark(landmarks, SOURCE_EYE_POINTS.left);
  const rightEye = getAverageLandmark(landmarks, SOURCE_EYE_POINTS.right);
  const bridge = landmarks[168] || landmarks[6];
  const faceLeft = landmarks[234] || landmarks[127];
  const faceRight = landmarks[454] || landmarks[356];

  const eyeDistancePx = getDistancePx(leftEye, rightEye, width, height);
  const faceWidthPx = getDistancePx(faceLeft, faceRight, width, height);
  const frameWidth = Number(state.selectedFrame?.dimensions?.frameWidth || 125);

  const basedOnPd = eyeDistancePx * (frameWidth / 63) * 1.06;
  const basedOnFace = faceWidthPx * 0.93;
  const autoWidth = basedOnPd * 0.7 + basedOnFace * 0.3;
  const autoAngle =
    (Math.atan2((rightEye.y - leftEye.y) * height, (rightEye.x - leftEye.x) * width) * 180) /
    Math.PI;

  return {
    width: autoWidth,
    centerX: ((leftEye.x + rightEye.x) / 2) * width,
    centerY: ((bridge?.y ?? (leftEye.y + rightEye.y) / 2) * height) + autoWidth * 0.02,
    angle: autoAngle
  };
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
  let basePlacement = {
    width: width * 0.58,
    centerX: width / 2,
    centerY: height * 0.42,
    angle: 0
  };

  if (state.lastLandmarks) {
    basePlacement = getAutoPlacement(state.lastLandmarks, width, height);
  }

  state.overlay.autoWidth = basePlacement.width;
  state.overlay.autoAngle = basePlacement.angle;

  const overlayWidth = basePlacement.width * state.overlay.scale;
  const overlayHeight = overlayWidth / state.overlay.imageAspectRatio;
  const left = basePlacement.centerX - overlayWidth / 2 + state.overlay.offsetX;
  const top = basePlacement.centerY - overlayHeight / 2 + state.overlay.offsetY;
  const angle = basePlacement.angle + state.overlay.rotation;

  dom.glassesLayer.style.display = "block";
  dom.glassesOverlay.style.width = `${overlayWidth}px`;
  dom.glassesOverlay.style.transform = `translate(${left}px, ${top}px) rotate(${angle}deg)`;
  dom.glassesOverlay.style.opacity = String(state.overlay.opacity);
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
        setStatus("Brillen er autoplaceret paa dit billede. Brug sliders eller drag for sidste finish.");
      } else {
        setStatus(
          "Jeg kunne ikke finde et ansigt i billedet. Du kan stadig placere brillerne manuelt.",
          "warning"
        );
      }
    })
    .catch((error) => {
      console.error(error);
      setStatus("Ansigtsdetektionen fejlede paa billedet. Manuel justering er stadig mulig.", "warning");
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
    setStatus("Kameraet er aktivt. Hold ansigtet roligt et oejeblik, saa placerer jeg brillen.");

    if (state.faceReady) {
      await ensureVideoMode();
      requestAnimationFrame(runCameraLoop);
    }
  } catch (error) {
    console.error(error);
    setStatus(
      "Kameraadgang blev afvist eller er ikke tilgaengelig. Proev i stedet at uploade et billede.",
      "warning"
    );
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
  state.cameraStream = null;
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

    state.overlay.offsetX = state.dragStart.offsetX + deltaX;
    state.overlay.offsetY = state.dragStart.offsetY + deltaY;

    dom.xSlider.value = String(state.overlay.offsetX);
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
      setStatus("Holder kameraet live. Autoplaceringen opdateres loebende.");
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
      state.overlay[key] = Number(input.value);
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
