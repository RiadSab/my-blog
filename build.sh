#!/bin/sh
# Build the site with a pinned Zola version.
# Cloudflare Pages runs this as its build command (`sh build.sh`), because
# the Zola it provides is older and builds this site wrong (empty heading
# ids, so the table of contents breaks; no class-based code colors).
set -eu

ZOLA_VERSION="0.23.6"

if command -v zola >/dev/null 2>&1 && [ "$(zola --version)" = "zola $ZOLA_VERSION" ]; then
  zola build
else
  echo "Downloading Zola $ZOLA_VERSION"
  curl -sSfL "https://github.com/getzola/zola/releases/download/v$ZOLA_VERSION/zola-v$ZOLA_VERSION-x86_64-unknown-linux-musl.tar.gz" | tar -xz
  ./zola --version
  ./zola build
fi
