/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // The converted handwriting (script_clips.ocr_text) is rendered once to an image stored next to
  // the clip image, so annotation positions on the converted view stay valid. NULL = not rendered.
  pgm.addColumn('script_clips', {
    text_image_url: { type: 'text' },
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropColumn('script_clips', 'text_image_url');
};
