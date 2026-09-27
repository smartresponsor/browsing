export function enumerateFrameTree(page) {
  const result = [];

  const walk = (frame, framePath) => {
    result.push({
      frame,
      framePath,
      frameUrl: frame.url(),
      frameName: frame.name() || '',
    });

    const children = frame.childFrames();
    for (let index = 0; index < children.length; index += 1) {
      walk(children[index], [...framePath, index]);
    }
  };

  walk(page.mainFrame(), []);
  return result;
}

export function resolveFrameByPath(page, framePath) {
  if (!Array.isArray(framePath)) {
    throw new Error('framePath must be an array of child-frame indexes.');
  }

  let frame = page.mainFrame();
  for (const rawIndex of framePath) {
    if (!Number.isInteger(rawIndex) || rawIndex < 0) {
      throw new Error('framePath contains an invalid child-frame index.');
    }
    const children = frame.childFrames();
    frame = children[rawIndex];
    if (!frame) {
      return null;
    }
  }

  return frame;
}

export function normalizeFramePath(framePath) {
  return Array.isArray(framePath)
    ? framePath.filter((value) => Number.isInteger(value) && value >= 0)
    : [];
}

