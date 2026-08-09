import { describe, expect, it } from "vitest";
import { buildCatalogFailureMessage, getRenderPose, getTrackedPose } from "../tryon-core.js";

function createLandmarks() {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

function setPoint(landmarks, index, point) {
  landmarks[index] = point;
}

function buildFaceFixture() {
  const landmarks = createLandmarks();

  // Venstre øje
  [33, 133, 159, 145].forEach((idx) => setPoint(landmarks, idx, { x: 0.42, y: 0.45, z: 0 }));
  // Højre øje
  [362, 263, 386, 374].forEach((idx) => setPoint(landmarks, idx, { x: 0.58, y: 0.45, z: 0 }));

  // Tindinger med dybde forskel for yaw
  setPoint(landmarks, 127, { x: 0.33, y: 0.5, z: 0.12 });
  setPoint(landmarks, 234, { x: 0.36, y: 0.5, z: 0.12 });
  setPoint(landmarks, 356, { x: 0.64, y: 0.5, z: -0.12 });
  setPoint(landmarks, 454, { x: 0.67, y: 0.5, z: -0.12 });

  // Bro, pande, hage
  setPoint(landmarks, 168, { x: 0.5, y: 0.49, z: 0 });
  setPoint(landmarks, 10, { x: 0.5, y: 0.31, z: 0.02 });
  setPoint(landmarks, 152, { x: 0.5, y: 0.75, z: -0.02 });

  return landmarks;
}

describe("getTrackedPose", () => {
  it("beregner en stabil pose med bredde og center", () => {
    const pose = getTrackedPose(buildFaceFixture(), 1000, 800, { frameWidth: 130 });

    expect(pose.centerX).toBeCloseTo(500, 1);
    expect(pose.centerY).toBeGreaterThan(350);
    expect(pose.width).toBeGreaterThan(200);
    expect(pose.width).toBeLessThan(820);
    expect(pose.confidence).toBeGreaterThan(0.5);
  });

  it("spejlvender yaw i kameratilstand", () => {
    const landmarks = buildFaceFixture();
    const photoPose = getTrackedPose(landmarks, 1000, 800, { currentSource: "photo" });
    const cameraPose = getTrackedPose(landmarks, 1000, 800, { currentSource: "camera" });

    expect(photoPose.yaw).not.toBe(0);
    expect(cameraPose.yaw).toBeCloseTo(-photoPose.yaw, 5);
  });

  it("anvender rotationsjustering fra UI", () => {
    const landmarks = buildFaceFixture();
    const basePose = getTrackedPose(landmarks, 1000, 800, { rotation: 0 });
    const adjusted = getTrackedPose(landmarks, 1000, 800, { rotation: 7.5 });

    expect(adjusted.roll - basePose.roll).toBeCloseTo(7.5, 4);
  });
});

describe("getRenderPose", () => {
  it("glatter bevægelse i live-kamera", () => {
    const previous = {
      centerX: 100,
      centerY: 100,
      width: 200,
      roll: 0,
      yaw: 0,
      pitch: 0,
      confidence: 0.4
    };
    const target = {
      centerX: 200,
      centerY: 240,
      width: 320,
      roll: 10,
      yaw: 15,
      pitch: -6,
      confidence: 1
    };

    const smoothed = getRenderPose(previous, target, "camera");

    expect(smoothed.centerX).toBeGreaterThan(100);
    expect(smoothed.centerX).toBeLessThan(200);
    expect(smoothed.yaw).toBeGreaterThan(0);
    expect(smoothed.yaw).toBeLessThan(15);
  });
});

describe("buildCatalogFailureMessage", () => {
  it("viser en dansk fejltekst ved API-fejl", () => {
    expect(buildCatalogFailureMessage("Kunne ikke hente hele kataloget.")).toBe(
      "Kunne ikke hente hele kataloget. Tjek at serveren kan nå Synoptik-feedet."
    );
  });
});
