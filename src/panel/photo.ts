// Shrinks a picture from the host's device before it is sent. The browser
// draws it onto a canvas and encodes a fresh file, so camera details and
// location data in the original never leave the device.
const LONG_EDGE = 800
const MAX_BYTES = 150 * 1024

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // Fall through to an image element.
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  await image.decode()
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
}

// Resolves to a WebP (or JPEG where WebP cannot be written) of at most 150 KB,
// or null when the file is not a picture this browser can read.
export async function shrinkPhoto(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null
  let decoded
  try {
    decoded = await decode(file)
  } catch {
    return null
  }
  try {
    for (const edge of [LONG_EDGE, 640, 480]) {
      const scale = Math.min(1, edge / Math.max(decoded.width, decoded.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(decoded.width * scale))
      canvas.height = Math.max(1, Math.round(decoded.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.82, 0.68, 0.54]) {
        let blob = await toBlob(canvas, 'image/webp', quality)
        // Safari cannot write WebP and quietly hands back a PNG.
        if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality)
        if (blob && (blob.type === 'image/webp' || blob.type === 'image/jpeg') && blob.size <= MAX_BYTES) return blob
      }
    }
    return null
  } finally {
    decoded.release()
  }
}
