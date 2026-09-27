const sonyModelNames: Readonly<Record<string, string>> = {
  'ILCE-7M5': 'a7 V',
};

/** Translate camera-maker EXIF identifiers into concise names for people. */
export function normalizeCameraMetadata(cameraMake: string, cameraModel: string) {
  const make = cameraMake.trim();
  const model = cameraModel.trim();
  if (make.toUpperCase() !== 'SONY') return { cameraMake: make, cameraModel: model };
  return {
    cameraMake: 'Sony',
    cameraModel: sonyModelNames[model.toUpperCase()] ?? model,
  };
}
