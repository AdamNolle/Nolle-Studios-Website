const sonyModelNames: Readonly<Record<string, string>> = {
  'ILCE-7M5': 'α7 V',
  'A7 V': 'α7 V',
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

/** Keep generated EXIF ASCII-safe while the public catalog uses Sony's α styling. */
export function cameraMetadataForExif(cameraMake: string, cameraModel: string) {
  return {
    cameraMake,
    cameraModel: cameraModel.replaceAll('α', 'a'),
  };
}
