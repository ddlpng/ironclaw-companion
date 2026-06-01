#!/bin/bash
# Generate app icons from SVG source
# Requires: rsvg-convert (librsvg) or inkscape, imagemagick

SVG_SOURCE="icon.svg"
SIZES=(16 32 48 64 128 256 512 1024)

echo "Generating icons from $SVG_SOURCE..."

for SIZE in "${SIZES[@]}"; do
  if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w $SIZE -h $SIZE "$SVG_SOURCE" -o "icon_${SIZE}.png"
  elif command -v inkscape &>/dev/null; then
    inkscape "$SVG_SOURCE" --export-width=$SIZE --export-height=$SIZE --export-filename="icon_${SIZE}.png"
  fi
  echo "  Generated icon_${SIZE}.png"
done

# Generate main icon.png at 512px
cp icon_512.png icon.png 2>/dev/null || echo "  Note: install rsvg-convert for auto icon generation"

# Create ICO for Windows (requires imagemagick)
if command -v convert &>/dev/null; then
  convert icon_16.png icon_32.png icon_48.png icon_64.png icon_128.png icon_256.png icon.ico
  echo "  Generated icon.ico"
fi

echo "Done!"
