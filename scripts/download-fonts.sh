#!/usr/bin/env bash
set -euo pipefail

FONTS_DIR="$(dirname "$0")/../assets/fonts"
mkdir -p "$FONTS_DIR"

echo "Downloading fonts..."
# Google Fonts static TTF instances (via CSS2 API with legacy UA → truetype format)
GFONTS_UA="Mozilla/5.0"

get_ttf_url() {
  curl -sA "$GFONTS_UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" \
    | grep -o 'url([^)]*\.ttf)' | sed 's/url(//' | sed 's/)//'
}

PLAYFAIR_URL=$(get_ttf_url "Playfair+Display:wght@700")
LATO_URL=$(get_ttf_url "Lato:wght@400")
CORMORANT_URL=$(get_ttf_url "Cormorant+Garamond:wght@600")
SOURCESANS_URL=$(get_ttf_url "Source+Sans+3:wght@400")

curl -sL -o "$FONTS_DIR/PlayfairDisplay-Bold.ttf"       "$PLAYFAIR_URL"
curl -sL -o "$FONTS_DIR/Lato-Regular.ttf"               "$LATO_URL"
curl -sL -o "$FONTS_DIR/CormorantGaramond-SemiBold.ttf" "$CORMORANT_URL"
curl -sL -o "$FONTS_DIR/SourceSansPro-Regular.ttf"      "$SOURCESANS_URL"

echo "Done. Fonts in $FONTS_DIR"
