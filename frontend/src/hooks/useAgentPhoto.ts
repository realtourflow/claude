// Reads an image file, resizes it to a max dimension, and returns a
// JPEG data URL. Used for the agent headshot so the photo can be stored
// in the user_settings JSONB without depending on S3 CORS being configured.
export async function uploadAgentPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File must be an image.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const MAX_DIM = 384; // 384x384 is plenty for a headshot at 2x retina
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported in this browser.');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image.'));
    img.src = src;
  });
}
