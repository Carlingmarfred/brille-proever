const SOURCE_EYE_POINTS = {
  left: [33, 133, 159, 145],
  right: [362, 263, 386, 374]
};

const TEMPLE_POINTS = {
  left: [127, 234],
  right: [356, 454]
};

export function clamp(value, min, max) {
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

export function getTrackedPose(landmarks, width, height, options = {}) {
  const leftEye = getAverageLandmark(landmarks, SOURCE_EYE_POINTS.left);
  const rightEye = getAverageLandmark(landmarks, SOURCE_EYE_POINTS.right);
  const leftTemple = getAverageLandmark(landmarks, TEMPLE_POINTS.left);
  const rightTemple = getAverageLandmark(landmarks, TEMPLE_POINTS.right);
  const bridge = landmarks[168] || landmarks[6] || landmarks[4];
  const forehead = landmarks[10] || bridge;
  const chin = landmarks[152] || bridge;

  const eyeDistancePx = getDistancePx(leftEye, rightEye, width, height);
  const faceWidthPx = getDistancePx(leftTemple, rightTemple, width, height);
  const frameWidth = Number(options.frameWidth || 125);
  const widthRatio = clamp(frameWidth / 125, 0.85, 1.15);

  const templeVector = subtractPoint(rightTemple, leftTemple);
  const verticalVector = subtractPoint(chin, forehead);
  const faceNormal = normalizeVector(crossProduct(templeVector, verticalVector));

  const roll =
    radiansToDegrees(
      Math.atan2((rightEye.y - leftEye.y) * height, (rightEye.x - leftEye.x) * width)
    ) + Number(options.rotation || 0);
  const yaw = clamp(radiansToDegrees(Math.atan2(faceNormal.x, Math.abs(faceNormal.z) + 0.0001)), -32, 32);
  const pitch = clamp(
    -radiansToDegrees(Math.atan2(faceNormal.y, Math.abs(faceNormal.z) + 0.0001)),
    -24,
    24
  );

  const widthFromEyes = eyeDistancePx * 2.05 * widthRatio;
  const widthFromFace = faceWidthPx * 0.98 * widthRatio;
  const trackedWidth = widthFromEyes * 0.62 + widthFromFace * 0.38;

  const source = options.currentSource || "photo";

  return {
    centerX: ((leftEye.x + rightEye.x) / 2) * width,
    centerY: ((bridge?.y ?? (leftEye.y + rightEye.y) / 2) * height) + trackedWidth * 0.06,
    width: clamp(trackedWidth, width * 0.18, width * 0.82),
    roll,
    yaw: source === "camera" ? -yaw : yaw,
    pitch,
    confidence: clamp(faceWidthPx / (width * 0.33), 0, 1)
  };
}

export function getRenderPose(previousPose, targetPose, currentSource = "photo") {
  if (!targetPose) {
    return null;
  }

  if (!previousPose) {
    return { ...targetPose };
  }

  const smoothAmount = currentSource === "camera" ? 0.26 : 0.7;
  return {
    centerX: lerp(previousPose.centerX, targetPose.centerX, smoothAmount),
    centerY: lerp(previousPose.centerY, targetPose.centerY, smoothAmount),
    width: lerp(previousPose.width, targetPose.width, smoothAmount),
    roll: lerp(previousPose.roll, targetPose.roll, smoothAmount),
    yaw: lerp(previousPose.yaw, targetPose.yaw, smoothAmount),
    pitch: lerp(previousPose.pitch, targetPose.pitch, smoothAmount),
    confidence: lerp(previousPose.confidence, targetPose.confidence, smoothAmount)
  };
}

export function buildCatalogFailureMessage(message) {
  return `${message} Tjek at serveren kan nå Synoptik-feedet.`;
}
