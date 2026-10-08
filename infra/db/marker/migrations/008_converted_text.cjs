/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.addColumns('script_clips', {
    // The converted handwriting (ocr_text) is rendered once to an image stored next to the clip image,
    // so annotation positions on the converted page stay valid. NULL = not rendered yet.
    text_image_url: { type: 'text' },
    // Fingerprint of the regions and name zones the clip image was cut with. Re-running clipping after
    // those changed means the old converted page no longer matches; NULL = not recorded (older clips).
    clip_signature: { type: 'text' },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumns('script_clips', ['text_image_url', 'clip_signature']);
};
